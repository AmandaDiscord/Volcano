const startTime: number = Date.now();

const { version } = require("../package.json") as { version: string; };
const lavalinkVersion = "3.4";
const lavalinkMajor = lavalinkVersion.split(".")[0];

// Native modules
import HTTP from "http";
import fs from "fs";
import os from "os";
import path from "path";
import * as entities from "html-entities";

// NPM modules
import yaml from "yaml";
import WebSocket from "ws";
import * as encoding from "@lavalink/encoding";
import { version as LavalampVersion } from "lava-lamp/package.json";

// Local modules
import Constants from "./Constants";
import logger from "./util/Logger";
import ThreadPool from "./util/ThreadPool";
import Util from "./util/Util";

const cpuCount = os.cpus().length;
const pool = new ThreadPool({
	size: cpuCount,
	dir: path.join(__dirname, "./worker.js")
});

const configDir: string = path.join(process.cwd(), "./application.yml");
let cfgparsed: import("./types").LavaLinkConfig;

if (fs.existsSync(configDir)) {
	const cfgyml: string = fs.readFileSync(configDir, { encoding: "utf-8" });
	cfgparsed = yaml.parse(cfgyml);
} else cfgparsed = {};

global.lavalinkConfig = Util.mixin({}, Constants.defaultOptions, cfgparsed) as typeof Constants.defaultOptions;
import * as lamp from "lava-lamp"; // Can load this now that global constants are assigned

// Source getters
import getHTTPAsSource from "./sources/http";
import getLocalAsSource from "./sources/local";
import getSoundCloudAsSource from "./sources/soundcloud";
import getYoutubeAsSource from "./sources/youtube";


const keyDir = path.join(__dirname, "../soundcloud.txt");

function keygen() {
	lamp.getFreeClientID().then(clientID => {
		if (!clientID) throw new Error("SOUNDCLOUD_KEY_NO_CREATE");
		fs.writeFileSync(keyDir, clientID, { encoding: "utf-8" });
		lamp.setToken({ soundcloud : { client_id : clientID } });
	});
}

if (fs.existsSync(keyDir)) {
	if (Date.now() - fs.statSync(keyDir).mtime.getTime() >= (1000 * 60 * 60 * 24 * 7)) keygen();
	else {
		const APIKey = fs.readFileSync(keyDir, { encoding: "utf-8" });
		lamp.setToken({ soundcloud: { client_id: APIKey } });
	}
} else keygen();

lamp.setToken({ useragent: [Constants.fakeAgent] });
if (lavalinkConfig.lavalink.server.youtubeCookie) lamp.setToken({ youtube: { cookie: lavalinkConfig.lavalink.server.youtubeCookie } });

const rootLog: typeof logger.info = logger[lavalinkConfig.logging.level.root?.toLowerCase?.()] ?? logger.info;
const llLog: typeof logger.info = logger[lavalinkConfig.logging.level.lavalink?.toLowerCase?.()] ?? logger.info;

let username: string;
try {
	username = os.userInfo().username;
} catch {
	username = "unknown user";
}

type p = NodeJS.Platform;

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

rootLog(`\n\n\nVersion:               ${version}\nLavaLink base version: ${lavalinkVersion}\nNode:                  ${process.version}\nLavaLamp version:      ${LavalampVersion}\n\n`);
rootLog(`Starting on ${os.hostname()} with PID ${process.pid} (${__filename} started by ${username} in ${process.cwd()})`);
rootLog(`OS: ${platformNames[process.platform] || process.platform} ${os.release()?.split(".")[0] || "Unknown release"} Arch: ${process.arch}`);
rootLog(`Using ${cpuCount} worker threads in pool`);

const http: HTTP.Server = HTTP.createServer(serverHandler);
const ws = new WebSocket.Server({ noServer: true });

