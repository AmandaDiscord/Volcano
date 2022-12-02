import { join, dirname } from "path";
import { readFile, writeFile, readdir, stat } from "fs/promises";
import { fileURLToPath } from "url";

import Constants from "../dist/Constants.js";

const _dirname = dirname(fileURLToPath(import.meta.url));

const regex = /Constants\.STRINGS\.([A-Z0-9_]+)/;
const srcDir = join(_dirname, "../src");

recurse(srcDir);

/**
 * @param {string} dir
 * @returns {Promise<void>}
 */
async function recurse(dir) {
	const read = await readdir(dir);
	for (const d of read) {
		const s = await stat(join(dir, d));
		if (s.isDirectory()) await recurse(join(dir, d));
		else await processFile(join(dir, d));
	}
	console.log(`Done with dir ${dir}`);
}

/**
 * @param {string} dir
 */
async function processFile(dir) {
	let file = await readFile(dir, { encoding: "utf8" });

	while (regex.test(file)) {
		file = file.replace(regex, (_, property) => {
			return `"${Constants.STRINGS[property]}"`;
		});
		await writeFile(dir, file);
	}
	console.log(`Done with file ${dir}`);
}
