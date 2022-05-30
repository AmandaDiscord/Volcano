const icy: typeof import("http") = require("icy");

import Constants from "../Constants";

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

export function standardErrorHandler(e: Error | string, response: import("http").ServerResponse, payload: any, llLog: typeof import("./Logger").info, loadType: "LOAD_FAILED" | "NO_MATCHES" = "LOAD_FAILED", severity = "COMMON"): void {
	llLog(`Load failed\n${e}`);
	response.writeHead(200, "OK", Constants.baseHTTPResponseHeaders).write(JSON.stringify(Object.assign(payload, { loadType: loadType, exception: { message: (typeof e === "string" ? e : e.message || "").split("\n").slice(-1)[0].replace(/(Error|ERROR):? ?/, ""), severity: severity } })));
	return response.end();
}

export function request(url: string, opts?: { extraOptions?: import("http").RequestOptions; isSearch?: boolean; body?: string; }, retries = 0, redirects = 0) {
	if (redirects === 4) return Promise.reject(new Error("Too many redirects"));
	const remote = new URL(url);
	const reqHeaders: import("http").OutgoingHttpHeaders = Object.assign({ Host: remote.host, "Alt-Used": remote.host }, Constants.baseHTTPRequestHeaders, opts?.extraOptions?.headers ? opts.extraOptions.headers : {});
	if (opts?.extraOptions?.headers) delete opts.extraOptions.headers;
	return new Promise<import("http").IncomingMessage>((res, rej) => {
		const options: import("http").RequestOptions = Object.assign({
			method: "GET",
			host: remote.hostname,
			path: `${remote.pathname}${remote.search}`,
			port: remote.port ? remote.port : (remote.protocol === "https:" ? "443" : "80"),
			protocol: remote.protocol,
			headers: reqHeaders,
			family: 4
		}, opts?.extraOptions ? opts.extraOptions : {});
		if (lavalinkConfig.lavalink.server.ratelimit.ipBlocks.length) {
			options.family = 6;
			options.localAddress = getIPv6(lavalinkConfig.lavalink.server.ratelimit.ipBlocks[Math.floor(Math.random() * lavalinkConfig.lavalink.server.ratelimit.ipBlocks.length)], "LoadBalance");
		}
		const req = icy.request(options, async response => {
			if (!response.headers && response.rawHeaders) response.headers = response.rawHeaders.reduce((acc, cur, ind) => !(ind % 2) && response.rawHeaders[ind + 1] ? Object.defineProperty(acc, cur.toLowerCase(), { value: response.rawHeaders[ind + 1] }) : acc, {});
			response.once("error", e => {
				req.destroy();
				response.destroy();
				return rej(e);
			});
			response.once("end", () => {
				req.destroy();
				response.destroy();
			});
			if (Constants.RedirectStatusCodes.includes(response.statusCode!) && response.headers?.location) {
				let d: import("http").IncomingMessage;
				try {
					req.destroy();
					response.destroy();
					d = await request(response.headers.location, opts, retries, redirects++);
				} catch (e) {
					return rej(e);
				}
				return res(d);
			} else if (Constants.OKStatusCodes.includes(response.statusCode!)) res(response);
			else if (Constants.RetriableStatusCodes.includes(response.statusCode!) || Constants.RateLimitStatusCodes.includes(response.statusCode!)) {
				if (Constants.RateLimitStatusCodes.includes(response.statusCode!)) {
					if (opts?.isSearch && lavalinkConfig.lavalink.server.ratelimit.searchTriggersFail && options.family === 6) void 0;
				}
				const limit = lavalinkConfig.lavalink.server.ratelimit.retryLimit;
				if (retries > (limit === -1 ? 4 : (limit === 0 ? Infinity : limit))) return rej(new Error("Too many retries"));
				let d: import("http").IncomingMessage;
				try {
					req.destroy();
					response.destroy();
					d = await request(url, opts, retries++, redirects);
				} catch (e) {
					return rej(e);
				}
				return res(d);
			} else {
				req.destroy();
				response.destroy();
				return rej(new Error(`NOT_OK_OR_REDIRECT_STATUS ${response.statusCode}`));
			}
		});
		req.once("error", e => {
			req.destroy();
			return rej(e);
		});
		if (opts?.body) req.write(opts.body);
		req.end();
	});
}

global.lavalinkRequest = request;

export function isObject(val: any) {
	return typeof val === "function" || (typeof val === "object" && val !== null && !Array.isArray(val));
}

export function isValidKey(key: string) {
	return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

export function mixin<T extends Record<string, any>, S extends Array<Record<string, any>>>(target: T, ...sources: S): import("../types").Mixin<T, S> {
	for (const obj of sources) {
		if (isObject(obj)) {
			for (const key in obj) {
				if (isValidKey(key)) step(target, obj[key], key);
			}
		}
	}
	return target as unknown as import("../types").Mixin<T, S>;
}

function step(target: Record<string, any>, val: Record<string, any>, key: string) {
	const obj = target[key];
	if (isObject(val) && isObject(obj)) mixin(obj, val);
	else target[key] = val;
}

export function getIPv6(ip: string, strategy: typeof import("../Constants").defaultOptions["lavalink"]["server"]["ratelimit"]["strategy"]): string {
	if (!isIPv6(ip)) throw Error("Invalid IPv6 format");
	const [rawAddr, rawMask] = ip.split("/");
	let base10Mask = parseInt(rawMask);
	if (!base10Mask || base10Mask > 128 || base10Mask < 24) throw Error("Invalid IPv6 subnet");
	const base10addr = normalizeIP(rawAddr);
	const randomAddr = new Array(8).fill(1).map(() => Math.floor(Math.random() * 0xffff));

	const mergedAddr = randomAddr.map((randomItem, idx) => {
		const staticBits = Math.min(base10Mask, 16);
		base10Mask -= staticBits;
		const mask = 0xffff - ((2 ** (16 - staticBits)) - 1);
		return (base10addr[idx] & mask) + (randomItem & (mask ^ 0xffff));
	});
	const final = mergedAddr.map(x => x.toString(16)).join(":");
	if (lavalinkConfig.lavalink.server.ratelimit.excludedIps.includes(final)) return getIPv6(ip, strategy);
	return final;
}


const IPV6_REGEX = /^(([0-9a-f]{1,4}:)(:[0-9a-f]{1,4}){1,6}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,6}(:[0-9a-f]{1,4})|([0-9a-f]{1,4}:){1,7}(([0-9a-f]{1,4})|:))\/(1[0-1]\d|12[0-8]|\d{1,2})$/;
export function isIPv6(ip: string) {
	return Boolean(IPV6_REGEX.test(ip));
}

export function normalizeIP(ip: string) {
	const parts = ip.split("::").map(x => x.split(":"));
	const partStart = parts[0] || [];
	const partEnd = parts[1] || [];
	partEnd.reverse();
	const fullIP: Array<number> = new Array(8).fill(0);
	for (let i = 0; i < Math.min(partStart.length, 8); i++) {
		fullIP[i] = parseInt(partStart[i], 16) || 0;
	}
	for (let i = 0; i < Math.min(partEnd.length, 8); i++) {
		fullIP[7 - i] = parseInt(partEnd[i], 16) || 0;
	}
	return fullIP;
}

export default module.exports as typeof import("./Util");
