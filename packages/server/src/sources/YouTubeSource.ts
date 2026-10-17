import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { Worker } from "node:worker_threads";

import m3u8 from "m3u8stream";
import ytmapi from "ytmusic-api";
import { Plugin } from "volcano-sdk";

import type { TrackInfo } from "volcano-sdk/types.js";

type Json = Record<string, any>;
type PlayerResult = { data: Json; ua: string; playerURL?: string };
type SolverResult = { sts?: number; n?: string; sig?: string };

const ytm = new ytmapi();
const usableRegex = /^https:\/\/(?:(?:www\.)|(?:music\.)|(?:m\.))?youtu\.?be(?:\.com)?\//;
const httpRegex = /^https:\/\//;
const videoIDRegex = /^[\w-]{11}$/;
const playlistIDRegex = /^(?:PL|UU|LL|FL|OL|RD)[\w-]{10,}$/;
const timeRegex = /^\d+(?::\d+)*$/;

const disallowedPLTypes = new Set(["LL", "WL"]);
const cannotExtractChannels = new Set([
	"UCrpQ4p1Ql_hG8rKXIKM1MOQ", // beauty
	"UCtFRv9O2AHqOZjjynzrv-xg", // learning
	"UCEgdi0XIXXZ-qJOFPf4JSKw", // sports
	"UCYfdidRxbB8Qhf0Nx7ioOYw", // news
	"UC4R8DWoMoI7CAwX8_LjQHig", // live
	"UC-9-kyTW8ZkZNDHQJ6FgpwQ", // music
	"UCkYQyvc_i9hXEo4xic9Hh2g" // shopping
]);
const cannotExtractRoutes = new Set([
	"/podcasts",
	"/@learning",
	"/sports",
	"/@news",
	"/gaming",
	"/@gaming",
	"/@live",
	"/feed/trending",
	"/feed/storefront"
]);
const cannotExtractRoutesMusic = new Set([
	"/explore",
	"/library"
]);

const webUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const web = { clientName: "WEB", clientVersion: "2.20260708.00.00", hl: "en", gl: "US" };
const visionOS = {
	clientName: "VISIONOS",
	clientVersion: "1.02",
	deviceMake: "Apple",
	deviceModel: "RealityDevice17,1",
	osName: "visionOS",
	osVersion: "26.5.23O471",
	userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
	hl: "en",
	gl: "US"
};
const embedURL = "https://www.reddit.com/";
const chunkSize = 10 << 20;
const solverIdleMS = 5 * 60 * 1000;

