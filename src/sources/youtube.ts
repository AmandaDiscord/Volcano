import ytdl from "youtube-dl-exec";

const ytdlOptions = {
	quiet: true,
	dumpSingleJson: true,
	playlistItems: "1-100",
	flatPlaylist: true,
	skipDownload: true
};
// The options suggested by youtube-dl-exec causes ytdl to take quite a bit of time and provide a LOT of data we don't need for /loadtracks.
// These options were taken from NewLeaf: (https://git.sr.ht/~cadence/NewLeaf/tree/main/item/extractors/search.py)
// Thank you for everything you do, Cadence <3

async function getYoutubeAsSource(resource: string, isSearch: boolean): Promise<{ entries: Array<{ ie_key: "Youtube"; description: null; id: string; view_count: number; title: string; uploader: string; url: string; _type: "url"; duration: number }>; plData?: { name: string; selectedTrack: number } }> {
	if (isSearch) {
		const searchResults = await ytdl(`ytsearchall:${resource}`, ytdlOptions);
		// @ts-ignore
		return { entries: searchResults.entries };
	}

	let url: URL | undefined = undefined;
	if (resource.startsWith("http")) url = new URL(resource);
	if (url && url.searchParams.get("list") && url.searchParams.get("list")!.startsWith("FL_") || resource.startsWith("FL_")) throw new Error("Favorite list playlists cannot be fetched.");

	const data = await ytdl(resource, ytdlOptions);

	if (url && url.searchParams.has("list") || resource.startsWith("PL")) {
		// @ts-ignore
		return { entries: data.entries, plData: { name: data.title, selectedTrack: url?.searchParams.get("index") ? Number(url.searchParams.get("index")) : 1 } };
	}

	return { entries: [{ ie_key: "Youtube", description: null, id: data.id, view_count: data.view_count, title: data.title, uploader: data.uploader, url: data.id, _type: "url", duration: data.duration }] };
}

export = getYoutubeAsSource;
