import { describe } from 'node:test';
import define from './backend.ts';
import { Memory } from '../memory.ts';
import { Compression } from '../compression.ts';

describe('Compression', () => {
	define(new Compression(new Memory(), 'deflate'), 'deflate');
	define(new Compression(new Memory(), 'brotli'), 'brotli');
	define(new Compression(new Memory(), 'gzip'), 'gzip');
	define(new Compression(new Memory(), 'zstd'), 'zstd');
});
