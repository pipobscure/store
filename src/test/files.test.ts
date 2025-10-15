
import define from './backend.ts';
import { Files } from '../files.ts';
import * as FS from 'node:fs/promises'

const base = await FS.mkdtempDisposable(`test-${process.pid}`);
define(new Files(base.path), async ()=>base.remove());
