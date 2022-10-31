import { WebSocketServer, WebSocket } from "ws";

import logger from "../util/Logger.js";
import Constants from "../Constants.js";
import Util from "../util/Util.js";

const wss = new WebSocketServer({ noServer: true });
const socketDeleteTimeouts = new Map<string, { timeout: NodeJS.Timeout; events: Array<any> }>();
const connections = new Map<string, Array<{ socket: import("ws").WebSocket; resumeKey: string | null; resumeTimeout: number }>>();
const voiceServerStates = new Map<string, { clientID: string; guildId: string; sessionId: string; event: { token: string; guild_id: string; endpoint: string } }>();
const playerMap = new Map<string, import("ws").WebSocket>();

const serverLoopInterval: NodeJS.Timeout = setInterval(async () => {
	const stats = await Util.getStats();
	const payload = Object.assign(stats, { op: Constants.STRINGS.STATS });
	const str: string = JSON.stringify(payload);
	for (const client of wss.clients) {
		if (client[Constants.STRINGS.IS_ALIVE] === false) return client.terminate();
		client[Constants.STRINGS.IS_ALIVE] = false;

		if (client.readyState === WebSocket.OPEN) {
			client.ping(Util.noop);
			client.send(str);
		}
	}
}, 1000 * 60);


wss.on("headers", (headers, request) => {
	headers.push(
		`Session-Resumed: ${!!request.headers[Constants.STRINGS.RESUME_KEY] && socketDeleteTimeouts.has(request.headers[Constants.STRINGS.RESUME_KEY] as string)}`,
		`Lavalink-Major-Version: ${lavalinkMajor}`, Constants.STRINGS.IS_VOLCANO_HEADER
	);
});

