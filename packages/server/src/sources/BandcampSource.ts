import { parse as parseHTML } from "node-html-parser";
import * as entities from "html-entities";
import { Plugin } from "volcano-sdk";

const usableRegex = /^(https?:\/\/(?:[^.]+\.)?bandcamp\.com)\/(album|track)\/[\w-]+\/?(?:\?.*)?$/;
const streamRegex = /(https:\/\/t4\.bcbits\.com\/stream\/[^}]+)/;
const tralbumRegex = /data-tralbum="([^"]+)"/;

class BandcampSource extends Plugin {
	public source = "bandcamp";

	public canBeUsed(resource: string) {
		return usableRegex.test(resource);
	}

	public async infoHandler(resource: string) {
		const [, base, type] = usableRegex.exec(resource)!;
		const res = await fetch(resource, { redirect: "follow", headers: this.utils.Constants.baseHTTPRequestHeaders });
		if (res.status === 404) return { entries: [] };
		const tralbum = tralbumRegex.exec(await res.text());
		if (!tralbum) throw new Error(`${type === "album" ? "Album" : "Track"} information not found on the Bandcamp page.`);
		const data = JSON.parse(entities.decode(tralbum[1]));
		const artworkUrl = data.art_id ? `https://f4.bcbits.com/img/a${String(data.art_id).padStart(10, "0")}_1.png` : null;
		const entries: Array<import("volcano-sdk/types.js").TrackInfo> = data.trackinfo.map((track: { title: string; title_link: string; duration: number }) => ({
			title: track.title,
			author: data.artist,
			identifier: base + track.title_link,
			uri: base + track.title_link,
			length: Math.trunc(track.duration * 1000),
			isStream: false,
			artworkUrl,
			// Album pages don't have each track's isrc
			isrc: type === "track" ? data.current?.isrc ?? null : null
		}));
		if (type === "track") return { entries: entries.slice(0, 1) };
		return { entries, plData: { name: data.current.title, selectedTrack: -1 } };
	}

	public async streamHandler(info: import("volcano-encoding").TrackInfo) {
		const html = await fetch(info.uri!, { redirect: "follow", headers: this.utils.Constants.baseHTTPRequestHeaders }).then(d => d.text());
		const parser = parseHTML(html);
		const head = parser.getElementsByTagName("head")[0];
		const stream = streamRegex.exec(head.toString());
		if (!stream) throw new Error("There was no stream URL for that track");
		const { data } = await this.utils.followURLS(entities.decode(stream[1].replace("&quot;", "")));

		return { stream: data };
	}
}

export default BandcampSource;
