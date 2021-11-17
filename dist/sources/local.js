"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const metadata = __importStar(require("music-metadata"));
async function getLocalAsSource(resource) {
    if (!fs_1.default.existsSync(resource))
        throw new Error("FILE_NOT_EXISTS");
    const stat = await fs_1.default.promises.stat(resource);
    if (!stat.isFile())
        throw new Error("PATH_NOT_FILE");
    const meta = await metadata.parseStream(fs_1.default.createReadStream(resource), { size: stat.size });
    const fileEnding = path_1.default.extname(resource).replace(".", "");
    if (!fileEnding)
        throw new Error("No file extension");
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
