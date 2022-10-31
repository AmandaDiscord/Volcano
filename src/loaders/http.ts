import entities from "html-entities";

import * as encoding from "@lavalink/encoding";

import Constants from "../Constants.js";
import Util from "../util/Util.js";

const IDRegex = /(?:(\w{1,4})search:)?(.+)/;

export type Path = {
	methods: Array<string>;
	handle(req: import("http").IncomingMessage, res: import("http").ServerResponse, url: URL): any;
}

const paths: {
	[path: string]: Path;
} = {
	[Constants.STRINGS.SLASH]: {
		methods: [Constants.STRINGS.GET],
		handle(req, res) {
			return res.writeHead(200, Constants.STRINGS.OK, Object.assign({}, Constants.baseHTTPResponseHeaders, { [Constants.STRINGS.CONTENT_TYPE_CAPPED]: Constants.STRINGS.TEXT_PLAIN }))
				.end(Constants.STRINGS.OK_BOOMER);
		},
	},

	[Constants.STRINGS.LOADTRACKS]: {
		methods: [Constants.STRINGS.GET],
		async handle(req, res, url) {
			const id = url.searchParams.get(Constants.STRINGS.IDENTIFIER);
			const payload: import("lavalink-types").TrackLoadingResult = {
				loadType: Constants.STRINGS.NO_MATCHES,
				tracks: []
			};

			if (!id || typeof id !== Constants.STRINGS.STRING) return Util.standardErrorHandler(Constants.STRINGS.INVALID_IDENTIFIER, res, payload);

			const identifier = entities.decode(id);

			lavalinkLog(`Got request to load for identifier "${identifier}"`);

			const match = identifier.match(IDRegex);
			if (!match) return Util.standardErrorHandler(Constants.STRINGS.IDENTIFIER_DIDNT_MATCH_REGEX, res, payload); // Should theoretically never happen, but TypeScript doesn't know this

			const isSearch = !!match[1];
			const resource = match[2];

			if (!resource) return Util.standardErrorHandler(Constants.STRINGS.INVALID_IDENTIFIER, res, payload);
			try {
				const searchablePlugin = lavalinkPlugins.find(p => p.canBeUsed?.(resource, match[1] || undefined));
				if (searchablePlugin) {
					if (searchablePlugin.source && lavalinkConfig.lavalink.server.sources[searchablePlugin.source] === false) return Util.standardErrorHandler(`${searchablePlugin.source} is not enabled`, res, payload);
					if (searchablePlugin.source && lavalinkConfig.lavalink.server[`${searchablePlugin.source}SearchEnabled`] === false) return Util.standardErrorHandler(`${searchablePlugin.source} searching is not enabled`, res, payload);
					const result = await searchablePlugin.infoHandler?.(resource, match[1] || undefined);
					if (result && searchablePlugin.source) assignResults(result, searchablePlugin.source, payload);
				} else {
					const yt = lavalinkPlugins.find(p => p.source === Constants.STRINGS.YOUTUBE)!;
					const result = await yt.infoHandler?.(resource, Constants.STRINGS.YT);
					if (result) assignResults(result, yt.source!, payload);
				}

				if (payload.tracks.length === 0) {
					delete payload.playlistInfo;
					return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
				}
				else if (payload.tracks.length === 1) lavalinkLog(`Loaded track ${payload.tracks[0].info.title}`);
				payload.loadType = (payload.tracks.length > 0 && isSearch)
					? Constants.STRINGS.SEARCH_RESULT
					: (payload.playlistInfo ? Constants.STRINGS.PLAYLIST_LOADED : Constants.STRINGS.TRACK_LOADED);
				return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
			} catch (e) {
				return Util.standardErrorHandler(e, res, payload);
			}
		}
	},

	[Constants.STRINGS.DECODETRACK]: {
		methods: [Constants.STRINGS.GET],
		handle(req, res, url) {
			let track = url.searchParams.get(Constants.STRINGS.TRACK);
			lavalinkLog(`Got request to decode for track "${track}"`);
			if (track) track = entities.decode(track);
			if (!track || typeof track !== Constants.STRINGS.STRING) return res.writeHead(400, "Bad request", Constants.baseHTTPResponseHeaders).end(JSON.stringify({ message: "invalid track" }));
			const data = convertDecodedTrackToResponse(encoding.decode(track));
			return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(data));
		}
	},

	[Constants.STRINGS.DECODETRACKS]: {
		methods: [Constants.STRINGS.POST],
		async handle(req, res) {
			const body = await Util.requestBody(req, 10000);
			const array = JSON.parse(body.toString()) as Array<string>;
			const data = array.map(t => convertDecodedTrackToResponse(encoding.decode(t)));
			return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(data));
		}
	},

	[Constants.STRINGS.PLUGINS]: {
		methods: [Constants.STRINGS.GET],
		handle(req, res) {
			const payload: Array<import("lavalink-types").PluginMeta> = lavalinkPlugins.filter(p => !lavalinkSources.has(p))
				.map(p => ({
					name: p.constructor?.name || Constants.STRINGS.UNKNOWN,
					version: p.version ?? "0.0.0"
				}));

			return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders)
				.end(JSON.stringify(payload));
		},
	},

	"/version": {
		methods: [Constants.STRINGS.GET],
		handle(req, res) {
			return res.writeHead(200, Constants.STRINGS.OK, Object.assign({}, Constants.baseHTTPResponseHeaders, { [Constants.STRINGS.CONTENT_TYPE_CAPPED]: Constants.STRINGS.TEXT_PLAIN })).end(`${lavalinkVersion}_null`);
		},
	}
};

function assignResults(result: Awaited<ReturnType<NonNullable<import("volcano-sdk").Plugin["infoHandler"]>>>, source: string, payload: import("lavalink-types").TrackLoadingResult) {
	payload.tracks = result.entries.map(t => ({
		track: encoding.encode(Object.assign({ flags: 1, version: 2, source: source, position: BigInt(0), probeInfo: t[Constants.STRINGS.PROBE_INFO] }, t, { length: BigInt(t.length) })),
		info: Object.assign({ position: 0 }, (() => {
			delete t[Constants.STRINGS.PROBE_INFO];
			return Object.assign({}, t, { isSeekable: !t.isStream, sourceName: source }) as typeof t & { isSeekable: boolean; sourceName: string; };
		})())
	}));
	if (result.plData) payload.playlistInfo = result.plData;
}

function convertDecodedTrackToResponse(data: import("@lavalink/encoding").TrackInfo): import("lavalink-types").TrackInfo {
	return {
		identifier: data.identifier,
		isSeekable: !data.isStream,
		author: data.author,
		length: Number(data.length),
		isStream: data.isStream,
		position: Number(data.position),
		title: data.title,
		uri: data.uri,
		sourceName: data.source
	};
}

export default paths;
