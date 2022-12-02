import path from "path";
import fs from "fs";
import util from "util";

import Util from "../util/Util.js";

let pushToEnd: import("volcano-sdk").Plugin | undefined = undefined;

const sources = await Promise.all([
	import("../sources/BandcampSource.js"),
	import("../sources/HTTPSource.js"),
	import("../sources/LocalSource.js"),
	import("../sources/SoundcloudSource.js"),
	import("../sources/TwitchSource.js"),
	import("../sources/YouTubeSource.js")
]);
for (const module of sources) {
	let constructed: import("volcano-sdk").Plugin;
	try {
		constructed = new module.default(console, Util);
		await constructed.initialize?.();
		lavalinkSources.add(constructed);
	} catch (e) {
		console.warn("A Source had errors when initializing and has been ignored from the source list");
		console.error(util.inspect(e, false, Infinity, true));
		continue;
	}
	if (constructed.source === "http") pushToEnd = constructed;
	else lavalinkPlugins.push(constructed);
}

const pluginsDir = path.join(lavalinkDirname, "../plugins");
const isDir = await fs.promises.stat(pluginsDir).then(s => s.isDirectory()).catch(() => false);
if (isDir) {
	for (const file of await fs.promises.readdir(pluginsDir)) {
		if (!file.endsWith(".js")) continue;
		let constructed: import("volcano-sdk").Plugin;
		try {
			const module = await import(`file://${path.join(pluginsDir, file)}`) as { default: typeof import("volcano-sdk").Plugin };
			constructed = new module.default(console, Util);
			await constructed.initialize?.();
		} catch (e) {
			console.warn(`Plugin from ${file} had errors when initializing and has been ignored from the plugin list`);
			console.error(util.inspect(e, false, Infinity, true));
			continue;
		}
		if (lavalinkPlugins.find(p => p.source && constructed.source && p.source === constructed.source)) console.warn(`Plugin for ${constructed.source} has duplicates and could possibly be unused`);
		lavalinkPlugins.push(constructed);
		console.log(`Loaded plugin for ${constructed.constructor.name}`);
	}
}

if (pushToEnd) lavalinkPlugins.push(pushToEnd);