wss.on(Constants.STRINGS.CONNECTION, async (socket, request) => {
	const userID = request.headers[Constants.STRINGS.USER_ID] as string;
	const stats: import("lavalink-types").Stats = await Util.getStats();
	socket.send(JSON.stringify(Object.assign(stats, { op: Constants.STRINGS.STATS })));
	socket.on(Constants.STRINGS.MESSAGE, data => onClientMessage(socket, data, userID));
	socket[Constants.STRINGS.IS_ALIVE] = true;
	socket.on(Constants.STRINGS.PONG, socketHeartbeat);

	socket.once(Constants.STRINGS.CLOSE, code => onClientClose(socket, userID, code, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
	socket.once(Constants.STRINGS.ERROR, () => onClientClose(socket, userID, 1000, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
});

wss.once("close", () => {
	clearInterval(serverLoopInterval);

	lavalinkLog("Socket server has closed.");

	for (const child of lavalinkThreadPool.children.values()) {
		child.terminate();
	}
});

lavalinkThreadPool.on(Constants.STRINGS.MESSAGE, (_, msg) => {
	const socket = playerMap.get(`${msg.clientID}.${msg.data.guildId}`);
	const entry = [...connections.values()].find(i => i.some(c => c.socket === socket));
	const rKey = entry?.find((c) => c.socket);

	if (rKey?.resumeKey && socketDeleteTimeouts.has(rKey.resumeKey)) socketDeleteTimeouts.get(rKey.resumeKey)!.events.push(msg.data);
	socket?.send(JSON.stringify(msg.data));
});

lavalinkThreadPool.on(Constants.STRINGS.DATA_REQ, (op, data) => {
	if (op === Constants.workerOPCodes.VOICE_SERVER) {
		const v = voiceServerStates.get(`${data.clientID}.${data.guildId}`);

		if (v) lavalinkThreadPool.broadcast({ op: Constants.workerOPCodes.VOICE_SERVER, data: Object.assign(v, { op: "voiceUpdate" }) });
	}
});

function socketHeartbeat(): void {
	this.isAlive = true;
}

export function handleWSUpgrade(request: import("http").IncomingMessage, socket: import("net").Socket, head: Buffer) {
	const userID: string = request.headers[Constants.STRINGS.USER_ID] as string;
	wss.handleUpgrade(request, socket, head, s => {
		if (request.headers[Constants.STRINGS.RESUME_KEY] && socketDeleteTimeouts.has(request.headers[Constants.STRINGS.RESUME_KEY] as string)) {
			const resume = socketDeleteTimeouts.get(request.headers[Constants.STRINGS.RESUME_KEY] as string)!;
			clearTimeout(resume.timeout);
			socketDeleteTimeouts.delete(request.headers[Constants.STRINGS.RESUME_KEY] as string);
			const exist = connections.get(userID);
			if (exist) {
				const pre = exist.find(i => i.resumeKey === request.headers[Constants.STRINGS.RESUME_KEY]);

				if (pre) pre.socket = s;
				else exist.push({ socket: s, resumeKey: null, resumeTimeout: 60 });
			} else connections.set(userID, [{ socket: s, resumeKey: null, resumeTimeout: 60 }]);

			for (const event of resume.events) {
				s.send(JSON.stringify(event));
			}

			lavalinkLog(`Resumed session with key ${request.headers[Constants.STRINGS.RESUME_KEY]}`);
			lavalinkLog(`Replaying ${resume.events.length.toLocaleString()} events`);
			resume.events.length = 0;
			return wss.emit(Constants.STRINGS.CONNECTION, s, request);
		}

		lavalinkLog(Constants.STRINGS.CONNECTION_SUCCESSFULLY_ESTABLISHED);
		const existing = connections.get(userID);
		const pl = { socket: s, resumeKey: null, resumeTimeout: 60 };
		if (existing) existing.push(pl);
		else connections.set(userID, [pl]);
		wss.emit(Constants.STRINGS.CONNECTION, s, request);
	});
}

async function onClientMessage(socket: import("ws").WebSocket, data: import("ws").RawData, userID: string): Promise<void> {
	const buf: string | Buffer = Array.isArray(data)
		? Buffer.concat(data)
		: (data instanceof ArrayBuffer)
			? Buffer.from(data)
			: data;

	const d: string = buf.toString();
	let msg: import("../types.js").InboundPayload;
	try {
		msg = JSON.parse(d);
	} catch {
		return;
	}

	const pl = { op: Constants.workerOPCodes.MESSAGE, data: Object.assign(msg, { clientID: userID }) };

	switch (msg.op) {
	case Constants.OPCodes.PLAY: {
		if (!msg.guildId || !msg.track) return;

		const responses: Array<any> = await lavalinkThreadPool.broadcast(pl);

		if (!responses.includes(true)) lavalinkThreadPool.execute(pl);

		void playerMap.set(`${userID}.${msg.guildId}`, socket);
		break;
	}
	case Constants.OPCodes.VOICE_UPDATE: {
		voiceServerStates.set(`${userID}.${msg.guildId}`, { clientID: userID, guildId: msg.guildId as string, sessionId: msg.sessionId as string, event: msg.event as any });

		setTimeout(() => voiceServerStates.delete(`${userID}.${(msg as { guildId: string }).guildId}`), 20000);

		void lavalinkThreadPool.broadcast({ op: Constants.workerOPCodes.VOICE_SERVER, data: voiceServerStates.get(`${userID}.${msg.guildId}`) });
		break;
	}
	case Constants.OPCodes.STOP:
	case Constants.OPCodes.PAUSE:
	case Constants.OPCodes.DESTROY:
	case Constants.OPCodes.SEEK:
	case Constants.OPCodes.VOLUME:
	case Constants.OPCodes.FILTERS: {
		if (!msg.guildId) return;

		void lavalinkThreadPool.broadcast(pl);
		break;
	}
	case Constants.OPCodes.CONFIGURE_RESUMING: {
		lavalinkLog(msg);
		if (!msg.key) return;

		const entry = connections.get(userID);
		const found = entry!.find(i => i.socket === socket);

		if (found) {
			found.resumeKey = msg.key as string;
			found.resumeTimeout = msg.timeout || 60;
		}
		break;
	}
	case Constants.OPCodes.FFMPEG: {
		if (!msg.guildId || !msg.args || !Array.isArray(msg.args) || !msg.args.every(i => typeof i === Constants.STRINGS.STRING)) return;
		void lavalinkThreadPool.broadcast(pl);
		break;
	}
	default:
		lavalinkLog(msg);
		lavalinkPlugins.forEach(p => p.onWSMessage?.(msg, socket as any));
		break;
	}
}

async function onClientClose(socket: import("ws").WebSocket, userID: string, closeCode: number, extra: { ip: string; port: number }) {
	if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) socket.close(closeCode);

	socket.removeAllListeners();

	const entry = connections.get(userID);
	const found = entry!.find(i => i.socket === socket);

	if (found) {
		if (found.resumeKey) {
			lavalinkLog(`Connection closed from /${extra.ip}:${extra.port} with status CloseStatus[code=${closeCode}, reason=destroy] -- Session can be resumed within the next ${found.resumeTimeout} seconds with key ${found.resumeKey}`);

			const timeout: NodeJS.Timeout = setTimeout(async () => {
				const index = entry!.findIndex(e => e.resumeKey === found.resumeKey);

				if (index !== -1) entry!.splice(index, 1);

				socketDeleteTimeouts.delete(found.resumeKey!);

				if (entry!.length === 0) connections.delete(userID);

				const results: Array<any> = await lavalinkThreadPool.broadcast({ op: Constants.workerOPCodes.DELETE_ALL, data: { clientID: userID } });
				const count: number = results.reduce((acc, cur) => acc + cur, 0);

				lavalinkLog(`Shutting down ${count} playing players`);
			}, (found.resumeTimeout || 60) * 1000);

			socketDeleteTimeouts.set(found.resumeKey, { timeout, events: [] });
		} else {
			const index = entry!.indexOf(found);

			if (index === -1) return logger.error(`Socket delete could not be removed: ${found.resumeKey}\n${index}`);

			entry!.splice(index, 1);

			if (entry!.length === 0) connections.delete(userID);

			const results: Array<any> = await lavalinkThreadPool.broadcast({ op: Constants.workerOPCodes.DELETE_ALL, data: { clientID: userID } });
			const count: number = results.reduce((acc, cur) => acc + cur, 0);

			lavalinkLog(`Shutting down ${count} playing players`);
		}
	}

	for (const key of voiceServerStates.keys())
		if (key.startsWith(userID)) voiceServerStates.delete(key);
}

export default { handleWSUpgrade };
