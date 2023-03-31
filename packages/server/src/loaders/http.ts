import uWS from "uWebSockets.js";
import fs from "fs";
import path from "path";

import entities from "html-entities";

import * as encoding from "@lavalink/encoding";

import Constants from "../Constants.js";
import Util from "../util/Util.js";

import { lavalinkMajor, lavalinkVersion } from "./lavalink.js";

import type { TrackLoadingResult, DecodeTrackResult, DecodeTracksResult, Track, GetPlayersResult, GetPlayerResult, UpdatePlayerData, UpdateSessionData, GetLavalinkInfoResult, GetLavalinkStatsResult } from "lavalink-types";

const IDRegex = /(?:(\w{1,4})search:)?(.+)/;

const symErrorLoad = Symbol("ERROR_WITH_LOAD");

const allDigitRegex = /^\d+$/;

import type { SessionData } from "./websocket.js";
const app = uWS.App();
app.ws(`/v${lavalinkMajor}/websocket`, {
	idleTimeout: 60,
	sendPingsAutomatically: true,

	async upgrade(res, req, context) {
		const ip = Util.getIPFromArrayBuffer(res.getRemoteAddress());
		console.log(`Incoming connection from /${ip}`);
		const userID = req.getHeader("user-id");
		const authorization = req.getHeader("authorization");
		const resumeKey = req.getHeader("resume-key");
		const secWebSocketKey = req.getHeader("sec-websocket-key");
		const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
		const secWebSocketExtensions = req.getHeader("sec-websocket-extensions");

		if (!allDigitRegex.test(userID) || authorization !== lavalinkConfig.lavalink.server.password) return res.writeStatus("401 Unauthorized").writeHeader("Lavalink-Api-Version", global.lavalinkMajor).endWithoutBody(undefined, true);
		const abortInfo = { aborted: false };
		res.onAborted(() => { abortInfo.aborted = true; });

		const websocket = await import("./websocket.js");
		websocket.handleWSUpgrade(userID, resumeKey, res, context, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, ip, abortInfo);
	},
	async open(ws) {
		const websocket = await import("./websocket.js");
		websocket.onWSOpen(ws);
	},
	async close(ws, code) {
		const websocket = await import("./websocket.js");
		websocket.onWSClose(ws, code);
	},
	async pong(ws) {
		const Util = await import("../util/Util.js");
		const stats = await Util.default.getStats();
		const payload = Object.assign(stats, { op: "stats" });
		ws.send(JSON.stringify(payload));
	}
} as uWS.WebSocketBehavior<SessionData>);


app.get(`/v${lavalinkMajor}/loadtracks`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const params = new URLSearchParams(req.getQuery());
	const result = await doTrackLoad(params.get("identifier"));
	if (result.error) return Util.standardTrackLoadingErrorHandler(result.error, res, result.result);
	else {
		if (res.aborted) return;
		const payload = JSON.stringify(result.result);
		res.writeStatus("200 OK");
		Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
		return res.end(payload, true);
	}
});


app.get(`/v${lavalinkMajor}/decodetrack`, (res, req) => {
	if (!Util.authenticate(req, res)) return;


	const params = new URLSearchParams(req.getQuery());
	let track = params.get("track");
	if (track) {
		console.log(`Got request to decode for track "${track}"`);
		track = entities.decode(track);
	}
	if (!track || typeof track !== "string") return Util.createErrorResponse(req, res, 400, "invalid track");
	const data: DecodeTrackResult = convertDecodedTrackToResponse(track, encoding.decode(track));
	const payload = JSON.stringify(data);
	res.writeStatus("200 OK");
	Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
	return res.end(payload, true);
});


app.post(`/v${lavalinkMajor}/decodetracks`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	if (req.getHeader("content-type") !== "application/json") return Util.createErrorResponse(req, res, 415, "Content-Type must be application/json");
	const body = await Util.wrapRequestBodyToErrorResponse(req, res);
	if (!body) return;
	if (res.aborted) return;
	const array = JSON.parse(body.toString()) as Array<string>;
	const data: DecodeTracksResult = array.map(t => convertDecodedTrackToResponse(t, encoding.decode(t)));
	const payload = JSON.stringify(data);
	res.writeStatus("200 OK");
	Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
	return res.end(payload, true);
});


