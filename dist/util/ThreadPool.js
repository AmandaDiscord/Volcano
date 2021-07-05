"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const worker_threads_1 = require("worker_threads");
const events_1 = require("events");
const Constants_1 = __importDefault(require("../Constants"));
class SingleUseMap extends Map {
    use(key) {
        const value = this.get(key);
        this.delete(key);
        return value;
    }
}
class ThreadBasedReplier extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.outgoing = new SingleUseMap();
        this.outgoingPersist = new Set();
        this.lastThreadID = 0;
    }
    nextThreadID() {
        return `${process.pid}_${(++this.lastThreadID)}`;
    }
    buildRequest(op, data) {
        const threadID = this.nextThreadID();
        return { threadID, op, data };
    }
    baseRequest(op, data, sendFn) {
        const raw = this.buildRequest(op, data);
        sendFn(raw);
        return new Promise(resolve => {
            this.outgoing.set(raw.threadID, resolve);
        });
    }
}
class ThreadPool extends ThreadBasedReplier {
    constructor(options) {
        super();
        this.children = new Map();
        this.taskSizeMap = new Map();
        this.lastWorkerID = 0;
        this.count = options.size;
        this.dir = options.dir;
    }
    nextWorkerID() {
        return `${process.pid}_worker_${(++this.lastWorkerID)}`;
    }
    async execute(message) {
        const [id, worker] = await this.getOrCreate();
        const existing = this.taskSizeMap.get(id);
        if (existing)
            this.taskSizeMap.set(id, existing + 1);
        else
            this.taskSizeMap.set(id, 1);
        return this.baseRequest(message.op, message.data, (d) => worker.postMessage(d));
    }
    async getOrCreate() {
        if (this.children.size < this.count)
            return this.spawn();
        const leastBusy = [...this.taskSizeMap.keys()].reduce((pre, cur) => Math.min(this.taskSizeMap.get(pre) || Infinity, this.taskSizeMap.get(cur)) === this.taskSizeMap.get(pre) ? pre : cur);
        return [leastBusy, this.children.get(leastBusy)];
    }
    spawn() {
        return new Promise((res, rej) => {
            const newID = this.nextWorkerID();
            if (this.children.has(newID))
                throw new Error("NEW_THREAD_EXISTS_IN_POOL");
            const worker = new worker_threads_1.Worker(this.dir);
            this.emit("spawn", newID, worker);
            let ready = false;
            worker.on("message", msg => {
                if (msg.op === Constants_1.default.workerOPCodes.READY) {
                    ready = true;
                    this.children.set(newID, worker);
                    this.emit("ready", newID, worker);
                    return res([newID, worker]);
                }
                if (!ready)
                    return rej(new Error("THREAD_DID_NOT_COMMUNICATE_READY"));
                if (msg.op === Constants_1.default.workerOPCodes.CLOSE)
                    return onWorkerExit(newID, worker, this);
                if (msg.op === Constants_1.default.workerOPCodes.VOICE_SERVER)
                    return this.emit("datareq", msg.op, msg.data);
                if (msg.threadID && (msg.op === Constants_1.default.workerOPCodes.REPLY || msg.op === Constants_1.default.workerOPCodes.ACKKNOWLEDGE) && !this.outgoing.has(msg.threadID))
                    throw new Error("THREAD_RESPONSE_NOBODY_ASKED_LOL");
                if (msg.threadID && msg.op === Constants_1.default.workerOPCodes.ACKKNOWLEDGE && this.outgoing.has(msg.threadID))
                    return this.outgoingPersist.has(msg.threadID) ? this.outgoing.get(msg.threadID)(void 0) : this.outgoing.use(msg.threadID)(void 0);
                if (msg.threadID && msg.op === Constants_1.default.workerOPCodes.REPLY && this.outgoing.has(msg.threadID) && !this.outgoingPersist.has(msg.threadID))
                    return this.outgoing.use(msg.threadID)(msg.data);
                else if (msg.threadID && msg.op === Constants_1.default.workerOPCodes.REPLY && this.outgoing.has(msg.threadID) && this.outgoingPersist.has(msg.threadID))
                    return this.outgoing.get(msg.threadID)(msg.data);
                if (msg.op === Constants_1.default.workerOPCodes.MESSAGE)
                    return this.emit("message", worker.threadId, msg);
            });
            worker.once("exit", () => onWorkerExit(newID, worker, this));
        });
    }
    send(id, message) {
        if (!this.children.get(id))
            throw new Error("THREAD_NOT_IN_POOL");
        return this.baseRequest(message.op, message.data, (d) => this.children.get(id).postMessage(d));
    }
    async broadcast(message) {
        if (this.children.size === 0)
            return [];
        const payload = this.buildRequest(message.op, message.data);
        Object.assign(payload, { broadcasted: true });
        const expecting = this.children.size;
        const result = await new Promise(res => {
            const parts = [];
            this.outgoingPersist.add(payload.threadID);
            this.outgoing.set(payload.threadID, msg => {
                parts.push(msg);
                if (parts.length === expecting)
                    res(parts);
                setTimeout(() => {
                    if (parts.length !== expecting)
                        res(parts);
                }, 5000);
            });
            for (const child of this.children.values()) {
                child.postMessage(payload);
            }
        });
        this.outgoing.delete(payload.threadID);
        this.outgoingPersist.delete(payload.threadID);
        return result;
    }
}
async function onWorkerExit(id, worker, pool) {
    worker.removeAllListeners();
    await worker.terminate();
    pool.taskSizeMap.delete(id);
    pool.children.delete(id);
    pool.emit("death", id);
}
module.exports = ThreadPool;
