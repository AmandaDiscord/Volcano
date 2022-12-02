import util from "util";

import * as Songbird from "@melike2d/songbird";
import * as encoding from "@lavalink/encoding";

import Constants from "./Constants.js";
import websocket from "./loaders/websocket.js";

// TODO: symphonia does not allow seeking behind the current position of a stream, we could just recreate the stream and then seek like lavaplayer but that is it's own can of worms

export const queues = new Map<string, Queue>(), managers = new Map<string, Songbird.Manager>();

const sendToParent = (data: Parameters<typeof import("./loaders/websocket.js").sendMessage>["0"]["data"], clientId: string) => {
	websocket.sendMessage({ clientId, data });
};

setInterval(async () => {
	if (!queues.size) return;
	for (const queue of queues.values()) {
		const state = await queue.getState();
		if (!queue.actions.paused) sendToParent({ op: Constants.OPCodes.PLAYER_UPDATE, guildId: queue.guildId, state }, queue.userId);
	}
}, lavalinkConfig.lavalink.server.playerUpdateInterval * 1000);

class Queue {
	public userId: string;
	public guildId: string;
	public track: { track: string; start: number; end: number; volume: number; pause: boolean, handle?: Songbird.TrackHandle } | undefined = undefined;
	public actions = { initial: true, recreating: false, stopping: false, volume: 1.0, shouldntCallFinish: false, playing: false, destroyed: false, rate: 1.0, paused: false, seekTime: 0 };

	public call: Songbird.Call;

	public constructor(userId: string, guildId: string) {
		if (!managers.has(userId)) {
			managers.set(userId, Songbird.Manager.create({ userId }));
		}

		this.call = new Songbird.Call(managers.get(userId)!, guildId);
		this.userId  = userId;
		this.guildId = guildId;

		// this.player.on("stateChange", async (oldState, newState) => {
		// 	if (newState.status === Discord.AudioPlayerStatus.Idle && oldState.status !== Discord.AudioPlayerStatus.Idle) {
		// 		this.resource = null;
		// 		// Do not log if stopping. Queue.stop will send its own STOPPED reason instead of FINISHED. Do not log if shouldntCallFinish obviously.
		// 		if (!this.actions.stopping && !this.actions.shouldntCallFinish) sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildId, reason: "FINISH", track }, this.clientId);
		// 		this.actions.stopping = false;
		// 		this.actions.shouldntCallFinish = false;
		// 	} else if (newState.status === Discord.AudioPlayerStatus.Playing && oldState.status !== Discord.AudioPlayerStatus.Paused && oldState.status !== Discord.AudioPlayerStatus.AutoPaused) {
		
		// 	}
		// });

		// this.player.on("error", (error) => {
		// 	sendToParent({ op: "event", type: "TrackExceptionEvent", guildId: this.guildId, track: this.track?.track || "unknown", exception: { message: error.message, severity: "COMMON", cause: error.stack || new Error().stack || "unknown" } }, this.clientId);
		// });
	}

	public async getState() {
		const info = await this.track?.handle?.getInfo();

		const position = info?.position ?? -1;
		if (this.track && this.track.end && position >= this.track.end) {
			this.stop(this.track.track, true);
		}

		return {
			time: String(Date.now()),
			position: position,
			connected: true, // this.connection.state.status === Discord.VoiceConnectionStatus.Ready,
			ping: -1,
			guildId: this.guildId
		};
	}

	public nextSong() {
		this.actions.seekTime = 0;
		this.actions.initial = true;
		if (!this.track) return;
		this.play().catch(e => console.error(util.inspect(e, false, Infinity, true)));
	}

	public async getInput(decoded: import("@lavalink/encoding").TrackInfo): Promise<Songbird.Input | undefined> {
		if (lavalinkConfig.lavalink.server.sources[decoded.source] === false) throw new Error(`${decoded.source.toUpperCase()}_NOT_ENABLED`);

		const found = lavalinkPlugins.find(p => p.source === decoded.source);
		if (found) {
			return await found.songbirdInput?.(decoded);
		}

		throw new Error(`${decoded.source.toUpperCase()}_NOT_IMPLEMENTED`);
	}

