import stream from "stream";

class LimitedReadWriteStream extends stream.Transform {
	public limit: number | undefined;
	public chunkAmount = 0;

	public constructor(chunkLimit?: number) {
		super();
		this.limit = chunkLimit;
	}

	public _transform(chunk: any, encoding: BufferEncoding, done: stream.TransformCallback) {
		if (!this.limit || this.chunkAmount < this.limit) this.push(chunk, encoding);
		if (this.limit && this.chunkAmount >= this.limit) this.end();
		this.chunkAmount++;
		done();
	}
}

export = LimitedReadWriteStream;
