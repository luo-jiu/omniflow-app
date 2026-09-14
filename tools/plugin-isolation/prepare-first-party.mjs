import { execFileSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
const built = JSON.parse(execFileSync(process.execPath, ['tools/plugin-isolation/build-independent.mjs'], { encoding: 'utf8' }));
await mkdir('dist-plugins', { recursive: true });
await cp(built.packageDirectory, 'dist-plugins/csv', { recursive: true });
await build({ entryPoints: ['electron/service/extensions/plugin-preload.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: 'dist-plugins/plugin-preload.cjs' });
console.log('Prepared independently built first-party CSV package');
