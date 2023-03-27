import { Plugin } from "volcano-sdk";

class ExtraHTTPRoutes extends Plugin {
	/**
	 * @param {URL} url
	 * @param {import("http").IncomingMessage} req
	 * @param {import("http").ServerResponse} res
	 */
	async routeHandler(url, req, res) {
		if (url.pathname === `/v${global.lavalinkMajor}/ping`) {
			/** @type {{ [gid: string]: number }}} */
			const accumulator = {};
			const worker = await this.utils.getWorker();
			for (const q of worker.queues.values()) {
				accumulator[q.guildID] = q.state.ping;
			}
			res.writeHead(200, this.utils.Constants.baseHTTPResponseHeaders).end(JSON.stringify(accumulator));
		}
	}
}

export default ExtraHTTPRoutes;
