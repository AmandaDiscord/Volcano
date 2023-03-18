import fs from "fs";
import path from "path";

import entities from "html-entities";

import * as encoding from "@lavalink/encoding";

import Constants from "../Constants.js";
import Util from "../util/Util.js";

import { lavalinkMajor, lavalinkVersion } from "./lavalink.js";

import type { TrackLoadingResult, DecodeTrackResult, DecodeTracksResult, Track, GetPlayersResult, GetPlayerResult, UpdatePlayerData, UpdateSessionData, GetLavalinkInfoResult, GetLavalinkStatsResult } from "lavalink-types";

const IDRegex = /(?:(\w{1,4})search:)?(.+)/;

export type Path = {
	methods: Array<string>;
	handle(req: import("http").IncomingMessage, res: import("http").ServerResponse, url: URL): any;
}

const paths: {
	[path: string]: Path;
} = {
	[`/v${lavalinkMajor}/loadtracks`]: {
		methods: ["GET"],
		async handle(req, res, url) {
			const id = url.searchParams.get("identifier");
			const payload: TrackLoadingResult = {
				loadType: "NO_MATCHES",
				tracks: []
			};

			if (!id || typeof id !== "string") return Util.standardTrackLoadingErrorHandler("Invalid or no identifier query string provided.", res, payload);

			const identifier = entities.decode(id);

			const match = identifier.match(IDRegex);
			if (!match) {
				console.log(`Got request to load for identifier "${identifier}"`);
				return Util.standardTrackLoadingErrorHandler("Identifier did not match regex", res, payload, "FAULT"); // Should theoretically never happen, but TypeScript doesn't know this
			}

			const isSearch = !!match[1];
			const resource = match[2];

			if (!resource) return Util.standardTrackLoadingErrorHandler("Invalid or no identifier query string provided.", res, payload);
			console.log(`Got request to load for identifier "${resource}"`);
			try {
				const searchablePlugin = lavalinkPlugins.find(p => p.canBeUsed?.(resource, match[1] || undefined));
				if (searchablePlugin) {
					if (searchablePlugin.source && lavalinkConfig.lavalink.server.sources[searchablePlugin.source] === false) return Util.standardTrackLoadingErrorHandler(`${searchablePlugin.source} is not enabled`, res, payload);
					if (searchablePlugin.source && lavalinkConfig.lavalink.server[`${searchablePlugin.source}SearchEnabled`] === false) return Util.standardTrackLoadingErrorHandler(`${searchablePlugin.source} searching is not enabled`, res, payload);
					const result = await searchablePlugin.infoHandler?.(resource, match[1] || undefined);
					if (result && searchablePlugin.source) assignResults(result, searchablePlugin.source, payload);
				}

				if (payload.tracks.length === 0) {
					delete payload.playlistInfo;
					return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
				}
				else if (payload.tracks.length === 1) console.log(`Loaded track ${payload.tracks[0].info.title}`);
				payload.loadType = (payload.tracks.length > 0 && isSearch)
					? "SEARCH_RESULT"
					: (payload.playlistInfo ? "PLAYLIST_LOADED" : "TRACK_LOADED");
				return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
			} catch (e) {
				return Util.standardTrackLoadingErrorHandler(e, res, payload);
			}
		}
	},

	[`/v${lavalinkMajor}/decodetrack`]: {
		methods: ["GET"],
		handle(req, res, url) {
			let track = url.searchParams.get("track");
			if (track) {
				console.log(`Got request to decode for track "${track}"`);
				track = entities.decode(track);
			}
			if (!track || typeof track !== "string") return Util.createErrorResponse(res, 400, url, "invalid track");
			const data: DecodeTrackResult = convertDecodedTrackToResponse(track, encoding.decode(track));
			return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(data));
		}
	},

	[`/v${lavalinkMajor}/decodetracks`]: {
		methods: ["POST"],
		async handle(req, res, url) {
			if (req.headers["content-type"] !== "application/json") return Util.createErrorResponse(res, 415, url, "Content-Type must be application/json");
			const body = await Util.wrapRequestBodyToErrorResponse(req, res, url);
			if (!body) return;
			const array = JSON.parse(body.toString()) as Array<string>;
			const data: DecodeTracksResult = array.map(t => convertDecodedTrackToResponse(t, encoding.decode(t)));
			return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(data));
		}
	},

	[`/v${lavalinkMajor}/info`]: {
		methods: ["GET"],
		async handle(req, res) {
			const [major, minor, patchStr] = lavalinkVersion.split(".");
			const [patch, build] = patchStr.split("_");
			const buildInfo = await fs.promises.readFile(path.join(lavalinkDirname, "buildinfo.json"), "utf-8").then(JSON.parse).catch(() => ({
				build_time: null,
				branch: "unknown",
				commit: "unknown"
			})) as {
				build_time: number | null;
				branch: string;
				commit: string;
			};
			const pkg = await fs.promises.readFile(path.join(lavalinkDirname, "../package.json"), "utf-8").then(JSON.parse);
			const payload: GetLavalinkInfoResult = {
				version: {
					semver: lavalinkVersion,
					major: Number(major),
					minor: Number(minor),
					patch: Number(patch),
					preRelease: build ?? null
				},
				buildTime: buildInfo.build_time ?? 0,
				git: {
					branch: buildInfo.branch,
					commit: buildInfo.commit,
					commitTime: buildInfo.build_time ?? 0
				},
				jvm: process.version.replace("v", ""),
				lavaplayer: pkg.dependencies["play-dl"].replace("^", ""),
				filters: ["volume", "equalizer", "timescale", "tremolo", "vibrato", "rotation", "lowPass"],
				sourceManagers: lavalinkPlugins.filter(p => p.source).map(p => p.source!),
				plugins: lavalinkPlugins.filter(p => !lavalinkSources.has(p)).map(p => ({
					name: p.constructor?.name || "unknown",
					version: p.version ?? "0.0.0"
				}))
			};
			return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
		}
	},

	[`/v${lavalinkMajor}/stats`]: {
		methods: ["GET"],
		async handle(req, res) {
			const payload = await Util.getStats() as unknown as GetLavalinkStatsResult;
			payload.frameStats = null;
			return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
		}
	},

	"/version": {
		methods: ["GET"],
		handle(req, res) {
			return res.writeHead(200, Object.assign({}, Constants.baseHTTPResponseHeaders, { "Content-Type": "text/plain" })).end(`${lavalinkVersion}_null`);
		}
	}
};

