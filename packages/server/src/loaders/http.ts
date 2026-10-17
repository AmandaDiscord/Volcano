import uWS from "uWebSockets.js";
import type { HttpResponse } from "uWebSockets.js";
import fs from "node:fs";
import path from "node:path";

import * as entities from "html-entities";

import * as encoding from "volcano-encoding";

import Constants from "../Constants.js";
import Util from "../util/Util.js";
import ThreadPool from "../util/ThreadPool.js";
import websocket, { type SessionData } from "./websocket.js";
import type { PlayerUpdate } from "../worker.js";

import { lavalinkMajor, lavalinkVersion } from "./lavalink.js";

import type { TrackLoadingResult, Track, UpdatePlayerData, UpdateSessionData, VoiceState, Filters } from "lavalink-types/v4.js";

const IDRegex = /(?:(\w{1,4})search:)?(.+)/;

const symErrorLoad = Symbol("ERROR_WITH_LOAD");

const allDigitRegex = /^\d+$/;

const app = uWS.App();

app.ws(`/v${lavalinkMajor}/websocket`, {
	idleTimeout: 60,
	sendPingsAutomatically: true,

	upgrade(res, req, context) {
		const ip = Buffer.from(res.getRemoteAddressAsText()).toString();
		console.log(`Incoming connection from /${ip}`);
		const userID = req.getHeader("user-id");
		const authorization = req.getHeader("authorization");
		const resumeID = req.getHeader("session-id");
		const secWebSocketKey = req.getHeader("sec-websocket-key");
		const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
		const secWebSocketExtensions = req.getHeader("sec-websocket-extensions");

		if (!allDigitRegex.test(userID) || authorization !== lavalinkConfig.lavalink.server.password) {
			res.writeStatus("403 Forbidden").writeHeader("Lavalink-Api-Version", lavalinkMajor).endWithoutBody(undefined, true);
			return;
		}
		websocket.handleWSUpgrade(
			userID,
			resumeID,
			res,
			context,
			secWebSocketKey,
			secWebSocketProtocol,
			secWebSocketExtensions,
			ip,
			{ aborted: false }
		);
	},
	open(ws) {
		websocket.onWSOpen(ws);
	},
	close(ws, code) {
		websocket.onWSClose(ws, code);
	},
	pong(ws) {
		const data = ws.getUserData();
		Util.getStats(data).then(stats => websocket.sendStats(data.sessionID, ws, stats)).catch(() => void 0)
	}
} as uWS.WebSocketBehavior<SessionData>);


app.get(`/v${lavalinkMajor}/loadtracks`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const identifier = new URLSearchParams(req.getQuery()).get("identifier");
	if (!identifier) return Util.createErrorResponse(req, res, 400, "Required parameter 'identifier' is not present.");
	const result = await doTrackLoad(identifier);
	if (result.error) console.log(`Load failed\n${result.error.message}`);
	return sendJSON(res, Util.stringify(result.error ? { loadType: "error", data: Util.loadException(result.error) } : result.result));
});


app.get(`/v${lavalinkMajor}/decodetrack`, (res, req) => {
	if (!Util.authenticate(req, res)) return;


	let track = new URLSearchParams(req.getQuery()).get("encodedTrack");
	if (track) {
		console.log(`Got request to decode for track "${track}"`);
		track = entities.decode(track);
	}
	if (!track) return Util.createErrorResponse(req, res, 400, "invalid track");
	const data = Util.tryToTrack(track);
	if (!data) return Util.createErrorResponse(req, res, 400, "invalid track");
	return sendJSON(res, Util.stringify(data));
});


app.post(`/v${lavalinkMajor}/decodetracks`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	if (req.getHeader("content-type") !== "application/json") return Util.createErrorResponse(req, res, 415, "Content-Type must be application/json");
	const body = await Util.wrapRequestBodyToErrorResponse(req, res);
	if (!body) return;
	if (res.aborted) return;
	const array = parseJSONOrUndefined(body);
	if (!Array.isArray(array) || !array.every(t => typeof t === "string")) return Util.createErrorResponse(req, res, 400, "Body must be a JSON array of encoded tracks");
	const data: Array<Track> = [];
	for (const encoded of array as Array<string>) {
		const decoded = Util.tryToTrack(encoded);
		if (!decoded) return Util.createErrorResponse(req, res, 400, "Body contains an invalid track");
		data.push(decoded);
	}
	return sendJSON(res, Util.stringify(data));
});


