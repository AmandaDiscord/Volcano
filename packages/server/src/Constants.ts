import type { LavaLinkConfig } from "volcano-sdk/types.js";

export const defaultOptions = {
	spring: {
		main: {
			"banner-mode": "log"
		}
	},
	server: {
		port: process.env.PORT || 2333,
		address: "0.0.0.0"
	},
	lavalink: {
		server: {
			password: "youshallnotpass",
			youtubeCookie: "",
			sources: {
				youtube: true,
				bandcamp: true,
				soundcloud: true,
				twitch: true,
				http: false,
				local: false
			},
			trackStuckThresholdMs: 10000,
			youtubePlaylistLoadLimit: 6,
			playerUpdateInterval: 5,
			youtubeSearchEnabled: true,
			youtubeTimeout: 12000,
			soundcloudSearchEnabled: true,
			"gc-warnings": true,
			ratelimit: {
				ipBlocks: [],
				excludedIps: [],
				strategy: "RotateOnBan" as "RotateOnBan" | "LoadBalance" | "NanoSwitch" | "RotatingNanoSwitch",
				searchTriggersFail: true,
				retryLimit: -1
			}
		}
	},
	logging: {
		file: {
			"max-history": 30,
			"max-size": "1GB"
		},
		path: "./logs/",
		level: {
			root: "INFO",
			lavalink: "INFO"
		}
	}
} as RequiredObjectDeep<LavaLinkConfig>;

export const baseHTTPResponseHeaders = {
	"Lavalink-Api-Version": "3",
	"Content-Type": "application/json"
};

export const fakeAgent = `Mozilla/5.0 (Server; NodeJS ${process.version.replace("v", "")}; rv:1.0) Magma/1.0 (KHTML, like Gecko) Volcano/1.0`;

export const baseHTTPRequestHeaders = {
	DNT: "1",
	Pragma: "no-cache",
	"Sec-Fetch-Dest": "document",
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Site": "same-site",
	"Sec-Fetch-User": "?1",
	"Upgrade-Insecure-Requests": "1",
	"User-Agent": fakeAgent
};

export const OPCodes = {
	VOICE_UPDATE: "voiceUpdate" as const,
	PLAY: "play" as const,
	STOP: "stop" as const,
	PAUSE: "pause" as const,
	SEEK: "seek" as const,
	FILTERS: "filters" as const,
	DESTROY: "destroy" as const,
	CONFIGURE_RESUMING: "configureResuming" as const,
	VOLUME: "volume" as const,
	DUMP: "dump" as const,
	PING: "ping" as const,

	PLAYER_UPDATE: "playerUpdate" as const,
	STATS: "stats" as const,
	EVENT: "event" as const
};

export const defaultFilterValues: import("lavalink-types").Filters = {
	volume: 1.0,
	equalizer: [
		{
			band: 0,
			gain: 0.2
		}
	],
	karaoke: {
		level: 1.0,
		monoLevel: 1.0,
		filterBand: 220.0,
		filterWidth: 100.0
	},
	timescale: {
		speed: 1.0,
		pitch: 1.0,
		rate: 1.0
	},
	tremolo: {
		frequency: 2.0,
		depth: 0.5
	},
	vibrato: {
		frequency: 2.0,
		depth: 0.5
	},
	rotation: {
		rotationHz: 0
	},
	distortion: {
		sinOffset: 0,
		sinScale: 1,
		cosOffset: 0,
		cosScale: 1,
		tanOffset: 0,
		tanScale: 1,
		offset: 0,
		scale: 1
	},
	channelMix: {
		leftToLeft: 1.0,
		leftToRight: 0.0,
		rightToLeft: 0.0,
		rightToRight: 1.0,
	},
	lowPass: {
		smoothing: 20.0
	}
};

export const workerOPCodes = {
	READY: 1 as const,
	MESSAGE: 2 as const,
	ACKKNOWLEDGE: 4 as const,
	REPLY: 5 as const,
	STATS: 6 as const,
	VOICE_SERVER: 7 as const,
	DELETE_ALL: 8 as const
};

export const VoiceConnectionConnectThresholdMS = 20000;

export const VoiceWSCloseCodes = {
	4001: "You sent an invalid opcode.",
	4002: "You sent a invalid payload in your identifying to the Gateway.",
	4003: "You sent a payload before identifying with the Gateway.",
	4004: "The token you sent in your identify payload is incorrect.",
	4005: "You sent more than one identify payload. Stahp.",
	4006: "Your session is no longer valid.",
	4009: "Your session has timed out.",
	4011: "We can't find the server you're trying to connect to.",
	4012: "We didn't recognize the protocol you sent.",
	4014: "Channel was deleted, you were kicked, voice server changed, or the main gateway session was dropped. Should not reconnect.",
	4015: "The server crashed. Our bad! Try resuming.",
	4016: "We didn't recognize your encryption."
};

export const platformNames = {
	"aix": "AIX",
	"android": "Android",
	"darwin": "Darwin",
	"freebsd": "FreeBSD",
	"haiku": "Haiku",
	"linux": "Linux",
	"openbsd": "OpenBSD",
	"sunos": "SunOS",
	"win32": "Windows",
	"cygwin": "Cygwin",
	"netbsd": "NetBSD"
};

export default { defaultOptions, baseHTTPRequestHeaders, fakeAgent, baseHTTPResponseHeaders, OPCodes, defaultFilterValues, workerOPCodes, VoiceConnectionConnectThresholdMS, VoiceWSCloseCodes, platformNames };
