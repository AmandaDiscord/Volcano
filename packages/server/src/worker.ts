import util from "node:util";
import { Readable } from "node:stream";
import { parentPort } from "node:worker_threads";

import * as Discord from "@discordjs/voice";
import * as encoding from "volcano-encoding";

import "./util/Logger.js";
import Constants from "./Constants.js";
import Util from "./util/Util.js";
import { Transcoder } from "./util/Transcoder.js";
import { lavalinkConfig } from "./loaders/config.js";

import type { PlayerState, Filters } from "lavalink-types/v4.js";
import type { ReadableStream } from "node:stream/web";
import type { InternalMessage } from "./loaders/websocket.js";

if (!parentPort) throw new Error("worker.js is an audio thread. ThreadPool spawns it");
const port = parentPort;

process.on("unhandledRejection", e => console.error(util.inspect(e, false, Infinity, true)));
process.on("uncaughtException", (e, origin) => console.error(`${util.inspect(e, false, Infinity, true)}\n${util.inspect(origin)}`));

const queues = new Map<string, Queue>();

export type QueueTrack = { track: string; start: number; end: number; pause: boolean; userData: Record<string, unknown> };

export type PlayerUpdate = {
	encodedTrack?: string | null;
	userData?: Record<string, unknown>;
	position?: number;
	endTime?: number | null;
	volume?: number;
	paused?: boolean;
	filters?: Filters;
	voice?: { token: string; endpoint: string; sessionId: string; channelId?: string };
};
export type PlayerResponse = ReturnType<typeof playerResponse>;
export type ThreadStats = { playingPlayers: number; pings: Record<string, number>; frames: Record<string, [number, number]> };
type StreamReply = { op: "stream"; id: number; stream?: ReadableStream; type?: string; filters?: Array<string>; error?: Error };

export type ParentMessage =
	| { op: "update"; id: number; clientID: string; guildID: string; update: PlayerUpdate; noReplace: boolean }
	| { op: "get" | "destroy"; id: number; key: string }
	| { op: "stats"; id: number }
	| StreamReply;

export type ThreadMessage =
	| { op: "reply"; id: number; data?: unknown; error?: Error }
	| { op: "event"; clientID: string; data: InternalMessage }
	| { op: "stream"; id: number; decoded: import("volcano-encoding").TrackInfo; useFFMPEG: boolean; filters: Array<string> };

const equalizerBands = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const methodMap = new Map<string, Discord.DiscordGatewayAdapterLibraryMethods>();
const streamRequests = new Map<number, { resolve: (reply: StreamReply) => void; reject: (e: Error) => void }>();
let lastStreamID = 0;

const post = (message: ThreadMessage) => port.postMessage(message);
const sendToParent = (data: InternalMessage, clientID: string) => post({ op: "event", clientID, data });
const toTrack = (t: QueueTrack) => Util.toTrack(t.track, t.userData);

setInterval(() => {
	if (!queues.size) return;
	for (const queue of queues.values()) {
		const state = queue.state;
		if (!queue.actions.paused) sendToParent({ op: Constants.OPCodes.PLAYER_UPDATE, guildId: queue.guildID, state }, queue.clientID);
	}
}, lavalinkConfig.lavalink.server.playerUpdateInterval * 1000);

class FrameCounter {
	public lastSent = 0;
	public lastNulled = 0;
	private minute = 0;
	private sent = 0;
	private nulled = 0;
	private playingSince = Infinity;
	private lastStarted = Infinity;
	private lastEnded = Infinity;

	public frame(sent: boolean) {
		const minute = Math.floor(Date.now() / 60000);
		if (minute !== this.minute) {
			this.lastSent = this.sent;
			this.lastNulled = this.nulled;
			this.sent = this.nulled = 0;
			this.minute = minute;
		}
		if (sent) this.sent++;
		else this.nulled++;
	}

	public started() {
		this.lastStarted = Date.now();
		// Over 100ms between tracks, or a pause, starts the wait for a full minute again
		if (this.lastStarted - this.lastEnded > 100 || this.playingSince === Infinity) {
			this.playingSince = this.lastStarted;
			this.lastEnded = Infinity;
		}
	}

