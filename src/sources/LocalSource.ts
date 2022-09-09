import fs from "fs";
import path from "path";

import { parseStream } from "music-metadata";

import type { Plugin } from "../types.js";

class LocalSource implements Plugin {
	public source = "local";

	public canBeUsed(resource: string) {
		return path.isAbsolute(resource);
	}

	public async infoHandler(resource: string) {
		const stat = await fs.promises.stat(resource).catch(() => void 0);
		if (!stat) throw new Error("FILE_NOT_EXISTS");
		if (!stat.isFile()) throw new Error("PATH_NOT_FILE");

		const meta = await parseStream(fs.createReadStream(resource), { size: stat.size, path: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true });
		const fileEnding = path.extname(resource).replace(".", "");
		if (!fileEnding) throw new Error("No file extension");

		return {
			entries: [
				{
					identifier: resource,
					uri: resource,
					author: meta.common.artist || "Unknown artist",
					length: Math.round((meta.format.duration || 0) * 1000),
					title: meta.common.title || "Unknown title",
					isStream: false,
					probeInfo: {
						raw: fileEnding,
						name: fileEnding,
						parameters: null
					}
				}
			]
		};
	}

	public streamHandler(info: import("@lavalink/encoding").TrackInfo) {
		return { stream: fs.createReadStream(info.uri!) };
	}
}

export default LocalSource;
