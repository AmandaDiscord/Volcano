import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

await fs.promises.writeFile(path.join(dirname, "../dist/buildinfo.json"), JSON.stringify({
	build_time: Date.now(),
	branch: process.env.GITHUB_REF_NAME || "unknown",
	commit: process.env.GITHUB_SHA || "unknown"
}), { encoding: "utf8" });

console.log("Generated build info");
