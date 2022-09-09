import twitch from "twitch-m3u8";
import m3u8 from "m3u8stream";

import type { Plugin } from "../types.js";

const usableRegex = /^https:\/\/www\.twitch.\tv/;
const vodRegex = /\/videos\/(\d+)$/;
const channelRegex = /twitch\.tv\/([^/]+)/;

class TwitchSource implements Plugin {
	public source = "twitch";

	public canBeUsed(resource: string) {
		return !!resource.match(usableRegex);
	}

	public async infoHandler(resource: string) {
		const vod = resource.match(vodRegex);
		if (vod) {
			const data = await twitch.getVod(vod[1]) as Array<import("twitch-m3u8").Stream>;
			if (!data.length) throw new Error("CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD");
			const audioOnly = data.find(d => d.quality === "Audio Only");
			const chosen = audioOnly ? audioOnly : data[0];
			const streamerName = chosen.url.split("_").slice(1, audioOnly ? -3 : -2).join("_");
			return {
				entries: [
					{
						title: "Twitch vod",
						author: streamerName,
						uri: resource,
						identifier: resource,
						length: 0,
						isStream: false
					}
				]
			};
		}

		const user = resource.match(channelRegex);
		if (!user) throw new Error("NOT_TWITCH_VOD_OR_CHANNEL_LINK");
		const data = await twitch.getStream(user[1]);
		if (!data.length) throw new Error("CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD");
		return {
			entries: [
				{
					title: "Twitch stream",
					author: user[1],
					uri: `https://www.twitch.tv/$${user[1]}`,
					identifier: `https://www.twitch.tv/$${user[1]}`,
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
		const audioOnly = streams.find(d => d.quality === "Audio Only");
		const chosen = audioOnly ? audioOnly : streams[0];
		return { stream: m3u8(chosen.url) };
	}
}

export default TwitchSource;
