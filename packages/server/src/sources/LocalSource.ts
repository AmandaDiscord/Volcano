import fs from "node:fs";
import path from "node:path";

import { parseStream } from "music-metadata";
import { Plugin } from "volcano-sdk";

import { lavaplayerProbe, playlistExtRegex } from "./HTTPSource.js";

import type HTTPSource from "./HTTPSource.js";

class LocalSource extends Plugin {
	public source = "local";

	public canBeUsed(resource: string) {
		return path.isAbsolute(resource);
	}

	public async infoHandler(resource: string) {
		const stat = await fs.promises.stat(resource).catch(() => void 0);
		if (!stat?.isFile()) return { entries: [] };
		const fileEnding = path.extname(resource).replace(".", "");
		if (!fileEnding) throw new Error("The provided doesn't have a file extension");
		// Lavaplayer only follows links out of a playlist file, which the HTTP source loads
		if (playlistExtRegex.test(resource)) {
			if (lavalinkConfig.lavalink.server.sources.http === false) return { entries: [] };
			const result = await (lavalinkPlugins.find(p => p.source === "http") as HTTPSource).followPlaylist(await fs.promises.readFile(resource, "utf-8"), 0);
			result.source ??= "http";
			return result;
		}

		const meta = await parseStream(fs.createReadStream(resource), { size: stat.size, path: resource }, { skipCovers: true, skipPostHeaders: true, includeChapters: false, duration: true });
		const probe = lavaplayerProbe(meta.format.container, fileEnding);

		return {
			entries: [
				{
					identifier: resource,
					uri: resource,
					author: meta.common.artist ?? "Unknown author",
					length: Math.round((meta.format.duration ?? 0) * 1000),
					title: meta.common.title ?? "Unknown title",
					isStream: false,
					probeInfo: {
						raw: probe,
						name: probe,
						parameters: null
					}
				}
			]
		};
	}

	public streamHandler(info: import("volcano-encoding").TrackInfo) {
		return { stream: fs.createReadStream(info.uri!) };
	}
}

export default LocalSource;
