import twitch from "twitch-m3u8";

const vodRegex = /\/videos\/(\d+)$/;
const channelRegex = /twitch\.tv\/([^/]+)/;

async function getTwitchAsSource(resource: string) {
	const vod = resource.match(vodRegex);
	if (vod) {
		const data = await twitch.getVod(vod[1]) as Array<import("twitch-m3u8").Stream>;
		if (!data.length) throw new Error("CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD");
		const audioOnly = data.find(d => d.quality === "Audio Only");
		const chosen = audioOnly ? audioOnly : data[0];
		const streamerName = chosen.url.split("_").slice(1, audioOnly ? -3 : -2).join("_");
		return { title: "Twitch vod", author: streamerName, uri: resource };
	}

	const user = resource.match(channelRegex);
	if (!user) throw new Error("NOT_TWITCH_VOD_OR_CHANNEL_LINK");
	const data = await twitch.getStream(user[1]);
	if (!data.length) throw new Error("CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD");
	return { title: "Twitch stream", author: user[1], uri: `https://www.twitch.tv/$${user[1]}` };
}

export default getTwitchAsSource;
