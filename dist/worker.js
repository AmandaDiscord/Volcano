"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const Discord = require("@discordjs/voice");
const encoding = require("@lavalink/encoding");
const youtube_dl_exec_1 = require("youtube-dl-exec");
if (!worker_threads_1.parentPort)
    throw new Error("THREAD_IS_PARENT");
const parentPort = worker_threads_1.parentPort;
const Constants_1 = __importDefault(require("./Constants"));
const queues = new Map();
const methodMap = new Map();
const reportInterval = setInterval(async () => {
    if (!queues.size)
        return;
    for (const queue of queues.values()) {
        const state = await queue.state;
        if (!queue.paused && state.connected)
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
class Queue {
    constructor(connection, clientID, guildID) {
        this.tracks = new Array();
        this.audioPlayer = Discord.createAudioPlayer();
        this.paused = false;
        this.current = null;
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
                        this.stop();
                }
            }
        });
        this.audioPlayer.on("stateChange", async (oldState, newState) => {
            if (newState.status === Discord.AudioPlayerStatus.Idle && oldState.status !== Discord.AudioPlayerStatus.Idle) {
                this.current = null;
                parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "FINISHED" }, clientID: this.clientID });
                this._nextSong();
                await new Promise((res, rej) => {
                    let timer = void 0;
                    const fn = () => {
                        if (this.audioPlayer.state.status !== Discord.AudioPlayerStatus.Playing)
                            return;
                        if (timer)
                            clearTimeout(timer);
                        this.audioPlayer.removeListener("stateChange", fn);
                        res(void 0);
                    };
                    timer = setTimeout(() => {
                        if (this.current)
                            res(void 0);
                        else
                            rej(new Error("TRACK_STUCK"));
                        this.audioPlayer.removeListener("stateChange", fn);
                    }, 20000);
                    this.audioPlayer.on("stateChange", fn);
                }).catch(() => {
                    if (!this.tracks.length)
                        return;
                    parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackStuckEvent", guildId: this.guildID, track: this.tracks[0].track, thresholdMs: 10000 }, clientID: this.clientID });
                    this._nextSong();
                });
            }
            else if (newState.status === Discord.AudioPlayerStatus.Playing) {
                parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackStartEvent", guildId: this.guildID, track: this.tracks[0].track }, clientID: this.clientID });
            }
        });
        this.audioPlayer.on("error", (error) => {
            parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackExceptionEvent", guildId: this.guildID, track: this.tracks[0].track, exception: error.name, message: error.message, severity: "COMMON", cause: error.stack || new Error().stack || "Unknown" }, clientID: this.clientID });
            this._nextSong();
        });
        this.connection.subscribe(this.audioPlayer);
    }
    get state() {
        var _a;
        return {
            time: Date.now(),
            position: ((_a = this.current) === null || _a === void 0 ? void 0 : _a.playbackDuration) || 0,
            connected: this.connection.state.status === Discord.VoiceConnectionStatus.Ready
        };
    }
    _nextSong() {
        this.tracks.shift();
        if (!this.tracks.length)
            return;
        this.play();
    }
    async play() {
        if (!this.tracks.length)
            return;
        const meta = this.tracks[0];
        const decoded = encoding.decode(meta.track);
        const resource = await new Promise((resolve, reject) => {
            const sub = youtube_dl_exec_1.raw(decoded.uri, { o: "-", q: "", f: "bestaudio[ext=webm+acodec=opus+asr=48000]/bestaudio", r: "100K" }, { stdio: ["ignore", "pipe", "ignore"] });
            if (!sub.stdout)
                return reject(new Error("No stdout"));
            const stream = sub.stdout;
            const onError = (error) => {
                if (!sub.killed)
                    sub.kill();
                stream.resume();
                return reject(error);
            };
            sub.once("spawn", () => {
                Discord.demuxProbe(stream).then(probe => resolve(Discord.createAudioResource(probe.stream, { metadata: decoded, inputType: probe.type, inlineVolume: true }))).catch(onError);
            }).catch(onError);
        }).catch(e => {
            console.log(e);
            this._nextSong();
        });
        if (!resource)
            return;
        this.current = resource;
        if (meta.volume !== 100)
            this.volume(meta.volume / 100);
        this.audioPlayer.play(resource);
    }
    queue(track) {
        if (track.replace)
            this.tracks.length = 0;
        delete track.replace;
        this.tracks.push(track);
        if (track.replace)
            this.replace();
    }
    skip() {
        this.audioPlayer.stop();
    }
    replace() {
        parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "REPLACED" }, clientID: this.clientID });
        this._nextSong();
    }
    pause() {
        this.paused = this.audioPlayer.pause(true);
    }
    resume() {
        this.paused = !this.audioPlayer.unpause();
    }
    stop(destroyed) {
        this.tracks.length = 0;
        this.audioPlayer.stop(true);
        if (!destroyed)
            parentPort.postMessage({ op: Constants_1.default.workerOPCodes.MESSAGE, data: { op: "event", type: "TrackEndEvent", guildId: this.guildID, reason: "STOPPED" }, clientID: this.clientID });
    }
    destroy() {
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
        (_b = (_a = this.current) === null || _a === void 0 ? void 0 : _a.volume) === null || _b === void 0 ? void 0 : _b.setVolume(amount);
    }
}
parentPort.on("message", async (packet) => {
    var _a, _b, _c, _d, _e;
    if (packet.op === Constants_1.default.workerOPCodes.STATS) {
        const qs = [...queues.values()];
        return parentPort.postMessage({ op: Constants_1.default.workerOPCodes.REPLY, data: { playingPlayers: qs.filter(q => !q.paused).length, players: queues.size } });
    }
    else if (packet.op === Constants_1.default.workerOPCodes.MESSAGE) {
        const guildID = packet.data.guildId;
        const userID = packet.data.clientID;
        switch (packet.data.op) {
            case "play": {
                let q;
                let newQueue = false;
                if (!queues.has(`${userID}.${guildID}`)) {
                    if (packet.broadcasted)
                        return parentPort.postMessage({ op: Constants_1.default.workerOPCodes.REPLY, data: false, threadID: packet.threadID });
                    const voiceConnection = new Discord.VoiceConnection({ channelId: "", guildId: guildID, selfDeaf: false, selfMute: false }, { adapterCreator: voiceAdapterCreator(userID, guildID) });
                    q = new Queue(voiceConnection, userID, guildID);
                    newQueue = true;
                    queues.set(`${userID}.${guildID}`, q);
                    parentPort.postMessage({ op: Constants_1.default.workerOPCodes.VOICE_SERVER, data: { clientID: userID, guildId: guildID } });
                }
                else {
                    if (packet.broadcasted)
                        parentPort.postMessage({ op: Constants_1.default.workerOPCodes.REPLY, data: true, threadID: packet.threadID });
                    q = queues.get(`${userID}.${guildID}`);
                }
                q.queue({ track: packet.data.track, start: Number(packet.data.startTime || "0"), end: Number(packet.data.endTime || "0"), volume: Number(packet.data.volume || "100"), replace: !packet.data.noReplace, pause: packet.data.pause || false });
                if (newQueue)
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
                if (packet.data.volume)
                    (_c = queues.get(`${userID}.${guildID}`)) === null || _c === void 0 ? void 0 : _c.volume(packet.data.volume);
                break;
            }
        }
    }
    else if (packet.op === Constants_1.default.workerOPCodes.VOICE_SERVER) {
        (_d = methodMap.get(`${packet.data.clientID}.${packet.data.guildId}`)) === null || _d === void 0 ? void 0 : _d.onVoiceStateUpdate({ channel_id: "", guild_id: packet.data.guildId, user_id: packet.data.clientID, session_id: packet.data.sessionId, deaf: false, self_deaf: false, mute: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null });
        (_e = methodMap.get(`${packet.data.clientID}.${packet.data.guildId}`)) === null || _e === void 0 ? void 0 : _e.onVoiceServerUpdate({ guild_id: packet.data.guildId, token: packet.data.event.token, endpoint: packet.data.event.endpoint });
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
