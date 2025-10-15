import define from './backend.ts';
import { Files } from '../files.ts';
import * as FS from 'node:fs/promises';
import * as OS from 'node:os';

const base = await FS.mkdtempDisposable(`${OS.tmpdir()}/test-${process.pid}`);
define(new Files(base.path), async () => base.remove());
