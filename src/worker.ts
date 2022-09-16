import { parentPort as parentport, threadId } from "worker_threads";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import util from "util";

import * as Discord from "@discordjs/voice";
import * as encoding from "@lavalink/encoding";
import prism from "prism-media";
import yaml from "yaml";

if (!parentport) throw new Error("THREAD_IS_PARENT");
const parentPort = parentport;

import Constants from "./Constants.js";
import logger from "./util/Logger.js";
import Util from "./util/Util.js";
const configDir: string = path.join(process.cwd(), "./application.yml");
let cfgparsed: import("./types.js").LavaLinkConfig;

if (fs.existsSync(configDir)) {
	const cfgyml: string = fs.readFileSync(configDir, { encoding: Constants.STRINGS.UTF8 });
	cfgparsed = yaml.parse(cfgyml);
} else cfgparsed = {};

global.lavalinkConfig = Util.mixin({}, Constants.defaultOptions, cfgparsed) as typeof Constants.defaultOptions;
import * as lamp from "play-dl";

const queues = new Map<string, Queue>();
const methodMap = new Map<string, import("@discordjs/voice").DiscordGatewayAdapterLibraryMethods>();

const reportInterval = setInterval(() => {
	if (!queues.size) return;
	for (const queue of queues.values()) {
		const state = queue.state;
		if (!queue.actions.paused) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.OPCodes.PLAYER_UPDATE, guildId: queue.guildID, state: state }, clientID: queue.clientID });
	}
}, lavalinkConfig.lavalink.server.playerUpdateInterval * 1000);

parentPort.once("close", () => clearInterval(reportInterval));

const codeReasons = {
	4001: "You sent an invalid opcode.",
	4002: "You sent a invalid payload in your identifying to the Gateway.",
	4003: "You sent a payload before identifying with the Gateway.",
	4004: "The token you sent in your identify payload is incorrect.",
	4005: "You sent more than one identify payload. Stahp.",
	4006: "Your session is no longer valid.",
	4009: "Your session has timed out.",
	4011: "We can't find the server you're trying to connect to.",
	4012: "We didn't recognize the protocol you sent.",
	4014: "Channel was deleted, you were kicked, voice server changed, or the main gateway session was dropped. Should not reconnect.",
	4015: "The server crashed. Our bad! Try resuming.",
	4016: "We didn't recognize your encryption."
};

const plugins: Array<import("./types.js").Plugin> = [];

const dirname = fileURLToPath(path.dirname(import.meta.url));
const keyDir = path.join(dirname, "../soundcloud.txt");

async function keygen() {
	const clientID = await lamp.getFreeClientID();
	if (!clientID) throw new Error("SOUNDCLOUD_KEY_NO_CREATE");
	fs.writeFileSync(keyDir, clientID, { encoding: Constants.STRINGS.UTF8 });
	lamp.setToken({ soundcloud : { client_id : clientID } });
}

if (fs.existsSync(keyDir)) {
	if (Date.now() - fs.statSync(keyDir).mtime.getTime() >= (1000 * 60 * 60 * 24 * 7)) keygen();
	else {
		const APIKey = fs.readFileSync(keyDir, { encoding: Constants.STRINGS.UTF8 });
		await lamp.setToken({ soundcloud: { client_id: APIKey } });
	}
} else await keygen();

await lamp.setToken({ useragent: [Constants.fakeAgent] });
if (lavalinkConfig.lavalink.server.youtubeCookie) await lamp.setToken({ youtube: { cookie: lavalinkConfig.lavalink.server.youtubeCookie } });

