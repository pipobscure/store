import * as CR from 'node:crypto';
import {
	Backend,
	type ContentId,
	type MimeType,
	type ConflictToken,
} from './backend.ts';
import { Transform } from 'node:stream';
import { pipe } from './pipe.ts';
export const ALGORITHM = 'aes-256-gcm';

export class Secret extends Backend {
	#back;
	#secret;
	constructor(backend: Backend, password: string, salt: string) {
		super();
		this.#back = backend;
		this.#secret = generateSecret(password, salt);
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
		try {
			const { content, type } = (await this.#back.read(id, signal)) ?? {};
			if (!content || !type) return null;
			const hdr = content.subarray(0, 4);
			if (hdr.toString('utf-8') !== 'SKE:') return { content, type };
			const enckey = content.subarray(4, 52);
			const keytag = content.subarray(52, 68);
			const keydata = await decrypt(await this.#secret, keytag, enckey);
			const authTag = content.subarray(-16);
			const encdata = content.subarray(68, -16);
			const data = await decrypt(keydata, authTag, encdata);
			return { content: data, type };
		} catch {
			return null;
		}
	}
	async write(
		id: ContentId,
		content: Buffer<ArrayBufferLike>,
		type?: MimeType,
		token?: ConflictToken,
		signal?: AbortSignal,
	) {
		const keydata = await randomBytes(48);
		const hdr = Buffer.from('SKE:');
		const [enckey, keytag] = await encrypt(await this.#secret, keydata);
		const [data, authTag] = await encrypt(keydata, content);
		return await this.#back.write(
			id,
			Buffer.concat([hdr, enckey, keytag, data, authTag]),
			type,
			token,
			signal,
		);
	}
	delete(
		id: ContentId,
		token: ConflictToken,
		signal?: AbortSignal,
	): Promise<boolean> {
		return this.#back.delete(id, token, signal);
	}
	readStream(id: ContentId, signal?: AbortSignal) {
		const decrypt = decryptor(this.#secret);
		const stream = this.#back.readStream(id, signal);
		pipe(stream, decrypt, signal);
		return decrypt;
	}
	async writeStream(
		id: ContentId,
		stream: AsyncIterable<Buffer>,
		type?: MimeType,
		token?: ConflictToken,
		signal?: AbortSignal,
	) {
		const encrypt = await encryptor(await this.#secret);
		pipe(stream, encrypt, signal);
		return await this.#back.writeStream(id, encrypt, type, token, signal);
	}
	rename(source: ContentId, target: ContentId, signal?: AbortSignal) {
		return this.#back.rename(source, target, signal);
	}
}

async function generateSecret(password: string, salt: string) {
	const deferred = Promise.withResolvers<Buffer<ArrayBufferLike>>();
	CR.pbkdf2(password, salt, 1000, 48, 'sha-512', (err, result) => {
		if (err) return deferred.reject(err);
		deferred.resolve(result);
	});
	return await deferred.promise;
}
export function randomBytes(size: number) {
	const deferred = Promise.withResolvers<Buffer<ArrayBufferLike>>();
	CR.randomBytes(size, (err, result) => {
		if (err) return deferred.reject(err);
		deferred.resolve(result);
	});
	return deferred.promise;
}

export async function encrypt(
	keydata: Buffer<ArrayBufferLike>,
	first: Buffer<ArrayBufferLike>,
	...parts: Buffer<ArrayBufferLike>[]
): Promise<[Buffer<ArrayBufferLike>, Buffer<ArrayBufferLike>]> {
	const content = [first, ...parts];
	const deferred = Promise.withResolvers<void>();
	const cipher = CR.createCipheriv(
		ALGORITHM,
		keydata.subarray(0, 32),
		keydata.subarray(32, 48),
		{ authTagLength: 16 },
	);
	cipher.on('error', deferred.reject);
	cipher.on('end', deferred.resolve);
	const result = Array.fromAsync(cipher).then((chunks) =>
		Buffer.concat(chunks),
	);
	result.catch(deferred.reject);
	for (const part of content) {
		cipher.write(part);
	}
	cipher.end();
	const [data] = await Promise.all([result, deferred.promise]);
	return [data, cipher.getAuthTag()];
}
export async function decrypt(
	keydata: Buffer<ArrayBufferLike>,
	authTag: Buffer<ArrayBufferLike>,
	first: Buffer<ArrayBufferLike>,
	...parts: Buffer<ArrayBufferLike>[]
) {
	const content = [first, ...parts];
	const deferred = Promise.withResolvers<void>();
	const cipher = CR.createDecipheriv(
		ALGORITHM,
		keydata.subarray(0, 32),
		keydata.subarray(32, 48),
		{ authTagLength: 16 },
	);
	cipher.setAuthTag(authTag);
	cipher.on('error', deferred.reject);
	cipher.on('end', deferred.resolve);
	const result = Array.fromAsync(cipher).then((chunks) =>
		Buffer.concat(chunks),
	);
	result.catch(deferred.reject);
	for (const part of content) {
		cipher.write(part);
	}
	cipher.end();
	const [data] = await Promise.all([result, deferred.promise]);
	return data;
}

function decryptor(secret: Promise<Buffer<ArrayBufferLike>>) {
	let buffer: null | Buffer<ArrayBufferLike> = null;
	let cipher: CR.DecipherGCM | null = null;
	let passmode = false;
	const decryptor = new Transform({
		async transform(chunk, _encoding, callback) {
			try {
				chunk = buffer ? Buffer.concat([buffer, chunk]) : chunk;
				if (!passmode && !cipher && chunk.length < 4) {
					buffer = chunk;
					return callback();
				}
				if (passmode) {
					this.push(chunk);
					return callback();
				}
				if (!cipher) {
					if (chunk.subarray(0, 4).toString('utf-8') !== 'SKE:') {
						passmode = true;
						this.push(chunk);
						return callback();
					}
					if (chunk.length < 68) {
						buffer = chunk;
						return callback();
					}
					const keydata = await decrypt(
						await secret,
						chunk.subarray(52, 68),
						chunk.subarray(4, 52),
					);
					cipher = CR.createDecipheriv(
						ALGORITHM,
						keydata.subarray(0, 32),
						keydata.subarray(32),
						{ authTagLength: 16 },
					);
					chunk = chunk.subarray(68);
				}
				if (cipher && chunk.length > 16) {
					buffer = chunk.subarray(-16);
					chunk = chunk.subarray(0, -16);
					this.push(cipher.update(chunk));
				}
				callback();
			} catch (err) {
				callback(err as Error);
			}
		},
		final(callback) {
			if (passmode) return callback();
			if (!buffer || !cipher)
				return callback(new Error('missing encryption information'));
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
async function encryptor(secret: Buffer<ArrayBufferLike>) {
	const hdr = Buffer.from('SKE:');
	const keydata = await randomBytes(48);
	const [enckey, keytag] = await encrypt(secret, keydata);
	const cipher = CR.createCipheriv(
		ALGORITHM,
		keydata.subarray(0, 32),
		keydata.subarray(32, 48),
		{ authTagLength: 16 },
	);
	let hdrpushed = false;
	const chunks: Buffer<ArrayBufferLike>[] = [];
	const encryptor = new Transform({
		transform(chunk, _encoding, callback) {
			if (!hdrpushed) {
				this.push(hdr);
				this.push(enckey);
				this.push(keytag);
				hdrpushed = true;
			}
			try {
				const data = cipher.update(chunk);
				this.push(data);
				chunks.push(data);
				callback();
			} catch (err) {
				callback(err as Error);
			}
		},
		final(callback) {
			try {
				const data = cipher.final();
				this.push(data);
				chunks.push(data);
				const authTag = cipher.getAuthTag();
				this.push(authTag);
				callback();
			} catch (err) {
				callback(err as Error);
			}
		},
	});
	return encryptor;
}
