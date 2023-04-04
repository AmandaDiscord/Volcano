import { Plugin } from "volcano-sdk";
import htmlParse from "node-html-parser";

const usableRegex = /^https:\/\/(?:open\.)?spotify(?:\.app)?\.(?:(?:link)|(?:com))/;

class SpotifyPlugin extends Plugin {
	source = "spotify";

	/**
	 * @param {string} resource
	 */
	canBeUsed(resource) {
		return usableRegex.test(resource);
	}

	/**
	 * @param {string} resource
	 * @returns {Promise<import("volcano-sdk/types.js").TrackData>}
	 */
	async infoHandler(resource) {
		const data = await this.getFromLink(resource);
		return data;
	}

	/**
	 * @param {string} url
	 * @returns {Promise<import("volcano-sdk/types.js").TrackData>}
	 */
	async getFromLink(url, depth = 0) {
		const followed = depth === 0 ? await this.utils.followURLS(url, { Connection: "close" }) : { url, data: await this.utils.connect(url, { headers: { Connection: "close", ...this.utils.Constants.baseHTTPRequestHeaders } }).then(r => this.utils.socketToRequest(r)) };
		url = followed.url;

		if (url.startsWith("https://spotify.app.link")) {
			followed.data.end();
			followed.data.destroy();
			throw new Error("Cannot follow spotify.app.link urls");
		}

		const body = await this.utils.responseBody(followed.data);

		const data = body.toString();

		const parser = htmlParse.default(data);
		const head = parser.getElementsByTagName("head")[0];

		if (!head) return { entries: [] };

		const type = head.querySelector("meta[property=\"og:type\"]")?.getAttribute("content") || "music.song";
		const title = head.querySelector("meta[property=\"og:title\"]")?.getAttribute("content") || `Unknown ${type === "music.playlist" ? "Track" : "Playlist"}`;
		if (type === "music.playlist") {
			if (depth !== 0) throw new Error("Spotify playlist in a playlist?");
			/** @type {Array<string>} */
			const trackList = head.querySelectorAll("meta[name=\"music:song\"]").map(i => i.getAttribute("content") || "");
			const filtered = await trackList.filter(i => i.length);
			const tracks = await Promise.all(filtered.map(track => this.getFromLink(track, depth++)));
			return { entries: tracks.map(i => i.entries).flat(), plData: { name: title, selectedTrack: 0 } };
		}

		const author = head.querySelector("meta[property=\"og:description\"]")?.getAttribute("content")?.split("·")?.slice(0, -2).join("·")?.trim() || "Unknown Artist";
		const uri = head.querySelector("meta[property=\"og:audio\"]")?.getAttribute("content") || "";
		const duration = +(head.querySelector("meta[name=\"music:duration\"]")?.getAttribute("content") || 0);
		const trackNumber = +(head.querySelector("meta[name=\"music:album:track\"]")?.getAttribute("content") || 0);
		/** @type {import("volcano-sdk/types.js").TrackInfo} */
		const thisTrack = { uri, title, author, length: duration * 1000, identifier: url, isStream: false };
		if (trackNumber) return { entries: [thisTrack], plData: { name: "Unknown Playlist", selectedTrack: (trackNumber || 1) - 1 } };
		return { entries: [thisTrack] };
	}

	/** @param {import("@lavalink/encoding").TrackInfo} info */
	async streamHandler(info) {
		if (!info.uri) throw new Error("There was no URI for playback");
		return { stream: await this.utils.connect(info.uri, { headers: this.utils.Constants.baseHTTPRequestHeaders }) };
	}
}

export default SpotifyPlugin;
