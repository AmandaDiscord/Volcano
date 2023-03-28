import util from "util";

import * as Discord from "@discordjs/voice";
import * as encoding from "@lavalink/encoding";
import prism from "prism-media";

import Constants from "./Constants.js";
import Util from "./util/Util.js";
import websocket from "./loaders/websocket.js";
import { lavalinkConfig } from "./loaders/config.js";

import type { UpdatePlayerData, UpdatePlayerResult, PlayerState, Filters } from "lavalink-types";
import type { Readable } from "stream";

export const queues = new Map<string, Queue>();
const methodMap = new Map<string, Discord.DiscordGatewayAdapterLibraryMethods>();

const sendToParent = (data: Parameters<typeof import("./loaders/websocket.js").sendMessage>["0"]["data"], clientID: string) => websocket.sendMessage({ clientID, data });

setInterval(() => {
	if (!queues.size) return;
	for (const queue of queues.values()) {
		const state = queue.state;
		if (!queue.actions.paused) sendToParent({ op: Constants.OPCodes.PLAYER_UPDATE, guildId: queue.guildID, state }, queue.clientID);
	}
}, lavalinkConfig.lavalink.server.playerUpdateInterval * 1000);

export class Queue {
	public connection: Discord.VoiceConnection;
	public clientID: string;
	public guildID: string;
	public track: { track: string; start: number; end: number; volume: number; pause: boolean } | undefined = undefined;
	public player = Discord.createAudioPlayer({ behaviors: { noSubscriber: Discord.NoSubscriberBehavior.Play } });
	public resource: Discord.AudioResource<import("@lavalink/encoding").TrackInfo> | null = null;
	public actions = { initial: true, stopping: false, volume: 1.0, applyingFilters: false, shouldntCallFinish: false, trackPausing: false, seekTime: 0, destroyed: false, rate: 1.0, paused: false };
	public _filters: Array<string> = [];
	public filtersObject: Filters = {};

