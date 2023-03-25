module.exports.Plugin = class Plugin {
	/** @param {import("./types").Utils} utils */
	constructor(utils) {
		this.version = "1.0.0";
		this.utils = utils;
	}
};