let visitorData = "";
let solver: ReturnType<typeof createSolver> | null = null;

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
						author: t.artist.name ?? "Unknown author",
						identifier: t.videoId,
						uri: `https://youtube.com/watch?v=${t.videoId}`,
						length: Math.round((t.duration ?? 0) * 1000),
						isStream: t.duration === 0,
						artworkUrl: t.thumbnails.at(-1)?.url ?? artwork(t.videoId)
					}))
				};
			}
		} else if (extracted.type === "playlist_with_watch" || extracted.type === "playlist") {
			if (extracted.list.startsWith("FL_")) throw new Error("Favorite list playlists cannot be fetched.");
			if (disallowedPLTypes.has(extracted.list)) throw new Error("That playlist is private and cannot be fetched.");
			try {
				const pl = await YouTubeSource.getPlaylist(extracted.list);
				const foundInPl = extracted.type === "playlist_with_watch" ? pl.entries.findIndex(v => v.identifier === extracted.v) : -1;
				return {
					entries: pl.entries,
					plData: {
						name: pl.name,
						selectedTrack: foundInPl === -1
							? extracted.type === "playlist_with_watch"
								? extracted.index
								: 0
							: foundInPl
					}
				};
			} catch (e) {
				// Mixes and unlisted lists can't be browsed, but the video they were linked from still plays
				if (extracted.type !== "playlist_with_watch") throw e;
			}
		}

		if (extracted.type === "playlist_with_watch" || extracted.type === "video") {
			const { data } = await getPlayer(extracted.v);
			return { entries: [detailsToTrack(data.videoDetails)] };
		}

		return { entries: [] };
	}

	public async streamHandler(info: import("volcano-encoding").TrackInfo) {
		const { data, ua, playerURL } = await getPlayer(info.identifier);
		const streaming = data.streamingData;

		if (data.videoDetails?.isLive && streaming?.hlsManifestUrl) {
			let manifestURL = streaming.hlsManifestUrl as string;
			const n = playerURL && /\/n\/([^/]+)/.exec(manifestURL)?.[1];
			if (n) manifestURL = manifestURL.replace(`/n/${n}`, `/n/${(await solve(playerURL, n)).n}`);
			const manifest = await fetch(manifestURL, { headers: { "User-Agent": ua } }).then(r => r.text());
			const audioOnly = Array.from(manifest.matchAll(/#EXT-X-MEDIA:.*URI="([^"]+)"/g), m => m[1]);
			const playlist = audioOnly.at(-1) ?? /^https:.+$/m.exec(manifest)?.[0];
			if (!playlist) throw new Error("YouTube didn't return any playable live stream");
			return { stream: m3u8(playlist) };
		}

		const formats = ((streaming?.adaptiveFormats ?? []) as Array<Json>).filter(isDownloadableAudio).sort((a, b) => b.bitrate - a.bitrate);
		const format = formats.find(f => f.mimeType.includes("opus")) ?? formats[0];
		if (!format) throw new Error("YouTube didn't return any audio formats for this video");

		const url = playerURL ? await decipher(format, playerURL) : format.url as string;
		return {
			stream: Readable.from(download(url, Number(format.contentLength), ua), { objectMode: false }),
			type: format.mimeType.includes("opus") ? "webm/opus" : undefined
		};
	}

	private static async getPlaylist(list: string) {
		let data = await innertube("browse", { context: { client: web }, browseId: `VL${list}` });
		const name = data.metadata?.playlistMetadataRenderer?.title as string | undefined;
		if (!name) throw new Error(data.alerts?.[0]?.alertRenderer?.text?.runs?.[0]?.text ?? "That playlist does not exist or is private.");

		const entries = collectTracks(data);
		let token = findContinuation(data);
		for (let page = 1; token && page < lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit; page++) {
			data = await innertube("browse", { context: { client: web }, continuation: token });
			collectTracks(data, entries);
			token = findContinuation(data);
		}

		return { name, entries };
	}

	private static async doSearch(query: string) {
		const data = await innertube("search", { context: { client: web }, query, params: "EgIQAQ%3D%3D" });
		const entries = collectTracks(data).slice(0, 10);
		const found = entries.find(v => v.identifier === query);
		return { entries: found ? [found] : entries };
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
			const paths = url.pathname.slice(1).split("/");
			if (url.hostname === "youtu.be" && url.pathname !== "/") {
				id = url.pathname.slice(1);
				plid = url.searchParams.get("list") ?? undefined;
			} else if (url.hostname === "www.youtube.com" || url.hostname === "youtube.com" || url.hostname === "m.youtube.com") {
				if (paths[0] === "results" && url.searchParams.has("search_query")) {
					search = url.searchParams.get("search_query")!;
					site = "yt";
				} else if (cannotExtractRoutes.has(url.pathname)) return { type: "cannot_extract" } as R;
				else if (url.pathname[1] === "@") {
					search = paths[0];
					site = "yt";
				} else if (paths[0] === "channel" && paths[1]) {
					const channel = paths[1];
					if (channel[0] === "U" && channel[1] === "C" && channel[2] === "_") {
						search = channel.slice(3);
						site = "yt";
					} else {
						if (cannotExtractChannels.has(channel)) return { type: "cannot_extract" } as R;
						search = channel;
						site = "yt";
					}
				} else if (["shorts", "live", "embed", "v"].includes(paths[0]) && paths[1]) id = paths[1];
				else {
					id = url.searchParams.get("v") ?? undefined;
					plid = url.searchParams.get("list") ?? undefined;
				}
			} else if (url.hostname === "music.youtube.com") {
				if (url.pathname === "/search" && url.searchParams.has("q")) {
					search = url.searchParams.get("q")!;
					site = "ytm";
				} else if (cannotExtractRoutesMusic.has(url.pathname)) return { type: "cannot_extract" } as R;
				else {
					id = url.searchParams.get("v") ?? undefined;
					plid = url.searchParams.get("list") ?? undefined;
				}
			}

			if (search) return { type: "search", search, site: site ?? "yt" } as R;
			else if (id && plid) return { type: "playlist_with_watch", v: id, list: plid, index: Number(url.searchParams.get("index") ?? 0) } as R;
			else if (plid) return { type: "playlist", list: plid } as R;
			else if (id) return { type: "video", v: id } as R;
			return { type: "cannot_extract" } as R;
		}

		if (videoIDRegex.test(resource)) return { type: "video", v: resource } as R;
		else if (playlistIDRegex.test(resource)) return { type: "playlist", list: resource } as R;
		else return { type: "search", search: resource, site: "yt" } as R;
	}
}

