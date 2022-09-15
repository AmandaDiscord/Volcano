import { isMainThread } from "worker_threads";

import ytmapi from "ytmusic-api";

import Constants from "../Constants.js";
import type { Plugin } from "../types.js";

const dl = new ytmapi.default();

class YouTubeMusicSource implements Plugin {
	public searchShort = "ytm";
	public source = Constants.STRINGS.YOUTUBE; // Filename is after main YT source so that Volcano doesn't use this source to stream. A source string is required for searchShort

	public async initialize() {
		if (isMainThread) await dl.initialize();
	}

	public canBeUsed(resource: string, isResourceSearch: boolean): boolean {
		return isResourceSearch;
	}

	public async infoHandler(resource: string) {
		const tracks = await dl.searchSongs(resource);
		return {
			entries: tracks.map(t => ({
				title: t.name,
				author: t.artists[0]?.name || Constants.STRINGS.UNKNOWN_AUTHOR,
				identifier: t.videoId,
				uri: `https://youtube.com/watch?v=${t.videoId}`,
				length: Math.round(t.duration * 1000),
				isStream: t.duration === 0
			}))
		};
	}
}

export default YouTubeMusicSource;
