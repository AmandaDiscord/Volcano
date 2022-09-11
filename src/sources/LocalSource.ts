import fs from "fs";
import path from "path";

import { parseStream } from "music-metadata";

import Constants from "../Constants.js";
import type { Plugin } from "../types.js";

class LocalSource implements Plugin {
	public source = Constants.STRINGS.LOCAL;

	public canBeUsed(resource: string) {
		return path.isAbsolute(resource);
	}

	public async infoHandler(resource: string) {
		const stat = await fs.promises.stat(resource).catch(() => void 0);
		if (!stat) throw new Error(Constants.STRINGS.FILE_NOT_EXISTS);
		if (!stat.isFile()) throw new Error(Constants.STRINGS.PATH_NOT_FILE);

		const meta = await parseStream(fs.createReadStream(resource), { size: stat.size, path: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true });
		const fileEnding = path.extname(resource).replace(Constants.STRINGS.DOT, Constants.STRINGS.EMPTY_STRING);
		if (!fileEnding) throw new Error(Constants.STRINGS.NO_FILE_EXTENSION);

		return {
			entries: [
				{
					identifier: resource,
					uri: resource,
					author: meta.common.artist || Constants.STRINGS.UNKNOWN_AUTHOR,
					length: Math.round((meta.format.duration || 0) * 1000),
					title: meta.common.title || Constants.STRINGS.UNKNOWN_TITLE,
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
