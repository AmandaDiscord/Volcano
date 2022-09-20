import fs from "fs";
import path from "path";

import yaml from "yaml";

import Constants from "../Constants.js";
import Util from "../util/Util.js";
import type { LavaLinkConfig } from "../types.js";

const configDir: string = path.join(process.cwd(), "./application.yml");
let cfgparsed: LavaLinkConfig;

if (fs.existsSync(configDir)) {
	const cfgyml: string = await fs.promises.readFile(configDir, { encoding: "utf-8" });
	cfgparsed = yaml.parse(cfgyml);
} else cfgparsed = {};

global.lavalinkConfig = Util.mixin({}, Constants.defaultOptions, cfgparsed) as typeof lavalinkConfig;

export default { lavalinkConfig };
