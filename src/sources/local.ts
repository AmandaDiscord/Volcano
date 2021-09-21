import fs from "fs";
import path from "path";

const metadata: typeof import("music-metadata") = require("music-metadata");

async function getLocalAsSource(resource: string) {
	if (!fs.existsSync(resource)) throw new Error("FILE_NOT_EXISTS");

	const stat = await fs.promises.stat(resource);
	if (!stat.isFile()) throw new Error("PATH_NOT_FILE");

	const meta = await metadata.parseStream(fs.createReadStream(resource), { size: stat.size });
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
