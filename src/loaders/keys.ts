import path from "path";
import fs from "fs";

import * as dl from "play-dl";

import Constants from "../Constants.js";

import "./config.js";
import lavalink from "./lavalink.js";

const keyDir = path.join(lavalink.lavalinkDirname, "../soundcloud.txt");

async function keygen() {
	const clientID = await dl.getFreeClientID();
	if (!clientID) throw new Error("SOUNDCLOUD_KEY_NO_CREATE");
	fs.writeFileSync(keyDir, clientID, { encoding: "utf-8" });
	await dl.setToken({ soundcloud : { client_id : clientID } });
}

if (fs.existsSync(keyDir)) {
	if (Date.now() - (await fs.promises.stat(keyDir)).mtime.getTime() >= (1000 * 60 * 60 * 24 * 7)) await keygen();
	else {
		const APIKey = await fs.promises.readFile(keyDir, { encoding: "utf-8" });
		await dl.setToken({ soundcloud: { client_id: APIKey } });
	}
} else await keygen();

await dl.setToken({ useragent: [Constants.fakeAgent] });
if (lavalinkConfig.lavalink.server.youtubeCookie) await dl.setToken({ youtube: { cookie: lavalinkConfig.lavalink.server.youtubeCookie } });
