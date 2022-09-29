import { isMainThread } from "worker_threads";

import { Plugin } from "volcano-sdk";

class ExtraWSOPs extends Plugin {
	/**
	 * @param {import("volcano-sdk/types").Logger} logger
	 * @param {import("volcano-sdk/types").Utils} utils
	 */
	constructor(logger, utils) {
		super(logger, utils);
	}

	/**
	 * @param {Record<any, any>} packet
	 * @param {any} socket
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
