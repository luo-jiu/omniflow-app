import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { rm, writeFile } from 'node:fs/promises';
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const entry = path.join(root, `dist-electron/agent-document-smoke-${process.pid}.mjs`);
const bootstrap = entry.replace(/\.mjs$/u, '.cjs');
await build({ entryPoints: [path.join(root, 'tools/agent-documents-smoke/host.ts')], outfile: entry,
  bundle: true, platform: 'node', format: 'esm', packages: 'external',
  alias: { pptxgenjs: createRequire(import.meta.url).resolve('pptxgenjs') },
  banner: { js: "import { createRequire as createSmokeRequire } from 'node:module'; const require = createSmokeRequire(import.meta.url);" },
  tsconfig: path.join(root, 'tsconfig.json'),
});
await writeFile(bootstrap, `const { app } = require('electron'); app.setName('OmniFlow'); import(${JSON.stringify(pathToFileURL(entry).href)}).catch(error => { console.error('OMNIFLOW_DOCUMENT_SMOKE_RESULT=' + JSON.stringify({ ok: false, error: String(error.message) })); app.exit(1); });`);
const env = { ...process.env, OMNIFLOW_DOCUMENT_SMOKE_LIVE: process.argv.includes('--live') ? '1' : '0' };
delete env.ELECTRON_RUN_AS_NODE;
const electron = path.join(root, 'node_modules/.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const child = spawn(electron, [bootstrap], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const timeout = setTimeout(() => child.kill('SIGTERM'), 210000);
let output = '';
child.stdout.on('data', chunk => { output += String(chunk); });
child.stderr.on('data', chunk => { output += String(chunk); });
child.once('error', error => { clearTimeout(timeout); void rm(entry, { force: true }); void rm(bootstrap, { force: true }); console.error(error.message); process.exitCode = 1; });
child.once('exit', async code => {
  clearTimeout(timeout);
  await rm(entry, { force: true });
  await rm(bootstrap, { force: true });
  const result = output.split('\n').filter(line => line.startsWith('OMNIFLOW_DOCUMENT_SMOKE_RESULT='));
  if (result.length) result.forEach(line => console.log(line));
  else console.error('Document smoke exited without a result.');
  process.exitCode = code === 0 && result.length ? 0 : 1;
});
