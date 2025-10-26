import * as CR from 'node:crypto';

import { Backend, ConflictToken, type ContentId, type MimeType } from './backend.ts';

export class Memory extends Backend {
	#mem: Record<ContentId, { type: MimeType; hash: ContentId; data: Buffer<ArrayBufferLike> }> = {};
	constructor() {
		super();
	}
	async token(id: ContentId) {
		const hash = this.#mem[id]?.hash;
		if (!hash) return null;
		return new ConflictToken(this, hash);
	}
	async exists(id: ContentId) {
		return !!this.#mem[id];
	}
	async *list() {
		yield* Object.keys(this.#mem);
	}
	async type(id: ContentId) {
		const type = this.#mem[id]?.type ?? null;
		return type;
	}
	async hash(id: ContentId) {
		return this.#mem[id]?.hash ?? null;
	}
	async read(id: ContentId) {
		const { data = null, type } = this.#mem[id] ?? {};
		if (!data || !type) return null;
		return { content: data, type };
	}
	async write(id: ContentId, content: Buffer<ArrayBufferLike>, type: MimeType = 'application/octet-stream', token?: ConflictToken) {
		if (token?.value(this) !== this.#mem[id]?.hash) return false;
		if (!token && this.#mem[id]) return false;
		const hash = CR.createHash('sha-512').update(content).digest('hex');
		this.#mem[id] = { type, hash, data: content };
		return true;
	}
	async delete(id: ContentId, token: ConflictToken) {
		if (token.value(this) !== this.#mem[id]?.hash) return false;
		delete this.#mem[id];
		return true;
	}
	async *readStream(id: ContentId) {
		const { content } = (await this.read(id)) ?? {};
		if (content) yield content;
	}
	async writeStream(id: ContentId, stream: AsyncIterable<Buffer>, type?: MimeType, token?: ConflictToken) {
		const chunks = [];
		let length = 0;
		for await (const chunk of stream) {
			chunks.push(chunk);
			length += chunk.length;
		}
		return await this.write(id, Buffer.concat(chunks, length), type, token);
	}
	async rename(source: ContentId, target: ContentId, _signal?: AbortSignal) {
		const [sExists, tExists] = await Promise.all([this.exists(source), this.exists(target)]);
		if (!sExists || tExists) return false;
		this.#mem[target] = this.#mem[source] as {
			type: MimeType;
			hash: ContentId;
			data: Buffer;
		};
		delete this.#mem[source];
		return true;
	}
}
