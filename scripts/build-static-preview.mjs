import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'compliance-lab', 'browser');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await copyFile(join(root, 'preview.html'), join(outDir, 'index.html'));
await cp(join(root, 'public'), outDir, { recursive: true });

console.log(`Built static preview to ${outDir}`);
