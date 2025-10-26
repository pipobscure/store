import { equal } from 'node:assert/strict';
import * as CR from 'node:crypto';
import { describe, it } from 'node:test';
import { Memory } from '../memory.ts';
import { decrypt, encrypt, Secret } from '../secret.ts';
import define from './backend.ts';

describe('Encryption', () => {
	const keydata = CR.randomBytes(48);
	it('encrypt/decrypt roundtrip', async () => {
		const original = CR.randomBytes(10);
		const [encrypted, authTag] = await encrypt(keydata, original);
		const rountrip = await decrypt(keydata, authTag, encrypted);
		equal(rountrip.toString('hex'), original.toString('hex'));
	});
	define(new Secret(new Memory(), 'mein test passwort', 'und etwas salz zum würzen'));
});
