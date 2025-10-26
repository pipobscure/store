import * as CR from 'node:crypto';

import { assertContentId, type Backend, type ConflictToken, type ContentId, isContentId, isMimeType, type MimeType } from './backend.ts';

export type TagData = {
	name: string;
	cid: ContentId | null;
	type: MimeType;
	date: number;
	pre: ContentId | null;
};
export function isTagData(value: any): value is TagData {
	if (!value || 'object' !== typeof value) return false;
	if ('string' !== typeof value.name) return false;
	if (value.cid !== null && !isContentId(value.cid)) return false;
	if (!isMimeType(value.type)) return false;
	if (!('date' in value) || 'number' !== typeof value.date) return false;
	if (value.pre && !isContentId(value.pre)) return false;
	return true;
}
export function assertTagData(value: any): asserts value is TagData {
	if (!isTagData(value)) throw new TypeError('invalid TagData');
}

export class Frontend {
	#back;
	constructor(backend: Backend) {
		this.#back = backend;
	}
	async exists(cid: ContentId, options?: { signal?: AbortSignal | undefined }) {
		return await this.#back.exists(cid, options?.signal);
	}
	async type(cid: ContentId, options?: { signal?: AbortSignal | undefined }) {
		return await this.#back.type(cid, options?.signal);
	}
	async #text(cid: ContentId, cnt?: string, type?: MimeType, token?: ConflictToken, signal?: AbortSignal) {
		if (cnt !== undefined) {
			await this.#back.write(cid, Buffer.from(cnt), type ?? 'text/plain', token, signal);
		}
		const { content } = (await this.#back.read(cid, signal)) ?? {};
		return content?.toString('utf-8') ?? null;
	}
	async push(
		content: Buffer<ArrayBufferLike>,
		options?: {
			type?: MimeType | undefined;
			signal?: AbortSignal | undefined;
		},
	) {
		const cid = hash(content);
		const token = await this.#back.token(cid, options?.signal);
		if (await this.#back.write(cid, content, options?.type ?? 'application/octet-stream', token ?? undefined, options?.signal)) {
			return cid;
		}
		return null;
	}
	async pull(cid: ContentId, options?: { signal?: AbortSignal | undefined }) {
		const { content } = (await this.#back.read(cid, options?.signal)) ?? {};
		return content ?? null;
	}
	async pushStream(
		stream: AsyncIterable<Buffer>,
		options?: {
			type?: MimeType | undefined;
			signal?: AbortSignal | undefined;
		},
	) {
		try {
			const tmpnam = nameId(`${CR.randomUUID()}`);
			const hash = CR.createHash('sha-512');
			const reader = async function* () {
				for await (const chunk of stream) {
					hash.update(chunk);
					yield chunk;
				}
			};
			await this.#back.writeStream(tmpnam, reader(), options?.type ?? 'application/octet-stream', undefined, options?.signal);
			const cid = hash.digest('hex');
			await this.#back.rename(tmpnam, cid);
			return cid;
		} catch (e) {
			if ((e as any).status === 412 || (e as any).status === 409) return null;
			throw e;
		}
	}
	pullStream(cid: ContentId, options?: { signal?: AbortSignal | undefined }) {
		return this.#back.readStream(cid, options?.signal);
	}

	async has(name: string, options?: { signal?: AbortSignal | undefined }) {
		const tag = await this.tag(name, options);
		if (!tag?.cid) return false;
		return await this.exists(tag.cid, options);
	}
	async tag(name: string, options?: { signal?: AbortSignal | undefined }) {
		const nid = nameId(name);
		const tid = await this.#text(nid, undefined, undefined, undefined, options?.signal);
		if (!tid) return null;
		const txt = await this.#text(tid, undefined, undefined, undefined, options?.signal);
		if (!txt) return null;
		const dat = JSON.parse(txt);
		if (!dat) return null;
		assertTagData(dat);
		return dat;
	}
	async *tags(name: string, options?: { signal?: AbortSignal | undefined }) {
		let tag = await this.tag(name, options);
		while (tag) {
			options?.signal?.throwIfAborted();
			if (tag) assertTagData(tag);
			yield tag;
			tag = !tag.pre ? null : JSON.parse((await this.#text(tag.pre, undefined, undefined, undefined, options?.signal)) ?? 'null');
		}
	}
	async token(name: string, options?: { signal?: AbortSignal | undefined }) {
		const nid = nameId(name);
		return await this.#back.token(nid, options?.signal);
	}
	async set(
		name: string,
		content: Buffer<ArrayBufferLike> | string | object,
		options: {
			token?: ConflictToken | null;
			type?: MimeType | undefined;
			signal?: AbortSignal | undefined;
		} = {},
	) {
		let { type, signal, token } = options;
		if ('string' === typeof content) {
			content = Buffer.from(content);
			type = type ?? 'text/plain; charset=utf-8';
		}
		if (!Buffer.isBuffer(content)) {
			content = Buffer.from(JSON.stringify(content));
			type = type ?? 'application/json; charset=utf-8';
		}
		type = type ?? 'application/octet-stream';

		const cid = await this.push(content as Buffer, { type, signal });
		const nid = nameId(name);
		const pre = await this.#text(nid);
		const tagdata = { name, cid, type, date: Date.now(), pre };
		assertTagData(tagdata);
		const tid = await this.push(Buffer.from(JSON.stringify(tagdata)), {
			type: 'application/json; charset=utf-8',
			signal,
		});
		if (!tid) return false;
		return null !== (await this.#text(nid, tid, 'text/sha-512', token ?? undefined, signal));
	}
	async get(name: string, options?: { signal?: AbortSignal | undefined }) {
		const tag = await this.tag(name, options);
		if (!tag?.cid) return null;
		return this.pull(tag.cid, options);
	}
	async text(name: string, options?: { signal?: AbortSignal | undefined }) {
		const text = await this.get(name, options);
		if (!text) return null;
		return text.toString('utf-8');
	}
	async json(name: string, options?: { signal?: AbortSignal | undefined }) {
		const text = await this.text(name, options);
		if (!text) return null;
		return JSON.parse(text);
	}
	async *readStream(name: string, options?: { signal?: AbortSignal | undefined }) {
		const tag = await this.tag(name);
		if (!tag?.cid) return null;
		yield* this.pullStream(tag.cid, options);
	}
	async writeStream(
		name: string,
		stream: AsyncIterable<Buffer>,
		options: {
			token?: ConflictToken | null | undefined;
			type?: MimeType | undefined;
			signal?: AbortSignal | undefined;
		} = {},
	) {
		const { token = null, type = 'application/octet-stream', signal } = options;
		const cid = await this.pushStream(stream, options);
		if (!cid) return null;
		const nid = nameId(name);
		const pre = await this.#text(nid, undefined, undefined, undefined, signal);
		const tagdata = { name, cid, type, date: Date.now(), pre };
		assertTagData(tagdata);
		const tid = await this.push(Buffer.from(JSON.stringify(tagdata)), {
			type: 'application/json; charset=utf-8',
			signal,
		});
		if (!tid) return false;
		return null !== (await this.#text(nid, tid, 'text/sha-512', token ?? undefined, signal));
	}
	async copy(
		source: string,
		target: string,
		options?: {
			token?: ConflictToken | null | undefined;
			signal?: AbortSignal | undefined;
		},
	) {
		const nid = nameId(source);
		const [pre, tag] = await Promise.all([this.#text(nid, undefined, undefined, undefined, options?.signal), this.tag(source)]);
		if (!pre || !tag) return false;
		const tagdata = { ...tag, pre, name: target };
		assertTagData(tagdata);
		const ntid = await this.push(Buffer.from(JSON.stringify(tagdata)), {
			type: 'application/json; charset=utf-8',
			signal: options?.signal,
		});
		if (!ntid) return false;
		const written = await this.#text(nameId(target), ntid, 'text/sha-512', options?.token ?? undefined, options?.signal);
		return written === ntid;
	}
	async delete(
		name: string,
		options?: {
			token?: ConflictToken | null | undefined;
			signal?: AbortSignal | undefined;
		},
	) {
		const nid = nameId(name);
		const tok = options?.token;
		const pre = await this.#text(nid, undefined, undefined, undefined, options?.signal);
		if (!pre) return true;
		const tagdata = {
			cid: null,
			name,
			type: 'application/empty',
			date: Date.now(),
			pre,
		};
		assertTagData(tagdata);
		const tid = await this.push(Buffer.from(JSON.stringify(tagdata)), {
			type: 'application/json',
			signal: options?.signal,
		});
		if (!tid) return false;
		const success = await this.#text(nid, tid, 'text/sha-512', tok ?? undefined, options?.signal);
		return success === tid;
	}
}

function hash(data: string | Buffer<ArrayBufferLike>): string {
	return CR.createHash('sha512').update(data).digest('hex');
}
function nameId(data: string): ContentId {
	const namehash = `-${hash(data)}`;
	assertContentId(namehash);
	return namehash;
}
