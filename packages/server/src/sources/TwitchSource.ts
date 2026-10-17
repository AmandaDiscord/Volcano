import twitch from "twitch-m3u8";
import m3u8 from "m3u8stream";
import { parse } from "node-html-parser";
import * as entities from "html-entities";

import { Plugin } from "volcano-sdk";

const usableRegex = /^https:\/\/(?:www\.)?twitch\.tv/;
const vodRegex = /\/videos\/(\d+)$/;
const channelRegex = /twitch\.tv\/([^/]+)/;

/** twitch-m3u8 throws a TypeError when Twitch has no token for the name and a 404 error when the channel is offline. Lavalink finds nothing for both */
const noStream = (e: Error): Array<import("twitch-m3u8").Stream> => {
	if (e instanceof TypeError || e.message.includes("offline")) return [];
	throw e;
};

class TwitchSource extends Plugin {
	public source = "twitch";

	public canBeUsed(resource: string) {
		return usableRegex.test(resource);
	}

	public async infoHandler(resource: string) {
		const vod = vodRegex.exec(resource);
		if (vod) {
			const data = await (twitch.getVod(vod[1]) as Promise<Array<import("twitch-m3u8").Stream>>).catch(noStream);
			if (!data.length) return { entries: [] };
			const audioOnly = data.find(d => d.quality === "Audio only");
			const chosen = audioOnly ?? data[0];
			const streamerName = chosen.url.split("_").slice(1, audioOnly ? -3 : -2).join("_");
			const res = await fetch(resource, { redirect: "follow", headers: this.utils.Constants.baseHTTPRequestHeaders }).then(r => r.text());
			const parser = parse(res);
			const head = parser.getElementsByTagName("head")[0];
			const title = entities.decode(head.querySelector("meta[property=\"og:title\"]")?.getAttribute("content")?.split("-").slice(0, -1).join("-").trim() ?? `Twitch Stream of ${streamerName}`);
			const duration = +(head.querySelector("meta[property=\"og:video:duration\"]")?.getAttribute("content") ?? 0) * 1000;
			return {
				entries: [
					{
						title: title,
						author: streamerName,
						uri: resource,
						identifier: resource,
						length: duration,
						isStream: false,
						artworkUrl: head.querySelector("meta[property=\"og:image\"]")?.getAttribute("content") ?? null
					}
				]
			};
		}

		const user = channelRegex.exec(resource);
		if (!user) throw new Error("The provided link was not to a user or a vod");
		const data = await (twitch.getStream(user[1]) as Promise<Array<import("twitch-m3u8").Stream>>).catch(noStream);
		if (!data.length) return { entries: [] };
		const uri = `https://www.twitch.tv/${user[1]}`;
		const res = await fetch(uri, { redirect: "follow", headers: this.utils.Constants.baseHTTPRequestHeaders }).then(r => r.text());
		const parser = parse(res);
		const head = parser.getElementsByTagName("head")[0];
		const title = entities.decode(head.querySelector("meta[property=\"og:description\"]")?.getAttribute("content") ?? `Twitch Stream of ${user[1]}`);
		return {
			entries: [
				{
					title: title,
					author: user[1],
					uri: uri,
					identifier: uri,
					length: 0,
					isStream: true,
					artworkUrl: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${user[1].toLowerCase()}-440x248.jpg`
				}
			]
		};
	}

	public async streamHandler(info: import("volcano-encoding").TrackInfo) {
		const vod = vodRegex.exec(info.uri!);
		const user = channelRegex.exec(info.uri!);
		const streams = await twitch[vod ? "getVod" : "getStream"](vod ? vod[1] : user![1]) as Array<import("twitch-m3u8").Stream>;
		if (!streams.length) throw new Error("There were no available streams for playback");
		const audioOnly = streams.find(d => d.quality === "Audio only");
		const chosen = audioOnly ?? streams[0];
		return { stream: m3u8(chosen.url) };
	}
}

export default TwitchSource;
