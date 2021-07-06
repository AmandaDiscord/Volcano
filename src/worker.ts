import { parentPort as parentport } from "worker_threads";
import path from "path";
import fs from "fs";

const Discord: typeof import("@discordjs/voice") = require("@discordjs/voice");
const encoding: typeof import("@lavalink/encoding") = require("@lavalink/encoding");
import { raw as ytdl } from "youtube-dl-exec";
import Soundcloud from "soundcloud-scraper";
import centra from "centra";

if (!parentport) throw new Error("THREAD_IS_PARENT");
const parentPort = parentport;

import Constants from "./Constants";

const queues = new Map<string, Queue>();
const methodMap = new Map<string, import("@discordjs/voice").DiscordGatewayAdapterLibraryMethods>();

const reportInterval = setInterval(() => {
	if (!queues.size) return;
	for (const queue of queues.values()) {
		const state = queue.state;
		if (!queue.paused && state.connected) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: Constants.OPCodes.PLAYER_UPDATE, guildId: queue.guildID, state: state }, clientID: queue.clientID });
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
	public audioPlayer = Discord.createAudioPlayer();
	public paused = false;
	public current: import("@discordjs/voice").AudioResource<import("@lavalink/encoding").TrackInfo> | null = null;
	public stopping = false;

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
					if (this.connection.state.status !== Discord.VoiceConnectionStatus.Destroyed) this.stop();
				}
			}
		});

		this.audioPlayer.on("stateChange", async (oldState, newState) => {
			if (newState.status === Discord.AudioPlayerStatus.Idle && oldState.status !== Discord.AudioPlayerStatus.Idle) {
				this.current = null;
				if (!this.stopping) parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "FINISHED" }, clientID: this.clientID });
				this.stopping = false;
				this._nextSong();
				await new Promise((res, rej) => {
					let timer: NodeJS.Timeout | undefined = void 0;
					const fn = () => {
						if (this.audioPlayer.state.status !== Discord.AudioPlayerStatus.Playing) return;
						if (timer) clearTimeout(timer);
						this.audioPlayer.removeListener("stateChange", fn);
						res(void 0);
					};
					timer = setTimeout(() => {
						if (this.current) res(void 0);
						else rej(new Error("TRACK_STUCK"));
						this.audioPlayer.removeListener("stateChange", fn);
					}, 20000);
					this.audioPlayer.on("stateChange", fn);
				}).catch(() => {
					if (!this.tracks.length) return;
					parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackStuckEvent", guildId: this.guildID, track: this.tracks[0].track, thresholdMs: 10000 }, clientID: this.clientID });
					this._nextSong();
				});
			} else if (newState.status === Discord.AudioPlayerStatus.Playing) {
				parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackStartEvent", guildId: this.guildID, track: this.tracks[0].track }, clientID: this.clientID });
			}
		});

		this.audioPlayer.on("error", (error) => {
			parentPort.postMessage({ op: Constants.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackExceptionEvent", guildId: this.guildID, track: this.tracks[0].track, exception: error.name, message: error.message, severity: "COMMON", cause: error.stack || new Error().stack || "Unknown" }, clientID: this.clientID });
			this._nextSong();
		});

		this.connection.subscribe(this.audioPlayer);
	}

	public get state(): { time: number; position: number; connected: boolean } {
		return {
			time: Date.now(),
			position: this.current?.playbackDuration || 0,
			connected: this.connection.state.status === Discord.VoiceConnectionStatus.Ready
		};
	}

	private _nextSong() {
		this.tracks.shift();
		if (!this.tracks.length) return;
		this.play();
	}

	public async play() {
		if (!this.tracks.length) return;

		const meta = this.tracks[0];
		const decoded = encoding.decode(meta.track);
		if (!decoded.uri) return this._nextSong();
		// eslint-disable-next-line no-async-promise-executor
		const resource = await new Promise<import("@discordjs/voice").AudioResource<import("@lavalink/encoding").TrackInfo>>(async (resolve, reject) => {
			const onError = (error: Error, stream: import("stream").Readable, sub?: any) => {
				if (sub && !sub.killed && typeof sub.kill === "function") sub.kill();
				stream.resume();
				return reject(error);
			};
			const demux = (s: import("stream").Readable, sub?: any) => {
				Discord.demuxProbe(s).then(probe => resolve(Discord.createAudioResource(probe.stream, { metadata: decoded, inputType: probe.type, inlineVolume: true }))).catch(e => onError(e, s, sub));
			};
			if (decoded.source === "youtube") {
				const sub = ytdl(decoded.uri as string, { o: "-", q: "", f: "bestaudio[ext=webm+acodec=opus+asr=48000]/bestaudio", r: "100K" }, { stdio: ["ignore", "pipe", "ignore"] });
				if (!sub.stdout) return reject(new Error("No stdout"));
				const stream = sub.stdout;
				sub.once("spawn", () => demux(stream, sub)).catch(e => onError(e, stream, sub));
			} else if (decoded.source === "soundcloud") {
				let stream: import("stream").Readable;
				const url = decoded.identifier.replace(/^O:/, "");
				const streamURL = await Soundcloud.Util.fetchSongStreamURL(url, APIKey);
				if (url.endsWith("/hls")) stream = await Soundcloud.StreamDownloader.downloadHLS(streamURL);
				else stream = await Soundcloud.StreamDownloader.downloadProgressive(streamURL);
				try {
					demux(stream);
				} catch (e) {
					onError(e, stream);
				}
			} else {
				const stream: import("http").IncomingMessage = await centra(decoded.uri as string, "get").header(Constants.baseHTTPRequestHeaders).compress().stream().send() as any;
				try {
					demux(stream);
				} catch (e) {
					onError(e, stream);
				}
			}
		}).catch(e => {
			console.log(e);
			this._nextSong();
		});
		if (!resource) return;
		this.current = resource;
		if (meta.volume !== 100) this.volume(meta.volume / 100);

		this.audioPlayer.play(resource);
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
		this.paused = this.audioPlayer.pause(true);
	}

	public resume() {
		this.paused = !this.audioPlayer.unpause();
	}

	public stop(destroyed?: boolean) {
		this.stopping = true;
		this.audioPlayer.stop(true);
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
		this.current?.volume?.setVolume(amount);
	}
}

