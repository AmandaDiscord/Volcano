import { Plugin } from "volcano-sdk";

class ExtraHTTPRoutes extends Plugin {
	async initialize() {
		const http = await this.utils.getHTTP();
		const pool = await this.utils.getThreadPool();

		http.default.get(`/v${global.lavalinkMajor}/ping`, async (res, req) => {
			if (!this.utils.authenticate(req, res)) return;
			this.utils.attachAborthandler(res);

			const { pings } = await pool.stats();
			if (res.aborted) return;
			res.cork(() => {
				res.writeStatus("200 OK");
				this.utils.assignHeadersToResponse(res, this.utils.Constants.baseHTTPResponseHeaders);
				res.end(JSON.stringify(pings), true);
			});
		});
	}
}

export default ExtraHTTPRoutes;
