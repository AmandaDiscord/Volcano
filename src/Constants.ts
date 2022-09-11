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
} as import("./types.js").Complete<import("./types.js").LavaLinkConfig>;

export const baseHTTPResponseHeaders = {
	"Lavalink-Api-Version": 3,
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
	FFMPEG: "ffmpeg" as const,
	VOLUME: "volume" as const,
	DUMP: "dump" as const,
	PING: "ping" as const,

	PLAYER_UPDATE: "playerUpdate" as const,
	STATS: "stats" as const,
	EVENT: "event" as const
};

export const defaultFilterValues: import("./types.js").PlayerFilterOptions = {
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
	CLOSE: 3 as const,
	ACKKNOWLEDGE: 4 as const,
	REPLY: 5 as const,
	STATS: 6 as const,
	VOICE_SERVER: 7 as const,
	DELETE_ALL: 8 as const
};

export const VoiceConnectionConnectThresholdMS = 20000;

export const STRINGS = {
	STAR: "*",
	FOLLOW: "follow" as const,
	CONTENT_TYPE: "content-type",
	CONTENT_TYPE_CAPPED: "Content-Type",
	CONTENT_LENGTH: "content-length",
	UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
	APPLICATION: "application",
	OGG: "ogg",
	APPLICATION_X_MPEG_URL: "application/x-mpegURL",
	X_MPEG_URL: "x-mpegURL",
	ICY_HEADER_DASH: "icy-",
	TRANSFER_ENCODING: "transfer-encoding",
	CHUNKED: "chunked",
	ICY_DESCRIPTION: "icy-description",
	ICY_NAME: "icy-name",
	TIMEOUT_REACHED: "Timeout reached",
	NO_BODY: "NO_BODY",
	UNKNOWN_TITLE: "Unknown title",
	UNKNOWN_AUTHOR: "Unknown author",
	DOT_M3U8: ".m3u8",
	INVALID_STREAM_RESPONSE: "INVALID_STREAM_RESPONSE",
	HTTP: "http",
	LOCAL: "local",
	SOUNDCLOUD: "soundcloud",
	TWITCH: "twitch",
	SC: "sc",
	YOUTUBE: "youtube",
	YT: "yt",
	FILE_NOT_EXISTS: "FILE_NOT_EXISTS",
	PATH_NOT_FILE: "PATH_NOT_FILE",
	DOT: ".",
	EMPTY_STRING: "",
	NO_FILE_EXTENSION: "NO_FILE_EXTENSION",
	SOUNDCLOUD_NOT_FETCHABLE_RESOURCE: "SOUNDCLOUD_NOT_FETCHABLE_RESOURCE",
	TRACKS: "tracks" as const,
	TRACK: "track" as const,
	PLAYLIST: "playlist" as const,
	HLS: "hls",
	O_COLON: "O:",
	UNKNOWN: "unknown",
	NO_SOUNDCLOUD_SONG_STREAM_URL: "NO_SOUNDCLOUD_SONG_STREAM_URL",
	CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD: "CANNOT_EXTRACT_TWITCH_INFO_FROM_VOD",
	AUDIO_ONLY: "Audio only",
	UNDERSCORE: "_",
	TWITCH_VOD: "Twitch vod",
	NOT_TWITCH_VOD_OR_CHANNEL_LINK: "NOT_TWITCH_VOD_OR_CHANNEL_LINK",
	TWITCH_STREAM: "Twitch stream",
	GET_VOD: "getVod" as const,
	GET_STREAM: "getStream" as const,
	VIDEO: "video" as const,
	NO_PLAYLIST: "NO_PLAYLIST",
	LIST: "list",
	FL_UNDERSCORE: "FL_",
	FL_CANNOT_BE_FETCHED: "Favorite list playlists cannot be fetched.",
	PL: "PL",
	INDEX: "index",
	STRING: "string" as const,
	BIGINT: "bigint" as const,
	OBJECT: "object" as const,
	CIRCULAR: "[Circular]",
	COMMA: ",",
	WARN: "warn" as const,
	ERROR: "error" as const,
	INFO: "info" as const,
	T: "T",
	Z: "Z",
	SPACE: " ",
	MAIN: "main",
	SPAWN: "spawn" as const,
	MESSAGE: "message" as const,
	NEW_THREAD_EXISTS_IN_POOL: "NEW_THREAD_EXISTS_IN_POOL",
	READY: "ready" as const,
	THREAD_DID_NOT_COMMUNICATE_READY: "THREAD_DID_NOT_COMMUNICATE_READY",
	DATA_REQ: "datareq" as const,
	EXIT: "exit" as const,
	PATH_UP: "../",
	THREAD_NOT_IN_POOL: "THREAD_NOT_IN_POOL",
	WORKER_NOT_TERMINATED_IN_TIME: "Worker did not terminate in time. Heap snapshot written",
	DEATH: "death" as const,
	LOAD_FAILED: "LOAD_FAILED" as const,
	NO_MATCHES: "NO_MATCHES" as const,
	NO_MATCHES_LOWER: "No matches.",
	COMMON: "COMMON" as const,
	OK: "OK",
	NEW_LINE: "\n",
	FUNCTION: "function" as const,
	PROTO: "__proto__",
	CONSTRUCTOR: "constructor",
	PROTOTYPE: "prototype",
	UTF8: "utf-8" as const,
	IS_VOLCANO_HEADER: "Is-Volcano: true",
	USER_ID: "user-id" as const,
	RESUME_KEY: "resume-key" as const,
	CONNECTION: "connection" as const,
	CONNECTION_SUCCESSFULLY_ESTABLISHED: "Connection successfully established",
	IS_ALIVE: "isAlive" as const,
	STATS: "stats" as const,
	PONG: "pong" as const,
	CLOSE: "close" as const,
	SLASH: "/",
	UNAUTHORIZED: "Unauthorized",
	TEXT_PLAIN: "text/plain",
	GET: "GET",
	OK_BOOMER: "Ok boomer.",
	LOADTRACKS: "/loadtracks",
	IDENTIFIER: "identifier",
	INVALID_IDENTIFIER: "Invalid or no identifier query string provided.",
	IDENTIFIER_DIDNT_MATCH_REGEX: "Identifier did not match regex",
	PROBE_INFO: "probeInfo" as const,
	SEARCH_RESULT: "SEARCH_RESULT" as const,
	NAME: "name",
	PLAYLIST_LOADED: "PLAYLIST_LOADED",
	TRACK_LOADED: "TRACK_LOADED",
	DECODETRACKS: "/decodetracks",
	INVALID_TRACK: "Invalid or no track query string provided.",
	NOT_FOUND: "Not Found",
	DOT_JS: ".js",
	STATE_CHANGE: "stateChange" as const,
	EVENT: "event" as const,
	WEBSOCKET_CLOSE_EVENT: "WebSocketCloseEvent",
	FINISHED: "FINISHED",
	TRACK_END_EVENT: "TrackEndEvent",
	TRACK_START_EVENT: "TrackStartEvent",
	TRACK_EXCEPTION_EVENT: "TrackExceptionEvent",
	TRACK_STUCK_EVENT: "TrackStuckEvent",
	SEARCH_STRING: "-ss",
	AUDIO_FILTERS: "-af",
	S16LE: "s16le" as const,
	REPLACED: "REPLACED",
	STOPPED: "STOPPED",
	ZERO: "0",
	ONE_HUNDRED: "100",
	WARNING: "warning",
	EXPERIMENTAL_WARNING: "ExperimentalWarning",
	NO_REPLACE_SKIP: "Skipping play request because of noReplace"
};

export default { defaultOptions, baseHTTPRequestHeaders, fakeAgent, baseHTTPResponseHeaders, OPCodes, defaultFilterValues, workerOPCodes, VoiceConnectionConnectThresholdMS, STRINGS };
