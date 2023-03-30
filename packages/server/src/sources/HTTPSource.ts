import { IAudioMetadata, parseStream } from "music-metadata";
import { StreamType } from "@discordjs/voice";
import m3u8 from "m3u8stream";

import { Plugin } from "volcano-sdk";

const mimeRegex = /^(audio|video|application)\/(.+)$/;
const httpRegex = /^https?:\/\//;
const supportedApplicationTypes = ["ogg", "x-mpegURL"];
const unsupportedAudioTypes = ["midi"];
const pcmTypes = ["pcm", "wav"];

class HTTPSource extends Plugin {
	public source = "http";

	public canBeUsed(resource: string) {
		return httpRegex.test(resource);
	}

	public async infoHandler(resource: string) {
		let parsed: IAudioMetadata | undefined;
		let isCast = false;
		let isIcy = false;
		let probe: string;
		let chunked = false;

		const followed = await this.utils.followURLS(resource);
		resource = followed.url;
		const data = followed.data;

		const mimeMatch = data.headers["content-type"]?.match(mimeRegex);
		if (!mimeMatch || (mimeMatch[1] === "application" && !supportedApplicationTypes.includes(mimeMatch[2])) || (mimeMatch[1] === "audio" && unsupportedAudioTypes.includes(mimeMatch[2]))) {
			data.end();
			data.destroy();
			for (const plugin of lavalinkPlugins) {
				const result = await plugin.postHTTPProcessUnknown?.(resource, data.headers);
				if (result && result.entries.length) {
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

		chunked = !!data.headers["transfer-encoding"]?.includes("chunked") || isCast || (data.headers["content-type"] === "application/x-mpegURL");
		probe = mimeMatch ? mimeMatch[2] : "*";

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
		} else if (data.headers["content-type"] === "application/x-mpegURL") {
			data.end();
			data.destroy();
			parsed = { common: {}, format: {} } as IAudioMetadata;
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
				if (parsed.format.container) probe = parsed.format.container;
			} catch {
				parsed = { common: {}, format: {} } as IAudioMetadata;
			}
			data.end();
			data.destroy();
		}

		return {
			entries: [
				{
					title: parsed.common.title || "Unknown title",
					author: parsed.common.artist || "Unknown author",
					identifier: resource,
					uri: resource,
					length: Math.round((parsed.format.duration || 0) * 1000),
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

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo) {
		if (info.probeInfo!.raw === "x-mpegURL" || info.uri!.endsWith(".m3u8")) return { stream: m3u8(info.uri!), type: StreamType.Arbitrary };
		else {
			const response = await this.utils.connect(info.uri!, { headers: this.utils.Constants.baseHTTPRequestHeaders });
			let type: StreamType | undefined = undefined;
			if (info.probeInfo!.raw === "ogg") type = StreamType.OggOpus;
			else if (info.probeInfo!.raw === "opus") type = StreamType.Opus;
			else if (pcmTypes.includes(info.probeInfo!.raw)) type = StreamType.Raw;
			return { stream: response, type };
		}
	}
}

export default HTTPSource;