// This is a proper rewrite of entersState. entersState does some weird stuff with Node internal methods which could lead to
// events never firing and causing the thread to be locked and cause abort errors somehow.
function waitForResourceToEnterState(resource: Discord.VoiceConnection, status: Discord.VoiceConnectionStatus, timeoutMS: number): Promise<void>;
function waitForResourceToEnterState(resource: Discord.AudioPlayer, status: Discord.AudioPlayerStatus, timeoutMS: number): Promise<void>;
function waitForResourceToEnterState(resource: Discord.VoiceConnection | Discord.AudioPlayer, status: Discord.VoiceConnectionStatus | Discord.AudioPlayerStatus, timeoutMS: number): Promise<void> {
	return new Promise((res, rej) => {
		if (resource.state.status === status) res(void 0);
		let timeout: NodeJS.Timeout | undefined = undefined;
		function onStateChange(_oldState: Discord.VoiceConnectionState | Discord.AudioPlayerState, newState: Discord.VoiceConnectionState | Discord.AudioPlayerState) {
			if (newState.status !== status) return;
			if (timeout) clearTimeout(timeout);
			(resource as Discord.AudioPlayer).removeListener(Constants.STRINGS.STATE_CHANGE, onStateChange);
			return res(void 0);
		}
		(resource as Discord.AudioPlayer).on(Constants.STRINGS.STATE_CHANGE, onStateChange);
		timeout = setTimeout(() => {
			(resource as Discord.AudioPlayer).removeListener(Constants.STRINGS.STATE_CHANGE, onStateChange);
			rej(new Error("Didn't enter state in time"));
		}, timeoutMS);
	});
}

class Queue {
	public connection: import("@discordjs/voice").VoiceConnection;
	public clientID: string;
	public guildID: string;
	public track: { track: string; start: number; end: number; volume: number; pause: boolean } | undefined = undefined;
	public player = Discord.createAudioPlayer();
	public resource: import("@discordjs/voice").AudioResource<import("@lavalink/encoding").TrackInfo> | null = null;
	public actions = { initial: true, stopping: false, volume: 1.0, applyingFilters: false, shouldntCallFinish: false, trackPausing: false, seekTime: 0, destroyed: false, rate: 1.0, paused: false };
	public _filters: Array<string> = [];

