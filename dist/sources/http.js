"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const icy = require("icy");
const tokenizer = require("@tokenizer/http");
const metadata = require("music-metadata");
const LimitedReadWriteStream_1 = __importDefault(require("../util/LimitedReadWriteStream"));
const Constants_1 = __importDefault(require("../Constants"));
const mimeRegex = /^(audio|video)\/(.+)$|^application\/(ogg)$/;
async function getHTTPAsSource(resource) {
    var _a;
    const remote = new URL(resource);
    let parsed;
    let headers;
    try {
        const toke = await tokenizer.makeTokenizer(resource, { timeoutInSec: 10 }, { resolveUrl: true });
        headers = {
            "content-type": toke.fileInfo.mimeType,
            "content-length": toke.fileInfo.size
        };
        parsed = await metadata.parseFromTokenizer(toke);
    }
    catch {
        const stream = await new Promise((res, rej) => {
            const req = icy.get({
                hostname: remote.host,
                path: remote.pathname,
                protocol: remote.protocol,
                headers: Constants_1.default.baseHTTPRequestHeaders
            }, response => {
                response.once("error", e => {
                    response.destroy();
                    return rej(e);
                });
                res(response);
            });
            req.once("error", e => {
                req.destroy();
                return rej(e);
            });
            req.end();
        });
        const readwrite = new LimitedReadWriteStream_1.default(20);
        parsed = await metadata.parseStream(stream.pipe(readwrite), { mimeType: stream.headers["content-type"], size: stream.headers["content-length"] ? Number(stream.headers["content-length"]) : undefined });
        stream.destroy();
        headers = stream.headers;
    }
    if (!parsed)
        throw new Error("NO_PARSED");
    const mimeMatch = (_a = headers["content-type"]) === null || _a === void 0 ? void 0 : _a.match(mimeRegex);
    const chunked = !!(headers["transfer-encoding"] && headers["transfer-encoding"].includes("chunked"));
    const extra = {
        stream: chunked,
        probe: mimeMatch ? (mimeMatch[3] ? mimeMatch[3] : mimeMatch[2]) : parsed.format.container.toLowerCase()
    };
    if (headers["icy-description"])
        extra.title = headers["icy-description"];
    if (headers["icy-name"])
        extra.author = headers["icy-name"];
    return { parsed, extra };
}
module.exports = getHTTPAsSource;
