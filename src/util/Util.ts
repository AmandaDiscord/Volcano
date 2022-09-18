import util from "util";
import net from "net";
import tls from "tls";
import { PassThrough, pipeline } from "stream";

import Constants from "../Constants.js";
import Logger from "./Logger.js";

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

export function standardErrorHandler(e: Error | string, response: import("http").ServerResponse, payload: any, llLog: typeof import("./Logger.js").default.info, loadType: "LOAD_FAILED" | "NO_MATCHES" = Constants.STRINGS.LOAD_FAILED, severity = Constants.STRINGS.COMMON): void {
	llLog(`Load failed\n${util.inspect(e, true, Infinity, true)}`);
	response.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(Object.assign(payload, { loadType: loadType, exception: { message: (typeof e === Constants.STRINGS.STRING ? e as string : (e as Error).message || Constants.STRINGS.EMPTY_STRING).split(Constants.STRINGS.NEW_LINE).slice(-1)[0].replace(errorRegex, Constants.STRINGS.EMPTY_STRING), severity: severity } })));
}

export function isObject(val: any) {
	return typeof val === Constants.STRINGS.FUNCTION || (typeof val === Constants.STRINGS.OBJECT && val !== null && !Array.isArray(val));
}

export function isValidKey(key: string) {
	return key !== Constants.STRINGS.PROTO && key !== Constants.STRINGS.CONSTRUCTOR && key !== Constants.STRINGS.PROTOTYPE;
}

export function mixin<T extends Record<string, any>, S extends Array<Record<string, any>>>(target: T, ...sources: S): import("../types.js").Mixin<T, S> {
	for (const obj of sources) {
		if (isObject(obj)) {
			for (const key in obj) {
				if (isValidKey(key)) step(target, obj[key], key);
			}
		}
	}
	return target as unknown as import("../types.js").Mixin<T, S>;
}

function step(target: Record<string, any>, val: Record<string, any>, key: string) {
	const obj = target[key];
	if (isObject(val) && isObject(obj)) mixin(obj, val);
	else target[key] = val;
}

export async function connect(url: string, opts?: { method?: string; headers?: { [header: string]: any } }): Promise<import("net").Socket> {
	const decoded = new URL(url);
	const options = {
		method: Constants.STRINGS.GET,
		headers: {
			Host: decoded.host,
			"User-Agent": Constants.fakeAgent,
			Accept: "*/*"
		}
	};
	if (opts) mixin(options, opts);
	const port = decoded.port.length ? Number(decoded.port) : (decoded.protocol === "https:" || decoded.protocol === "wss:" ? 443 : 80);
	let socket: import("net").Socket;
	const connectOptions: import("tls").ConnectionOptions = { host: decoded.host, port, timeout: 10000, rejectUnauthorized: false, requestCert: true };

	let res: Parameters<ConstructorParameters<PromiseConstructor>["0"]>["0"] | undefined = undefined;
	const promise = new Promise(resolve => res = resolve);
	let timer: NodeJS.Timer | undefined = undefined;
	const timerPromise = new Promise((_, reject) => {
		timer = setTimeout(() => {
			socket.destroy();
			reject(new Error(Constants.STRINGS.TIMEOUT_REACHED));
		}, 10000);
	});
	const cb = () => {
		if (timer) clearTimeout(timer);
		res!(void 0);
	};

	if (port === 443) socket = tls.connect(connectOptions, cb);
	else socket = net.connect(connectOptions as import("net").NetConnectOpts, cb);

	await Promise.race([promise, timerPromise]);

	const request = `${options.method!.toUpperCase()} ${decoded.pathname}${decoded.search} HTTP/1.0\n${Object.entries(options.headers).map(i => `${i[0]}: ${i[1]}`).join("\r\n")}\r\n\r\n`;
	socket.write(request);
	return socket;
}

const responseRegex = /((?:HTTP\/[\d.]+)|(?:ICY)) (\d+) ?(.+)?/;
const headerRegex = /([^:]+): *([^\r\n]+)/;

export function parseHeaders(data: Buffer): { protocol: string; status: number; message: string | null; headers: { [header: string]: string }; remaining: Buffer; } {
	const string = data.toString(Constants.STRINGS.UTF8);
	const lines = string.split("\n");
	const match = (lines[0] || "").match(responseRegex);
	if (!match) {
		Logger.warn(`First line in Buffer isn't an HTTP or ICY status: ${lines[0]}`);
		return { protocol: "UNKNOWN", status: 0, message: null, headers: {}, remaining: data };
	}
	const headers = {};
	let passed = 1;
	for (const line of lines.slice(1)) {
		const header = line.match(headerRegex);
		if (!header) break;
		passed++;
		headers[header[1].toLowerCase()] = header[2];
	}
	return { protocol: match[1], status: Number(match[2]), message: match[3], headers, remaining: Buffer.from(lines.slice(passed).join("\n")) };
}

export async function socketToRequest(socket: import("net").Socket): Promise<ReturnType<typeof parseHeaders> & { body: import("stream").Readable }> {
	let timer: NodeJS.Timer | undefined = undefined;
	const timerPromise = new Promise<ReturnType<typeof parseHeaders>>((_, reject) => {
		timer = setTimeout(() => {
			socket.destroy();
			reject(new Error(Constants.STRINGS.TIMEOUT_REACHED));
		}, 10000);
	});
	const dataProm = new Promise<ReturnType<typeof parseHeaders>>(res => {
		socket.once("readable", () => {
			if (timer) clearTimeout(timer);
			const d = parseHeaders(socket.read());
			res(d);
		});
	});
	const data: ReturnType<typeof parseHeaders> = await Promise.race([timerPromise, dataProm]);
	const pt = new PassThrough();
	pipeline(socket, pt, noop);
	setImmediate(() => pt.write(data.remaining));
	return Object.assign({ body: pt }, data);
}

export default { processLoad, standardErrorHandler, isObject, isValidKey, mixin, connect, parseHeaders, socketToRequest, noop };
