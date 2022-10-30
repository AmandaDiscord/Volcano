import htmlParse from "node-html-parser";
import entities from "html-entities";
import { Plugin } from "volcano-sdk";

import Util from "../util/Util.js";
import Constants from "../Constants.js";

const usableRegex = /^https:\/\/[^.]+.bandcamp.com\/(?:album|track)\/[^/]+/;
const streamRegex = /(https:\/\/t4\.bcbits\.com\/stream\/[^}]+)/;
const durationRegex = /^P(\d{2})H(\d{2})M(\d{2})S$/;
const trackRegex = /\/track\//;

class BandcampSource extends Plugin {
	public source = "bandcamp";

	public canBeUsed(resource: string) {
		return !!resource.match(usableRegex);
	}

	public async infoHandler(resource: string) {
		const html = await fetch(resource, { redirect: Constants.STRINGS.FOLLOW, headers: Constants.baseHTTPRequestHeaders }).then(d => d.text());
		const data = BandcampSource.parse(html);
		const value: Awaited<ReturnType<NonNullable<Plugin["infoHandler"]>>> = { entries: [] };
		if (data["@type"].includes("MusicAlbum")) {
			value.plData = { name: data.name, selectedTrack: 0 };
			const toFetch: Array<string> = data.albumRelease.filter(r => !!r["@id"].match(trackRegex)).map(i => i["@id"]);
			await Promise.all(toFetch.map(async url => {
				const html2 = await fetch(url, { redirect: Constants.STRINGS.FOLLOW, headers: Constants.baseHTTPRequestHeaders }).then(d => d.text());
				const data2 = BandcampSource.parse(html2);
				value.entries.push(BandcampSource.trackToResource(data2));
			}));
		} else {
			value.entries.push(BandcampSource.trackToResource(data));
			if (data.inAlbum) value.plData = { name: data.inAlbum.name, selectedTrack: data.additionalProperty.find(p => p.name === "tracknum")?.value || 1 };
		}
		return value;
	}

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo) {
		const html = await fetch(info.uri!, { redirect: Constants.STRINGS.FOLLOW, headers: Constants.baseHTTPRequestHeaders }).then(d => d.text());
		const parser = htmlParse.default(html);
		const head = parser.getElementsByTagName("head")[0];
		const stream = head.toString().match(streamRegex);
		if (!stream) throw new Error("NO_STREAM_URL");
		const response = await Util.connect(entities.decode(stream[1].replace("&quot;", "")), { headers: Constants.baseHTTPRequestHeaders });

		return { stream: response };
	}

	private static parse(html: string) {
		const parser = htmlParse.default(html);
		const head = parser.getElementsByTagName("head")[0];
		const script = head.querySelector("script[type=\"application/ld+json\"]")?.innerHTML || "{}";
		const data = JSON.parse(script);
		if (!data.name) throw new Error("CANNOT_EXTRACT_BANDCAMP_INFO");
		return data;
	}

	private static trackToResource(track: any): import("volcano-sdk/types.js").TrackInfo {
		return {
			title: track.name,
			author: track.byArtist.name,
			identifier: track["@id"],
			uri: track["@id"],
			length: BandcampSource.getDurationFromString(track.duration),
			isStream: false
		};
	}

	private static getDurationFromString(duration: string) {
		const match = duration?.match(durationRegex);
		if (!match) return 0;
		const hours = Number(match[1]);
		const minutes = Number(match[2]);
		const seconds = Number(match[3]);
		return (seconds * 1000) + (minutes * 60 * 1000) + (hours * 60 * 60 * 1000);
	}
}

export default BandcampSource;
