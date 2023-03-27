import twitch from "twitch-m3u8";
import m3u8 from "m3u8stream";
import htmlParse from "node-html-parser";
import entities from "html-entities";

import { Plugin } from "volcano-sdk";

const usableRegex = /^https:\/\/(?:www\.)?twitch\.tv/;
const vodRegex = /\/videos\/(\d+)$/;
const channelRegex = /twitch\.tv\/([^/]+)/;

class TwitchSource extends Plugin {
	public source = "twitch";

	public canBeUsed(resource: string) {
		return usableRegex.test(resource);
	}

	public async infoHandler(resource: string) {
		const vod = resource.match(vodRegex);
		if (vod) {
			const data = await twitch.getVod(vod[1]) as Array<import("twitch-m3u8").Stream>;
			if (!data.length) throw new Error("CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD");
			const audioOnly = data.find(d => d.quality === "Audio only");
			const chosen = audioOnly ? audioOnly : data[0];
			const streamerName = chosen.url.split("_").slice(1, audioOnly ? -3 : -2).join("_");
			const res = await fetch(resource, { redirect: "follow", headers: this.utils.Constants.baseHTTPRequestHeaders }).then(r => r.text());
			const parser = htmlParse.default(res);
			const head = parser.getElementsByTagName("head")[0];
			const title = entities.decode(head.querySelector("meta[property=\"og:title\"]")?.getAttribute("content")?.split("-").slice(0, -1).join("-").trim() || `Twitch Stream of ${streamerName}`);
			const duration = +(head.querySelector("meta[property=\"og:video:duration\"]")?.getAttribute("content") || 0) * 1000;
			return {
				entries: [
					{
						title: title,
						author: streamerName,
						uri: resource,
						identifier: resource,
						length: duration,
						isStream: false
					}
				]
			};
		}

		const user = resource.match(channelRegex);
		if (!user) throw new Error("NOT_TWITCH_VOD_OR_CHANNEL_LINK");
		const data = await twitch.getStream(user[1]);
		if (!data.length) throw new Error("CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD");
		const uri = `https://www.twitch.tv/${user[1]}`;
		const res = await fetch(uri, { redirect: "follow", headers: this.utils.Constants.baseHTTPRequestHeaders }).then(r => r.text());
		const parser = htmlParse.default(res);
		const head = parser.getElementsByTagName("head")[0];
		const title = entities.decode(head.querySelector("meta[property=\"og:description\"]")?.getAttribute("content") || `Twitch Stream of ${user[1]}`);
		return {
			entries: [
				{
					title: title,
					author: user[1],
					uri: uri,
					identifier: uri,
					length: 0,
					isStream: true
				}
			]
		};
	}

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo) {
		const vod = info.uri!.match(vodRegex);
		const user = info.uri!.match(channelRegex);
		const streams = await twitch[vod ? "getVod" : "getStream"](vod ? vod[1] : user![1]) as Array<import("twitch-m3u8").Stream>;
		if (!streams.length) throw new Error("CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD");
		const audioOnly = streams.find(d => d.quality === "Audio only");
		const chosen = audioOnly ? audioOnly : streams[0];
		return { stream: m3u8(chosen.url) };
	}
}

export default TwitchSource;
