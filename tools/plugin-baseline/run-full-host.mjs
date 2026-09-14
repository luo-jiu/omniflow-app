import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-full-host-'));
const entry = path.join(root, 'dist-electron/main.js');
const entrySha256 = createHash('sha256').update(await readFile(entry)).digest('hex');
const runs = [];
for (let i = 0; i < 5; i += 1) {
  const runDirectory = path.join(directory, String(i));
  await mkdir(runDirectory);
  const env = { ...process.env, OMNI_BASELINE_DIR: runDirectory, OMNI_MAIN_ENTRY: pathToFileURL(entry).href };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.ELECTRON_RENDERER_URL;
  delete env.OMNIFLOW_USER_DATA_SUFFIX;
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [path.join(root, 'tools/plugin-baseline/full-host.mjs')], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = chunk => { output = (output + String(chunk)).slice(-4000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Host timeout')); }, 70000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(output)); });
  });
  runs.push(JSON.parse(await readFile(path.join(runDirectory, 'result.json'), 'utf8')));
  console.log(`Host run ${i + 1}/5: entry to document load ${runs.at(-1).readyMs.toFixed(1)}ms`);
}
await writeFile(path.join(directory, 'summary.json'), JSON.stringify({ entrySha256, runs }, null, 2) + '\n');
console.log(`RESULT ${path.join(directory, 'summary.json')}`);