parentPort.on("message", async (packet: { data?: import("./types").InboundPayload; op: typeof Constants.workerOPCodes[keyof typeof Constants.workerOPCodes], threadID: number; broadcasted?: boolean }) => {
	if (packet.op === Constants.workerOPCodes.STATS) {
		const qs = [...queues.values()];
		return parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: { playingPlayers: qs.filter(q => !q.paused).length, players: queues.size } });
	} else if (packet.op === Constants.workerOPCodes.MESSAGE) {
		const guildID = packet.data!.guildId;
		const userID = packet.data!.clientID!;
		switch (packet.data!.op) {

		case "play": {
			let q: Queue;
			if (!queues.has(`${userID}.${guildID}`)) {
				if (packet.broadcasted) return parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: false, threadID: packet.threadID });

				// Channel IDs are never forwarded to LavaLink and are not really necessary in code except for in the instance of sending packets
				const voiceConnection = new Discord.VoiceConnection({ channelId: "", guildId: guildID, selfDeaf: false, selfMute: false }, { adapterCreator: voiceAdapterCreator(userID, guildID) });
				q = new Queue(voiceConnection, userID, guildID);
				queues.set(`${userID}.${guildID}`, q);
				parentPort.postMessage({ op: Constants.workerOPCodes.VOICE_SERVER, data: { clientID: userID, guildId: guildID } });
			} else {
				if (packet.broadcasted) parentPort.postMessage({ op: Constants.workerOPCodes.REPLY, data: true, threadID: packet.threadID });
				q = queues.get(`${userID}.${guildID}`)!;
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
			if (packet.data!.volume) queues.get(`${userID}.${guildID}`)?.volume(packet.data!.volume);
			break;
		}
		}
	} else if (packet.op === Constants.workerOPCodes.VOICE_SERVER) {
		methodMap.get(`${packet.data!.clientID}.${packet.data!.guildId}`)?.onVoiceStateUpdate({ channel_id: "" as any, guild_id: packet.data!.guildId as any, user_id: packet.data!.clientID as any, session_id: packet.data!.sessionId!, deaf: false, self_deaf: false, mute: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null });
		methodMap.get(`${packet.data!.clientID}.${packet.data!.guildId}`)?.onVoiceServerUpdate({ guild_id: packet.data!.guildId as any, token: packet.data!.event!.token, endpoint: packet.data!.event!.endpoint });
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
