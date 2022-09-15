const startTime: number = Date.now();

const lavalinkVersion = "3.4";
const lavalinkMajor = lavalinkVersion.split(".")[0];

// Native modules
import HTTP from "http";
import fs from "fs";
import os from "os";
import path from "path";
import * as entities from "html-entities";
import { fileURLToPath } from "url";
import util from "util";

// NPM modules
import yaml from "yaml";
import { WebSocketServer, WebSocket } from "ws";
import * as encoding from "@lavalink/encoding";
import llpkg from "play-dl/package.json" assert { type: "json" };

// Local modules
import Constants from "./Constants.js";
import logger from "./util/Logger.js";
import ThreadPool from "./util/ThreadPool.js";
import Util from "./util/Util.js";

logger.warn("You can safely ignore the node ExperimentalWarning regarding importing JSON files");
const dirname = fileURLToPath(path.dirname(import.meta.url));

const cpuCount = os.cpus().length;
const pool = new ThreadPool({
	size: cpuCount,
	dir: path.join(dirname, "./worker.js")
});

const configDir: string = path.join(process.cwd(), "./application.yml");
let cfgparsed: import("./types.js").LavaLinkConfig;

if (fs.existsSync(configDir)) {
	const cfgyml: string = fs.readFileSync(configDir, { encoding: Constants.STRINGS.UTF8 });
	cfgparsed = yaml.parse(cfgyml);
} else cfgparsed = {};

global.lavalinkConfig = Util.mixin({}, Constants.defaultOptions, cfgparsed) as typeof Constants.defaultOptions;
import * as lamp from "play-dl";

const keyDir = path.join(dirname, "../soundcloud.txt");

const plugins: Array<import("./types.js").Plugin> = [];