const connections = new Map<string, Array<{ socket: WebSocket; resumeKey: string | null; resumeTimeout: number }>>();
const voiceServerStates = new Map<string, { clientID: string; guildId: string; sessionId: string; event: { token: string; guild_id: string; endpoint: string } }>();
const socketDeleteTimeouts = new Map<string, { timeout: NodeJS.Timeout; events: Array<any> }>();
const playerMap = new Map<string, WebSocket>();

pool.on("message", (_, msg) => {
	const socket = playerMap.get(`${msg.clientID}.${msg.data.guildId}`);
	const entry = [...connections.values()].find(i => i.some(c => c.socket === socket));
	const rKey = entry?.find((c) => c.socket);

	if (rKey?.resumeKey && socketDeleteTimeouts.has(rKey.resumeKey)) socketDeleteTimeouts.get(rKey.resumeKey)!.events.push(msg.data);
	socket?.send(JSON.stringify(msg.data));
});

pool.on("datareq", (op, data) => {
	if (op === Constants.workerOPCodes.VOICE_SERVER) {
		const v = voiceServerStates.get(`${data.clientID}.${data.guildId}`);

		if (v) pool.broadcast({ op: Constants.workerOPCodes.VOICE_SERVER, data: v });
	}
});

async function getStats(): Promise<import("./types").Stats> {
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
	headers.push(`Session-Resumed: ${!!request.headers["resume-key"] && socketDeleteTimeouts.has(request.headers["resume-key"] as string)}`, `Lavalink-Major-Version: ${lavalinkMajor}`, "Is-Volcano: true");
});

http.on("upgrade", (request: HTTP.IncomingMessage, socket: import("net").Socket, head: Buffer) => {
	llLog(`Incoming connection from /${request.socket.remoteAddress}:${request.socket.remotePort}`);

	const temp401 = "HTTP/1.1 401 Unauthorized\r\n\r\n";

	const passwordIncorrect: boolean = (lavalinkConfig.lavalink.server.password !== undefined && request.headers.authorization !== String(lavalinkConfig.lavalink.server.password));
	const invalidUserID: boolean = (!request.headers["user-id"] || Array.isArray(request.headers["user-id"]) || !/^\d+$/.test(request.headers["user-id"]));
	if (passwordIncorrect || invalidUserID) {
		return socket.write(temp401, () => {
			socket.end();
			socket.destroy();
		});
	}
	const userID: string = request.headers["user-id"] as string;

	ws.handleUpgrade(request, socket, head, s => {
		if (request.headers["resume-key"] && socketDeleteTimeouts.has(request.headers["resume-key"] as string)) {
			const resume = socketDeleteTimeouts.get(request.headers["resume-key"] as string)!;
			clearTimeout(resume.timeout);
			socketDeleteTimeouts.delete(request.headers["resume-key"] as string);
			const exist = connections.get(userID);
			if (exist) {
				const pre = exist.find(i => i.resumeKey === request.headers["resume-key"]);

				if (pre) pre.socket = s;
				else exist.push({ socket: s, resumeKey: null, resumeTimeout: 60 });
			} else connections.set(userID, [{ socket: s, resumeKey: null, resumeTimeout: 60 }]);

			for (const event of resume.events) {
				s.send(JSON.stringify(event));
			}

			llLog(`Resumed session with key ${request.headers["resume-key"]}`);
			llLog(`Replaying ${resume.events.length.toLocaleString()} events`);
			resume.events.length = 0;
			return ws.emit("connection", s, request);
		}

		llLog("Connection successfully established");
		const existing = connections.get(userID);
		const pl = { socket: s, resumeKey: null, resumeTimeout: 60 };
		if (existing) existing.push(pl);
		else connections.set(userID, [pl]);
		ws.emit("connection", s, request);
	});
});

