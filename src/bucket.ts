import { S3, type S3Options } from '@pipobscure/s3';
import { Backend, ConflictToken, makePath, makePrefixPath, type ContentId, assertMimeType, type MimeType } from './backend.ts';
import type { Readable, Writable } from 'stream';
import * as FS from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import * as PT from 'node:path';
import * as CR from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export type BucketOptions = { prefix?: string; } & S3Options;

export class Bucket extends Backend {
    #prefix;
    #client;
    constructor(opts: BucketOptions) {
        super();
        const prefix = (opts.prefix ?? '').split('/').filter(x => !!x.trim());
        this.#prefix = [...(opts.prefix ?? '').split('/').filter(x => !!x.trim()), ''].join('/');
        this.#client = new S3(opts);
    }
    async token(id: ContentId): Promise<ConflictToken> {
        const headers = await this.#client.head(`${this.#prefix}${makePath(id)}`);
        if (!headers.etag) throw new Error('no token available');
        return new ConflictToken(headers.etag);
    }
    async exists(id: ContentId) {
        try {
            await this.#client.head(`${this.#prefix}${makePath(id)}`);
            return true;
        } catch {
            return false;
        }
    }
    async *list(prefix: string) {
        try {
            const list = await this.#client.list(`${this.#prefix}${makePrefixPath(prefix)}`, '/');
            for (const { name } of list) yield name;
        } catch {
            return;
        }
    }
    async type(id: ContentId): Promise<MimeType> {
        const hdr = await this.#client.head(`${this.#prefix}${makePath(id)}`);
        const type = hdr['content-type'] ?? 'application/octet-stream';
        assertMimeType(type);
        return type;
    }
    async hash(id: ContentId) {
        const hdr = await this.#client.head(`${this.#prefix}${makePath(id)}`);
        return hdr['etag'] ?? null;
    }
    async read(id: ContentId) {
        try {
            const name = `${this.#prefix}${makePath(id)}`;
            const content = await this.#client.get(name);
            if (!content) return null;
            const headers = await this.#client.head(name);
            const type = headers['content-type'] ?? 'application/octet-stream';
            assertMimeType(type);
            return { type, content };
        } catch {
            return null;
        }
    };
    async write(id: ContentId, content: Buffer<ArrayBufferLike>, type: MimeType = 'application/octet-stream', token?: ConflictToken) {
        try {
            const props: any = { type };
            if (token) props['If-Match'] = ConflictToken.value(token);
            await this.#client.put(`${this.#prefix}${makePath(id)}`, content, props);
            return true;
        } catch {
            return false;
        }
    }
    async delete(id: ContentId) {
        try {
            await this.#client.del(`${this.#prefix}${makePath(id)}`);
            return true;
        } catch {
            return false;
        }
    }
    async readStream(id: ContentId, stream: Writable) {
        try {
            const { content, type } = await this.read(id) ?? {};
            if (!content || !type) return null;
            stream.end(content);
            return type;
        } catch {
            return null
        }
    }
    async writeStream(id: ContentId, stream: Readable, type: MimeType = 'application/octet-stream', token?: ConflictToken): Promise<boolean> {
        try {
            const chunks = [];
            let length = 0;
            for await (const chunk of stream) {
                chunks.push(chunk);
                length += chunk.length;
            }
            return await this.write(id, Buffer.concat(chunks, length), type, token);
        } catch {
            return false;
        }
    }
    async hashStream(stream: Readable, type?: MimeType): Promise<ContentId | null> {
        try {
            await using dir = await FS.mkdtempDisposable('store');
            const hashdg = CR.createHash('sha-512');
            const output = createWriteStream(PT.join(dir.path, 'data'));
            await pipeline(stream, async function* (source: Readable) {
                for await (const chunk of source) {
                    hashdg.update(chunk);
                    yield chunk;
                }
            }, output);
            const hash = hashdg.digest('hex');
            const input = createReadStream(PT.join(dir.path, 'data'));
            if (!await this.writeStream(hash, input, type)) return null;
            return hash;
        } catch {
            return null
        }
    }
}