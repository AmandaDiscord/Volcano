import { Readable } from "node:stream";

import m3u8 from "m3u8stream";
import { Plugin } from "volcano-sdk";

import type { TrackInfo } from "volcano-sdk/types.js";

type Json = Record<string, any>;

const usableRegex = /^https:\/\/(?:on\.|m\.|www\.)?soundcloud\.(?:app\.goo\.)?(?:com|gl)/;
const apiBase = "https://api-v2.soundcloud.com";
const formatTypes = [["O:", "hls", "audio/ogg"], ["U:", "hls", "audio/mpeg"], ["M:", "progressive", "audio/mpeg"], ["X:", "hls", "audio/mp4"]];

let clientID: Promise<string> | null = null;

class SoundcloudSource extends Plugin {
	public source = "soundcloud";
	public searchShorts = ["sc"];

	public canBeUsed(resource: string, searchShort?: string) {
		if (searchShort === this.searchShorts[0]) return true;
		else return usableRegex.test(resource);
	}

	public async infoHandler(resource: string, searchShort?: string) {
		if (searchShort === this.searchShorts[0]) {
			const results = await api(`${apiBase}/search/tracks?q=${encodeURIComponent(resource)}&limit=10`);
			return { entries: toTracks(results.collection) };
		}

		const followed = await this.utils.followURLS(resource);
		followed.data.end();
		followed.data.destroy();

		let data: Json;
		try {
			data = await api(`${apiBase}/resolve?url=${encodeURIComponent(followed.url.replace("://m.", "://"))}`);
		} catch {
			throw new Error("There was an error trying to extract the soundcloud info");
		}

		if (data.kind === "track") {
			const track = toTrack(data);
			if (!track) throw new Error("SoundCloud has no playable format for this track");
			return { entries: [track] };
		}

		if (data.kind !== "playlist") return { entries: [] };

		// Playlists only fully include their first few tracks
		const stubs = (data.tracks as Array<Json>).filter(t => !t.media).map(t => t.id);
		const full = new Map<number, Json>();
		for (let i = 0; i < stubs.length; i += 50) {
			for (const track of await api(`${apiBase}/tracks?ids=${stubs.slice(i, i + 50).join(",")}`)) full.set(track.id, track);
		}

		return {
			plData: { name: data.title, selectedTrack: -1 },
			entries: toTracks(data.tracks.map((t: Json) => full.get(t.id) ?? t))
		};
	}

	public async streamHandler(info: import("volcano-encoding").TrackInfo) {
		let identifier = info.identifier;
		let lookup = identifier.startsWith(`${apiBase}/`, 2) ? await api(identifier.slice(2)).catch(() => null) : null;
		if (!lookup && info.uri) {
			identifier = toTrack(await api(`${apiBase}/resolve?url=${encodeURIComponent(info.uri)}`))?.identifier ?? "";
			if (identifier) lookup = await api(identifier.slice(2));
		}
		if (!lookup?.url) throw new Error("SoundCloud has no playable format for this track");

		if (!identifier.startsWith("M:")) return { stream: m3u8(lookup.url) };
		const res = await fetch(lookup.url);
		if (!res.ok || !res.body) throw new Error(`SoundCloud responded with ${res.status} to the stream`);
		return { stream: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream) };
	}
}

function toTrack(track: Json): TrackInfo | null {
	if (track.policy === "BLOCK") return null;
	for (const [prefix, protocol, mime] of formatTypes) {
		const format = (track.media?.transcodings as Array<Json> | undefined)?.find(t => t.format?.protocol === protocol && t.format.mime_type?.split(";")[0] === mime);
		if (format) {
			return {
				identifier: `${prefix}${format.url}`,
				author: track.user.username,
				length: track.full_duration,
				isStream: false,
				title: track.title,
				uri: track.permalink_url,
				// Same as Lavaplayer's ThumbnailTools.getSoundCloudThumbnail
				artworkUrl: (track.artwork_url ?? track.user.avatar_url)?.replace("large.jpg", "original.jpg") ?? null,
				isrc: track.publisher_metadata?.isrc ?? null
			};
		}
	}
	return null;
}

function toTracks(tracks: Array<Json>) {
	return tracks.map(toTrack).filter(t => t !== null);
}

async function scrapeClientID() {
	const html = await fetch("https://soundcloud.com/").then(r => r.text());
	// It's in one of the page's script bundles, usually the last
	for (const [, src] of Array.from(html.matchAll(/<script crossorigin src="([^"]+)"/g)).reverse()) {
		const id = /client_id:"(\w+)"/.exec(await fetch(src).then(r => r.text()))?.[1];
		if (id) return id;
	}
	throw new Error("Couldn't find SoundCloud's client_id");
}

async function api(url: string, retry = true): Promise<any> {
	clientID ??= scrapeClientID().catch(e => {
		clientID = null;
		throw e;
	});
	const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}client_id=${await clientID}`);
	// SoundCloud rotates client_ids
	if (res.status === 401 && retry) {
		clientID = null;
		return api(url, false);
	}
	if (!res.ok) throw new Error(`SoundCloud responded with ${res.status}`);
	return res.json();
}

export default SoundcloudSource;