async function innertube(endpoint: string, body: Json, headers: Record<string, string> = {}): Promise<Json> {
	const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "https://www.youtube.com",
			"User-Agent": webUA,
			"X-YouTube-Client-Name": "1",
			"X-YouTube-Client-Version": web.clientVersion,
			...headers
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(lavalinkConfig.volcano.youtubeTimeout)
	});
	if (!res.ok) throw new Error(`YouTube responded with ${res.status} to ${endpoint}`);
	return res.json();
}

async function getPlayer(videoID: string): Promise<PlayerResult> {
	let reason = "";
	// The embedded client randomly gets SABR-only formats (no URLs) on a few % of requests, so it gets a second roll
	for (const client of [visionOSPlayer, embeddedPlayer, embeddedPlayer]) {
		const result = await client(videoID).catch((e: Error) => e);
		if (result instanceof Error) {
			reason ||= result.message;
			continue;
		}
		const status = result.data.playabilityStatus;
		if (status?.status === "OK" && (result.data.videoDetails?.isLive || result.data.streamingData?.adaptiveFormats?.some(isDownloadableAudio))) return result;
		// Removed or nonexistent videos. Another client won't change that
		if (status?.status === "ERROR") throw new Error(status.reason ?? "This video is unavailable");
		reason ||= status?.status === "OK" ? "YouTube only offered SABR streams for this video" : status?.reason ?? status?.status ?? "";
	}
	throw new Error(reason || "YouTube didn't return a playable response");
}

function isDownloadableAudio(format: Json) {
	return format.mimeType?.startsWith("audio/") && !!(format.url || format.signatureCipher);
}

async function visionOSPlayer(videoID: string): Promise<PlayerResult> {
	if (!visitorData) {
		const html = await fetch("https://www.youtube.com/", {
			headers: { "User-Agent": webUA },
			signal: AbortSignal.timeout(lavalinkConfig.volcano.youtubeTimeout)
		}).then(r => r.text());
		visitorData = /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ?? "";
	}
	const data = await innertube(
		"player",
		{ context: { client: { ...visionOS, visitorData } }, videoId: videoID, contentCheckOk: true, racyCheckOk: true },
		{ "User-Agent": visionOS.userAgent, "X-YouTube-Client-Name": "101", "X-YouTube-Client-Version": visionOS.clientVersion, "X-Goog-Visitor-Id": visitorData }
	);
	// Without visitor data (or with a flagged one), YouTube answers "Sign in to confirm you're not a bot"
	if (data.playabilityStatus?.status === "LOGIN_REQUIRED") visitorData = "";
	return { data, ua: visionOS.userAgent };
}