	public constructor(clientID: string, guildID: string) {
		this.connection = Discord.getVoiceConnection(guildID, clientID)!;
		this.connection.subscribe(this.player);
		this.clientID = clientID;
		this.guildID = guildID;

		this.connection.on(Constants.STRINGS.STATE_CHANGE, async (_oldState, newState) => {
			if (newState.status === Discord.VoiceConnectionStatus.Disconnected) {
				try {
					await Promise.race([
						waitForResourceToEnterState(this.connection, Discord.VoiceConnectionStatus.Signalling, 5000),
						waitForResourceToEnterState(this.connection, Discord.VoiceConnectionStatus.Connecting, 5000)
					]);
				} catch {
					if (newState.reason === Discord.VoiceConnectionDisconnectReason.WebSocketClose) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.WEBSOCKET_CLOSE_EVENT, guildId: this.guildID, code: newState.closeCode, reason: codeReasons[newState.closeCode], byRemote: true }, clientID: this.clientID });
				}
			} else if (newState.status === Discord.VoiceConnectionStatus.Destroyed && !this.actions.destroyed) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.WEBSOCKET_CLOSE_EVENT, guildId: this.guildID, code: 4000, reason: "IDK what happened. All I know is that the connection was destroyed prematurely", byRemote: true }, clientID: this.clientID });
			else if (newState.status === Discord.VoiceConnectionStatus.Connecting || newState.status === Discord.VoiceConnectionStatus.Signalling) {
				try {
					await waitForResourceToEnterState(this.connection, Discord.VoiceConnectionStatus.Ready, Constants.VoiceConnectionConnectThresholdMS);
				} catch {
					parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.WEBSOCKET_CLOSE_EVENT, guildId: this.guildID, code: 4000, reason: `Couldn't connect in time (${Constants.VoiceConnectionConnectThresholdMS}ms)`, byRemote: false }, clientID: this.clientID });
				}
			}
		});

		this.player.on(Constants.STRINGS.STATE_CHANGE, async (oldState, newState) => {
			if (newState.status === Discord.AudioPlayerStatus.Idle && oldState.status !== Discord.AudioPlayerStatus.Idle) {
				this.resource = null;
				this.track = undefined;
				// Do not log if stopping. Queue.stop will send its own STOPPED reason instead of FINISHED. Do not log if shouldntCallFinish obviously.
				if (!this.actions.stopping && !this.actions.shouldntCallFinish) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.TRACK_END_EVENT, guildId: this.guildID, reason: Constants.STRINGS.FINISHED }, clientID: this.clientID });
				this.actions.stopping = false;
				this.actions.shouldntCallFinish = false;
			} else if (newState.status === Discord.AudioPlayerStatus.Playing && oldState.status !== Discord.AudioPlayerStatus.Paused) {
				if (this.actions.trackPausing) this.pause();
				this.actions.trackPausing = false;
				if ((!this.actions.shouldntCallFinish || this.actions.initial) && this.track) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.TRACK_START_EVENT, guildId: this.guildID, track: this.track.track }, clientID: this.clientID });
				this.actions.initial = false;
			}
		});

		this.player.on("error", (error) => {
			parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.TRACK_EXCEPTION_EVENT, guildId: this.guildID, track: this.track?.track || Constants.STRINGS.UNKNOWN, exception: error.name, message: error.message, severity: Constants.STRINGS.COMMON, cause: error.stack || new Error().stack || Constants.STRINGS.UNKNOWN }, clientID: this.clientID });
		});
	}

	public get state() {
		const position = Math.floor(((this.resource?.playbackDuration || 0) + this.actions.seekTime) * this.actions.rate);
		if (this.track && this.track.end && position >= this.track.end) this.stop(true);
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
		this.play().catch(e => logger.error(util.inspect(e, true, Infinity, true), `worker ${threadId}`));
	}

	public async getResource(decoded: import("@lavalink/encoding").TrackInfo, meta: NonNullable<typeof this.track>): Promise<import("@discordjs/voice").AudioResource<import("@lavalink/encoding").TrackInfo>> {
		if (lavalinkConfig.lavalink.server.sources[decoded.source] !== undefined && !lavalinkConfig.lavalink.server.sources[decoded.source]) throw new Error(`${decoded.source.toUpperCase()}_NOT_ENABLED`);

		let output: import("stream").Readable | null = null;
		let streamType: import("@discordjs/voice").StreamType | undefined = undefined;

		const useFFMPEG = !!this._filters.length || !!meta.start;

		const found = plugins.find(p => p.source === decoded.source);
		if (found) {
			const result = await found.streamHandler?.(decoded, useFFMPEG);
			if (result) {
				output = result.stream;
				streamType = result.type;
			}
		} else throw new Error(`${decoded.source.toUpperCase()}_NOT_IMPLEMENTED`);

		if (!output) throw new Error(`NO_OUTPUT_TYPE_${decoded.source.toUpperCase()}_FILTERS_${String(!!this._filters.length).toUpperCase()}_PREVIOUS_${String(!this.actions.initial).toUpperCase()}`);

		if (useFFMPEG) {
			this.actions.shouldntCallFinish = true;
			const toApply = ["-analyzeduration", Constants.STRINGS.ZERO, "-loglevel", Constants.STRINGS.ZERO, "-f", Constants.STRINGS.S16LE, "-ar", "48000", "-ac", "2"];
			if (this.state.position && !this._filters.includes(Constants.STRINGS.SEARCH_STRING)) {
				toApply.unshift(Constants.STRINGS.SEARCH_STRING, `${this.state.position + 2000}ms`);
				this.actions.seekTime = this.state.position + 2000;
			} else if (this._filters.includes(Constants.STRINGS.SEARCH_STRING)) { // came from Queue.seek option. this.seekTime should be set already.
				const index = this._filters.indexOf(Constants.STRINGS.SEARCH_STRING);
				const ss = this._filters.splice(index, 2);
				toApply.unshift(...ss);
			} else if (meta.start) { // obv prefer user's pref then fallback to if the track specified a startTime
				this.actions.seekTime = meta.start;
				toApply.unshift(Constants.STRINGS.SEARCH_STRING, `${meta.start}ms`);
			}
			// _filters should no longer have -ss if there are other filters, then push the audio filters flag
			if (this._filters.length) toApply.push(Constants.STRINGS.AUDIO_FILTERS, ...this._filters);
			this.actions.applyingFilters = false;
			const pipes: Array<import("stream").Readable> = [output, new prism.FFmpeg({ args: toApply }), new prism.VolumeTransformer({ type: Constants.STRINGS.S16LE }), new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 })];
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
			logger.error(util.inspect(e, true, Infinity, true), `worker ${threadId}`);
			parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.TRACK_EXCEPTION_EVENT, guildId: this.guildID, track: this.track?.track || Constants.STRINGS.UNKNOWN, exception: e.name, message: e.message, severity: Constants.STRINGS.COMMON, cause: e.stack || new Error().stack || Constants.STRINGS.UNKNOWN }, clientID: this.clientID });
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
		const track = this.track;
		try {
			await waitForResourceToEnterState(this.player, Discord.AudioPlayerStatus.Playing, lavalinkConfig.lavalink.server.trackStuckThresholdMs);
			this.actions.shouldntCallFinish = false;
			this.actions.stopping = false;
		} catch {
			// If the track isn't the same track as before it started waiting (i.e. skipped) then you shouldn't say that it got stuck lol.
			if (this.track !== track) return;
			// This could be a bad thing to do considering maybe the user's McWifi was just bad, but we already send track stuck and it wouldn't make sense for it to suddenly start
			// if it possibly could as in not actually stuck, just bad internet connection.
			this.stop(true);
			// I assign the values of current, track, and stopping here because these are usually reset at player transition from not Idle => Idle
			// However, we're waiting for resource to transition from Idle => Playing, so it won't fire Idle again until another track is played.
			this.resource = null;
			parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.TRACK_STUCK_EVENT, guildId: this.guildID, track: track.track || Constants.STRINGS.UNKNOWN, thresholdMs: lavalinkConfig.lavalink.server.trackStuckThresholdMs }, clientID: this.clientID });
			logger.warn(`${track.track ? encoding.decode(track.track).title : Constants.STRINGS.UNKNOWN} got stuck! Threshold surpassed: ${lavalinkConfig.lavalink.server.trackStuckThresholdMs}`, `worker ${threadId}`);
			this.track = undefined;
			this.actions.shouldntCallFinish = false;
			this.actions.stopping = false;
		}
	}

	public queue(track: { track: string; start: number; end: number; volume: number; pause: boolean; }) {
		this.track = track;
		this.replace();
	}

	public replace() {
		if (this.player.state.status === Discord.AudioPlayerStatus.Playing) {
			this.stop(true);
			parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.TRACK_END_EVENT, guildId: this.guildID, reason: Constants.STRINGS.REPLACED }, clientID: this.clientID });
		}
		this.nextSong();
	}

	public pause() {
		this.actions.paused = this.player.pause(true);
	}

	public resume() {
		this.actions.paused = !this.player.unpause();
	}

	public stop(shouldntPost?: boolean) {
		this.actions.stopping = true;
		this.player.stop(true);
		if (!shouldntPost) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.STRINGS.EVENT, type: Constants.STRINGS.TRACK_END_EVENT, guildId: this.guildID, reason: Constants.STRINGS.STOPPED }, clientID: this.clientID });
	}

	public destroy() {
		if (this.actions.destroyed) return;
		this.actions.destroyed = true;
		this.track = undefined;
		this.stop(true);
		this.connection.destroy(true);
		queues.delete(`${this.clientID}.${this.guildID}`);
		if (queues.size === 0) {
			clearInterval(reportInterval);
			parentPort.postMessage({ op: Constants.workerOPCodes.CLOSE });
			parentPort.close();
			parentPort.removeAllListeners();
		}
	}

	public volume(amount: number) {
		this.actions.volume = amount;
		this.resource?.volume?.setVolume(amount);
	}

	public seek(amount: number) {
		const previousIndex = this._filters.indexOf(Constants.STRINGS.SEARCH_STRING);
		if (previousIndex !== -1) this._filters.splice(previousIndex, 2);
		this._filters.push(Constants.STRINGS.SEARCH_STRING, `${amount || 0}ms`);
		if (!this.actions.applyingFilters) this.play().catch(e => logger.error(util.inspect(e, true, Infinity, true), `worker ${threadId}`));
		this.actions.applyingFilters = true;
		this.actions.seekTime = amount;
	}

	public async filters(filters: import("./types.js").PlayerFilterOptions) {
		const toApply: Array<string> = [];
		if (this._filters.includes(Constants.STRINGS.SEARCH_STRING)) toApply.push(...this._filters.splice(this._filters.indexOf(Constants.STRINGS.SEARCH_STRING), 2));
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
		for (const plugin of plugins) {
			await plugin.mutateFilters?.(this._filters, filters);
		}
		const previouslyApplying = this.actions.applyingFilters;
		this.actions.applyingFilters = true;
		if (!previouslyApplying) this.play().catch(e => logger.error(util.inspect(e, true, Infinity, true), `worker ${threadId}`));
	}

	public ffmpeg(args: Array<string>) {
		this._filters.length = 0;
		this._filters.push(...args);
		const previouslyApplying = this.actions.applyingFilters;
		this.actions.applyingFilters = true;
		if (!previouslyApplying) this.play().catch(e => logger.error(util.inspect(e, true, Infinity, true), `worker ${threadId}`));
	}
}

