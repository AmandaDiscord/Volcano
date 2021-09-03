import { parentPort as parentport } from "worker_threads";
import path from "path";
import fs from "fs";

import { FFmpeg } from "prism-media";
const Discord: typeof import("@discordjs/voice") = require("@discordjs/voice");
const encoding: typeof import("@lavalink/encoding") = require("@lavalink/encoding");
const yt = require("play-dl") as typeof import("play-dl");
import Soundcloud from "soundcloud-scraper";
import yaml from "yaml";
import mixin from "mixin-deep";

if (!parentport) throw new Error("THREAD_IS_PARENT");
const parentPort = parentport;

import Constants from "./Constants";
import logger from "./util/Logger";
import Util from "./util/Util";
const configDir: string = path.join(process.cwd(), "./application.yml");
let cfgparsed: import("./types").LavaLinkConfig;

if (fs.existsSync(configDir)) {
	const cfgyml: string = fs.readFileSync(configDir, { encoding: "utf-8" });
	cfgparsed = yaml.parse(cfgyml);
} else cfgparsed = {};

const config: typeof Constants.defaultOptions = mixin({}, Constants.defaultOptions, cfgparsed);

const queues = new Map<string, Queue>();
const methodMap = new Map<string, import("@discordjs/voice").DiscordGatewayAdapterLibraryMethods>();

const reportInterval = setInterval(() => {
	if (!queues.size) return;
	for (const queue of queues.values()) {
		const state = queue.state;
		if (!queue.paused) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.OPCodes.PLAYER_UPDATE, guildId: queue.guildID, state: state }, clientID: queue.clientID });
	}
}, 5000);

parentPort.once("close", () => {
	clearInterval(reportInterval);
});

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

const keyDir = path.join(__dirname, "../soundcloud.txt");
let APIKey: string;

if (fs.existsSync(keyDir)) {
	APIKey = fs.readFileSync(keyDir, { encoding: "utf-8" });
} else {
	Soundcloud.keygen(true).then(key => {
		if (!key) throw new Error("SOUNDCLOUD_KEY_NO_CREATE");
		APIKey = key;
		fs.writeFileSync(keyDir, key, { encoding: "utf-8" });
	});
}

class Queue {
	public connection: import("@discordjs/voice").VoiceConnection;
	public clientID: string;
	public guildID: string;
	public tracks = new Array<{ track: string; start: number; end: number; volume: number; pause: boolean }>();
	public audioPlayer: import("@discordjs/voice").AudioPlayer | undefined;
	public paused = false;
	public current: import("@discordjs/voice").AudioResource<import("@lavalink/encoding").TrackInfo> | null = null;
	public stopping = false;
	public _filters: Array<string> = [];
	public _volume = 1.0;
	public applyingFilters = false;
	public shouldntCallFinish = false;
	public trackPausing = false;
	public initial = true;
	public subscription: import("@discordjs/voice").PlayerSubscription | undefined;
	public seekTime = 0;

