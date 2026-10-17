import { IAudioMetadata, parseStream } from "music-metadata";
import { StreamType } from "@discordjs/voice";
import m3u8 from "m3u8stream";

import { Plugin } from "volcano-sdk";

const mimeRegex = /^(audio|video|application)\/(.+)$/;
const httpRegex = /^https?:\/\//;
const supportedApplicationTypes = new Set(["ogg"]);
const unsupportedAudioTypes = new Set(["midi"]);
const playlistTypes = new Set(["x-scpls", "scpls", "x-mpegurl", "mpegurl", "vnd.apple.mpegurl"]);
export const playlistExtRegex = /\.(?:pls|m3u8?)$/i;
const plsFileRegex = /^File(\d+)=((?:https?|icy):\/\/.+)$/m;
const playlistEntryRegex = /^(?:https?|icy):\/\//;
const probeNames: Array<[RegExp, string]> = [
	[/^(?:mpeg|mp3)$/i, "mp3"],
	[/^(?:adts\b|aacp?$)/i, "adts"],
	[/^(?:ebml\/|webm$|(?:x-)?matroska$|mk[av]$)/i, "matroska/webm"],
	[/^(?:ogg|oga|opus)$/i, "ogg"],
	[/^(?:wave?|x-wav|vnd\.wave)$/i, "wav"],
	[/^(?:x-)?flac$/i, "flac"],
	// music-metadata names MP4 by its brands, like M4A/isom/iso2
	[/^(?:x-)?(?:m4[ab]|mp4\d?|isom|iso\d|dash|avc1|3gp\d*)\b/i, "mp4"]
];

/** Lavaplayer's probe name so Lavalink can decode the track. Hints are music-metadata's container, then a mime subtype or file extension */
export function lavaplayerProbe(...hints: Array<string | undefined>) {
	for (const hint of hints) {
		const name = hint && probeNames.find(([regex]) => regex.test(hint))?.[1];
		if (name) return name;
	}
	return (hints.find(Boolean) ?? "unknown").toLowerCase();
}

class HTTPSource extends Plugin {
	public source = "http";

	public canBeUsed(resource: string) {
		return httpRegex.test(resource);
	}

	public async infoHandler(resource: string, _searchShort?: string, depth = 0) {
		let parsed: IAudioMetadata | undefined;
		let isCast = false;
		let isIcy = false;
		let probe: string;
		let chunked = false;

		const followed = await this.utils.followURLS(resource);
		resource = followed.url;
		const data = followed.data;

		const mimeMatch = mimeRegex.exec(data.headers["content-type"]?.toLowerCase() ?? "");
		if (playlistTypes.has(mimeMatch?.[2] ?? "") || playlistExtRegex.test(new URL(resource).pathname)) {
			const body = (await this.utils.responseBody(data)).toString();
			if (!body.includes("#EXT-X-")) return this.followPlaylist(body, depth);
			return { entries: [{ title: "Unknown title", author: "Unknown author", identifier: resource, uri: resource, length: 0, isStream: true, probeInfo: { raw: "m3u|hls-outer", name: "m3u", parameters: "hls-outer" } }] };
		}
		if (!mimeMatch || (mimeMatch[1] === "application" && !supportedApplicationTypes.has(mimeMatch[2])) || (mimeMatch[1] === "audio" && unsupportedAudioTypes.has(mimeMatch[2]))) {
			data.end();
			data.destroy();
			for (const plugin of lavalinkPlugins) {
				const result = await plugin.postHTTPProcessUnknown?.(resource, data.headers);
				if (result?.entries.length) {
					if (!result.source && plugin.source) result.source = plugin.source;
					return result;
				}
			}
			throw new Error(`Don't know how to interpret ${data.headers["content-type"]}. Expected a known audio/video format`);
		}

		if (data.protocol === "ICY") isIcy = isCast = true;
		if (!isIcy) {
			Object.keys(data.headers).forEach(key => {
				if (key.startsWith("icy-")) isIcy = isCast = true;
			});
		}

		chunked = !!data.headers["transfer-encoding"]?.includes("chunked") || isCast;
		probe = lavaplayerProbe(mimeMatch[2]);

		// Is stream chunked? (SKIPS A LOT OF CHECKS AND JUST RUNS WITH IT)
		// Will be more than just ice-cast in the future
		if (isCast) {
			data.end();
			data.destroy();
			parsed = { common: {}, format: {} } as IAudioMetadata;

			// Fill in ice cast data if applicable so track info doesn't always fallback to Unknown.
			if (isIcy) {
				if (data.headers["icy-description"]) parsed!.common.artist = data.headers["icy-description"] as string;
				if (data.headers["icy-name"]) parsed!.common.title = data.headers["icy-name"] as string;
			}
		} else {
			const promise = parseStream(data, {
				mimeType: data.headers["content-type"] || undefined,
				size: data.headers["content-length"] ? Number(data.headers["content-length"]) : undefined,
				url: resource
			}, {
				skipCovers: true,
				skipPostHeaders: true,
				includeChapters: false,
				duration: true
			});
			try {
				parsed = await this.utils.createTimeoutForPromise(promise, 5000);
				probe = lavaplayerProbe(parsed.format.container, mimeMatch[2]);
			} catch {
				parsed = { common: {}, format: {} } as IAudioMetadata;
			}
			data.end();
			data.destroy();
		}

		return {
			entries: [
				{
					title: parsed.common.title ?? "Unknown title",
					author: parsed.common.artist ?? "Unknown author",
					identifier: resource,
					uri: resource,
					length: Math.round((parsed.format.duration ?? 0) * 1000),
					isStream: chunked,
					probeInfo: {
						raw: probe,
						name: probe,
						parameters: null
					}
				}
			]
		};
	}

	public async followPlaylist(body: string, depth: number): Promise<import("volcano-sdk/types.js").TrackData> {
		if (depth >= 5) throw new Error("Too many nested playlist files");
		let url: string | undefined = undefined;
		let title: string | undefined = undefined;
		const pls = plsFileRegex.exec(body);
		if (pls) {
			url = pls[2].trim();
			title = new RegExp(`^Title${pls[1]}=(.+)$`, "m").exec(body)?.[1].trim();
		} else {
			for (const line of body.split(/\r?\n/)) {
				if (line.startsWith("#EXTINF")) title = line.slice(line.indexOf(",") + 1).trim() || undefined;
				else if (playlistEntryRegex.test(line)) {
					url = line.trim();
					break;
				} else if (line && !line.startsWith("#")) title = undefined;
			}
		}
		if (!url) throw new Error("The playlist file contains no links.");
		const result = await this.infoHandler(url.replace(/^icy:/, "http:"), undefined, depth + 1);
		// The stream's own metadata wins
		if (title && result.entries[0]?.title === "Unknown title") result.entries[0].title = title;
		return result;
	}

	public async streamHandler(info: import("volcano-encoding").TrackInfo) {
		// x-mpegURL is how Volcano encoded HLS before
		if (info.probeInfo?.name === "m3u" || info.probeInfo?.raw === "x-mpegURL" || info.uri!.endsWith(".m3u8")) return { stream: m3u8(info.uri!), type: StreamType.Arbitrary };
		const { data: response } = await this.utils.followURLS(info.uri!);
		// FFmpeg sniffs everything else, WAV headers included. Only headerless PCM needs telling
		return { stream: response, type: info.probeInfo?.raw === "pcm" ? StreamType.Raw : undefined };
	}
}

export default HTTPSource;
