import type { HttpResponse, us_socket_context_t, WebSocket } from "uWebSockets.js";

import type { EventOP, PlayerUpdateOP, StatsOP, ReadyOP, UpdateSessionResult } from "lavalink-types";

import Util from "../util/Util.js";

export type SessionData = {
	userID: string;
	resumeKey: string;
	resumeTimeout: number;
	events: Array<any>;
	players: Array<string>;
	resumed: boolean;
	sessionID: string;
	ip: string;
}

const socketDeleteTimeouts = new Map<string, { timeout: NodeJS.Timeout; events: Array<any>; sessionID: string; }>();
const connections = new Map<string, WebSocket<SessionData>>();
const playerMap = new Map<string, WebSocket<SessionData>>();

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

export function handleWSUpgrade(userID: string, resumeKey: string, response: HttpResponse, context: us_socket_context_t, secKey: string, secProtocol: string, secExtensions: string, ip: string, abortedInfo: { aborted: boolean }): void {
	const resume = resumeKey.length ? socketDeleteTimeouts.get(resumeKey) : undefined;
	let sessionId: string | undefined = undefined;
	const events: Array<any> = [];
	if (abortedInfo.aborted) return;

	if (resumeKey && resume) {
		sessionId = resume.sessionID;
		clearTimeout(resume.timeout);
		socketDeleteTimeouts.delete(resumeKey);

		events.push(...resume.events);

		console.log(`Resumed session with key ${resumeKey}`);
		console.log(`Replaying ${resume.events.length.toLocaleString()} events`);
		resume.events.length = 0;
	}

	if (!sessionId) {
		console.log("Connection successfully established");
		do {
			sessionId = generateUUID(16);
		} while (connections.has(sessionId));
	}

	response.writeStatus("101 Switching Protocols");
	response.writeHeader("Session-Resumed", `${String(!!resume)}`);
	response.writeHeader("Lavalink-Major-Version", lavalinkMajor);
	response.writeHeader("Is-Volcano", "true");
	response.upgrade({
		userID,
		resumeKey,
		resumeTimeout: 60,
		events,
		players: [],
		resumed: !!resume,
		sessionID: sessionId,
		ip
	} as SessionData, secKey, secProtocol, secExtensions, context);
}

export async function onWSOpen(ws: WebSocket<SessionData>) {
	const data = ws.getUserData();
	connections.set(data.sessionID, ws);

	const stats = await Util.getStats();
	ws.send(JSON.stringify({ op: "ready", resumed: data.resumed, sessionId: data.sessionID } as ReadyOP));
	ws.send(JSON.stringify(Object.assign(stats, { op: "stats" }) as StatsOP));
	for (const event of data.events) {
		ws.send(JSON.stringify(event));
	}
	ws.ping();
}

export async function onWSClose(ws: WebSocket<SessionData>, closeCode: number): Promise<void> {
	const data = ws.getUserData();

	const worker = await import("../worker.js");

	const destroyAllQueues = () => {
		if (data.resumeKey.length) socketDeleteTimeouts.delete(data.resumeKey);
		connections.delete(data.sessionID);
		const forUser = data.players.map(id => worker.queues.get(`${data.userID}.${id}`)).filter(i => !!i) as Array<import("../worker.js").Queue>;
		for (const q of forUser) {
			q.destroy();
		}
		console.log(`Shutting down ${forUser.length} playing players`);
	};

	if (data.resumeKey.length) {
		console.log(`Connection closed from /${data.ip} with status CloseStatus[code=${closeCode}, reason=destroy] -- Session can be resumed within the next ${data.resumeTimeout} seconds with key ${data.resumeKey}`);

		const timeout: NodeJS.Timeout = setTimeout(destroyAllQueues, (data.resumeTimeout) * 1000);
		socketDeleteTimeouts.set(data.resumeKey, { sessionID: data.sessionID, timeout, events: [] });
	} else destroyAllQueues();
}

export function sendMessage(msg: { clientID: string; data: EventOP | PlayerUpdateOP }): void {
	const ws = playerMap.get(`${msg.clientID}.${msg.data.guildId}`);
	if (!ws) return;
	const data = ws.getUserData();
	if (data.resumeKey.length && socketDeleteTimeouts.has(data.resumeKey)) socketDeleteTimeouts.get(data.resumeKey)!.events.push(msg.data);
	ws.send(JSON.stringify(msg.data));
}

export function declareClientToPlayer(clientID: string, guildID: string, sessionID: string): void {
	const key = `${clientID}.${guildID}`;
	const socket = connections.get(sessionID);
	if (!socket) return;
	const data = socket.getUserData();
	const existing = data.players.indexOf(guildID);
	if (existing !== -1) return;
	playerMap.set(key, socket);
	data.players.push(guildID);
}

export function onPlayerDelete(clientID: string, guildID: string): void {
	const key = `${clientID}.${guildID}`;
	const socket = playerMap.get(key);
	if (!socket) return;
	playerMap.delete(key);
	const data = socket.getUserData();
	const index = data.players.indexOf(guildID);
	if (index !== -1) data.players.splice(index, 1);
}

export function updateResumeInfo(sessionID: string, resumeKey: string | null | undefined, resumeTimeout: number | undefined): UpdateSessionResult {
	const socket = connections.get(sessionID);
	if (!socket) return { resumingKey: resumeKey ?? null, timeout: resumeTimeout ?? 60 };
	const data = socket.getUserData();
	if (resumeKey !== undefined) data.resumeKey = resumeKey ?? "";
	if (resumeTimeout !== undefined) data.resumeTimeout = resumeTimeout;
	return { resumingKey: data.resumeKey.length ? data.resumeKey : null, timeout: data.resumeTimeout };
}

export async function getQueuesForSession(sessionID: string): Promise<Array<import("../worker.js").Queue>> {
	const socket = connections.get(sessionID);
	if (!socket) return [];
	const data = socket.getUserData();
	const worker = await import("../worker.js");
	return data.players.map(id => worker.queues.get(`${data.userID}.${id}`)).filter(i => !!i) as Array<import("../worker.js").Queue>;
}

export async function getQueueForSession(sessionID: string, guildID: string): Promise<import("../worker.js").Queue | null> {
	const socket = connections.get(sessionID);
	if (!socket) return null;
	const worker = await import("../worker.js");
	const data = socket.getUserData();
	return worker.queues.get(`${data.userID}.${guildID}`) ?? null;
}

export function getSession(sessionID: string) {
	return connections.get(sessionID);
}

export function sessionExists(sessionID: string): boolean {
	return connections.has(sessionID);
}

export default { handleWSUpgrade, sendMessage, declareClientToPlayer, onPlayerDelete, updateResumeInfo, getQueuesForSession, getSession, sessionExists };
