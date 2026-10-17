import { Readable } from "node:stream";

import { Demuxer, Decoder, Encoder, FilterAPI, IOStream, InputFormat, Log, Packet, FFmpegError, AVERROR_EOF, AVERROR_EAGAIN, AV_DISPOSITION_ATTACHED_PIC, AV_LOG_QUIET, AVMEDIA_TYPE_VIDEO, FF_ENCODER_LIBOPUS } from "node-av";

import type { FormatContext, Frame, IOContext } from "node-av";

Log.setLevel(AV_LOG_QUIET);

/** Input bytes buffered before the source is paused */
const highWater = 512 * 1024;
/** What an async read waits for first, so a live stream doesn't park a libuv threadpool thread on every packet */
const asyncMin = 32 * 1024;

export type TranscoderOptions = {
	/** Joined into one filter graph. Lavalink always mixes in stereo, so the graph does too */
	filters: Array<string>;
	/** ms to skip */
	start: number;
	/** 1 = unchanged */
	volume: number;
	/** s16le 48kHz stereo with no container */
	raw: boolean;
	/** libopus compression_level 0-10 */
	quality: number;
};

/** Anything FFmpeg can demux in, 20ms Opus packets out (StreamType.Opus) */
export class Transcoder extends Readable {
	public volume: number;
	/** Assign a new array to swap the graph between frames */
	public filters: Array<string>;

	private source: Readable;
	private options: TranscoderOptions;
	private appliedVolume: number;
	private appliedFilters: Array<string>;
	private chunks: Array<Buffer> = [];
	private size = 0;
	private ended = false;
	private wake: (() => void) | undefined = undefined;
	/** A sync read can't wait for data and FFmpeg can't recover from a short one, so it only runs with this much buffered. Async reads cost ~12% more CPU */
	private syncMin = 256 * 1024;
	private syncing = false;
	private busy = false;
	private flushed = false;

	private io?: IOContext;
	private demuxer?: Demuxer;
	private format?: FormatContext;
	private decoder?: Decoder;
	private graph?: FilterAPI;
	private encoder?: Encoder;
	private packet?: Packet;
	private index = 0;
	private startPTS = 0n;
	private firstPTS?: bigint;

	public constructor(source: Readable, options: TranscoderOptions) {
		super({ objectMode: true });
		this.source = source;
		this.options = options;
		this.volume = this.appliedVolume = options.volume;
		this.filters = this.appliedFilters = options.filters;

		source.on("data", (chunk: Buffer) => {
			this.chunks.push(chunk);
			this.size += chunk.length;
			if (this.size >= highWater) source.pause();
			this.wake?.();
		});
		const end = () => {
			this.ended = true;
			this.wake?.();
		};
		source.once("end", end).once("close", end).once("error", e => this.destroy(e));
	}

	/** Resolves once `bytes` are buffered or the source is done */
	private waitFor(bytes: number): Promise<void> | void {
		if (this.size >= bytes || this.ended) return;
		this.source.resume();
		return new Promise(resolve => this.wake = () => {
			if (this.size < bytes && !this.ended) return;
			this.wake = undefined;
			resolve();
		});
	}

	private readInput(size: number): Buffer | null | number | Promise<Buffer | null | number> {
		if (!this.size) {
			if (this.ended) return null;
			if (this.syncing) return AVERROR_EAGAIN;
			return Promise.resolve(this.waitFor(1)).then(() => this.readInput(size));
		}
		let chunk = this.chunks[0];
		if (chunk.length > size) {
			this.chunks[0] = chunk.subarray(size);
			chunk = chunk.subarray(0, size);
		} else this.chunks.shift();
		this.size -= chunk.length;
		if (this.size < highWater) this.source.resume();
		return chunk;
	}

