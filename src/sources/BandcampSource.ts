import { Readable } from "stream";

import htmlParse from "node-html-parser";
import entities from "html-entities";

import Constants from "../Constants.js";
import type { Plugin } from "../types.js";

const usableRegex = /^https:\/\/[^.]+.bandcamp.com\/(?:album|track)\/[^/]+/;
const streamRegex = /(https:\/\/t4\.bcbits\.com\/stream\/[^}]+)/;

class BandcampSource implements Plugin {
	public source = "bandcamp";

	public canBeUsed(resource: string) {
		return !!resource.match(usableRegex);
	}

	public async infoHandler(resource: string) {
		const html = await fetch(resource, { redirect: Constants.STRINGS.FOLLOW, headers: Constants.baseHTTPRequestHeaders }).then(d => d.text());
		const parser = htmlParse.default(html);
		const head = parser.getElementsByTagName("head")[0];
		const type = head.querySelector("meta[property=\"og:type\"]")?.getAttribute("content") || "track";
		const title: [string, string] = head.querySelector("meta[property=\"og:title\"]")?.getAttribute("content")?.split(", by ") as [string, string] || [`Unknown ${type}`, "Unknown author"];
		const url = head.querySelector("meta[property=\"og:url\"]")?.getAttribute("content") || resource;
		return { entries: [{ uri: url, title: title[0], author: title[1], length: 0, identifier: url, isStream: false }] };
	}

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo) {
		const html = await fetch(info.uri!, { redirect: Constants.STRINGS.FOLLOW, headers: Constants.baseHTTPRequestHeaders }).then(d => d.text());
		const parser = htmlParse.default(html);
		const head = parser.getElementsByTagName("head")[0];
		const stream = head.toString().match(streamRegex);
		if (!stream) throw new Error("NO_STREAM_URL");
		const response = await fetch(entities.decode(stream[1].replace("&quot;", "")), { redirect: Constants.STRINGS.FOLLOW, headers: Constants.baseHTTPRequestHeaders });
		const body = response.body;
		if (!body) throw new Error(Constants.STRINGS.INVALID_STREAM_RESPONSE);

		return { stream: Readable.fromWeb(body as import("stream/web").ReadableStream<any>) };
	}
}

export default BandcampSource;