app.get(`/v${lavalinkMajor}/info`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


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
	const [major, minor, patch] = lavalinkVersion.split(".").map(Number);
	const data = {
		version: { semver: lavalinkVersion, major, minor, patch, preRelease: null, build: null },
		buildTime: buildInfo.build_time ?? 0,
		git: {
			branch: buildInfo.branch,
			commit: buildInfo.commit,
			commitTime: buildInfo.build_time ?? 0
		},
		jvm: process.version.replace("v", ""),
		lavaplayer: pkg.version,
		filters: ["volume", "equalizer", "karaoke", "timescale", "tremolo", "vibrato", "distortion", "rotation", "channelMix", "lowPass"],
		sourceManagers: lavalinkPlugins.filter(p => p.source && lavalinkConfig.lavalink.server.sources[p.source] !== false).map(p => p.source!),
		plugins: lavalinkPlugins.filter(p => !lavalinkSources.has(p)).map(p => ({
			name: p.constructor?.name || "unknown",
			version: p.version ?? "0.0.0"
		}))
	};
	return sendJSON(res, JSON.stringify(data));
});


app.get(`/v${lavalinkMajor}/stats`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	return sendJSON(res, JSON.stringify(await Util.getStats()));
});


app.get(`/v${lavalinkMajor}/sessions/:sessionID/players`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0)!;
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");
	return sendJSON(res, Util.stringify(await websocket.getPlayersForSession(sessionID)));
});


app.get(`/v${lavalinkMajor}/sessions/:sessionID/players/:guildID`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0)!;
	const guildID = req.getParameter(1)!;
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");
	const player = await websocket.getPlayerForSession(sessionID, guildID);
	if (!player) return Util.createErrorResponse(req, res, 404, "Player not found");
	return sendJSON(res, Util.stringify(player));
});


app.patch(`/v${lavalinkMajor}/sessions/:sessionID/players/:guildID`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0)!;
	const guildID = req.getParameter(1)!;
	const noReplace = new URLSearchParams(req.getQuery()).get("noReplace") === "true";
	const session = websocket.getSession(sessionID);
	if (!session) return Util.createErrorResponse(req, res, 404, "Session not found");
	if (req.getHeader("content-type") !== "application/json") return Util.createErrorResponse(req, res, 415, "Content-Type must be application/json");
	const body = await Util.wrapRequestBodyToErrorResponse(req, res);
	if (!body) return;
	if (res.aborted) return;
	const parsed = parseJSONOrUndefined(body);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Util.createErrorResponse(req, res, 400, "Body must be a JSON object");

	const update = toPlayerUpdate(parsed as UpdatePlayerData);
	if (typeof update === "string") return Util.createErrorResponse(req, res, 400, update);
	if (update.identifier !== undefined && update.encodedTrack === undefined) {
		const result = await doTrackLoad(update.identifier);
		if (res.aborted) return;
		if (result.error) return Util.createErrorResponse(req, res, result.sym === symErrorLoad ? 500 : 400, result.error.message);
		if (result.result.loadType !== "track") return Util.createErrorResponse(req, res, 400, "Result of identifier search was not a track");
		update.encodedTrack = result.result.data.encoded;
	}
	if (update.encodedTrack && !Util.tryToTrack(update.encodedTrack)) return Util.createErrorResponse(req, res, 400, "invalid encodedTrack");

	// the session may have closed while the body or track was loading
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");
	const userID = session.getUserData().userID;
	// Declared first so a session closing while the audio thread works still destroys this player
	websocket.declareClientToPlayer(userID, guildID, sessionID);
	const player = await ThreadPool.updatePlayer(userID, guildID, update, noReplace).catch((e: Error) => e);
	if (player instanceof Error) return Util.createErrorResponse(req, res, 500, player.message);
	return sendJSON(res, Util.stringify(player));
});


