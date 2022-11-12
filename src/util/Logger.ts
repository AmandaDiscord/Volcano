import { isMainThread, threadId } from "worker_threads";

import { BackTracker } from "backtracker";

const workerNameMaxLogLength = 15;
const scopeNameMaxLogLength = 20;

const logger = {
	post: (error: boolean, value: string) => {
		error ? console.error(value) : console.log(value);
	},
	getPrefix: (type: "warn" | "info" | "error", worker: string) => {
		const first = BackTracker.stack[1];
		const scope = `${first.filename}:${first.line}:${first.column}`;
		const color = type === "warn" ? "\x1b[93m" : type === "error" ? "\x1b[91m" : "\x1b[92m";
		return `\x1b[90m${new Date().toISOString().replace("T", " ").replace("Z", "")} ${type.length === 4 ? " " : ""}${color}${type.toUpperCase()} \x1b[35m${process.pid} \x1b[0m--- [${" ".repeat((workerNameMaxLogLength - worker.length) < 1 ? 1 : workerNameMaxLogLength - worker.length)}${worker}] \x1b[36m${scope}${" ".repeat((scopeNameMaxLogLength - scope.length) < 1 ? 1 : scopeNameMaxLogLength - scope.length)}\x1b[0m :`;
	},
	warn: (message: any, worker = isMainThread ? "main" : `worker ${threadId}`) => {
		const prefix = logger.getPrefix("warn", worker);
		import("./Util.js").then(Util => logger.post(false, `${prefix} ${Util.stringify(message, true)}`));
	},
	info: (message: any, worker = isMainThread ? "main" : `worker ${threadId}`) => {
		const prefix = logger.getPrefix("info", worker);
		import("./Util.js").then(Util => logger.post(false, `${prefix} ${Util.stringify(message, true)}`));
	},
	error: (message: any, worker = isMainThread ? "main" : `worker ${threadId}`) => {
		const prefix = logger.getPrefix("error", worker);
		import("./Util.js").then(Util => logger.post(true, `${prefix} ${Util.stringify(message, true)}`));
	}
};

export default logger;
