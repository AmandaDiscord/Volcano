import centra from "centra";
const metadata: typeof import("music-metadata") = require("music-metadata");

import Constants from "../Constants";
import LimitedReadWriteStream from "../util/LimitedReadWriteStream";

const mimeRegex = /^(audio|video)\/(.+)$/;

async function getHTTPAsSource(resource: string) {
	type ExtraData = { title?: string; author?: string; stream: boolean; probe: string }
	return centra(resource, "get").header(Constants.baseHTTPRequestHeaders).compress().stream().send().then(async res => {
		const message: import("http").IncomingMessage = res as any;

		if (!Constants.OKStatusCodes.includes(message.statusCode as number)) {
			message.destroy();
			throw new Error("Non OK status code");
		}

		const mimeMatch = message.headers["content-type"]?.match(mimeRegex);
		if (message.headers["content-type"] && !mimeMatch) {
			message.destroy();
			throw new Error("Unknown file format.");
		}

		const chunked = !!(message.headers["transfer-encoding"] && message.headers["transfer-encoding"].includes("chunked"));
		// chunked is up here because I previously used it to limit how many frames were piped if it was chunked or not.
		const readwrite = new LimitedReadWriteStream(20);
		const parsed = await metadata.parseStream(message.pipe(readwrite), { mimeType: message.headers["content-type"], size: message.headers["content-length"] ? Number(message.headers["content-length"]) : undefined });

		message.destroy();
		if (!message.headers["content-type"] && !parsed.format.container) throw new Error("Unknown file format.");

		const extra: ExtraData = {
			stream: chunked,
			probe: mimeMatch ? mimeMatch[2] : parsed.format.container!.toLowerCase()
		};
		if (message.headers["icy-description"]) extra.title = message.headers["icy-description"] as string;
		if (message.headers["icy-name"]) extra.author = message.headers["icy-name"] as string;
		return { parsed, extra };
	});
}

export = getHTTPAsSource;
