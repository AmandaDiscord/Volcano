const startTime: number = Date.now();

import HTTP from "http";
import os from "os";
import util from "util";
import path from "path";
import fs from "fs";

import "./util/Logger.js";
import "./loaders/keys.js";

import Constants from "./Constants.js";

import paths from "./loaders/http.js";

let username: string;
try {
	username = os.userInfo().username;
} catch {
	username = "unknown";
}

const pkg = await fs.promises.readFile(path.join(lavalinkDirname, "../package.json"), "utf-8").then(JSON.parse);

const buildInfo = await fs.promises.readFile(path.join(lavalinkDirname, "buildinfo.json"), "utf-8").then(JSON.parse).catch(() => ({
	build_time: null as number | null,
	branch: "unknown",
	commit: "unknown"
})) as {
	build_time: number | null;
	branch: string;
	commit: string;
};

if (lavalinkConfig.spring.main["banner-mode"] === "log")
	console.log("\n\n" +
					"\x1b[33m__      __   _                                \x1b[97moOOOOo\n" +
					"\x1b[33m\\ \\    / /  | |                             \x1b[97mooOOoo  oo\n" +
					"\x1b[33m \\ \\  / /__ | | ___ __ _ _ __   ___        \x1b[0m/\x1b[31mvvv\x1b[0m\\    \x1b[97mo\n" +
					"\x1b[33m  \\ \\/ / _ \\| |/ __/ _` | '_ \\ / _ \\      \x1b[0m/\x1b[31mV V V\x1b[0m\\\n" +
					"\x1b[33m   \\  / (_) | | (_| (_| | | | | (_) |    \x1b[0m/   \x1b[31mV   \x1b[0m\\\n" +
					"\x1b[33m    \\/ \\___/|_|\\___\\__,_|_| |_|\\___/  \x1b[0m/\\/     \x1b[31mVV  \x1b[0m\\\n"
					+ "    =================================/______/\\_____\\");

const properties = {
	Version: pkg.version,
	"Lavalink version": lavalinkVersion,
	"Build time": buildInfo.build_time ? new Date(buildInfo.build_time).toUTCString() : "unknown",
	Branch: buildInfo.branch,
	Commit: buildInfo.commit !== "unknown" ? buildInfo.commit.slice(0, 6) : buildInfo.commit,
	Node: process.version.replace("v", ""),
	Downloader: pkg.dependencies["play-dl"].replace("^", "")
};

const longestLength = Object.keys(properties).map(k => k.length).sort((a, b) => b - a)[0];

console.log(`\n\n\n${Object.entries(properties).map(props => `	${props[0]}:${" ".repeat(longestLength - props[0].length)}   ${props[1]}`).join("\n")}\n\n`);
console.log(`Starting Launcher using Node ${process.version.replace("v", "")} on ${os.hostname()} with PID ${process.pid} (${path.join(lavalinkDirname, "index.js")} started by ${username} in ${process.cwd()})`);
console.log(`OS: ${Constants.platformNames[process.platform] || process.platform} ${os.release()?.split(".")[0] || "Unknown release"} Arch: ${process.arch}`);

const http = HTTP.createServer(serverHandler);

const allDigitRegex = /^\d+$/;
http.on("upgrade", async (request: HTTP.IncomingMessage, socket: import("net").Socket, head: Buffer) => {
	console.log(`Incoming connection from /${request.socket.remoteAddress}:${request.socket.remotePort}`);

	const temp401 = "HTTP/1.1 401 Unauthorized\r\n\r\n";
	const userId = request.headers["user-id"];

	const passwordIncorrect: boolean = (!!lavalinkConfig.lavalink.server.password?.length && request.headers.authorization !== String(lavalinkConfig.lavalink.server.password));
	const invalidUserId: boolean = (!userId || Array.isArray(userId) || !allDigitRegex.test(userId));
	if (passwordIncorrect || invalidUserId) {
		return socket.write(temp401, () => {
			socket.end();
			socket.destroy();
		});
	}

	const websocket = await import("./loaders/websocket.js");
	websocket.handleWSUpgrade(request, socket, head);
});

async function serverHandler(req: import("http").IncomingMessage, res: import("http").ServerResponse): Promise<unknown> {
	try {
		const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

		const isInvalidPassword = !!lavalinkConfig.lavalink.server.password.length && (!req.headers.authorization || req.headers.authorization !== String(lavalinkConfig.lavalink.server.password));

		// This is just for rest. Upgrade requests for the websocket are handled in the http upgrade event.
		if (url.pathname !== "/" && isInvalidPassword) {
			console.error(`Authorization missing for ${req.socket.remoteAddress} on ${req.method!.toUpperCase()} ${url.pathname}`);
			return res.writeHead(401, "Unauthorized", Object.assign({}, Constants.baseHTTPResponseHeaders, { ["Content-Type"]: "text/plain" })).end("Unauthorized");
		}

		const path = paths[url.pathname];
		const method = req.method?.toUpperCase() || "";
		if (path) {
			if (!path.methods.includes(method)) res.writeHead(405).end();
			else if (req.headers["range"]) res.writeHead(416).end();
			else if (req.headers["expect"]) res.writeHead(417).end();
			else await path.handle(req, res, url);
		} else {
			const filtered = lavalinkPlugins.filter(p => !!p.routeHandler);
			for (const plugin of filtered) {
				await plugin.routeHandler!(url, req, res);
			}
		}

		if (!res.headersSent && res.writable) return res.writeHead(404, "Not Found", Constants.baseHTTPResponseHeaders).end("Not Found");
	} catch (e) {
		if (!res.headersSent) res.writeHead(500, "Internal server error", Object.assign({}, Constants.baseHTTPResponseHeaders, { ["Content-Type"]: "text/plain" }));
		if (res.writable) res.end(util.inspect(e, false, Infinity, false));
	}
}

http.listen(lavalinkConfig.server.port, lavalinkConfig.server.address, () => console.log("Volcano is ready to accept connections."));
console.log(`Server started on port(s) ${lavalinkConfig.server.port} (http)`);
console.log(`Started Launcher in ${(Date.now() - startTime) / 1000} seconds (Node running for ${process.uptime()})`);

process.on("unhandledRejection", e => {
	console.debug(e);
	console.error(util.inspect(e, false, Infinity, true));
});
process.on("uncaughtException", (e, origin) => console.error(`${util.inspect(e, false, Infinity, true)}\n${util.inspect(origin)}`));
process.title = "Volcano";

import("./loaders/plugins.js");
