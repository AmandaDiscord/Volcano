import fs from "fs";
import path from "path";

import Scraper from "soundcloud-scraper";

const playlistRegex = /\/sets\//;

const keyDir = path.join(__dirname, "../../soundcloud.txt");
let client: Scraper.Client;

function keygen() {
	Scraper.keygen(true).then(key => {
		if (!key) throw new Error("SOUNDCLOUD_KEY_NO_CREATE");
		fs.writeFileSync(keyDir, key, { encoding: "utf-8" });
		client = new Scraper.Client(key, { fetchAPIKey: false });
	});
}

if (fs.existsSync(keyDir)) {
	if (Date.now() - fs.statSync(keyDir).mtime.getTime() >= (1000 * 60 * 60 * 24 * 7)) keygen();
	else {
		const APIKey = fs.readFileSync(keyDir, { encoding: "utf-8" });
		client = new Scraper.Client(APIKey, { fetchAPIKey: false });
	}
} else keygen();


function songResultToTrack(i: Scraper.Song) {
	if (!i.streams.hls && !i.streams.progressive) throw new Error("NO_SOUNDCLOUD_SONG_STREAM_URL");
	return {
		identifier: i.streams.hls ? `O:${i.streams.hls}` : i.streams.progressive as string,
		isSeekable: true,
		author: i.author.username as string,
		length: i.duration,
		isStream: false,
		position: 0,
		title: i.title,
		uri: i.url
	};
}

async function getSoundCloudAsSource(resource: string, isSearch: boolean) {
	if (isSearch) {
		const results = await client.search(resource, "track");
		const trackData = await Promise.all(results.map(i => client.getSongInfo(i.url, { fetchStreamURL: true })));
		return trackData.map(songResultToTrack);
	}

	const url = new URL(resource); // It's guaranteed to be a link now since searches without the scsearch: string default to YouTube.

	if (url.pathname.split("/").length === 2) { // Most likely a user. "/poggers".split("/"); // ['', 'poggers']
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

export = getSoundCloudAsSource;
