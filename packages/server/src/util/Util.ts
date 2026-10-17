import net, { Socket } from "node:net";
import tls from "node:tls";
import os from "node:os";
import v8 from "node:v8";
import { once } from "node:events";
import { pipeline, Transform } from "node:stream";

import type { HttpRequest, HttpResponse } from "uWebSockets.js";
import type { TransformCallback } from "node:stream";
import * as encoding from "volcano-encoding";

import type { Exception, Track, Stats, Severity, ErrorResponse } from "lavalink-types/v4.js";
import type { VoiceConnection, AudioPlayer, VoiceConnectionStatus, AudioPlayerStatus, VoiceConnectionState, AudioPlayerState } from "@discordjs/voice";

import Constants from "../Constants.js";

const cpuCount = os.cpus().length;

export type Mixin<T extends { [key: string | number | symbol]: any }, SR extends Array<{ [key: string | number | symbol]: any }>> = SR extends Array<infer O> ? T & O : never;

const errorRegex = /(Error|ERROR):? ?/;

const statusErrorNameMap = {
	400: "Bad Request" as const,
	403: "Forbidden" as const,
	404: "Not Found" as const,
	408: "Request Timeout" as const,
	413: "Payload Too Large" as const,
	415: "Unsupported Media Type" as const,
	500: "Internal Server Error" as const
};

