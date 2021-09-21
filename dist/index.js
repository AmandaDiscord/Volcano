"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const startTime = Date.now();
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const yaml_1 = __importDefault(require("yaml"));
const express_1 = __importDefault(require("express"));
const ws_1 = __importDefault(require("ws"));
const mixin_deep_1 = __importDefault(require("mixin-deep"));
const encoding = require("@lavalink/encoding");
const Constants_1 = __importDefault(require("./Constants"));
const Logger_1 = __importDefault(require("./util/Logger"));
const ThreadPool_1 = __importDefault(require("./util/ThreadPool"));
const Util_1 = __importDefault(require("./util/Util"));
const http_2 = __importDefault(require("./sources/http"));
const local_1 = __importDefault(require("./sources/local"));
const soundcloud_1 = __importDefault(require("./sources/soundcloud"));
const youtube_1 = __importDefault(require("./sources/youtube"));
const cpuCount = os_1.default.cpus().length;
const pool = new ThreadPool_1.default({
    size: cpuCount,
    dir: path_1.default.join(__dirname, "./worker.js")
});
const configDir = path_1.default.join(process.cwd(), "./application.yml");
let cfgparsed;
if (fs_1.default.existsSync(configDir)) {
    const cfgyml = fs_1.default.readFileSync(configDir, { encoding: "utf-8" });
    cfgparsed = yaml_1.default.parse(cfgyml);
}
else
    cfgparsed = {};
const config = (0, mixin_deep_1.default)({}, Constants_1.default.defaultOptions, cfgparsed);
const rootLog = Logger_1.default[config.logging.level.root?.toLowerCase?.()] ?? Logger_1.default.info;
const llLog = Logger_1.default[config.logging.level.lavalink?.toLowerCase?.()] ?? Logger_1.default.info;
if (config.spring.main["banner-mode"] === "log")
    rootLog("\n" +
        "\x1b[33m__      __   _                                \x1b[97moOOOOo\n" +
        "\x1b[33m\\ \\    / /  | |                             \x1b[97mooOOoo  oo\n" +
        "\x1b[33m \\ \\  / /__ | | ___ __ _ _ __   ___        \x1b[0m/\x1b[31mvvv\x1b[0m\\    \x1b[97mo\n" +
        "\x1b[33m  \\ \\/ / _ \\| |/ __/ _` | '_ \\ / _ \\      \x1b[0m/\x1b[31mV V V\x1b[0m\\\n" +
        "\x1b[33m   \\  / (_) | | (_| (_| | | | | (_) |    \x1b[0m/   \x1b[31mV   \x1b[0m\\\n" +
        "\x1b[33m    \\/ \\___/|_|\\___\\__,_|_| |_|\\___/  \x1b[0m/\\/     \x1b[31mVV  \x1b[0m\\");