	public constructor(clientID: string, guildID: string) {
		this.connection = Discord.getVoiceConnection(guildID, clientID)!;
		this.connection.subscribe(this.player);
		this.clientID = clientID;
		this.guildID = guildID;

		this.connection.on("stateChange", async (_oldState, newState) => {
			if (newState.status === Discord.VoiceConnectionStatus.Disconnected) {
				try {
					await Promise.race([
						Util.waitForResourceToEnterState(this.connection, Discord.VoiceConnectionStatus.Signalling, 5000),
						Util.waitForResourceToEnterState(this.connection, Discord.VoiceConnectionStatus.Connecting, 5000)
					]);
				} catch {
					if (newState.reason === Discord.VoiceConnectionDisconnectReason.WebSocketClose) sendToParent({ op: "event", type: "WebSocketClosedEvent", guildId: this.guildID, code: newState.closeCode as keyof typeof Constants.VoiceWSCloseCodes, reason: Constants.VoiceWSCloseCodes[newState.closeCode], byRemote: true }, this.clientID);
				}
			} else if (newState.status === Discord.VoiceConnectionStatus.Destroyed && !this.actions.destroyed) sendToParent({ op: "event", type: "WebSocketClosedEvent", guildId: this.guildID, code: 4000 as 4001, reason: "IDK what happened. All I know is that the connection was destroyed prematurely", byRemote: false }, this.clientID);
			else if (newState.status === Discord.VoiceConnectionStatus.Connecting || newState.status === Discord.VoiceConnectionStatus.Signalling) {
				try {
					await Util.waitForResourceToEnterState(this.connection, Discord.VoiceConnectionStatus.Ready, Constants.VoiceConnectionConnectThresholdMS);
				} catch {
					sendToParent({ op: "event", type: "WebSocketClosedEvent", guildId: this.guildID, code: 4000 as 4001, reason: `Couldn't connect in time (${Constants.VoiceConnectionConnectThresholdMS}ms)`, byRemote: false }, this.clientID);
				}
			}
		});

		this.player.on("stateChange", async (oldState, newState) => {
			if (newState.status === Discord.AudioPlayerStatus.Idle && oldState.status !== Discord.AudioPlayerStatus.Idle) {
				const track = this.track?.track || "unknown";
				this.resource = null;
				this.track = undefined;
				// Do not log if stopping. Queue.stop will send its own STOPPED reason instead of FINISHED. Do not log if shouldntCallFinish obviously.
				if (!this.actions.stopping && !this.actions.shouldntCallFinish) sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "FINISHED", encodedTrack: track }, this.clientID);
				this.actions.stopping = false;
				this.actions.shouldntCallFinish = false;
			} else if (newState.status === Discord.AudioPlayerStatus.Playing && oldState.status !== Discord.AudioPlayerStatus.Paused && oldState.status !== Discord.AudioPlayerStatus.AutoPaused) {
				if (this.actions.trackPausing) this.pause();
				this.actions.trackPausing = false;
				if ((!this.actions.shouldntCallFinish || this.actions.initial) && this.track) sendToParent({ op: "event", type: "TrackStartEvent", guildId: this.guildID, encodedTrack: this.track.track }, this.clientID);
				this.actions.initial = false;
			}
		});

		this.player.on("error", (error) => {
			sendToParent({ op: "event", type: "TrackExceptionEvent", guildId: this.guildID, encodedTrack: this.track?.track || "unknown", exception: { message: error.message, severity: "COMMON", cause: error.stack || new Error().stack || "unknown" } }, this.clientID);
		});
	}

	public get state(): PlayerState & { guildId: string } {
		const position = Math.floor(((this.resource?.playbackDuration || 0) + this.actions.seekTime) * this.actions.rate);
		if (this.track && this.track.end && position >= this.track.end) this.stop(this.track.track, true);
		return {
			time: Date.now(),
			position: position,
			connected: this.connection.state.status === Discord.VoiceConnectionStatus.Ready,
			ping: this.connection.ping.ws || Infinity,
			guildId: this.guildID
		};
	}

	public nextSong() {
		this.actions.seekTime = 0;
		this.actions.initial = true;
		if (!this.track) return;
		this.play().catch(e => console.error(util.inspect(e, false, Infinity, true)));
	}

	public async getResource(decoded: import("@lavalink/encoding").TrackInfo, meta: NonNullable<Queue["track"]>): Promise<Discord.AudioResource<import("@lavalink/encoding").TrackInfo>> {
		if (lavalinkConfig.lavalink.server.sources[decoded.source] === false) throw new Error(`${decoded.source.toUpperCase()}_NOT_ENABLED`);

		let output: Readable | null = null;
		let streamType: Discord.StreamType | undefined = undefined;

		let useFFMPEG = !!this._filters.length || !!meta.start;

		const found = lavalinkPlugins.find(p => p.source === decoded.source);
		if (found) {
			const result = await found.streamHandler?.(decoded, useFFMPEG);
			if (result) {
				output = result.stream;
				streamType = result.type as Discord.StreamType;
			}
		} else throw new Error(`${decoded.source.toUpperCase()}_NOT_IMPLEMENTED`);

		if (!output) throw new Error(`NO_OUTPUT_TYPE_${decoded.source.toUpperCase()}_FILTERS_${String(useFFMPEG).toUpperCase()}_PREVIOUS_${String(!this.actions.initial).toUpperCase()}`);

		for (const plugin of lavalinkPlugins) {
			if (plugin.streamPipeline) {
				const data = await plugin.streamPipeline(output!, this._filters);
				output = data.stream;
				if (data.type) streamType = data.type as Discord.StreamType;
			}
		}

		// The code is duped because filters can be mutated
		if (!output) throw new Error(`NO_OUTPUT_TYPE_${decoded.source.toUpperCase()}_FILTERS_${String(useFFMPEG).toUpperCase()}_PREVIOUS_${String(!this.actions.initial).toUpperCase()}`);
		useFFMPEG = !!this._filters.length || !!meta.start;

		if (useFFMPEG) {
			this.actions.shouldntCallFinish = true;
			const toApply = ["-analyzeduration", "0", "-loglevel", "0", "-f", "s16le", "-ar", "48000", "-ac", "2"];
			if (this.state.position && !this._filters.includes("-ss")) {
				toApply.unshift("-ss", `${this.state.position + 2000}ms`);
				this.actions.seekTime = this.state.position + 2000;
			} else if (this._filters.includes("-ss")) { // came from Queue.seek option. this.seekTime should be set already.
				const index = this._filters.indexOf("-ss");
				const ss = this._filters.splice(index, 2);
				toApply.unshift(...ss);
			} else if (meta.start) { // obv prefer user's pref then fallback to if the track specified a startTime
				this.actions.seekTime = meta.start;
				toApply.unshift("-ss", `${meta.start}ms`);
			}
			// _filters should no longer have -ss if there are other filters, then push the audio filters flag
			if (this._filters.length) toApply.push("-af", ...this._filters);
			this.actions.applyingFilters = false;
			const pipes: Array<Readable> = [output, new prism.FFmpeg({ args: toApply }), new prism.VolumeTransformer({ type: "s16le" }), new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 })];
			return new Discord.AudioResource([], pipes, decoded, 5);
		}

		if (!streamType) {
			const probe = await Discord.demuxProbe(output);
			streamType = probe.type;
			output = probe.stream;
		}
		return Discord.createAudioResource(output!, { metadata: decoded, inputType: streamType, inlineVolume: true });
	}

	public async play() {
		if (!this.track) return;

		const meta = this.track;
		const decoded = encoding.decode(meta.track);
		if (!decoded.uri) return;
		// eslint-disable-next-line no-async-promise-executor
		let resource: Awaited<ReturnType<Queue["getResource"]>> | undefined = undefined;
		try {
			resource = await this.getResource(decoded, meta);
		} catch (e) {
			console.error(util.inspect(e, false, Infinity, true));
			sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildID, encodedTrack: meta.track, reason: "LOAD_FAILED" }, this.clientID);
		}
		if (!resource) return;
		if (this.actions.applyingFilters) {
			resource.playStream.destroy();
			return;
		}
		this.resource = resource;
		if (meta.pause) this.actions.trackPausing = true;
		this.player.play(resource);
		if (meta.volume && meta.volume !== 100) this.volume(meta.volume / 100);
		else if (this.actions.volume !== 1.0) this.volume(this.actions.volume);
		try {
			await Util.waitForResourceToEnterState(this.player, Discord.AudioPlayerStatus.Playing, lavalinkConfig.lavalink.server.trackStuckThresholdMs);
			this.actions.shouldntCallFinish = false;
			this.actions.stopping = false;
		} catch {
			// If the track isn't the same track as before it started waiting (i.e. skipped) then you shouldn't say that it got stuck lol.
			if (this.track !== meta) return;
			// This could be a bad thing to do considering maybe the user's McWifi was just bad, but we already send track stuck and it wouldn't make sense for it to suddenly start
			// if it possibly could as in not actually stuck, just bad internet connection.
			this.stop(meta.track, true);
			// I assign the values of current, track, and stopping here because these are usually reset at player transition from not Idle => Idle
			// However, we're waiting for resource to transition from Idle => Playing, so it won't fire Idle again until another track is played.
			this.resource = null;
			sendToParent({ op: "event", type: "TrackStuckEvent", guildId: this.guildID, encodedTrack: meta.track, thresholdMs: lavalinkConfig.lavalink.server.trackStuckThresholdMs }, this.clientID);
			console.warn(`${encoding.decode(meta.track).title} got stuck! Threshold surpassed: ${lavalinkConfig.lavalink.server.trackStuckThresholdMs}`);
			this.track = undefined;
			this.actions.shouldntCallFinish = false;
			this.actions.stopping = false;
		}
	}

	public queue(track: { track: string; start: number; end: number; volume: number; pause: boolean; }) {
		this.replace(this.track?.track);
		this.track = track;
	}

	public replace(oldTrack: string | undefined) {
		if (this.player.state.status === Discord.AudioPlayerStatus.Playing && oldTrack) {
			this.stop(oldTrack, true);
			sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "REPLACED", encodedTrack: oldTrack }, this.clientID);
		}
		setImmediate(() => this.nextSong());
	}

	public pause() {
		this.actions.paused = this.player.pause(true);
	}

	public resume() {
		this.actions.paused = !this.player.unpause();
	}

	public stop(trackStopping: string, shouldntPost?: boolean) {
		if (!this.track) return;
		this.actions.stopping = true;
		this.player.stop(true);
		if (!shouldntPost) sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "STOPPED", encodedTrack: trackStopping }, this.clientID);
	}

	public destroy() {
		if (this.actions.destroyed) return;
		this.actions.destroyed = true;
		this.stop(this.track?.track || "unknown", true);
		this.track = undefined;
		this.connection.destroy(true);
		queues.delete(`${this.clientID}.${this.guildID}`);
		websocket.onPlayerDelete(this.clientID, this.guildID);
	}

	public volume(amount: number) {
		this.actions.volume = amount;
		this.resource?.volume?.setVolume(amount);
	}

	public seek(amount: number) {
		if (!this.track) return;
		const previousIndex = this._filters.indexOf("-ss");
		if (previousIndex !== -1) this._filters.splice(previousIndex, 2);
		this._filters.push("-ss", `${amount || 0}ms`);
		if (!this.actions.applyingFilters) this.play().catch(e => console.error(util.inspect(e, false, Infinity, true)));
		this.actions.applyingFilters = true;
		this.actions.seekTime = amount;
	}

	public async filters(filters: Filters) {
		if (!this.track) return;
		Util.mixin(this.filtersObject, filters);
		const toApply: Array<string> = [];
		if (this._filters.includes("-ss")) toApply.push(...this._filters.splice(this._filters.indexOf("-ss"), 2));
		this._filters.length = 0;
		if (filters.volume) toApply.push(`volume=${filters.volume}`);
		if (filters.equalizer && Array.isArray(filters.equalizer) && filters.equalizer.length) {
			const bandSettings = Array(15).map((_, index) => ({ band: index, gain: 0.2 }));
			for (const eq of filters.equalizer) {
				const cur = bandSettings.find(i => i.band === eq.band);
				if (cur) cur.gain = eq.gain;
			}
			toApply.push(bandSettings.map(i => `equalizer=width_type=h:gain=${Math.round(Math.log2(i.gain) * 12)}`).join(","));
		}
		if (filters.timescale) {
			const rate = filters.timescale.rate || 1.0;
			const pitch = filters.timescale.pitch || 1.0;
			const speed = filters.timescale.speed || 1.0;
			this.actions.rate = speed;
			const speeddif = 1.0 - pitch;
			const finalspeed = speed + speeddif;
			const ratedif = 1.0 - rate;
			toApply.push(`asetrate=48000*${pitch + ratedif},atempo=${finalspeed},aresample=48000`);
		}
		if (filters.tremolo) toApply.push(`tremolo=f=${filters.tremolo.frequency || 2.0}:d=${filters.tremolo.depth || 0.5}`);
		if (filters.vibrato) toApply.push(`vibrato=f=${filters.vibrato.frequency || 2.0}:d=${filters.vibrato.depth || 0.5}`);
		if (filters.rotation) toApply.push(`apulsator=hz=${filters.rotation.rotationHz || 0}`);
		if (filters.lowPass) toApply.push(`lowpass=f=${500 / filters.lowPass.smoothing}`);

		this._filters.push(...toApply);
		const previouslyApplying = this.actions.applyingFilters;
		this.actions.applyingFilters = true;
		if (!previouslyApplying) this.play().catch(e => console.error(util.inspect(e, false, Infinity, true)));
	}
}

