import repl from "repl";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

import plugins from "./plugins.js";

const pluginManifestDir = path.join(lavalinkDirname, "../plugin-manifest.json");

type PluginManifest = {
	[name: string]: {
		name: string;
		version: string;
		resolved: string;
		dependencies?: { [name: string]: string; };
	}
}

const versionSpecifierRegex = /[\^@]/g;

async function install(url: string) {
	if (!url.endsWith("package.json")) return console.warn("To install a plugin, you must directly link to the package.json file");
	const manifestStr = await fs.promises.readFile(pluginManifestDir, { encoding: "utf-8" });
	const manifest = JSON.parse(manifestStr) as PluginManifest;
	let fetched: any;
	try {
		fetched = await fetch(url).then(res => res.json());
	} catch (e) {
		return console.error(e);
	}
	const existing = Object.values(manifest).find(p => p.name === fetched.name);
	if (existing) {
		existing.dependencies = fetched.dependencies;
		existing.version = fetched.version;
	} else manifest[fetched.name] = { name: fetched.name, version: fetched.version, resolved: url, dependencies: fetched.dependencies };

	const parsed = new URL(url);
	const fileDir = path.join(path.dirname(parsed.pathname), fetched.main);
	parsed.pathname = fileDir;

	const jsFile = await fetch(parsed.toString());
	const installDir = path.join(lavalinkDirname, "../plugins", fetched.main);
	await fs.promises.writeFile(installDir, Buffer.from(await jsFile.arrayBuffer()));
	if (fetched.dependencies) {
		const pkg = JSON.parse(await fs.promises.readFile(path.join(lavalinkDirname, "../package.json"), "utf-8"));
		for (const dep of Object.keys(pkg.dependencies)) delete fetched.dependencies[dep];
		if (Object.keys(fetched.dependencies).length) {
			try {
				await new Promise((res, rej) => {
					const command = process.platform === "win32" ? "npm.cmd" : "npm";
					const child = spawn(command, ["install", (Object.entries(fetched.dependencies) as unknown as [string, string]).map(([d, ver]) => ver.startsWith("github:") ? ver.replace("github:", "") : `${d}@${ver.replace(versionSpecifierRegex, "")}`).join(" ")], { cwd: path.join(lavalinkDirname, "../") });
					child.once("exit", () => res);
					child.once("error", (er) => {
						rej(er);
						child.kill();
					});
				});
			} catch (er) {
				return console.error(er);
			}
		}
		await fs.promises.writeFile(pluginManifestDir, JSON.stringify(manifest, null, 2));
	}

	await plugins.loadPlugin(installDir);

	console.info(`Installed ${fetched.name}@${fetched.version}`);
}

async function customEval(input: string, _context: import("vm").Context, _filename: string, callback: (err: Error | null, result: unknown) => unknown) {
	const split = input.replace("\n", "").split(" ");
	const command = split[0];
	const afterCommand = split.slice(1).join(" ");

	if (command === "exit") return callback(null, process.exit());
	else if (command === "installplugin") return install(afterCommand);
	else if (command === "reinstallall") {
		const manifestStr = await fs.promises.readFile(pluginManifestDir, { encoding: "utf-8" });
		const manifest = JSON.parse(manifestStr) as PluginManifest;
		for (const plugin of Object.values(manifest)) {
			if (plugin.resolved.startsWith("builtin:")) continue;
			await install(plugin.resolved);
		}
	} else callback(null, "unknown command");
}

const cli = repl.start({ prompt: "", eval: customEval, writer: s => s });
cli.once("exit", () => process.exit());
