import { BackTracker } from "backtracker";

const workerNameMaxLogLength = 10;
const scopeNameMaxLogLength = 20;

const oldLog = console.log;
const oldWarn = console.warn;
const oldErr = console.error;

function getPrefix(type: "warn" | "info" | "error", worker: string) {
	const stack = BackTracker.stack;
	const first = stack[1];
	const scope = `${first.srcFilename}:${first.srcLine}:${first.srcColumn}`;
	const color = type === "warn" ? "\x1b[93m" : type === "error" ? "\x1b[91m" : "\x1b[92m";
	return `\x1b[90m${new Date().toISOString().replace("T", " ").replace("Z", "")} ${type.length === 4 ? " " : ""}${color}${type.toUpperCase()} \x1b[35m${process.pid} \x1b[0m--- [${" ".repeat((workerNameMaxLogLength - worker.length) < 1 ? 1 : workerNameMaxLogLength - worker.length)}${worker}] \x1b[36m${scope}${" ".repeat((scopeNameMaxLogLength - scope.length) < 1 ? 1 : scopeNameMaxLogLength - scope.length)}\x1b[0m :`;
}

function post(type: "info" | "warn" | "error", ...data: Array<any>): void {
	const fn = type === "info" ? oldLog : type === "warn" ? oldWarn : oldErr;
	fn(getPrefix(type, "main"), ...data);
}

console.log = post.bind(null, "info");
console.warn = post.bind(null, "warn");
console.error = post.bind(null, "error");
