"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const youtube_dl_exec_1 = __importDefault(require("youtube-dl-exec"));
const ytdlOptions = {
    quiet: true,
    dumpSingleJson: true,
    playlistItems: "1-100",
    flatPlaylist: true,
    skipDownload: true
};
async function getYoutubeAsSource(resource, isSearch) {
    if (isSearch) {
        const searchResults = await youtube_dl_exec_1.default(`ytsearchall:${resource}`, ytdlOptions);
        return { entries: searchResults.entries };
    }
    let url = undefined;
    if (resource.startsWith("http"))
        url = new URL(resource);
    if (url && url.searchParams.get("list") && url.searchParams.get("list").startsWith("FL_") || resource.startsWith("FL_"))
        throw new Error("Favorite list playlists cannot be fetched.");
    const data = await youtube_dl_exec_1.default(resource, ytdlOptions);
    if (url && url.searchParams.has("list") || resource.startsWith("PL")) {
        return { entries: data.entries, plData: { name: data.title, selectedTrack: (url === null || url === void 0 ? void 0 : url.searchParams.get("index")) ? Number(url.searchParams.get("index")) : 1 } };
    }
    return { entries: [{ ie_key: "Youtube", description: null, id: data.id, view_count: data.view_count, title: data.title, uploader: data.uploader, url: data.id, _type: "url", duration: data.duration }] };
}
module.exports = getYoutubeAsSource;
