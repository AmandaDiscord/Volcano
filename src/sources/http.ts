import { IAudioMetadata, parseStream, parseFromTokenizer } from "music-metadata";
import { makeTokenizer } from "@tokenizer/http";

import Util from "../util/Util.js";

const mimeRegex = /^(audio|video)\/(.+)$|^application\/(ogg)$/;

async function getHTTPAsSource(resource: string) {
	type ExtraData = { title?: string; author?: string; stream: boolean; probe: string }
	let parsed: IAudioMetadata | undefined;
	let headers: import("http").IncomingHttpHeaders | undefined = undefined;

	try {
		const stream = await Util.request(resource);

		if (stream.headers) headers = stream.headers;
		if (headers && headers["icy-notice1"]) {
			headers["transfer-encoding"] = "chunked";
			// @ts-ignore
			parsed = { common: {}, format: {} };
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
				// @ts-ignore
				parsed = { common: {}, format: {} };
			} else parsed = undefined;
		}
	}

	if (!headers) throw new Error("MISSING_RESPONSE_HEADERS");
	if (!parsed) throw new Error("NO_PARSED");

	const mimeMatch = headers["content-type"]?.match(mimeRegex);
	const chunked = !!(headers["transfer-encoding"] && headers["transfer-encoding"].includes("chunked"));

	const extra: ExtraData = { stream: chunked, probe: mimeMatch ? (mimeMatch[3] ? mimeMatch[3] : mimeMatch[2]) : parsed.format.container!.toLowerCase() };
	if (headers["icy-description"]) extra.title = headers["icy-description"] as string;
	if (headers["icy-name"]) extra.author = headers["icy-name"] as string;
	return { parsed, extra };
}

export default getHTTPAsSource;