const routes: {
	[route: string]: {
		methods: Array<string>;
		router: (req: import("http").IncomingMessage, res: import("http").ServerResponse, url: URL, params: { [param: string]: string }) => any;
	}
} = {
	[`/v${lavalinkMajor}/sessions/:sessionID/players`]: {
		methods: ["GET"],
		async router(req, res, url, { sessionID }) {
			const websocket = await import("./websocket.js");
			if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(res, 404, url, "Session not found");
			const queues = await websocket.getQueuesForSession(sessionID);
			const payload: GetPlayersResult = queues.map(q => {
				const decodedTrack = q.track ? encoding.decode(q.track.track) : undefined;
				return {
					guildId: q.guildID,
					track: decodedTrack ? {
						encoded: q.track!.track,
						info: {
							identifier: decodedTrack.identifier,
							isSeekable: !decodedTrack.isStream,
							author: decodedTrack.author,
							length: Number(decodedTrack.length),
							isStream: decodedTrack.isStream,
							position: Number(decodedTrack.position),
							title: decodedTrack.title,
							uri: decodedTrack.uri,
							sourceName: decodedTrack.source
						}
					} : null,
					volume: q.actions.volume,
					paused: q.actions.paused,
					filters: q.filtersObject,
					voice: {
						// @ts-expect-error
						token: q.connection.packets.server?.token ?? "",
						// @ts-expect-error
						endpoint: q.connection.packets.server?.endpoint ?? "",
						// @ts-expect-error
						sessionId: q.connection.packets.state?.session_id ?? "",
						connected: q.state.connected,
						ping: q.state.ping
					}
				};
			});
			return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
		},
	},
	[`/v${lavalinkMajor}/sessions/:sessionID/players/:guildID`]: {
		methods: ["GET", "PATCH", "DELETE"],
		async router(req, res, url, { sessionID, guildID }) {
			const websocket = await import("./websocket.js");
			if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(res, 404, url, "Session not found");
			if (req.method === "GET") {
				const q = await websocket.getQueueForSession(sessionID, guildID);
				if (!q) return Util.createErrorResponse(res, 404, url, "Player not found");
				const decodedTrack = q.track ? encoding.decode(q.track.track) : undefined;
				const payload: GetPlayerResult = {
					guildId: q.guildID,
					track: decodedTrack ? {
						encoded: q.track!.track,
						info: {
							identifier: decodedTrack.identifier,
							isSeekable: !decodedTrack.isStream,
							author: decodedTrack.author,
							length: Number(decodedTrack.length),
							isStream: decodedTrack.isStream,
							position: Number(decodedTrack.position),
							title: decodedTrack.title,
							uri: decodedTrack.uri,
							sourceName: decodedTrack.source
						}
					} : null,
					volume: q.actions.volume,
					paused: q.actions.paused,
					filters: q.filtersObject,
					voice: {
						// @ts-expect-error
						token: q.connection.packets.server?.token ?? "",
						// @ts-expect-error
						endpoint: q.connection.packets.server?.endpoint ?? "",
						// @ts-expect-error
						sessionId: q.connection.packets.state?.session_id ?? "",
						connected: q.state.connected,
						ping: q.state.ping
					}
				};
				return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
			} else if (req.method === "PATCH") {
				if (req.headers["content-type"] !== "application/json") return Util.createErrorResponse(res, 415, url, "Content-Type must be application/json");
				const session = websocket.getSession(sessionID);
				if (!session) return Util.createErrorResponse(res, 404, url, "Session not found");
				const noReplace = url.searchParams.get("noReplace") === "true";
				const body = await Util.wrapRequestBodyToErrorResponse(req, res, url);
				if (!body) return;
				const data: UpdatePlayerData = JSON.parse(body.toString());
				const withId = data as Exclude<typeof data, { encodedTrack?: string | null }>;
				if (withId.identifier !== undefined && (data as Exclude<typeof data, { identifier?: string; }>).encodedTrack === undefined) {
					const match = withId.identifier.match(IDRegex);
					if (!match) return Util.createErrorResponse(res, 400, url, "identifier didn't match ID regex. This should never happen");

					const isSearch = !!match[1];
					const resource = match[2];

					const payload: TrackLoadingResult = {
						loadType: "NO_MATCHES",
						tracks: []
					};

					if (!resource) return Util.createErrorResponse(res, 400, url, "Invalid or no identifier query string provided.");
					try {
						const searchablePlugin = lavalinkPlugins.find(p => p.canBeUsed?.(resource, match[1] || undefined));
						if (searchablePlugin) {
							if (searchablePlugin.source && lavalinkConfig.lavalink.server.sources[searchablePlugin.source] === false) return Util.createErrorResponse(res, 400, url, `${searchablePlugin.source} is not enabled`);
							if (searchablePlugin.source && lavalinkConfig.lavalink.server[`${searchablePlugin.source}SearchEnabled`] === false) return Util.createErrorResponse(res, 400, url, `${searchablePlugin.source} searching is not enabled`);
							const result = await searchablePlugin.infoHandler?.(resource, match[1] || undefined);
							if (result && searchablePlugin.source) assignResults(result, searchablePlugin.source, payload);
						}

						if (payload.tracks.length === 0) return Util.createErrorResponse(res, 400, url, "No results for identifier");
						payload.loadType = (payload.tracks.length > 0 && isSearch)
							? "SEARCH_RESULT"
							: (payload.playlistInfo ? "PLAYLIST_LOADED" : "TRACK_LOADED");
						if (payload.loadType !== "TRACK_LOADED") return Util.createErrorResponse(res, 400, url, "Result of identifier search was not TRACK_LOADED");
						delete withId.identifier;
						(data as Exclude<typeof data, { identifier?: string; }>).encodedTrack = payload.tracks[0].encoded;
					} catch (e) {
						return Util.createErrorResponse(res, 500, url, e?.message ? e.message : String(e));
					}
				}
				const worker = await import("../worker.js");
				const payload = worker.onPlayerUpdate(session.userID, guildID, data, noReplace);
				websocket.declareClientToPlayer(session.userID, guildID, sessionID);
				return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
			} else if (req.method === "DELETE") {
				const q = await websocket.getQueueForSession(sessionID, guildID);
				if (!q) return Util.createErrorResponse(res, 404, url, "Player not found");
				q.destroy();
				return res.writeHead(204, { "Lavalink-Api-Version": lavalinkMajor, "Content-Length": 0 }).end();
			}
		},
	},
	[`/v${lavalinkMajor}/sessions/:sessionID`]: {
		methods: ["PATCH"],
		async router(req, res, url, { sessionID }) {
			if (req.headers["content-type"] !== "application/json") return Util.createErrorResponse(res, 415, url, "Content-Type must be application/json");
			const websocket = await import("./websocket.js");
			if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(res, 404, url, "Session not found");
			const body = await Util.wrapRequestBodyToErrorResponse(req, res, url);
			if (!body) return;
			const data: UpdateSessionData = JSON.parse(body.toString());
			const payload = websocket.updateResumeInfo(sessionID, data.resumingKey, data.timeout);
			return res.writeHead(200, Constants.baseHTTPResponseHeaders).end(JSON.stringify(payload));
		}
	}
};