async function embeddedPlayer(videoID: string): Promise<PlayerResult> {
	const page = await fetch(`https://www.youtube.com/embed/${videoID}?html5=1`, {
		headers: {
			"User-Agent": webUA,
			Referer: embedURL
		},
		signal: AbortSignal.timeout(lavalinkConfig.volcano.youtubeTimeout)
	});
	const html = await page.text();
	const config: Json = Object.assign({}, ...Array.from(html.matchAll(/ytcfg\.set\s*\(\s*(\{.+?\})\s*\)\s*;/g), m => {
		try {
			return JSON.parse(m[1]);
		} catch {
			return {};
		}
	}));
	const context = config.INNERTUBE_CONTEXT;
	const embed = config.WEB_PLAYER_CONTEXT_CONFIGS?.WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER;
	const playerID = /\/s\/player\/(\w+)\//.exec(embed?.jsUrl ?? "")?.[1];
	if (!context || !playerID) throw new Error("Couldn't read YouTube's embedded player config");

	const playerURL = `https://www.youtube.com/s/player/${playerID}/player_ias.vflset/en_US/base.js`;
	const { sts } = await solve(playerURL);
	const data = await innertube(
		"player",
		{
			context: { ...context, thirdParty: { ...context.thirdParty, embedUrl: embedURL } },
			videoId: videoID,
			playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", signatureTimestamp: sts, encryptedHostFlags: embed.encryptedHostFlags } },
			contentCheckOk: true,
			racyCheckOk: true
		},
		{
			"X-YouTube-Client-Name": "56",
			"X-YouTube-Client-Version": context.client.clientVersion,
			"X-Goog-Visitor-Id": context.client.visitorData,
			Cookie: page.headers.getSetCookie().map(c => c.split(";")[0]).join("; ")
		}
	);
	return { data, ua: webUA, playerURL };
}

async function decipher(format: Json, playerURL: string) {
	const cipher = format.signatureCipher ? new URLSearchParams(format.signatureCipher) : null;
	const url = new URL(cipher?.get("url") ?? format.url);
	const solved = await solve(playerURL, url.searchParams.get("n") ?? undefined, cipher?.get("s") ?? undefined);
	if (solved.n) url.searchParams.set("n", solved.n);
	if (solved.sig) url.searchParams.set(cipher?.get("sp") ?? "signature", solved.sig);
	return url.toString();
}

async function* download(url: string, size: number, ua: string) {
	let position = 0;
	let failures = 0;
	while (!size || position < size) {
		const start = position;
		try {
			const res = await fetch(`${url}&range=${position}-${position + chunkSize - 1}`, { headers: { "User-Agent": ua } });
			if (!res.ok || !res.body) throw new Error(`YouTube responded with ${res.status} while streaming`);
			for await (const chunk of res.body) {
				position += chunk.byteLength;
				yield Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
			}
			failures = 0;
			if (position - start < chunkSize) return;
		} catch (e) {
			// Web clients' URLs 403 until the pre-roll ad would have finished, so the first chunk often needs a few seconds
			if (++failures > 4) throw e;
			await sleep(failures * 1000);
		}
	}
}

function createSolver() {
	const worker = new Worker(new URL("../ejs/solver.cjs", import.meta.url));
	const calls = new Map<number, { resolve: (value: SolverResult) => void; reject: (e: Error) => void }>();
	let nextID = 0;
	let idle: NodeJS.Timeout | undefined = undefined;

	const fail = (e: Error) => {
		for (const call of calls.values()) call.reject(e);
		calls.clear();
	};
	const instance = {
		solve(playerURL: string, n?: string, sig?: string) {
			clearTimeout(idle);
			worker.ref();
			return new Promise<SolverResult>((resolve, reject) => {
				const id = nextID++;
				calls.set(id, { resolve, reject });
				worker.postMessage({ id, playerURL, n, sig });
			});
		}
	};

	worker.on("message", ({ id, error, ...result }: SolverResult & { id: number; error?: string }) => {
		const call = calls.get(id);
		calls.delete(id);
		if (error) call?.reject(new Error(error));
		else call?.resolve(result);
		// The solver holds ~200MB once it has parsed a player, so it only lives while it's being used
		if (!calls.size) {
			worker.unref();
			idle = setTimeout(() => {
				if (solver === instance) solver = null;
				void worker.terminate();
			}, solverIdleMS).unref();
		}
	});
	worker.on("error", fail);
	worker.on("exit", () => {
		if (solver === instance) solver = null;
		fail(new Error("YouTube's challenge solver exited"));
	});

	return instance;
}