parentPort.on(Constants.STRINGS.MESSAGE, async (packet: { data?: import("./types.js").InboundPayload; op: typeof Constants.workerOPCodes[keyof typeof Constants.workerOPCodes], threadID: number; broadcasted?: boolean }) => {
	if (packet.op === Constants.workerOPCodes.STATS) {
		const qs = [...queues.values()];
		return parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: { playingPlayers: qs.filter(q => !q.actions.paused).length, players: queues.size, pings: qs.reduce((acc, cur) => acc[cur.guildID] = cur.state.ping, {}) }, threadID: packet.threadID });
	} else if (packet.op === Constants.workerOPCodes.MESSAGE) {
		const guildID = packet.data!.guildId;
		const userID = packet.data!.clientID!;
		const key = `${userID}.${guildID}`;
		switch (packet.data!.op) {

		case Constants.OPCodes.PLAY: {
			let q: Queue;
			if (!queues.has(key)) {
				if (packet.broadcasted) return parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: false, threadID: packet.threadID });

				// Channel IDs are never forwarded to LavaLink and are not really necessary in code except for in the instance of sending packets which isn't applicable.
				Discord.joinVoiceChannel({ channelId: Constants.STRINGS.EMPTY_STRING, guildId: guildID, group: userID, adapterCreator: voiceAdapterCreator(userID, guildID) });
				q = new Queue(userID, guildID);
				queues.set(key, q);
				parentPort.postMessage({ op: Constants.workerOPCodes.VOICE_SERVER, data: { clientID: userID, guildId: guildID } });
				q.queue({ track: packet.data!.track!, start: Number(packet.data!.startTime || Constants.STRINGS.ZERO), end: Number(packet.data!.endTime || Constants.STRINGS.ZERO), volume: Number(packet.data!.volume || Constants.STRINGS.ONE_HUNDRED), pause: packet.data!.pause || false });
			} else {
				if (packet.broadcasted) parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: true, threadID: packet.threadID });
				q = queues.get(key)!;
				if (packet.data!.noReplace === true && q.player.state.status === Discord.AudioPlayerStatus.Playing) return logger.info(Constants.STRINGS.NO_REPLACE_SKIP, `worker ${threadId}`);
				q.queue({ track: packet.data!.track!, start: Number(packet.data!.startTime || Constants.STRINGS.ZERO), end: Number(packet.data!.endTime || Constants.STRINGS.ZERO), volume: Number(packet.data!.volume || Constants.STRINGS.ONE_HUNDRED), pause: packet.data!.pause || false });
			}
			break;
		}
		case Constants.OPCodes.DESTROY: {
			queues.get(key)?.destroy();
			break;
		}
		case Constants.OPCodes.PAUSE: {
			const q = queues.get(key);
			if (packet.data!.pause) q?.pause();
			else q?.resume();
			break;
		}
		case Constants.OPCodes.STOP: {
			queues.get(key)?.stop();
			break;
		}
		case Constants.OPCodes.FILTERS: {
			queues.get(key)?.filters(packet.data!);
			break;
		}
		case Constants.OPCodes.SEEK: {
			queues.get(key)?.seek(packet.data!.position!);
			break;
		}
		case Constants.OPCodes.FFMPEG: {
			queues.get(key)?.ffmpeg(packet.data!.args!);
			break;
		}
		case Constants.OPCodes.VOLUME: {
			queues.get(key)?.volume(packet.data!.volume! / 100);
			break;
		}
		}
	} else if (packet.op === Constants.workerOPCodes.VOICE_SERVER) {
		methodMap.get(`${packet.data!.clientID}.${packet.data!.guildId}`)?.onVoiceStateUpdate({ channel_id: Constants.STRINGS.EMPTY_STRING as any, guild_id: packet.data!.guildId as any, user_id: packet.data!.clientID as any, session_id: packet.data!.sessionId!, deaf: false, self_deaf: false, mute: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null });
		methodMap.get(`${packet.data!.clientID}.${packet.data!.guildId}`)?.onVoiceServerUpdate({ guild_id: packet.data!.guildId as any, token: packet.data!.event!.token, endpoint: packet.data!.event!.endpoint });
	} else if (packet.op === Constants.workerOPCodes.DELETE_ALL) {
		const forUser = [...queues.values()].filter(q => q.clientID === packet.data!.clientID);
		parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: forUser.length, threadID: packet.threadID });
		for (const q of forUser) {
			q.destroy();
		}
	}
});

