import util from "util";

import * as dl from "play-dl";
import ytmapi from "ytmusic-api";
import { Plugin } from "volcano-sdk";

const ytm = new ytmapi.default();
const usableRegex = /^https:\/\/(?:(?:www\.)|(?:music\.))?youtu\.?be(?:\.com)?\//;
const httpRegex = /^https:\/\//;

const disallowedPLTypes = ["LL", "WL"];
const cannotExtractChannels = [
	"UCrpQ4p1Ql_hG8rKXIKM1MOQ", // beauty
	"UCtFRv9O2AHqOZjjynzrv-xg", // learning
	"UCEgdi0XIXXZ-qJOFPf4JSKw", // sports
	"UCYfdidRxbB8Qhf0Nx7ioOYw", // news
	"UC4R8DWoMoI7CAwX8_LjQHig", // live
	"UC-9-kyTW8ZkZNDHQJ6FgpwQ", // music
	"UCkYQyvc_i9hXEo4xic9Hh2g" // shopping
];
const cannotExtractRoutes = [
	"/podcasts",
	"/@learning",
	"/sports",
	"/@news",
	"/gaming",
	"/@gaming",
	"/@live",
	"/feed/trending",
	"/feed/storefront"
];
const cannotExtractRoutesMusic = [
	"/explore",
	"/library"
];
const recoverablePlaylistErrorsWithV = [
	"does not exist",
	"type is unviewable"
];

class YouTubeSource extends Plugin {
	public source = "youtube";
	public searchShorts = ["yt", "ytm"];

	public async initialize() {
		await ytm.initialize();
	}

	public canBeUsed(resource: string, searchShort?: string) {
		if (searchShort && this.searchShorts.includes(searchShort)) return true;
		else return usableRegex.test(resource);
	}

