import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await mkdir('dist', { recursive: true });
const source = await readFile('src/main.js', 'utf8');
await writeFile('dist/main.js', source.replace("from '@omniflow/plugin-sdk'", "from './sdk.js'"));
await copyFile(fileURLToPath(import.meta.resolve('@omniflow/plugin-sdk')), 'dist/sdk.js');
for (const file of ['index.html', 'style.css']) await copyFile(`src/${file}`, `dist/${file}`);
await copyFile('manifest.json', 'dist/manifest.json');
console.log('Built standalone comic package in dist');
