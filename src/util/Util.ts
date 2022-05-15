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

export function request(url: string, redirects = 0) {
	if (redirects === 4) return Promise.reject(new Error("Too many redirects"));
	const remote = new URL(url);
	const reqHeaders = Object.assign({}, Constants.baseHTTPRequestHeaders, { Host: remote.host, "Alt-Used": remote.host });
	return new Promise<import("http").IncomingMessage>((res, rej) => {
		const req = icy.request({
			method: "GET",
			host: remote.hostname,
			path: `${remote.pathname}${remote.search}`,
			port: remote.port ? remote.port : (remote.protocol === "https:" ? "443" : "80"),
			protocol: remote.protocol,
			headers: reqHeaders
		}, async response => {
			response.once("error", e => {
				response.destroy();
				return rej(e);
			});
			if (response.statusCode === 302 && response.headers.location) {
				let d: import("http").IncomingMessage;
				try {
					req.destroy();
					response.destroy();
					d = await request(response.headers.location, redirects++);
				} catch (e) {
					return rej(e);
				}
				return res(d);
			} else res(response);
			response.once("end", () => {
				req.destroy();
				response.destroy();
			});
		});
		req.once("error", e => {
			req.destroy();
			return rej(e);
		});
		req.end();
	});
}

export default { processLoad, standardErrorHandler, request };
