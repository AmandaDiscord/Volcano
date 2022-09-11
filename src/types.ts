type OPCodes = typeof import("./Constants.js")["OPCodes"];

export type Complete<T> = {
	[K in keyof T]-?: Complete<T[K]>;
}

type AnyObject = { [k: string | number | symbol]: any };

export type Mixin<T extends AnyObject, SR extends Array<AnyObject>> = SR extends Array<infer O> ? T & O : never;

export type LavaLinkConfig = {
	server?: {
		port?: number;
		address?: string;
	};
	spring?: {
		main?: {
			"banner-mode"?: "log";
		};
	};
	lavalink?: {
		server?: {
			password?: string;
			youtubeCookie?: string;
			sources?: {
				youtube?: boolean,
				bandcamp?: boolean,
				soundcloud?: boolean,
				twitch?: boolean,
				http?: boolean,
				local?: boolean
			};
			trackStuckThresholdMs: number;
			youtubePlaylistLoadLimit?: number;
			playerUpdateInterval?: number;
			youtubeSearchEnabled?: boolean;
			youtubeTimeout?: number;
			soundcloudSearchEnabled?: boolean;
			"gc-warnings"?: boolean;
			ratelimit?: {
				ipBlocks?: Array<string>;
				excludedIps?: Array<string>;
				strategy?: "RotateOnBan" | "LoadBalance" | "NanoSwitch" | "RotatingNanoSwitch";
				searchTriggersFail?: boolean;
				retryLimit?: number;
			};
		};
	};
	logging?: {
		file?: {
			"max-history"?: number;
			"max-size"?: string;
		};
		path?: string;
		level?: {
			root?: "INFO" | "WARN" | "ERROR";
			lavalink?: "INFO" | "WARN" | "ERROR";
		};
	};
}

export type PlayerFilterOptions = {
	volume?: number;
	equalizer?: Array<PlayerEqualizerBand>;
	karaoke?: PlayerKaraokeOptions;
	timescale?: {
			speed?: number;
			pitch?: number;
			rate?: number;
	};
	tremolo?: {
			frequency?: number;
			depth?: number;
	};
	vibrato?: {
			frequency?: number;
			depth?: number;
	};
	rotation?: {
			rotationHz: number;
	};
	distortion?: {
			sinOffset?: number;
			sinScale?: number;
			cosOffset?: number;
			cosScale?: number;
			tanOffset?: number;
			tanScale?: number;
			offset?: number;
			scale?: number;
	};
	channelMix?: {
			leftToLeft?: number;
			leftToRight?: number;
			rightToLeft?: number;
			rightToRight?: number;
	};
	lowPass?: {
			smoothing: number;
	};
}

export type PlayerKaraokeOptions = {
	level?: number;
	monoLevel?: number;
	filterBand?: number;
	filterWidth?: number;
}

export type PlayerEqualizerBand = {
	band: number;
	gain: number;
}

export type OutboundPayload = {
	op: OPCodes["PLAYER_UPDATE"] | OPCodes["STATS"] | OPCodes["EVENT"];
	track?: string;
	type?: "TrackStartEvent" | "TrackEndEvent" | "TrackExceptionEvent" | "TrackStuckEvent" | "WebSocketClosedEvent";
	guildId?: string;
	code?: number;
	reason?: string;
	byRemote?: boolean;
	state?: {
		time: number;
		position: number;
	}
} & Partial<Stats>;

export type InboundPayload = {
	op: OPCodes["PLAY"] | OPCodes["STOP"] | OPCodes["PAUSE"] | OPCodes["SEEK"] | OPCodes["FILTERS"] | OPCodes["DESTROY"] | OPCodes["CONFIGURE_RESUMING"] | OPCodes["VOICE_UPDATE"] | OPCodes["FFMPEG"] | OPCodes["VOLUME"] | OPCodes["DUMP"] | OPCodes["PING"];
	guildId: string;
	sessionId?: string;
	event?: { token: string; guild_id: string; endpoint: string };
	track?: string;
	startTime?: string;
	endTime?: string;
	volume?: number;
	noReplace?: boolean;
	pause?: boolean;
	position?: number;
	key?: string;
	timeout?: number;
	args?: Array<string>;

	/** added by Volcano for workers. */
	clientID?: string;
	state?: any;
} & Partial<PlayerFilterOptions>;

export type Stats = {
	players: number;
	playingPlayers: number;
	memory: {
		reservable: number;
		used: number
		free: number
		allocated: number;
	};
	frameStats: {
		sent: number;
		deficit: number;
		nulled: number;
	};
	cpu: {
		cores: number;
		systemLoad: number;
		lavalinkLoad: number;
	};
	uptime: number;
};

export type TrackInfo = {
	title: string;
	author: string;
	identifier: string;
	uri: string;
	length: number;
	isStream: boolean;
}

export interface Plugin {
	source?: string;
	searchShort?: string;

	initialize?(): unknown;
	setVariables?(loggr: Pick<typeof import("./util/Logger.js")["default"], "info" | "warn" | "error">): unknown;
	mutateFilters?(filters: Array<string>, options: PlayerFilterOptions): unknown;
	canBeUsed?(resource: string, isResourceSearch: boolean): boolean;
	infoHandler?(resource: string, isResourceSearch: boolean): { entries: Array<TrackInfo>, plData?: { name: string; selectedTrack: number; } } | Promise<{ entries: Array<TrackInfo>, plData?: { name: string; selectedTrack: number; } }>;
	streamHandler?(info: import("@lavalink/encoding").TrackInfo, usingFFMPEG: boolean): { type?: import("@discordjs/voice").StreamType; stream: import("stream").Readable } | Promise<{ type?: import("@discordjs/voice").StreamType; stream: import("stream").Readable }>;
	onWSMessage?(packet: Record<any, any>, socket: import("ws").WebSocket): unknown;
	routeHandler?(url: URL, req: import("http").IncomingMessage, res: import("http").ServerResponse): unknown;
}
