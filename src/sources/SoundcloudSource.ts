import * as dl from "play-dl";

import type { Plugin } from "../types.js";

const identifierRegex = /^O:/;
const usableRegex = /^https:\/\/soundcloud.com/;

class SoundcloudSource implements Plugin {
	public source = "soundcloud";
	public searchShort = "sc";

	public canBeUsed(resource: string, isSourceSearch: boolean) {
		if (isSourceSearch) return true;
		else return !!resource.match(usableRegex);
	}

	public async infoHandler(resource: string, isSourceSearch: boolean) {
		const e = new Error("SOUNDCLOUD_NOT_FETCHABLE_RESOURCE");
		if (isSourceSearch) {
			const results = await dl.search(resource, { source: { soundcloud: "tracks" } });
			return { entries: results.map(SoundcloudSource.songResultToTrack) };
		}

		let result: import("play-dl").SoundCloud;
		try {
			result = await dl.soundcloud(resource);
		} catch {
			throw e;
		}

		if (result.type === "playlist") {
			const playlist = result as import("play-dl").SoundCloudPlaylist;
			return { entries: (playlist.tracks as Array<import("play-dl").SoundCloudTrack>).map(SoundcloudSource.songResultToTrack) };
		}

		if (result.type === "track") return { entries: [SoundcloudSource.songResultToTrack(result as import("play-dl").SoundCloudTrack)] };

		throw e;
	}

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo) {
		const url = info.identifier.replace(identifierRegex, "");
		const stream = await dl.stream_from_info(new dl.SoundCloudTrack({ user: {}, media: { transcodings: [{ format: { protocol: "hls", mime_type: "unknown" }, url: url }] } }));
		return { stream: stream.stream, type: stream.type };
	}

	private static songResultToTrack(i: import("play-dl").SoundCloudTrack) {
		if (!i.formats[0]) throw new Error("NO_SOUNDCLOUD_SONG_STREAM_URL");
		return {
			identifier: `${i.formats[0].format.protocol === "hls" ? "O:" : ""}${i.formats[0].url}`,
			author: i.user.name,
			length: i.durationInMs,
			isStream: false,
			title: i.name,
			uri: i.url
		};
	}
}

export default SoundcloudSource;
