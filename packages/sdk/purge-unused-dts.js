const fs = require("fs");
const path = require("path");

fs.renameSync(path.join(__dirname, "./server-dts/util/Util.d.ts"), path.join(__dirname, "./server-utils.d.ts"));
fs.rmSync(path.join(__dirname, "./server-dts"), { recursive: true });
