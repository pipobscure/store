import { describe } from 'node:test';
import define from './backend.ts';
import { Bucket } from '../bucket.ts';
import * as FS from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import S3 from '@pipobscure/s3';

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

describe('Bucket(S3)', () => {
	if (opts) {
		const bucket = new Bucket(opts);
		define(bucket, async () => {
			const s3 = new S3(opts);
			for await (const { name } of s3.list(prefix)) {
				await s3.del(name);
			}
		});
	}
});
