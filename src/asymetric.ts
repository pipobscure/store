import * as CR from 'node:crypto';

import { Backend, type ContentId, type ConflictToken, type MimeType } from "./backend.ts";
import { Transform, type Readable } from 'node:stream';
import type { Writable } from 'stream';

import { ALGORITHM, encrypt, decrypt, randomBytes } from './secret.ts';

export class Asymetric extends Backend {
    #back;
    #key;
    constructor(backend: Backend, key: CR.KeyObject) {
        super();
        this.#back = backend;
        this.#key = key;
    }
    token(id: ContentId) {
        return this.#back.token(id);
    }
    exists(id: ContentId): Promise<boolean> {
        return this.#back.exists(id);
    }
    list(prefix: string): AsyncIterableIterator<string> {
        return this.#back.list(prefix);
    }
    type(id: ContentId) {
        return this.#back.type(id);
    }
    hash(id: ContentId) {
        return this.#back.hash(id);
    }
    async read(id: ContentId) {
        const { content: encrypted, type } = await this.#back.read(id) ?? {};
        if (!encrypted || !type) return null;
        const hdr = encrypted.subarray(0, 6);
        if (encrypted.subarray(0, 4).toString('ascii') !== 'AKE:') return { content: encrypted, type };
        const keylen = encrypted.readUInt16BE(4);
        const enckey = encrypted.subarray(6, 6 + keylen);
        const authTag = encrypted.subarray(-16);
        const syncdata = encrypted.subarray(6 + keylen, -16);
        const keydata = CR.privateDecrypt(this.#key, enckey);
        const data = await decrypt(keydata, authTag, syncdata);
        return {
            content: data, type
        };
    }
    async write(id: ContentId, content: Buffer<ArrayBufferLike>, type: MimeType = 'application/octet-stream', token?: ConflictToken) {
        const keydata = await randomBytes(48);
        const hdr = Buffer.from('AKE:\0\0');
        const enckey = CR.publicEncrypt(this.#key, keydata);
        hdr.writeUInt16BE(enckey.length, 4);
        const [data, authTag] = await encrypt(keydata, content)
        return await this.#back.write(id, Buffer.concat([hdr, enckey, data, authTag]), type, token);
    }
    delete(id: ContentId): Promise<boolean> {
        return this.#back.delete(id);
    }
    async readStream(id: ContentId, stream: Writable) {
        try {
            const decrypt = await decryptor(this.#key);
            decrypt.pipe(stream);
            return await this.#back.readStream(id, decrypt);
        } catch {
            return null;
        }
    }
    async writeStream(id: ContentId, stream: Readable, type?: MimeType, token?: ConflictToken): Promise<boolean> {
        try {
            const encrypt = await encryptor(this.#key);
            stream.pipe(encrypt);
            return await this.#back.writeStream(id, encrypt, type, token);
        } catch {
            return false;
        }
    }
    async hashStream(stream: Readable, type?: MimeType) {
        try {
            const encrypt = await encryptor(this.#key);
            stream.pipe(encrypt);
            return await this.#back.hashStream(encrypt, type);
        } catch {
            return null;
        }
    }
}

async function decryptor(key: CR.KeyObject) {
    let buffer: null | Buffer<ArrayBufferLike> = null;
    let cipher: CR.DecipherGCM | null = null;
    let passmode = false;
    const decryptor = new Transform({
        transform(chunk, _encoding, callback) {
            chunk = buffer ? Buffer.concat([buffer, chunk]) : chunk;
            if (!passmode && !cipher && chunk.length < 6) {
                buffer = chunk;
                return callback();
            }
            if (passmode) {
                this.push(chunk);
                return callback();
            }
            if (!cipher) {
                if (chunk.subarray(0, 4).toString('utf-8') !== 'AKE:') {
                    passmode = true;
                    this.push(chunk);
                    return callback();
                }
                const encsize = chunk.readUInt16BE(4);
                if (chunk.length < 6 + encsize) {
                    buffer = chunk;
                    return callback();
                }
                const keydata = CR.privateDecrypt(key, chunk.subarray(6, 6 + encsize));
                cipher = CR.createDecipheriv(ALGORITHM, keydata.subarray(0, 32), keydata.subarray(32), { authTagLength: 16 });
                chunk = chunk.subarray(6 + encsize);
            }
            if (cipher && chunk.length > 16) {
                buffer = chunk.subarray(-16);
                chunk = chunk.subarray(0, -16);
                this.push(cipher.update(chunk));
            }
            callback();
        },
        final(callback) {
            if (passmode) return callback();
            if (!buffer || !cipher) return callback(new Error('missing encryption information'));
            const authTag = buffer.subarray(-16);
            buffer = buffer.subarray(0, -16);
            this.push(cipher.update(buffer));
            cipher.setAuthTag(authTag);
            this.push(cipher.final());
            callback();
        }
    });
    return decryptor;
}
async function encryptor(key: CR.KeyObject) {
    const hdr = Buffer.from('AKE:\0\0');
    const keydata = await randomBytes(48);
    const enckey = CR.publicEncrypt(key, keydata);
    hdr.writeUInt16BE(enckey.length, 4);
    const cipher = CR.createCipheriv(ALGORITHM, keydata.subarray(0, 32), keydata.subarray(32, 48), { authTagLength: 16 });
    let hdrpushed = false;
    const encryptor = new Transform({
        transform(chunk, _encoding, callback) {
            if (!hdrpushed) {
                this.push(hdr);
                this.push(enckey);
                hdrpushed = true;
            }
            try {
                this.push(cipher.update(chunk));
                callback();
            } catch (err) {
                callback(err as Error);
            }
        },
        final(callback) {
            try {
                this.push(cipher.final());
                this.push(cipher.getAuthTag());
                callback();
            } catch (err) {
                callback(err as Error);
            }
        }
    });
    return encryptor;
}
