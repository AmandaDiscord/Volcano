const startTime: number = Date.now();

import os from "os";
import util from "util";
import path from "path";
import fs from "fs";

import "./util/Logger.js";
import "./loaders/keys.js";

import Constants from "./Constants.js";

let username: string;
try {
	username = os.userInfo().username;
} catch {
	username = "unknown";
}

const pkg = await fs.promises.readFile(path.join(lavalinkDirname, "../package.json"), "utf-8").then(JSON.parse);

const buildInfo = await fs.promises.readFile(path.join(lavalinkDirname, "buildinfo.json"), "utf-8").then(JSON.parse).catch(() => ({
	build_time: null,
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

process.on("unhandledRejection", e => console.error(util.inspect(e, false, Infinity, true)));
process.on("uncaughtException", (e, origin) => console.error(`${util.inspect(e, false, Infinity, true)}\n${util.inspect(origin)}`));
process.title = "Volcano";

const [http] = await Promise.all([
	import("./loaders/http.js"),
	import("./loaders/plugins.js"),
	import("./loaders/stdin.js")
]);

console.log(`Started Launcher in ${(Date.now() - startTime) / 1000} seconds (Node running for ${process.uptime()})`);
console.log(`Server started on port(s) ${lavalinkConfig.server.port} (http)`);
http.default.listen(lavalinkConfig.server.address, lavalinkConfig.server.port, worked => worked ? console.log("Volcano is ready to accept connections.") : console.error("Unable to bind to port and/or address"));
