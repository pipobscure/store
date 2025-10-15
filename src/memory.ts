import * as CR from 'node:crypto';

import { assertContentPrefix, Backend, ConflictToken, type ContentId, type MimeType } from "./backend.ts";
import type { Readable, Writable } from 'node:stream';

export class Memory extends Backend {
    #mem: Record<ContentId, { type: MimeType, hash: ContentId, data: Buffer<ArrayBufferLike>}> = {};
    constructor() {
        super();
    }
    async token(id: ContentId) {
        const hash = this.#mem[id]?.hash;
        if (!hash) return null;
        return new ConflictToken(hash);
    }
    async exists(id: ContentId) {
        return !!this.#mem[id];
    }
    async *list(prefix: string) {
        assertContentPrefix(prefix);
        for (const key of Object.keys(this.#mem)) {
            if (key.startsWith(prefix)) yield key;
        }
    }
    async type(id: ContentId) {
        const type = this.#mem[id]?.type ?? null;
        return type;
    }
    async hash(id: ContentId) {
        return this.#mem[id]?.hash ?? null
    }
    async read(id: ContentId) {
        const { data = null, type } = this.#mem[id] ?? {};
        if (!data || !type) return null
        return { content: data, type };
    }
    async write(id: ContentId, content: Buffer<ArrayBufferLike>, type: MimeType = 'application/octet-stream', token?: ConflictToken){
        if (token && (ConflictToken.value(token) !== this.#mem[id]?.hash)) return false;
        const hash = CR.createHash('sha-512').update(content).digest('hex');
        this.#mem[id] = { type, hash, data: content};
        return true;
    }
    async delete(id: ContentId){
        const exists = !!this.#mem[id];
        delete this.#mem[id];
        return exists;
    }
    async readStream(id: ContentId, stream: Writable) {
        const {content, type} = await this.read(id) ?? {};
        if (!content || !type) return null;
        stream.end(content);
        return type;
    }
    async writeStream(id: ContentId, stream: Readable, type?: MimeType, token?: ConflictToken) {
        const chunks = [];
        let length = 0;
        for await (const chunk of stream) {
            chunks.push(chunk);
            length += chunk.length;
        }
        return await this.write(id, Buffer.concat(chunks), type, token);
    }
    async hashStream(stream: Readable, type?: MimeType) {
        const hashdg = CR.createHash('sha-512');
        const chunks = [];
        let length = 0;
        for await (const chunk of stream) {
            chunks.push(chunk);
            length += chunk.length;
            hashdg.update(chunk);
        }
        const hash = hashdg.digest('hex');
        if (!this.write(hash, Buffer.concat(chunks, length), type)) {
            return null;
        }
        return hash;
    }
}

