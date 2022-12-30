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
		await loadPlugin(path.join(pluginsDir, file));
	}
}

export async function loadPlugin(dir: string) {
	let constructed: import("volcano-sdk").Plugin;
	try {
		const module = await import(`file://${dir}`) as { default: typeof import("volcano-sdk").Plugin };
		constructed = new module.default(logger, Util);
		await constructed.initialize?.();
	} catch (e) {
		if (isMainThread) {
			logger.warn(`Plugin from ${dir} had errors when initializing and has been ignored from the plugin list`);
			logger.error(util.inspect(e, false, Infinity, true));
		}
		return;
	}
	if (lavalinkPlugins.find(p => p.source && constructed.source && p.source === constructed.source) && isMainThread) logger.warn(`Plugin for ${constructed.source} has duplicates and could possibly be unused`);
	lavalinkPlugins.push(constructed);
	if (isMainThread) lavalinkLog(`Loaded plugin for ${constructed.constructor.name}`);

	const foundIndex = lavalinkPlugins.findIndex(p => p.source === "http");
	if (foundIndex !== -1) {
		const found = lavalinkPlugins[foundIndex];
		lavalinkPlugins.splice(foundIndex, 1);
		lavalinkPlugins.push(found);
	}
}

if (pushToEnd && isMainThread) lavalinkPlugins.push(pushToEnd);

export default { loadPlugin };
