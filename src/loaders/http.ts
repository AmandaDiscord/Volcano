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
			const payload = {
				playlistInfo: {},
				tracks: [] as Array<{ track: string; info: import("@lavalink/encoding").TrackInfo }>
			};

			if (!id || typeof id !== Constants.STRINGS.STRING) return Util.standardErrorHandler(Constants.STRINGS.INVALID_IDENTIFIER, res, payload, lavalinkLog);

			const identifier = entities.decode(id);

			lavalinkLog(`Got request to load for identifier "${identifier}"`);

			const match = identifier.match(IDRegex);
			if (!match) return Util.standardErrorHandler(Constants.STRINGS.IDENTIFIER_DIDNT_MATCH_REGEX, res, payload, lavalinkLog); // Should theoretically never happen, but TypeScript doesn't know this

			const isSearch = !!match[1];
			const resource = match[2];

			if (!resource) return Util.standardErrorHandler(Constants.STRINGS.INVALID_IDENTIFIER, res, payload, lavalinkLog);
			try {
				const searchablePlugin = lavalinkPlugins.find(p => p.searchShort && isSearch && match[1] === p.searchShort);
				if (searchablePlugin && searchablePlugin.canBeUsed?.(resource, true)) {
					if (searchablePlugin.source && lavalinkConfig.lavalink.server.sources[searchablePlugin.source] !== undefined && !lavalinkConfig.lavalink.server.sources[searchablePlugin.source]) return Util.standardErrorHandler(`${searchablePlugin.source} is not enabled`, res, payload, lavalinkLog, Constants.STRINGS.LOAD_FAILED);
					if ((searchablePlugin.source === Constants.STRINGS.YOUTUBE || searchablePlugin.source === Constants.STRINGS.SOUNDCLOUD) && !lavalinkConfig.lavalink.server[`${searchablePlugin.source}SearchEnabled`]) return Util.standardErrorHandler(`${searchablePlugin.source} searching is not enabled`, res, payload, lavalinkLog, Constants.STRINGS.LOAD_FAILED);
					const result = await searchablePlugin.infoHandler?.(resource, true);
					if (result && searchablePlugin.source) assignResults(result, searchablePlugin.source, payload);
				} else {
					const found = lavalinkPlugins.find(p => p.canBeUsed?.(resource, false));
					if (found) {
						if (found.source && lavalinkConfig.lavalink.server.sources[found.source] !== undefined && !lavalinkConfig.lavalink.server.sources[found.source]) return Util.standardErrorHandler(`${found.source} is not enabled`, res, payload, lavalinkLog, Constants.STRINGS.LOAD_FAILED);
						const result = await found.infoHandler?.(resource, false);
						if (result && found.source) assignResults(result, found.source, payload);
					} else {
						const yt = lavalinkPlugins.find(p => p.source === Constants.STRINGS.YOUTUBE)!;
						const result = await yt.infoHandler?.(resource, true);
						if (result) assignResults(result, yt.source!, payload);
					}
				}

				if (payload.tracks.length === 0) return Util.standardErrorHandler(Constants.STRINGS.NO_MATCHES_LOWER, res, payload, lavalinkLog, Constants.STRINGS.NO_MATCHES);
				else if (payload.tracks.length === 1) lavalinkLog(`Loaded track ${payload.tracks[0].info.title}`);
				return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders)
					.end(JSON.stringify(Object.assign({
						loadType: payload.tracks.length > 1 && isSearch ? Constants.STRINGS.SEARCH_RESULT : payload.playlistInfo[Constants.STRINGS.NAME] ? Constants.STRINGS.PLAYLIST_LOADED : Constants.STRINGS.TRACK_LOADED
					}, payload)));
			} catch (e) {
				return Util.standardErrorHandler(e, res, payload, lavalinkLog, Constants.STRINGS.LOAD_FAILED, Constants.STRINGS.COMMON);
			}
		}
	},

	[Constants.STRINGS.DECODETRACKS]: {
		methods: [Constants.STRINGS.GET, Constants.STRINGS.POST],
		async handle(req, res, url) {
			if (req.method === Constants.STRINGS.GET) {
				let track = url.searchParams.get(Constants.STRINGS.TRACK) as string;
				lavalinkLog(`Got request to decode for track "${track}"`);
				if (track) track = entities.decode(track);
				if (!track || typeof track !== Constants.STRINGS.STRING) return res.writeHead(400, "Bad request", Constants.baseHTTPResponseHeaders).end(JSON.stringify({ message: "invalid track" }));
				const data = convertDecodedTrackToResponse(encoding.decode(track));
				return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(data));
			} else {
				const body = await Util.requestBody(req, 10000);
				const array = JSON.parse(body.toString()) as Array<string>;
				return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders).end(JSON.stringify(array.map(t => convertDecodedTrackToResponse(encoding.decode(t)))));
			}
		}
	},

	[Constants.STRINGS.PLUGINS]: {
		methods: [Constants.STRINGS.GET],
		handle(req, res) {
			return res.writeHead(200, Constants.STRINGS.OK, Constants.baseHTTPResponseHeaders)
				.end(JSON.stringify(lavalinkPlugins.filter(p => !lavalinkSources.has(p))
					.map(p => ({
						name: p.constructor?.name || Constants.STRINGS.UNKNOWN,
						version: p.version ?? "0.0.0"
					}))
				));
		},
	},

	"/version": {
		methods: [Constants.STRINGS.GET],
		handle(req, res) {
			return res.writeHead(200, Constants.STRINGS.OK, Object.assign({}, Constants.baseHTTPResponseHeaders, { [Constants.STRINGS.CONTENT_TYPE_CAPPED]: Constants.STRINGS.TEXT_PLAIN })).end(`${lavalinkVersion}_null`);
		},
	}
};

function assignResults(result: Awaited<ReturnType<NonNullable<import("../types.js").Plugin["infoHandler"]>>>, source: string, payload) {
	payload.tracks = result.entries.map(t => ({
		track: encoding.encode(Object.assign({ flags: 1, version: 2, source: source, position: BigInt(0), probeInfo: t[Constants.STRINGS.PROBE_INFO] }, t, { length: BigInt(t.length) })),
		info: Object.assign({ position: 0 }, (() => {
			delete t[Constants.STRINGS.PROBE_INFO];
			return t;
		})())
	}));
	if (result.plData) payload.playlistInfo = result.plData;
}

function convertDecodedTrackToResponse(data: import("@lavalink/encoding").TrackInfo) {
	return {
		identifier: data.identifier,
		isSeekable: !data.isStream,
		author: data.author,
		length: Number(data.length),
		isStream: data.isStream,
		position: Number(data.position),
		title: data.title,
		uri: data.uri,
		sourceName: data.source,
		probeInfo: data.probeInfo
	};
}

export default paths;
