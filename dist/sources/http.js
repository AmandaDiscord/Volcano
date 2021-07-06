"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const centra_1 = __importDefault(require("centra"));
const tokenizer = require("@tokenizer/http");
const metadata = require("music-metadata");
const LimitedReadWriteStream_1 = __importDefault(require("../util/LimitedReadWriteStream"));
const Constants_1 = __importDefault(require("../Constants"));
const mimeRegex = /^(audio|video)\/(.+)$|^application\/(ogg)$/;
async function getHTTPAsSource(resource) {
    var _a;
    let parsed;
    let headers;
    try {
        const toke = await tokenizer.makeTokenizer(resource, { timeoutInSec: 10 }, { resolveUrl: true });
        parsed = await metadata.parseFromTokenizer(toke);
    }
    catch {
        const stream = await centra_1.default(resource, "get").header(Constants_1.default.baseHTTPRequestHeaders).compress().stream().send();
        const readwrite = new LimitedReadWriteStream_1.default(20);
        parsed = await metadata.parseStream(stream.pipe(readwrite), { mimeType: stream.headers["content-type"], size: stream.headers["content-length"] ? Number(stream.headers["content-length"]) : undefined });
        stream.destroy();
        headers = stream.headers;
    }
    if (!headers)
        headers = await centra_1.default(resource, "head").header(Constants_1.default.baseHTTPRequestHeaders).send().then(d => d.headers);
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
