"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.standardErrorHandler = exports.processLoad = void 0;
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
    response.status(200).header(Constants_1.default.baseHTTPResponseHeaders).send(JSON.stringify(Object.assign(payload, { loadType: loadType, exception: { message: (typeof e === "string" ? e : e.message).split("\n").slice(-1)[0].replace(/(Error|ERROR):? ?/, ""), severity: severity } })));
    void 0;
}
exports.standardErrorHandler = standardErrorHandler;
exports.default = { processLoad, standardErrorHandler };