	public constructor(connection: import("@discordjs/voice").VoiceConnection, clientID: string, guildID: string) {
		this.connection = connection;
		this.clientID = clientID;
		this.guildID = guildID;

		connection.on("stateChange", async (oldState, newState) => {
			if (newState.status === Discord.VoiceConnectionStatus.Disconnected) {
				if (newState.reason === Discord.VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
					try {
						await Discord.entersState(this.connection, Discord.VoiceConnectionStatus.Connecting, 5000);
					} catch {
						parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "WebSocketClosedEvent", guildId: this.guildID, code: newState.closeCode, reason: "Disconnected.", byRemote: true }, clientID: this.clientID });
						this.destroy();
					}
				} else {
					if (newState.reason === Discord.VoiceConnectionDisconnectReason.WebSocketClose) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "WebSocketClosedEvent", guildId: this.guildID, code: newState.closeCode, reason: codeReasons[newState.closeCode], byRemote: true }, clientID: this.clientID });
					this.stop();
				}
			} else if (newState.status === Discord.VoiceConnectionStatus.Destroyed) {
				this.stop();
			} else if (newState.status === Discord.VoiceConnectionStatus.Connecting || newState.status === Discord.VoiceConnectionStatus.Signalling) {
				try {
					await Discord.entersState(this.connection, Discord.VoiceConnectionStatus.Ready, 20000);
				} catch {
					if (this.connection.state.status !== Discord.VoiceConnectionStatus.Destroyed) this.destroy();
				}
			}
		});
	}

	public get state(): { time: number; position: number; connected: boolean } {
		if (this.tracks[0] && this.tracks[0].end && this.current?.playbackDuration === this.tracks[0].end) this.stop(true);
		return {
			time: Date.now(),
			position: this.current?.playbackDuration || 0 + this.seekTime,
			connected: this.connection.state.status === Discord.VoiceConnectionStatus.Ready
		};
	}

	private _nextSong() {
		this.seekTime = 0;
		this.tracks.shift();
		this.initial = true;
		if (!this.tracks.length) return;
		this.play();
	}

	private _applyPlayerEvents(player: import("@discordjs/voice").AudioPlayer) {
		const old = this.audioPlayer;
		if (old) {
			const stateChangeListeners = old.listeners("stateChange"); // all player listeners internally in djs voice should be added already unless something weird happens where they're added on another tick
			if (stateChangeListeners.length > 1) console.log("player stateChangeListeners > 1");
			old.removeListener("stateChange", stateChangeListeners[0]); // no listeners should be added in the constructor. This method is called in the next tick
		}
		player.on("stateChange", async (oldState, newState) => {
			if (newState.status === Discord.AudioPlayerStatus.Idle && oldState.status !== Discord.AudioPlayerStatus.Idle) {
				this.current = null;
				if (!this.stopping && !this.shouldntCallFinish) {
					parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "FINISHED" }, clientID: this.clientID });
				}
				this.stopping = false;
				this._nextSong();
				await new Promise((res, rej) => {
					let timer: NodeJS.Timeout | undefined = void 0;
					const fn = () => {
						if (player.state.status !== Discord.AudioPlayerStatus.Playing) return;
						if (timer) clearTimeout(timer);
						player.removeListener("stateChange", fn);
						res(void 0);
					};
					timer = setTimeout(() => {
						if (this.current || this.paused) res(void 0);
						else rej(new Error("TRACK_STUCK"));
						player.removeListener("stateChange", fn);
					}, 10000);
					player.on("stateChange", fn);
				}).catch(() => {
					if (!this.tracks.length) return;
					parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackStuckEvent", guildId: this.guildID, track: this.tracks[0].track, thresholdMs: 10000 }, clientID: this.clientID });
					this._nextSong();
				});
			} else if (newState.status === Discord.AudioPlayerStatus.Playing) {
				this.audioPlayer = player;
				this.subscription?.unsubscribe();
				this.subscription = this.connection.subscribe(player);
				old?.stop(true);
				old?.removeAllListeners();
				if (this.trackPausing) this.pause();
				this.trackPausing = false;
				if(this.paused) return;
				if ((!this.shouldntCallFinish || this.initial) && this.tracks.length) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackStartEvent", guildId: this.guildID, track: this.tracks[0].track }, clientID: this.clientID });
				this.shouldntCallFinish = false;
				this.initial = false;
			}
		});

		player.on("error", (error) => {
			parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackExceptionEvent", guildId: this.guildID, track: this.tracks[0].track, exception: error.name, message: error.message, severity: "COMMON", cause: error.stack || new Error().stack || "Unknown" }, clientID: this.clientID });
			this._nextSong();
		});
	}

	public async play() {
		if (!this.tracks.length) return;

		const meta = this.tracks[0];
		const decoded = encoding.decode(meta.track);
		if (!decoded.uri) return this._nextSong();
		// eslint-disable-next-line no-async-promise-executor
		const resource = await new Promise<import("@discordjs/voice").AudioResource<import("@lavalink/encoding").TrackInfo>>(async (resolve, reject) => {
			let stream: import("stream").Readable | undefined = undefined;
			const demux = async () => {
				if (!stream) return reject(new Error("NO_STREAM"));
				this.shouldntCallFinish = true;
				let final: import("stream").Readable;
				let isRaw = false;
				if (this._filters.length) { // Don't pipe through ffmpeg if not necessary
					const toApply = ["-i", "-", "-analyzeduration", "0", "-loglevel", "0", "-f", "s16le", "-ar", "48000", "-ac", "2"];
					if (this.state.position && !this._filters.includes("-ss")) {
						toApply.unshift("-ss", `${this.state.position + 2000}ms`, "-accurate_seek");
						this.seekTime = this.state.position + 2000;
					} else if (this._filters.includes("-ss")) { // came from Queue.seek option. this.seekTime should be set already.
						const index = this._filters.indexOf("-ss");
						toApply.unshift(...this._filters.slice(index, index + 2));
						this._filters.splice(index, 3);
					} else if (meta.start) { // obv prefer user's pref then fallback to if the track specified a startTime
						this.seekTime = meta.start;
						toApply.unshift("-ss", `${meta.start}ms`, "-accurate_seek");
					}
					// _filters should no longer have -ss if there are other filters, then push the audio filters flag
					if (this._filters.length) toApply.push("-af");
					const argus = toApply.concat(this._filters);
					const transcoder = new FFmpeg({ args: argus });
					this.applyingFilters = false;
					final = stream.pipe(transcoder);

					final.once("close", () => {
						transcoder.destroy();
					});
					final.once("end", () => {
						transcoder.destroy();
					});
					isRaw = true;
				} else {
					final = stream;
				}

				if (isRaw) resolve(Discord.createAudioResource(final, { metadata: decoded, inputType: Discord.StreamType.Raw, inlineVolume: true }));
				else Discord.demuxProbe(final).then(probe => resolve(Discord.createAudioResource(probe.stream, { metadata: decoded, inputType: probe.type, inlineVolume: true }))).catch(reject);
			};
			if (decoded.source === "youtube") {
				if (!config.lavalink.server.sources.youtube) return reject(new Error("YOUTUBE_NOT_ENABLED"));
				try {
					stream = await yt.stream(decoded.uri as string).then(i => i.stream);
					await demux();
				} catch (e) {
					return reject(e);
				}
			} else if (decoded.source === "soundcloud") {
				if (!config.lavalink.server.sources.soundcloud) return reject(new Error("SOUNDCLOUD_NOT_ENABLED"));
				const url = decoded.identifier.replace(/^O:/, "");
				const streamURL = await Soundcloud.Util.fetchSongStreamURL(url, APIKey);
				if (url.endsWith("/hls")) stream = await Soundcloud.StreamDownloader.downloadHLS(streamURL);
				else stream = await Soundcloud.StreamDownloader.downloadProgressive(streamURL);
				try {
					await demux();
				} catch (e) {
					stream.destroy();
					return reject(e);
				}
			} else if (decoded.source === "local") {
				if (!config.lavalink.server.sources.local) return reject(new Error("LOCAL_NOT_ENABLED"));
				try {
					stream = fs.createReadStream(decoded.uri as string);
					await demux();
				} catch (e) {
					return reject(e);
				}
			} else {
				if (!config.lavalink.server.sources.http) return reject(new Error("HTTP_NOT_ENABLED"));
				stream = await Util.request(decoded.uri as string);
				try {
					await demux();
				} catch (e) {
					return reject(e);
				}
			}
		}).catch(e => {
			console.log(e);
			this._nextSong();
		});
		if (!resource) return;
		const newPlayer = Discord.createAudioPlayer();
		this._applyPlayerEvents(newPlayer);
		this.current = resource;
		if (meta.volume !== 100 || this._volume !== 1.0) this.volume(meta.volume !== 100 ? meta.volume / 100 : this._volume);
		if (meta.pause) this.trackPausing = true;
		newPlayer.play(resource);
	}

	public queue(track: { track: string; start: number; end: number; volume: number; pause: boolean; replace?: boolean }) {
		if (track.replace) this.tracks.length = 0;
		delete track.replace;
		this.tracks.push(track);
		if (track.replace) this.replace();
	}

	public replace() {
		parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "REPLACED" }, clientID: this.clientID });
		this._nextSong();
	}

	public pause() {
		this.paused = !!this.audioPlayer?.pause(true);
	}

	public resume() {
		this.paused = !this.audioPlayer?.unpause();
	}

	public stop(destroyed?: boolean) {
		this.stopping = true;
		this.audioPlayer?.stop(true);
		if (!destroyed) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "STOPPED" }, clientID: this.clientID });
	}

	public destroy() {
		this.tracks.length = 0;
		this.stop(true);
		this.connection.destroy();
		queues.delete(`${this.clientID}.${this.guildID}`);
		if (queues.size === 0) {
			clearInterval(reportInterval);
			parentPort.postMessage({ op: Constants.workerOPCodes.CLOSE });
		}
	}

	public volume(amount: number) {
		this._volume = amount;
		this.current?.volume?.setVolume(amount);
	}

	public seek(amount: number) {
		const previousIndex = this._filters.indexOf("-ss");
		if (previousIndex !== -1) this._filters.splice(previousIndex, 2);
		this._filters.push("-ss", `${amount || 0}ms`, "-accurate_seek");
		if (!this.applyingFilters) this.play();
		this.applyingFilters = true;
		this.seekTime = amount;
	}

	public filters(filters: import("./types").PlayerFilterOptions) {
		const toApply: Array<string> = [];
		if (this._filters.includes("-ss")) toApply.push("-ss", this._filters[this._filters.indexOf("-ss") + 2]);
		this._filters.length = 0;
		if (filters.volume) this.volume(filters.volume);
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
			const speeddif = 1.0 - pitch;
			const finalspeed = speed + speeddif;
			const ratedif = 1.0 - rate;

			toApply.push(`aresample=48000,asetrate=48000*${pitch + ratedif},atempo=${finalspeed},aresample=48000`);
		}
		if (filters.tremolo) {
			toApply.push(`tremolo=f=${filters.tremolo.frequency || 2.0}:d=${filters.tremolo.depth || 0.5}`);
		}
		if (filters.vibrato) {
			toApply.push(`vibrato=f=${filters.vibrato.frequency || 2.0}:d=${filters.vibrato.depth || 0.5}`);
		}
		if (filters.rotation) {
			toApply.push(`apulsator=hz=${filters.rotation.rotationHz || 0}`);
		}
		if (filters.lowPass) {
			toApply.push(`lowpass=f=${500 / filters.lowPass.smoothing}`);
		}
		this._filters.push(...toApply);
		if (!this.applyingFilters) this.play();
		this.applyingFilters = true;
	}

	public ffmpeg(args: Array<string>) {
		this._filters.length = 0;
		this._filters.push(...args);
		if (!this.applyingFilters) this.play();
		this.applyingFilters = true;
	}
}

