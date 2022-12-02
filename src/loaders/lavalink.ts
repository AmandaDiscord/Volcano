import path from "path";
import { fileURLToPath } from "url";

global.lavalinkDirname = path.join(path.dirname(fileURLToPath(import.meta.url)));
global.lavalinkPlugins = [];
global.lavalinkSources = new Set();
global.lavalinkVersion = "3.5.1";
global.lavalinkMajor = lavalinkVersion.split(".")[0];

// taken from https://github.com/yarnpkg/berry/blob/2cf0a8fe3e4d4bd7d4d344245d24a85a45d4c5c9/packages/yarnpkg-pnp/sources/loader/applyPatch.ts#L414-L435
// Having Experimental warning show up once is "fine" but it's also printed
// for each Worker that is created so it ends up spamming stderr.
// Since that doesn't provide any value we suppress the warning.
const originalEmit = process.emit;
process.emit = function(name: any, ...args: Array<any>): any {
	const data = args[0];
	if (name === "warning" && typeof data === "object" && data.name === "ExperimentalWarning") return false;
	return originalEmit.apply(process, [name, ...args] as [any, any]);
};

export default { lavalinkPlugins, lavalinkSources, lavalinkVersion, lavalinkMajor, lavalinkDirname };
