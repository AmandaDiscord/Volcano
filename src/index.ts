const startTime = Date.now();

// Native modules
import HTTP from "http";
import fs from "fs";
import os from "os";
import path from "path";

// NPM modules
import yaml from "yaml";
import express from "express";
import WebSocket from "ws";
import mixin from "mixin-deep";
const encoding: typeof import("@lavalink/encoding") = require("@lavalink/encoding");

// Local modules
import Constants from "./Constants";
import logger from "./util/Logger";
import ThreadPool from "./util/ThreadPool";
import Util from "./util/Util";

// Source getters
import getHTTPAsSource from "./sources/http";
import getSoundCloudAsSource from "./sources/soundcloud";
import getYoutubeAsSource from "./sources/youtube";

const cpuCount = os.cpus().length;
const pool = new ThreadPool({
	size: cpuCount,
	dir: path.join(__dirname, "./worker.js")
});

const configDir = path.join(process.cwd(), "./application.yml");
let cfgparsed: import("./types").LavaLinkConfig;

if (fs.existsSync(configDir)) {
	const cfgyml = fs.readFileSync(configDir, { encoding: "utf-8" });
	cfgparsed = yaml.parse(cfgyml);
} else cfgparsed = {};

const config = mixin({}, Constants.defaultOptions, cfgparsed);


const rootLog = config.logging.level.root === "WARN" ? logger.warn : config.logging.level.root === "ERROR" ? logger.error : logger.info;
const llLog = config.logging.level.lavalink === "WARN" ? logger.warn : config.logging.level.lavalink === "ERROR" ? logger.error : logger.info;

if (config.spring.main["banner-mode"] === "log") {
	rootLog("\n" +
					"\x1b[33m__      __   _                                \x1b[97moOOOOo\n" +
					"\x1b[33m\\ \\    / /  | |                             \x1b[97mooOOoo  oo\n" +
					"\x1b[33m \\ \\  / /__ | | ___ __ _ _ __   ___        \x1b[0m/\x1b[31mvvv\x1b[0m\\    \x1b[97mo\n" +
					"\x1b[33m  \\ \\/ / _ \\| |/ __/ _` | '_ \\ / _ \\      \x1b[0m/\x1b[31mV V V\x1b[0m\\\n" +
					"\x1b[33m   \\  / (_) | | (_| (_| | | | | (_) |    \x1b[0m/   \x1b[31mV   \x1b[0m\\\n" +
					"\x1b[33m    \\/ \\___/|_|\\___\\__,_|_| |_|\\___/  \x1b[0m/\\/     \x1b[31mVV  \x1b[0m\\");
}

rootLog(`Starting on ${os.hostname()} with PID ${process.pid} (${__filename} started by ${os.userInfo().username} in ${process.cwd()})`);
rootLog(`Using ${cpuCount} worker threads in pool`);

const server = express();
const http = HTTP.createServer(server);
const ws = new WebSocket.Server({ noServer: true });

const connections = new Map<string, Array<{ socket: WebSocket; resumeKey: string | null; resumeTimeout: number }>>();
const voiceServerStates = new Map<string, { clientID: string; guildId: string, sessionId: string, event: { token: string; guild_id: string; endpoint: string } }>();
const socketDeleteTimeouts = new Map<string, { timeout: NodeJS.Timeout; events: Array<any> }>();
const playerMap = new Map<string, WebSocket>();

