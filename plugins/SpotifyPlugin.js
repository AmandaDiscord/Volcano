// Plugin makers: Copy the definitions for all of the @typedefs and make sure your plugin
// is made to implement these interfaces, because if it does not adhere to it, it will not work.
// the constructor is not called with any params. It is up to you to get info you need
// setVariables is called before initialize so that you can access the logger.
// Your plugin will be initialized once for the main thread and once for each worker thread that spawns which is theoretically infinite
/**
 * @typedef {Object} TrackInfo
 * @property {string} title
 * @property {string} author
 * @property {string} identifier
 * @property {string} uri
 * @property {number} duration
 * @property {boolean} isStream
 */

/**
 * @typedef {Object} Logger
 * @property {(message: any, worker?: string) => void} info
 * @property {(message: any, worker?: string) => void} error
 * @property {(message: any, worker?: string) => void} warn
 */

/**
 * @typedef {Object} PluginInterface
 *
 * @property {(logger: Logger) => unknown} [setVariables]
 * @property {() => unknown} [initialize]
 * @property {string} source
 * @property {string} [searchShort]
 * @property {(resource: string, isResourceSearch: boolean) => boolean} canBeUsed
 * @property {(resource: string, isResourceSearch: boolean) => { entries: Array<TrackInfo>, plData?: { name: string; selectedTrack: number; } } | Promise<{ entries: Array<TrackInfo>, plData?: { name: string; selectedTrack: number; } }>} infoHandler
 * @property {(uri: string) => import("stream").Readable | Promise<import("stream").Readable>} streamHandler
 */

import { pipeline, PassThrough } from "stream";

import htmlParse from "node-html-parser";

function noop() { void 0; }

/** @implements {PluginInterface} */
class SpotifyPlugin {
	constructor() {
		/** @type {"spotify"} */
		this.source = "spotify";
	}

	/**
	 * @param {string} resource
	 * @param {boolean} isResourceSearch
	 */
	canBeUsed(resource, isResourceSearch) {
		return resource.startsWith("https://open.spotify.com") && !isResourceSearch;
	}

	/**
	 * @param {string} resource
	 * @returns {Promise<{ entries: Array<TrackInfo>, plData?: { name: string; selectedTrack: number; } }>}
	 */
	async infoHandler(resource) {
		const response = await fetch(resource, { redirect: "follow" });
		const data = await response.text();
		const parser = htmlParse.default(data);
		const head = parser.getElementsByTagName("head")[0];

		const type = head.querySelector("meta[property=\"og:type\"]")?.getAttribute("content") || "music.song";
		const title = head.querySelector("meta[property=\"og:title\"]")?.getAttribute("content") || `Unknown ${type === "music.playlist" ? "Track" : "Playlist"}`;
		if (type === "music.playlist") {
			const notFetched = "Track not fetched";
			/** @type {Array<TrackInfo>} */
			const trackList = head.querySelectorAll("meta[name=\"music:song\"]").map(i => ({ title: notFetched, author: notFetched, duration: 0, uri: i.getAttribute("content") || "", identifier: i.getAttribute("content") || "", isStream: false }));
			return { entries: trackList, plData: { name: title, selectedTrack: 0 } };
		}

		const author = head.querySelector("meta[property=\"og:description\"]")?.getAttribute("content")?.split("·")?.slice(0, -2).join("·")?.trim() || "Unknown Artist";
		const uri = head.querySelector("meta[name=\"music:preview_url:secure_url\"]")?.getAttribute("content") || "";
		const duration = +(head.querySelector("meta[name=\"music:duration\"]")?.getAttribute("content") || 0);
		const trackNumber = +(head.querySelector("meta[name=\"music:album:track\"]")?.getAttribute("content") || 0);
		/** @type {TrackInfo} */
		const thisTrack = { uri, title, author, duration, identifier: resource, isStream: false };
		if (trackNumber) return { entries: [thisTrack], plData: { name: "Unknown Playlist", selectedTrack: (trackNumber || 1) - 1 } };
		return { entries: [thisTrack] };
	}

	/** @param {string} uri */
	async streamHandler(uri) {
		return fetch(uri, { redirect: "follow" }).then(d => d.blob()).then(b => pipeline(b.stream(), new PassThrough(), noop));
	}
}

export default SpotifyPlugin;
