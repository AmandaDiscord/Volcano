import util from "util";
import net, { NetConnectOpts, Socket } from "net";
import tls from "tls";
import os from "os";
import { pipeline, Transform } from "stream";

import type { IncomingMessage, ServerResponse } from "http";
import type { ConnectionOptions } from "tls";
import type { TransformCallback } from "stream";
import type { TrackLoadingResult, Stats, Severity, ErrorResponse } from "lavalink-types";
import type { VoiceConnection, AudioPlayer, VoiceConnectionStatus, AudioPlayerStatus, VoiceConnectionState, AudioPlayerState } from "@discordjs/voice";

import Constants from "../Constants.js";

const cpuCount = os.cpus().length;

export type Mixin<T extends { [key: string | number | symbol]: any }, SR extends Array<{ [key: string | number | symbol]: any }>> = SR extends Array<infer O> ? T & O : never;

const errorRegex = /(Error|ERROR):? ?/;

const statusErrorNameMap = {
	400: "Bad Request" as const,
	404: "Not Found" as const,
	408: "Request Timeout" as const,
	413: "Payload Too Large" as const,
	415: "Unsupported Media Type" as const,
	500: "Internal Server Error" as const
};

function getServerName(host?: string) {
	if (!host) return null;

	const servername = getHostname(host);
	if (net.isIP(servername)) return "";

	return servername;
}

const responseRegex = /((?:HTTP\/[\d.]+)|(?:ICY)) (\d+) ?(.+)?/;
const headerRegex = /([^:]+): *([^\r\n]+)/;

export interface ConnectionResponseEvents {
	headers: [ConnectionResponse["headers"]];
	readable: [];
	data: [any];
	end: [];
	close: [];
	error: [Error];
}

interface ConnectionResponse {
	addListener<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	emit<E extends keyof ConnectionResponseEvents>(event: E, ...args: ConnectionResponseEvents[E]): boolean;
	eventNames(): Array<keyof ConnectionResponseEvents>;
	listenerCount(event: keyof ConnectionResponseEvents): number;
	listeners(event: keyof ConnectionResponseEvents): Array<(...args: Array<any>) => any>;
	off<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	on<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	once<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	prependListener<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	prependOnceListener<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	rawListeners(event: keyof ConnectionResponseEvents): Array<(...args: Array<any>) => any>;
	removeAllListeners(event?: keyof ConnectionResponseEvents): this;
	removeListener<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
}

class ConnectionResponse extends Transform {
	private headersReceived = false;
	public headers: { [header: string]: string };
	public protocol: string;
	public status: number;
	public message: string;

	public _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
		if (this.headersReceived) {
			this.push(chunk);
			return callback();
		}

		this.headersReceived = true;
		const string = chunk.toString("utf-8");
		const lines = string.split("\n");
		const match = (lines[0] || "").match(responseRegex);
		if (!match) {
			console.warn(`First line in Buffer isn't an HTTP or ICY status: ${lines[0]}`);
			this.protocol = "UNKNOWN";
			this.status = 0;
			this.message = "";
			this.headers = {};
			this.emit("headers", this.headers);
			this.push(chunk);
			callback();
		} else {
			const headers = {};
			let passed = 1;
			for (const line of lines.slice(1)) {
				const header = line.match(headerRegex);
				if (!header) break;
				passed++;
				headers[header[1].toLowerCase()] = header[2];
			}
			const sliced = lines.slice(passed + 2);
			this.protocol = match[1];
			this.status = Number(match[2]);
			this.message = match[3] || "";
			this.headers = headers;
			this.emit("headers", this.headers);
			if (!sliced.length) return callback();
			const remaining = Buffer.from(sliced.join("\n"));
			this.push(remaining);
			callback();
		}
	}
}

export type AccumulatorNode = {
	chunk: Buffer;
	next: AccumulatorNode | null;
}

class BufferAccumulator {
	public first: AccumulatorNode | null = null;
	public last: AccumulatorNode | null = null;
	public size = 0;
	public expecting: number | null;

	private _allocated: Buffer | null = null;
	private _streamed: number | null = null;

	public constructor(expecting?: number) {
		if (expecting) {
			this._allocated = Buffer.allocUnsafe(expecting);
			this._streamed = 0;
		}
		this.expecting = expecting ?? null;
	}

