"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const prism_media_1 = require("prism-media");
const Discord = require("@discordjs/voice");
const encoding = require("@lavalink/encoding");
const youtube_dl_exec_1 = require("youtube-dl-exec");
const soundcloud_scraper_1 = __importDefault(require("soundcloud-scraper"));
const centra_1 = __importDefault(require("centra"));
if (!worker_threads_1.parentPort)
    throw new Error("THREAD_IS_PARENT");
const parentPort = worker_threads_1.parentPort;
const Constants_1 = __importDefault(require("./Constants"));
const queues = new Map();
const methodMap = new Map();
const reportInterval = setInterval(() => {
    if (!queues.size)
        return;
    for (const queue of queues.values()) {
        const state = queue.state;
        if (!queue.paused)
            parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: Constants_1.default.OPCodes.PLAYER_UPDATE, guildId: queue.guildID, state: state }, clientID: queue.clientID });
    }
}, 5000);
parentPort.once("close", () => {
    clearInterval(reportInterval);
});
const codeReasons = {
    4001: "You sent an invalid opcode.",
    4002: "You sent a invalid payload in your identifying to the Gateway.",
    4003: "You sent a payload before identifying with the Gateway.",
    4004: "The token you sent in your identify payload is incorrect.",
    4005: "You sent more than one identify payload. Stahp.",
    4006: "Your session is no longer valid.",
    4009: "Your session has timed out.",
    4011: "We can't find the server you're trying to connect to.",
    4012: "We didn't recognize the protocol you sent.",
    4014: "Channel was deleted, you were kicked, voice server changed, or the main gateway session was dropped. Should not reconnect.",
    4015: "The server crashed. Our bad! Try resuming.",
    4016: "We didn't recognize your encryption."
};
const keyDir = path_1.default.join(__dirname, "../soundcloud.txt");
let APIKey;
if (fs_1.default.existsSync(keyDir)) {
    APIKey = fs_1.default.readFileSync(keyDir, { encoding: "utf-8" });
}
else {
    soundcloud_scraper_1.default.keygen(true).then(key => {
        if (!key)
            throw new Error("SOUNDCLOUD_KEY_NO_CREATE");
        APIKey = key;
        fs_1.default.writeFileSync(keyDir, key, { encoding: "utf-8" });
    });
}
class Queue {
    constructor(connection, clientID, guildID) {
        this.tracks = new Array();
        this.paused = false;
        this.current = null;
        this.stopping = false;
        this._filters = [];
        this._volume = 1.0;
        this.applyingFilters = false;
        this.shouldntCallFinish = false;
        this.trackPausing = false;
        this.initial = true;
        this.seekTime = 0;
        this.connection = connection;
        this.clientID = clientID;
        this.guildID = guildID;
        connection.on("stateChange", async (oldState, newState) => {
            if (newState.status === Discord.VoiceConnectionStatus.Disconnected) {
                if (newState.reason === Discord.VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
                    try {
                        await Discord.entersState(this.connection, Discord.VoiceConnectionStatus.Connecting, 5000);
                    }
                    catch {
                        parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "WebSocketClosedEvent", guildId: this.guildID, code: newState.closeCode, reason: "Disconnected.", byRemote: true }, clientID: this.clientID });
                        this.destroy();
                    }
                }
                else {
                    if (newState.reason === Discord.VoiceConnectionDisconnectReason.WebSocketClose)
                        parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "WebSocketClosedEvent", guildId: this.guildID, code: newState.closeCode, reason: codeReasons[newState.closeCode], byRemote: true }, clientID: this.clientID });
                    this.stop();
                }
            }
            else if (newState.status === Discord.VoiceConnectionStatus.Destroyed) {
                this.stop();
            }
            else if (newState.status === Discord.VoiceConnectionStatus.Connecting || newState.status === Discord.VoiceConnectionStatus.Signalling) {
                try {
                    await Discord.entersState(this.connection, Discord.VoiceConnectionStatus.Ready, 20000);
                }
                catch {
                    if (this.connection.state.status !== Discord.VoiceConnectionStatus.Destroyed)
                        this.destroy();
                }
            }
        });
    }
    get state() {
        var _a, _b;
        if (this.tracks[0] && this.tracks[0].end && ((_a = this.current) === null || _a === void 0 ? void 0 : _a.playbackDuration) === this.tracks[0].end)
            this.stop(true);
        return {
            time: Date.now(),
            position: ((_b = this.current) === null || _b === void 0 ? void 0 : _b.playbackDuration) || 0 + this.seekTime,
            connected: this.connection.state.status === Discord.VoiceConnectionStatus.Ready
        };
    }
    _nextSong() {
        this.seekTime = 0;
        this.tracks.shift();
        if (!this.tracks.length)
            return;
        this.play();
    }
    _applyPlayerEvents(player) {
        const old = this.audioPlayer;
        old === null || old === void 0 ? void 0 : old.removeAllListeners();
        player.on("stateChange", async (oldState, newState) => {
            var _a;
            if (newState.status === Discord.AudioPlayerStatus.Idle && oldState.status !== Discord.AudioPlayerStatus.Idle) {
                this.current = null;
                if (!this.stopping && !this.shouldntCallFinish) {
                    parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "FINISHED" }, clientID: this.clientID });
                }
                this.stopping = false;
                this._nextSong();
                await new Promise((res, rej) => {
                    let timer = void 0;
                    const fn = () => {
                        if (player.state.status !== Discord.AudioPlayerStatus.Playing)
                            return;
                        if (timer)
                            clearTimeout(timer);
                        player.removeListener("stateChange", fn);
                        res(void 0);
                    };
                    timer = setTimeout(() => {
                        if (this.current || this.paused)
                            res(void 0);
                        else
                            rej(new Error("TRACK_STUCK"));
                        player.removeListener("stateChange", fn);
                    }, 10000);
                    player.on("stateChange", fn);
                }).catch(() => {
                    if (!this.tracks.length)
                        return;
                    parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackStuckEvent", guildId: this.guildID, track: this.tracks[0].track, thresholdMs: 10000 }, clientID: this.clientID });
                    this._nextSong();
                });
            }
            else if (newState.status === Discord.AudioPlayerStatus.Playing) {
                this.audioPlayer = player;
                (_a = this.subscription) === null || _a === void 0 ? void 0 : _a.unsubscribe();
                this.subscription = this.connection.subscribe(player);
                old === null || old === void 0 ? void 0 : old.stop(true);
                if (this.trackPausing)
                    this.pause();
                this.trackPausing = false;
                if (!this.shouldntCallFinish || this.initial)
                    parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackStartEvent", guildId: this.guildID, track: this.tracks[0].track }, clientID: this.clientID });
                this.shouldntCallFinish = false;
                this.initial = false;
            }
        });
        player.on("error", (error) => {
            parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackExceptionEvent", guildId: this.guildID, track: this.tracks[0].track, exception: error.name, message: error.message, severity: "COMMON", cause: error.stack || new Error().stack || "Unknown" }, clientID: this.clientID });
            this._nextSong();
        });
    }
    async play() {
        if (!this.tracks.length)
            return;
        const meta = this.tracks[0];
        const decoded = encoding.decode(meta.track);
        if (!decoded.uri)
            return this._nextSong();
        const resource = await new Promise(async (resolve, reject) => {
            let stream = undefined;
            const onError = (error, sub) => {
                if (sub && !sub.killed && typeof sub.kill === "function")
                    sub.kill();
                stream === null || stream === void 0 ? void 0 : stream.resume();
                return reject(error);
            };
            const demux = async () => {
                if (!stream)
                    return onError(new Error("NO_STREAM"));
                this.shouldntCallFinish = true;
                let final;
                let isOpus = false;
                if (this._filters.length) {
                    const toApply = ["-i", "-", "-analyzeduration", "0", "-loglevel", "0", "-f", "s16le", "-ar", "48000", "-ac", "2"];
                    if (this.state.position && !this._filters.includes("-ss")) {
                        toApply.unshift("-ss", `${this.state.position + 2000}ms`, "-accurate_seek");
                        this.seekTime = this.state.position + 2000;
                    }
                    else if (this._filters.includes("-ss")) {
                        const index = this._filters.indexOf("-ss");
                        toApply.unshift(...this._filters.slice(index, index + 2));
                        this._filters.splice(index, 3);
                    }
                    else if (meta.start) {
                        this.seekTime = meta.start;
                        toApply.unshift("-ss", `${meta.start}ms`, "-accurate_seek");
                    }
                    if (this._filters.length)
                        toApply.push("-af");
                    const argus = toApply.concat(this._filters);
                    const transcoder = new prism_media_1.FFmpeg({ args: argus });
                    this.applyingFilters = false;
                    const output = stream.pipe(transcoder);
                    const encoder = new prism_media_1.opus.Encoder({
                        rate: 48000,
                        channels: 2,
                        frameSize: 960
                    });
                    final = output.pipe(encoder);
                    final.once("close", () => {
                        transcoder.destroy();
                        encoder.destroy();
                    });
                    final.once("end", () => {
                        transcoder.destroy();
                        encoder.destroy();
                    });
                    isOpus = true;
                }
                else {
                    final = stream;
                }
                if (isOpus)
                    resolve(Discord.createAudioResource(final, { metadata: decoded, inputType: Discord.StreamType.Opus, inlineVolume: true }));
                else
                    Discord.demuxProbe(final).then(probe => resolve(Discord.createAudioResource(probe.stream, { metadata: decoded, inputType: probe.type, inlineVolume: true }))).catch(e => onError(e));
            };
            if (decoded.source === "youtube") {
                const sub = youtube_dl_exec_1.raw(decoded.uri, { o: "-", q: "", f: "bestaudio[ext=webm+acodec=opus+asr=48000]/bestaudio", r: "100K" }, { stdio: ["ignore", "pipe", "ignore"] });
                if (!sub.stdout)
                    return reject(new Error("NO_YTDL_STDOUT"));
                stream = sub.stdout;
                sub.once("spawn", () => demux()).catch(e => onError(e, sub));
                stream.once("close", () => sub.kill());
                stream.once("end", () => sub.kill());
            }
            else if (decoded.source === "soundcloud") {
                const url = decoded.identifier.replace(/^O:/, "");
                const streamURL = await soundcloud_scraper_1.default.Util.fetchSongStreamURL(url, APIKey);
                if (url.endsWith("/hls"))
                    stream = await soundcloud_scraper_1.default.StreamDownloader.downloadHLS(streamURL);
                else
                    stream = await soundcloud_scraper_1.default.StreamDownloader.downloadProgressive(streamURL);
                try {
                    await demux();
                }
                catch (e) {
                    onError(e, stream);
                }
            }
            else {
                stream = await centra_1.default(decoded.uri, "get").header(Constants_1.default.baseHTTPRequestHeaders).compress().stream().send();
                try {
                    await demux();
                }
                catch (e) {
                    onError(e);
                }
            }
        }).catch(e => {
            console.log(e);
            this._nextSong();
        });
        if (!resource)
            return;
        const newPlayer = Discord.createAudioPlayer();
        this._applyPlayerEvents(newPlayer);
        this.current = resource;
        if (meta.volume !== 100 || this._volume !== 1.0)
            this.volume(meta.volume !== 100 ? meta.volume / 100 : this._volume);
        if (meta.pause)
            this.trackPausing = true;
        newPlayer.play(resource);
    }
    queue(track) {
        if (track.replace)
            this.tracks.length = 0;
        delete track.replace;
        this.tracks.push(track);
        if (track.replace)
            this.replace();
    }
    replace() {
        parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "REPLACED" }, clientID: this.clientID });
        this._nextSong();
    }
    pause() {
        var _a;
        this.paused = !!((_a = this.audioPlayer) === null || _a === void 0 ? void 0 : _a.pause(true));
    }
    resume() {
        var _a;
        this.paused = !((_a = this.audioPlayer) === null || _a === void 0 ? void 0 : _a.unpause());
    }
    stop(destroyed) {
        var _a;
        this.stopping = true;
        (_a = this.audioPlayer) === null || _a === void 0 ? void 0 : _a.stop(true);
        if (!destroyed)
            parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "STOPPED" }, clientID: this.clientID });
    }
    destroy() {
        this.tracks.length = 0;
        this.stop(true);
        this.connection.destroy();
        queues.delete(`${this.clientID}.${this.guildID}`);
        if (queues.size === 0) {
            clearInterval(reportInterval);
            parentPort.postMessage({ op: Constants_1.default.workerOPCodes.CLOSE });
        }
    }
    volume(amount) {
        var _a, _b;
        this._volume = amount;
        (_b = (_a = this.current) === null || _a === void 0 ? void 0 : _a.volume) === null || _b === void 0 ? void 0 : _b.setVolume(amount);
    }
    seek(amount) {
        const previousIndex = this._filters.indexOf("-ss");
        if (previousIndex !== -1)
            this._filters.splice(previousIndex, 2);
        this._filters.push("-ss", `${amount || 0}ms`, "-accurate_seek");
        if (!this.applyingFilters)
            this.play();
        this.applyingFilters = true;
        this.seekTime = amount;
    }
    filters(filters) {
        const toApply = [];
        if (this._filters.includes("-ss"))
            toApply.push("-ss", this._filters[this._filters.indexOf("-ss") + 2]);
        this._filters.length = 0;
        if (filters.volume)
            this.volume(filters.volume);
        if (filters.equalizer && Array.isArray(filters.equalizer) && filters.equalizer.length) {
            const bandSettings = Array(15).map((_, index) => ({ band: index, gain: 0.2 }));
            for (const eq of filters.equalizer) {
                const cur = bandSettings.find(i => i.band === eq.band);
                if (cur)
                    cur.gain = eq.gain;
            }
            toApply.push(bandSettings.map(i => `equalizer=width_type=h:gain=${Math.round(Math.log2(i.gain) * 12)}`).join(","));
        }
        if (filters.timescale) {
            const rate = filters.timescale.rate || 1.0;
            const pitch = filters.timescale.pitch || 1.0;
            const speed = filters.timescale.speed || 1.0;
            const speeddif = 1.0 - pitch;
            const finalspeed = speed + speeddif;
            const ratedif = 1.0 - rate;
            toApply.push(`aresample=48000,asetrate=48000*${pitch + ratedif},atempo=${finalspeed},aresample=48000`);
        }
        if (filters.tremolo) {
            toApply.push(`tremolo=f=${filters.tremolo.frequency || 2.0}:d=${filters.tremolo.depth || 0.5}`);
        }
        if (filters.vibrato) {
            toApply.push(`vibrato=f=${filters.vibrato.frequency || 2.0}:d=${filters.vibrato.depth || 0.5}`);
        }
        if (filters.rotation) {
            toApply.push(`apulsator=hz=${filters.rotation.rotationHz || 0}`);
        }
        if (filters.lowPass) {
            toApply.push(`lowpass=f=${500 / filters.lowPass.smoothing}`);
        }
        this._filters.push(...toApply);
        if (!this.applyingFilters)
            this.play();
        this.applyingFilters = true;
    }
}
parentPort.on("message", async (packet) => {
    var _a, _b, _c, _d, _e, _f;
    if (packet.op === Constants_1.default.workerOPCodes.STATS) {
        const qs = [...queues.values()];
        return parentPort.postMessage({ op: Constants_1.default.workerOPCodes.REPLY, data: { playingPlayers: qs.filter(q => !q.paused).length, players: queues.size }, threadID: packet.threadID });
    }
    else if (packet.op === Constants_1.default.workerOPCodes.MESSAGE) {
        const guildID = packet.data.guildId;
        const userID = packet.data.clientID;
        switch (packet.data.op) {
            case "play": {
                let q;
                if (!queues.has(`${userID}.${guildID}`)) {
                    if (packet.broadcasted)
                        return parentPort.postMessage({ op: Constants_1.default.workerOPCodes.REPLY, data: false, threadID: packet.threadID });
                    const voiceConnection = new Discord.VoiceConnection({ channelId: "", guildId: guildID, selfDeaf: false, selfMute: false }, { adapterCreator: voiceAdapterCreator(userID, guildID) });
                    q = new Queue(voiceConnection, userID, guildID);
                    queues.set(`${userID}.${guildID}`, q);
                    parentPort.postMessage({ op: Constants_1.default.workerOPCodes.VOICE_SERVER, data: { clientID: userID, guildId: guildID } });
                }
                else {
                    if (packet.broadcasted)
                        parentPort.postMessage({ op: Constants_1.default.workerOPCodes.REPLY, data: true, threadID: packet.threadID });
                    q = queues.get(`${userID}.${guildID}`);
                }
                q.queue({ track: packet.data.track, start: Number(packet.data.startTime || "0"), end: Number(packet.data.endTime || "0"), volume: Number(packet.data.volume || "100"), replace: !packet.data.noReplace, pause: packet.data.pause || false });
                if (q.tracks.length === 1)
                    q.play();
                break;
            }
            case "destroy": {
                (_a = queues.get(`${userID}.${guildID}`)) === null || _a === void 0 ? void 0 : _a.destroy();
                break;
            }
            case "pause": {
                const q = queues.get(`${userID}.${guildID}`);
                if (packet.data.pause)
                    q === null || q === void 0 ? void 0 : q.pause();
                else
                    q === null || q === void 0 ? void 0 : q.resume();
                break;
            }
            case "stop": {
                (_b = queues.get(`${userID}.${guildID}`)) === null || _b === void 0 ? void 0 : _b.stop();
                break;
            }
            case "filters": {
                (_c = queues.get(`${userID}.${guildID}`)) === null || _c === void 0 ? void 0 : _c.filters(packet.data);
                break;
            }
            case "seek": {
                (_d = queues.get(`${userID}.${guildID}`)) === null || _d === void 0 ? void 0 : _d.seek(packet.data.position);
                break;
            }
        }
    }
    else if (packet.op === Constants_1.default.workerOPCodes.VOICE_SERVER) {
        (_e = methodMap.get(`${packet.data.clientID}.${packet.data.guildId}`)) === null || _e === void 0 ? void 0 : _e.onVoiceStateUpdate({ channel_id: "", guild_id: packet.data.guildId, user_id: packet.data.clientID, session_id: packet.data.sessionId, deaf: false, self_deaf: false, mute: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null });
        (_f = methodMap.get(`${packet.data.clientID}.${packet.data.guildId}`)) === null || _f === void 0 ? void 0 : _f.onVoiceServerUpdate({ guild_id: packet.data.guildId, token: packet.data.event.token, endpoint: packet.data.event.endpoint });
    }
    else if (packet.op === Constants_1.default.workerOPCodes.DELETE_ALL) {
        const forUser = [...queues.values()].filter(q => q.clientID === packet.data.clientID);
        parentPort.postMessage({ op: Constants_1.default.workerOPCodes.REPLY, data: forUser.length, threadID: packet.threadID });
        for (const q of forUser) {
            q.destroy();
        }
    }
});
function voiceAdapterCreator(userID, guildID) {
    return methods => {
        methodMap.set(`${userID}.${guildID}`, methods);
        return {
            sendPayload: payload => {
                return !!payload;
            },
            destroy: () => {
                methodMap.delete(`${userID}.${guildID}`);
            }
        };
    };
}
parentPort.postMessage({ op: Constants_1.default.workerOPCodes.READY });