app.del(`/v${lavalinkMajor}/sessions/:sessionID/players/:guildID`, (res, req) => {
	if (!Util.authenticate(req, res)) return;


	const sessionID = req.getParameter(0)!;
	const guildID = req.getParameter(1)!;
	const session = websocket.getSession(sessionID);
	if (!session) return Util.createErrorResponse(req, res, 404, "Session not found");
	if (!ThreadPool.destroyPlayer(session.getUserData().userID, guildID)) return Util.createErrorResponse(req, res, 404, "Player not found");
	res.cork(() => {
		res.writeStatus("204 No Content")
			.writeHeader("Lavalink-Api-Version", lavalinkMajor)
			.endWithoutBody(0, true);
	});
});


app.patch(`/v${lavalinkMajor}/sessions/:sessionID`, async (res, req) => {
	if (!Util.authenticate(req, res)) return;
	Util.attachAborthandler(res);


	const sessionID = req.getParameter(0)!;
	if (req.getHeader("content-type") !== "application/json") return Util.createErrorResponse(req, res, 415, "Content-Type must be application/json");
	if (!websocket.sessionExists(sessionID)) return Util.createErrorResponse(req, res, 404, "Session not found");
	const body = await Util.wrapRequestBodyToErrorResponse(req, res);
	if (!body) return;
	if (res.aborted) return;
	const data = parseJSONOrUndefined(body) as UpdateSessionData | undefined;
	if (!data || typeof data !== "object" || Array.isArray(data)) return Util.createErrorResponse(req, res, 400, "Body must be a JSON object");
	return sendJSON(res, JSON.stringify(websocket.updateResuming(sessionID, data.resuming, data.timeout)));
});


app.get("/version", (res, req) => {
	if (!Util.authenticate(req, res)) return;


	res.writeStatus("200 OK")
		.writeHeader("Content-Type", "text/plain")
		.writeHeader("Lavalink-Api-Version", lavalinkMajor);
	return void res.end(lavalinkVersion, true);
});


app.get(`/v${lavalinkMajor}/routeplanner/status`, (res, req) => {
	if (!Util.authenticate(req, res)) return;
	res.writeStatus("204 No Content").writeHeader("Lavalink-Api-Version", lavalinkMajor).endWithoutBody(0, true);
});


app.any("/*", (res, req) => {
	if (!Util.authenticate(req, res)) return;
	return Util.createErrorResponse(req, res, 404, `No endpoint ${req.getCaseSensitiveMethod()} ${req.getUrl()}.`);
});


type RouteUpdate = PlayerUpdate & { identifier?: string };

/** @returns the internal update, or the reason the body is invalid */
function toPlayerUpdate(data: UpdatePlayerData): RouteUpdate | string {
	const track = data.track as { encoded?: string | null; identifier?: string; userData?: Record<string, unknown> } | undefined;
	if (track?.encoded !== undefined && track.identifier !== undefined) return "Cannot specify both encodedTrack and identifier";
	const voice = data.voice as (VoiceState & { channelId?: string }) | undefined;
	// Lavalink 4.2 needs the channel to join Discord's DAVE-encrypted voice
	if (voice && !voice.channelId) return "voice.channelId is required";
	const filters = data.filters === undefined ? undefined : toFilters(data.filters);
	if (typeof filters === "string") return filters;
	// @ts-expect-error
	return { encodedTrack: track?.encoded, identifier: track?.identifier, userData: track?.userData, position: data.position, endTime: data.endTime, volume: data.volume, paused: data.paused, filters, voice };
}

/** Lavalink's defaults for the fields a filter object leaves out */
const filterDefaults: Record<string, Record<string, number>> = {
	karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 },
	timescale: { speed: 1, pitch: 1, rate: 1 },
	tremolo: { frequency: 2, depth: 0.5 },
	vibrato: { frequency: 2, depth: 0.5 },
	distortion: { sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1, tanOffset: 0, tanScale: 1, offset: 0, scale: 1 },
	rotation: { rotationHz: 0 },
	channelMix: { leftToLeft: 1, leftToRight: 0, rightToLeft: 0, rightToRight: 1 },
	lowPass: { smoothing: 20 }
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const toNumber = (value: unknown) => typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : Number.NaN;

