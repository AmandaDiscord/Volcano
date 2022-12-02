import { Plugin } from "volcano-sdk";

class ExtraWSOPs extends Plugin {
	/**
	 * @param {Record<any, any>} packet
	 * @param {any} socket
	 */
	async onWSMessage(packet, socket) {
		return;
		if (packet.op === "ping") {
			const payload = { op: "pong" };
			if (packet.guildId) {
				/** @type {Array<{ playingPlayers: number; players: number; pings: { [guildID: string]: number }; }>} */
				const threadStats = await global.lavalinkThreadPool.broadcast({ op: 6 });
				for (const worker of threadStats) {
					if (worker.pings[packet.guildId] !== undefined) {
						payload.ping = worker.pings[packet.guildId];
						break;
					}
				}
			}
			socket.send(JSON.stringify(payload));
		}
	}
}

export default ExtraWSOPs;