const responseRegex = /^(HTTP\/[\d.]+|ICY) (\d+) ?(.*)/;
const headerRegex = /([^:]+): *([^\r\n]+)/;
const statusStartRegex = /^(?:HTTP\/|ICY )/;
const headerEndRegex = /\r?\n\r?\n/;
const chunkSizeRegex = /^(?:\r\n)?([\da-f]+)[ \t]*(?:;[^\r\n]*)?\r\n/i;

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
	private head: Buffer | null = Buffer.alloc(0);
	// Bytes left in the current chunk. null when the body isn't chunked, -1 after the last chunk
	private chunkLeft: number | null = null;
	private partialChunkLine: Buffer | null = null;
	public headers: { [header: string]: string } = {};
	public protocol = "UNKNOWN";
	public status = 0;
	public message = "";

	public _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
		if (!this.head) return callback(this.dechunk(chunk));

		const head = Buffer.concat([this.head, chunk]);
		// latin1 keeps string offsets equal to byte offsets
		const text = head.toString("latin1");
		const isHTTP = statusStartRegex.test(text);
		const end = headerEndRegex.exec(text);
		if (isHTTP && !end) {
			this.head = head;
			return callback();
		}
		this.head = null;

		let body = head;
		if (!end || !isHTTP) console.warn(`First line in Buffer isn't an HTTP or ICY status: ${text.split("\n", 1)[0]}`);
		else {
			const [status, ...lines] = head.toString("utf-8", 0, end.index).split(/\r?\n/);
			const match = responseRegex.exec(status);
			if (match) {
				this.protocol = match[1];
				this.status = Number(match[2]);
				this.message = match[3] || "";
			}
			for (const line of lines) {
				const header = headerRegex.exec(line);
				if (header) this.headers[header[1].toLowerCase()] = header[2];
			}
			body = head.subarray(end.index + end[0].length);
			if (this.headers["transfer-encoding"]?.toLowerCase().includes("chunked")) this.chunkLeft = 0;
		}

		this.emit("headers", this.headers);
		callback(this.dechunk(body));
	}

	private dechunk(data: Buffer): Error | null {
		if (this.chunkLeft === null) {
			if (data.length) this.push(data);
			return null;
		}
		let buf = this.partialChunkLine ? Buffer.concat([this.partialChunkLine, data]) : data;
		this.partialChunkLine = null;
		while (buf.length && this.chunkLeft !== -1) {
			if (this.chunkLeft) {
				const piece = buf.subarray(0, this.chunkLeft);
				this.push(piece);
				this.chunkLeft -= piece.length;
				buf = buf.subarray(piece.length);
				continue;
			}
			const line = chunkSizeRegex.exec(buf.toString("latin1", 0, 256));
			if (!line) {
				if (buf.length >= 256) return new Error("Malformed chunked response");
				this.partialChunkLine = buf;
				return null;
			}
			this.chunkLeft = parseInt(line[1], 16) || -1;
			buf = buf.subarray(line[0].length);
		}
		return null;
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

	private readonly _allocated: Buffer | null = null;

	public constructor(expecting?: number) {
		if (expecting) this._allocated = Buffer.allocUnsafe(expecting);
		this.expecting = expecting ?? null;
	}

	public add(buf: Buffer): void {
		if (this._allocated) {
			this.size += buf.copy(this._allocated, this.size);
			return;
		}
		// Copied because uWS empties its chunks once onData returns
		const obj = { chunk: Buffer.from(buf), next: null };
		this.first ??= obj;
		if (this.last) this.last.next = obj;
		this.last = obj;
		this.size += buf.byteLength;
	}

	public concat(): Buffer | null {
		if (this._allocated) return this._allocated.subarray(0, this.size);
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
		if (resource.state.status === status) return res(void 0);
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

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

function systemCPUTimes() {
	let busy = 0;
	let total = 0;
	for (const { times } of os.cpus()) {
		const sum = times.user + times.nice + times.sys + times.irq + times.idle;
		busy += sum - times.idle;
		total += sum;
	}
	return { busy, total };
}

let lastCPU = { at: performance.now(), process: process.cpuUsage(), system: systemCPUTimes() };

// uWebSockets.js invalidates an HttpRequest as soon as its handler awaits I/O, but error responses are often sent after that point,
// so the request details they need are captured while the request is still valid (authenticate runs first in every route).
const requestInfo = new WeakMap<HttpResponse, { url: string; query: string }>();

// A route that skipped authenticate and then awaited would otherwise throw here and leave the client hanging.
function safeRequestInfo(request: HttpRequest): { url: string; query: string } {
	try {
		return { url: request.getUrl(), query: request.getQuery() };
	} catch {
		return { url: "unknown", query: "" };
	}
}

const Util = {
	noop() { void 0; },

	// CPU use since the last call, as 0 to 1 across all cores like Lavalink reports it
	cpuLoad(): { systemLoad: number; lavalinkLoad: number } {
		const now = { at: performance.now(), process: process.cpuUsage(), system: systemCPUTimes() };
		const processMS = (now.process.user + now.process.system - lastCPU.process.user - lastCPU.process.system) / 1000;
		const load = {
			systemLoad: (now.system.busy - lastCPU.system.busy) / (now.system.total - lastCPU.system.total || 1),
			lavalinkLoad: processMS / (now.at - lastCPU.at || 1) / cpuCount
		};
		lastCPU = now;
		return load;
	},

	loadException(e: Error | string, severity: Severity = "common"): Exception {
		return {
			message: (typeof e === "string" ? e as string : (e as Error).message || "").split("\n").at(-1)?.replace(errorRegex, "") ?? "",
			severity: severity,
			cause: (typeof e === "string" ? new Error().stack ?? "unknown" : (e as Error).name)
		};
	},

	toTrack(encoded: string, userData: Record<string, unknown> = {}): Track {
		const decoded = encoding.decode(encoded);
		return {
			encoded,
			info: {
				identifier: decoded.identifier,
				isSeekable: !decoded.isStream,
				author: decoded.author,
				length: Number(decoded.length),
				isStream: decoded.isStream,
				position: Number(decoded.position),
				title: decoded.title,
				uri: decoded.uri ?? null,
				artworkUrl: decoded.artworkUrl,
				isrc: decoded.isrc,
				sourceName: decoded.source
			},
			pluginInfo: decoded.probeInfo ? { probeInfo: decoded.probeInfo.raw } : {},
			userData
		};
	},

	/** Stream lengths are Long.MAX like Lavalink, which a double prints as 9223372036854776000. Java and Rust clients can't parse that as a long */
	stringify(value: unknown): string {
		return JSON.stringify(value).replaceAll("\"length\":9223372036854776000", "\"length\":9223372036854775807");
	},

	tryToTrack(encoded: string): Track | null {
		try {
			return Util.toTrack(encoded);
		} catch {
			return null;
		}
	},

	assignHeadersToResponse(response: HttpResponse, headers: Record<string, string>) {
		for (const [header, value] of Object.entries(headers)) {
			response.writeHeader(header, value);
		}
	},

	createErrorResponse(request: HttpRequest, response: HttpResponse, status: keyof typeof statusErrorNameMap, message: string): void {
		if (response.aborted) return;
		const info = requestInfo.get(response) ?? safeRequestInfo(request);
		const params = new URLSearchParams(info.query);
		const trace = params.get("trace");
		const value: ErrorResponse = {
			timestamp: Date.now(),
			status,
			error: statusErrorNameMap[status],
			message,
			path: info.url
		};
		if (trace === "true") value.trace = new Error().stack;
		const payload = JSON.stringify(value);
		response.cork(() => {
			response.writeStatus(`${status} ${value.error}`);
			Util.assignHeadersToResponse(response, Constants.baseHTTPResponseHeaders);
			response.end(payload, true);
		});
	},

	async wrapRequestBodyToErrorResponse(request: HttpRequest, response: HttpResponse, timeout = 10000): Promise<Buffer | null> {
		let body: Buffer | null = null;
		try {
			body = await Util.requestBody(request, response, timeout);
		} catch (e) {
			if (response.aborted) return null;
			const [status, message] = e?.message === "BYTE_SIZE_DOES_NOT_MATCH_LENGTH"
				? [413 as const, "Content-Length doesn't match body size"]
				: e?.message === "TIMEOUT_WAITING_FOR_BODY_REACHED"
					? [408 as const, `Waited for body for ${timeout} ms, but not completed`]
					: [500 as const, "An unknown error occurred waiting for the body"];
			Util.createErrorResponse(request, response, status, message);
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
		try {
			return await Promise.race([promise, timerPromise]);
		} finally {
			clearTimeout(timer);
		}
	},

	async connect(url: string, opts?: { method?: string; keepAlive?: boolean; headers?: { [header: string]: any } }): Promise<Socket> {
		const decoded = new URL(url);
		const options = {
			method: "GET",
			headers: {
				Host: decoded.host,
				"User-Agent": Constants.fakeAgent,
				Accept: "*/*",
				Connection: "close"
			}
		};
		if (opts) Util.mixin(options, opts);
		const secure = decoded.protocol === "https:" || decoded.protocol === "wss:";
		const host = decoded.hostname.replace(/^\[|\]$/g, "");
		const port = decoded.port ? Number(decoded.port) : secure ? 443 : 80;
		const socket = secure
			? tls.connect({ host, port, rejectUnauthorized: false, ALPNProtocols: ["http/1.1", "http/1.0", "icy"], servername: net.isIP(host) ? "" : host })
			: net.connect({ host, port });

		socket.setNoDelay(true);

		try {
			await Util.createTimeoutForPromise(once(socket, secure ? "secureConnect" : "connect"), 10000);
		} catch (e) {
			socket.destroy();
			throw e;
		}

		socket.write(`${options.method.toUpperCase()} ${decoded.pathname}${decoded.search} HTTP/1.1\r\n${Object.entries(options.headers).map(i => `${i[0]}: ${i[1]}`).join("\r\n")}\r\n\r\n`);
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

	requestBody(request: HttpRequest, response: HttpResponse, timeout = 10000): Promise<Buffer> {
		const sizeToMeet = request.getHeader("content-length") ? Number(request.getHeader("content-length")) : undefined;
		return new Promise<Buffer>((res, rej) => {
			let timer: NodeJS.Timeout | null = null;
			let totalSize = 0;
			const acc = new BufferAccumulator(sizeToMeet);
			response.onData((chunk, last) => {
				totalSize += chunk.byteLength;
				if (totalSize > (sizeToMeet || Infinity)) {
					clearTimeout(timer!);
					return rej(new Error("BYTE_SIZE_DOES_NOT_MATCH_LENGTH"));
				}
				acc.add(Buffer.from(chunk));
				if (last) {
					clearTimeout(timer!);
					res(acc.concat() ?? Buffer.allocUnsafe(0));
				}
			});
			// This replaces attachAborthandler's handler, so it has to set aborted too
			response.onAborted(() => {
				response.aborted = true;
				clearTimeout(timer!);
				rej(new Error("CLIENT_ABORTED"));
			});
			timer = setTimeout(() => rej(new Error("TIMEOUT_WAITING_FOR_BODY_REACHED")), timeout);
		});
	},

	responseBody(response: ConnectionResponse, timeout = 10000): Promise<Buffer> {
		const sizeToMeet = response.headers["content-length"] ? Number(response.headers["content-length"]) : undefined;
		return new Promise<Buffer>((res, rej) => {
			let timer: NodeJS.Timeout | null = null;
			let totalSize = 0;
			const acc = new BufferAccumulator(sizeToMeet);
			const onData = (chunk: Buffer) => {
				totalSize += chunk.byteLength;
				if (totalSize > (sizeToMeet || Infinity)) {
					clearTimeout(timer!);
					return rej(new Error("BYTE_SIZE_DOES_NOT_MATCH_LENGTH"));
				}
				acc.add(chunk);
			};
			const onEnd = () => {
				clearTimeout(timer!);
				res(acc.concat() ?? Buffer.allocUnsafe(0));
			};
			response.on("data", onData);
			response.once("end", onEnd);
			response.once("error", e => {
				clearTimeout(timer!);
				rej(e);
			});
			timer = setTimeout(() => {
				response.removeListener("data", onData);
				response.removeListener("end", onEnd);
				rej(new Error(`Timed out waiting for a website to finish sending the response body. Waited ${timeout} ms`));
			}, timeout);
		});
	},

	BufferAccumulator,

	waitForResourceToEnterState,

	async getStats(session?: { userID: string; players: Array<string> }): Promise<Omit<Stats, "frameStats"> & { frameStats: Stats["frameStats"] | null }> {
		const memory = process.memoryUsage();
		const free: number = memory.heapTotal - memory.heapUsed;
		const { players, playingPlayers, frames } = await (await import("./ThreadPool.js")).stats();
		const counts = session?.players.map(guildID => frames[`${session.userID}.${guildID}`]).filter(c => c !== undefined) ?? [];
		const sent = counts.reduce((acc, [s]) => acc + s, 0);
		const nulled = counts.reduce((acc, [, n]) => acc + n, 0);

		return {
			players,
			playingPlayers,
			uptime: Math.floor(process.uptime() * 1000),
			memory: {
				reservable: v8.getHeapStatistics().heap_size_limit,
				used: memory.heapUsed,
				free: free,
				allocated: memory.rss
			},
			cpu: {
				cores: cpuCount,
				...Util.cpuLoad()
			},
			// Averaged per player with Java's integer division. 3000 is a minute of 20ms frames
			frameStats: counts.length ? {
				sent: Math.trunc(sent / counts.length),
				nulled: Math.trunc(nulled / counts.length),
				deficit: Math.trunc((counts.length * 3000 - sent - nulled) / counts.length)
			} : null
		};
	},

	getHTTP() {
		return import("../loaders/http.js");
	},

	getThreadPool() {
		return import("./ThreadPool.js");
	},

	getWebsocket() {
		return import("../loaders/websocket.js");
	},

	Constants,

	attachAborthandler(res: HttpResponse) {
		res.onAborted(() => {
			res.aborted = true;
		});
	},

	authenticate(req: HttpRequest, res: HttpResponse) {
		requestInfo.set(res, { url: req.getUrl(), query: req.getQuery() });
		const auth = req.getHeader("authorization");
		if (auth !== lavalinkConfig.lavalink.server.password) {
			const ip = Buffer.from(res.getRemoteAddressAsText()).toString();
			console.error(`Authorization missing for ${ip} on ${req.getMethod().toUpperCase()} ${req.getUrl()}`);
			res.writeStatus("403 Forbidden")
				.writeHeader("Lavalink-Api-Version", lavalinkMajor)
				.endWithoutBody(0, true);
			return false;
		}
		return true;
	},

	async followURLS(url: string, headers?: Record<string, string>, redirects = 0): Promise<{ url: string; data: ConnectionResponse }> {
		if (redirects > 3) throw new Error(`Too many redirects. Was redirected ${redirects} times`);
		const stream = await Util.connect(url, { headers: { ...Constants.baseHTTPRequestHeaders, ...headers } });
		const data = await Util.socketToRequest(stream);
		if (redirectStatusCodes.has(data.status) && data.headers["location"]) {
			data.end();
			data.destroy();
			return Util.followURLS(new URL(data.headers["location"], url).href, headers, redirects + 1);
		} else return { url, data };
	}
};

export default Util;
