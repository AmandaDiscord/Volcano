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

export function standardErrorHandler(e: Error | string, response: import("express").Response, payload: any, llLog: typeof import("./Logger").info, loadType: "LOAD_FAILED" | "NO_MATCHES" = "LOAD_FAILED", severity = "COMMON") {
	llLog(`Load failed\n${e}`);
	response.status(200).header(Constants.baseHTTPResponseHeaders).send(JSON.stringify(Object.assign(payload, { loadType: loadType, exception: { message: (typeof e === "string" ? e : e.message).split("\n").slice(-1)[0].replace(/(Error|ERROR):? ?/, ""), severity: severity } })));
	void 0;
}

export default { processLoad, standardErrorHandler };
