module.exports.Plugin = class Plugin {
	/** @param {import("./server-dts/util/Util.js")["default"]} utils */
	constructor(utils) {
		this.version = "1.0.0";
		this.utils = utils;
	}
};
