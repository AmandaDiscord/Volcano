import { BackTracker } from "backtracker";

import Constants from "../Constants.js";

const workerNameMaxLogLength = 10;
const scopeNameMaxLogLength = 20;

function stringify(data: any, ignoreQuotes?: boolean) {
	if (typeof data === Constants.STRINGS.BIGINT) return `${data.toString()}n`;
	else if (typeof data === Constants.STRINGS.OBJECT && data !== null && !Array.isArray(data)) {
		const references = new Set<any>();
		return `{${Object.entries(step(data, references)).map(e => `${stringify(e[0], true)}:${stringify(e[1])}`).join(Constants.STRINGS.COMMA)}}`;
	} else if (Array.isArray(data)) return `[${data.map(i => stringify(i)).join(Constants.STRINGS.COMMA)}]`;
	else if (typeof data === Constants.STRINGS.STRING && !ignoreQuotes) return `"${data}"`;
	else return String(data);
}

function step(object: any, references: Set<any>): any {
	const rebuilt = {};
	for (const key of Object.keys(object)) {
		if (typeof object[key] === Constants.STRINGS.OBJECT && object[key] !== null && !Array.isArray(object[key])) {
			if (references.has(object[key])) rebuilt[key] = Constants.STRINGS.CIRCULAR;
			else {
				references.add(object[key]);
				rebuilt[key] = step(object[key], references);
			}
		} else if (Array.isArray(object[key])) rebuilt[key] = object[key].map(i => stringify(i)).join(Constants.STRINGS.COMMA);
		else rebuilt[key] = stringify(object[key], true);
	}

	return rebuilt;
}

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
		logger.post(false, `${logger.getPrefix(Constants.STRINGS.WARN, worker)} ${stringify(message, true)}`);
	},
	info: (message: any, worker = Constants.STRINGS.MAIN) => {
		logger.post(false, `${logger.getPrefix(Constants.STRINGS.INFO, worker)} ${stringify(message, true)}`);
	},
	error: (message: any, worker = Constants.STRINGS.MAIN) => {
		logger.post(true, `${logger.getPrefix(Constants.STRINGS.ERROR, worker)} ${stringify(message, true)}`);
	}
};

export default logger;
