import ll from "lavalink-types";

export type UnpackRecord<T> = T extends Record<any, infer R> ? R : never;

type EventMap = {
	"play": ll.PlayData;
	"stop": ll.StopData;
	"pause": ll.PauseData;
	"seek": ll.SeekData;
	"filters": ll.Filters & { op: "filters"; guildId: string; };
	"destroy": ll.DestroyData;
	"volume": ll.VolumeData;
	"ffmpeg": { guildId: string; op: "ffmpeg"; args: Array<string>; };
	"voiceUpdate": { guildId: string; op: "voiceUpdate"; sessionId: string; event: { token: string; endpoint: string; } };
	"configureResuming": { op: "configureResuming"; key: string; timeout?: number; }
}

export type InboundPayload = UnpackRecord<EventMap> & { clientID: string; };
