import type { IncomingMessage, ServerResponse } from "http";
import type { Readable } from "stream";
import type { WebSocket } from "ws";

export * as Utils from "./server-utils";

export type TrackInfo = {
	title: string;
	author: string;
	identifier: string;
	uri: string;
	length: number;
	isStream: boolean;
};

export type TrackData = {
	entries: Array<TrackInfo>;
	plData?: {
		name: string;
		selectedTrack: number;
	};
};

export type StreamData = {
	type?: string;
	stream: Readable;
};

export type LavaLinkConfig = OptionalDeep<typeof import("./server-dts/Constants")["defaultOptions"]>;

export class Plugin {
	public utils: Utils;
	public version: string;

	public source?: string;
	public searchShorts?: Array<string>;

	public constructor(utils: Utils);

	public initialize?(): any;
	public canBeUsed?(resource: string, searchShort?: string): boolean;
	public infoHandler?(resource: string, searchShort?: string): TrackData | Promise<TrackData>;
	public streamHandler?(info: any, usingFFMPEG: boolean): StreamData | Promise<StreamData>;
	public streamPipeline?(stream: Readable, filters?: Array<string>): StreamData | Promise<StreamData>;
	public onWSMessage?(packet: Record<any, any>, socket: WebSocket): any;
	public routeHandler?(url: URL, req: IncomingMessage, res: ServerResponse): any;
}
