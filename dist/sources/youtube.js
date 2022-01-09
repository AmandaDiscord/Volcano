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
const yt = __importStar(require("play-dl"));
async function getYoutubeAsSource(resource, isSearch) {
    if (isSearch) {
        const validated = yt.yt_validate(resource);
        if (validated) {
            try {
                const ID = yt.extractID(resource);
                if (validated === "video") {
                    const d = await yt.video_basic_info(ID);
                    return { entries: [{ id: d.video_details.id, title: d.video_details.title, duration: Number(d.video_details.durationInSec || 0), uploader: d.video_details.channel?.name || "Unknown author" }] };
                }
                else {
                    const d = await yt.playlist_info(resource, { incomplete: true });
                    if (!d)
                        throw new Error("NO_PLAYLIST");
                    await d.fetch();
                    const entries = [];
                    for (let i = 1; i < d.total_pages + 1; i++) {
                        entries.push(...d.page(i));
                    }
                    return { entries: entries.map(i => ({ id: i.id, title: i.title, duration: i.durationInSec, uploader: i.channel?.name || "Unknown author" })), plData: { name: d.title, selectedTrack: 1 } };
                }
            }
            catch {
                return doSearch();
            }
        }
        else
            return doSearch();
        async function doSearch() {
            const searchResults = await yt.search(resource, { limit: 10, source: { youtube: "video" } });
            const found = searchResults.find(v => v.id === resource);
            if (found)
                return { entries: [{ id: found.id, title: found.title, duration: found.durationInSec, uploader: found.channel?.name || "Unknown author" }] };
            return { entries: searchResults.map(i => ({ id: i.id, title: i.title, duration: i.durationInSec, uploader: i.channel?.name || "Unknown author" })) };
        }
    }
    let url = undefined;
    if (resource.startsWith("http"))
        url = new URL(resource);
    if (url && url.searchParams.get("list") && url.searchParams.get("list").startsWith("FL_") || resource.startsWith("FL_"))
        throw new Error("Favorite list playlists cannot be fetched.");
    if (url && url.searchParams.has("list") || resource.startsWith("PL")) {
        const pl = await yt.playlist_info(resource, { incomplete: true });
        if (!pl)
            throw new Error("NO_PLAYLIST");
        await pl.fetch();
        const entries = [];
        for (let i = 1; i < pl.total_pages + 1; i++) {
            entries.push(...pl.page(i));
        }
        return { entries: entries.map(i => ({ id: i.id, title: i.title, duration: i.durationInSec, uploader: i.channel?.name || "Unknown author" })), plData: { name: pl.title, selectedTrack: url?.searchParams.get("index") ? Number(url.searchParams.get("index")) : 1 } };
    }
    const data = await yt.video_basic_info(resource);
    return { entries: [{ id: data.video_details.id, title: data.video_details.title, duration: Number(data.video_details.durationInSec || 0), uploader: data.video_details.channel?.name || "Unknown author" }] };
}
module.exports = getYoutubeAsSource;