async function keygen() {
	const clientID = await lamp.getFreeClientID();
	if (!clientID) throw new Error("SOUNDCLOUD_KEY_NO_CREATE");
	fs.writeFileSync(keyDir, clientID, { encoding: Constants.STRINGS.UTF8 });
	await lamp.setToken({ soundcloud : { client_id : clientID } });
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

const rootLog: typeof logger.info = logger[lavalinkConfig.logging.level.root?.toLowerCase?.()] ?? logger.info;
const llLog: typeof logger.info = logger[lavalinkConfig.logging.level.lavalink?.toLowerCase?.()] ?? logger.info;

let username: string;
try {
	username = os.userInfo().username;
} catch {
	username = "unknown user";
}

const platformNames = {
	"aix": "AIX",
	"android": "Android",
	"darwin": "Darwin",
	"freebsd": "FreeBSD",
	"haiku": "Haiku",
	"linux": "Linux",
	"openbsd": "OpenBSD",
	"sunos": "SunOS",
	"win32": "Windows",
	"cygwin": "Cygwin",
	"netbsd": "NetBSD"
};

if (lavalinkConfig.spring.main["banner-mode"] === "log")
	rootLog("\n" +
					"\x1b[33m__      __   _                                \x1b[97moOOOOo\n" +
					"\x1b[33m\\ \\    / /  | |                             \x1b[97mooOOoo  oo\n" +
					"\x1b[33m \\ \\  / /__ | | ___ __ _ _ __   ___        \x1b[0m/\x1b[31mvvv\x1b[0m\\    \x1b[97mo\n" +
					"\x1b[33m  \\ \\/ / _ \\| |/ __/ _` | '_ \\ / _ \\      \x1b[0m/\x1b[31mV V V\x1b[0m\\\n" +
					"\x1b[33m   \\  / (_) | | (_| (_| | | | | (_) |    \x1b[0m/   \x1b[31mV   \x1b[0m\\\n" +
					"\x1b[33m    \\/ \\___/|_|\\___\\__,_|_| |_|\\___/  \x1b[0m/\\/     \x1b[31mVV  \x1b[0m\\");

rootLog(`\n\n\nLavaLink base version: ${lavalinkVersion}\nNode:                  ${process.version}\nLavaLamp version:      ${llpkg.version}\n\n`);
rootLog(`Starting Launcher using Node ${process.version.replace("v", "")} on ${os.hostname()} with PID ${process.pid} (${fileURLToPath(import.meta.url)} started by ${username} in ${process.cwd()})`);
rootLog(`OS: ${platformNames[process.platform] || process.platform} ${os.release()?.split(".")[0] || "Unknown release"} Arch: ${process.arch}`);
rootLog(`Using ${cpuCount} worker threads in pool`);

const http: HTTP.Server = HTTP.createServer(serverHandler);
const ws = new WebSocketServer({ noServer: true });

const connections = new Map<string, Array<{ socket: import("ws").WebSocket; resumeKey: string | null; resumeTimeout: number }>>();
const voiceServerStates = new Map<string, { clientID: string; guildId: string; sessionId: string; event: { token: string; guild_id: string; endpoint: string } }>();
const socketDeleteTimeouts = new Map<string, { timeout: NodeJS.Timeout; events: Array<any> }>();
const playerMap = new Map<string, import("ws").WebSocket>();

pool.on(Constants.STRINGS.MESSAGE, (_, msg) => {
	const socket = playerMap.get(`${msg.clientID}.${msg.data.guildId}`);
	const entry = [...connections.values()].find(i => i.some(c => c.socket === socket));
	const rKey = entry?.find((c) => c.socket);

	if (rKey?.resumeKey && socketDeleteTimeouts.has(rKey.resumeKey)) socketDeleteTimeouts.get(rKey.resumeKey)!.events.push(msg.data);
	socket?.send(JSON.stringify(msg.data));
});

pool.on(Constants.STRINGS.DATA_REQ, (op, data) => {
	if (op === Constants.workerOPCodes.VOICE_SERVER) {
		const v = voiceServerStates.get(`${data.clientID}.${data.guildId}`);

		if (v) pool.broadcast({ op: Constants.workerOPCodes.VOICE_SERVER, data: v });
	}
});

async function getStats(): Promise<import("./types.js").Stats> {
	const memory = process.memoryUsage();
	const free: number = memory.heapTotal - memory.heapUsed;
	const pload: number = await Util.processLoad();
	const osload: Array<number> = os.loadavg();
	const threadStats: Array<{ players: number; playingPlayers: number; }> = await pool.broadcast({ op: Constants.workerOPCodes.STATS });
	return {
		players: threadStats.reduce((acc, cur) => acc + cur.players, 0),
		playingPlayers: threadStats.reduce((acc, cur) => acc + cur.playingPlayers, 0),
		uptime: process.uptime() * 1000,
		memory: {
			reservable: memory.heapTotal - free,
			used: memory.heapUsed,
			free: free,
			allocated: memory.rss
		},
		cpu: {
			cores: cpuCount,
			systemLoad: osload[0],
			lavalinkLoad: pload
		},
		frameStats: {
			sent: 0,
			nulled: 0,
			deficit: 0
		}
	};
}

function socketHeartbeat(): void {
	this.isAlive = true;
}

function noop(): void { void 0; }

ws.on("headers", (headers, request) => {
	headers.push(`Session-Resumed: ${!!request.headers[Constants.STRINGS.RESUME_KEY] && socketDeleteTimeouts.has(request.headers[Constants.STRINGS.RESUME_KEY] as string)}`, `Lavalink-Major-Version: ${lavalinkMajor}`, Constants.STRINGS.IS_VOLCANO_HEADER);
});

const allDigitRegex = /^\d+$/;
http.on("upgrade", (request: HTTP.IncomingMessage, socket: import("net").Socket, head: Buffer) => {
	llLog(`Incoming connection from /${request.socket.remoteAddress}:${request.socket.remotePort}`);

	const temp401 = "HTTP/1.1 401 Unauthorized\r\n\r\n";

	const passwordIncorrect: boolean = (lavalinkConfig.lavalink.server.password !== undefined && request.headers.authorization !== String(lavalinkConfig.lavalink.server.password));
	const invalidUserID: boolean = (!request.headers[Constants.STRINGS.USER_ID] || Array.isArray(request.headers[Constants.STRINGS.USER_ID]) || !allDigitRegex.test(request.headers[Constants.STRINGS.USER_ID] as string));
	if (passwordIncorrect || invalidUserID) {
		return socket.write(temp401, () => {
			socket.end();
			socket.destroy();
		});
	}
	const userID: string = request.headers[Constants.STRINGS.USER_ID] as string;

	ws.handleUpgrade(request, socket, head, s => {
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

			llLog(`Resumed session with key ${request.headers[Constants.STRINGS.RESUME_KEY]}`);
			llLog(`Replaying ${resume.events.length.toLocaleString()} events`);
			resume.events.length = 0;
			return ws.emit(Constants.STRINGS.CONNECTION, s, request);
		}

		llLog(Constants.STRINGS.CONNECTION_SUCCESSFULLY_ESTABLISHED);
		const existing = connections.get(userID);
		const pl = { socket: s, resumeKey: null, resumeTimeout: 60 };
		if (existing) existing.push(pl);
		else connections.set(userID, [pl]);
		ws.emit(Constants.STRINGS.CONNECTION, s, request);
	});
});

