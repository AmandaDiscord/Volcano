import { Plugin } from "volcano-sdk";

class ExtraHTTPRoutes extends Plugin {
	async initialize() {
		const http = await this.utils.getHTTP();
		const worker = await this.utils.getWorker();

		http.default.get(`/v${global.lavalinkMajor}/ping`, (res, req) => {
			if (!this.utils.authenticate(req, res)) return;

			/** @type {{ [gid: string]: number }}} */
			const accumulator = {};
			for (const q of worker.queues.values()) {
				accumulator[q.guildID] = q.state.ping;
			}
			res.writeStatus("200 OK");
			this.utils.assignHeadersToResponse(res, this.utils.Constants.baseHTTPResponseHeaders);
			res.end(JSON.stringify(accumulator), true);
		});
	}
}

export default ExtraHTTPRoutes;
