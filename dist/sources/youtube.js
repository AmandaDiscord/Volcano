"use strict";
const yt = require("play-dl");
async function getYoutubeAsSource(resource, isSearch) {
    if (isSearch) {
        const searchResults = await yt.search(resource, { limit: 10, type: "video" });
        const found = searchResults.find(v => v.id === resource);
        if (found)
            return { entries: [{ id: found.id, title: found.title, duration: found.durationInSec, uploader: found.channel?.name || "Unknown author" }] };
        return { entries: searchResults.map(i => ({ id: i.id, title: i.title, duration: i.durationInSec, uploader: i.channel?.name || "Unknown author" })) };
    }
    let url = undefined;
    if (resource.startsWith("http"))
        url = new URL(resource);
    if (url && url.searchParams.get("list") && url.searchParams.get("list").startsWith("FL_") || resource.startsWith("FL_"))
        throw new Error("Favorite list playlists cannot be fetched.");
    if (url && url.searchParams.has("list") || resource.startsWith("PL")) {
        const pl = await yt.playlist_info(resource, true);
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
    return { entries: [{ id: data.video_details.id, title: data.video_details.title, duration: Number(data.video_details.durationInSec || 0), uploader: data.video_details.channel.name || "Unknown author" }] };
}
module.exports = getYoutubeAsSource;
