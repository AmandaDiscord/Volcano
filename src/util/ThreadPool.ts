import { Worker } from "worker_threads";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import util from "util";
import { pipeline } from "stream";

import logger from "./Logger.js";
import Util from "./Util.js";
import Constants from "../Constants.js";

class SingleUseMap<K, V> extends Map<K, V> {
	public use(key: K) {
		const value = this.get(key);
		this.delete(key);
		return value;
	}
}

class ThreadBasedReplier extends EventEmitter {
	public outgoing = new SingleUseMap<string, (value: unknown) => void>();
	public outgoingPersist = new Set<string>();
	public lastThreadID = 0;

	public nextThreadID() {
		return `${process.pid}_${(++this.lastThreadID)}`;
	}

	public buildRequest(op: number, data: any) {
		const threadID = this.nextThreadID();
		return { threadID, op, data };
	}

	public baseRequest(op: number, data: any, sendFn: (data: any) => any): Promise<any> {
		const raw = this.buildRequest(op, data);
		sendFn(raw);
		return new Promise(resolve => {
			this.outgoing.set(raw.threadID, resolve);
		});
	}
}

interface ThreadPoolEvents {
	message: [number, any];
	spawn: [number, Worker];
	ready: [number, Worker];
	death: [number];
	datareq: [number, any];
}

interface ThreadPool {
	addListener<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	emit<E extends keyof ThreadPoolEvents>(event: E, ...args: ThreadPoolEvents[E]): boolean;
	eventNames(): Array<keyof ThreadPoolEvents>;
	listenerCount(event: keyof ThreadPoolEvents): number;
	listeners(event: keyof ThreadPoolEvents): Array<(...args: Array<any>) => any>;
	off<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	on<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	once<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	prependListener<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	prependOnceListener<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	rawListeners(event: keyof ThreadPoolEvents): Array<(...args: Array<any>) => any>;
	removeAllListeners(event?: keyof ThreadPoolEvents): this;
	removeListener<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
}

type ThreadMessage = {
	op: typeof Constants.workerOPCodes[keyof typeof Constants.workerOPCodes];
	data?: any;
}

class ThreadPool extends ThreadBasedReplier {
	public count: number;
	public dir: string;
	public children = new Map<number, Worker>();
	public taskSizeMap = new Map<number, number>();

	public constructor(options: { size: number; dir: string; }) {
		super();

		this.count = options.size;
		this.dir = options.dir;
	}

	public async execute(message: ThreadMessage) {
		const [id, worker] = await this.getOrCreate();
		const existing = this.taskSizeMap.get(id);
		if (existing) this.taskSizeMap.set(id, existing + 1);
		else this.taskSizeMap.set(id, 1);
		return this.baseRequest(message.op, message.data, (d) => worker.postMessage(d));
	}

	private async getOrCreate(): Promise<[number, Worker]> {
		if (this.children.size < this.count) return this.spawn();
		const leastBusy = [...this.taskSizeMap.keys()].reduce((pre, cur) => Math.min(this.taskSizeMap.get(pre) || Infinity, this.taskSizeMap.get(cur)!) === this.taskSizeMap.get(pre) ? pre : cur);
		return [leastBusy, this.children.get(leastBusy)!];
	}

