import * as CR from 'node:crypto';

import { type Backend, type ContentId, type ConflictToken, type MimeType, assertContentId } from "./backend.ts";
import { Transform, type Readable } from 'node:stream';

type TagData = {
    cid: ContentId | null;
    type: MimeType;
    date: number;
    pre: ContentId | null;
}
function assertTagData(value: any) : asserts value is TagData {
}

export class Frontend {
    #back;
    constructor(backend: Backend) {
        this.#back = backend;
    }
    async #text(cid: ContentId, cnt?: string, type?: MimeType, token?: ConflictToken) {
        if(cnt !== undefined) {
            await this.#back.write(cid, Buffer.from(cnt), type ?? 'text/plain', token);
        }
        const { content } = await this.#back.read(cid) ?? {};
        return content?.toString('utf-8') ?? null;
    }
    async push(content: Buffer<ArrayBufferLike>, type?: MimeType) {
        const cid = hash(content);
        if (await this.#back.write(cid, content, type ?? 'application/octet-stream')) {
            return cid;
        }
        return null;
    }
    async pull(cid: ContentId) {
        const { content } = await this.#back.read(cid) ?? {};
        return content ?? null;
    }
    async pushStream(stream: Readable, type?: MimeType) {
        return await this.#back.hashStream(stream, type);
    }
    async pullStream(cid: ContentId) {
        const type = this.type(cid);
        if (!type) return null;
        const stream = new Transform({
            transform(chunk, _encoding, callback) {
                this.push(chunk);
                callback();
            }
        });
        this.#back.readStream(cid, stream);
        return {
            get type() {
                return type;
            },
            get stream() {
                return stream as Readable
            }
        };
    }
    async type(cid: ContentId) {
        return await this.#back.type(cid);
    }
    
    async tag(name: string) {
        const nid = nameId(name);
        const tid = await this.#text(nid);
        if (!tid) return null;
        const dat = JSON.parse(await this.#text(tid) ?? 'null');
        if (!dat) return null;
        assertTagData(dat);
        return dat;
    }
    async *tags(name: string) {
        let tag = await this.tag(name);
        while (tag) {
            if (tag) assertTagData(tag);
            yield tag;
            tag = !tag.pre ? null: JSON.parse(await this.#text(tag.pre) ?? 'null');
        }
    }
    async token(name: string) {
        const nid = nameId(name);
        return await this.#back.token(nid);
    }
    async set(name: string, content: Buffer<ArrayBufferLike>, type?: MimeType, token?: ConflictToken) {
        const cid = await this.push(content, type);
        const nid = nameId(name);
        const pre = await this.#text(nid);
        const tid = await this.push(Buffer.from(JSON.stringify({ cid, type, date: Date.now(), pre })), 'application/json');
        if (!tid) return false;
        return null !== await this.#text(nid, tid, 'text/sha-512', token);
    }
    async get(name: string) {
        const nid = nameId(name);
        const tid = await this.#text(nid);
        if (!tid) return null;
        const tag = await this.tag(tid);
        if (!tag?.cid) return null;
        return this.pull(tag.cid);
    }
    async readStream(name: string) {
        const nid = nameId(name);
        const tid = await this.#text(nid);
        if (!tid) return null;
        const tag = await this.tag(tid);
        if (!tag?.cid) return null;
        return this.pullStream(tag.cid);
    }
    async writeStream(name: string, stream: Readable,  type?: MimeType, token?: ConflictToken) {
        const cid = await this.#back.hashStream(stream, type);
        if (!cid) return null;
        type = (await this.type(cid)) ?? undefined;
        const nid = nameId(name);
        const pre = await this.#text(nid);
        const tid = await this.push(Buffer.from(JSON.stringify({ cid, type, date: Date.now(), pre })), 'application/json');
        if (!tid) return false;
        return null !== await this.#text(nid, tid, 'text/sha-512', token);
    }
    async delete(name: string) {
        const nid = nameId(name);
        const tok = await this.#back.token(nid);
        const pre = await this.#text(nid);
        if (!pre) return;
        const tid = await this.push(Buffer.from(JSON.stringify({ cid: null, type: 'application/empty', date: Date.now(), pre })));
        if (!tid) return false;
        await this.#text(nid, tid, 'text/sha-512', tok ?? undefined);
    }
}

function hash(data: string | Buffer<ArrayBufferLike>) : string {
    return CR.createHash('sha256').update(data).digest('hex');
}
function nameId(data: string) : ContentId {
    const namehash = `-${hash(data)}`;
    assertContentId(namehash);
    return namehash;
}

