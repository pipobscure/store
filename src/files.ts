import * as PT from 'node:path';
import * as FS from 'node:fs/promises';
import * as CR from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';

import { Lock } from './lock.ts';

import { type ContentId, type MimeType, assertContentId, assertMimeType, Backend, ConflictToken, makePath, makePrefixPath } from './backend.ts';
import type { Readable, Writable } from 'stream';
import { pipeline } from 'node:stream/promises';

export class Files extends Backend {
    #base;
    constructor(base: string) {
        super();
        this.#base = PT.resolve(base);
    }
    async token(id: ContentId): Promise<ConflictToken | null> {
        try {
            const name = PT.join(this.#base, makePath(id));
            const { hash } = JSON.parse(await FS.readFile(`${name}.data`, 'utf-8'));
            return new ConflictToken(hash);
        } catch {
            return null
        }
    }
    async exists(id: ContentId) {
        try {
            await FS.access(PT.join(this.#base, makePath(id)));
            return true;
        } catch {
            return false;
        }
    }
    async *list(prefix: string) {
        const dir = await FS.opendir(PT.join(this.#base, makePrefixPath(prefix)), { recursive: true });
        for await (const item of dir) {
            if (!item.isFile()) continue;
            yield item.name;
        }
    }
    async type(id: ContentId) {
        try {
            const name = PT.join(this.#base, makePath(id));
            const { type } = JSON.parse(await FS.readFile(`${name}.data`, 'utf-8'));
            assertMimeType(type);
            return type;
        } catch {
            return null;
        }
    }
    async hash(id: ContentId) {
        try {
            const name = PT.join(this.#base, makePath(id));
            const { hash } = JSON.parse(await FS.readFile(`${name}.data`, 'utf-8'));
            assertContentId(hash);
            return hash;
        } catch {
            return null;
        }
    }
    async read(id: ContentId) {
        try {
            const name = PT.join(this.#base, makePath(id));
            const [content, datastr] = await Promise.all([
                FS.readFile(name),
                FS.readFile(`${name}.data`, 'utf-8'),
            ]);
            const { type } = JSON.parse(datastr);
            assertMimeType(type);
            return { content, type };
        } catch {
            return null;
        }
    }
    async write(id: ContentId, content: Buffer<ArrayBufferLike>, type: MimeType = 'application/octet-stream', token?: ConflictToken) {
        const name = PT.join(this.#base, makePath(id));
        await FS.mkdir(PT.dirname(name), { recursive: true });
        await using lock = token ? await Lock.await(name, AbortSignal.timeout(30000)) : null;
        try {
            const current = lock ? await this.hash(id) : null;
            const hash = CR.createHash('sha-512').update(content).digest('hex');
            if (token && current && (ConflictToken.value(token) !== current)) return false;
            await Promise.all([
                FS.writeFile(name, content),
                FS.writeFile(`${name}.data`, JSON.stringify({ type, hash }))
            ]);
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }
    async delete(id: ContentId) {
        try {
            const name = PT.join(this.#base, makePath(id));
            await Promise.all([
                FS.unlink(name),
                FS.unlink(`${name}.data`),
            ]);
            return true;
        } catch {
            return false;
        }
    }
    async readStream(id: ContentId, stream: Writable) {
        try {
            const name = PT.join(this.#base, makePath(id));
            const input = createReadStream(name);
            const deferred = Promise.withResolvers<void>()
            stream.on('close', deferred.resolve);
            stream.on('error', deferred.reject);
            input.on('error', deferred.reject)
            input.pipe(stream);
            await deferred.promise;
            const type = await this.type(id);
            return type ?? null;
        } catch {
            return null;
        }
    }
    async writeStream(id: ContentId, stream: Readable, type: MimeType = 'application/octet-stream', token?: ConflictToken) {
        try {
            const name = PT.join(this.#base, makePath(id));
            const output = createWriteStream(name);
            const hashstream = CR.createHash('sha-512');
            await pipeline(stream, async function* (source: Readable) {
                for await (const chunk of source) {
                    hashstream.update(chunk);
                    yield chunk;
                }
            }, output);
            const hash = hashstream.digest('hex');
            await FS.writeFile(`${name}.data`, JSON.stringify({ type, hash }));
            return true;
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