	public add(buf: Buffer): void {
		if (this._allocated && this._streamed !== null && this.expecting !== null) {
			if (this._streamed === this.expecting) return;
			if ((this._streamed + buf.byteLength) > this.expecting) buf.subarray(0, this.expecting - this._streamed).copy(this._allocated, this._streamed);
			else buf.copy(this._allocated, this._streamed);
			return;
		}
		const obj = { chunk: buf, next: null };
		if (!this.first) this.first = obj;
		if (this.last) this.last.next = obj;
		this.last = obj;
		this.size += buf.byteLength;
	}

	public concat(): Buffer | null {
		if (this._allocated) return this._allocated;
		if (!this.first) return null;
		if (!this.first.next) return this.first.chunk;
		const r = Buffer.allocUnsafe(this.size);
		let written = 0;
		let current: AccumulatorNode | null = this.first;
		while (current) {
			current.chunk.copy(r, written);
			written += current.chunk.byteLength;
			current = current.next;
		}
		return r;
	}
}

// This is a proper rewrite of entersState. entersState does some weird stuff with Node internal methods which could lead to
// events never firing and causing the thread to be locked and cause abort errors somehow.
function waitForResourceToEnterState(resource: VoiceConnection, status: VoiceConnectionStatus, timeoutMS: number): Promise<void>;
function waitForResourceToEnterState(resource: AudioPlayer, status: AudioPlayerStatus, timeoutMS: number): Promise<void>;
function waitForResourceToEnterState(resource: VoiceConnection | AudioPlayer, status: VoiceConnectionStatus | AudioPlayerStatus, timeoutMS: number): Promise<void> {
	return new Promise((res, rej) => {
		if (resource.state.status === status) res(void 0);
		let timeout: NodeJS.Timeout | undefined = undefined;
		function onStateChange(_oldState: VoiceConnectionState | AudioPlayerState, newState: VoiceConnectionState | AudioPlayerState) {
			if (newState.status !== status) return;
			if (timeout) clearTimeout(timeout);
			(resource as AudioPlayer).removeListener("stateChange", onStateChange);
			return res(void 0);
		}
		(resource as AudioPlayer).on("stateChange", onStateChange);
		timeout = setTimeout(() => {
			(resource as AudioPlayer).removeListener("stateChange", onStateChange);
			rej(new Error("Didn't enter state in time"));
		}, timeoutMS);
	});
}

const quoteRegex = /"/g;

function stringifyStep(object: any, references: Set<any>): any {
	const rebuilt = {};
	for (const key of Object.keys(object)) {
		if (key[0] === "_") continue;
		if (object[key] === undefined) continue;
		if (typeof object[key] === "object" && object[key] !== null && !Array.isArray(object[key])) {
			if (typeof object[key] === "function") continue;
			if (references.has(object[key])) rebuilt[key] = "[Circular]";
			else {
				references.add(object[key]);
				rebuilt[key] = stringifyStep(object[key], references);
			}
		} else if (Array.isArray(object[key])) rebuilt[key] = object[key].map(i => typeof i === "object" ? stringifyStep(i, references) : i);
		else rebuilt[key] = object[key];
	}

	return rebuilt;
}

const mstDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const mstMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const Util = {
	noop() { void 0; },

	processLoad(): Promise<number> {
		return new Promise(res => {
			const hrtime = process.hrtime();
			const totalUsage = process.cpuUsage();

			setTimeout(() => {
				const hrTimeDif = process.hrtime(hrtime);
				const cpuTimeDif = process.cpuUsage(totalUsage);
				const time = Math.min((hrTimeDif[0] * 1e6 + hrTimeDif[1]), 1000);
				const cpuTime = (cpuTimeDif.user + cpuTimeDif.system) / 1e3;
				res(cpuTime / time);
			}, 1000);
		});
	},

	standardTrackLoadingErrorHandler(e: Error | string, response: ServerResponse, payload: TrackLoadingResult, severity: Severity = "COMMON"): void {
		console.log(`Load failed\n${util.inspect(e, false, Infinity, true)}`);
		payload.loadType = "LOAD_FAILED";
		payload.exception = {
			message: (typeof e === "string" ? e as string : (e as Error).message || "").split("\n").slice(-1)[0].replace(errorRegex, ""),
			severity: severity,
			cause: (typeof e === "string" ? new Error().stack || "unknown" : (e as Error).name)
		};
		const stringified = JSON.stringify(payload);
		response.writeHead(200, Object.assign({ "Content-Length": Buffer.byteLength(stringified) }, Constants.baseHTTPResponseHeaders)).end(stringified);
	},

	createErrorResponse(response: ServerResponse, status: keyof typeof statusErrorNameMap, url: URL, message: string): void {
		const trace = url.searchParams.get("trace");
		const value: ErrorResponse = {
			timestamp: Date.now(),
			status,
			error: statusErrorNameMap[status],
			message,
			path: url.pathname
		};
		if (trace === "true") value.trace = new Error().stack;
		const payload = JSON.stringify(value);
		response.writeHead(status, Object.assign({ "Content-Length": Buffer.byteLength(payload) }, Constants.baseHTTPResponseHeaders)).end(payload);
	},

	async wrapRequestBodyToErrorResponse(request: IncomingMessage, response: ServerResponse, url: URL, timeout = 10000): Promise<Buffer | null> {
		let body: Buffer | null = null;
		try {
			body = await Util.requestBody(request, timeout);
		} catch (e) {
			const [status, message] = e?.message === "BYTE_SIZE_DOES_NOT_MATCH_LENGTH"
				? [413 as const, "Content-Length doesn't match body size"]
				: e?.message === "TIMEOUT_WAITING_FOR_BODY_REACHED"
					? [408 as const, `Waited for body for ${timeout} ms, but not completed`]
					: [500 as const, "An unknown error occurred waiting for the body"];
			Util.createErrorResponse(response, status, url, message);
		}
		return body;
	},

	isObject<T>(val: T): val is Record<any, any> {
		return typeof val === "function" || (typeof val === "object" && val !== null && !Array.isArray(val));
	},

	isValidKey(key: string) {
		return key !== "__proto__" && key !== "constructor" && key !== "prototype";
	},

	mixin<T extends { [key: string | number | symbol]: any }, S extends Array<{ [key: string | number | symbol]: any }>>(target: T, ...sources: S): Mixin<T, S> {
		for (const obj of sources) {
			if (Util.isObject(obj)) {
				for (const key in obj) {
					if (Util.isValidKey(key)) Util.mixinStep(target, obj[key], key);
				}
			}
		}
		return target as unknown as Mixin<T, S>;
	},

	mixinStep(target: Record<string, any>, val: Record<string, any>, key: string) {
		const obj = target[key];
		if (Util.isObject(val) && Util.isObject(obj)) Util.mixin(obj, val);
		else target[key] = val;
	},

	async createTimeoutForPromise<T>(promise: PromiseLike<T>, timeout: number): Promise<T> {
		let timer: NodeJS.Timeout | undefined = undefined;
		const timerPromise = new Promise<T>((_, reject) => {
			timer = setTimeout(() => reject(new Error("Timeout reached")), timeout);
		});
		const value = await Promise.race([promise, timerPromise]);
		if (timer) clearTimeout(timer);
		return value;
	},

	async connect(url: string, opts?: { method?: string; keepAlive?: boolean; headers?: { [header: string]: any } }): Promise<Socket> {
		const decoded = new URL(url);
		const options = {
			method: "GET",
			headers: {
				Host: decoded.host,
				"User-Agent": Constants.fakeAgent,
				Accept: "*/*"
			}
		};
		if (opts) Util.mixin(options, opts);
		const port = decoded.port.length ? Number(decoded.port) : (decoded.protocol === "https:" || decoded.protocol === "wss:" ? 443 : 80);
		const servername = getServerName(decoded.host) || undefined;
		let socket: Socket;
		const connectOptions: ConnectionOptions = { host: decoded.host, port, rejectUnauthorized: false, ALPNProtocols: ["http/1.1", "http/1.0", "icy"], servername };

		let res: Parameters<ConstructorParameters<PromiseConstructor>["0"]>["0"] | undefined = undefined;
		const promise = new Promise(resolve => res = resolve);

		if (port === 443) socket = tls.connect(connectOptions, res);
		else socket = net.connect(connectOptions as NetConnectOpts, res);

		socket.setNoDelay(true);

		await Util.createTimeoutForPromise(promise, 10000);

		const request = `${options.method!.toUpperCase()} ${decoded.pathname}${decoded.search} HTTP/1.1\n${Object.entries(options.headers).map(i => `${i[0]}: ${i[1]}`).join("\r\n")}\r\n\r\n`;
		if (socket.writable) socket.write(request);
		return socket;
	},

	ConnectionResponse,

	async socketToRequest(socket: Socket): Promise<ConnectionResponse> {
		const response = pipeline<Socket, ConnectionResponse>(socket, new ConnectionResponse(), Util.noop);
		const promise = new Promise<ConnectionResponse>(res => {
			response.once("headers", () => res(response));
		});
		try {
			await Util.createTimeoutForPromise(promise, 10000);
		} catch (e) {
			socket.end();
			socket.destroy();
			socket.removeAllListeners();
			throw e;
		}
		return response;
	},

	requestBody(req: IncomingMessage, timeout = 10000): Promise<Buffer> {
		const sizeToMeet = req.headers["content-length"] ? Number(req.headers["content-length"]) : Infinity;
		return new Promise<Buffer>((res, rej) => {
			let timer: NodeJS.Timeout | null = null;
			let totalSize = 0;
			const acc = new BufferAccumulator(sizeToMeet);
			function onData(chunk: Buffer) {
				totalSize += chunk.byteLength;
				if (totalSize > sizeToMeet) {
					req.removeListener("data", onData);
					req.removeListener("end", onEnd);
					return rej(new Error("BYTE_SIZE_DOES_NOT_MATCH_LENGTH"));
				}
				acc.add(chunk);
			}
			function onEnd() {
				clearTimeout(timer!);
				req.removeListener("data", onData);
				res(acc.concat() ?? Buffer.allocUnsafe(0));
			}
			req.on("data", onData);
			req.once("end", onEnd);
			timer = setTimeout(() => {
				req.removeListener("data", onData);
				req.removeListener("end", onEnd);
				rej(new Error("TIMEOUT_WAITING_FOR_BODY_REACHED"));
			}, timeout);
		});
	},

	BufferAccumulator,

	waitForResourceToEnterState,

	async getStats(): Promise<Stats> {
		const memory = process.memoryUsage();
		const free: number = memory.heapTotal - memory.heapUsed;
		const pload: number = await Util.processLoad();
		const osload: Array<number> = os.loadavg();
		const worker = await import("../worker.js");

		let playing = 0;
		for (const q of worker.queues.values()) {
			if (!q.actions.paused) playing++;
		}

		return {
			players: worker.queues.size,
			playingPlayers: playing,
			uptime: Math.floor(process.uptime() * 1000),
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
	},

	stringify(data: any, ignoreQuotes?: boolean) {
		if (typeof data === "bigint") return `${data.toString()}n`;
		else if (typeof data === "object" && data !== null && !Array.isArray(data)) {
			const references = new Set<any>();
			return `{${Object.entries(stringifyStep(data, references)).map(e => `${Util.stringify(e[0])}:${Util.stringify(e[1])}`).join(",")}}`;
		} else if (Array.isArray(data)) return `[${data.map(i => Util.stringify(i)).join(",")}]`;
		else if (typeof data === "string" && !ignoreQuotes) return `"${data.replace(quoteRegex, "\\\"")}"`;
		else return String(data);
	},

	dateToMSTString(date: Date): string {
		return `${mstDayNames[date.getDay()]} ${mstMonthNames[date.getMonth()]} ${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()} MST ${date.getFullYear()}`;
	},

	// TypeScript complains about string.prototype.substr being deprecated and only being available for browser compatability
	// this polyfill has been tested to be compliant with the real substr with some of its quirks like not actually returning a length
	// of the specified length
	/**
	 * Gets a substring beginning at the specified location and having the specified length.
	 * @param text this string
	 * @param from The starting position of the desired substring. The index of the first character in the string is zero.
	 * @param length The number of characters to include in the returned substring.
	 */
	substr(text: string, from: number, length?: number) {
		if (length === 0) return "";
		if (!length || (from + length) <= text.length) return text.slice(from, length ? from + length : void 0);
		return text.repeat(Math.ceil(length / (from + text.length))).slice(from, from + length);
	},

	getHTTP() {
		return import("../loaders/http.js");
	},

	getWorker() {
		return import("../worker.js");
	},

	getWebsocket() {
		return import("../loaders/websocket.js");
	},

	Constants,
};

function getHostname(host: string): string {
	if (host[0] === "[") {
		const idx = host.indexOf("]");
		return Util.substr(host, 1, idx - 1);
	}

	const idx = host.indexOf(":");
	if (idx === -1) return host;

	return Util.substr(host, 0, idx);
}

export default Util;
