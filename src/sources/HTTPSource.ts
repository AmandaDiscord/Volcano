import { Readable } from "stream";

import { IAudioMetadata, parseStream } from "music-metadata";
import m3u8 from "m3u8stream";

import Constants from "../Constants.js";
import type { Plugin } from "../types.js";

const mimeRegex = /^(audio|video|application)\/(.+)$/;
const httpRegex = /^https?:\/\//;
const supportedApplicationTypes = [Constants.STRINGS.OGG, Constants.STRINGS.X_MPEG_URL];

class HTTPSource implements Plugin {
	public source = Constants.STRINGS.HTTP;

	public canBeUsed(resource: string) {
		if (resource.match(httpRegex)) return true;
		else return false;
	}

	public async infoHandler(resource: string) {
		let parsed: IAudioMetadata | undefined;
		let headers: Headers | undefined = undefined;
		let isCast = false;
		let isIcy = false;
		let probe = Constants.STRINGS.STAR;
		let chunked = false;

		try {
			const stream = await fetch(resource, { redirect: Constants.STRINGS.FOLLOW, headers: Constants.baseHTTPRequestHeaders });
			headers = stream.headers;
			const body = stream.body;

			const mimeMatch = stream.headers.get(Constants.STRINGS.CONTENT_TYPE)?.match(mimeRegex);
			if (mimeMatch && mimeMatch[1] === Constants.STRINGS.APPLICATION && !supportedApplicationTypes.includes(mimeMatch[2])) {
				await body?.cancel();
				throw new Error(Constants.STRINGS.UNSUPPORTED_FILE_TYPE);
			}

			stream.headers.forEach((_, key) => {
				if (key?.startsWith(Constants.STRINGS.ICY_HEADER_DASH)) isIcy = isCast = true;
			});

			chunked = !!headers.get(Constants.STRINGS.TRANSFER_ENCODING)?.includes(Constants.STRINGS.CHUNKED) || isCast || (stream.headers.get(Constants.STRINGS.CONTENT_TYPE) === Constants.STRINGS.APPLICATION_X_MPEG_URL);
			probe = mimeMatch ? mimeMatch[2] : "*";

			// Is stream chunked? (SKIPS A LOT OF CHECKS AND JUST RUNS WITH IT)
			// Will be more than just ice-cast in the future
			if (isCast) {
				await body?.cancel();
				parsed = { common: {}, format: {} } as IAudioMetadata;

				// Fill in ice cast data if applicable so track info doesn't always fallback to Unknown.
				if (isIcy) {
					if (stream.headers.get(Constants.STRINGS.ICY_DESCRIPTION)) parsed!.common.artist = stream.headers.get(Constants.STRINGS.ICY_DESCRIPTION) as string;
					if (stream.headers.get(Constants.STRINGS.ICY_NAME)) parsed!.common.title = stream.headers.get(Constants.STRINGS.ICY_NAME) as string;
				}
			} else if (stream.headers.get(Constants.STRINGS.CONTENT_TYPE) === Constants.STRINGS.APPLICATION_X_MPEG_URL) {
				await body?.cancel();
				parsed = { common: {}, format: {} } as IAudioMetadata;
			} else {
				if (!body) throw new Error(Constants.STRINGS.NO_BODY);
				const timer = new Promise((_, rej) => setTimeout(() => rej(new Error(Constants.STRINGS.TIMEOUT_REACHED)), 10000));
				const nodeReadable = Readable.fromWeb(body as import("stream/web").ReadableStream<any>);
				parsed = await Promise.race<[Promise<unknown>, Promise<IAudioMetadata>]>([
					timer,
					parseStream(nodeReadable, { mimeType: stream.headers.get(Constants.STRINGS.CONTENT_TYPE) || undefined, size: stream.headers.get(Constants.STRINGS.CONTENT_LENGTH) ? Number(stream.headers.get(Constants.STRINGS.CONTENT_LENGTH)) : undefined, url: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true })
				]) as IAudioMetadata;
				if (parsed.format.container) probe = parsed.format.container;
			}
		} catch {
			parsed = { common: {}, format: {} } as IAudioMetadata;
		}

		return {
			entries: [
				{
					title: parsed.common.title || Constants.STRINGS.UNKNOWN_TITLE,
					author: parsed.common.artist || Constants.STRINGS.UNKNOWN_AUTHOR,
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
		if (info.probeInfo!.raw === Constants.STRINGS.X_MPEG_URL || info.uri!.endsWith(Constants.STRINGS.DOT_M3U8)) return { stream: m3u8(info.uri!) };
		else {
			const response = await fetch(info.uri!, { redirect: Constants.STRINGS.FOLLOW, headers: Constants.baseHTTPRequestHeaders });
			const body = response.body;
			if (!body) throw new Error(Constants.STRINGS.INVALID_STREAM_RESPONSE);

			return { stream: Readable.fromWeb(body as import("stream/web").ReadableStream<any>) };
		}
	}
}

export default HTTPSource;
