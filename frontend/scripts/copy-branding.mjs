import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../assets/abb-logo.svg');
const target = resolve(here, '../public/assets/abb-logo.svg');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
