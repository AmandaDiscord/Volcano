import util from "util";

import Constants from "../Constants.js";

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

export default { processLoad, standardErrorHandler, isObject, isValidKey, mixin, step };
