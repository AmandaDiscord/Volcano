import { Transform } from "stream";
import { EventEmitter } from "events";
import { Worker } from "worker_threads";

export type Logger = {
	info(message: any, worker?: string): void;
	warn(message: any, worker?: string): void;
	error(message: any, worker?: string): void;
}

export type Mixin<T extends { [key: string | number | symbol]: any }, SR extends Array<{ [key: string | number | symbol]: any }>> = SR extends Array<infer O> ? T & O : never;

export type Utils = {
	noop(): void;
	processLoad(): Promise<number>;
	isObject<T>(value: T): value is Record<any, any>;
	isValidKey(key: string): boolean;
	mixin<T extends Record<string, any>, S extends Array<Record<string, any>>>(target: T, ...sources: S): Mixin<T, S>;
	createTimeoutForPromise<T>(promise: PromiseLike<T>, timeout: number): Promise<T>;
	connect(url: string, opts?: { method?: string, headers?: { [header: string]: any } }): Promise<import("net").Socket>;
	socketToRequest(socket: import("net").Socket): Promise<ConnectionResponse>;
	requestBody(req: import("http").IncomingMessage, timeout?: number): Promise<Buffer>;
	/** An improved JSON.stringify that supports BigInts and Circular references, which can produce bad results and is mostly for logging */
	stringify(data: any, ignoreQuotes?: boolean): string;
	getStats(): Promise<{ players: number, playingPlayers: number, uptime: number, memory: { reservable: number, used: number, free: number, allocated: number }, cpu: { cores: number, systemLoad: number, lavalinkLoad: number }, frameStats: { sent: number, nulled: number, deficit: number } }>
}

export interface ConnectionResponseEvents {
	headers: [ConnectionResponse["headers"]];
	readable: [];
	data: [any];
	end: [];
	close: [];
	error: [Error];
}

export interface ConnectionResponse {
	addListener<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	emit<E extends keyof ConnectionResponseEvents>(event: E, ...args: ConnectionResponseEvents[E]): boolean;
	eventNames(): Array<keyof ConnectionResponseEvents>;
	listenerCount(event: keyof ConnectionResponseEvents): number;
	listeners(event: keyof ConnectionResponseEvents): Array<(...args: Array<any>) => any>;
	off<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	on<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	once<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	prependListener<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	prependOnceListener<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
	rawListeners(event: keyof ConnectionResponseEvents): Array<(...args: Array<any>) => any>;
	removeAllListeners(event?: keyof ConnectionResponseEvents): this;
	removeListener<E extends keyof ConnectionResponseEvents>(event: E, listener: (...args: ConnectionResponseEvents[E]) => any): this;
}

export class ConnectionResponse extends Transform {
	public headers: { [header: string]: string };
	/**
	 * Example: HTTP/1.1 or ICY
	 */
	public protocol: string;
	/**
	 * The HTTP status code like 200
	 */
	public status: number;
	/**
	 * The HTTP message if available, otherwise an empty string
	 */
	public message: string;
}

export type TrackInfo = {
	title: string;
	author: string;
	identifier: string;
	uri: string;
	length: number;
	isStream: boolean;
}

export type TrackData = {
	entries: Array<TrackInfo>,
	plData?: {
		name: string;
		selectedTrack: number;
	}
}

export type StreamData = {
	type?: string;
	stream: import("stream").Readable;
}

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

export class SingleUseMap<K, V> extends Map<K, V> {
	public use(key: K): V | undefined;
}

export class ThreadBasedReplier extends EventEmitter {
	public outgoing:SingleUseMap<string, (value: unknown) => void>;
	public outgoingPersist: Set<string>;
	public lastThreadID: number;

	public nextThreadID(): string;
	public buildRequest(op: number, data: any): { threadID: string; op: number; data: any; };
	public baseRequest(op: number, data: any, sendFn: (data: any) => any): Promise<any>;
}

export type ThreadMessage = {
	op: number;
	data?: any;
}

export interface ThreadPoolEvents {
	message: [number, any];
	spawn: [number, Worker];
	ready: [number, Worker];
	death: [number];
	datareq: [number, any];
}

export interface ThreadPool {
	addListener<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	emit<E extends keyof ThreadPoolEvents>(event: E, ...args: ThreadPoolEvents[E]): boolean;
	eventNames(): Array<keyof ThreadPoolEvents>;
	listenerCount(event: keyof ThreadPoolEvents): number;
	listeners(event: keyof ThreadPoolEvents): Array<(...args: Array<any>) => any>;
	off<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	on<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	once<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	prependListener<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	prependOnceListener<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
	rawListeners(event: keyof ThreadPoolEvents): Array<(...args: Array<any>) => any>;
	removeAllListeners(event?: keyof ThreadPoolEvents): this;
	removeListener<E extends keyof ThreadPoolEvents>(event: E, listener: (...args: ThreadPoolEvents[E]) => any): this;
}

export class ThreadPool extends ThreadBasedReplier {
	public count: number;
	public dir: string;
	public children: Map<number, Worker>;
	public taskSizeMap: Map<number, number>;

	public constructor(options: { size: number; dir: string; })

	public execute(message: ThreadMessage): Promise<any>;
	public dump(): Promise<void>;
	public send(id: number, message: ThreadMessage): Promise<any>;
	public broadcast(message: ThreadMessage): Promise<Array<any>>;
}

export class Plugin {
	public logger: Logger;
	public utils: Utils;
	public version: string;

	public source?: string;
	public searchShorts?: Array<string>;

	public constructor(logger: Logger, utils: Utils);

	public initialize?(): any;
	public canBeUsed?(resource: string, searchShort?: string): boolean;
	public infoHandler?(resource: string, searchShort?: string): TrackData | Promise<TrackData>;
	public streamHandler?(info: any, usingFFMPEG: boolean): StreamData | Promise<StreamData>;
	public streamPipeline?(stream: import("stream").Readable, filters?: Array<string>): StreamData | Promise<StreamData>;
	public onWSMessage?(packet: Record<any, any>, socket: WebSocket): any;
	public routeHandler?(url: URL, req: import("http").IncomingMessage, res: import("http").ServerResponse): any;
}
