const icy: typeof import("http") = require("icy");
const tokenizer: typeof import("@tokenizer/http") = require("@tokenizer/http");
const metadata: typeof import("music-metadata") = require("music-metadata");

import LimitedReadWriteStream from "../util/LimitedReadWriteStream";
import Constants from "../Constants";

const mimeRegex = /^(audio|video)\/(.+)$|^application\/(ogg)$/;

async function getHTTPAsSource(resource: string) {
	type ExtraData = { title?: string; author?: string; stream: boolean; probe: string }

	const remote = new URL(resource);
	let parsed: import("music-metadata").IAudioMetadata;
	let headers: any;

	try {
		const toke = await tokenizer.makeTokenizer(resource, { timeoutInSec: 10 }, { resolveUrl: true });
		headers = {
			"content-type": toke.fileInfo.mimeType,
			"content-length": toke.fileInfo.size
		};
		parsed = await metadata.parseFromTokenizer(toke);
	} catch {
		const stream = await new Promise<import("http").IncomingMessage>((res, rej) => {
			const req = icy.get({
				hostname: remote.host,
				path: remote.pathname,
				protocol: remote.protocol,
				headers: Constants.baseHTTPRequestHeaders
			}, response => {
				response.once("error", e => {
					response.destroy();
					return rej(e);
				});
				res(response);
			});
			req.once("error", e => {
				req.destroy();
				return rej(e);
			});
			req.end();
		});

		const readwrite = new LimitedReadWriteStream(20);
		parsed = await metadata.parseStream(stream.pipe(readwrite), { mimeType: stream.headers["content-type"], size: stream.headers["content-length"] ? Number(stream.headers["content-length"]) : undefined });
		stream.destroy();
		headers = stream.headers;
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