	private async open() {
		const io = this.io = IOStream.create({ read: size => this.readInput(size) });
		const format = this.options.raw ? "s16le" : (await InputFormat.probeBuffer(io))?.name;
		if (!format) throw new Error("Unrecognized audio format");
		// The demuxer frees it from here on, even when opening fails
		this.io = undefined;
		this.demuxer = await Demuxer.open(io, { format, options: this.options.raw ? { sample_rate: "48000", ch_layout: "stereo" } : undefined });
		const stream = this.demuxer.audio();
		if (!stream) throw new Error("No audio stream");
		if (this.demuxer.streams.some(s => s.codecpar.codecType === AVMEDIA_TYPE_VIDEO && !(s.disposition & AV_DISPOSITION_ATTACHED_PIC))) this.syncMin = Infinity;
		this.index = stream.index;
		this.startPTS = BigInt(Math.floor(this.options.start / 1000 * stream.timeBase.den / stream.timeBase.num));
		this.format = this.demuxer.getFormatContext();
		this.decoder = Decoder.createSync(stream);
		this.graph = this.createGraph();
		// Passing this as options instead segfaults on exit (node-av 6.1.1)
		this.encoder = Encoder.createSync(FF_ENCODER_LIBOPUS, { context: { sampleRate: 48000, frameSize: 960 }, configure: context => context.setOption("compression_level", this.options.quality) });
		this.packet = new Packet();
		this.packet.alloc();
	}

	private createGraph() {
		this.appliedFilters = this.filters;
		this.appliedVolume = this.volume;
		const description = ["aresample=48000", "aformat=channel_layouts=stereo", ...this.filters, `volume@vol=${this.volume}`, "aresample=48000", "aformat=sample_fmts=s16:channel_layouts=stereo"].join(",");
		return FilterAPI.create(description, { graph: { nbThreads: 1 } });
	}

	public _read() {
		if (!this.busy) void this.pump();
	}

	private async pump() {
		this.busy = true;
		try {
			if (!this.format) await this.open();
			while (!this.destroyed) {
				const packets = await this.next();
				if (!packets) return void this.push(null);
				let more = true;
				for (const packet of packets) more = this.push(packet);
				if (!more) break;
			}
		} catch (e) {
			this.destroy(e as Error);
		} finally {
			this.busy = false;
			if (this.destroyed) this.close();
		}
	}

	private async next(): Promise<Array<Buffer> | null> {
		const packet = this.packet!;
		while (!this.flushed) {
			if (this.size < this.syncMin) await this.waitFor(asyncMin);
			if (this.destroyed) return null;
			this.syncing = this.ended || this.size >= this.syncMin;
			const ret = this.syncing ? this.format!.readFrameSync(packet) : await this.format!.readFrame(packet);
			this.syncing = false;
			if (this.destroyed) return null;
			if (ret === AVERROR_EOF) {
				this.flushed = true;
				return this.encode(this.decoder!.flushFramesSync(), true);
			}
			FFmpegError.throwIfError(ret, "Failed to read audio");
			if (packet.streamIndex !== this.index || (this.startPTS && packet.pts - (this.firstPTS ??= packet.pts) < this.startPTS)) {
				packet.unref();
				continue;
			}
			const out = this.encode(this.decoder!.decodeAllSync(packet));
			packet.unref();
			if (out.length) return out;
		}
		return null;
	}

	private encode(frames: Iterable<Frame>, flush = false): Array<Buffer> {
		const filtered: Array<Frame> = [];
		const out: Array<Buffer> = [];
		if (this.appliedFilters !== this.filters) {
			// atempo and the equalizers still hold a few ms of the old graph's audio
			if (this.graph!.isFilterInitialized) filtered.push(...this.graph!.flushFramesSync());
			this.graph!.close();
			this.graph = this.createGraph();
		}
		const graph = this.graph!;
		const take = (packets: Iterable<Packet>) => {
			for (const packet of packets) {
				out.push(Buffer.from(packet.data!));
				packet.free();
			}
		};
		for (const frame of frames) {
			filtered.push(...graph.processAllSync(frame));
			frame.free();
			if (this.appliedVolume !== this.volume && graph.isFilterInitialized) {
				graph.sendCommand("volume@vol", "volume", `${this.volume}`);
				this.appliedVolume = this.volume;
			}
		}
		if (flush && graph.isFilterInitialized) filtered.push(...graph.flushFramesSync());
		for (const frame of filtered) {
			take(this.encoder!.encodeAllSync(frame));
			frame.free();
		}
		if (flush) take(this.encoder!.flushPacketsSync());
		return out;
	}

	private close() {
		this.packet?.free();
		this.encoder?.close();
		this.graph?.close();
		this.decoder?.close();
		this.demuxer?.closeSync();
		this.io?.freeContext();
	}

	public _destroy(error: Error | null, callback: (error?: Error | null) => void) {
		this.source.destroy();
		this.ended = true;
		this.wake?.();
		if (!this.busy) this.close();
		callback(error);
	}
}