	public async play() {
		if (!this.track) return;

		const meta = this.track, decoded = encoding.decode(meta.track);
		if (!decoded.uri) return;

		let input: Awaited<ReturnType<Queue["getInput"]>> | undefined = undefined;
		try {
			input = await this.getInput(decoded);
		} catch (e) {
			console.error(util.inspect(e, false, Infinity, true));
			sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildId, track: meta.track, reason: "LOAD_FAILED" }, this.userId);
		}

		if (!input) return;

		const handle = this.track.handle = this.call.play(input);
		this.actions.recreating = false;

		handle.addEvent(Songbird.TrackHandleEvent.Playable, () => {
			// if (this.actions.seekTime !== 0) {
			// 	handle.seek(this.actions.seekTime);
			// 	this.actions.seekTime = 0;
			// }

			if (this.actions.playing) return;

			this.actions.playing = true;
			if ((!this.actions.shouldntCallFinish || this.actions.initial) && this.track) sendToParent({ op: "event", type: "TrackStartEvent", guildId: this.guildId, track: this.track.track }, this.userId);
			this.actions.initial = false;
		});

		handle.addEvent(Songbird.TrackHandleEvent.End, () => {
			if (this.actions.recreating) return;

			const track = this.track?.track || "unknown";
			this.track = undefined;
			// Do not log if stopping or seeking. Queue.stop will send its own STOPPED reason instead of FINISHED. Do not log if shouldntCallFinish obviously.
			if (!this.actions.stopping && !this.actions.shouldntCallFinish) sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildId, reason: "FINISH", track }, this.userId);
			this.actions.stopping = false;
			this.actions.playing = false;
			this.actions.shouldntCallFinish = false;
		});
	}

	public queue(track: { track: string; start: number; end: number; volume: number; pause: boolean; }) {
		this.replace(this.track?.track);
		this.track = track;
	}

	public replace(oldTrack: string | undefined) {
		if (this.actions.playing && oldTrack) {
			this.stop(oldTrack, true);
			sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildId, reason: "REPLACED", track: oldTrack }, this.userId);
		}

		setImmediate(() => this.nextSong());
	}

	public pause(state: boolean) {
		this.track?.handle?.[state ? "pause" : "resume"]();
		this.actions.paused = state;
	}

	public stop(trackStopping: string, shouldntPost?: boolean) {
		this.actions.stopping = true;
		this.call.stop();
		if (!shouldntPost) sendToParent({ op: "event", type: "TrackEndEvent", guildId: this.guildId, reason: "STOPPED", track: trackStopping }, this.userId);
	}

	public async recreate() {
		if (!this.track) {
			return;
		}

		this.actions.recreating = true;
		this.stop(this.track.track, true);
		await this.play();
	}

	public destroy() {
		if (this.actions.destroyed) return;
		this.actions.destroyed = true;
		this.stop(this.track?.track || "unknown", true);
		this.track = undefined;
		this.call.stop();
		queues.delete(`${this.userId}.${this.guildId}`);
	}

	public volume(amount: number) {
		this.actions.volume = amount;
		this.track?.handle?.setVolume(amount);
	}

	public async seek(amount: number, recreate = false) {
		if (!this.track) {
			return;
		}

		// if (recreate) {
		// 	this.actions.seekTime = amount;
		// 	return this.recreate();
		// }

		// try {
		await this.track?.handle?.seekAsync(amount);	
		// } catch (ex) {
		// 	if (ex instanceof Error && ex.message.includes("seeked forward")) {
		// 		return this.seek(amount, true); 
		// 	}

		// 	throw ex;
		// }
	}
}

type PacketMap = {
	stats: { op: typeof Constants.workerOPCodes.STATS };
	message: { op: typeof Constants.workerOPCodes.MESSAGE, data: import("./types.js").InboundPayload };
	voice_server: { op: typeof Constants.workerOPCodes.VOICE_SERVER, data: { clientId: string; guildId: string; sessionId: string; event: { token: string; endpoint: string; } } };
	delete_all: { op: typeof Constants.workerOPCodes.DELETE_ALL, data: { clientId: string; } };
};

