"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const stream_1 = __importDefault(require("stream"));
class LimitedReadWriteStream extends stream_1.default.Transform {
    constructor(chunkLimit) {
        super();
        this.chunkAmount = 0;
        this.limit = chunkLimit;
    }
    _transform(chunk, encoding, done) {
        if (!this.limit || this.chunkAmount < this.limit)
            this.push(chunk, encoding);
        if (this.limit && this.chunkAmount >= this.limit)
            this.end();
        this.chunkAmount++;
        done();
    }
}
module.exports = LimitedReadWriteStream;
