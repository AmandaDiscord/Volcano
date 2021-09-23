"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const tokenizer = require("@tokenizer/http");
const metadata = require("music-metadata");
const LimitedReadWriteStream_1 = __importDefault(require("../util/LimitedReadWriteStream"));
const Util_1 = __importDefault(require("../util/Util"));
const mimeRegex = /^(audio|video)\/(.+)$|^application\/(ogg)$/;
async function getHTTPAsSource(resource) {
    let parsed;
    let headers = undefined;
    try {
        const stream = await Util_1.default.request(resource);
        const readwrite = new LimitedReadWriteStream_1.default(50);
        headers = stream.headers;
        parsed = await metadata.parseStream(stream.pipe(readwrite), { mimeType: stream.headers["content-type"], size: stream.headers["content-length"] ? Number(stream.headers["content-length"]) : undefined });
        stream.destroy();
    }
    catch {
        try {
            const toke = await tokenizer.makeTokenizer(resource, { timeoutInSec: 10 }, { resolveUrl: true });
            headers = { "content-type": toke.fileInfo.mimeType, "content-length": String(toke.fileInfo.size) };
            const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout reached")), 7500));
            parsed = await Promise.race([
                timer,
                metadata.parseFromTokenizer(toke)
            ]).then(d => d[1]);
        }
        catch {
            if (!headers)
                throw new Error("MISSING_HEADERS");
            if (headers["content-type"]?.match(mimeRegex)) {
                parsed = { common: {}, format: {} };
            }
            else
                parsed = undefined;
        }
    }
    if (!parsed)
        throw new Error("NO_PARSED");
    const mimeMatch = headers["content-type"]?.match(mimeRegex);
    const chunked = !!(headers["transfer-encoding"] && headers["transfer-encoding"].includes("chunked"));
    const extra = { stream: chunked, probe: mimeMatch ? (mimeMatch[3] ? mimeMatch[3] : mimeMatch[2]) : parsed.format.container.toLowerCase() };
    if (headers["icy-description"])
        extra.title = headers["icy-description"];
    if (headers["icy-name"])
        extra.author = headers["icy-name"];
    return { parsed, extra };
}
module.exports = getHTTPAsSource;
