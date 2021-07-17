"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const metadata = require("music-metadata");
async function getLocalAsSource(resource) {
    if (!fs_1.default.existsSync(resource))
        throw new Error("FILE_NOT_EXISTS");
    const stat = await fs_1.default.promises.stat(resource);
    if (!stat.isFile())
        throw new Error("PATH_NOT_FILE");
    const meta = await metadata.parseStream(fs_1.default.createReadStream(resource), { size: stat.size });
    const fileEnding = path_1.default.extname(resource).replace(".", "");
    if (!fileEnding)
        throw new Error("No file entension");
    return {
        identifier: resource,
        author: meta.common.artist || "Unknown artist",
        length: Math.round((meta.format.duration || 0) * 1000),
        title: meta.common.title || "Unknown title",
        probeInfo: {
            raw: fileEnding,
            name: fileEnding,
            parameters: null
        }
    };
}
module.exports = getLocalAsSource;
