import type { HttpResponse, us_socket_context_t, WebSocket } from "uWebSockets.js";

import type { EventOP, PlayerUpdateOP, StatsOP, ReadyOP, UpdateSessionResult } from "lavalink-types/v4.js";
import type { PlayerResponse } from "../worker.js";

import Util from "../util/Util.js";

import { lavalinkMajor } from "./lavalink.js";

export type SessionData = {
	userID: string;
	resuming: boolean;
	resumeTimeout: number;
	events: Array<InternalMessage>;
	players: Array<string>;
	resumed: boolean;
	sessionID: string;
	ip: string;
}

export type InternalMessage = EventOP | PlayerUpdateOP;

/** A resumable session whose socket closed: its players keep running and their events are buffered until it resumes or times out. */
type DetachedSession = {
	sessionID: string;
	userID: string;
	resumeTimeout: number;
	players: Array<string>;
	events: Array<InternalMessage>;
	timeout: NodeJS.Timeout;
}

const connections = new Map<string, WebSocket<SessionData>>();
const playerMap = new Map<string, WebSocket<SessionData>>();
const detachedSessions = new Map<string, DetachedSession>();
const detachedPlayers = new Map<string, DetachedSession>();

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

/**
 * @param resumeID the Session-Id header: the ID of a session that enabled resuming.
 */
export function handleWSUpgrade(userID: string, resumeID: string, response: HttpResponse, context: us_socket_context_t, secKey: string, secProtocol: string, secExtensions: string, ip: string, abortedInfo: { aborted: boolean }): void {
	if (abortedInfo.aborted) return;
	const candidate = resumeID.length ? detachedSessions.get(resumeID) : undefined;
	const resume = candidate?.userID === userID ? candidate : undefined;

	let sessionId: string;
	if (resume) {
		clearTimeout(resume.timeout);
		detachedSessions.delete(resume.sessionID);
		for (const guildID of resume.players) detachedPlayers.delete(`${userID}.${guildID}`);
		sessionId = resume.sessionID;
		console.log(`Resumed session ${sessionId}`);
		console.log(`Replaying ${resume.events.length.toLocaleString()} events`);
	} else {
		console.log("Connection successfully established");
		do {
			sessionId = generateUUID(16);
		} while (connections.has(sessionId) || detachedSessions.has(sessionId));
	}

	response.cork(() => {
		response.writeStatus("101 Switching Protocols");
		response.writeHeader("Session-Resumed", `${String(!!resume)}`);
		response.writeHeader("Lavalink-Major-Version", lavalinkMajor);
		response.writeHeader("Lavalink-Api-Version", lavalinkMajor);
		response.writeHeader("Is-Volcano", "true");
		response.upgrade({
			userID,
			// resuming is opted into through PATCH /v4/sessions/{id}, so a resumed session keeps it on
			resuming: !!resume,
			resumeTimeout: resume?.resumeTimeout ?? 60,
			events: resume?.events ?? [],
			players: resume?.players ?? [],
			resumed: !!resume,
			sessionID: sessionId,
			ip
		} as SessionData, secKey, secProtocol, secExtensions, context);
	});
}

export function onWSOpen(ws: WebSocket<SessionData>): void {
	const data = ws.getUserData();
	connections.set(data.sessionID, ws);
	for (const guildID of data.players) playerMap.set(`${data.userID}.${guildID}`, ws);

	ws.send(JSON.stringify({ op: "ready", resumed: data.resumed, sessionId: data.sessionID } as ReadyOP));
	for (const event of data.events) ws.send(Util.stringify(event));
	data.events.length = 0;
	ws.ping();
	Util.getStats(data).then(stats => sendStats(data.sessionID, ws, stats)).catch(() => void 0);
}

/** Sends stats unless the socket closed while they were being gathered. */
export function sendStats(sessionID: string, ws: WebSocket<SessionData>, stats: Awaited<ReturnType<typeof Util.getStats>>): void {
	if (connections.get(sessionID) !== ws) return;
	ws.send(JSON.stringify(Object.assign(stats, { op: "stats" }) as StatsOP));
}