type Folder = {
	route?: string;
}

const folders: Folder = {};

function getRouteFromFolders(steps: Array<string>): { route: string } | null {
	let current = folders;
	for (let i = 0; i < steps.length; i++) {
		if (!current) return null;
		else if (current[steps[i]]) current = current[steps[i]];
		else {
			const traversible = Object.keys(current).find(item => item[0] === ":" && (!!current[item].route || current[item][steps[i + 1]])); // routes cannot have a dynamic key directly after one.
			if (traversible) current = current[traversible];
			else return null;
		}
	}
	if (!current.route) return null;
	return { route: current.route };
}

const slash = /\//g;

for (const key of Object.keys(routes)) {
	const split = key.split(slash).slice(1);
	let previous = folders;
	for (let i = 0; i < split.length; i++) {
		const path = split[i];
		if (!previous[path]) previous[path] = {};
		if (i === split.length - 1) {
			previous[path].route = key;
		}
		previous = previous[path];
	}
}

const prox = new Proxy(paths, {
	get(target, property, receiver) {
		const existing = Reflect.get(target, property, receiver);
		if (existing) return existing;
		const prop = property.toString();
		const split = prop.split(slash).slice(1);
		const pt = getRouteFromFolders(split);
		if (!pt || !pt.route) return void 0;

		const params = {};
		const routeFolders = pt.route.split(slash).slice(1);
		for (let i = 0; i < split.length; i++) {
			if (routeFolders[i][0] === ":") params[routeFolders[i].slice(1)] = split[i];
		}

		return {
			methods: routes[pt.route].methods,
			handle: (req, res, url) => routes[pt.route].router(req, res, url, params)
		} as Path;
	}
});

function assignResults(result: Awaited<ReturnType<NonNullable<import("volcano-sdk").Plugin["infoHandler"]>>>, source: string, payload: import("lavalink-types").TrackLoadingResult) {
	payload.tracks = result.entries.map(t => ({
		encoded: encoding.encode(Object.assign({ flags: 1, version: 2, source: source, position: BigInt(0), probeInfo: t["probeInfo"] }, t, { length: BigInt(t.length) })),
		info: Object.assign({ position: 0 }, (() => {
			delete t["probeInfo"];
			return Object.assign({}, t, { isSeekable: !t.isStream, sourceName: source }) as typeof t & { isSeekable: boolean; sourceName: string; };
		})())
	}));
	if (result.plData) payload.playlistInfo = result.plData;
}

function convertDecodedTrackToResponse(encoded: string, data: import("@lavalink/encoding").TrackInfo): Track {
	return {
		encoded: encoded,
		info: {
			identifier: data.identifier,
			isSeekable: !data.isStream,
			author: data.author,
			length: Number(data.length),
			isStream: data.isStream,
			position: Number(data.position),
			title: data.title,
			uri: data.uri,
			sourceName: data.source
		}
	};
}

export default prox;
