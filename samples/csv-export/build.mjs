import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await rm('dist', { recursive: true, force: true }); await mkdir('dist', { recursive: true });
const source = await readFile('src/tool.js', 'utf8');
if (!source.includes("from '@omniflow/plugin-sdk'")) throw new Error('Expected SDK import');
await writeFile('dist/tool.js', source.replace("from '@omniflow/plugin-sdk'", "from './sdk.js'"));
await copyFile(fileURLToPath(import.meta.resolve('@omniflow/plugin-sdk')), 'dist/sdk.js');
for (const file of ['tool.html', 'csv-parser.js', 'csv-resource.js', 'csv-export.js', 'tool-runner.js']) await copyFile(`src/${file}`, `dist/${file}`);
await copyFile('manifest.json', 'dist/manifest.json');
console.log('Built independent CSV export Tool in dist');