	private spawn(): Promise<[number, Worker]> {
		return new Promise((res, rej) => {
			const worker = new Worker(this.dir);
			const id = worker.threadId;
			this.children.set(id, worker);
			this.emit(Constants.STRINGS.SPAWN, id, worker);

			let ready = false;

			worker.on(Constants.STRINGS.MESSAGE, msg => {
				if (msg.op === Constants.workerOPCodes.READY) {
					ready = true;
					this.emit(Constants.STRINGS.READY, id, worker);
					return res([id, worker]);
				}
				if (!ready) {
					this.children.delete(id);
					return rej(new Error(Constants.STRINGS.THREAD_DID_NOT_COMMUNICATE_READY));
				}

				if (msg.op === Constants.workerOPCodes.VOICE_SERVER) return this.emit(Constants.STRINGS.DATA_REQ, msg.op, msg.data);

				if (msg.threadID && (msg.op === Constants.workerOPCodes.REPLY || msg.op === Constants.workerOPCodes.ACKKNOWLEDGE) && !this.outgoing.has(msg.threadID)) return;
				if (msg.threadID && msg.op === Constants.workerOPCodes.ACKKNOWLEDGE && this.outgoing.has(msg.threadID)) return this.outgoingPersist.has(msg.threadID) ? this.outgoing.get(msg.threadID)!(void 0) : this.outgoing.use(msg.threadID)!(void 0);
				if (msg.threadID && msg.op === Constants.workerOPCodes.REPLY && this.outgoing.has(msg.threadID) && !this.outgoingPersist.has(msg.threadID)) return this.outgoing.use(msg.threadID)!(msg.data);
				else if (msg.threadID && msg.op === Constants.workerOPCodes.REPLY && this.outgoing.has(msg.threadID) && this.outgoingPersist.has(msg.threadID)) return this.outgoing.get(msg.threadID)!(msg.data);

				if (msg.op === Constants.workerOPCodes.MESSAGE) return this.emit(Constants.STRINGS.MESSAGE, id, msg);
			});

			worker.on(Constants.STRINGS.ERROR, e => logger.error(util.inspect(e, false, Infinity, true)));

			worker.once(Constants.STRINGS.EXIT, () => onWorkerExit(id, worker, this));
		});
	}

	public async dump(): Promise<void> {
		await Promise.all([...this.children.values()].map(async child => {
			const stream = await child.getHeapSnapshot().catch(e => logger.error(util.inspect(e, false, Infinity, true)));
			if (stream) {
				const write = fs.createWriteStream(path.join(Constants.STRINGS.PATH_UP, Constants.STRINGS.PATH_UP, `worker-${child.threadId}-snapshot-${Date.now()}.heapsnapshot`));
				pipeline(stream, write, Util.noop);
			}
		}));
	}

	public send(id: number, message: ThreadMessage) {
		if (!this.children.get(id)) throw new Error(Constants.STRINGS.THREAD_NOT_IN_POOL);
		return this.baseRequest(message.op, message.data, (d) => this.children.get(id)!.postMessage(d));
	}

	public async broadcast(message: ThreadMessage) {
		if (this.children.size === 0) return [];
		const payload = this.buildRequest(message.op, message.data);
		Object.assign(payload, { broadcasted: true });
		const expecting = this.children.size;
		const result = await new Promise<Array<any>>(res => {
			const parts: Array<any> = [];
			this.outgoingPersist.add(payload.threadID);
			const timer = setTimeout(() => {
				logger.warn(`Not all threads responded to packet: ${JSON.stringify(payload)}`);
				res(parts);
			}, 5000);
			this.outgoing.set(payload.threadID, msg => {
				parts.push(msg);
				if (parts.length === expecting) {
					clearTimeout(timer);
					res(parts);
				}
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

async function onWorkerExit(id: number, worker: Worker, pool: ThreadPool) {
	let timer: NodeJS.Timeout | undefined;
	try {
		await Util.createTimeoutForPromise(worker.terminate(), 5000);
	} catch {
		const stream = await worker.getHeapSnapshot().catch(e => logger.error(util.inspect(e, false, Infinity, true)));
		if (stream) {
			const write = fs.createWriteStream(path.join(Constants.STRINGS.PATH_UP, Constants.STRINGS.PATH_UP, `worker-${id}-snapshot-${Date.now()}.heapsnapshot`));
			stream.pipe(write);
		}
		return logger.error(Constants.STRINGS.WORKER_NOT_TERMINATED_IN_TIME);
	}
	if (timer) clearTimeout(timer);
	pool.taskSizeMap.delete(id);
	pool.children.delete(id);
	worker.removeAllListeners();
	pool.emit(Constants.STRINGS.DEATH, id);
}

export default ThreadPool;