app.get(`/v${lavalinkMajor}/info`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


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
	if (res.aborted) return;
	const data: GetLavalinkInfoResult = {
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
	const payload = JSON.stringify(data);
	res.writeStatus("200 OK");
	Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
	return res.end(payload, true);
});


app.get(`/v${lavalinkMajor}/stats`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const data = await Util.getStats() as unknown as GetLavalinkStatsResult;
	if (res.aborted) return;
	data.frameStats = null;
	const payload = JSON.stringify(data);
	res.writeStatus("200 OK");
	Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
	return res.end(payload, true);
});


app.get("/version", (res, req) => {
	if (!Util.authenticate(req, res)) return;


	const payload = `${lavalinkVersion}_null`;
	res.writeStatus("200 OK")
		.writeHeader("Content-Type", "text/plain")
		.writeHeader("Lavalink-Api-Version", lavalinkMajor);
	return res.end(payload, true);
});


app.get(`/v${lavalinkMajor}/sessions/:sessionID/players`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0);

	const websocket = await import("./websocket.js");
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");
	const queues = await websocket.getQueuesForSession(sessionID);
	if (res.aborted) return;
	const data: GetPlayersResult = queues.map(q => {
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
	const payload = JSON.stringify(data);
	res.writeStatus("200 OK");
	Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
	return res.end(payload, true);
});


app.get(`/v${lavalinkMajor}/sessions/:sessionID/players/:guildID`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0);
	const guildID = req.getParameter(1);

	const websocket = await import("./websocket.js");
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");

	const q = await websocket.getQueueForSession(sessionID, guildID);
	if (res.aborted) return;
	if (!q) return Util.createErrorResponse(req, res, 404, "Player not found");
	const decodedTrack = q.track ? encoding.decode(q.track.track) : undefined;
	const data: GetPlayerResult = {
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
	const payload = JSON.stringify(data);
	res.writeStatus("200 OK");
	Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
	return res.end(payload, true);
});
app.patch(`/v${lavalinkMajor}/sessions/:sessionID/players/:guildID`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0);
	const guildID = req.getParameter(1);

	const websocket = await import("./websocket.js");
	if (res.aborted) return;
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");

	if (req.getHeader("content-type") !== "application/json") return Util.createErrorResponse(req, res, 415, "Content-Type must be application/json");
	const session = websocket.getSession(sessionID);
	if (!session) return Util.createErrorResponse(req, res, 404, "Session not found");
	const params = new URLSearchParams(req.getQuery());
	const noReplace = params.get("noReplace") === "true";
	const body = await Util.wrapRequestBodyToErrorResponse(req, res);
	if (!body) return;
	if (res.aborted) return;
	const data: UpdatePlayerData = JSON.parse(body.toString());
	const withId = data as Exclude<typeof data, { encodedTrack?: string | null }>;
	if (withId.identifier !== undefined && (data as Exclude<typeof data, { identifier?: string; }>).encodedTrack === undefined) {
		const result = await doTrackLoad(withId.identifier);
		if (res.aborted) return;
		if (result.sym && result.error && result.sym !== symErrorLoad) return Util.createErrorResponse(req, res, 400, result.error.message);
		else if (result.sym && result.error && result.sym === symErrorLoad) return Util.createErrorResponse(req, res, 500, result.error.message);
		else if (result.result.loadType !== "TRACK_LOADED") return Util.createErrorResponse(req, res, 400, "Result of identifier search was not TRACK_LOADED");
		delete withId.identifier;
		(data as Exclude<typeof data, { identifier?: string; }>).encodedTrack = result.result.tracks[0].encoded;
	}
	const worker = await import("../worker.js");
	if (res.aborted) return;
	const sessionData = session.getUserData();
	const payload = worker.onPlayerUpdate(sessionData.userID, guildID, data, noReplace);
	websocket.declareClientToPlayer(sessionData.userID, guildID, sessionID);
	const stringified = JSON.stringify(payload);
	res.writeStatus("200 OK");
	Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
	return res.end(stringified, true);
});
app.del(`/v${lavalinkMajor}/sessions/:sessionID/players/:guildID`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0);
	const guildID = req.getParameter(1);

	const websocket = await import("./websocket.js");
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");

	const q = await websocket.getQueueForSession(sessionID, guildID);
	if (res.aborted) return;
	if (!q) return Util.createErrorResponse(req, res, 404, "Player not found");
	q.destroy();
	res.writeStatus("204 No Content")
		.writeHeader("Lavalink-Api-Version", lavalinkMajor)
		.endWithoutBody(0, true);
});


