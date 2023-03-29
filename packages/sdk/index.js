module.exports.Plugin = class Plugin {
	version = "1.0.0";

	/** @param {import("./server-dts/util/Util.js")["default"]} utils */
	constructor(utils) {
		this.utils = utils;
	}
};
