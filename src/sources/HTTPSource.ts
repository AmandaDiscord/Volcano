import { IAudioMetadata, parseStream } from "music-metadata";
import m3u8 from "m3u8stream";

import Constants from "../Constants.js";
import Util from "../util/Util.js";
import type { Plugin } from "../types.js";

const mimeRegex = /^(audio|video|application)\/(.+)$/;
const httpRegex = /^https?:\/\//;
const supportedApplicationTypes = [Constants.STRINGS.OGG, Constants.STRINGS.X_MPEG_URL];
const redirectStatusCodes = [301, 302, 303, 307, 308];

class HTTPSource implements Plugin {
	public source = Constants.STRINGS.HTTP;

	public canBeUsed(resource: string) {
		if (resource.match(httpRegex)) return true;
		else return false;
	}

	private static async followURLS(url: string, redirects = 0): Promise<ReturnType<typeof import("../util/Util.js")["socketToRequest"]>> {
		if (redirects > 3) throw new Error("TOO_MANY_REDIRECTS");
		const stream = await Util.connect(url, { headers: Constants.baseHTTPRequestHeaders });
		const data = await Util.socketToRequest(stream);
		if (redirectStatusCodes.includes(data.status) && data.headers["location"]) return this.followURLS(data.headers["location"], redirects++);
		else return data;
	}

	public async infoHandler(resource: string) {
		let parsed: IAudioMetadata | undefined;
		let isCast = false;
		let isIcy = false;
		let probe: string;
		let chunked = false;

		const data = await HTTPSource.followURLS(resource);

		const mimeMatch = data.headers[Constants.STRINGS.CONTENT_TYPE]?.match(mimeRegex);
		if (mimeMatch && mimeMatch[1] === Constants.STRINGS.APPLICATION && !supportedApplicationTypes.includes(mimeMatch[2])) {
			data.body.destroy();
			throw new Error(Constants.STRINGS.UNSUPPORTED_FILE_TYPE);
		}

		Object.keys(data.headers).forEach(key => {
			if (key.startsWith(Constants.STRINGS.ICY_HEADER_DASH)) isIcy = isCast = true;
		});

		chunked = !!data.headers[Constants.STRINGS.TRANSFER_ENCODING]?.includes(Constants.STRINGS.CHUNKED) || isCast || (data.headers[Constants.STRINGS.CONTENT_TYPE] === Constants.STRINGS.APPLICATION_X_MPEG_URL);
		probe = mimeMatch ? mimeMatch[2] : Constants.STRINGS.STAR;

		// Is stream chunked? (SKIPS A LOT OF CHECKS AND JUST RUNS WITH IT)
		// Will be more than just ice-cast in the future
		if (isCast) {
			data.body.destroy();
			parsed = { common: {}, format: {} } as IAudioMetadata;

			// Fill in ice cast data if applicable so track info doesn't always fallback to Unknown.
			if (isIcy) {
				if (data.headers[Constants.STRINGS.ICY_DESCRIPTION]) parsed!.common.artist = data.headers[Constants.STRINGS.ICY_DESCRIPTION] as string;
				if (data.headers[Constants.STRINGS.ICY_NAME]) parsed!.common.title = data.headers[Constants.STRINGS.ICY_NAME] as string;
			}
		} else if (data.headers[Constants.STRINGS.CONTENT_TYPE] === Constants.STRINGS.APPLICATION_X_MPEG_URL) {
			data.body.destroy();
			parsed = { common: {}, format: {} } as IAudioMetadata;
		} else {
			const timer = new Promise((_, rej) => setTimeout(() => rej(new Error(Constants.STRINGS.TIMEOUT_REACHED)), 10000));
			parsed = await Promise.race<[Promise<unknown>, Promise<IAudioMetadata>]>([
				timer,
				parseStream(data.body, { mimeType: data.headers[Constants.STRINGS.CONTENT_TYPE] || undefined, size: data.headers[Constants.STRINGS.CONTENT_LENGTH] ? Number(data.headers[Constants.STRINGS.CONTENT_LENGTH]) : undefined, url: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true })
			]) as IAudioMetadata;
			if (parsed.format.container) probe = parsed.format.container;
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
			const response = await Util.connect(info.uri!, { headers: Constants.baseHTTPRequestHeaders });
			return { stream: response };
		}
	}
}

export default HTTPSource;
