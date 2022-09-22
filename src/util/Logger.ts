import { BackTracker } from "backtracker";

import Constants from "../Constants.js";

const workerNameMaxLogLength = 10;
const scopeNameMaxLogLength = 20;

const logger = {
	post: (error: boolean, value: string) => {
		error ? console.error(value) : console.log(value);
	},
	getPrefix: (type: "warn" | "info" | "error", worker: string) => {
		const first = BackTracker.stack[1];
		const scope = `${first.filename}:${first.line}:${first.column}`;
		const color = type === Constants.STRINGS.WARN ? "\x1b[93m" : type === Constants.STRINGS.ERROR ? "\x1b[91m" : "\x1b[92m";
		return `\x1b[90m${new Date().toISOString().replace(Constants.STRINGS.T, Constants.STRINGS.SPACE).replace(Constants.STRINGS.Z, Constants.STRINGS.EMPTY_STRING)} ${type.length === 4 ? " " : ""}${color}${type.toUpperCase()} \x1b[35m${process.pid} \x1b[0m--- [${" ".repeat((workerNameMaxLogLength - worker.length) < 1 ? 1 : workerNameMaxLogLength - worker.length)}${worker}] \x1b[36m${scope}${" ".repeat((scopeNameMaxLogLength - scope.length) < 1 ? 1 : scopeNameMaxLogLength - scope.length)}\x1b[0m :`;
	},
	warn: (message: any, worker = Constants.STRINGS.MAIN) => {
		const prefix = logger.getPrefix(Constants.STRINGS.WARN, worker);
		import("./Util.js").then(Util => logger.post(false, `${prefix} ${Util.stringify(message, true)}`));
	},
	info: (message: any, worker = Constants.STRINGS.MAIN) => {
		const prefix = logger.getPrefix(Constants.STRINGS.INFO, worker);
		import("./Util.js").then(Util => logger.post(false, `${prefix} ${Util.stringify(message, true)}`));
	},
	error: (message: any, worker = Constants.STRINGS.MAIN) => {
		const prefix = logger.getPrefix(Constants.STRINGS.ERROR, worker);
		import("./Util.js").then(Util => logger.post(true, `${prefix} ${Util.stringify(message, true)}`));
	}
};

export default logger;
