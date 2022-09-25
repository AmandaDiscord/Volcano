// Plugin makers: Copy the definitions for all of the @typedefs and make sure your plugin
// is made to implement these interfaces, because if it does not adhere to it, it will not work.
// the constructor is not called with any params. It is up to you to get info you need
// setVariables is called before initialize so that you can access the logger.
// Your plugin will be initialized once for the main thread and once for each worker thread that spawns which is theoretically infinite
/**
 * @typedef {Object} TrackInfo
 * @property {string} title
 * @property {string} author
 * @property {string} identifier
 * @property {string} uri
 * @property {number} length
 * @property {boolean} isStream
 */

/**
 * @typedef {Object} Logger
 * @property {(message: any, worker?: string) => void} info
 * @property {(message: any, worker?: string) => void} error
 * @property {(message: any, worker?: string) => void} warn
 */

/**
 * @typedef {Object} PluginInterface
 *
 * @property {(logger: Logger, utils: any) => unknown} [setVariables]
 * @property {() => unknown} [initialize]
 * @property {(filters: Array<string>, options: Record<any, any>) => unknown} [mutateFilters]
 * @property {(url: URL, req: import("http").IncomingMessage, res: import("http").ServerResponse) => unknown} [routeHandler]
 * @property {(packet: Record<any, any>, socket: import("ws").WebSocket) => unknown} [onWSMessage]
 * @property {string} [source]
 * @property {string} [searchShort]
 * @property {string} [version]
 * @property {(resource: string, isResourceSearch: boolean) => boolean} [canBeUsed]
 * @property {(resource: string, isResourceSearch: boolean) => { entries: Array<TrackInfo>, plData?: { name: string; selectedTrack?: number; } } | Promise<{ entries: Array<TrackInfo>, plData?: { name: string; selectedTrack?: number; } }>} [infoHandler]
 * @property {(info: import("@lavalink/encoding").TrackInfo, usingFFMPEG: boolean) => { type?: import("@discordjs/voice").StreamType; stream: import("stream").Readable } | Promise<{ type?: import("@discordjs/voice").StreamType; stream: import("stream").Readable }>} [streamHandler]
 */

import { isMainThread } from "worker_threads";

/** @implements {PluginInterface} */
class ExtraWSOPs {
	constructor() {
		this.version = "1.0.0";
	}

	/**
	 * @param {Record<any, any>} packet
	 * @param {import("ws").WebSocket} socket
	 */
	async onWSMessage(packet, socket) {
		if (!isMainThread) return;
		if (packet.op === "dump") global.lavalinkThreadPool.dump();
		else if (packet.op === "ping") {
			const payload = { op: "pong" };
			if (packet.guildId) {
				const threadStats = await global.lavalinkThreadPool.broadcast({ op: 6 });
				for (const worker of threadStats)
					if (worker.pings[packet.guildId] !== undefined) payload.ping = worker.pings[packet.guildId];
			}
			socket.send(JSON.stringify(payload));
		}
	}
}

export default ExtraWSOPs;