// @ts-expect-error
export function handleMessage(packet: PacketMap["message"] | PacketMap["voice_server"]): boolean;
export function handleMessage(packet: PacketMap["delete_all"]): number;
export function handleMessage(packet: PacketMap["stats"]): { playingPlayers: number; players: number; pings: { [gid: string]: number } };
export async function handleMessage(packet: import("./types.js").UnpackRecord<PacketMap>): Promise<boolean | number | { playingPlayers: number; players: number; pings: { [gid: string]: number; }; }> {
	if (packet.op === Constants.workerOPCodes.STATS) {
		let playing = 0;
		const accumulator: { [gid: string]: number } = {};
		for (const q of queues.values()) {
			if (!q.actions.paused) playing++;
			const state = await q.getState();
			accumulator[q.guildId] = state.ping;
		}
		return {
			playingPlayers: playing,
			players: queues.size,
			pings: accumulator
		};


	} else if (packet.op === Constants.workerOPCodes.MESSAGE) {
		const guildId = (packet.data as { guildId: string }).guildId;
		const userId = packet.data.clientId!;
		const key = `${userId}.${guildId}`;
		// @ts-expect-error
		delete packet.data.clientId;
		switch (packet.data.op) {

		case Constants.OPCodes.PLAY: {
			let q: Queue;
			if (!queues.has(key)) {
				// Channel Ids are never forwarded to LavaLink and are not really necessary in code except for in the instance of sending packets which isn't applicable.
				q = new Queue(userId, guildId);
				queues.set(key, q);
				const voiceState = websocket.dataRequest(Constants.workerOPCodes.VOICE_SERVER, { clientId: userId, guildId: guildId });
				q.queue({ track: packet.data.track, start: Number(packet.data.startTime || "0"), end: Number(packet.data.endTime || "0"), volume: Number(packet.data.volume || "100"), pause: packet.data.pause || false });
				if (voiceState) handleMessage({ op: Constants.workerOPCodes.VOICE_SERVER, data: voiceState });
			} else {
				q = queues.get(key)!;
				// TODO: handle no replace
				q.queue({ track: packet.data.track, start: Number(packet.data.startTime || "0"), end: Number(packet.data.endTime || "0"), volume: Number(packet.data.volume || "100"), pause: packet.data.pause || false });
			}
			return true;
		}

		case Constants.OPCodes.DESTROY: {
			const q = queues.get(key);
			q?.destroy();
			return !!q;
		}

		case Constants.OPCodes.PAUSE: {
			const q = queues.get(key);
			q?.pause(packet.data.pause);
			return !!q;
		}

		case Constants.OPCodes.STOP: {
			const q = queues.get(key);
			q?.stop(q.track?.track || "unknown");
			return !!q;
		}

		case Constants.OPCodes.FILTERS: {
			// const q = queues.get(key);
			// q?.filters(packet.data);
			// return !!q;
			return false;
		}

		case Constants.OPCodes.SEEK: {
			const q = queues.get(key);
			if (!q) return false;

			const state = await q.getState(), diff = state.position - packet.data.position;
			q.seek(packet.data.position, diff < 0 || diff > 10_000);

			return true;
		}

		case Constants.OPCodes.VOLUME: {
			const q = queues.get(key);
			q?.volume(packet.data.volume / 100);
			return !!q;
		}

		default:
			return false;
		}
	} else if (packet.op === Constants.workerOPCodes.VOICE_SERVER) {
		const queueKey = `${packet.data.clientId}.${packet.data.guildId}`;
		if (!queues.has(queueKey)) {
			queues.set(queueKey, new Queue(packet.data.clientId, packet.data.guildId));
		}

		queues.get(queueKey)?.call?.connect({
			endpoint: packet.data.event.endpoint,
			token: packet.data.event.token,
			session_id: packet.data.sessionId,
			user_id: packet.data.clientId
		});

		return queues.has(queueKey);
	} else if (packet.op === Constants.workerOPCodes.DELETE_ALL) {
		const forUser = [...queues.values()].filter(q => q.userId === packet.data.clientId);
		for (const q of forUser) {
			q.destroy();
		}
		return forUser.length;
	} else return false;
}

export default { handleMessage, queues };
