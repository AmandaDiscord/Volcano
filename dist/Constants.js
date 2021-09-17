"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseSoundcloudURL = exports.OKStatusCodes = exports.workerOPCodes = exports.defaultFilterValues = exports.OPCodes = exports.baseHTTPRequestHeaders = exports.fakeAgent = exports.baseHTTPResponseHeaders = exports.defaultOptions = void 0;
exports.defaultOptions = {
    spring: {
        main: {
            "banner-mode": "log"
        }
    },
    server: {
        port: process.env.PORT || 2333,
        address: "0.0.0.0"
    },
    lavalink: {
        server: {
            password: "youshallnotpass",
            sources: {
                youtube: true,
                bandcamp: true,
                soundcloud: true,
                twitch: true,
                vimeo: true,
                http: false,
                local: false
            },
            bufferDurationMs: 400,
            youtubePlaylistLoadLimit: 6,
            playerUpdateInterval: 5,
            youtubeSearchEnabled: true,
            soundcloudSearchEnabled: true
        }
    },
    logging: {
        file: {
            "max-history": 30,
            "max-size": "1GB"
        },
        path: "./logs/",
        level: {
            root: "INFO",
            lavalink: "INFO"
        }
    }
};
exports.baseHTTPResponseHeaders = {
    "Lavalink-Api-Version": 3,
    "Content-Type": "application/json"
};
exports.fakeAgent = `Mozilla/5.0 (Server; NodeJS ${process.version.replace("v", "")}; rv:1.0) Magma/1.0 (KHTML, like Gecko) Volcano/1.0`;
exports.baseHTTPRequestHeaders = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.5",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    DNT: "1",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-site",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": exports.fakeAgent
};
exports.OPCodes = {
    VOICE_UPDATE: "voiceUpdate",
    PLAY: "play",
    STOP: "stop",
    PAUSE: "pause",
    SEEK: "seek",
    FILTERS: "filters",
    DESTROY: "destroy",
    CONFIGURE_RESUMING: "configureResuming",
    FFMPEG: "ffmpeg",
    VOLUME: "volume",
    PLAYER_UPDATE: "playerUpdate",
    STATS: "stats",
    EVENT: "event"
};
exports.defaultFilterValues = {
    volume: 1.0,
    equalizer: [
        {
            band: 0,
            gain: 0.2
        }
    ],
    karaoke: {
        level: 1.0,
        monoLevel: 1.0,
        filterBand: 220.0,
        filterWidth: 100.0
    },
    timescale: {
        speed: 1.0,
        pitch: 1.0,
        rate: 1.0
    },
    tremolo: {
        frequency: 2.0,
        depth: 0.5
    },
    vibrato: {
        frequency: 2.0,
        depth: 0.5
    },
    rotation: {
        rotationHz: 0
    },
    distortion: {
        sinOffset: 0,
        sinScale: 1,
        cosOffset: 0,
        cosScale: 1,
        tanOffset: 0,
        tanScale: 1,
        offset: 0,
        scale: 1
    },
    channelMix: {
        leftToLeft: 1.0,
        leftToRight: 0.0,
        rightToLeft: 0.0,
        rightToRight: 1.0,
    },
    lowPass: {
        smoothing: 20.0
    }
};
exports.workerOPCodes = {
    READY: 1,
    MESSAGE: 2,
    CLOSE: 3,
    ACKKNOWLEDGE: 4,
    REPLY: 5,
    STATS: 6,
    VOICE_SERVER: 7,
    DELETE_ALL: 8
};
exports.OKStatusCodes = [200, 201, 204, 304];
exports.baseSoundcloudURL = "https://soundcloud.com";
exports.default = {
    defaultOptions: exports.defaultOptions,
    baseHTTPResponseHeaders: exports.baseHTTPResponseHeaders,
    OPCodes: exports.OPCodes,
    defaultFilterValues: exports.defaultFilterValues,
    workerOPCodes: exports.workerOPCodes,
    baseHTTPRequestHeaders: exports.baseHTTPRequestHeaders,
    OKStatusCodes: exports.OKStatusCodes,
    baseSoundcloudURL: exports.baseSoundcloudURL
};
