import * as yt from "play-dl";

async function getYoutubeAsSource(resource: string, isSearch: boolean): Promise<{ entries: Array<{ id: string; title: string; duration: number; uploader: string }>; plData?: { name: string; selectedTrack: number } }> {
	if (isSearch) {
		const validated = yt.yt_validate(resource);
		if (validated) {
			try {
				const ID = yt.extractID(resource);
				if (validated === "video") {
					const d = await yt.video_basic_info(ID);
					return { entries: [{ id: d.video_details.id as string, title: d.video_details.title as string, duration: Number(d.video_details.durationInSec as number || 0), uploader: d.video_details.channel?.name || "Unknown author" }] };
				} else {
					const d = await yt.playlist_info(resource);
					if (!d) throw new Error("NO_PLAYLIST");
					await d.fetch();
					const entries = [] as Array<import("play-dl/dist/YouTube/classes/Video").YouTubeVideo>;
					for (let i = 1; i < d.total_pages + 1; i++) {
						entries.push(...d.page(i));
					}
					return { entries: entries.map(i => ({ id: i.id as string, title: i.title as string, duration: i.durationInSec, uploader: i.channel?.name || "Unknown author" })), plData: { name: d.title as string, selectedTrack: 1 } };
				}
			} catch {
				return doSearch();
			}
		} else return doSearch();

		// eslint-disable-next-line no-inner-declarations
		async function doSearch() {
			const searchResults = await yt.search(resource, { limit: 10, source: { youtube: "video" } }) as Array<import("play-dl/dist/YouTube/classes/Video").YouTubeVideo>;
			const found = searchResults.find(v => v.id === resource);
			if (found) return { entries: [{ id: found.id as string, title: found.title as string, duration: found.durationInSec, uploader: found.channel?.name || "Unknown author" }] };
			return { entries: searchResults.map(i => ({ id: i.id as string, title: i.title as string, duration: i.durationInSec, uploader: i.channel?.name || "Unknown author" })) };
		}
	}

	let url: URL | undefined = undefined;
	if (resource.startsWith("http")) url = new URL(resource);
	if (url && url.searchParams.get("list") && url.searchParams.get("list")!.startsWith("FL_") || resource.startsWith("FL_")) throw new Error("Favorite list playlists cannot be fetched.");

	if (url && url.searchParams.has("list") || resource.startsWith("PL")) {
		const pl = await yt.playlist_info(resource);
		if (!pl) throw new Error("NO_PLAYLIST");
		await pl.fetch();
		const entries = [] as Array<import("play-dl/dist/YouTube/classes/Video").YouTubeVideo>;
		for (let i = 1; i < pl.total_pages + 1; i++) {
			entries.push(...pl.page(i));
		}
		return { entries: entries.map(i => ({ id: i.id as string, title: i.title as string, duration: i.durationInSec, uploader: i.channel?.name || "Unknown author" })), plData: { name: pl.title as string, selectedTrack: url?.searchParams.get("index") ? Number(url.searchParams.get("index")) : 1 } };
	}

	const data = await yt.video_basic_info(resource);

	return { entries: [{ id: data.video_details.id as string, title: data.video_details.title as string, duration: Number(data.video_details.durationInSec as number || 0), uploader: data.video_details.channel?.name || "Unknown author" }] };
}

export = getYoutubeAsSource;
