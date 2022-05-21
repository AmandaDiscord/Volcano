import fs from "fs";
import path from "path";

import * as metadata from "music-metadata";

async function getLocalAsSource(resource: string) {
	const stat = await fs.promises.stat(resource).catch(() => void 0);
	if (!stat) throw new Error("FILE_NOT_EXISTS");
	if (!stat.isFile()) throw new Error("PATH_NOT_FILE");

	const meta = await metadata.parseStream(fs.createReadStream(resource), { size: stat.size, path: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true });
	const fileEnding = path.extname(resource).replace(".", "");
	if (!fileEnding) throw new Error("No file extension");

	return {
		identifier: resource,
		author: meta.common.artist || "Unknown artist",
		length: Math.round((meta.format.duration || 0) * 1000),
		title: meta.common.title || "Unknown title",
		probeInfo: {
			raw: fileEnding,
			name: fileEnding,
			parameters: null
		}
	};
}

export = getLocalAsSource;
