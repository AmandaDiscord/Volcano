"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.request = exports.standardErrorHandler = exports.processLoad = void 0;
const icy = require("icy");
const Constants_1 = __importDefault(require("../Constants"));
function processLoad() {
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
exports.processLoad = processLoad;
function standardErrorHandler(e, response, payload, llLog, loadType = "LOAD_FAILED", severity = "COMMON") {
    llLog(`Load failed\n${e}`);
    response.writeHead(200, "OK", Constants_1.default.baseHTTPResponseHeaders).write(JSON.stringify(Object.assign(payload, { loadType: loadType, exception: { message: (typeof e === "string" ? e : e.message || "").split("\n").slice(-1)[0].replace(/(Error|ERROR):? ?/, ""), severity: severity } })));
    return response.end();
}
exports.standardErrorHandler = standardErrorHandler;
function request(url, redirects = 0) {
    if (redirects === 4)
        return Promise.reject(new Error("Too many redirects"));
    const remote = new URL(url);
    const reqHeaders = Object.assign({}, Constants_1.default.baseHTTPRequestHeaders, { Host: remote.host, "Alt-Used": remote.host });
    return new Promise((res, rej) => {
        const req = icy.request({
            method: "GET",
            host: remote.hostname,
            path: `${remote.pathname}${remote.search}`,
            port: remote.port ? remote.port : (remote.protocol === "https:" ? "443" : "80"),
            protocol: remote.protocol,
            headers: reqHeaders
        }, async (response) => {
            response.once("error", e => {
                response.destroy();
                return rej(e);
            });
            if (response.statusCode === 302 && response.headers.location) {
                let d;
                try {
                    req.destroy();
                    response.destroy();
                    d = await request(response.headers.location, redirects++);
                }
                catch (e) {
                    return rej(e);
                }
                return res(d);
            }
            else
                res(response);
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
exports.request = request;
exports.default = { processLoad, standardErrorHandler, request };