function voiceAdapterCreator(userID: string, guildID: string): import("@discordjs/voice").DiscordGatewayAdapterCreator {
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

process.on("unhandledRejection", e => logger.error(util.inspect(e, true, Infinity, true), `worker ${threadId}`));
process.on("uncaughtException", (e, origin) => logger.error(`${util.inspect(e, true, Infinity, true)}\n${util.inspect(origin)}`, `worker ${threadId}`));

// taken from https://github.com/yarnpkg/berry/blob/2cf0a8fe3e4d4bd7d4d344245d24a85a45d4c5c9/packages/yarnpkg-pnp/sources/loader/applyPatch.ts#L414-L435
// Having Experimental warning show up once is "fine" but it's also printed
// for each Worker that is created so it ends up spamming stderr.
// Since that doesn't provide any value we suppress the warning.
const originalEmit = process.emit;
// @ts-expect-error - TS complains about the return type of originalEmit.apply
process.emit = function (name, data) {
	if (name === Constants.STRINGS.WARNING && typeof data === Constants.STRINGS.OBJECT && data.name === Constants.STRINGS.EXPERIMENTAL_WARNING) return false;
	// eslint-disable-next-line prefer-rest-params
	return originalEmit.apply(process, arguments as unknown as Parameters<typeof process.emit>);
};

for (const file of await fs.promises.readdir(path.join(dirname, "./sources"))) {
	if (!file.endsWith(".js")) continue;
	const module = await import(`file://${path.join(dirname, "./sources", file)}`);
	const constructed: import("./types.js").Plugin = new module.default();
	constructed.setVariables?.(logger);
	await constructed.initialize?.();
	plugins.push(constructed);
}

const isDir = await fs.promises.stat(path.join(dirname, "../plugins")).then(s => s.isDirectory()).catch(() => false);
if (isDir) {
	for (const file of await fs.promises.readdir(path.join(dirname, "../plugins"))) {
		if (!file.endsWith(".js")) continue;
		const module = await import(`file://${path.join(dirname, "../plugins", file)}`);
		const constructed: import("./types.js").Plugin = new module.default();
		constructed.setVariables?.(logger);
		await constructed.initialize?.();
		plugins.push(constructed);
	}
}

parentPort.postMessage({ op: Constants.workerOPCodes.READY });
