import { IAudioMetadata, parseStream, parseFromTokenizer } from "music-metadata";
import { makeTokenizer } from "@tokenizer/http";

import Util from "../util/Util.js";

const mimeRegex = /^(audio|video)\/(.+)$|^application\/(ogg)$/;

type ExtraData = { stream: boolean; probe: string }

async function getHTTPAsSource(resource: string) {
	let parsed: IAudioMetadata | undefined;
	let headers: import("http").IncomingHttpHeaders | undefined = undefined;

	try {
		const stream = await Util.request(resource);

		// Do not read stream.headers as icy (the http backend) does some funky stuff, but appends to rawHeaders
		if (stream.rawHeaders) {
			if ((stream.rawHeaders.length % 2) !== 0) throw new Error("RAW_HEADERS_HAS_ODD_NUMBER_OF_ENTRIES");
			headers = {};
			for (let index = 0; index < stream.rawHeaders.length; index++) {
				if ((index % 2) === 0) headers[stream.rawHeaders[index].toLowerCase()] = stream.rawHeaders[index + 1];
				else continue;
			}
		} else if (stream.headers) throw new Error("STREAM_HAS_HEADERS_BUT_NO_RAW_HEADERS");
		else throw new Error("RESPONSE_NO_HEADERS");

		const isIcy = !!Object.keys(headers).find(h => h.startsWith("icy-"));
		// Is stream chunked? (SKIPS A LOT OF CHECKS AND JUST RUNS WITH IT)
		// Will be more than just ice-cast in the future
		if (isIcy) {
			if (!headers["transfer-encoding"]) headers["transfer-encoding"] = "chunked";
			parsed = { common: {}, format: {} } as IAudioMetadata;

			// Fill in ice cast data if applicable so track info doesn't always fallback to Unknown.
			if (isIcy) {
				if (headers["icy-description"]) parsed!.common.artist = headers["icy-description"] as string;
				if (headers["icy-name"]) parsed!.common.title = headers["icy-name"] as string;
			}
		} else {
			const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout reached")), 10000));
			parsed = await Promise.race<[Promise<unknown>, Promise<IAudioMetadata>]>([
				timer,
				parseStream(stream, { mimeType: headers?.["content-type"], size: headers?.["content-length"] ? Number(headers["content-length"]) : undefined, url: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true })
			]) as IAudioMetadata;
		}
		stream.destroy();
	} catch {
		try {
			const toke = await makeTokenizer(resource, { timeoutInSec: 10 }, { resolveUrl: true });
			headers = { "content-type": toke.fileInfo.mimeType, "content-length": String(toke.fileInfo.size) };
			const timer = new Promise<IAudioMetadata>((_, rej) => setTimeout(() => rej(new Error("Timeout reached")), 10000));
			parsed = await Promise.race<Promise<IAudioMetadata>>([
				timer,
				parseFromTokenizer(toke)
			]);
		} catch {
			if (headers?.["content-type"]?.match(mimeRegex)) {
				parsed = { common: {}, format: {} } as IAudioMetadata;
			} else parsed = undefined;
		}
	}

	if (!headers) throw new Error("MISSING_RESPONSE_HEADERS");
	if (!parsed) throw new Error("NO_PARSED");

	const mimeMatch = headers["content-type"]?.match(mimeRegex);
	const chunked = !!(headers["transfer-encoding"] && headers["transfer-encoding"].includes("chunked"));

	const extra: ExtraData = { stream: chunked, probe: mimeMatch ? (mimeMatch[3] ? mimeMatch[3] : mimeMatch[2]) : parsed.format.container!.toLowerCase() };
	return { parsed, extra };
}

export default getHTTPAsSource;
