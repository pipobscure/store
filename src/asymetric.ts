import * as CR from 'node:crypto';
import { Transform } from 'node:stream';
import { Backend, type ConflictToken, type ContentId, type MimeType } from './backend.ts';
import { pipe } from './pipe.ts';
import { ALGORITHM, decrypt, encrypt, randomBytes } from './secret.ts';

export class Asymetric extends Backend {
	#back;
	#key;
	constructor(backend: Backend, key: CR.KeyObject) {
		super();
		this.#back = backend;
		this.#key = key;
	}
	token(id: ContentId, signal?: AbortSignal) {
		return this.#back.token(id, signal);
	}
	exists(id: ContentId, signal?: AbortSignal): Promise<boolean> {
		return this.#back.exists(id, signal);
	}
	list(signal?: AbortSignal): AsyncIterableIterator<string> {
		return this.#back.list(signal);
	}
	type(id: ContentId, signal?: AbortSignal) {
		return this.#back.type(id, signal);
	}
	hash(id: ContentId, signal?: AbortSignal) {
		return this.#back.hash(id, signal);
	}
	async read(id: ContentId, signal?: AbortSignal) {
		const { content: encrypted, type } = (await this.#back.read(id, signal)) ?? {};
		if (!encrypted || !type) return null;
		const hdr = encrypted.subarray(0, 6);
		if (hdr.subarray(0, 4).toString('ascii') !== 'AKE:') {
			return { content: encrypted, type };
		}
		const keylen = hdr.readUInt16BE(4);
		const enckey = encrypted.subarray(6, 6 + keylen);
		const authTag = encrypted.subarray(-16);
		const syncdata = encrypted.subarray(6 + keylen, -16);
		const keydata = CR.privateDecrypt(this.#key, enckey);
		const data = await decrypt(keydata, authTag, syncdata);
		return {
			content: data,
			type,
		};
	}
	async write(id: ContentId, content: Buffer<ArrayBufferLike>, type: MimeType = 'application/octet-stream', token?: ConflictToken, signal?: AbortSignal) {
		const keydata = await randomBytes(48);
		const hdr = Buffer.from('AKE:\0\0');
		const enckey = CR.publicEncrypt(this.#key, keydata);
		hdr.writeUInt16BE(enckey.length, 4);
		const [data, authTag] = await encrypt(keydata, content);
		return await this.#back.write(id, Buffer.concat([hdr, enckey, data, authTag]), type, token, signal);
	}
	delete(id: ContentId, token: ConflictToken, signal?: AbortSignal): Promise<boolean> {
		return this.#back.delete(id, token, signal);
	}
	readStream(id: ContentId, signal?: AbortSignal) {
		const decrypt = decryptor(this.#key);
		const stream = this.#back.readStream(id, signal);
		pipe(stream, decrypt, signal);
		return decrypt;
	}
	async writeStream(id: ContentId, stream: AsyncIterable<Buffer>, type?: MimeType, token?: ConflictToken, signal?: AbortSignal): Promise<boolean> {
		try {
			const encrypt = await encryptor(this.#key);
			const done = pipe(stream, encrypt, signal);
			const result = await this.#back.writeStream(id, encrypt, type, token, signal);
			await done;
			return result;
		} catch {
			return false;
		}
	}
	rename(source: ContentId, target: ContentId, signal?: AbortSignal) {
		return this.#back.rename(source, target, signal);
	}
}

function decryptor(key: CR.KeyObject) {
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
		},
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
		},
	});
	return encryptor;
}