pool.on("message", (id, msg) => {
	const guildID: string = msg.data.guildId;
	const userID: string = msg.clientID;

	const socket = playerMap.get(`${userID}.${guildID}`);
	const entry = [...connections.values()].find(i => i.find(c => c.socket === socket));
	const rKey = entry?.find(c => c.socket);
	if (entry && rKey && rKey.resumeKey && socketDeleteTimeouts.has(rKey.resumeKey)) socketDeleteTimeouts.get(rKey.resumeKey)!.events.push(msg.data);
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
	const free = memory.heapTotal - memory.heapUsed;
	const pload = await Util.processLoad();
	const osload = os.loadavg();
	const threadStats = await pool.broadcast({ op: Constants.workerOPCodes.STATS });
	return {
		players: threadStats.reduce((acc, cur) => acc + cur.players, 0),
		playingPlayers: threadStats.reduce((acc, cur) => acc + cur.playingPlayers, 0),
		uptime: process.uptime(),
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

function socketHeartbeat() {
	this.isAlive = true;
}
function noop() { void 0; }

ws.on("headers", (headers, request) => {
	headers.push(`Session-Resumed: ${!!request.headers["resume-key"] && socketDeleteTimeouts.has(request.headers["resume-key"] as string)}`, "Lavalink-Major-Version: 3");
});

http.on("upgrade", (request: HTTP.IncomingMessage, socket: import("net").Socket, head: Buffer) => {
	llLog(`Incoming connection from /${request.socket.remoteAddress}:${request.socket.remotePort}`);

	const temp401 = "HTTP/1.1 401 Unauthorized\r\n\r\n";

	const passwordIncorrect = (config.lavalink.server.password !== undefined && request.headers.authorization !== String(config.lavalink.server.password));
	const invalidUserID = (!request.headers["user-id"] || Array.isArray(request.headers["user-id"]) || !request.headers["user-id"].match(/^\d+$/));
	if (passwordIncorrect || invalidUserID) return socket.write(temp401, () => socket.destroy());
	const userID = request.headers["user-id"] as string;

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
			llLog(`Replaying ${resume.events.length} events`);
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
	const userID = request.headers["user-id"] as string;
	const stats = await getStats();
	socket.send(JSON.stringify(Object.assign(stats, { op: "stats" })));
	socket.on("message", data => onClientMessage(socket, data, userID));
	// @ts-ignore
	socket.isAlive = true;
	socket.on("pong", socketHeartbeat);

	socket.once("close", code => onClientClose(socket, userID, code, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
	socket.once("error", () => onClientClose(socket, userID, 1000, { ip: request.socket.remoteAddress!, port: request.socket.remotePort! }));
});

async function onClientMessage(socket: WebSocket, data: WebSocket.Data, userID: string) {
	let buf: string | Buffer;
	if (Array.isArray(data)) buf = Buffer.concat(data);
	else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
	else buf = data;

	const d = buf.toString();
	const msg: import("./types").InboundPayload = JSON.parse(d);

	llLog(msg);

	const pl = { op: Constants.workerOPCodes.MESSAGE, data: Object.assign(msg, { clientID: userID }) };
	if (msg.op === "play") {
		if (!msg.guildId || !msg.track) return;
		const responses = await pool.broadcast(pl);
		console.log(responses);
		if (!responses.includes(true)) pool.execute(pl);
		return playerMap.set(`${userID}.${msg.guildId}`, socket);
	}

	else if (msg.op === "voiceUpdate") {
		voiceServerStates.set(`${userID}.${msg.guildId}`, { clientID: userID, guildId: msg.guildId as string, sessionId: msg.sessionId as string, event: msg.event as any });
		setTimeout(() => voiceServerStates.delete(`${userID}.${msg.guildId}`), 20000);
		return pool.broadcast({ op: Constants.workerOPCodes.VOICE_SERVER, data: voiceServerStates.get(`${userID}.${msg.guildId}`) });
	}

	else if (msg.op === "stop" || msg.op === "pause" || msg.op === "destroy" || msg.op === "filters") {
		if (!msg.guildId) return;
		return pool.broadcast(pl);
	}

	else if (msg.op === "configureResuming") {
		if (!msg.key) return;
		const entry = connections.get(userID);
		const found = entry!.find(i => i.socket === socket);
		if (found) {
			found.resumeKey = msg.key as string;
			found.resumeTimeout = msg.timeout || 60;
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
			const timeout = setTimeout(async () => {
				const rk = entry!.find(e => e.resumeKey === found.resumeKey);
				const index = entry!.indexOf(rk!);
				if (index !== -1) entry!.splice(index, 1);
				socketDeleteTimeouts.delete(found.resumeKey as string);
				if (entry!.length === 0) connections.delete(userID);
				const results = await pool.broadcast({ op: Constants.workerOPCodes.DELETE_ALL, data: { clientID: userID } });
				const count = results.reduce((acc, cur) => acc + cur, 0);
				llLog(`Shutting down ${count} playing players`);
			}, (found.resumeTimeout || 60) * 1000);
			socketDeleteTimeouts.set(found.resumeKey, { timeout: timeout, events: [] });
		} else {
			const index = entry!.indexOf(found);
			if (index === -1) return logger.error(`Socket delete could not be removed: ${found.resumeKey}\n${index}`);
			entry!.splice(index, 1);
			if (entry!.length === 0) connections.delete(userID);
			const results = await pool.broadcast({ op: Constants.workerOPCodes.DELETE_ALL, data: { clientID: userID } });
			const count = results.reduce((acc, cur) => acc + cur, 0);
			llLog(`Shutting down ${count} playing players`);
		}
	}

	for (const key of voiceServerStates.keys()) {
		if (key.startsWith(userID)) voiceServerStates.delete(key);
	}
}

const serverLoopInterval = setInterval(async () => {
	const stats = await getStats();
	const payload: import("./types").OutboundPayload = Object.assign(stats, { op: "stats" as const });
	const str = JSON.stringify(payload);
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

server.use((req, res, next) => {
	if (req.path !== "/" && req.path !== "/wakemydyno.txt" && config.lavalink.server.password && (!req.headers.authorization || req.headers.authorization !== String(config.lavalink.server.password))) return res.status(401).send("Unauthorized");
	next();
});

const soundCloudURL = new URL(Constants.baseSoundcloudURL);

server.get("/", (req, res) => res.status(200).send("Ok boomer."));
server.get("/wakemydyno.txt", (req, res) => res.status(200).send("Hi. Thank you :)"));

server.get("/loadtracks", async (request, response) => {
	const identifier = request.query.identifier as string | undefined;
	const payload = {
		playlistInfo: {},
		tracks: [] as Array<any>
	};
	let playlist = false;
	if (!identifier || typeof identifier !== "string") return Util.standardErrorHandler("Invalid or no identifier query string provided.", response, payload, llLog);
	llLog(`Got request to load for identifier "${identifier}"`);

	const match = identifier.match(IDRegex);
	if (!match) return Util.standardErrorHandler("Identifier did not match regex", response, payload, llLog);

	const isYouTubeSearch = !!match[1];
	const isSoundcloudSearch = !!match[2];
	const resource = match[3];

	if (!resource) return Util.standardErrorHandler("Invalid or no identifier query string provided.", response, payload, llLog);

	let url: URL | undefined;
	if (resource.startsWith("http")) url = new URL(resource);

	if (isSoundcloudSearch || (url && url.hostname === soundCloudURL.hostname)) {
		if (isSoundcloudSearch && !config.lavalink.server.soundcloudSearchEnabled) return response.status(200).send(JSON.stringify(Object.assign(payload, { loadType: "LOAD_FAILED", exception: { message: "Soundcloud searching is not enabled.", severity: "COMMON" } })));

		const data = await getSoundCloudAsSource(resource, isSoundcloudSearch).catch(e => Util.standardErrorHandler(e, response, payload, llLog));

		if (!data) return;

		const tracks = data.map(info => { return { track: encoding.encode(Object.assign({ flags: 1, version: 2, source: "soundcloud" }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) })), info: info }; });
		payload.tracks = tracks;

		if (tracks.length === 0) return Util.standardErrorHandler("Could not extract Soundcloud info.", response, payload, llLog, "NO_MATCHES");
		else if (tracks.length === 1) llLog(`Loaded track ${tracks[0].info.title}`);
	} else if (url && !url.hostname.includes("youtu")) {
		if (!config.lavalink.server.sources.http) return Util.standardErrorHandler("HTTP is not enabled.", response, payload, llLog);
		const data = await getHTTPAsSource(resource).catch(e => Util.standardErrorHandler(e, response, payload, llLog));

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

		const encoded = encoding.encode(Object.assign({ flags: 1, version: 2, source: "http", probeInfo: { raw: data.extra.probe, name: data.extra.probe, parameters: null } }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) }));
		const track = { track: encoded, info: Object.assign({ isSeekable: !info.isStream }, info) };

		payload.tracks.push(track);


	} else {
		if (isYouTubeSearch && !config.lavalink.server.youtubeSearchEnabled) return response.status(200).send(JSON.stringify(Object.assign(payload, { loadType: "LOAD_FAILED", exception: { message: "YouTube searching is not enabled.", severity: "COMMON" } })));
		const data = await getYoutubeAsSource(resource, isYouTubeSearch).catch(e => Util.standardErrorHandler(e, response, payload, llLog));

		if (!data) return;

		const infos = data.entries.map(i => { return { identifier: i.id, author: i.uploader, length: Math.round(i.duration * 1000), isStream: i.duration === 0, isSeekable: i.duration !== 0, position: 0, title: i.title, uri: `https://youtube.com/watch?v=${i.id}` }; });
		const tracks = infos.map(info => { return { track: encoding.encode(Object.assign({ flags: 1, version: 2, source: "youtube" }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) })), info: info }; });
		if (data.plData) {
			payload.playlistInfo = data.plData;
			playlist = true;
			llLog(`Loaded playlist ${data.plData.name}`);
		}
		payload.tracks = tracks;
		if (tracks.length === 0) return Util.standardErrorHandler("Could not extract Soundcloud info.", response, payload, llLog, "NO_MATCHES");
		else if (tracks.length === 1 && !data.plData) llLog(`Loaded track ${tracks[0].info.title}`);
	}

	if (payload.tracks.length === 0) return Util.standardErrorHandler("No matches.", response, payload, llLog, "NO_MATCHES");

	return response.status(200).send(JSON.stringify(Object.assign({ loadType: payload.tracks.length > 1 && (isYouTubeSearch || isSoundcloudSearch) ? "SEARCH_RESULT" : playlist ? "PLAYLIST_LOADED" : "TRACK_LOADED" }, payload)));
});

server.get("/decodetracks", (request, response) => {
	const track = request.query.track as string | Array<string> | undefined;
	if (!track || !(typeof track === "string" || (Array.isArray(track) && track.every(i => typeof i === "string")))) return Util.standardErrorHandler("Invalid or no track query string provided.", response, {}, llLog);

	let data: ReturnType<typeof convertDecodedTrackToResponse> | Array<{ track: string; info: ReturnType<typeof convertDecodedTrackToResponse> }> | undefined = undefined;
	if (Array.isArray(track)) data = track.map(i => { return { track: i, info: convertDecodedTrackToResponse(encoding.decode(i)) }; });
	else data = convertDecodedTrackToResponse(encoding.decode(track));

	return response.status(200).send(JSON.stringify(data));
});

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

http.listen(config.server.port, config.server.address, () => {
	rootLog(`HTTP and Socket started on port ${config.server.port} binding to ${config.server.address}`);
	rootLog(`Started in ${(Date.now() - startTime) / 1000} seconds (Node running for ${process.uptime()})`);
});

ws.once("close", () => {
	clearInterval(serverLoopInterval);
	rootLog("Socket server has closed.");
	for (const child of pool.children.values()) {
		child.terminate();
	}
});

process.on("unhandledRejection", (reason) => logger.error(reason));
process.title = "Volcano";
