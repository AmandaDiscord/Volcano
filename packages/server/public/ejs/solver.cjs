// Runs yt-dlp's EJS challenge solver (lib.min.js + core.min.js, https://github.com/yt-dlp/ejs) off the main thread
const { parentPort } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = vm.createContext({});
const lib = fs.readFileSync(path.join(__dirname, "lib.min.js"), "utf8");
const core = fs.readFileSync(path.join(__dirname, "core.min.js"), "utf8");
vm.runInContext(`${lib};Object.assign(globalThis, lib);${core}`, context);

let player = { url: "", sts: 0, input: null };

parentPort.on("message", async ({ id, playerURL, n, sig }) => {
	try {
		if (player.url !== playerURL) {
			const code = await fetch(playerURL).then(r => r.text());
			player = { url: playerURL, sts: Number(/(?:signatureTimestamp|sts)\s*:\s*(\d{5})/.exec(code)?.[1]), input: { type: "player", player: code, output_preprocessed: true } };
		}

		const requests = [];
		if (n) requests.push({ type: "n", challenges: [n] });
		if (sig) requests.push({ type: "sig", challenges: [sig] });
		const result = { id, sts: player.sts };

		if (requests.length) {
			const out = context.jsc({ ...player.input, requests });
			if (out.type === "error") throw new Error(out.error);
			// The first solve parses the whole ~3MB player. The preprocessed form makes later solves ~20x cheaper
			if (out.preprocessed_player) player.input = { type: "preprocessed", preprocessed_player: out.preprocessed_player };
			out.responses.forEach((response, i) => {
				if (response.type === "error") throw new Error(response.error);
				result[requests[i].type] = response.data[requests[i].challenges[0]];
			});
		}

		parentPort.postMessage(result);
	} catch (e) {
		parentPort.postMessage({ id, error: String(e?.message ?? e) });
	}
});
