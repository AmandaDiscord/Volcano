const fs = require("fs");
const path = require("path");

const toDTS = path.join(__dirname, "./server-dts");

if (fs.existsSync(toDTS)) fs.rmSync(toDTS, { recursive: true });
