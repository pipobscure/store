import * as Assert from 'node:assert/strict';
import * as CR from 'node:crypto';
import { after, describe, it } from 'node:test';
import { Backend, ConflictToken } from '../backend.ts';

type Cleanup = () => void | Promise<void>;
export default function (backend: Backend, tag?: string | Cleanup, cleanup?: Cleanup) {
	cleanup = (cleanup ?? 'string' === typeof tag) ? cleanup : (tag ?? cleanup);
	tag = 'string' === typeof tag ? tag : undefined;
	describe(`Backend: ${backend.constructor.name}${tag ? `(${tag})` : ''}`, () => {
		const id = CR.createHash('sha-512').update(CR.randomBytes(50)).digest('hex');
		const content = CR.randomBytes(20);
		let token: ConflictToken | null = null;
		if (cleanup) after(cleanup);
		it('is a backend', () => {
			Assert.ok(backend instanceof Backend);
		});
		it('read missing is null', async () => {
			Assert.equal(await backend.read(id), null);
		});
		it('exists missing is false', async () => {
			Assert.equal(await backend.exists(id), false);
		});
		it('token missing is null', async () => {
			Assert.equal(await backend.token(id), null);
		});
		it('type missing is null', async () => {
			Assert.equal(await backend.type(id), null);
		});
		it('hash missing is null', async () => {
			Assert.equal(await backend.hash(id), null);
		});
		it('writing is true', async () => {
			Assert.ok(await backend.write(id, content, 'bytes/random'));
		});
		it('exists is now true', async () => {
			Assert.equal(await backend.exists(id), true);
		});
		it('read now results in data', async () => {
			const data = await backend.read(id);
			Assert.ok(data);
			Assert.equal(data.content.toString('hex'), content.toString('hex'));
			Assert.equal(data.type, 'bytes/random');
		});
		it('type is correct', async () => {
			Assert.equal(await backend.type(id), 'bytes/random');
		});
		it('hash is valid', async () => {
			const hash = await backend.hash(id);
			Assert.equal(typeof hash, 'string');
		});
		it('token now returns a token', async () => {
			Assert.ok((token = await backend.token(id)) instanceof ConflictToken);
		});
		it('can write with token', async () => {
			const result = await backend.write(id, CR.randomBytes(20), 'byte/random', token as ConflictToken);
			Assert.ok(result);
		});
		it('cannot write with wrong token', async () => {
			Assert.ok(!(await backend.write(id, CR.randomBytes(20), 'byte/random', token as ConflictToken)));
			token = await backend.token(id);
		});
		it('delete returns true', async () => {
			Assert.ok(token);
			Assert.equal(await backend.delete(id, token), true);
		});
		it('exists is now false', async () => {
			Assert.equal(await backend.exists(id), false);
		});
		it('writeStream works', async () => {
			const stream = (async function* () {
				yield content;
			})();
			Assert.ok(await backend.writeStream(id, stream, 'bytes/random'));
		});
		it('read now results in data', async () => {
			const data = await backend.read(id);
			Assert.ok(data);
			Assert.equal(data.content.toString('hex'), content.toString('hex'));
			Assert.equal(data.type, 'bytes/random');
		});
		it('readStream works', async () => {
			const data = Buffer.concat(await Array.fromAsync(backend.readStream(id)));
			Assert.equal(data.toString('hex'), content.toString('hex'));
		});
		it('can rename', async () => {
			const nid = CR.randomBytes(64).toString('hex');
			const result = await backend.rename(id, nid);
			Assert.ok(result);
			Assert.ok(!(await backend.exists(id)));
			Assert.ok(await backend.exists(nid));
		});
	});
}
