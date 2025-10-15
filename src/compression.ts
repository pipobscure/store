import * as ZL from 'node:zlib';
import { Backend, type ContentId, type ConflictToken, type MimeType } from "./backend.ts";
import type { Readable, Writable } from 'stream';
import { type Duplex } from 'node:stream';

type CompressionCallback = (err: Error | null, result: Buffer<ArrayBufferLike> | undefined) => void;
type CompresstionFunction = (buffer: Buffer<ArrayBufferLike>, cb: CompressionCallback) => void;
type CompressionCreator = () => Duplex;

const METHODS: Record<string, [CompresstionFunction, CompresstionFunction, CompressionCreator, CompressionCreator]> = {
    brotli: [ZL.brotliCompress, ZL.brotliDecompress, ZL.createBrotliCompress, ZL.createBrotliDecompress],
    gzip: [ZL.gzip, ZL.gunzip, ZL.createGzip, ZL.createGunzip],
    deflate: [ZL.deflate, ZL.inflate, ZL.createDeflate, ZL.createInflate ],
    zstd: [ZL.zstdCompress, ZL.zstdDecompress, ZL.createZstdCompress, ZL.createZstdDecompress]
} as const;

function wrapMethods(compress: CompresstionFunction, decompress: CompresstionFunction, compressor: CompressionCreator, decompressor: CompressionCreator) {
    return {
        async compress(content: Buffer<ArrayBufferLike>) {
            const deferred = Promise.withResolvers<Buffer<ArrayBufferLike>>();
            compress(content, (err, result) => {
                if (err || !result) return deferred.reject(err ?? new Error('missing result'));
                deferred.resolve(result);
            });
            const result = await deferred.promise;
            return result
        },
        async decompress(content: Buffer<ArrayBufferLike>) {
            const deferred = Promise.withResolvers<Buffer<ArrayBufferLike>>();
            decompress(content, (err, result) => {
                if (err || !result) return deferred.reject(err ?? new Error('missing result'));
                deferred.resolve(result);
            });
            const result = await deferred.promise;
            return result;
        },
        compressor() {
            return compressor();
        },
        decompressor() {
            return decompressor();
        }
    }
}

export class Compression extends Backend {
    #back;
    #methods;
    constructor(backend: Backend, method: keyof typeof METHODS = 'deflate') {
        super();
        this.#back = backend;
        if (!METHODS[method]) throw new Error(`invalid compression method: ${method}`);
        this.#methods = wrapMethods(...METHODS[method]);
    }
    token(id: ContentId) {
        return this.#back.token(id);
    }
    exists(id: ContentId) {
        return this.#back.exists(id);
    }
    list(prefix: string) {
        return this.#back.list(prefix);
    }
    type(id: ContentId) {
        return this.#back.type(id);
    }
    hash(id: ContentId) {
        return this.#back.hash(id);
    }
    async read(id: ContentId) {
        const { content, type } = await this.#back.read(id) ?? {};
        if (!content || !type) return null;
        return { content: await this.#methods.decompress(content), type };
    }
    async write(id: ContentId, content: Buffer<ArrayBufferLike>, type: MimeType = 'application/octet-stream', token?: ConflictToken) {
        const compressed = await this.#methods.compress(content);
        return await this.#back.write(id, compressed, type, token);
    }
    delete(id: ContentId): Promise<boolean> {
        return this.#back.delete(id);
    }
    async readStream(id: ContentId, stream: Writable): Promise<null | MimeType> {
        try {
            const decompressor = this.#methods.decompressor();
            decompressor.pipe(stream)
            return await this.#back.readStream(id, decompressor);
        } catch {
            return null;
        }
    }
    async writeStream(id: ContentId, stream: Readable, type?: MimeType, token?: ConflictToken) {
        try {
            const compressor = this.#methods.compressor();
            stream.pipe(compressor);
            return await this.#back.writeStream(id, compressor, type, token);
        } catch {
            return false;
        }
    }
    async hashStream(stream: Readable, type?: MimeType) {
        try {
            const compressor = this.#methods.compressor();
            stream.pipe(compressor);
            return await this.#back.hashStream(compressor, type);
        } catch {
            return null;
        }
    }
}



