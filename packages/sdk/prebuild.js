const fs = require("node:fs");
const path = require("node:path");

const toDTS = path.join(__dirname, "./server-dts");

if (fs.existsSync(toDTS)) fs.rmSync(toDTS, { recursive: true });
