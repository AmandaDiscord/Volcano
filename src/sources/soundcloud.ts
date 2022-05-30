import * as lamp from "lava-lamp";

function songResultToTrack(i: import("lava-lamp").SoundCloudTrack) {
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
		const results = await lamp.search(resource, { source: { soundcloud: "tracks" } });
		return results.map(songResultToTrack);
	}

	let result: import("lava-lamp").SoundCloud;
	try {
		result = await lamp.soundcloud(resource);
	} catch {
		throw e;
	}

	if (result.type === "playlist") {
		const playlist = result as import("lava-lamp").SoundCloudPlaylist;
		return (playlist.tracks as Array<import("lava-lamp").SoundCloudTrack>).map(songResultToTrack);
	}

	if (result.type === "track") return [songResultToTrack(result as import("lava-lamp").SoundCloudTrack)];

	throw e;
}

export = getSoundCloudAsSource;
