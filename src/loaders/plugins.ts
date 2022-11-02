import path from "path";
import fs from "fs";
import util from "util";
import { isMainThread } from "worker_threads";

import logger from "../util/Logger.js";
import Util from "../util/Util.js";

let pushToEnd: import("volcano-sdk").Plugin | undefined = undefined;

const sourcesDir = path.join(lavalinkDirname, "./sources");
for (const file of await fs.promises.readdir(sourcesDir)) {
	if (!file.endsWith(".js")) continue;
	let constructed: import("volcano-sdk").Plugin;
	try {
		const module = await import(`file://${path.join(sourcesDir, file)}`) as { default: typeof import("volcano-sdk").Plugin };
		constructed = new module.default(logger, Util);
		await constructed.initialize?.();
		lavalinkSources.add(constructed);
	} catch (e) {
		if (isMainThread) {
			logger.warn(`Source from ${file} had errors when initializing and has been ignored from the source list`);
			logger.error(util.inspect(e, false, Infinity, true));
		}
		continue;
	}
	if (constructed.source === "http" && isMainThread) pushToEnd = constructed;
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
			constructed = new module.default(logger, Util);
			await constructed.initialize?.();
		} catch (e) {
			if (isMainThread) {
				logger.warn(`Plugin from ${file} had errors when initializing and has been ignored from the plugin list`);
				logger.error(util.inspect(e, false, Infinity, true));
			}
			continue;
		}
		if (lavalinkPlugins.find(p => p.source && constructed.source && p.source === constructed.source) && isMainThread) logger.warn(`Plugin for ${constructed.source} has duplicates and could possibly be unused`);
		lavalinkPlugins.push(constructed);
		if (isMainThread) lavalinkLog(`Loaded plugin for ${constructed.constructor.name}`);
	}
}

if (pushToEnd && isMainThread) lavalinkPlugins.push(pushToEnd);