	public ended() {
		this.lastEnded = Date.now();
	}

	/** Played without a gap through all of the last minute */
	public get usable() {
		if (this.lastEnded !== Infinity && this.lastStarted - this.lastEnded > 100) return false;
		return this.playingSince < (Math.floor(Date.now() / 60000) - 1) * 60000;
	}
}

class Queue {
	public connection: Discord.VoiceConnection;
	public clientID: string;
	public guildID: string;
	public track: QueueTrack | undefined = undefined;
	public player = Discord.createAudioPlayer({ behaviors: { noSubscriber: Discord.NoSubscriberBehavior.Play } });
	public resource: Discord.AudioResource<import("volcano-encoding").TrackInfo> | null = null;
	public actions = { initial: true, stopping: false, volume: 100, shouldntCallFinish: false, trackPausing: false, seekTime: 0, playedBase: 0, destroyed: false, rate: 1.0, paused: false };
	public _filters: Array<string> = [];
	public filtersObject: Filters = {};
	public frames = new FrameCounter();
	private loads = 0;

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

		this.player.on("stateChange", (oldState, newState) => {
			if (newState.status === Discord.AudioPlayerStatus.Playing) this.frames.started();
			else if (newState.status === Discord.AudioPlayerStatus.Idle || newState.status === Discord.AudioPlayerStatus.Paused) this.frames.ended();
			if (newState.status === Discord.AudioPlayerStatus.Idle && oldState.status !== Discord.AudioPlayerStatus.Idle) {
				const ended = this.track;
				this.resource = null;
				this.track = undefined;
				this.actions.seekTime = this.actions.playedBase = 0;
				// Do not log if stopping. Queue.stop will send its own STOPPED reason instead of FINISHED. Do not log if shouldntCallFinish obviously.
				if (ended && !this.actions.stopping && !this.actions.shouldntCallFinish) sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "finished", track: toTrack(ended) }, this.clientID);
				this.actions.stopping = false;
				this.actions.shouldntCallFinish = false;
			} else if (newState.status === Discord.AudioPlayerStatus.Playing && oldState.status !== Discord.AudioPlayerStatus.Paused && oldState.status !== Discord.AudioPlayerStatus.AutoPaused) {
				if (this.actions.trackPausing) this.pause();
				this.actions.trackPausing = false;
				if ((!this.actions.shouldntCallFinish || this.actions.initial) && this.track) sendToParent({ op: "event", type: "TrackStartEvent", guildId: this.guildID, track: toTrack(this.track) }, this.clientID);
				this.actions.initial = false;
			}
		});

		this.player.on("error", (error) => {
			if (this.track) sendToParent({ op: "event", type: "TrackExceptionEvent", guildId: this.guildID, track: toTrack(this.track), exception: { message: error.message, severity: "common", cause: error.stack ?? new Error().stack ?? "unknown" } }, this.clientID);
		});
	}

	public get position() {
		return Math.floor(this.actions.seekTime + ((this.resource?.playbackDuration ?? 0) - this.actions.playedBase) * this.actions.rate);
	}

	public get state(): PlayerState {
		const position = this.position;
		if (this.track?.end && position >= this.track.end) this.stop(this.track, true);
		return {
			time: Date.now(),
			position: position,
			connected: this.connection.state.status === Discord.VoiceConnectionStatus.Ready,
			ping: this.connection.ping.ws ?? -1
		};
	}

	public nextSong() {
		this.actions.seekTime = 0;
		this.actions.playedBase = 0;
		this.actions.initial = true;
		if (!this.track) return;
		this.play().catch(e => console.error(util.inspect(e, false, Infinity, true)));
	}

	public async getResource(decoded: import("volcano-encoding").TrackInfo, start: number): Promise<Discord.AudioResource<import("volcano-encoding").TrackInfo>> {
		const result = await requestStream(decoded, !!this._filters.length || !!start, this._filters);
		if (result.filters) this._filters = result.filters;

		const stream = new Transcoder(Readable.fromWeb(result.stream!), {
			filters: this._filters,
			start,
			volume: this.actions.volume / 100,
			raw: result.type === Discord.StreamType.Raw,
			quality: lavalinkConfig.lavalink.server.opusEncodingQuality
		});
		const resource = Discord.createAudioResource(stream, { metadata: decoded, inputType: Discord.StreamType.Opus });
		const read = resource.read.bind(resource);
		resource.read = () => {
			const frame = read();
			this.frames.frame(!!frame);
			return frame;
		};
		return resource;
	}

	public async play(start = this.track?.start ?? 0) {
		if (!this.track) return;

		const meta = this.track;
		const load = ++this.loads;
		const decoded = encoding.decode(meta.track);
		if (!decoded.uri) return;
		let resource: Awaited<ReturnType<Queue["getResource"]>> | undefined = undefined;
		try {
			resource = await this.getResource(decoded, start);
		} catch (e) {
			console.error(util.inspect(e, false, Infinity, true));
			if (this.track === meta && load === this.loads) sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildID, track: toTrack(meta), reason: "loadFailed" }, this.clientID);
		}
		if (!resource) return;
		if (this.track !== meta || load !== this.loads) { // stopped, replaced or seeked again while loading
			resource.playStream.destroy();
			return;
		}
		this.resource = resource;
		this.actions.seekTime = start;
		this.actions.playedBase = 0;
		if (this.actions.initial ? meta.pause : this.actions.paused) this.actions.trackPausing = true;
		// A seek swaps the resource without going idle, which would otherwise look like a new track starting
		this.actions.shouldntCallFinish = !this.actions.initial;
		this.player.play(resource);
		this.volume(this.actions.volume);
		try {
			await Util.waitForResourceToEnterState(this.player, Discord.AudioPlayerStatus.Playing, lavalinkConfig.lavalink.server.trackStuckThresholdMs);
			this.actions.shouldntCallFinish = false;
			this.actions.stopping = false;
		} catch {
			// If the track isn't the same track as before it started waiting (i.e. skipped) then you shouldn't say that it got stuck lol.
			if (this.track !== meta || load !== this.loads) return;
			// This could be a bad thing to do considering maybe the user's McWifi was just bad, but we already send track stuck and it wouldn't make sense for it to suddenly start
			// if it possibly could as in not actually stuck, just bad internet connection.
			this.stop(meta, true);
			// I assign the values of current, track, and stopping here because these are usually reset at player transition from not Idle => Idle
			// However, we're waiting for resource to transition from Idle => Playing, so it won't fire Idle again until another track is played.
			this.resource = null;
			sendToParent({ op: "event", type: "TrackStuckEvent", guildId: this.guildID, track: toTrack(meta), thresholdMs: lavalinkConfig.lavalink.server.trackStuckThresholdMs }, this.clientID);
			console.warn(`${encoding.decode(meta.track).title} got stuck! Threshold surpassed: ${lavalinkConfig.lavalink.server.trackStuckThresholdMs}`);
			this.track = undefined;
			this.actions.shouldntCallFinish = false;
			this.actions.stopping = false;
		}
	}

	public queue(track: QueueTrack) {
		this.replace(this.track);
		this.track = track;
	}

	public replace(oldTrack: QueueTrack | undefined) {
		if (this.player.state.status !== Discord.AudioPlayerStatus.Idle && oldTrack) {
			this.stop(oldTrack, true);
			sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "replaced", track: toTrack(oldTrack) }, this.clientID);
		}
		setImmediate(() => this.nextSong());
	}

	public pause() {
		this.actions.paused = this.player.pause(true);
	}

	public resume() {
		this.actions.paused = !this.player.unpause();
	}

	public stop(trackStopping: QueueTrack | undefined, shouldntPost?: boolean) {
		if (!this.track) return;
		this.actions.stopping = true;
		this.player.stop(true);
		if (!shouldntPost && trackStopping) sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "stopped", track: toTrack(trackStopping) }, this.clientID);
	}

	public destroy() {
		if (this.actions.destroyed) return;
		this.actions.destroyed = true;
		this.stop(this.track, true);
		this.track = undefined;
		this.connection.destroy(true);
		queues.delete(`${this.clientID}.${this.guildID}`);
	}

	public volume(amount: number) {
		this.actions.volume = amount;
		if (this.resource?.playStream instanceof Transcoder) this.resource.playStream.volume = amount / 100;
	}

	public seek(amount: number) {
		if (!this.track) return;
		this.play(Math.max(num(amount, 0), 0)).catch(e => console.error(util.inspect(e, false, Infinity, true)));
	}

	public filters(filters: Filters) {
		this.filtersObject = filters;
		const toApply: Array<string> = [];
		let rate = 1.0;
		const smoothing = num(filters.lowPass?.smoothing, 20);

		if (filters.lowPass && smoothing > 1) toApply.push(`lowpass=f=${Math.round(-48000 * Math.log(1 - 1 / smoothing) / (2 * Math.PI))}:p=1`);
		if (filters.channelMix) {
			const mix = filters.channelMix;
			toApply.push(`pan=stereo|c0=${num(mix.leftToLeft, 1)}*c0+${num(mix.rightToLeft, 0)}*c1|c1=${num(mix.leftToRight, 0)}*c0+${num(mix.rightToRight, 1)}*c1`);
		}
		if (filters.rotation?.rotationHz) toApply.push(`apulsator=hz=${num(filters.rotation.rotationHz, 0)}`);
		if (filters.distortion) {
			const d = filters.distortion;
			const fn = (name: string, offset: number | undefined, scale: number | undefined) => `(${num(offset, 0)}+${name}(val(ch)*${num(scale, 1)}))`;
			toApply.push(`aeval='clip(${num(d.offset, 0)}+${num(d.scale, 1)}*${fn("sin", d.sinOffset, d.sinScale)}*${fn("cos", d.cosOffset, d.cosScale)}*${fn("tan", d.tanOffset, d.tanScale)},-1,1)':c=same`);
		}
		if (filters.vibrato) toApply.push(`vibrato=f=${num(filters.vibrato.frequency, 2.0)}:d=${num(filters.vibrato.depth, 0.5)}`);
		if (filters.tremolo) toApply.push(`tremolo=f=${num(filters.tremolo.frequency, 2.0)}:d=${num(filters.tremolo.depth, 0.5)}`);
		if (filters.timescale) {
			const speed = num(filters.timescale.speed, 1.0);
			const pitch = num(filters.timescale.pitch, 1.0);
			const resample = num(filters.timescale.rate, 1.0);
			rate = speed * resample;
			toApply.push(`asetrate=48000*${pitch * resample},aresample=48000,atempo=${Math.max(speed / pitch, 0.5)}`);
		}
		if (filters.karaoke) {
			const k = filters.karaoke;
			const level = num(k.level, 1.0);
			toApply.push(`asplit[kin][kmid];[kin]pan=stereo|c0=c0-${level}*c1|c1=c1-${level}*c0[kside];[kmid]pan=mono|c0=0.5*c0+0.5*c1,bandpass=f=${num(k.filterBand, 220.0)}:width_type=h:w=${num(k.filterWidth, 100.0)},volume=${num(k.monoLevel, 1.0) * level},pan=stereo|c0=c0|c1=c0[kbass];[kside][kbass]amix=inputs=2:normalize=0`);
		}
		if (Array.isArray(filters.equalizer)) {
			for (const { band, gain } of filters.equalizer) {
				if (num(gain, 0) && equalizerBands[band]) toApply.push(`equalizer=f=${equalizerBands[band]}:t=o:w=1:g=${(20 * Math.log10(Math.max(1 + 4 * gain, 0.001))).toFixed(2)}`);
			}
		}
		if (filters.volume !== undefined) toApply.push(`volume=${Math.max(num(filters.volume, 1.0), 0)}`);

		this.actions.seekTime = this.position;
		this.actions.playedBase = this.resource?.playbackDuration ?? 0;
		this.actions.rate = rate;
		this._filters = toApply;
		if (this.resource?.playStream instanceof Transcoder) this.resource.playStream.filters = toApply;
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

function onPlayerUpdate(clientID: string, guildID: string, data: PlayerUpdate, noReplace = false): Queue {
	const key = `${clientID}.${guildID}`;
	let q: Queue;
	if (!queues.has(key)) {
		// The channel ID arrives with the voice state below.
		Discord.joinVoiceChannel({ channelId: "", guildId: guildID, group: clientID, adapterCreator: voiceAdapterCreator(clientID, guildID) });
		q = new Queue(clientID, guildID);
		queues.set(key, q);
	} else q = queues.get(key)!;

	if (data.voice) {
		const methods = methodMap.get(`${clientID}.${guildID}`);
		if (!methods) throw new Error("NO_METHODS"); // should:tm: never happen
		methods.onVoiceStateUpdate({ channel_id: data.voice.channelId ?? "", guild_id: guildID, user_id: clientID, session_id: data.voice.sessionId, deaf: false, self_deaf: false, mute: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null });
		methods.onVoiceServerUpdate({ guild_id: guildID, token: data.voice.token, endpoint: data.voice.endpoint });
	}

	const track = data.encodedTrack;

	if (track !== undefined) {
		if (!track && q.track) q.stop(q.track);
		if (track) {
			if (noReplace && q.track) console.log("Skipping play request because of noReplace");
			else q.queue({ track, start: Number(data.position ?? 0), end: Number(data.endTime ?? 0), pause: data.paused ?? q.actions.paused, userData: data.userData ?? {} });
		}
	}
	if (data.volume !== undefined) q.volume(data.volume);
	if (data.paused !== undefined) {
		if (q.player.state.status === Discord.AudioPlayerStatus.Playing && data.paused) q.pause();
		else if (q.player.state.status === Discord.AudioPlayerStatus.Paused && !data.paused) q.resume();
		else {
			q.actions.trackPausing = data.paused;
			q.actions.paused = data.paused;
		}
	}
	// A new track starts at the position instead
	if (data.position !== undefined && track === undefined) q.seek(data.position);
	if (data.filters) q.filters(data.filters);
	if (data.endTime !== undefined && q.track) q.track.end = data.endTime ?? 0;

	return q;
}

function playerResponse(q: Queue) {
	// @ts-expect-error packets is private
	const packets = q.connection.packets as { server?: { token?: string; endpoint?: string }; state?: { session_id?: string } };
	return {
		guildId: q.guildID,
		track: q.track ? Util.toTrack(q.track.track, q.track.userData) : null,
		volume: q.actions.volume,
		paused: q.actions.paused,
		state: q.state,
		voice: {
			token: packets.server?.token ?? "",
			endpoint: packets.server?.endpoint ?? "",
			sessionId: packets.state?.session_id ?? "",
			channelId: q.connection.joinConfig.channelId || null
		},
		filters: q.filtersObject
	};
}

function requestStream(decoded: import("volcano-encoding").TrackInfo, useFFMPEG: boolean, filters: Array<string>) {
	const id = ++lastStreamID;
	post({ op: "stream", id, decoded, useFFMPEG, filters });
	return new Promise<StreamReply>((resolve, reject) => streamRequests.set(id, { resolve, reject }));
}

function handle(msg: Exclude<ParentMessage, StreamReply>) {
	switch (msg.op) {
	case "update": return playerResponse(onPlayerUpdate(msg.clientID, msg.guildID, msg.update, msg.noReplace));
	case "get": {
		const q = queues.get(msg.key);
		return q ? playerResponse(q) : null;
	}
	case "destroy": return queues.get(msg.key)?.destroy();
	case "stats": {
		const stats: ThreadStats = { playingPlayers: 0, pings: {}, frames: {} };
		for (const [key, q] of queues) {
			stats.pings[q.guildID] = q.connection.ping.ws ?? -1;
			if (!q.track || q.actions.paused) continue;
			stats.playingPlayers++;
			if (q.frames.usable) stats.frames[key] = [q.frames.lastSent, q.frames.lastNulled];
		}
		return stats;
	}
	}
}

port.on("message", (msg: ParentMessage) => {
	if (msg.op === "stream") {
		const request = streamRequests.get(msg.id);
		streamRequests.delete(msg.id);
		if (msg.error) request?.reject(msg.error);
		else request?.resolve(msg);
		return;
	}
	try {
		post({ op: "reply", id: msg.id, data: handle(msg) });
	} catch (e) {
		post({ op: "reply", id: msg.id, error: e instanceof Error ? e : new Error(String(e)) });
	}
});
