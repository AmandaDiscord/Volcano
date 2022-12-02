import { Plugin } from "volcano-sdk";
import htmlParse from "node-html-parser";

class SpotifyPlugin extends Plugin {
	/**
	 * @param {import("volcano-sdk/types").Logger} logger
	 * @param {import("volcano-sdk/types").Utils} utils
	 */
	constructor(logger, utils) {
		super(logger, utils);

		this.source = "spotify";
	}

	/**
	 * @param {string} resource
	 */
	canBeUsed(resource) {
		return resource.startsWith("https://open.spotify.com");
	}

	/**
	 * @param {string} resource
	 * @returns {Promise<import("volcano-sdk/types").TrackData>}
	 */
	async infoHandler(resource) {
		const response = await fetch(resource, { redirect: "follow" });
		const data = await response.text();
		// @ts-ignore
		const parser = htmlParse.default(data);
		const head = parser.getElementsByTagName("head")[0];

		const type = head.querySelector("meta[property=\"og:type\"]")?.getAttribute("content") || "music.song";
		const title = head.querySelector("meta[property=\"og:title\"]")?.getAttribute("content") || `Unknown ${type === "music.playlist" ? "Track" : "Playlist"}`;
		if (type === "music.playlist") {
			const notFetched = "Track not fetched";
			/** @type {Array<import("volcano-sdk/types").TrackInfo>} */
			const trackList = head.querySelectorAll("meta[name=\"music:song\"]").map(i => ({ title: notFetched, author: notFetched, length: 0, uri: i.getAttribute("content") || "", identifier: i.getAttribute("content") || "", isStream: false }));
			return { entries: trackList, plData: { name: title, selectedTrack: 0 } };
		}

		const author = head.querySelector("meta[property=\"og:description\"]")?.getAttribute("content")?.split("·")?.slice(0, -2).join("·")?.trim() || "Unknown Artist";
		const uri = head.querySelector("meta[name=\"music:preview_url:secure_url\"]")?.getAttribute("content") || "";
		const duration = +(head.querySelector("meta[name=\"music:duration\"]")?.getAttribute("content") || 0);
		const trackNumber = +(head.querySelector("meta[name=\"music:album:track\"]")?.getAttribute("content") || 0);
		/** @type {import("volcano-sdk/types").TrackInfo} */
		const thisTrack = { uri, title, author, length: duration * 1000, identifier: resource, isStream: false };
		if (trackNumber) return { entries: [thisTrack], plData: { name: "Unknown Playlist", selectedTrack: (trackNumber || 1) - 1 } };
		return { entries: [thisTrack] };
	}

	/** @param {import("@lavalink/encoding").TrackInfo} info */
	async streamHandler(info) {
		if (!info.uri) throw new Error("NO_URI");
		return { stream: await this.utils.connect(info.uri) };
	}
}

export default SpotifyPlugin;
