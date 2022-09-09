import { Readable } from "stream";

import * as dl from "play-dl";

import Constants from "../Constants.js";
import type { Plugin } from "../types.js";

const usableRegex = /^https?:\/\/[^.]+?.?youtu\.?be/;

class YouTubeSource implements Plugin {
	public source = "youtube";
	public searchShort = "yt";

	public canBeUsed(resource: string, isSourceSearch: boolean) {
		if (isSourceSearch) return true;
		else return !!resource.match(usableRegex);
	}

	public async infoHandler(resource: string, isSourceSearch: boolean) {
		if (isSourceSearch) {
			const validated = dl.yt_validate(resource);
			if (validated) {
				try {
					const ID = dl.extractID(resource);
					if (validated === "video") {
						const d = await dl.video_basic_info(ID);
						return { entries: [YouTubeSource.songResultToTrack(d.video_details)] };
					} else {
						const d = await dl.playlist_info(resource, { incomplete: true });
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
					}
				} catch {
					return doSearch();
				}
			} else return doSearch();

			// eslint-disable-next-line no-inner-declarations
			async function doSearch() {
				const searchResults = await dl.search(resource, { limit: 10, source: { youtube: "video" } }) as Array<import("play-dl").YouTubeVideo>;
				const found = searchResults.find(v => v.id === resource);
				if (found) return { entries: [YouTubeSource.songResultToTrack(found)] };
				return { entries: searchResults.map(YouTubeSource.songResultToTrack) };
			}
		}

		let url: URL | undefined = undefined;
		if (resource.startsWith("http")) url = new URL(resource);
		if (url && url.searchParams.get("list") && url.searchParams.get("list")!.startsWith("FL_") || resource.startsWith("FL_")) throw new Error("Favorite list playlists cannot be fetched.");

		if (url && url.searchParams.has("list") || resource.startsWith("PL")) {
			const pl = await dl.playlist_info(resource, { incomplete: true });
			if (!pl) throw new Error("NO_PLAYLIST");
			await pl.fetch(100 * lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit);
			const entries = [] as Array<import("play-dl").YouTubeVideo>;
			for (let i = 1; i < pl.total_pages + 1; i++) {
				if (i > lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit) continue;
				entries.push(...pl.page(i));
			}
			return {
				entries: entries.map(YouTubeSource.songResultToTrack),
				plData: {
					name: pl.title as string,
					selectedTrack: url?.searchParams.get("index") ? Number(url.searchParams.get("index")) : 0
				}
			};
		}

		const data = await dl.video_basic_info(resource);

		return { entries: [YouTubeSource.songResultToTrack(data.video_details)] };
	}

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo, usingFFMPEG: boolean) {
		if (!usingFFMPEG) {
			const stream = await dl.stream(info.uri!);
			return { stream: stream.stream, type: stream.type };
		} else {
			const i = await dl.video_info(info.uri!);
			const selected = i.format[i.format.length - 1];
			const response = await fetch(selected.url!, { redirect: "follow", headers: Constants.baseHTTPRequestHeaders });
			const body = response.body;
			if (!body) throw new Error("INVALID_STREAM_RESPONSE");

			return { stream: Readable.fromWeb(body as import("stream/web").ReadableStream<any>) };
		}
	}

	private static songResultToTrack(i: import("play-dl").YouTubeVideo) {
		const length = Math.round(i.durationInSec * 1000);
		return {
			identifier: i.id!,
			title: i.title!,
			length,
			author: i.channel?.name || "Unknown author",
			uri: `https://youtube.com/watch?v=${i.id}`,
			isStream: length === 0
		};
	}
}

export default YouTubeSource;