app.patch(`/v${lavalinkMajor}/sessions/:sessionID`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0);

	if (req.getHeader("content-type") !== "application/json") return Util.createErrorResponse(req, res, 415, "Content-Type must be application/json");
	const websocket = await import("./websocket.js");
	if (res.aborted) return;
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");
	const body = await Util.wrapRequestBodyToErrorResponse(req, res);
	if (!body) return;
	if (res.aborted) return;
	const data: UpdateSessionData = JSON.parse(body.toString());
	const payload = websocket.updateResumeInfo(sessionID, data.resumingKey, data.timeout);
	const stringified = JSON.stringify(payload);
	res.writeStatus("200 OK");
	Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
	return res.end(stringified, true);
});


async function doTrackLoad(id?: string | null, logRequest = true): Promise<{ sym?: symbol; error?: Error; result: TrackLoadingResult }> {
	const payload: TrackLoadingResult = {
		loadType: "NO_MATCHES",
		tracks: []
	};
	if (!id || typeof id !== "string") return { error: new Error("Invalid or no identifier query string provided."), result: payload };

	const identifier = entities.decode(id);
	const match = identifier.match(IDRegex);
	if (!match) {
		if (logRequest) console.log(`Got request to load for identifier "${identifier}"`);
		return { error: new Error("Identifier did not match regex"), result: payload }; // Should theoretically never happen, but TypeScript doesn't know this
	}

	const isSearch = !!match[1];
	const resource = match[2];

	if (!resource) return { error: new Error("Invalid or no identifier query string provided."), result: payload };
	if (logRequest) console.log(`Got request to load for identifier "${resource}"`);

	try {
		const searchablePlugin = lavalinkPlugins.find(p => p.canBeUsed?.(resource, match[1] || undefined));
		if (searchablePlugin) {
			if (searchablePlugin.source && lavalinkConfig.lavalink.server.sources[searchablePlugin.source] === false) return { error: new Error(`${searchablePlugin.source} is not enabled`), result: payload };
			if (isSearch && searchablePlugin.source && lavalinkConfig.lavalink.server[`${searchablePlugin.source}SearchEnabled`] === false) return { error: new Error(`${searchablePlugin.source} searching is not enabled`), result: payload };
			const result = await searchablePlugin.infoHandler?.(resource, match[1] || undefined);
			if (result && searchablePlugin.source) assignResults(result, searchablePlugin.source, payload);
		}

		if (payload.tracks.length === 0) {
			delete payload.playlistInfo;
			return { result: payload };
		} else if (payload.tracks.length === 1 && logRequest) console.log(`Loaded track ${payload.tracks[0].info.title}`);
		payload.loadType = (payload.tracks.length > 0 && isSearch)
			? "SEARCH_RESULT"
			: (payload.playlistInfo ? "PLAYLIST_LOADED" : "TRACK_LOADED");
		return { result: payload };
	} catch (e) {
		return { sym: symErrorLoad, error: (e instanceof Error) ? e : new Error(String(e)), result: payload };
	}
}

function assignResults(result: Awaited<ReturnType<NonNullable<import("volcano-sdk").Plugin["infoHandler"]>>>, source: string, payload: import("lavalink-types").TrackLoadingResult) {
	if (result.source) source = result.source;
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

export default app;
