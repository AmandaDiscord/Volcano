import util from "util";
import net from "net";
import tls from "tls";
import os from "os";
import { pipeline, Transform } from "stream";

import Constants from "../Constants.js";
import Logger from "./Logger.js";

const cpuCount = os.cpus().length;

export function noop() { void 0; }

export function processLoad(): Promise<number> {
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
}

const errorRegex = /(Error|ERROR):? ?/;

export function standardErrorHandler(e: Error | string, response: import("http").ServerResponse, payload: import("lavalink-types").TrackLoadingResult, severity: import("lavalink-types").Severity = "COMMON"): void {
	lavalinkLog(`Load failed\n${util.inspect(e, false, Infinity, true)}`);
	payload.loadType = "LOAD_FAILED";
	payload.exception = {
		message: (typeof e === "string" ? e as string : (e as Error).message || "").split("\n").slice(-1)[0].replace(errorRegex, ""),
		severity: severity,
		cause: (typeof e === "string" ? new Error().stack || "unknown" : (e as Error).name)
	};
	response.writeHead(200, "OK", Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
}

export function isObject<T>(val: T): val is Record<any, any> {
	return typeof val === "function" || (typeof val === "object" && val !== null && !Array.isArray(val));
}

export function isValidKey(key: string) {
	return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

export function mixin<T extends Record<string, any>, S extends Array<Record<string, any>>>(target: T, ...sources: S): import("volcano-sdk/types.js").Mixin<T, S> {
	for (const obj of sources) {
		if (isObject(obj)) {
			for (const key in obj) {
				if (isValidKey(key)) mixinStep(target, obj[key], key);
			}
		}
	}
	return target as unknown as import("volcano-sdk/types.js").Mixin<T, S>;
}

function mixinStep(target: Record<string, any>, val: Record<string, any>, key: string) {
	const obj = target[key];
	if (isObject(val) && isObject(obj)) mixin(obj, val);
	else target[key] = val;
}

export async function createTimeoutForPromise<T>(promise: PromiseLike<T>, timeout: number): Promise<T> {
	let timer: NodeJS.Timeout | undefined = undefined;
	const timerPromise = new Promise<T>((_, reject) => {
		timer = setTimeout(() => reject(new Error("Timeout reached")), timeout);
	});
	const value = await Promise.race([promise, timerPromise]);
	if (timer) clearTimeout(timer);
	return value;
}

function getHostname(host: string): string {
	if (host[0] === "[") {
		const idx = host.indexOf("]");
		return host.substr(1, idx - 1);
	}

	const idx = host.indexOf(":");
	if (idx === -1) return host;

	return host.substr(0, idx);
}

function getServerName(host?: string) {
	if (!host) return null;

	const servername = getHostname(host);
	if (net.isIP(servername)) return "";

	return servername;
}

export async function connect(url: string, opts?: { method?: string; keepAlive?: boolean; headers?: { [header: string]: any } }): Promise<import("net").Socket> {
	const decoded = new URL(url);
	const options = {
		method: "GET",
		headers: {
			Host: decoded.host,
			"User-Agent": Constants.fakeAgent,
			Accept: "*/*"
		}
	};
	if (opts) mixin(options, opts);
	const port = decoded.port.length ? Number(decoded.port) : (decoded.protocol === "https:" || decoded.protocol === "wss:" ? 443 : 80);
	const servername = getServerName(decoded.host) || undefined;
	let socket: import("net").Socket;
	const connectOptions: import("tls").ConnectionOptions = { host: decoded.host, port, rejectUnauthorized: false, ALPNProtocols: ["http/1.1", "http/1.0", "icy"], servername };

	let res: Parameters<ConstructorParameters<PromiseConstructor>["0"]>["0"] | undefined = undefined;
	const promise = new Promise(resolve => res = resolve);

	if (port === 443) socket = tls.connect(connectOptions, res);
	else socket = net.connect(connectOptions as import("net").NetConnectOpts, res);

	socket.setNoDelay(true);

	await createTimeoutForPromise(promise, 10000);

	const request = `${options.method!.toUpperCase()} ${decoded.pathname}${decoded.search} HTTP/1.1\n${Object.entries(options.headers).map(i => `${i[0]}: ${i[1]}`).join("\r\n")}\r\n\r\n`;
	if (socket.writable) socket.write(request);
	return socket;
}

const responseRegex = /((?:HTTP\/[\d.]+)|(?:ICY)) (\d+) ?(.+)?/;
const headerRegex = /([^:]+): *([^\r\n]+)/;

type ConnectionResponseEvents = import("volcano-sdk/types.js").ConnectionResponseEvents

export interface ConnectionResponse {
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

export class ConnectionResponse extends Transform {
	private headersReceived = false;
	public headers: { [header: string]: string };
	public protocol: string;
	public status: number;
	public message: string;

	public _transform(chunk: Buffer, encoding: BufferEncoding, callback: import("stream").TransformCallback): void {
		if (this.headersReceived) {
			this.push(chunk);
			return callback();
		}

		this.headersReceived = true;
		const string = chunk.toString("utf-8");
		const lines = string.split("\n");
		const match = (lines[0] || "").match(responseRegex);
		if (!match) {
			Logger.warn(`First line in Buffer isn't an HTTP or ICY status: ${lines[0]}`);
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

export async function socketToRequest(socket: import("net").Socket): Promise<ConnectionResponse> {
	const response = pipeline(socket, new ConnectionResponse(), noop);
	const promise = new Promise<ConnectionResponse>(res => {
		response.once("headers", () => res(response));
	});
	try {
		await createTimeoutForPromise(promise, 10000);
	} catch (e) {
		socket.end();
		socket.destroy();
		socket.removeAllListeners();
		throw e;
	}
	return response;
}

export function requestBody(req: import("http").IncomingMessage, timeout = 10000): Promise<Buffer> {
	if (!req.headers["content-length"]) throw new Error("CONTENT_LENGTH_REQURED");
	const sizeToMeet = req.headers["content-length"] ? Number(req.headers["content-length"]) : Infinity;
	return new Promise<Buffer>((res, rej) => {
		let timer: NodeJS.Timeout | null = null;
		let totalSize = 0;
		const chunks: Array<Buffer> = [];
		function onData(chunk: Buffer) {
			totalSize += chunk.byteLength;
			if (totalSize > sizeToMeet) {
				req.removeListener("data", onData);
				req.removeListener("end", onEnd);
				return rej(new Error("BYTE_SIZE_DOES_NOT_MATCH_LENGTH"));
			}
			chunks.push(chunk);
		}
		function onEnd() {
			clearTimeout(timer!);
			req.removeListener("data", onData);
			res(Buffer.concat(chunks));
		}
		req.on("data", onData);
		req.once("end", onEnd);
		timer = setTimeout(() => {
			req.removeListener("data", onData);
			req.removeListener("end", onEnd);
			rej(new Error("TIMEOUT_WAITING_FOR_BODY_REACHED"));
		}, timeout);
	});
}

// This is a proper rewrite of entersState. entersState does some weird stuff with Node internal methods which could lead to
// events never firing and causing the thread to be locked and cause abort errors somehow.
export function waitForResourceToEnterState(resource: import("@discordjs/voice").VoiceConnection, status: import("@discordjs/voice").VoiceConnectionStatus, timeoutMS: number): Promise<void>;
export function waitForResourceToEnterState(resource: import("@discordjs/voice").AudioPlayer, status: import("@discordjs/voice").AudioPlayerStatus, timeoutMS: number): Promise<void>;
export function waitForResourceToEnterState(resource: import("@discordjs/voice").VoiceConnection | import("@discordjs/voice").AudioPlayer, status: import("@discordjs/voice").VoiceConnectionStatus | import("@discordjs/voice").AudioPlayerStatus, timeoutMS: number): Promise<void> {
	return new Promise((res, rej) => {
		if (resource.state.status === status) res(void 0);
		let timeout: NodeJS.Timeout | undefined = undefined;
		function onStateChange(_oldState: import("@discordjs/voice").VoiceConnectionState | import("@discordjs/voice").AudioPlayerState, newState: import("@discordjs/voice").VoiceConnectionState | import("@discordjs/voice").AudioPlayerState) {
			if (newState.status !== status) return;
			if (timeout) clearTimeout(timeout);
			(resource as import("@discordjs/voice").AudioPlayer).removeListener("stateChange", onStateChange);
			return res(void 0);
		}
		(resource as import("@discordjs/voice").AudioPlayer).on("stateChange", onStateChange);
		timeout = setTimeout(() => {
			(resource as import("@discordjs/voice").AudioPlayer).removeListener("stateChange", onStateChange);
			rej(new Error("Didn't enter state in time"));
		}, timeoutMS);
	});
}

export async function getStats(): Promise<import("lavalink-types").Stats> {
	const memory = process.memoryUsage();
	const free: number = memory.heapTotal - memory.heapUsed;
	const pload: number = await processLoad();
	const osload: Array<number> = os.loadavg();
	const threadStats: Array<{ players: number; playingPlayers: number; }> = await lavalinkThreadPool.broadcast({ op: Constants.workerOPCodes.STATS });
	return {
		players: threadStats.reduce((acc, cur) => acc + cur.players, 0),
		playingPlayers: threadStats.reduce((acc, cur) => acc + cur.playingPlayers, 0),
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
}

const quoteRegex = /"/g;

export function stringify(data: any, ignoreQuotes?: boolean) {
	if (typeof data === "bigint") return `${data.toString()}n`;
	else if (typeof data === "object" && data !== null && !Array.isArray(data)) {
		const references = new Set<any>();
		return `{${Object.entries(stringifyStep(data, references)).map(e => `${stringify(e[0])}:${stringify(e[1])}`).join(",")}}`;
	} else if (Array.isArray(data)) return `[${data.map(i => stringify(i)).join(",")}]`;
	else if (typeof data === "string" && !ignoreQuotes) return `"${data.replace(quoteRegex, "\\\"")}"`;
	else return String(data);
}

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

export default { processLoad, standardErrorHandler, isObject, isValidKey, mixin, connect, socketToRequest, noop, requestBody, waitForResourceToEnterState, getStats, createTimeoutForPromise, ConnectionResponse, stringify };
