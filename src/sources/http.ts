import { Readable } from "stream";

import { IAudioMetadata, parseStream } from "music-metadata";
import Constants from "../Constants.js";

const mimeRegex = /^(audio|video|application)\/(.+)$/;

type ExtraData = { stream: boolean; probe: string }

async function getHTTPAsSource(resource: string) {
	let parsed: IAudioMetadata | undefined;
	let headers: Headers | undefined = undefined;
	let isCast = false;
	let isIcy = false;
	let extra: ExtraData = { stream: false, probe: "*" };

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

		const chunked = !!headers.get("transfer-encoding")?.includes("chunked") || isCast || (stream.headers.get("content-type") === "application/x-mpegURL");
		extra = { stream: chunked, probe: mimeMatch ? mimeMatch[2] : "*" };

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
			parsed = await Promise.race<[Promise<unknown>, Promise<IAudioMetadata>]>([
				timer,
				parseStream(Readable.fromWeb(body as import("stream/web").ReadableStream<any>), { mimeType: stream.headers.get("content-type") || undefined, size: stream.headers.get("content-length") ? Number(stream.headers.get("content-length")) : undefined, url: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true })
			]) as IAudioMetadata;
			await body.cancel();
			if (parsed.format.container) extra.probe = parsed.format.container.toLowerCase();
		}
	} catch {
		parsed = { common: {}, format: {} } as IAudioMetadata;
	}

	return { parsed, extra };
}

export default getHTTPAsSource;