/** Must be called synchronously from the close handler: uWS invalidates the socket once that handler returns. */
export function onWSClose(ws: WebSocket<SessionData>, closeCode: number): void {
	const data = ws.getUserData();
	if (connections.get(data.sessionID) === ws) connections.delete(data.sessionID);
	for (const guildID of data.players) {
		const key = `${data.userID}.${guildID}`;
		if (playerMap.get(key) === ws) playerMap.delete(key);
	}

	if (!data.resuming) {
		destroyPlayers(data.userID, data.players).catch(() => void 0);
		return;
	}

	console.log(`Connection closed from /${data.ip} with status CloseStatus[code=${closeCode}, reason=destroy] -- Session ${data.sessionID} can be resumed within the next ${data.resumeTimeout} seconds`);
	const detached: DetachedSession = {
		sessionID: data.sessionID,
		userID: data.userID,
		resumeTimeout: data.resumeTimeout,
		players: [...data.players],
		events: [],
		timeout: setTimeout(() => expireDetached(detached), data.resumeTimeout * 1000)
	};
	detachedSessions.set(data.sessionID, detached);
	for (const guildID of detached.players) detachedPlayers.set(`${data.userID}.${guildID}`, detached);
}

function expireDetached(detached: DetachedSession): void {
	clearTimeout(detached.timeout);
	if (detachedSessions.get(detached.sessionID) === detached) detachedSessions.delete(detached.sessionID);
	for (const guildID of detached.players) {
		const key = `${detached.userID}.${guildID}`;
		if (detachedPlayers.get(key) === detached) detachedPlayers.delete(key);
	}
	destroyPlayers(detached.userID, detached.players).catch(() => void 0);
}

async function destroyPlayers(userID: string, guildIDs: Array<string>): Promise<void> {
	const pool = await import("../util/ThreadPool.js");
	const count = guildIDs.filter(id => pool.destroyPlayer(userID, id)).length;
	console.log(`Shutting down ${count} playing players`);
}

export function sendMessage(msg: { clientID: string; data: InternalMessage }): void {
	const key = `${msg.clientID}.${msg.data.guildId}`;
	const ws = playerMap.get(key);
	if (ws) ws.send(Util.stringify(msg.data));
	else detachedPlayers.get(key)?.events.push(msg.data);
}

export function declareClientToPlayer(clientID: string, guildID: string, sessionID: string): void {
	const key = `${clientID}.${guildID}`;
	const socket = connections.get(sessionID);
	if (!socket) return;
	const data = socket.getUserData();
	if (data.players.includes(guildID)) return;
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

export function updateResuming(sessionID: string, resuming: boolean | undefined, timeout: number | undefined): UpdateSessionResult {
	const socket = connections.get(sessionID);
	if (!socket) return { resuming: resuming ?? false, timeout: timeout ?? 60 };
	const data = socket.getUserData();
	if (resuming !== undefined) data.resuming = resuming;
	if (timeout !== undefined) data.resumeTimeout = timeout;
	return { resuming: data.resuming, timeout: data.resumeTimeout };
}

export async function getPlayersForSession(sessionID: string): Promise<Array<PlayerResponse>> {
	const socket = connections.get(sessionID);
	if (!socket) return [];
	const data = socket.getUserData();
	const pool = await import("../util/ThreadPool.js");
	const players = await Promise.all(data.players.map(id => pool.getPlayer(data.userID, id)));
	return players.filter(p => !!p);
}

export async function getPlayerForSession(sessionID: string, guildID: string): Promise<PlayerResponse | null> {
	const socket = connections.get(sessionID);
	if (!socket) return null;
	const data = socket.getUserData();
	const pool = await import("../util/ThreadPool.js");
	return pool.getPlayer(data.userID, guildID);
}

export function getSession(sessionID: string) {
	return connections.get(sessionID);
}

export function sessionExists(sessionID: string): boolean {
	return connections.has(sessionID);
}

export default { handleWSUpgrade, onWSOpen, onWSClose, sendStats, sendMessage, declareClientToPlayer, onPlayerDelete, updateResuming, getPlayersForSession, getPlayerForSession, getSession, sessionExists };