function toFilters(data: unknown): Filters | string {
	if (!isObject(data)) return "filters must be an object";
	const filters: Record<string, unknown> = {};
	if (data.volume !== undefined) {
		filters.volume = toNumber(data.volume);
		if (!Number.isFinite(filters.volume)) return "filters.volume must be a number";
	}
	if (data.equalizer !== undefined) {
		if (!Array.isArray(data.equalizer)) return "filters.equalizer must be an array";
		const bands: Array<{ band: number; gain: number }> = filters.equalizer = [];
		for (const value of data.equalizer as Array<{ band?: unknown; gain?: unknown } | null>) {
			const band = toNumber(value?.band);
			const gain = value?.gain === undefined ? 1 : toNumber(value.gain);
			if (!Number.isInteger(band) || band < 0 || band > 14 || !Number.isFinite(gain)) return "filters.equalizer needs bands from 0 to 14 with numeric gains";
			bands.push({ band, gain });
		}
	}
	for (const [name, defaults] of Object.entries(filterDefaults)) {
		const value = data[name];
		// null turns the filter off
		if (value === undefined || value === null) continue;
		if (!isObject(value)) return `filters.${name} must be an object`;
		const filter = filters[name] = { ...defaults };
		for (const key of Object.keys(defaults)) {
			if (value[key] === undefined) continue;
			filter[key] = toNumber(value[key]);
			if (!Number.isFinite(filter[key])) return `filters.${name}.${key} must be a number`;
		}
	}
	if (data.pluginFilters !== undefined && !isObject(data.pluginFilters)) return "filters.pluginFilters must be an object";
	return filters as Filters;
}

type LoadResult = Exclude<TrackLoadingResult, { loadType: "empty" }> | { loadType: "empty"; data: null };

async function doTrackLoad(id?: string | null, logRequest = true): Promise<{ sym?: symbol; error?: Error; result: LoadResult }> {
	const empty: LoadResult = { loadType: "empty", data: null };
	if (!id || typeof id !== "string") return { error: new Error("Invalid or no identifier query string provided."), result: empty };

	const identifier = entities.decode(id);
	const match = IDRegex.exec(identifier);
	if (!match) {
		if (logRequest) console.log(`Got request to load for identifier "${identifier}"`);
		return { error: new Error("Identifier did not match regex"), result: empty }; // Should theoretically never happen, but TypeScript doesn't know this
	}

	const isSearch = !!match[1];
	const resource = match[2];

	if (!resource) return { error: new Error("Invalid or no identifier query string provided."), result: empty };
	if (logRequest) console.log(`Got request to load for identifier "${resource}"`);

	try {
		const searchablePlugin = lavalinkPlugins.find(p => p.canBeUsed?.(resource, match[1] || undefined));
		if (!searchablePlugin?.source) return { result: empty };
		if (lavalinkConfig.lavalink.server.sources[searchablePlugin.source] === false) return { error: new Error(`${searchablePlugin.source} is not enabled`), result: empty };
		if (isSearch && lavalinkConfig.lavalink.server[`${searchablePlugin.source}SearchEnabled`] === false) return { error: new Error(`${searchablePlugin.source} searching is not enabled`), result: empty };
		const result = await searchablePlugin.infoHandler?.(resource, match[1] || undefined);
		if (!result) return { result: empty };

		const source = result.source ?? searchablePlugin.source;
		const tracks = result.entries.map(t => Util.toTrack(encoding.encode({ ...t, source, length: t.isStream ? 9223372036854775807n : BigInt(t.length) })));
		if (tracks.length === 0) return { result: empty };
		if (tracks.length === 1 && logRequest) console.log(`Loaded track ${tracks[0].info.title}`);
		if (isSearch) return { result: { loadType: "search", data: tracks } };
		if (result.plData) return { result: { loadType: "playlist", data: { info: { name: result.plData.name ?? "", selectedTrack: result.plData.selectedTrack ?? -1 }, pluginInfo: {}, tracks } } };
		return { result: { loadType: "track", data: tracks[0] } };
	} catch (e) {
		return { sym: symErrorLoad, error: (e instanceof Error) ? e : new Error(String(e)), result: empty };
	}
}

function sendJSON(res: HttpResponse, payload: string): void {
	if (res.aborted) return;
	res.cork(() => {
		res.writeStatus("200 OK");
		Util.assignHeadersToResponse(res, Constants.baseHTTPResponseHeaders);
		res.end(payload, true);
	});
}

function parseJSONOrUndefined(body: Buffer): unknown {
	try {
		return JSON.parse(body.toString());
	} catch {
		return undefined;
	}
}


export default app;

export { type HttpRequest } from "uWebSockets.js";
