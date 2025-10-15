import * as PT from 'node:path';
import * as FS from 'node:fs/promises';
import * as CR from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';

import { Lock } from './lock.ts';

import {
	type ContentId,
	type MimeType,
	assertContentId,
	assertMimeType,
	Backend,
	ConflictToken,
	makePath,
} from './backend.ts';

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
			return new ConflictToken(this, hash);
		} catch {
			return null;
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
	async *list(signal?: AbortSignal) {
		const dir = await FS.opendir(this.#base, {
			recursive: true,
		});
		for await (const item of dir) {
			signal?.throwIfAborted();
			if (!item.isFile()) continue;
			if (PT.extname(item.name) === '.data') continue;
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
		} catch (e) {
			if ((e as any).code === 'ENOENT') return null;
			throw e;
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
		} catch (e) {
			if ((e as any).code === 'ENOENT') return null;
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
		const name = PT.join(this.#base, makePath(id));
		await FS.mkdir(PT.dirname(name), { recursive: true });
		await using lock = token
			? await Lock.await(
					name,
					signal
						? AbortSignal.any([AbortSignal.timeout(30000), signal])
						: AbortSignal.timeout(30000),
				)
			: null;
		const current = lock ? await this.hash(id) : null;
		const hash = CR.createHash('sha-512').update(content).digest('hex');
		if (current !== (token?.value(this) ?? null)) return false;
		await Promise.all([
			FS.writeFile(name, content, { flag: token ? 'w' : 'wx' }),
			FS.writeFile(`${name}.data`, JSON.stringify({ type, hash }), {
				flag: token ? 'w' : 'wx',
			}),
		]);
		return true;
	}
	async delete(id: ContentId, token: ConflictToken, signal?: AbortSignal) {
		const name = PT.join(this.#base, makePath(id));
		await using lock = await Lock.await(
			name,
			signal
				? AbortSignal.any([AbortSignal.timeout(30000), signal])
				: AbortSignal.timeout(30000),
		);
		if (token.value(this) !== (await this.hash(id))) return false;
		try {
			await Promise.all([FS.unlink(name), FS.unlink(`${name}.data`)]);
			await lock?.release();
			return true;
		} catch (e) {
			if ((e as any).code === 'ENOENT') return false;
			throw e;
		}
	}
	readStream(id: ContentId) {
		const name = PT.join(this.#base, makePath(id));
		const stream = createReadStream(name);
		return stream;
	}
	async writeStream(
		id: ContentId,
		stream: AsyncIterable<Buffer>,
		type: MimeType = 'application/octet-stream',
		token?: ConflictToken,
		signal?: AbortSignal,
	) {
		const name = PT.join(this.#base, makePath(id));
		await using lock = token
			? await Lock.await(name, AbortSignal.timeout(30000))
			: null;
		const current = lock ? await this.hash(id) : null;
		if (current !== (token?.value(this) ?? null)) return false;
		signal?.throwIfAborted();
		await FS.mkdir(PT.dirname(name), { recursive: true });
		const output = createWriteStream(name, { flags: token ? 'w' : 'wx' });
		const hashstream = CR.createHash('sha-512');
		for await (const chunk of stream) {
			signal?.throwIfAborted();
			hashstream.update(chunk);
			const deferred = Promise.withResolvers<void>();
			output.write(chunk, (err) => {
				if (err) return deferred.reject(err);
				deferred.resolve();
			});
			await deferred.promise;
		}
		const deferred = Promise.withResolvers<void>();
		output.end(deferred.resolve);
		await deferred.promise;
		const hash = hashstream.digest('hex');
		await FS.writeFile(`${name}.data`, JSON.stringify({ type, hash }), {
			flag: token ? 'w' : 'wx',
		});
		return true;
	}
	async rename(source: ContentId, target: ContentId, signal?: AbortSignal) {
		const [sExists, tExists] = await Promise.all([
			this.exists(source),
			this.exists(target),
		]);
		signal?.throwIfAborted();
		if (!sExists || tExists) return false;
		const sourceName = PT.join(this.#base, makePath(source));
		const targetName = PT.join(this.#base, makePath(target));
		try {
			await FS.mkdir(PT.dirname(targetName), { recursive: true });
			await FS.rename(sourceName, targetName);
			return true;
		} catch {
			return false;
		}
	}
}