function solve(playerURL: string, n?: string, sig?: string) {
	solver ??= createSolver();
	return solver.solve(playerURL, n, sig);
}

// Lavalink's YouTube source only uses the player's thumbnail when it's the max res one
const artwork = (id: string, thumbnail?: string) => thumbnail?.includes("maxresdefault") ? thumbnail : `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

function detailsToTrack(details: Json): TrackInfo {
	const length = Number(details.lengthSeconds ?? 0) * 1000;
	return {
		identifier: details.videoId,
		title: details.title ?? "Unknown title",
		author: details.author ?? "Unknown author",
		uri: `https://youtube.com/watch?v=${details.videoId}`,
		length,
		isStream: !!details.isLive || length === 0,
		artworkUrl: artwork(details.videoId, details.thumbnail?.thumbnails?.at(-1)?.url)
	};
}

function toTrack(identifier: string, title: string | undefined, author: string | undefined, time: string | undefined): TrackInfo {
	const length = time && timeRegex.test(time) ? time.split(":").reduce((total, part) => (total * 60) + Number(part), 0) * 1000 : 0;
	return {
		identifier,
		title: title ?? "Unknown title",
		author: author ?? "Unknown author",
		uri: `https://youtube.com/watch?v=${identifier}`,
		length,
		isStream: length === 0,
		artworkUrl: artwork(identifier)
	};
}

// YouTube is mid-migration from *Renderer to lockupViewModel and serves either depending on the endpoint
function collectTracks(node: unknown, out: Array<TrackInfo> = []): Array<TrackInfo> {
	if (!node || typeof node !== "object") return out;
	const item = node as Json;

	const video = item.videoRenderer ?? item.playlistVideoRenderer;
	if (video?.videoId) {
		out.push(toTrack(
			video.videoId,
			video.title?.runs?.[0]?.text ?? video.title?.simpleText,
			(video.ownerText ?? video.shortBylineText)?.runs?.[0]?.text,
			video.lengthText?.simpleText ?? (video.lengthSeconds ? String(video.lengthSeconds) : undefined)
		));
		return out;
	}

	const lockup = item.lockupViewModel;
	if (lockup?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
		const metadata = lockup.metadata?.lockupMetadataViewModel;
		const overlays = (lockup.contentImage?.thumbnailViewModel?.overlays ?? []) as Array<Json>;
		const badge = overlays.flatMap(o => o.thumbnailBottomOverlayViewModel?.badges ?? []).find(b => b.thumbnailBadgeViewModel)?.thumbnailBadgeViewModel.text;
		out.push(toTrack(lockup.contentId, metadata?.title?.content, metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content, badge));
		return out;
	}

	for (const child of Object.values(item)) {
		collectTracks(child, out);
	}
	return out;
}

function findContinuation(node: unknown): string | undefined {
	if (!node || typeof node !== "object") return undefined;
	const token = (node as Json).continuationCommand?.token;
	if (typeof token === "string") return token;
	for (const child of Object.values(node)) {
		const found = findContinuation(child);
		if (found) return found;
	}
	return undefined;
}

type ExtractMap = {
	video: { v: string; };
	playlist: { list: string; };
	playlist_with_watch: { v: string; list: string; index: number; };
	search: { search: string; site: "yt" | "ytm"; };
	cannot_extract: object;
}

export default YouTubeSource;
