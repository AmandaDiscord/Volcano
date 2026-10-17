// Merged from lavalibs/decode by natanbc (https://github.com/lavalibs/decode), Apache-2.0. See LICENSE
// Changed: track version 3 (artworkUrl, isrc), Java's modified UTF-8, signed longs and Node's Buffer

const TRACK_INFO_VERSIONED = 1;
const TRACK_INFO_VERSION = 3;
/** Sources which write the probe info after the common fields */
const probeSources = new Set(["http", "local"]);

/** Java's writeUTF isn't UTF-8. U+0000 takes 2 bytes and each half of a surrogate pair gets its own 3 */
function toModifiedUTF8(value) {
	const bytes = [];
	for (let i = 0; i < value.length; i++) {
		// Not codePointAt. Java writes each surrogate half on its own
		const c = value.charCodeAt(i);
		if (c >= 0x01 && c <= 0x7f) bytes.push(c);
		else if (c <= 0x7ff) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
		else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
	}
	if (bytes.length > 65535) throw new Error(`String too big! Maximum modified UTF-8 length is 65535 bytes, got ${bytes.length}`);
	return Buffer.from(bytes);
}

function fromModifiedUTF8(bytes) {
	const units = [];
	for (let i = 0; i < bytes.length;) {
		const a = bytes[i++];
		if (a < 0x80) units.push(a);
		else if (a < 0xe0) units.push(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
		else units.push(((a & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
	}
	return String.fromCodePoint(...units);
}

class Reader {
	#pos = 0;
	#bytes;

	constructor(bytes) {
		this.#bytes = bytes;
	}

	#advance(count) {
		if (this.#pos + count > this.#bytes.length) throw new Error(`EOF: Tried to read ${count} bytes at offset ${this.#pos}, but buffer size is only ${this.#bytes.length}`);
		this.#pos += count;
		return this.#pos - count;
	}

	byte() { return this.#bytes.readUInt8(this.#advance(1)); }
	bool() { return this.byte() !== 0; }
	int() { return this.#bytes.readInt32BE(this.#advance(4)); }
	long() { return this.#bytes.readBigInt64BE(this.#advance(8)); }
	nullableUtf() { return this.bool() ? this.utf() : null; }

	utf() {
		const start = this.#advance(this.#bytes.readUInt16BE(this.#advance(2)));
		return fromModifiedUTF8(this.#bytes.subarray(start, this.#pos));
	}
}

export function decode(encoded) {
	const input = new Reader(typeof encoded === "string" ? Buffer.from(encoded, "base64") : encoded);
	const version = (input.int() >>> 30) & TRACK_INFO_VERSIONED ? input.byte() : 1;
	if (version > TRACK_INFO_VERSION) throw new Error(`This track's version is not supported. Track version: ${version}, supported versions: 1, 2, 3`);
	const track = {
		version,
		title: input.utf(),
		author: input.utf(),
		length: input.long(),
		identifier: input.utf(),
		isStream: input.bool(),
		uri: version >= 2 ? input.nullableUtf() : null,
		artworkUrl: version >= 3 ? input.nullableUtf() : null,
		isrc: version >= 3 ? input.nullableUtf() : null,
		source: input.utf(),
		position: 0n
	};
	if (probeSources.has(track.source)) {
		const raw = input.utf();
		const separator = raw.indexOf("|");
		track.probeInfo = { raw, name: separator === -1 ? raw : raw.slice(0, separator), parameters: separator === -1 ? null : raw.slice(separator + 1) };
	}
	track.position = input.long();
	return track;
}

export function encode(track) {
	const parts = [Buffer.of(TRACK_INFO_VERSION)];
	const bool = value => parts.push(Buffer.of(value ? 1 : 0));
	const utf = value => {
		const bytes = toModifiedUTF8(value);
		const length = Buffer.alloc(2);
		length.writeUInt16BE(bytes.length);
		parts.push(length, bytes);
	};
	const nullableUtf = value => {
		bool(value != null);
		if (value != null) utf(value);
	};
	const long = value => {
		const bytes = Buffer.alloc(8);
		bytes.writeBigInt64BE(value);
		parts.push(bytes);
	};

	utf(track.title || "<no title provided>");
	utf(track.author || "<no author provided>");
	long(track.length ?? 0n);
	utf(track.identifier || "<no identifier provided>");
	bool(track.isStream ?? false);
	nullableUtf(track.uri);
	nullableUtf(track.artworkUrl);
	nullableUtf(track.isrc);
	utf(track.source || "<no source provided>");
	if (probeSources.has(track.source ?? "")) utf(track.probeInfo?.raw || "<no probe info provided>");
	long(track.position ?? 0n);

	const body = Buffer.concat(parts);
	const header = Buffer.alloc(4);
	header.writeInt32BE(body.length | (TRACK_INFO_VERSIONED << 30));
	return Buffer.concat([header, body]).toString("base64");
}
