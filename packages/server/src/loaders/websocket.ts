import { WebSocketServer, WebSocket } from "ws";

import type { IncomingMessage } from "http";
import type { Socket } from "net";

import type { EventOP, PlayerUpdateOP, StatsOP, ReadyOP, UpdateSessionResult } from "lavalink-types";

import Util from "../util/Util.js";

const wss = new WebSocketServer({ noServer: true });

const socketDeleteTimeouts = new Map<string, { timeout: NodeJS.Timeout; events: Array<any>; sessionID: string; }>();
const connections = new Map<string, { userID: string; socket: WebSocket; resumeKey: string | null; resumeTimeout: number }>();
const socketToSessionIDMap = new Map<WebSocket, string>();
const playerMap = new Map<string, WebSocket>();
const socketToPlayerIDsMap = new Map<WebSocket, Array<string>>();

const serverLoopInterval: NodeJS.Timeout = setInterval(async () => {
	if (!wss.clients.size) return;
	const stats = await Util.getStats();
	const payload = Object.assign(stats, { op: "stats" });
	const str: string = JSON.stringify(payload);
	for (const client of wss.clients) {
		if (client["isAlive"] === false) return client.terminate();
		client["isAlive"] = false;

		if (client.readyState === WebSocket.OPEN) {
			client.ping(Util.noop);
			client.send(str);
		}
	}
}, 1000 * 60);


wss.on("headers", (headers, request) => {
	headers.push(
		`Session-Resumed: ${!!request.headers["resume-key"] && socketDeleteTimeouts.has(request.headers["resume-key"] as string)}`,
		`Lavalink-Major-Version: ${lavalinkMajor}`, "Is-Volcano: true"
	);
});

