const tokenizer: typeof import("@tokenizer/http") = require("@tokenizer/http");
const metadata: typeof import("music-metadata") = require("music-metadata");

import LimitedReadWriteStream from "../util/LimitedReadWriteStream";
import Util from "../util/Util";

const mimeRegex = /^(audio|video)\/(.+)$|^application\/(ogg)$/;

async function getHTTPAsSource(resource: string) {
	type ExtraData = { title?: string; author?: string; stream: boolean; probe: string }
	let parsed: import("music-metadata").IAudioMetadata;
	let headers: import("http").IncomingHttpHeaders;

	try {
		const toke = await tokenizer.makeTokenizer(resource, { timeoutInSec: 10 }, { resolveUrl: true });
		headers = {
			"content-type": toke.fileInfo.mimeType,
			"content-length": String(toke.fileInfo.size)
		};
		const timer = new Promise<import("music-metadata").IAudioMetadata>((_, rej) => setTimeout(() => rej(new Error("Timeout reached")), 7500));
		parsed = await Promise.race<Promise<import("music-metadata").IAudioMetadata>>([
			timer,
			metadata.parseFromTokenizer(toke)
		]).then(d => d[1]);
	} catch {
		const stream = await Util.request(resource);

		const readwrite = new LimitedReadWriteStream(50);
		headers = stream.headers;
		try {
			parsed = await metadata.parseStream(stream.pipe(readwrite), { mimeType: stream.headers["content-type"], size: stream.headers["content-length"] ? Number(stream.headers["content-length"]) : undefined });
			stream.destroy();
		} catch {
			if (headers["content-type"]?.match(mimeRegex)) {
				parsed = {
					// @ts-ignore
					common: {},
					// @ts-ignore
					format: {}
				};
				// @ts-ignore
			} else parsed = undefined;
		}
	}

	if (!parsed) throw new Error("NO_PARSED");

	const mimeMatch = headers["content-type"]?.match(mimeRegex);
	const chunked = !!(headers["transfer-encoding"] && headers["transfer-encoding"].includes("chunked"));

	const extra: ExtraData = {
		stream: chunked,
		probe: mimeMatch ? (mimeMatch[3] ? mimeMatch[3] : mimeMatch[2]) : parsed.format.container!.toLowerCase()
	};
	if (headers["icy-description"]) extra.title = headers["icy-description"] as string;
	if (headers["icy-name"]) extra.author = headers["icy-name"] as string;
	return { parsed, extra };
}

export = getHTTPAsSource;
