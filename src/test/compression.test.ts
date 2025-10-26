import { describe } from 'node:test';
import { Compression } from '../compression.ts';
import { Memory } from '../memory.ts';
import define from './backend.ts';

describe('Compression', () => {
	define(new Compression(new Memory(), 'deflate'), 'deflate');
	define(new Compression(new Memory(), 'brotli'), 'brotli');
	define(new Compression(new Memory(), 'gzip'), 'gzip');
	define(new Compression(new Memory(), 'zstd'), 'zstd');
});