function voiceAdapterCreator(userID: string, guildID: string): Discord.DiscordGatewayAdapterCreator {
	const key = `${userID}.${guildID}`;
	return methods => {
		methodMap.set(key, methods);
		return {
			sendPayload: payload => {
				return !!payload;
			},
			destroy: () => {
				methodMap.delete(key);
			}
		};
	};
}

export function onPlayerUpdate(clientID: string, guildID: string, data: UpdatePlayerData, noReplace = false): UpdatePlayerResult {
	const key = `${clientID}.${guildID}`;
	let q: Queue;
	if (!queues.has(key)) {
		// Channel IDs are never forwarded to LavaLink and are not really necessary in code except for in the instance of sending packets which isn't applicable.
		Discord.joinVoiceChannel({ channelId: "", guildId: guildID, group: clientID, adapterCreator: voiceAdapterCreator(clientID, guildID) });
		q = new Queue(clientID, guildID);
		queues.set(key, q);
	} else q = queues.get(key)!;

	if (data.voice) {
		const methods = methodMap.get(`${clientID}.${guildID}`);
		if (!methods) throw new Error("NO_METHODS"); // should:tm: never happen
		methods.onVoiceStateUpdate({ channel_id: "", guild_id: guildID, user_id: clientID, session_id: data.voice.sessionId, deaf: false, self_deaf: false, mute: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null });
		methods.onVoiceServerUpdate({ guild_id: guildID, token: data.voice.token, endpoint: data.voice.endpoint });
	}

	const withEncoded = data as Exclude<typeof data, { identifier?: string }>; // In the route, identifier searching is done and deleted from pl
	const track = withEncoded.encodedTrack;

	if (track !== undefined) {
		if (!track && q.track) q.stop(q.track.track);
		if (track) {
			if (noReplace && q.track) console.log("Skipping play request because of noReplace");
			else q.queue({ track: track, start: Number(withEncoded.position || "0"), end: Number(withEncoded.endTime || "0"), volume: Number(withEncoded.volume || "100"), pause: withEncoded.paused || false });
		}
	}
	if (data.volume !== undefined) {
		if (q.player.state.status === Discord.AudioPlayerStatus.Playing || q.player.state.status === Discord.AudioPlayerStatus.Paused) q.volume(data.volume);
		else q.actions.volume = data.volume;
	}
	if (data.paused !== undefined) {
		if (q.player.state.status === Discord.AudioPlayerStatus.Playing && data.paused) q.pause();
		else if (q.player.state.status === Discord.AudioPlayerStatus.Paused && !data.paused) q.resume();
		else q.actions.trackPausing = data.paused;
	}
	if (data.position !== undefined) q.seek(data.position);
	if (data.filters) q.filters(data.filters);
	if (data.endTime !== undefined && q.track) q.track.end = data.endTime;

	const decodedTrack = q.track ? encoding.decode(q.track.track) : undefined;

	return {
		guildId: q.guildID,
		track: decodedTrack ? {
			encoded: q.track!.track,
			info: {
				identifier: decodedTrack.identifier,
				isSeekable: !decodedTrack.isStream,
				author: decodedTrack.author,
				length: Number(decodedTrack.length),
				isStream: decodedTrack.isStream,
				position: Number(decodedTrack.position),
				title: decodedTrack.title,
				uri: decodedTrack.uri,
				sourceName: decodedTrack.source
			}
		} : null,
		volume: q.actions.volume,
		paused: q.actions.paused,
		filters: q.filtersObject,
		voice: {
			// @ts-expect-error
			token: q.connection.packets.server?.token ?? "",
			// @ts-expect-error
			endpoint: q.connection.packets.server?.endpoint ?? "",
			// @ts-expect-error
			sessionId: q.connection.packets.state?.session_id ?? "",
			connected: q.state.connected,
			ping: q.state.ping
		}
	};
}

export default { queues, Queue, onPlayerUpdate };
