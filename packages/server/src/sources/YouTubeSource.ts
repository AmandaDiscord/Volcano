import util from "util";

import * as dl from "play-dl";
import ytmapi from "ytmusic-api";
import { Plugin } from "volcano-sdk";

const ytm = new ytmapi.default();
const usableRegex = /^https?:\/\/(?:\w+)?\.?youtu\.?be(?:.com)?\/(?:watch\?v=)?[\w-]+/;
const normalizeRegex = /[^A-Za-z0-9:/.=&_\-?]/g;

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
		if (searchShort === "yt") {
			const normalized = decodeURIComponent(resource).replace(normalizeRegex, "");
			const validated = dl.yt_validate(normalized);
			if (validated) {
				try {
					const ID = dl.extractID(normalized);
					if (validated === "video") {
						const d = await dl.video_basic_info(ID);
						return { entries: [YouTubeSource.songResultToTrack(d.video_details)] };
					} else if (validated === "playlist") {
						const d = await dl.playlist_info(normalized, { incomplete: true });
						if (!d) throw new Error("NO_PLAYLIST");
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
			const tracks = await ytm.searchSongs(resource);
			return {
				entries: tracks.map(t => ({
					title: t.name,
					author: t.artists[0]?.name || "Unknown author",
					identifier: t.videoId,
					uri: `https://youtube.com/watch?v=${t.videoId}`,
					length: Math.round(t.duration * 1000),
					isStream: t.duration === 0
				}))
			};
		}

		let url: URL | undefined = undefined;
		if (resource.startsWith("http")) url = new URL(resource);
		if (url && url.searchParams.get("list") && url.searchParams.get("list")!.startsWith("FL_") || resource.startsWith("FL_")) throw new Error("Favorite list playlists cannot be fetched.");

		if (url && url.host === "youtu.be" && url.searchParams.has("list") && !url.pathname.startsWith("/watch")) {
			const v = url.pathname.slice(1);
			url.searchParams.set("v", v);
			resource = `https://www.youtube.com/watch?v=${v}&list=${url.searchParams.get("list")}${url.searchParams.has("index") ? `&index=${url.searchParams.get("index")}` : ""}`;
		}

		if ((url && url.searchParams.has("list") && !disallowedPLTypes.includes(url.searchParams.get("list")!)) || resource.startsWith("PL")) {
			const pl = await dl.playlist_info(resource, { incomplete: true });
			if (!pl) throw new Error("NO_PLAYLIST");
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

		if (url) {
			url.searchParams.delete("list");
			url.searchParams.delete("index");
			resource = url.toString();
		}

		const normalized = decodeURIComponent(resource).replace(normalizeRegex, "");
		const id = dl.extractID(normalized);
		const data = await dl.video_basic_info(id);

		return { entries: [YouTubeSource.songResultToTrack(data.video_details)] };
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
			throw new Error("YOUTUBE_VIDEO_HAS_NO_ID");
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
		if (found) return { entries: [YouTubeSource.songResultToTrack(found)] };
		return { entries: searchResults.map(YouTubeSource.songResultToTrack) };
	}
}

export default YouTubeSource;