	public async infoHandler(resource: string, searchShort?: string) {
		const extracted = YouTubeSource.extract(resource, searchShort);
		if (extracted.type === "cannot_extract") throw new Error("This is likely not a resource that can be extracted");

		if (extracted.type === "search") {
			if (extracted.site === "yt") return YouTubeSource.doSearch(extracted.search);
			else if (extracted.site === "ytm") {
				const tracks = await ytm.searchSongs(extracted.search);
				return {
					entries: tracks.map(t => ({
						title: t.name,
						author: t.artists[0]?.name || "Unknown author",
						identifier: t.videoId,
						uri: `https://youtube.com/watch?v=${t.videoId}`,
						length: Math.round(t.duration * 1000),
						isStream: t.duration === 0
					})),
					loadType: "SEARCH_RESULT" as const
				};
			}
		} else if (extracted.type === "playlist_with_watch" || extracted.type === "playlist") {
			if (extracted.list.startsWith("FL_")) throw new Error("Favorite list playlists cannot be fetched.");
			if (disallowedPLTypes.includes(extracted.list)) throw new Error("That playlist is private and cannot be fetched.");
			let pl: dl.YouTubePlayList | undefined;
			try {
				pl = await dl.playlist_info(extracted.list, { incomplete: true });
			} catch (e) {
				if (extracted.type !== "playlist_with_watch" || !recoverablePlaylistErrorsWithV.find(i => e.message.includes(i))) throw e;
			}
			if (pl) {
				await pl.fetch(100 * lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit);
				const entries = [] as Array<import("play-dl").YouTubeVideo>;
				for (let i = 1; i < pl.total_pages + 1; i++) {
					if (i > lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit) continue;
					entries.push(...pl.page(i));
				}
				const foundInPl = extracted.type === "playlist_with_watch" ? entries.findIndex(v => v.id === extracted.v) : -1;
				return {
					entries: entries.map(YouTubeSource.songResultToTrack),
					plData: {
						name: pl.title!,
						selectedTrack: foundInPl === -1
							? extracted.type === "playlist_with_watch"
								? extracted.index
								: 0
							: foundInPl
					}
				};
			}
		}

		if (extracted.type === "playlist_with_watch" || extracted.type === "video") {
			let data: dl.InfoData;
			try {
				data = await dl.video_basic_info(extracted.v);
			} catch (e) {
				if (e.message.includes("reading 'find'")) throw new Error("Extraction failed at reading chapter data. aborting");
				else throw e;
			}

			return { entries: [YouTubeSource.songResultToTrack(data.video_details)], loadType: "TRACK_LOADED" as const };
		}

		return { entries: [] };
	}

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo, usingFFMPEG: boolean) {
		if (!usingFFMPEG) {
			const stream = await dl.stream(info.uri!);
			return { stream: stream.stream, type: stream.type };
		} else {
			const i = await dl.video_info(info.uri!);
			const selected = i.format[i.format.length - 1];
			const response = await this.utils.connect(selected.url!, { headers: this.utils.Constants.baseHTTPRequestHeaders });

			return { stream: response };
		}
	}

	private static songResultToTrack(i: import("play-dl").YouTubeVideo) {
		const length = Math.round(i.durationInSec * 1000);
		if (!i.id) {
			console.warn(`Video(?) didn't have ID attached to it:\n${util.inspect(i, false, 3, true)}`);
			throw new Error("One or more videos provided by YouTube didn't have an ID in its data");
		}
		return {
			identifier: i.id,
			title: i.title || "Unknown title",
			length,
			author: i.channel?.name || "Unknown author",
			uri: `https://youtube.com/watch?v=${i.id}`,
			isStream: length === 0
		};
	}

	private static async doSearch(resource: string) {
		const searchResults = await dl.search(resource, { limit: 10, source: { youtube: "video" } }) as Array<import("play-dl").YouTubeVideo>;
		const found = searchResults.find(v => v.id === resource);
		if (found) return { entries: [YouTubeSource.songResultToTrack(found)], loadType: "TRACK_LOADED" as const };
		return { entries: searchResults.map(YouTubeSource.songResultToTrack), loadType: "SEARCH_RESULT" as const };
	}

	private static extract<T extends keyof ExtractMap, R extends import("../types.js").UnpackRecord<{ [K in T]: ExtractMap[K] & { type: K } }>>(resource: string, searchShort?: string): R {
		if (searchShort === "yt") return { type: "search", search: resource, site: "yt" } as R;
		else if (searchShort === "ytm") return { type: "search", search: resource, site: "ytm" } as R;

		let url: URL | undefined = undefined;
		if (httpRegex.test(resource)) url = new URL(resource);
		let id: string | undefined = undefined;
		let plid: string | undefined = undefined;
		let search: string | undefined = undefined;
		let site: "yt" | "ytm" | undefined = undefined;

		if (url) {
			if (url.hostname === "youtu.be" && url.pathname !== "/") {
				id = url.pathname.slice(1);
				plid = url.searchParams.get("list") ?? undefined;
			} else if (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") {
				if (url.pathname === "/results" && url.searchParams.has("search_query")) {
					search = url.searchParams.get("search_query")!;
					site = "yt";
				} else if (cannotExtractRoutes.includes(url.pathname)) return { type: "cannot_extract" } as R;
				else if (url.pathname[1] === "@") {
					const sliced = url.pathname.slice(1);
					const nextSlash = sliced.indexOf("/");
					search = nextSlash === -1 ? sliced : sliced.slice(0, nextSlash);
					site = "yt";
				} else if (url.pathname.startsWith("/channel/")) {
					let channel = url.pathname.slice(9);
					const afterChannel = channel.indexOf("/");
					if (afterChannel !== -1) channel = channel.slice(0, afterChannel);

					if (channel[0] === "U" && channel[1] === "C" && channel[2] === "_") {
						search = channel.slice(3);
						site = "yt";
					} else {
						if (cannotExtractChannels.includes(channel)) return { type: "cannot_extract" } as R;
						search = channel;
						site = "yt";
					}

				} else if (url.pathname.startsWith("/shorts/")) id = url.pathname.slice(8);
				else {
					id = url.searchParams.get("v") ?? undefined;
					plid = url.searchParams.get("list") ?? undefined;
				}
			} else if (url.hostname === "music.youtube.com") {
				if (url.pathname === "/search" && url.searchParams.has("q")) {
					search = url.searchParams.get("q")!;
					site = "ytm";
				} else if (cannotExtractRoutesMusic.includes(url.pathname)) return { type: "cannot_extract" } as R;
				else {
					id = url.searchParams.get("v") ?? undefined;
					plid = url.searchParams.get("list") ?? undefined;
				}
			}

			if (id || plid || search) {
				if (search) return { type: "search", search, site: site || "yt" } as R;
				else if (id && plid) return { type: "playlist_with_watch", v: id, list: plid, index: Number(url.searchParams.get("index") ?? 0) } as R;
				else if (plid) return { type: "playlist", list: plid } as R;
				else return { type: "video", v: id } as R;
			}
		}

		const validated = dl.yt_validate(resource);
		if (validated === false) return { type: "cannot_extract" } as R;
		else if (validated === "search") return { type: "search", search: resource, site: "yt" } as R;
		else if (validated === "playlist") return { type: "playlist", list: resource } as R;
		else if (validated === "video") return { type: "video", v: resource } as R;
		else return { type: "cannot_extract" } as R;
	}
}

type ExtractMap = {
	video: { v: string; };
	playlist: { list: string; };
	playlist_with_watch: { v: string; list: string; index: number; };
	search: { search: string; site: "yt" | "ytm"; };
	cannot_extract: object;
}

export default YouTubeSource;
