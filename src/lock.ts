import * as CR from 'node:crypto';
import * as FS from 'node:fs/promises';
import * as OS from 'node:os';
import * as PT from 'node:path';

const KEY = Symbol();
export class Lock {
	#lockfile: string;
	constructor(lockfile: string, key: symbol) {
		if (key !== KEY)
			throw new Error('locks are created with Lock.acquire() not new Lock()');
		this.#lockfile = lockfile;
	}
	[Symbol.dispose]() {
		this.release();
	}
	async [Symbol.asyncDispose]() {
		await this.release();
	}
	async release() {
		try {
			await FS.unlink(this.#lockfile);
			return true;
		} catch (ex) {
			if ((ex as any).code === 'ENOENT') return true;
			return false;
		}
	}
	toString() {
		return `[Lock: ${PT.basename(this.#lockfile)}]`;
	}
	static #file(name: string) {
		return PT.join(
			OS.tmpdir(),
			`${CR.createHash('sha-1').update(name).digest('hex')}.lock`,
		);
	}
	static async #create(lockfile: string) {
		try {
			await FS.writeFile(lockfile, `${new Date().toISOString()}`, {
				flag: 'wx',
			});
			return true;
		} catch {
			return false;
		}
	}
	static async acquire(name: string) {
		const lockfile = Lock.#file(name);
		return (await Lock.#create(lockfile)) ? new Lock(lockfile, KEY) : null;
	}
	static async await(name: string, signal?: AbortSignal) {
		const lockfile = Lock.#file(name);
		if (await Lock.#create(lockfile)) return new Lock(lockfile, KEY);
		const changes = FS.watch(lockfile, { signal });
		try {
			for await (const _ of changes) {
				if (await Lock.#create(lockfile)) return new Lock(lockfile, KEY);
			}
			signal?.throwIfAborted();
			return null;
		} finally {
			await changes?.return?.();
		}
	}
	static async release(name: string) {
		try {
			const lockfile = Lock.#file(name);
			await FS.unlink(lockfile);
			return true;
		} catch (ex) {
			if ((ex as any).code === 'ENOENT') return true;
			return false;
		}
	}
}