parentPort.on("message", async (packet: { data?: import("./types").InboundPayload; op: typeof Constants.workerOPCodes[keyof typeof Constants.workerOPCodes], threadID: number; broadcasted?: boolean }) => {
	if (packet.op === Constants.workerOPCodes.STATS) {
		const qs = [...queues.values()];
		return parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: { playingPlayers: qs.filter(q => !q.paused).length, players: queues.size }, threadID: packet.threadID });
	} else if (packet.op === Constants.workerOPCodes.MESSAGE) {
		const guildID = packet.data!.guildId;
		const userID = packet.data!.clientID!;
		switch (packet.data!.op) {

		case "play": {
			let q: Queue;
			if (!queues.has(`${userID}.${guildID}`)) {
				if (packet.broadcasted) return parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: false, threadID: packet.threadID });

				// Channel IDs are never forwarded to LavaLink and are not really necessary in code except for in the instance of sending packets
				const voiceConnection = new Discord.VoiceConnection({ channelId: "", guildId: guildID, selfDeaf: false, selfMute: false, group: "" }, { adapterCreator: voiceAdapterCreator(userID, guildID) });
				q = new Queue(voiceConnection, userID, guildID);
				queues.set(`${userID}.${guildID}`, q);
				parentPort.postMessage({ op: Constants.workerOPCodes.VOICE_SERVER, data: { clientID: userID, guildId: guildID } });
			} else {
				if (packet.broadcasted) parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: true, threadID: packet.threadID });
				q = queues.get(`${userID}.${guildID}`)!;
				if (packet.data!.noReplace === true && q.tracks.length !== 0) return logger.info("Skipping play request because of noReplace");
			}

			q.queue({ track: packet.data!.track!, start: Number(packet.data!.startTime || "0"), end: Number(packet.data!.endTime || "0"), volume: Number(packet.data!.volume || "100"), replace: !packet.data!.noReplace, pause: packet.data!.pause || false });
			if (q.tracks.length === 1) q.play();
			break;
		}
		case "destroy": {
			queues.get(`${userID}.${guildID}`)?.destroy();
			break;
		}
		case "pause": {
			const q = queues.get(`${userID}.${guildID}`);
			if (packet.data!.pause) q?.pause();
			else q?.resume();
			break;
		}
		case "stop": {
			queues.get(`${userID}.${guildID}`)?.stop();
			break;
		}
		case "filters": {
			queues.get(`${userID}.${guildID}`)?.filters(packet.data!);
			break;
		}
		case "seek": {
			queues.get(`${userID}.${guildID}`)?.seek(packet.data!.position!);
			break;
		}
		case "ffmpeg": {
			queues.get(`${userID}.${guildID}`)?.ffmpeg(packet.data!.args!);
			break;
		}
		}
	} else if (packet.op === Constants.workerOPCodes.VOICE_SERVER) {
		methodMap.get(`${packet.data!.clientID}.${packet.data!.guildId}`)?.onVoiceStateUpdate({ channel_id: "" as any, guild_id: packet.data!.guildId as any, user_id: packet.data!.clientID as any, session_id: packet.data!.sessionId!, deaf: false, self_deaf: false, mute: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null });
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
	return methods => {
		methodMap.set(`${userID}.${guildID}`, methods);
		return {
			sendPayload: payload => {
				return !!payload;
			},
			destroy: () => {
				methodMap.delete(`${userID}.${guildID}`);
			}
		};
	};
}

parentPort.postMessage({ op: Constants.workerOPCodes.READY });
