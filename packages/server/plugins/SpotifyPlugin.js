import { Plugin } from "volcano-sdk";
import htmlParse from "node-html-parser";

const usableRegex = /^https:\/\/(?:open\.)?spotify(?:\.app)?\.(?:(?:link)|(?:com))/;
const redirectStatusCodes = [301, 302, 303, 307, 308];

class SpotifyPlugin extends Plugin {
	constructor(utils) {
		super(utils);

		this.source = "spotify";
	}

	/**
	 * @param {string} resource
	 */
	canBeUsed(resource) {
		return usableRegex.test(resource);
	}

	/**
	 * @param {string} url
	 * @param {number} redirects
	 * @returns {Promise<string>}
	 */
	async followURLS(url, redirects = 0) {
		if (redirects > 3) throw new Error(`Too many redirects. Was redirected ${redirects} times`);
		const stream = await this.utils.connect(url, { headers: this.utils.Constants.baseHTTPRequestHeaders });
		const data = await this.utils.socketToRequest(stream);
		if (redirectStatusCodes.includes(data.status) && data.headers["location"]) {
			data.end();
			data.destroy();
			return this.followURLS(data.headers["location"], redirects++);
		} else {
			data.end();
			data.destroy();
			return url;
		}
	}

	/**
	 * @param {string} resource
	 * @returns {Promise<import("volcano-sdk/types.js").TrackData>}
	 */
	async infoHandler(resource) {
		const followed = await this.followURLS(resource);
		resource = followed;
		const response = await fetch(resource, { redirect: "follow" });
		const data = await response.text();
		/** @type {HTMLElement} */
		// @ts-ignore
		const parser = htmlParse.default(data);
		const head = parser.getElementsByTagName("head")[0];

		const type = head.querySelector("meta[property=\"og:type\"]")?.getAttribute("content") || "music.song";
		const title = head.querySelector("meta[property=\"og:title\"]")?.getAttribute("content") || `Unknown ${type === "music.playlist" ? "Track" : "Playlist"}`;
		if (type === "music.playlist") {
			const notFetched = "Track not fetched";
			/** @type {Array<import("volcano-sdk/types.js").TrackInfo>} */
			const trackList = head.querySelectorAll("meta[name=\"music:song\"]").map(i => ({ title: notFetched, author: notFetched, length: 0, uri: i.getAttribute("content") || "", identifier: i.getAttribute("content") || "", isStream: false }));
			return { entries: trackList, plData: { name: title, selectedTrack: 0 } };
		}

		const author = head.querySelector("meta[property=\"og:description\"]")?.getAttribute("content")?.split("·")?.slice(0, -2).join("·")?.trim() || "Unknown Artist";
		const uri = head.querySelector("meta[property=\"og:audio\"]")?.getAttribute("content") || "";
		const duration = +(head.querySelector("meta[name=\"music:duration\"]")?.getAttribute("content") || 0);
		const trackNumber = +(head.querySelector("meta[name=\"music:album:track\"]")?.getAttribute("content") || 0);
		/** @type {import("volcano-sdk/types.js").TrackInfo} */
		const thisTrack = { uri, title, author, length: duration * 1000, identifier: resource, isStream: false };
		if (trackNumber) return { entries: [thisTrack], plData: { name: "Unknown Playlist", selectedTrack: (trackNumber || 1) - 1 } };
		return { entries: [thisTrack] };
	}

	/** @param {import("@lavalink/encoding").TrackInfo} info */
	async streamHandler(info) {
		if (!info.uri) throw new Error("There was no URI for playback");
		return { stream: await this.utils.connect(info.uri) };
	}
}

export default SpotifyPlugin;