ws.on("connection", async (socket, request) => {
	const userID: string = request.headers["user-id"] as string;
	const stats: import("./types").Stats = await getStats();
	socket.send(JSON.stringify(Object.assign(stats, { op: "stats" })));
	socket.on("message", data => onClientMessage(socket, data, userID));
	// @ts-ignore
	socket.isAlive = true;
	socket.on("pong", socketHeartbeat);

	socket.once("close", code => onClientClose(socket, userID, code, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
	socket.once("error", () => onClientClose(socket, userID, 1000, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
});

async function onClientMessage(socket: WebSocket, data: WebSocket.Data, userID: string): Promise<void> {
	const buf: string | Buffer = Array.isArray(data)
		? Buffer.concat(data)
		: (data instanceof ArrayBuffer)
			? Buffer.from(data)
			: data;

	const d: string = buf.toString();
	const msg: import("./types").InboundPayload = JSON.parse(d);

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
		if (!msg.guildId || !msg.args || !Array.isArray(msg.args) || !msg.args.every(i => typeof i === "string")) return;
		void pool.broadcast(pl);
		break;
	}
	case Constants.OPCodes.DUMP: {
		pool.dump();
		break;
	}
	}
}

async function onClientClose(socket: WebSocket, userID: string, closeCode: number, extra: { ip: string; port: number }) {
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
	const payload: import("./types").OutboundPayload = Object.assign(stats, { op: "stats" as const });
	const str: string = JSON.stringify(payload);
	for (const client of ws.clients) {
		// @ts-ignore
		if (client.isAlive === false) return client.terminate();
		// @ts-ignore
		client.isAlive = false;

		if (client.readyState === WebSocket.OPEN) {
			client.ping(noop);
			client.send(str);
		}
	}
}, 1000 * 60);

const IDRegex = /(ytsearch:)?(scsearch:)?(.+)/;

async function serverHandler(req: import("http").IncomingMessage, res: import("http").ServerResponse): Promise<unknown> {
	const reqUrl = new URL(req.url || "/", `http://${req.headers.host}`);
	const reqPath = reqUrl.pathname;
	const query = reqUrl.searchParams;

	// This is just for rest. Upgrade requests for the websocket are handled in the http upgrade event.
	if (reqPath !== "/" && lavalinkConfig.lavalink.server.password && (!req.headers.authorization || req.headers.authorization !== String(lavalinkConfig.lavalink.server.password))) {
		logger.warn(`Authorization missing for ${req.socket.remoteAddress} on ${req.method!.toUpperCase()} ${reqPath}`);
		res.writeHead(401, "Unauthorized", Object.assign({}, Constants.baseHTTPResponseHeaders, { "Content-Type": "text/plain" })).write("Unauthorized");
		return res.end();
	}

	// Wake My Dyno does not like Volcano at all for whatever reason, so support was removed.
	if (reqPath === "/" && req.method === "GET") {
		res.writeHead(200, "OK", Object.assign({}, Constants.baseHTTPResponseHeaders, { "Content-Type": "text/plain" })).write("Ok boomer.");
		return res.end();
	}

	if (reqPath === "/loadtracks" && req.method === "GET") {
		const id = query.get("identifier");
		const payload = { playlistInfo: {}, tracks: [] as Array<any> };
		let playlist = false;

		if (!id || typeof id !== "string") return Util.standardErrorHandler("Invalid or no identifier query string provided.", res, payload, llLog);

		const identifier = entities.decode(id);

		llLog(`Got request to load for identifier "${identifier}"`);

		const match = identifier.match(IDRegex);
		if (!match) return Util.standardErrorHandler("Identifier did not match regex", res, payload, llLog);

		let isYouTubeSearch = !!match[1];
		const isSoundcloudSearch = !!match[2];
		const resource = match[3];

		const canDefaultToSoundCloudSearch = (lavalinkConfig.lavalink.server.sources.soundcloud && lavalinkConfig.lavalink.server.soundcloudSearchEnabled) && (!lavalinkConfig.lavalink.server.sources.youtube || !lavalinkConfig.lavalink.server.youtubeSearchEnabled);

		if (!resource) return Util.standardErrorHandler("Invalid or no identifier query string provided.", res, payload, llLog);

		let url: URL | undefined;
		if (resource.startsWith("http")) url = new URL(resource);

		const doSoundCloudSearch = async () => { // YouTube can fallback to SoundCloud if YouTube is disabled
			if ((isSoundcloudSearch || isYouTubeSearch) && !lavalinkConfig.lavalink.server.soundcloudSearchEnabled) {
				res.writeHead(200, "OK", Constants.baseHTTPResponseHeaders).write(JSON.stringify(Object.assign(payload, { loadType: "LOAD_FAILED", exception: { message: "Soundcloud searching is not enabled.", severity: "COMMON" } })));
				res.end();
				return false;
			}
			const data = await getSoundCloudAsSource(resource, isSoundcloudSearch || isYouTubeSearch).catch(e => Util.standardErrorHandler(e, res, payload, llLog));

			if (!data) return false;

			const tracks = data.map(info => ({ track: encoding.encode(Object.assign({ flags: 1, version: 2, source: "soundcloud" }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) })), info }));

			if (tracks.length === 0) {
				Util.standardErrorHandler("Could not extract SoundCloud info.", res, payload, llLog, "NO_MATCHES");
				return false;
			} else {
				payload.tracks = tracks;
				llLog(`Loaded track ${tracks[0].info.title}`);
				return true;
			}
		};

		if ((isSoundcloudSearch || (url && url.hostname === soundCloudURL.hostname) || (isYouTubeSearch && canDefaultToSoundCloudSearch))) {
			if (!lavalinkConfig.lavalink.server.sources.soundcloud) {
				res.writeHead(200, "OK", Constants.baseHTTPResponseHeaders).write(JSON.stringify(Object.assign(payload, { loadType: "LOAD_FAILED", exception: { message: "Soundcloud is not enabled.", severity: "COMMON" } })));
				return res.end();
			}

			const r = await doSoundCloudSearch();
			if (!r) return;
		} else if (path.isAbsolute(resource)) {
			if (!lavalinkConfig.lavalink.server.sources.local) return Util.standardErrorHandler("Local is not enabled.", res, payload, llLog);

			const data = await getLocalAsSource(resource).catch(e => Util.standardErrorHandler(e, res, payload, llLog));
			if (!data) return;

			const encoded = encoding.encode(Object.assign({ flags: 1, version: 2, source: "local" }, data, { position: BigInt(0), length: BigInt(data.length), isStream: false, uri: resource }));
			const track = { track: encoded, info: Object.assign({ isSeekable: true, isStream: false, uri: resource }, data) };

			llLog(`Loaded track ${track.info.title}`);

			payload.tracks.push(track);

		} else if (url && !url.hostname.includes("youtu")) {
			if (!lavalinkConfig.lavalink.server.sources.http) return Util.standardErrorHandler("HTTP is not enabled.", res, payload, llLog);
			const data = await getHTTPAsSource(resource).catch(e => Util.standardErrorHandler(e, res, payload, llLog));

			if (!data) return;

			const info = {
				identifier: resource,
				author: data.extra.author || data.parsed.common.artist || "Unknown artist",
				length: Math.round((data.parsed.format.duration || 0) * 1000),
				isStream: data.extra.stream,
				position: 0,
				title: data.extra.title || data.parsed.common.title || "Unknown title",
				uri: resource,
			};

			llLog(`Loaded track ${info.title}`);

			let encoded: string;
			try {
				encoded = encoding.encode(Object.assign({ flags: 1, version: 2, source: "http", probeInfo: { raw: data.extra.probe, name: data.extra.probe, parameters: null } }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) }));
			} catch(e) {
				return Util.standardErrorHandler(e, res, payload, llLog);
			}
			const track = { track: encoded, info: Object.assign({ isSeekable: !info.isStream }, info) };

			payload.tracks.push(track);
		} else {
			if (!resource.startsWith("http")) isYouTubeSearch = true;
			if (isYouTubeSearch && canDefaultToSoundCloudSearch) await doSoundCloudSearch();
			else {
				if (isYouTubeSearch && !lavalinkConfig.lavalink.server.youtubeSearchEnabled) {
					res.writeHead(200, "OK", Constants.baseHTTPResponseHeaders).write(JSON.stringify(Object.assign(payload, { loadType: "LOAD_FAILED", exception: { message: "YouTube searching is not enabled.", severity: "COMMON" } })));
					return res.end();
				}
				if (!lavalinkConfig.lavalink.server.sources.youtube) {
					res.writeHead(200, "OK", Constants.baseHTTPResponseHeaders).write(JSON.stringify(Object.assign(payload, { loadType: "LOAD_FAILED", exception: { message: "YouTube is not enabled.", severity: "COMMON" } })));
					return res.end();
				}
				const data = await getYoutubeAsSource(resource, isYouTubeSearch).catch(e => Util.standardErrorHandler(e, res, payload, llLog));

				if (!data) return;

				const infos = data.entries.map(i => ({ identifier: i.id, author: i.uploader, length: Math.round(i.duration * 1000), isStream: i.duration === 0, isSeekable: i.duration !== 0, position: 0, title: i.title, uri: `https://youtube.com/watch?v=${i.id}` }));
				const tracks = infos.map(info => ({ track: encoding.encode(Object.assign({ flags: 1, version: 2, source: "youtube" }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) })), info }));

				if (data.plData) {
					payload.playlistInfo = data.plData;
					playlist = true;

					llLog(`Loaded playlist ${data.plData.name}`);
				}

				payload.tracks = tracks;

				if (tracks.length === 0) return Util.standardErrorHandler("Could not extract YouTube info.", res, payload, llLog, "NO_MATCHES");
				else if (tracks.length === 1 && !data.plData) llLog(`Loaded track ${tracks[0].info.title}`);
			}
		}

		if (payload.tracks.length === 0) return Util.standardErrorHandler("No matches.", res, payload, llLog, "NO_MATCHES");
		else {
			res.writeHead(200, "OK", Constants.baseHTTPResponseHeaders).write(JSON.stringify(Object.assign({ loadType: payload.tracks.length > 1 && (isYouTubeSearch || isSoundcloudSearch) ? "SEARCH_RESULT" : playlist ? "PLAYLIST_LOADED" : "TRACK_LOADED" }, payload)));
			return res.end();
		}
	}

	if (reqPath === "/decodetracks" && req.method === "GET") {
		let track = query.get("track") as string | Array<string> | null;
		if (track) track = entities.decode(track as string);
		try {
			const r = JSON.parse(track as string);
			track = r;
		} catch {
			// Just do nothing
		}
		if (!track || !(typeof track === "string" || (Array.isArray(track) && track.every(i => typeof i === "string")))) return Util.standardErrorHandler("Invalid or no track query string provided.", res, {}, llLog);

		let data: ReturnType<typeof convertDecodedTrackToResponse> | Array<{ track: string; info: ReturnType<typeof convertDecodedTrackToResponse> }> | undefined;

		if (Array.isArray(track)) data = track.map(i => ({ track: i, info: convertDecodedTrackToResponse(encoding.decode(i)) }));
		else data = convertDecodedTrackToResponse(encoding.decode(track));

		res.writeHead(200, "OK", Constants.baseHTTPResponseHeaders).write(JSON.stringify(data));
		return res.end();
	}

	res.writeHead(404, "Not Found", Constants.baseHTTPResponseHeaders).write("Not Found");
	return res.end();
}

const soundCloudURL = new URL(Constants.baseSoundcloudURL);

function convertDecodedTrackToResponse(data: import("@lavalink/encoding").TrackInfo) {
	return {
		identifier: data.identifier,
		isSeekable: !data.isStream,
		author: data.author,
		length: data.length,
		isStream: data.isStream,
		position: data.position,
		title: data.title,
		uri: data.uri,
		sourceName: data.source
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

process.on("unhandledRejection", (reason) => logger.error(reason));
process.title = "Volcano";
rootLog(`Started Launcher in ${(Date.now() - startTime) / 1000} seconds (Node running for ${process.uptime()})`);
