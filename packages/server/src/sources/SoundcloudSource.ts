import * as dl from "play-dl";
import { Plugin } from "volcano-sdk";

const identifierRegex = /^O:/;
const usableRegex = /^https:\/\/(?:on\.)?soundcloud\.(?:app\.goo\.)?(?:com|gl)/;
const onSoundCloudStart = "https://on.soundcloud.com/";
const soundcloudAppGooglStart = "https://soundcloud.app.goo.gl/";

class SoundcloudSource extends Plugin {
	public source = "soundcloud";
	public searchShorts = ["sc"];

	public canBeUsed(resource: string, searchShort?: string) {
		if (searchShort === this.searchShorts[0]) return true;
		else return usableRegex.test(resource);
	}

	public async infoHandler(resource: string, searchShort?: string) {
		const e = new Error("SOUNDCLOUD_NOT_FETCHABLE_RESOURCE");
		if (searchShort === this.searchShorts[0]) {
			const results = await dl.search(resource, { source: { soundcloud: "tracks" } });
			return { entries: results.map(SoundcloudSource.songResultToTrack) };
		}

		if ((resource.slice(0, onSoundCloudStart.length) === onSoundCloudStart) || (resource.slice(0, soundcloudAppGooglStart.length) === soundcloudAppGooglStart)) {
			const socket = await this.utils.connect(resource);
			const request = await this.utils.socketToRequest(socket);
			if (!request.headers.location) throw e;
			resource = request.headers.location;
		}

		let result: import("play-dl").SoundCloud;
		try {
			result = await dl.soundcloud(resource);
		} catch {
			throw e;
		}

		if (result.type === "playlist") {
			const playlist = result as import("play-dl").SoundCloudPlaylist;
			await playlist.fetch();
			return {
				plData: {
					name: playlist.name,
					selectedTrack: 0
				},
				entries: (playlist.tracks as Array<import("play-dl").SoundCloudTrack>).map(SoundcloudSource.songResultToTrack)
			};
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
		if (!i.formats?.[0]) throw new Error("NO_SOUNDCLOUD_SONG_STREAM_URL");
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
