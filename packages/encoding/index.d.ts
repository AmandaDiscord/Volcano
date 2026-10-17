export type TrackInfo = {
	version: number;
	title: string;
	author: string;
	length: bigint;
	identifier: string;
	isStream: boolean;
	uri: string | null;
	artworkUrl: string | null;
	isrc: string | null;
	source: string;
	/** Only the http and local sources have this */
	probeInfo?: { raw: string; name: string; parameters: string | null };
	position: bigint;
};

/** Takes base64 or the raw bytes. Reads track versions 1 through 3 */
export function decode(encoded: string | Buffer): TrackInfo;
/** Always writes version 3, like Lavalink v4. Missing strings get "<no title provided>" style placeholders */
export function encode(track: Partial<TrackInfo>): string;
