import util from "node:util";
import path from "node:path";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";

import websocket from "../loaders/websocket.js";
import { lavalinkDirname, lavalinkPlugins } from "../loaders/lavalink.js";
import Util from "./Util.js";

import type { TrackInfo } from "volcano-encoding";
import type { PlayerUpdate, PlayerResponse, ThreadStats, ParentMessage, ThreadMessage } from "../worker.js";

type Thread = {
	worker: Worker;
	players: Set<string>;
	/** Streams handed to the thread. A dying thread doesn't cancel them, so they're destroyed on exit */
	streams: Set<Readable>;
	requests: Map<number, { resolve: (data: any) => void; reject: (e: Error) => void }>;
	idle?: NodeJS.Timeout;
	exited: boolean;
};

type Request = ParentMessage extends infer M ? M extends { op: "stream" } ? never : Omit<M, "id"> : never;

const threads = new Set<Thread>();
const playerThreads = new Map<string, Thread>();
const threadIdleMS = 30_000;
let lastRequestID = 0;

function spawn(): Thread {
	const thread: Thread = { worker: new Worker(path.join(lavalinkDirname, "worker.js")), players: new Set(), streams: new Set(), requests: new Map(), exited: false };
	thread.worker.on("message", (msg: ThreadMessage) => onMessage(thread, msg));
	thread.worker.on("error", e => console.error(util.inspect(e, false, Infinity, true)));
	thread.worker.once("exit", () => onExit(thread));
	threads.add(thread);
	console.log(`Spawned audio thread ${thread.worker.threadId} (${threads.size}/${lavalinkConfig.volcano.maxAudioThreads})`);
	return thread;
}

/** The least busy thread, unless every thread is full and another one is allowed */
function threadFor(key: string): Thread {
	let thread = playerThreads.get(key);
	if (thread) return thread;
	for (const t of threads) {
		if (!thread || t.players.size < thread.players.size) thread = t;
	}
	const { maxAudioThreads, playersPerAudioThread } = lavalinkConfig.volcano;
	if (!thread || (thread.players.size >= playersPerAudioThread && threads.size < maxAudioThreads)) thread = spawn();
	clearTimeout(thread.idle);
	thread.players.add(key);
	playerThreads.set(key, thread);
	return thread;
}

function request<T>(thread: Thread, message: Request): Promise<T> {
	const id = ++lastRequestID;
	return new Promise((resolve, reject) => {
		thread.requests.set(id, { resolve, reject });
		thread.worker.postMessage({ ...message, id });
	});
}

function onMessage(thread: Thread, msg: ThreadMessage) {
	if (msg.op === "event") return websocket.sendMessage({ clientID: msg.clientID, data: msg.data });
	if (msg.op === "stream") return void sendStream(thread, msg);
	const pending = thread.requests.get(msg.id);
	thread.requests.delete(msg.id);
	if (msg.error) pending?.reject(msg.error);
	else pending?.resolve(msg.data);
}

function onExit(thread: Thread) {
	thread.exited = true;
	threads.delete(thread);
	clearTimeout(thread.idle);
	for (const stream of thread.streams) {
		stream.destroy();
	}
	for (const pending of thread.requests.values()) {
		pending.reject(new Error("The audio thread exited"));
	}
	if (thread.players.size) console.error(`An audio thread exited with ${thread.players.size} players on it`);
	for (const key of thread.players) {
		const [clientID, guildID] = key.split(".");
		playerThreads.delete(key);
		websocket.sendMessage({ clientID, data: { op: "event", type: "WebSocketClosedEvent", guildId: guildID, code: 4000 as 4001, reason: "The audio thread this player was on exited", byRemote: false } });
		websocket.onPlayerDelete(clientID, guildID);
	}
}

async function sendStream(thread: Thread, { id, decoded, useFFMPEG, filters }: Extract<ThreadMessage, { op: "stream" }>) {
	const reply = (message: Omit<Extract<ParentMessage, { op: "stream" }>, "op" | "id">, transfer?: Array<any>) => thread.worker.postMessage({ op: "stream", id, ...message }, transfer);
	try {
		const { stream, type, piped } = await getStream(decoded, useFFMPEG, filters);
		if (thread.exited) return void stream.destroy();
		thread.streams.add(stream);
		stream.once("close", () => thread.streams.delete(stream));
		const web = Readable.toWeb(stream);
		reply({ stream: web, type, filters: piped ? filters : undefined }, [web]);
	} catch (e) {
		reply({ error: e instanceof Error ? e : new Error(String(e)) });
	}
}

async function getStream(decoded: TrackInfo, useFFMPEG: boolean, filters: Array<string>) {
	if (lavalinkConfig.lavalink.server.sources[decoded.source] === false) throw new Error(`${decoded.source.toUpperCase()}_NOT_ENABLED`);
	const source = lavalinkPlugins.find(p => p.source === decoded.source);
	if (!source) throw new Error(`${decoded.source.toUpperCase()}_NOT_IMPLEMENTED`);

	const result = await source.streamHandler?.(decoded, useFFMPEG);
	if (!result?.stream) throw new Error(`NO_OUTPUT_TYPE_${decoded.source.toUpperCase()}_FILTERS_${String(useFFMPEG).toUpperCase()}`);
	let { stream, type } = result;
	if (stream instanceof Socket) stream = await Util.socketToRequest(stream);
	let piped = false;
	for (const plugin of lavalinkPlugins) {
		if (!plugin.streamPipeline) continue;
		const data = await plugin.streamPipeline(stream, filters);
		stream = data.stream;
		if (data.type) type = data.type;
		piped = true;
	}
	return { stream, type, piped };
}

export function updatePlayer(clientID: string, guildID: string, update: PlayerUpdate, noReplace: boolean): Promise<PlayerResponse> {
	return request(threadFor(`${clientID}.${guildID}`), { op: "update", clientID, guildID, update, noReplace });
}

export async function getPlayer(clientID: string, guildID: string): Promise<PlayerResponse | null> {
	const key = `${clientID}.${guildID}`;
	const thread = playerThreads.get(key);
	return thread ? request(thread, { op: "get", key }) : null;
}

/** @returns whether the player existed */
export function destroyPlayer(clientID: string, guildID: string): boolean {
	const key = `${clientID}.${guildID}`;
	const thread = playerThreads.get(key);
	if (!thread) return false;
	playerThreads.delete(key);
	thread.players.delete(key);
	websocket.onPlayerDelete(clientID, guildID);
	request(thread, { op: "destroy", key }).catch(() => void 0);
	if (!thread.players.size) {
		clearTimeout(thread.idle);
		thread.idle = setTimeout(() => {
			console.log(`Audio thread ${thread.worker.threadId} has been idle for ${threadIdleMS / 1000}s. Shutting it down`);
			threads.delete(thread);
			void thread.worker.terminate();
		}, threadIdleMS);
	}
	return true;
}

export async function stats() {
	const all = await Promise.all([...threads].map(t => request<ThreadStats>(t, { op: "stats" }).catch((): ThreadStats => ({ playingPlayers: 0, pings: {}, frames: {} }))));
	return {
		players: playerThreads.size,
		playingPlayers: all.reduce((acc, cur) => acc + cur.playingPlayers, 0),
		pings: Object.assign({}, ...all.map(s => s.pings)) as Record<string, number>,
		frames: Object.assign({}, ...all.map(s => s.frames)) as ThreadStats["frames"]
	};
}

export default { updatePlayer, getPlayer, destroyPlayer, stats };