wss.on("connection", async (socket, request) => {
	const stats = await Util.getStats();
	socket.send(JSON.stringify(Object.assign(stats, { op: "stats" }) as StatsOP));
	socket["isAlive"] = true;
	socket.on("pong", socketHeartbeat);

	socket.once("close", code => onClientClose(socket, code, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
	socket.once("error", () => onClientClose(socket, 1000, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
});

wss.once("close", () => {
	clearInterval(serverLoopInterval);

	console.log("Socket server has closed.");
});

function socketHeartbeat(): void {
	this.isAlive = true;
}

const UUIDCharacters = "abcdefghijklmnopqrstuvwxyz0123456789"; // Lavalink only generates session IDs with characters a-z and digits 0-9
function generateUUID(length: number): string {
	let result = "";
	let counter = 0;
	while (counter < length) {
		result += UUIDCharacters.charAt(Math.floor(Math.random() * UUIDCharacters.length));
		counter++;
	}
	return result;
}

function updateOrCreateSession(socket: WebSocket, userID: string, sessionID?: string): string {
	if (sessionID) {
		const existing = connections.get(sessionID);
		if (existing) {
			socketToSessionIDMap.delete(existing.socket);
			existing.socket = socket;
		}
	} else {
		do {
			sessionID = generateUUID(16);
		} while (connections.has(sessionID));
		connections.set(sessionID, { userID, socket, resumeKey: null, resumeTimeout: 60 });
	}
	socketToSessionIDMap.set(socket, sessionID);
	return sessionID;
}

export function handleWSUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
	const userID: string = request.headers["user-id"] as string;
	wss.handleUpgrade(request, socket, head, s => {
		let sessionId: string | undefined = undefined;
		const rkey = request.headers["resume-key"] as string | undefined;
		const resume = rkey ? socketDeleteTimeouts.get(rkey) : undefined;
		if (rkey && resume) {
			sessionId = resume.sessionID;
			clearTimeout(resume.timeout);
			socketDeleteTimeouts.delete(rkey);

			for (const event of resume.events) {
				s.send(JSON.stringify(event));
			}

			console.log(`Resumed session with key ${rkey}`);
			console.log(`Replaying ${resume.events.length.toLocaleString()} events`);
			resume.events.length = 0;
		}

		if (!sessionId) console.log("Connection successfully established");
		sessionId = updateOrCreateSession(s, userID, sessionId);
		const ready: ReadyOP = { op: "ready", resumed: !!resume, sessionId };
		s.send(JSON.stringify(ready));
		wss.emit("connection", s, request);
	});
}

async function onClientClose(socket: WebSocket, closeCode: number, extra: { ip: string; port: number }): Promise<void> {
	if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) socket.close(closeCode);

	socket.removeAllListeners();
	const sessionId = socketToSessionIDMap.get(socket);
	if (!sessionId) return;
	const entry = connections.get(sessionId);
	if (!entry) return;

	const worker = await import("../worker.js");

	if (entry.resumeKey) {
		console.log(`Connection closed from /${extra.ip}:${extra.port} with status CloseStatus[code=${closeCode}, reason=destroy] -- Session can be resumed within the next ${entry.resumeTimeout} seconds with key ${entry.resumeKey}`);

		const timeout: NodeJS.Timeout = setTimeout(async () => {
			socketDeleteTimeouts.delete(entry.resumeKey!);
			connections.delete(sessionId);
			socketToSessionIDMap.delete(socket);

			const forUser = (socketToPlayerIDsMap.get(socket) || []).map(id => worker.queues.get(id)).filter(i => !!i) as Array<import("../worker.js").Queue>;
			for (const q of forUser) {
				q.destroy();
			}
			console.log(`Shutting down ${forUser.length} playing players`);
		}, (entry.resumeTimeout || 60) * 1000);

		socketDeleteTimeouts.set(entry.resumeKey, { sessionID: sessionId, timeout, events: [] });
	} else {
		connections.delete(sessionId);
		socketToSessionIDMap.delete(socket);
		const forUser = [...worker.queues.values()].filter(q => q.clientID === entry.userID);
		for (const q of forUser) {
			q.destroy();
		}

		console.log(`Shutting down ${forUser.length} playing players`);
	}
}

export function sendMessage(msg: { clientID: string; data: EventOP | PlayerUpdateOP }): void {
	const socket = playerMap.get(`${msg.clientID}.${msg.data.guildId}`);
	if (!socket) return;
	const sessionID = socketToSessionIDMap.get(socket);
	if (sessionID) {
		const entry = connections.get(sessionID);
		if (entry && entry.resumeKey && socketDeleteTimeouts.has(entry.resumeKey)) socketDeleteTimeouts.get(entry.resumeKey)!.events.push(msg.data);
	}
	socket.send(JSON.stringify(msg.data));
}

export function declareClientToPlayer(clientID: string, guildID: string, sessionID: string): void {
	const key = `${clientID}.${guildID}`;
	const entry = connections.get(sessionID);
	if (!entry) return;
	playerMap.set(key, entry.socket);
	const existing = socketToPlayerIDsMap.get(entry.socket)?.indexOf(key);
	if (existing !== undefined && existing !== -1) return;
	if (!socketToPlayerIDsMap.has(entry.socket)) socketToPlayerIDsMap.set(entry.socket, []);
	socketToPlayerIDsMap.get(entry.socket)!.push(key);
}

export function onPlayerDelete(clientID: string, guildID: string): void {
	const key = `${clientID}.${guildID}`;
	const socket = playerMap.get(key);
	if (!socket) return;
	playerMap.delete(key);
	const allIDs = socketToPlayerIDsMap.get(socket);
	if (!allIDs) return;
	const index = allIDs.indexOf(key);
	if (index !== -1) allIDs.splice(index, 1);
	if (allIDs.length === 0) socketToPlayerIDsMap.delete(socket);
}

export function updateResumeInfo(sessionID: string, resumeKey: string | null | undefined, resumeTimeout: number | undefined): UpdateSessionResult {
	const entry = connections.get(sessionID);
	if (!entry) return { resumingKey: resumeKey ?? null, timeout: resumeTimeout ?? 60 };
	if (resumeKey !== undefined) entry.resumeKey = resumeKey;
	if (resumeTimeout !== undefined) entry.resumeTimeout = resumeTimeout;
	return { resumingKey: entry.resumeKey, timeout: entry.resumeTimeout };
}

export async function getQueuesForSession(sessionID: string): Promise<Array<import("../worker.js").Queue>> {
	const entry = connections.get(sessionID);
	if (!entry) return [];
	const allIDs = socketToPlayerIDsMap.get(entry.socket);
	if (!allIDs) return [];
	const worker = await import("../worker.js");
	return allIDs.map(id => worker.queues.get(id)).filter(i => !!i) as Array<import("../worker.js").Queue>;
}

export async function getQueueForSession(sessionID: string, guildID: string): Promise<import("../worker.js").Queue | null> {
	const entry = connections.get(sessionID);
	if (!entry) return null;
	const worker = await import("../worker.js");
	return worker.queues.get(`${entry.userID}.${guildID}`) ?? null;
}

export function getSession(sessionID: string) {
	return connections.get(sessionID);
}

export function sessionExists(sessionID: string): boolean {
	return connections.has(sessionID);
}

export default { handleWSUpgrade, sendMessage, declareClientToPlayer, onPlayerDelete, updateResumeInfo, getQueuesForSession, getSession, sessionExists };
