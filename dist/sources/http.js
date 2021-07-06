"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const centra_1 = __importDefault(require("centra"));
const metadata = require("music-metadata");
const Constants_1 = __importDefault(require("../Constants"));
const LimitedReadWriteStream_1 = __importDefault(require("../util/LimitedReadWriteStream"));
const mimeRegex = /(^(audio|video)\/(.+)$)|(^application\/ogg$)/;
async function getHTTPAsSource(resource) {
    return centra_1.default(resource, "get").header(Constants_1.default.baseHTTPRequestHeaders).compress().stream().send().then(async (res) => {
        var _a;
        const message = res;
        if (!Constants_1.default.OKStatusCodes.includes(message.statusCode)) {
            message.destroy();
            throw new Error("Non OK status code");
        }
        const mimeMatch = (_a = message.headers["content-type"]) === null || _a === void 0 ? void 0 : _a.match(mimeRegex);
        if (message.headers["content-type"] && !mimeMatch) {
            message.destroy();
            throw new Error("Unknown file format.");
        }
        const chunked = !!(message.headers["transfer-encoding"] && message.headers["transfer-encoding"].includes("chunked"));
        const readwrite = new LimitedReadWriteStream_1.default(20);
        const parsed = await metadata.parseStream(message.pipe(readwrite), { mimeType: message.headers["content-type"], size: message.headers["content-length"] ? Number(message.headers["content-length"]) : undefined });
        message.destroy();
        if (!message.headers["content-type"] && !parsed.format.container)
            throw new Error("Unknown file format.");
        const extra = {
            stream: chunked,
            probe: mimeMatch ? mimeMatch[2] : parsed.format.container.toLowerCase()
        };
        if (message.headers["icy-description"])
            extra.title = message.headers["icy-description"];
        if (message.headers["icy-name"])
            extra.author = message.headers["icy-name"];
        return { parsed, extra };
    });
}
module.exports = getHTTPAsSource;
