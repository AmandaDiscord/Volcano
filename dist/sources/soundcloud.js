"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const soundcloud_scraper_1 = __importDefault(require("soundcloud-scraper"));
const playlistRegex = /\/sets\//;
const keyDir = path_1.default.join(__dirname, "../../soundcloud.txt");
let client;
function keygen() {
    soundcloud_scraper_1.default.keygen(true).then(key => {
        if (!key)
            throw new Error("SOUNDCLOUD_KEY_NO_CREATE");
        fs_1.default.writeFileSync(keyDir, key, { encoding: "utf-8" });
    });
}
if (fs_1.default.existsSync(keyDir)) {
    if (Date.now() - fs_1.default.statSync(keyDir).mtime.getTime() >= (1000 * 60 * 60 * 24 * 7))
        keygen();
}
else
    keygen();
function songResultToTrack(i) {
    if (!i.streams.hls && !i.streams.progressive)
        throw new Error("NO_SOUNDCLOUD_SONG_STREAM_URL");
    return {
        identifier: i.streams.hls ? `O:${i.streams.hls}` : i.streams.progressive,
        isSeekable: true,
        author: i.author.username,
        length: i.duration,
        isStream: false,
        position: 0,
        title: i.title,
        uri: i.url
    };
}
async function getSoundCloudAsSource(resource, isSearch) {
    if (isSearch) {
        const results = await client.search(resource, "track");
        const trackData = await Promise.all(results.map(i => client.getSongInfo(i.url, { fetchStreamURL: true })));
        return trackData.map(songResultToTrack);
    }
    const url = new URL(resource);
    if (url.pathname.split("/").length === 2) {
        const user = await client.getUser(url.pathname.split("/")[1]);
        const songs = await Promise.all(user.tracks.map(i => client.getSongInfo(i.url, { fetchStreamURL: true })));
        return songs.map(songResultToTrack);
    }
    if (resource.match(playlistRegex)) {
        const playlist = await client.getPlaylist(resource);
        return playlist.tracks.map(songResultToTrack);
    }
    const data = await client.getSongInfo(resource, { fetchStreamURL: true });
    return [songResultToTrack(data)];
}
module.exports = getSoundCloudAsSource;