rootLog(`Starting on ${os_1.default.hostname()} with PID ${process.pid} (${__filename} started by ${os_1.default.userInfo().username} in ${process.cwd()})`);
rootLog(`Using ${cpuCount} worker threads in pool`);
const server = (0, express_1.default)();
const http = http_1.default.createServer(server);
const ws = new ws_1.default.Server({ noServer: true });
const connections = new Map();
const voiceServerStates = new Map();
const socketDeleteTimeouts = new Map();
const playerMap = new Map();
pool.on("message", (_, msg) => {
    const socket = playerMap.get(`${msg.clientID}.${msg.data.guildId}`);
    const entry = [...connections.values()].find(i => i.some(c => c.socket === socket));
    const rKey = entry?.find((c) => c.socket);
    if (rKey?.resumeKey && socketDeleteTimeouts.has(rKey.resumeKey))
        socketDeleteTimeouts.get(rKey.resumeKey).events.push(msg.data);
    socket?.send(JSON.stringify(msg.data));
});
pool.on("datareq", (op, data) => {
    if (op === Constants_1.default.workerOPCodes.VOICE_SERVER) {
        const v = voiceServerStates.get(`${data.clientID}.${data.guildId}`);
        if (v)
            pool.broadcast({ op: Constants_1.default.workerOPCodes.VOICE_SERVER, data: v });
    }
});
async function getStats() {
    const memory = process.memoryUsage();
    const free = memory.heapTotal - memory.heapUsed;
    const pload = await Util_1.default.processLoad();
    const osload = os_1.default.loadavg();
    const threadStats = await pool.broadcast({ op: Constants_1.default.workerOPCodes.STATS });
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
function socketHeartbeat() {
    this.isAlive = true;
}
function noop() { void 0; }
ws.on("headers", (headers, request) => {
    headers.push(`Session-Resumed: ${!!request.headers["resume-key"] && socketDeleteTimeouts.has(request.headers["resume-key"])}`, "Lavalink-Major-Version: 3");
});
http.on("upgrade", (request, socket, head) => {
    llLog(`Incoming connection from /${request.socket.remoteAddress}:${request.socket.remotePort}`);
    const temp401 = "HTTP/1.1 401 Unauthorized\r\n\r\n";
    const passwordIncorrect = (config.lavalink.server.password !== undefined && request.headers.authorization !== String(config.lavalink.server.password));
    const invalidUserID = (!request.headers["user-id"] || Array.isArray(request.headers["user-id"]) || !/^\d+$/.test(request.headers["user-id"]));
    if (passwordIncorrect || invalidUserID)
        return socket.write(temp401, () => socket.destroy());
    const userID = request.headers["user-id"];
    ws.handleUpgrade(request, socket, head, s => {
        if (request.headers["resume-key"] && socketDeleteTimeouts.has(request.headers["resume-key"])) {
            const resume = socketDeleteTimeouts.get(request.headers["resume-key"]);
            clearTimeout(resume.timeout);
            socketDeleteTimeouts.delete(request.headers["resume-key"]);
            const exist = connections.get(userID);
            if (exist) {
                const pre = exist.find(i => i.resumeKey === request.headers["resume-key"]);
                if (pre)
                    pre.socket = s;
                else
                    exist.push({ socket: s, resumeKey: null, resumeTimeout: 60 });
            }
            else
                connections.set(userID, [{ socket: s, resumeKey: null, resumeTimeout: 60 }]);
            for (const event of resume.events)
                s.send(JSON.stringify(event));
            llLog(`Resumed session with key ${request.headers["resume-key"]}`);
            llLog(`Replaying ${resume.events.length.toLocaleString()} events`);
            resume.events.length = 0;
            return ws.emit("connection", s, request);
        }
        llLog("Connection successfully established");
        const existing = connections.get(userID);
        const pl = { socket: s, resumeKey: null, resumeTimeout: 60 };
        if (existing)
            existing.push(pl);
        else
            connections.set(userID, [pl]);
        ws.emit("connection", s, request);
    });
});
ws.on("connection", async (socket, request) => {
    const userID = request.headers["user-id"];
    const stats = await getStats();
    socket.send(JSON.stringify(Object.assign(stats, { op: "stats" })));
    socket.on("message", data => onClientMessage(socket, data, userID));
    socket.isAlive = true;
    socket.on("pong", socketHeartbeat);
    socket.once("close", code => onClientClose(socket, userID, code, { ip: request.socket.remoteAddress, port: request.socket.remotePort }));
    socket.once("error", () => onClientClose(socket, userID, 1000, { ip: request.socket.remoteAddress, port: request.socket.remotePort }));
});
async function onClientMessage(socket, data, userID) {
    const buf = Array.isArray(data)
        ? Buffer.concat(data)
        : (data instanceof ArrayBuffer)
            ? Buffer.from(data)
            : data;
    const d = buf.toString();
    const msg = JSON.parse(d);
    llLog(msg);
    const pl = { op: Constants_1.default.workerOPCodes.MESSAGE, data: Object.assign(msg, { clientID: userID }) };
    switch (msg.op) {
        case Constants_1.default.OPCodes.PLAY: {
            if (!msg.guildId || !msg.track)
                return;
            const responses = await pool.broadcast(pl);
            if (!responses.includes(true))
                pool.execute(pl);
            void playerMap.set(`${userID}.${msg.guildId}`, socket);
            break;
        }
        case Constants_1.default.OPCodes.VOICE_UPDATE: {
            voiceServerStates.set(`${userID}.${msg.guildId}`, { clientID: userID, guildId: msg.guildId, sessionId: msg.sessionId, event: msg.event });
            setTimeout(() => voiceServerStates.delete(`${userID}.${msg.guildId}`), 20000);
            void pool.broadcast({ op: Constants_1.default.workerOPCodes.VOICE_SERVER, data: voiceServerStates.get(`${userID}.${msg.guildId}`) });
            break;
        }
        case Constants_1.default.OPCodes.STOP:
        case Constants_1.default.OPCodes.PAUSE:
        case Constants_1.default.OPCodes.DESTROY:
        case Constants_1.default.OPCodes.SEEK:
        case Constants_1.default.OPCodes.VOLUME:
        case Constants_1.default.OPCodes.FILTERS: {
            if (!msg.guildId)
                return;
            void pool.broadcast(pl);
            break;
        }
        case Constants_1.default.OPCodes.CONFIGURE_RESUMING: {
            if (!msg.key)
                return;
            const entry = connections.get(userID);
            const found = entry.find(i => i.socket === socket);
            if (found) {
                found.resumeKey = msg.key;
                found.resumeTimeout = msg.timeout || 60;
            }
            break;
        }
        case Constants_1.default.OPCodes.FFMPEG: {
            if (!msg.guildId || !msg.args || !Array.isArray(msg.args) || !msg.args.every(i => typeof i === "string"))
                return;
            void pool.broadcast(pl);
            break;
        }
        case Constants_1.default.OPCodes.DUMP: {
            pool.dump();
            break;
        }
    }
}
async function onClientClose(socket, userID, closeCode, extra) {
    if (socket.readyState !== ws_1.default.CLOSING && socket.readyState !== ws_1.default.CLOSED)
        socket.close(closeCode);
    socket.removeAllListeners();
    const entry = connections.get(userID);
    const found = entry.find(i => i.socket === socket);
    if (found) {
        if (found.resumeKey) {
            llLog(`Connection closed from /${extra.ip}:${extra.port} with status CloseStatus[code=${closeCode}, reason=destroy] -- Session can be resumed within the next ${found.resumeTimeout} seconds with key ${found.resumeKey}`);
            const timeout = setTimeout(async () => {
                const index = entry.findIndex(e => e.resumeKey === found.resumeKey);
                if (index !== -1)
                    entry.splice(index, 1);
                socketDeleteTimeouts.delete(found.resumeKey);
                if (entry.length === 0)
                    connections.delete(userID);
                const results = await pool.broadcast({ op: Constants_1.default.workerOPCodes.DELETE_ALL, data: { clientID: userID } });
                const count = results.reduce((acc, cur) => acc + cur, 0);
                llLog(`Shutting down ${count} playing players`);
            }, (found.resumeTimeout || 60) * 1000);
            socketDeleteTimeouts.set(found.resumeKey, { timeout, events: [] });
        }
        else {
            const index = entry.indexOf(found);
            if (index === -1)
                return Logger_1.default.error(`Socket delete could not be removed: ${found.resumeKey}\n${index}`);
            entry.splice(index, 1);
            if (entry.length === 0)
                connections.delete(userID);
            const results = await pool.broadcast({ op: Constants_1.default.workerOPCodes.DELETE_ALL, data: { clientID: userID } });
            const count = results.reduce((acc, cur) => acc + cur, 0);
            llLog(`Shutting down ${count} playing players`);
        }
    }
    for (const key of voiceServerStates.keys())
        if (key.startsWith(userID))
            voiceServerStates.delete(key);
}
const serverLoopInterval = setInterval(async () => {
    const stats = await getStats();
    const payload = Object.assign(stats, { op: "stats" });
    const str = JSON.stringify(payload);
    for (const client of ws.clients) {
        if (client.isAlive === false)
            return client.terminate();
        client.isAlive = false;
        if (client.readyState === ws_1.default.OPEN) {
            client.ping(noop);
            client.send(str);
        }
    }
}, 1000 * 60);
const IDRegex = /(ytsearch:)?(scsearch:)?(.+)/;
server.use((req, res, next) => {
    if (req.path !== "/" && req.path !== "/wakemydyno.txt" && config.lavalink.server.password && (!req.headers.authorization || req.headers.authorization !== String(config.lavalink.server.password))) {
        Logger_1.default.warn(`Authorization missing for ${req.socket.remoteAddress} on ${req.method.toUpperCase()} ${req.path}`);
        return res.status(401).header("Content-Type", "text/plain").send("Unauthorized");
    }
    next();
});
const soundCloudURL = new URL(Constants_1.default.baseSoundcloudURL);
server.get("/", (req, res) => res.status(200).header("Content-Type", "text/plain").send("Ok boomer."));
server.get("/wakemydyno.txt", (req, res) => res.status(200).header("Content-Type", "text/plain").send("Hi. Thank you :)"));
server.get("/loadtracks", async (request, response) => {
    const identifier = request.query.identifier;
    const payload = {
        playlistInfo: {},
        tracks: []
    };
    let playlist = false;
    if (!identifier || typeof identifier !== "string")
        return Util_1.default.standardErrorHandler("Invalid or no identifier query string provided.", response, payload, llLog);
    llLog(`Got request to load for identifier "${identifier}"`);
    const match = identifier.match(IDRegex);
    if (!match)
        return Util_1.default.standardErrorHandler("Identifier did not match regex", response, payload, llLog);
    const isYouTubeSearch = !!match[1];
    const isSoundcloudSearch = !!match[2];
    const resource = match[3];
    if (!resource)
        return Util_1.default.standardErrorHandler("Invalid or no identifier query string provided.", response, payload, llLog);
    let url;
    if (resource.startsWith("http"))
        url = new URL(resource);
    if (isSoundcloudSearch || (url && url.hostname === soundCloudURL.hostname)) {
        if (isSoundcloudSearch && !config.lavalink.server.soundcloudSearchEnabled)
            return response.status(200).header(Constants_1.default.baseHTTPResponseHeaders).send(JSON.stringify(Object.assign(payload, { loadType: "LOAD_FAILED", exception: { message: "Soundcloud searching is not enabled.", severity: "COMMON" } })));
        const data = await (0, soundcloud_1.default)(resource, isSoundcloudSearch).catch(e => Util_1.default.standardErrorHandler(e, response, payload, llLog));
        if (!data)
            return;
        const tracks = data.map(info => ({ track: encoding.encode(Object.assign({ flags: 1, version: 2, source: "soundcloud" }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) })), info }));
        payload.tracks = tracks;
        if (tracks.length === 0)
            return Util_1.default.standardErrorHandler("Could not extract Soundcloud info.", response, payload, llLog, "NO_MATCHES");
        else
            llLog(`Loaded track ${tracks[0].info.title}`);
    }
    else if (path_1.default.isAbsolute(resource)) {
        if (!config.lavalink.server.sources.local)
            return Util_1.default.standardErrorHandler("Local is not enabled.", response, payload, llLog);
        const data = await (0, local_1.default)(resource).catch(e => Util_1.default.standardErrorHandler(e, response, payload, llLog));
        if (!data)
            return;
        const encoded = encoding.encode(Object.assign({ flags: 1, version: 2, source: "local" }, data, { position: BigInt(0), length: BigInt(data.length), isStream: false, uri: resource }));
        const track = { track: encoded, info: Object.assign({ isSeekable: true, isStream: false, uri: resource }, data) };
        llLog(`Loaded track ${track.info.title}`);
        payload.tracks.push(track);
    }
    else if (url && !url.hostname.includes("youtu")) {
        if (!config.lavalink.server.sources.http)
            return Util_1.default.standardErrorHandler("HTTP is not enabled.", response, payload, llLog);
        const data = await (0, http_2.default)(resource).catch(e => Util_1.default.standardErrorHandler(e, response, payload, llLog));
        if (!data)
            return;
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
        let encoded;
        try {
            encoded = encoding.encode(Object.assign({ flags: 1, version: 2, source: "http", probeInfo: { raw: data.extra.probe, name: data.extra.probe, parameters: null } }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) }));
        }
        catch (e) {
            return Util_1.default.standardErrorHandler(e, response, payload, llLog);
        }
        const track = { track: encoded, info: Object.assign({ isSeekable: !info.isStream }, info) };
        payload.tracks.push(track);
    }
    else {
        if (isYouTubeSearch && !config.lavalink.server.youtubeSearchEnabled)
            return response.status(200).header(Constants_1.default.baseHTTPResponseHeaders).send(JSON.stringify(Object.assign(payload, { loadType: "LOAD_FAILED", exception: { message: "YouTube searching is not enabled.", severity: "COMMON" } })));
        const data = await (0, youtube_1.default)(resource, isYouTubeSearch).catch(e => Util_1.default.standardErrorHandler(e, response, payload, llLog));
        if (!data)
            return;
        const infos = data.entries.map(i => ({ identifier: i.id, author: i.uploader, length: Math.round(i.duration * 1000), isStream: i.duration === 0, isSeekable: i.duration !== 0, position: 0, title: i.title, uri: `https://youtube.com/watch?v=${i.id}` }));
        const tracks = infos.map(info => ({ track: encoding.encode(Object.assign({ flags: 1, version: 2, source: "youtube" }, info, { position: BigInt(info.position), length: BigInt(Math.round(info.length)) })), info }));
        if (data.plData) {
            payload.playlistInfo = data.plData;
            playlist = true;
            llLog(`Loaded playlist ${data.plData.name}`);
        }
        payload.tracks = tracks;
        if (tracks.length === 0)
            return Util_1.default.standardErrorHandler("Could not extract Soundcloud info.", response, payload, llLog, "NO_MATCHES");
        else if (tracks.length === 1 && !data.plData)
            llLog(`Loaded track ${tracks[0].info.title}`);
    }
    if (payload.tracks.length === 0)
        return Util_1.default.standardErrorHandler("No matches.", response, payload, llLog, "NO_MATCHES");
    return response.status(200).header(Constants_1.default.baseHTTPResponseHeaders).send(JSON.stringify(Object.assign({ loadType: payload.tracks.length > 1 && (isYouTubeSearch || isSoundcloudSearch) ? "SEARCH_RESULT" : playlist ? "PLAYLIST_LOADED" : "TRACK_LOADED" }, payload)));
});
server.get("/decodetracks", (request, response) => {
    const track = request.query.track;
    if (!track || !(typeof track === "string" || (Array.isArray(track) && track.every(i => typeof i === "string"))))
        return Util_1.default.standardErrorHandler("Invalid or no track query string provided.", response, {}, llLog);
    let data;
    if (Array.isArray(track))
        data = track.map(i => ({ track: i, info: convertDecodedTrackToResponse(encoding.decode(i)) }));
    else
        data = convertDecodedTrackToResponse(encoding.decode(track));
    return response.status(200).header(Constants_1.default.baseHTTPResponseHeaders).send(JSON.stringify(data));
});
function convertDecodedTrackToResponse(data) {
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
    for (const child of pool.children.values())
        child.terminate();
});
process.on("unhandledRejection", (reason) => Logger_1.default.error(reason));
process.title = "Volcano";
