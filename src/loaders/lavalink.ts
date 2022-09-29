import path from "path";
import fs from "fs";
import util from "util";
import { isMainThread } from "worker_threads";
import os from "os";
import { fileURLToPath } from "url";

import logger from "../util/Logger.js";
import Constants from "../Constants.js";
import Util from "../util/Util.js";
import ThreadPool from "../util/ThreadPool.js";

import config from "./config.js";

global.lavalinkDirname = path.join(path.dirname(fileURLToPath(import.meta.url)), "../");
global.lavalinkRootLog = logger[config.lavalinkConfig.logging.level.root?.toLowerCase?.()] ?? logger.info;
global.lavalinkLog = logger[config.lavalinkConfig.logging.level.lavalink?.toLowerCase?.()] ?? logger.info;
global.lavalinkPlugins = [];
global.lavalinkSources = new Set();
global.lavalinkVersion = "3.5.1";
global.lavalinkMajor = lavalinkVersion.split(".")[0];
global.lavalinkThreadPool = new ThreadPool({ size: os.cpus().length, dir: path.join(lavalinkDirname, "./worker.js") });

// taken from https://github.com/yarnpkg/berry/blob/2cf0a8fe3e4d4bd7d4d344245d24a85a45d4c5c9/packages/yarnpkg-pnp/sources/loader/applyPatch.ts#L414-L435
// Having Experimental warning show up once is "fine" but it's also printed
// for each Worker that is created so it ends up spamming stderr.
// Since that doesn't provide any value we suppress the warning.
const originalEmit = process.emit;
process.emit = function(name: any, ...args: Array<any>): any {
	const data = args[0];
	if (name === Constants.STRINGS.WARNING && typeof data === Constants.STRINGS.OBJECT && data.name === Constants.STRINGS.EXPERIMENTAL_WARNING) return false;
	return originalEmit.apply(process, [name, ...args] as [any, any]);
};

setTimeout(async () => {
	let pushToEnd: import("volcano-sdk").Plugin | undefined = undefined;

	const sourcesDir = path.join(lavalinkDirname, "./sources");
	for (const file of await fs.promises.readdir(sourcesDir)) {
		if (!file.endsWith(Constants.STRINGS.DOT_JS)) continue;
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
		if (constructed.source === Constants.STRINGS.HTTP && isMainThread) pushToEnd = constructed;
		else lavalinkPlugins.push(constructed);
	}

	const pluginsDir = path.join(lavalinkDirname, "../plugins");
	const isDir = await fs.promises.stat(pluginsDir).then(s => s.isDirectory()).catch(() => false);
	if (isDir) {
		for (const file of await fs.promises.readdir(pluginsDir)) {
			if (!file.endsWith(Constants.STRINGS.DOT_JS)) continue;
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
}, 1000);

export default { lavalinkRootLog, lavalinkLog, lavalinkPlugins, lavalinkSources, lavalinkVersion, lavalinkMajor, lavalinkThreadPool, lavalinkDirname };
