import * as ZL from 'node:zlib';
import {
	Backend,
	type ContentId,
	type ConflictToken,
	type MimeType,
} from './backend.ts';
import type { Duplex } from 'node:stream';

type CompressionCallback = (
	err: Error | null,
	result: Buffer<ArrayBufferLike> | undefined,
) => void;
type CompresstionFunction = (
	buffer: Buffer<ArrayBufferLike>,
	cb: CompressionCallback,
) => void;
type CompressionCreator = () => Duplex;

const METHODS: Record<
	string,
	[
		CompresstionFunction,
		CompresstionFunction,
		CompressionCreator,
		CompressionCreator,
	]
> = {
	brotli: [
		ZL.brotliCompress,
		ZL.brotliDecompress,
		ZL.createBrotliCompress,
		ZL.createBrotliDecompress,
	],
	gzip: [ZL.gzip, ZL.gunzip, ZL.createGzip, ZL.createGunzip],
	deflate: [ZL.deflate, ZL.inflate, ZL.createDeflate, ZL.createInflate],
	zstd: [
		ZL.zstdCompress,
		ZL.zstdDecompress,
		ZL.createZstdCompress,
		ZL.createZstdDecompress,
	],
} as const;

function wrapMethods(
	compress: CompresstionFunction,
	decompress: CompresstionFunction,
	compressor: CompressionCreator,
	decompressor: CompressionCreator,
) {
	return {
		async compress(content: Buffer<ArrayBufferLike>) {
			const deferred = Promise.withResolvers<Buffer<ArrayBufferLike>>();
			compress(content, (err, result) => {
				if (err || !result)
					return deferred.reject(err ?? new Error('missing result'));
				deferred.resolve(result);
			});
			const result = await deferred.promise;
			return result;
		},
		async decompress(content: Buffer<ArrayBufferLike>) {
			const deferred = Promise.withResolvers<Buffer<ArrayBufferLike>>();
			decompress(content, (err, result) => {
				if (err || !result)
					return deferred.reject(err ?? new Error('missing result'));
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
		},
	};
}

export class Compression extends Backend {
	#back;
	#methods;
	constructor(backend: Backend, method: keyof typeof METHODS = 'deflate') {
		super();
		this.#back = backend;
		if (!METHODS[method])
			throw new Error(`invalid compression method: ${method}`);
		this.#methods = wrapMethods(...METHODS[method]);
	}
	token(id: ContentId, signal?: AbortSignal) {
		return this.#back.token(id, signal);
	}
	exists(id: ContentId, signal?: AbortSignal) {
		return this.#back.exists(id, signal);
	}
	list(signal?: AbortSignal) {
		return this.#back.list(signal);
	}
	type(id: ContentId, signal?: AbortSignal) {
		return this.#back.type(id, signal);
	}
	hash(id: ContentId, signal?: AbortSignal) {
		return this.#back.hash(id, signal);
	}
	async read(id: ContentId, signal?: AbortSignal) {
		const { content, type } = (await this.#back.read(id, signal)) ?? {};
		if (!content || !type) return null;
		return { content: await this.#methods.decompress(content), type };
	}
	async write(
		id: ContentId,
		content: Buffer<ArrayBufferLike>,
		type: MimeType = 'application/octet-stream',
		token?: ConflictToken,
		signal?: AbortSignal,
	) {
		const compressed = await this.#methods.compress(content);
		return await this.#back.write(id, compressed, type, token, signal);
	}
	delete(
		id: ContentId,
		token: ConflictToken,
		signal?: AbortSignal,
	): Promise<boolean> {
		return this.#back.delete(id, token, signal);
	}
	readStream(id: ContentId, signal?: AbortSignal) {
		const decompressor = this.#methods.decompressor();
		const stream = this.#back.readStream(id, signal);
		(async () => {
			try {
				for await (const chunk of stream) {
					signal?.throwIfAborted();
					const deferred = Promise.withResolvers<void>();
					decompressor.write(chunk, (err) => {
						if (err) return deferred.reject(err);
						deferred.resolve();
					});
					await deferred.promise;
				}
				const deferred = Promise.withResolvers<void>();
				decompressor.end(() => deferred.resolve());
				await deferred.promise;
			} catch {}
		})();
		return decompressor;
	}
	async writeStream(
		id: ContentId,
		stream: AsyncIterable<Buffer>,
		type?: MimeType,
		token?: ConflictToken,
		signal?: AbortSignal,
	) {
		try {
			const compressor = this.#methods.compressor();
			(async () => {
				try {
					for await (const chunk of stream) {
						signal?.throwIfAborted();
						const deferred = Promise.withResolvers<void>();
						compressor.write(chunk, (err) => {
							if (err) return deferred.reject(err);
							deferred.resolve();
						});
						await deferred.promise;
					}
					const deferred = Promise.withResolvers<void>();
					compressor.end(() => deferred.resolve());
					await deferred.promise;
				} catch (err) {
					compressor.emit('error', err);
				}
			})();
			const result = await this.#back.writeStream(
				id,
				compressor,
				type,
				token,
				signal,
			);
			return result;
		} catch {
			return false;
		}
	}
	rename(source: ContentId, target: ContentId, signal?: AbortSignal) {
		return this.#back.rename(source, target, signal);
	}
}
