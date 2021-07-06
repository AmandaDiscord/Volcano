declare class Downloader {
	public static downloadHLS(url: string, options?: import("m3u8stream").Options): Promise<import("m3u8stream").Stream>;
	public static downloadProgressive(url: string, options?: import("http").RequestOptions): Promise<import("http").IncomingMessage>;
}

declare module "soundcloud-scraper" {
	type ClientOptions = {
		fetchAPIKey?: boolean;
	}

	export class Client {
		public API_KEY: string | null;
		public options: ClientOptions;

		public constructor(API_KEY?: string | null, ClientOptions?: ClientOptions);

		public apiVersion(force?: boolean): Promise<string | null>;
		public getSongInfo(url: string, options?: { fetchEmbed?: boolean; fetchComments?: boolean; fetchStreamURL: boolean; requestOptions?: RequestInit }): Promise<Song>;
		public getPlaylist(url: string, options?: { fetchEmbed?: boolean }): Promise<Playlist>;
		public search(query: string, type?: "all" | "artist" | "playlist" | "track"): Promise<Array<{ index: number; artist: string | null; url: string; itemName: string; name: string; type: "unknown" | "artist" | "playlist" | "track" }>>;
		public getUser(username: string): Promise<{ urn: number; username: string; name: string; verified: boolean; createdAt: Date; avatarURL: string | null; profile: string; bannerURL: string | null; followers: number; following: number; likesCount: number; tracksCount: number; tracks: Array<{ title: string; url: string; publishedAt: Date; genre: string; author: string; duration: number; }>; likes: Array<{ title: string; url: string; publishedAt: Date; author: { name?: string; username?: string; profile?: string } }> }>;
		public getEmbed(embedURL: string): Promise<Embed>;
		public createAPIKey(KEY: string | null, fetch?: boolean): Promise<void>;
		public fetchStreamURL(trackURL: string): Promise<string | null>;
	}

	class Song {
		public id: string;
		public title: string;
		public description: string;
		public thumbnail: string;
		public url: string;
		public duration: number;
		public playCount: number;
		public commentsCount: number;
		public likes: number;
		public genre: string | null;
		public author: { name: string | null; username: string | null; url: string | null; avatarURL: string | null; urn: number; verified: boolean; followers: number; following: number };
		public publishedAt: Date | null;
		public embedURL: string | null;
		public embed: Embed | null;
		public streams: { hls: string | null; progressive: string | null };
		public trackURL: string | null;
		public comments: Array<{ text: string; createdAt: Date; author: { name?: string; username?: string; url?: string } }>;
		public streamURL: string | null;
		public _raw: any;

		public constructor(data: any);

		public readonly age: number;
		public readonly publishedTimestamp: number;

		public _patch(data: any): void;

		public downloadHLS(options?: any): Promise<import("m3u8Stream").Stream>;
		public downloadProgressive(options?: import("http").RequestOptions): Promise<import("http").IncomingMessage>;
		public toJSON(): any;
		public toString(): string;
	}

	type Playlist = {
		id: number;
		title: string;
		url: string;
		description: string;
		thumbnail: string;
		author: { name: string; username: string; urn: number; profile: string; verified: boolean };
		embedURL: string;
		embed: string | null;
		genre: string;
		trackCount: number;
		tracks: Array<Song>;
	};

	class Embed {
		public url: string | null;
		public version: number;
		public type: string;
		public provider: { name: string; url: string };
		public height: number | null;
		public width: number | null;
		public title: string | null;
		public description: string | null;
		public author: { name: string | null; url: string | null };
		public thumbnailURL: string | null;
		public _raw: any;

		public constructor(data: any, embedURL?: string | null);

		public readonly visualizer: string;

		public _patch(data: any): void;

		public toHTML(): string;
		public toJSON(): any;
		public toString(): string;
	}

	export class Util {
		public static last<T extends Array<any>>(arr: T): T extends Array<infer P> ? P : never;
		public static validateURL(url?: string | null, type?: "all" | "track" | "playlist" | "artist"): boolean;
		public static request(url?: RequestInfo | null, options?: RequestInit): Promise<Response>;
		public static parseHTML(url?: RequestInfo | null, options?: RequestInit): Promise<string>;
		public static loadHTML(html?: string | null): import("cheerio").CheerioAPI;
		public static parseComments(commentSection: string): Array<{ text: string; createdAt: Date; author: { name?: string; username?: string; url?: string } }>;
		public static parseDuration(duration: string): number;
		public static fetchSongStreamURL(songURL: string, clientID: string | null): Promise<string>;
		public static keygen(force?: boolean): Promise<string | null>;
	}

	export const keygen: typeof Util.keygen;

	export const validateURL: typeof Util.validateURL;

	export const version: number;

	export const Constants: {
		SOUNDCLOUD_BASE_URL: string;
		SOUNDCLOUD_API_VERSION: string;
		SOUNDCLOUD_URL_REGEX: RegExp;
		SOUNDCLOUD_KEYGEN_URL_REGEX: RegExp;
		SOUNDCLOUD_API_KEY_REGEX: RegExp;
		REGEX_TRACK: RegExp;
		REGEX_SET: RegExp;
		REGEX_ARTIST: RegExp;
		STREAM_FETCH_HEADERS: {
			"User-Agent": string;
			Accept: string;
			"Accept-Encoding": string;
		};
		USER_URN_PATTERN: RegExp;
		STREAM_ERRORS: {
			401: string;
			404: string;
		};
	};

	export const Store: typeof Map;

	export const StreamDownloader: typeof Downloader;
}
