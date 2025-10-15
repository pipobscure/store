import { describe, it, after } from 'node:test';
import * as Assert from 'node:assert/strict';
import * as OS from 'node:os';
import * as FS from 'node:fs/promises';

import { S3 } from '@pipobscure/s3';

import { Frontend } from '../frontend.ts';
import { Memory } from '../memory.ts';
import type { Backend, ConflictToken } from '../backend.ts';
import { Files } from '../files.ts';
import { fileURLToPath } from 'node:url';
import { Bucket } from '../bucket.ts';

const prefix = `test-${process.pid}/`;
const opts = await (async () => {
	try {
		const optsURL = new URL('../../../bucket.json', import.meta.url);
		const opts = JSON.parse(await FS.readFile(fileURLToPath(optsURL), 'utf-8'));
		return { ...opts, prefix };
	} catch {
		return null;
	}
})();

const base = await FS.mkdtempDisposable(`${OS.tmpdir()}/test-${process.pid}`);
define('memory', new Memory());
define('files', new Files(base.path), () => base.remove());
if (opts) {
	define('bucket', new Bucket(opts), async () => {
		const s3 = new S3(opts);
		for await (const { name } of s3.list(prefix)) {
			await s3.del(name);
		}
	});
}

function define(
	name: string,
	backend: Backend,
	clean?: () => void | Promise<void>,
) {
	describe(`Frontend(${name})`, () => {
		if (clean) after(clean);
		const frontend = new Frontend(backend);
		describe('Content Addressable', () => {
			let cid: string | undefined | null;
			it('can put data', async () => {
				cid = await frontend.push(Buffer.from('test - data'), {
					type: 'text/plain',
				});
				Assert.ok(cid);
			});
			it('can get data', async () => {
				Assert.ok(cid);
				const data = await frontend.pull(cid);
				Assert.equal(data?.toString('utf-8'), 'test - data');
			});
			it('can check existence', async () => {
				Assert.ok(cid);
				const exists = await frontend.exists(cid);
				Assert.ok(exists);
			});
			it('can get the type of content', async () => {
				Assert.ok(cid);
				const type = await frontend.type(cid);
				Assert.equal(type, 'text/plain');
			});
			it('can push a stream', async () => {
				cid = await frontend.pushStream(
					(async function* () {
						yield Buffer.from('test');
						yield Buffer.from(' - ');
						yield Buffer.from('data');
					})(),
					{ type: 'text/plain' },
				);
				Assert.ok(cid);
			});
			it('can stream content back', async () => {
				Assert.ok(cid);
				const data = await Array.fromAsync(frontend.pullStream(cid));
				Assert.ok(data?.length);
				Assert.equal(Buffer.concat(data).toString('utf-8'), 'test - data');
			});
		});
		describe('Named Content', () => {
			let token: ConflictToken | null = null;
			it('knows a tag does not exists', async () => {
				const exists = await frontend.has('my test data');
				Assert.equal(exists, false);
			});
			it('can set named content', async () => {
				const result = await frontend.set(
					'my test data',
					Buffer.from('test - data'),
					{ type: 'text/plain' },
				);
				Assert.ok(result);
			});
			it('knows a tag now exists', async () => {
				const exists = await frontend.has('my test data');
				Assert.ok(exists);
			});
			it('can get named content', async () => {
				const content = await frontend.get('my test data');
				Assert.equal(content?.toString('utf-8'), 'test - data');
			});
			it('can get the named contents meta data', async () => {
				const tag = await frontend.tag('my test data');
				Assert.equal(tag?.type, 'text/plain');
			});
			it('can get a token', async () => {
				token = await frontend.token('my test data');
				Assert.ok(token);
			});
			it('can write a named stream', async () => {
				const result = await frontend.writeStream(
					'my test data',
					(async function* () {
						yield Buffer.from('more ');
						yield Buffer.from('data ');
						yield Buffer.from('than ');
						yield Buffer.from('before ');
					})(),
					{ type: 'text/plain', token },
				);
				Assert.ok(result);
			});
			it('can read a named stream', async () => {
				const stream = frontend.readStream('my test data');
				Assert.ok(stream?.[Symbol.asyncIterator]);
				const data = await Array.fromAsync(stream);
				Assert.ok(data.length);
				Assert.equal(
					Buffer.concat(data).toString('utf-8'),
					'more data than before ',
				);
			});
			it('can copy content', async () => {
				const result = await frontend.copy('my test data', 'my other name');
				Assert.ok(result);
				Assert.ok(await frontend.has('my other name'));
			});
			it('can get a new token', async () => {
				token = await frontend.token('my test data');
				Assert.ok(token);
			});
			it('can delete named content', async () => {
				Assert.ok(token);
				const result = await frontend.delete('my test data', { token });
				Assert.ok(result);
			});
			it('now does not have an entry anymore', async () => {
				const result = await frontend.has('my test data');
				Assert.ok(!result);
			});
		});
	});
}
