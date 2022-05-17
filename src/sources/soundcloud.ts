import * as play from "play-dl";

function songResultToTrack(i: import("play-dl").SoundCloudTrack) {
	if (!i.formats[0]) throw new Error("NO_SOUNDCLOUD_SONG_STREAM_URL");
	return {
		identifier: `${i.formats[0].format.protocol === "hls" ? "O:" : ""}${i.formats[0].url}`,
		isSeekable: true,
		author: i.user.name,
		length: i.durationInMs,
		isStream: false,
		position: 0,
		title: i.name,
		uri: i.url
	};
}

async function getSoundCloudAsSource(resource: string, isSearch: boolean) {
	const e = new Error("SOUNDCLOUD_NOT_FETCHABLE_RESOURCE");
	if (isSearch) {
		const results = await play.search(resource, { source: { soundcloud: "tracks" } });
		return results.map(songResultToTrack);
	}

	let result: import("play-dl").SoundCloud;
	try {
		result = await play.soundcloud(resource);
	} catch {
		throw e;
	}

	if (result.type === "user") {
		const user = result as import("play-dl").SoundCloudPlaylist;

		if (!user.tracks) throw new Error("No tracks for user");

		return (user.tracks as Array<import("play-dl").SoundCloudTrack>).map(songResultToTrack);
	}

	if (result.type === "playlist") {
		const playlist = result as import("play-dl").SoundCloudPlaylist;
		return (playlist.tracks as Array<import("play-dl").SoundCloudTrack>).map(songResultToTrack);
	}

	if (result.type === "track") return [songResultToTrack(result as import("play-dl").SoundCloudTrack)];

	throw e;
}

export = getSoundCloudAsSource;
