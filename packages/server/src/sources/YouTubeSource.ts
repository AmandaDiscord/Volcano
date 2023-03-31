import util from "util";

import * as dl from "play-dl";
import ytmapi from "ytmusic-api";
import { Plugin } from "volcano-sdk";

const ytm = new ytmapi.default();
const usableRegex = /^https?:\/\/(?:\w+)?\.?youtu\.?be(?:.com)?\/(?:(?:watch\?v=)|(?:results\?search_query=)|(?:search\?q=))?[\w-]+/;
const httpRegex = /^https?:\/\//;

const disallowedPLTypes = ["LL", "WL"];

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
		let url: URL | undefined = undefined;
		if (httpRegex.test(resource)) url = new URL(resource);

		if (url && ((url.pathname.startsWith("/results") && url.searchParams.has("search_query")) || (url.pathname.startsWith("/search") && url.searchParams.has("q")))) {
			searchShort = url.searchParams.has("search_query") ? "yt" : "ytm";
			resource = searchShort === "yt" ? url.searchParams.get("search_query")! : url.searchParams.get("q")!;
		}

		if (searchShort === "yt") {
			resource = decodeURIComponent(resource);
			const validated = dl.yt_validate(resource);
			if (validated) {
				try {
					const ID = dl.extractID(resource);
					if (validated === "video") {
						const d = await dl.video_basic_info(ID);
						return { entries: [YouTubeSource.songResultToTrack(d.video_details)], loadType: "TRACK_LOADED" as const };
					} else if (validated === "playlist") {
						const d = await dl.playlist_info(resource, { incomplete: true });
						if (!d) throw new Error("Input validated as a playlist but failed to extract as a playlist");
						await d.fetch();
						const entries = [] as Array<import("play-dl").YouTubeVideo>;
						for (let i = 1; i < d.total_pages + 1; i++) {
							entries.push(...d.page(i));
						}
						return {
							entries: entries.map(YouTubeSource.songResultToTrack),
							plData: {
								name: d.title as string,
								selectedTrack: 1
							}
						};
					} else return YouTubeSource.doSearch(resource);
				} catch {
					return YouTubeSource.doSearch(resource);
				}
			} else return YouTubeSource.doSearch(resource);
		} else if (searchShort === "ytm") {
			resource = decodeURIComponent(resource);
			const tracks = await ytm.searchSongs(resource);
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

		if (url && url.searchParams.get("list") && url.searchParams.get("list")!.startsWith("FL_") || resource.startsWith("FL_")) throw new Error("Favorite list playlists cannot be fetched.");

		if (url) {
			const result = await this.utils.followURLS(resource);
			result.data.end();
			result.data.destroy();
			resource = result.url;
			url = new URL(resource);
			const cont = url.searchParams.get("continue");
			if (cont) {
				resource = cont;
				url = new URL(cont);
			}
		}

		if ((url && url.searchParams.has("list") && !disallowedPLTypes.includes(url.searchParams.get("list")!)) || resource.startsWith("PL")) {
			let pl: dl.YouTubePlayList | undefined;
			try {
				pl = await dl.playlist_info(url ? url.searchParams.get("list")! : resource, { incomplete: true });
			} catch (e) {
				if (!url || !url.searchParams.has("v") || !e.message.includes("does not exist")) throw e;
			}
			if (pl) {
				await pl.fetch(100 * lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit);
				const entries = [] as Array<import("play-dl").YouTubeVideo>;
				for (let i = 1; i < pl.total_pages + 1; i++) {
					if (i > lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit) continue;
					entries.push(...pl.page(i));
				}
				const foundInPl = url?.searchParams.has("v") ? entries.findIndex(v => v.id === url!.searchParams.get("v")) : -1;
				return {
					entries: entries.map(YouTubeSource.songResultToTrack),
					plData: {
						name: pl.title!,
						selectedTrack: url?.searchParams.get("index")
							? Number(url.searchParams.get("index"))
							: foundInPl !== -1
								? foundInPl
								: 0
					}
				};
			}
		}

		if (url) {
			url.searchParams.delete("list");
			url.searchParams.delete("index");
			url.searchParams.delete("app");
			url.searchParams.delete("t");
			resource = url.toString();
		}

		const id = url && url.searchParams.has("v") ? url.searchParams.get("v")! : dl.extractID(decodeURIComponent(resource));
		let data: dl.InfoData;
		try {
			data = await dl.video_basic_info(id);
		} catch (e) {
			if (e.message.includes("reading 'find'")) throw new Error("Extraction failed at reading chapter data. aborting");
			else throw e;
		}

		return { entries: [YouTubeSource.songResultToTrack(data.video_details)], loadType: "TRACK_LOADED" as const };
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
}

export default YouTubeSource;
