import { S3, type S3Options } from '@pipobscure/s3';
import {
	Backend,
	ConflictToken,
	makePath,
	type ContentId,
	assertMimeType,
	type MimeType,
} from './backend.ts';

export type BucketOptions = { prefix?: string } & S3Options;

export class Bucket extends Backend {
	#prefix;
	#client;
	constructor(opts: BucketOptions) {
		super();
		const { prefix = '', ...options } = opts;
		this.#prefix = [
			...(prefix ?? '').split('/').filter((x) => !!x.trim()),
			'',
		].join('/');
		this.#client = new S3(options);
	}
	async token(id: ContentId, signal?: AbortSignal) {
		try {
			const headers = await this.#client.head(
				`${this.#prefix}${makePath(id)}`,
				signal,
			);
			if (!headers.etag) throw new Error('no token available');
			return new ConflictToken(this, headers.etag);
		} catch (e) {
			if ((e as any).status === 404) return null;
			throw e;
		}
	}
	async exists(id: ContentId, signal?: AbortSignal) {
		try {
			await this.#client.head(`${this.#prefix}${makePath(id)}`, signal);
			return true;
		} catch (e) {
			if ((e as any).status === 404) return false;
			throw e;
		}
	}
	async *list(signal?: AbortSignal) {
		const list = this.#client.list(`${this.#prefix}}`, signal);
		for await (const { name } of list) {
			const item = name.split('/').pop();
			if (item) yield item;
		}
	}
	async type(id: ContentId, signal?: AbortSignal) {
		try {
			const hdr = await this.#client.head(
				`${this.#prefix}${makePath(id)}`,
				signal,
			);
			const type = hdr.type ?? 'application/octet-stream';
			assertMimeType(type);
			return type;
		} catch (e) {
			if ((e as any).status === 404) return null;
			throw e;
		}
	}
	async hash(id: ContentId, signal?: AbortSignal) {
		try {
			const hdr = await this.#client.head(
				`${this.#prefix}${makePath(id)}`,
				signal,
			);
			return hdr.etag ?? null;
		} catch (e) {
			if ((e as any).status === 404) return null;
			throw e;
		}
	}
	async read(id: ContentId, signal?: AbortSignal) {
		try {
			const name = `${this.#prefix}${makePath(id)}`;
			const content = (await this.#client.get(name, signal)) as null | Buffer;
			if (!content) return null;
			const headers = await this.#client.head(name);
			const type = headers.type ?? 'application/octet-stream';
			assertMimeType(type);
			return { type, content };
		} catch (e) {
			if ((e as any).status === 404) return null;
			throw e;
		}
	}
	async #etag(resource: string, signal?: AbortSignal) {
		try {
			return (await this.#client.head(resource, signal)).etag || undefined;
		} catch (e) {
			if ((e as any).status === 404) return undefined;
			throw e;
		}
	}
	async write(
		id: ContentId,
		content: Buffer<ArrayBufferLike>,
		type: MimeType = 'application/octet-stream',
		token?: ConflictToken,
		signal?: AbortSignal,
	) {
		const resource = `${this.#prefix}${makePath(id)}`;
		try {
			const etag = await this.#etag(resource, signal);
			if (token && etag !== token.value(this)) return false;
			await this.#client.put(resource, content, type, etag, signal);
			return true;
		} catch (e) {
			if ((e as any).status === 412 || (e as any).status === 409) return false;
			throw e;
		}
	}
	async delete(id: ContentId, token: ConflictToken, signal?: AbortSignal) {
		try {
			const etag = (await this.hash(id)) ?? null;
			if (!etag) return false;
			if (etag !== token.value(this)) return false;
			await this.#client.del(`${this.#prefix}${makePath(id)}`, etag, signal);
			return true;
		} catch (e) {
			if ((e as any).status === 412 || (e as any).status === 409) return false;
			throw e;
		}
	}
	readStream(id: ContentId, signal?: AbortSignal) {
		const stream = this.#client.stream(
			`${this.#prefix}${makePath(id)}`,
			signal,
		);
		return stream;
	}
	async writeStream(
		id: ContentId,
		stream: AsyncIterable<Buffer>,
		type: MimeType = 'application/octet-stream',
		token?: ConflictToken,
		signal?: AbortSignal,
	): Promise<boolean> {
		try {
			const result = await this.#client.put(
				`${this.#prefix}${makePath(id)}`,
				stream,
				type,
				token?.value(this),
				signal,
			);
			return !!result;
		} catch (e) {
			if ((e as any).status === 412 || (e as any).status === 409) return false;
			throw e;
		}
	}
	async #exists(resource: string, signal?: AbortSignal) {
		try {
			const data = await this.#client.head(resource, signal);
			return data?.etag || undefined;
		} catch (e) {
			if ((e as any).status === 404) return undefined;
			throw e;
		}
	}
	async rename(source: ContentId, target: ContentId, signal?: AbortSignal) {
		const [sExists, tExists] = await Promise.all([
			this.exists(source),
			this.exists(target),
		]);
		if (!sExists || tExists) return false;
		const sName = `${this.#prefix}${makePath(source)}`;
		const tName = `${this.#prefix}${makePath(target)}`;
		await this.#client.copy(tName, sName, undefined, signal);
		await this.#client.del(sName, undefined, signal);
		return true;
	}
}
