import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await rm('dist', { recursive: true, force: true }); await mkdir('dist', { recursive: true });
for (const entry of ['tool.js', 'workspace.js']) {
  const source = await readFile(`src/${entry}`, 'utf8');
  if (!source.includes("from '@omniflow/plugin-sdk'")) throw new Error('Expected SDK import');
  await writeFile(`dist/${entry}`, source.replace("from '@omniflow/plugin-sdk'", "from './sdk.js'"));
}
await copyFile(fileURLToPath(import.meta.resolve('@omniflow/plugin-sdk')), 'dist/sdk.js');
for (const file of ['tool.html', 'tool-runner.js', 'json-transform.js', 'json-resource.js', 'workspace.html', 'workspace.css', 'workspace-model.js']) await copyFile(`src/${file}`, `dist/${file}`);
await copyFile('manifest.json', 'dist/manifest.json');
console.log('Built independent JSON transform Tool and workspace in dist');