ws.on(Constants.STRINGS.CONNECTION, async (socket, request) => {
	const userID: string = request.headers[Constants.STRINGS.USER_ID] as string;
	const stats: import("./types.js").Stats = await getStats();
	socket.send(JSON.stringify(Object.assign(stats, { op: Constants.STRINGS.STATS })));
	socket.on(Constants.STRINGS.MESSAGE, data => onClientMessage(socket, data, userID));
	socket[Constants.STRINGS.IS_ALIVE] = true;
	socket.on(Constants.STRINGS.PONG, socketHeartbeat);

	socket.once(Constants.STRINGS.CLOSE, code => onClientClose(socket, userID, code, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
	socket.once(Constants.STRINGS.ERROR, () => onClientClose(socket, userID, 1000, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
});

async function onClientMessage(socket: import("ws").WebSocket, data: import("ws").RawData, userID: string): Promise<void> {
	const buf: string | Buffer = Array.isArray(data)
		? Buffer.concat(data)
		: (data instanceof ArrayBuffer)
			? Buffer.from(data)
			: data;

	const d: string = buf.toString();
	let msg: import("./types.js").InboundPayload;
	try {
		msg = JSON.parse(d);
	} catch {
		return;
	}

	llLog(msg);

	const pl = { op: Constants.workerOPCodes.MESSAGE, data: Object.assign(msg, { clientID: userID }) };

	switch (msg.op) {
	case Constants.OPCodes.PLAY: {
		if (!msg.guildId || !msg.track) return;

		const responses: Array<any> = await pool.broadcast(pl);

		if (!responses.includes(true)) pool.execute(pl);

		void playerMap.set(`${userID}.${msg.guildId}`, socket);
		break;
	}
	case Constants.OPCodes.VOICE_UPDATE: {
		voiceServerStates.set(`${userID}.${msg.guildId}`, { clientID: userID, guildId: msg.guildId as string, sessionId: msg.sessionId as string, event: msg.event as any });

		setTimeout(() => voiceServerStates.delete(`${userID}.${msg.guildId}`), 20000);

		void pool.broadcast({ op: Constants.workerOPCodes.VOICE_SERVER, data: voiceServerStates.get(`${userID}.${msg.guildId}`) });
		break;
	}
	case Constants.OPCodes.STOP:
	case Constants.OPCodes.PAUSE:
	case Constants.OPCodes.DESTROY:
	case Constants.OPCodes.SEEK:
	case Constants.OPCodes.VOLUME:
	case Constants.OPCodes.FILTERS: {
		if (!msg.guildId) return;

		void pool.broadcast(pl);
		break;
	}
	case Constants.OPCodes.CONFIGURE_RESUMING: {
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
		void pool.broadcast(pl);
		break;
	}
	case Constants.OPCodes.DUMP: {
		pool.dump();
		break;
	}
	case Constants.OPCodes.PING: {
		const payload = { op: Constants.STRINGS.PONG } as { op: "pong"; ping?: number };
		if (msg.guildId) {
			const threadStats: Array<{ pings: { [guildId: string]: number }; }> = await pool.broadcast({ op: Constants.workerOPCodes.STATS });
			for (const worker of threadStats)
				if (worker.pings[msg.guildId] !== undefined) payload.ping = worker.pings[msg.guildId];
		}
		socket.send(JSON.stringify(payload));
		break;
	}
	default:
		plugins.forEach(p => p.onWSMessage?.(msg, socket));
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
			llLog(`Connection closed from /${extra.ip}:${extra.port} with status CloseStatus[code=${closeCode}, reason=destroy] -- Session can be resumed within the next ${found.resumeTimeout} seconds with key ${found.resumeKey}`);

			const timeout: NodeJS.Timeout = setTimeout(async () => {
				const index = entry!.findIndex(e => e.resumeKey === found.resumeKey);

				if (index !== -1) entry!.splice(index, 1);

				socketDeleteTimeouts.delete(found.resumeKey as string);

				if (entry!.length === 0) connections.delete(userID);

				const results: Array<any> = await pool.broadcast({ op: Constants.workerOPCodes.DELETE_ALL, data: { clientID: userID } });
				const count: number = results.reduce((acc, cur) => acc + cur, 0);

				llLog(`Shutting down ${count} playing players`);
			}, (found.resumeTimeout || 60) * 1000);

			socketDeleteTimeouts.set(found.resumeKey, { timeout, events: [] });
		} else {
			const index = entry!.indexOf(found);

			if (index === -1) return logger.error(`Socket delete could not be removed: ${found.resumeKey}\n${index}`);

			entry!.splice(index, 1);

			if (entry!.length === 0) connections.delete(userID);

			const results: Array<any> = await pool.broadcast({ op: Constants.workerOPCodes.DELETE_ALL, data: { clientID: userID } });
			const count: number = results.reduce((acc, cur) => acc + cur, 0);

			llLog(`Shutting down ${count} playing players`);
		}
	}

	for (const key of voiceServerStates.keys())
		if (key.startsWith(userID)) voiceServerStates.delete(key);
}

const serverLoopInterval: NodeJS.Timeout = setInterval(async () => {
	const stats = await getStats();
	const payload: import("./types.js").OutboundPayload = Object.assign(stats, { op: Constants.STRINGS.STATS });
	const str: string = JSON.stringify(payload);
	for (const client of ws.clients) {
		if (client[Constants.STRINGS.IS_ALIVE] === false) return client.terminate();
		client[Constants.STRINGS.IS_ALIVE] = false;

		if (client.readyState === WebSocket.OPEN) {
			client.ping(noop);
			client.send(str);
		}
	}
}, 1000 * 60);

const IDRegex = /(?:(\w{1,4})search:)?(.+)/;

async function serverHandler(req: import("http").IncomingMessage, res: import("http").ServerResponse): Promise<unknown> {
	const reqUrl = new URL(req.url || Constants.STRINGS.SLASH, `http://${req.headers.host}`);
	const reqPath = reqUrl.pathname;
	const query = reqUrl.searchParams;

	// This is just for rest. Upgrade requests for the websocket are handled in the http upgrade event.
	if (reqPath !== Constants.STRINGS.SLASH && lavalinkConfig.lavalink.server.password && (!req.headers.authorization || req.headers.authorization !== String(lavalinkConfig.lavalink.server.password))) {
		logger.warn(`Authorization missing for ${req.socket.remoteAddress} on ${req.method!.toUpperCase()} ${reqPath}`);
		return res.writeHead(401, Constants.STRINGS.UNAUTHORIZED, Object.assign({}, Constants.baseHTTPResponseHeaders, { [Constants.STRINGS.CONTENT_TYPE_CAPPED]: Constants.STRINGS.TEXT_PLAIN })).end(Constants.STRINGS.UNAUTHORIZED);
	}

	// Wake My Dyno does not like Volcano at all for whatever reason, so support was removed.
	if (reqPath === Constants.STRINGS.SLASH && req.method === Constants.STRINGS.GET) return res.writeHead(200, Constants.STRINGS.OK, Object.assign({}, Constants.baseHTTPResponseHeaders, { [Constants.STRINGS.CONTENT_TYPE_CAPPED]: Constants.STRINGS.TEXT_PLAIN })).end(Constants.STRINGS.OK_BOOMER);

	else if (reqPath === Constants.STRINGS.LOADTRACKS && req.method === Constants.STRINGS.GET) {
		const id = query.get(Constants.STRINGS.IDENTIFIER);
		const payload = {
			playlistInfo: {},
			tracks: [] as Array<any>
		};

		if (!id || typeof id !== Constants.STRINGS.STRING) return Util.standardErrorHandler(Constants.STRINGS.INVALID_IDENTIFIER, res, payload, llLog);

		const identifier = entities.decode(id);

		llLog(`Got request to load for identifier "${identifier}"`);

		const match = identifier.match(IDRegex);
		if (!match) return Util.standardErrorHandler(Constants.STRINGS.IDENTIFIER_DIDNT_MATCH_REGEX, res, payload, llLog); // Should theoretically never happen, but TypeScript doesn't know this

		const isSearch = !!match[1];
		const resource = match[2];

		if (!resource) return Util.standardErrorHandler(Constants.STRINGS.INVALID_IDENTIFIER, res, payload, llLog);

		try {
			const assignResults = (result: Awaited<ReturnType<NonNullable<import("./types.js").Plugin["infoHandler"]>>>, source: string) => {
				payload.tracks = result.entries.map(t => ({
					track: encoding.encode(Object.assign({ flags: 1, version: 2, source: source, position: BigInt(0), probeInfo: t[Constants.STRINGS.PROBE_INFO] }, t, { length: BigInt(t.length) })),
					info: Object.assign({ position: 0 }, t)
				}));
				if (result.plData) payload.playlistInfo = result.plData;
			};

			const searchablePlugin = plugins.find(p => p.searchShort && isSearch && match[1] === p.searchShort);
			if (searchablePlugin && searchablePlugin.canBeUsed?.(resource, true)) {
				if (searchablePlugin.source && lavalinkConfig.lavalink.server.sources[searchablePlugin.source] !== undefined && !lavalinkConfig.lavalink.server.sources[searchablePlugin.source]) return Util.standardErrorHandler(`${searchablePlugin.source} is not enabled`, res, payload, llLog, Constants.STRINGS.LOAD_FAILED);
				if ((searchablePlugin.source === Constants.STRINGS.YOUTUBE || searchablePlugin.source === Constants.STRINGS.SOUNDCLOUD) && !lavalinkConfig.lavalink.server[`${searchablePlugin.source}SearchEnabled`]) return Util.standardErrorHandler(`${searchablePlugin.source} searching is not enabled`, res, payload, llLog, Constants.STRINGS.LOAD_FAILED);
				const result = await searchablePlugin.infoHandler?.(resource, true);
				if (result && searchablePlugin.source) assignResults(result, searchablePlugin.source);
			} else {
				const found = plugins.find(p => p.canBeUsed?.(resource, false));
				if (found) {
					if (found.source && lavalinkConfig.lavalink.server.sources[found.source] !== undefined && !lavalinkConfig.lavalink.server.sources[found.source]) return Util.standardErrorHandler(`${found.source} is not enabled`, res, payload, llLog, Constants.STRINGS.LOAD_FAILED);
					const result = await found.infoHandler?.(resource, false);
					if (result && found.source) assignResults(result, found.source);
				} else {
					const yt = plugins.find(p => p.source === Constants.STRINGS.YOUTUBE)!;
					const result = await yt.infoHandler?.(resource, true);
					if (result) assignResults(result, yt.source!);
				}
			}
		} catch (e) {
			return Util.standardErrorHandler(e, res, payload, llLog);
		}

		if (payload.tracks.length === 0) return Util.standardErrorHandler(Constants.STRINGS.NO_MATCHES_LOWER, res, payload, llLog, Constants.STRINGS.NO_MATCHES);
		else return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(Object.assign({ loadType: payload.tracks.length > 1 && isSearch ? Constants.STRINGS.SEARCH_RESULT : payload.playlistInfo[Constants.STRINGS.NAME] ? Constants.STRINGS.PLAYLIST_LOADED : Constants.STRINGS.TRACK_LOADED }, payload)));
	}

	else if (reqPath === Constants.STRINGS.DECODETRACKS && req.method === Constants.STRINGS.GET) {
		let track = query.get(Constants.STRINGS.TRACK) as string | Array<string> | null;
		llLog(`Got request to decode for track "${track}"`);
		try {
			// @ts-expect-error
			if (track) track = entities.decode(track);
			// @ts-expect-error
			const r = JSON.parse(track);
			track = r;
		} catch {
			// Just do nothing
		}
		if (!track || !(typeof track === Constants.STRINGS.STRING || (Array.isArray(track) && track.every(i => typeof i === Constants.STRINGS.STRING)))) return Util.standardErrorHandler(Constants.STRINGS.INVALID_TRACK, res, {}, llLog);

		let data: ReturnType<typeof convertDecodedTrackToResponse> | Array<{ track: string; info: ReturnType<typeof convertDecodedTrackToResponse> }> | undefined;

		if (Array.isArray(track)) {
			data = track.map(i => ({
				track: i,
				info: convertDecodedTrackToResponse(encoding.decode(i))
			}));
		} else data = convertDecodedTrackToResponse(encoding.decode(track));

		return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(data));
	} else {
		const filtered = plugins.filter(p => !!p.routeHandler);
		for (const plugin of filtered) {
			await plugin.routeHandler!(reqUrl, req, res);
		}
	}

	res.writeHead(404, Constants.STRINGS.NOT_FOUND, Constants.baseHTTPResponseHeaders).end(Constants.STRINGS.NOT_FOUND);
}

function convertDecodedTrackToResponse(data: import("@lavalink/encoding").TrackInfo) {
	return {
		identifier: data.identifier,
		isSeekable: !data.isStream,
		author: data.author,
		length: Number(data.length),
		isStream: data.isStream,
		position: Number(data.position),
		title: data.title,
		uri: data.uri,
		sourceName: data.source,
		probeInfo: data.probeInfo
	};
}

http.listen(lavalinkConfig.server.port as number, lavalinkConfig.server.address, () => {
	rootLog("Volcano is ready to accept connections.");
});
rootLog(`Server started on port(s) ${lavalinkConfig.server.port} (http)`);

ws.once("close", () => {
	clearInterval(serverLoopInterval);

	rootLog("Socket server has closed.");

	for (const child of pool.children.values()) {
		child.terminate();
	}
});

process.title = "Volcano";

let pushToEnd: import("./types.js").Plugin | undefined = undefined;

const sources = path.join(dirname, "./sources");
for (const file of await fs.promises.readdir(sources)) {
	if (!file.endsWith(Constants.STRINGS.DOT_JS)) continue;
	let constructed: import("./types.js").Plugin;
	try {
		const module = await import(`file://${path.join(sources, file)}`);
		constructed = new module.default();
		constructed.setVariables?.(logger);
		await constructed.initialize?.();
	} catch (e) {
		logger.warn(`Source from ${file} had errors when initializing and has been ignored from the source list`);
		logger.error(util.inspect(e, true, Infinity, true));
		continue;
	}
	if (constructed.source === Constants.STRINGS.HTTP) pushToEnd = constructed;
	else plugins.push(constructed);
}

const pluginsDir = path.join(dirname, "../plugins");
const isDir = await fs.promises.stat(pluginsDir).then(s => s.isDirectory()).catch(() => false);
if (isDir) {
	for (const file of await fs.promises.readdir(pluginsDir)) {
		if (!file.endsWith(Constants.STRINGS.DOT_JS)) continue;
		let constructed: import("./types.js").Plugin;
		try {
			const module = await import(`file://${path.join(pluginsDir, file)}`);
			constructed = new module.default();
			constructed.setVariables?.(logger);
			await constructed.initialize?.();
		} catch (e) {
			logger.warn(`Plugin from ${file} had errors when initializing and has been ignored from the plugin list`);
			logger.error(util.inspect(e, true, Infinity, true));
			continue;
		}
		if (plugins.find(p => p.source && constructed.source && p.source === constructed.source)) logger.warn(`Plugin for ${constructed.source} has duplicates and could possibly be unused`);
		plugins.push(constructed);
		if (constructed.source) rootLog(`Loaded plugin for ${constructed.source}`);
	}
}

if (pushToEnd) plugins.push(pushToEnd);

rootLog(`Started Launcher in ${(Date.now() - startTime) / 1000} seconds (Node running for ${process.uptime()})`);
logger.warn("You can also safely ignore errors regarding the Fetch API being an experimental feature");

process.on("unhandledRejection", e => logger.error(util.inspect(e, true, Infinity, true)));
process.on("uncaughtException", (e, origin) => logger.error(`${util.inspect(e, true, Infinity, true)}\n${util.inspect(origin)}`));
