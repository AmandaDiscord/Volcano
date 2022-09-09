import { Readable } from "stream";

import { IAudioMetadata, parseStream } from "music-metadata";
import m3u8 from "m3u8stream";

import Constants from "../Constants.js";
import type { Plugin } from "../types.js";

const mimeRegex = /^(audio|video|application)\/(.+)$/;
const httpRegex = /^https?:\/\//;

class HTTPSource implements Plugin {
	public source = "http";

	public canBeUsed(resource: string) {
		if (resource.match(httpRegex)) return true;
		else return false;
	}

	public async infoHandler(resource: string) {
		let parsed: IAudioMetadata | undefined;
		let headers: Headers | undefined = undefined;
		let isCast = false;
		let isIcy = false;
		let probe = "*";
		let chunked = false;

		try {
			const stream = await fetch(resource, { redirect: "follow", headers: Constants.baseHTTPRequestHeaders });
			headers = stream.headers;
			const body = stream.body;

			const mimeMatch = stream.headers.get("content-type")?.match(mimeRegex);
			if (mimeMatch && mimeMatch[1] === "application" && !["ogg", "x-mpegURL"].includes(mimeMatch[2])) {
				await body?.cancel();
				throw new Error("UNSUPPORTED_FILE_TYPE");
			}

			stream.headers.forEach((_, key) => {
				if (key?.startsWith("icy-")) isIcy = isCast = true;
			});

			chunked = !!headers.get("transfer-encoding")?.includes("chunked") || isCast || (stream.headers.get("content-type") === "application/x-mpegURL");
			probe = mimeMatch ? mimeMatch[2] : "*";

			// Is stream chunked? (SKIPS A LOT OF CHECKS AND JUST RUNS WITH IT)
			// Will be more than just ice-cast in the future
			if (isCast) {
				await body?.cancel();
				parsed = { common: {}, format: {} } as IAudioMetadata;

				// Fill in ice cast data if applicable so track info doesn't always fallback to Unknown.
				if (isIcy) {
					if (stream.headers.get("icy-description")) parsed!.common.artist = stream.headers.get("icy-description") as string;
					if (stream.headers.get("icy-name")) parsed!.common.title = stream.headers.get("icy-name") as string;
				}
			} else if (stream.headers.get("content-type") === "application/x-mpegURL") {
				await body?.cancel();
				parsed = { common: {}, format: {} } as IAudioMetadata;
			} else {
				if (!body) throw new Error("NO_BODY");
				const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout reached")), 10000));
				const nodeReadable = Readable.fromWeb(body as import("stream/web").ReadableStream<any>);
				parsed = await Promise.race<[Promise<unknown>, Promise<IAudioMetadata>]>([
					timer,
					parseStream(nodeReadable, { mimeType: stream.headers.get("content-type") || undefined, size: stream.headers.get("content-length") ? Number(stream.headers.get("content-length")) : undefined, url: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true })
				]) as IAudioMetadata;
				if (parsed.format.container) probe = parsed.format.container;
			}
		} catch {
			parsed = { common: {}, format: {} } as IAudioMetadata;
		}

		return {
			entries: [
				{
					title: parsed.common.title || "Unknown title",
					author: parsed.common.artist || "Unknown artist",
					identifier: resource,
					uri: resource,
					length: Math.round((parsed.format.duration || 0) * 1000),
					isStream: chunked
				}
			],
			probeInfo: {
				raw: probe,
				name: probe,
				parameters: null
			}
		};
	}

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo) {
		if (info.probeInfo!.raw === "x-mpegURL" || info.uri!.endsWith(".m3u8")) return { stream: m3u8(info.uri!) };
		else {
			const response = await fetch(info.uri!, { redirect: "follow", headers: Constants.baseHTTPRequestHeaders });
			const body = response.body;
			if (!body) throw new Error("INVALID_STREAM_RESPONSE");

			return { stream: Readable.fromWeb(body as import("stream/web").ReadableStream<any>) };
		}
	}
}

export default HTTPSource;
