import ytdl from "ytdl-core";
import ytsr from "ytsr";
import ytpl from "ytpl";

async function getYoutubeAsSource(resource: string, isSearch: boolean): Promise<{ entries: Array<{ id: string; title: string; duration: number; uploader: string }>; plData?: { name: string; selectedTrack: number } }> {
	if (isSearch) {
		if (ytdl.validateID(resource)) {
			const d = await ytdl.getBasicInfo(resource);
			return { entries: [{ id: d.videoDetails.videoId, title: d.videoDetails.title, duration: Number(d.videoDetails.lengthSeconds || 0), uploader: d.videoDetails.author.name }] };
		}

		const searchResults = await ytsr(resource);
		// ytdl doesn't export its Video interface and typescript being funky
		return { entries: (searchResults.items.filter(i => i.type === "video") as Array<any>).map(i => ({ id: i.id, title: i.title, duration: Number(i.duration || 0), uploader: i.author.name })) };
	}

	let url: URL | undefined = undefined;
	if (resource.startsWith("http")) url = new URL(resource);
	if (url && url.searchParams.get("list") && url.searchParams.get("list")!.startsWith("FL_") || resource.startsWith("FL_")) throw new Error("Favorite list playlists cannot be fetched.");

	if (url && url.searchParams.has("list") || resource.startsWith("PL")) {
		const pl = await ytpl(resource, { limit: Infinity });
		return { entries: pl.items.map(i => ({ id: i.id, title: i.title, duration: Number(i.duration || 0), uploader: i.author.name })), plData: { name: pl.title, selectedTrack: url?.searchParams.get("index") ? Number(url.searchParams.get("index")) : 1 } };
	}

	const data = await ytdl.getBasicInfo(resource);

	return { entries: [{ id: data.videoDetails.videoId, title: data.videoDetails.title, duration: Number(data.videoDetails.lengthSeconds || 0), uploader: data.videoDetails.author.name }] };
}

export = getYoutubeAsSource;
