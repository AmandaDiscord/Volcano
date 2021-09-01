"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const ytdl_core_1 = __importDefault(require("ytdl-core"));
const ytsr_1 = __importDefault(require("ytsr"));
const ytpl_1 = __importDefault(require("ytpl"));
async function getYoutubeAsSource(resource, isSearch) {
    if (isSearch) {
        if (ytdl_core_1.default.validateID(resource)) {
            const d = await ytdl_core_1.default.getBasicInfo(resource);
            return { entries: [{ id: d.videoDetails.videoId, title: d.videoDetails.title, duration: Number(d.videoDetails.lengthSeconds || 0), uploader: d.videoDetails.author.name }] };
        }
        const searchResults = await (0, ytsr_1.default)(resource);
        return { entries: searchResults.items.filter(i => i.type === "video").map(i => ({ id: i.id, title: i.title, duration: i.duration.split(":").reduce((acc, cur, ind, arr) => acc + Math.pow(60, arr.length - ((ind + 1) || 1)) * Number(cur), 0), uploader: i.author.name })) };
    }
    let url = undefined;
    if (resource.startsWith("http"))
        url = new URL(resource);
    if (url && url.searchParams.get("list") && url.searchParams.get("list").startsWith("FL_") || resource.startsWith("FL_"))
        throw new Error("Favorite list playlists cannot be fetched.");
    if (url && url.searchParams.has("list") || resource.startsWith("PL")) {
        const pl = await (0, ytpl_1.default)(resource, { limit: Infinity });
        return { entries: pl.items.map(i => ({ id: i.id, title: i.title, duration: Number(i.duration || 0), uploader: i.author.name })), plData: { name: pl.title, selectedTrack: (url === null || url === void 0 ? void 0 : url.searchParams.get("index")) ? Number(url.searchParams.get("index")) : 1 } };
    }
    const data = await ytdl_core_1.default.getBasicInfo(resource);
    return { entries: [{ id: data.videoDetails.videoId, title: data.videoDetails.title, duration: Number(data.videoDetails.lengthSeconds || 0), uploader: data.videoDetails.author.name }] };
}
module.exports = getYoutubeAsSource;
