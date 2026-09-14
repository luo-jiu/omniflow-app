import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-plugin-runtime-'));
const dist = path.join(directory, 'dist');
await build({ configFile: false, root, base: './', plugins: [react()], resolve: { alias: { '@': path.join(root, 'src') } }, build: { outDir: dist, emptyOutDir: true, rollupOptions: { input: path.join(root, 'tools/plugin-baseline/runtime.html') } } });
const runs = [];
for (let i = 0; i < (process.env.OMNI_BASELINE_CYCLES === '80' ? 1 : 5); i += 1) {
  const runDirectory = path.join(directory, `run-${i + 1}`);
  await mkdir(runDirectory);
  const env = { ...process.env, OMNIFLOW_BASELINE_RUN_DIR: runDirectory, OMNIFLOW_BASELINE_HTML: path.join(dist, 'tools/plugin-baseline/runtime.html') };
  delete env.ELECTRON_RUN_AS_NODE;
  const started = performance.now();
  let spawnToReadyMs;
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [path.join(root, 'tools/plugin-baseline/runtime-host.cjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Host exceeded 70s')); }, 70000);
    child.stdout.on('data', chunk => { output += chunk; if (spawnToReadyMs === undefined && output.includes('BASELINE_READY')) spawnToReadyMs = performance.now() - started; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(output)); });
  });
  if (spawnToReadyMs === undefined) throw new Error('No ready measurement');
  runs.push({ spawnToReadyMs, ...JSON.parse(await readFile(path.join(runDirectory, 'result.json'), 'utf8')) });
  console.log(`Fixture run ${i + 1}/5: ready ${spawnToReadyMs.toFixed(1)}ms`);
}
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { min: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, max: sorted.at(-1) };
};
const result = { schemaVersion: 1, measuredAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Hidden isolated component fixture; fresh userData each run; no network/auth/backend. Not full application startup, native overlay or virtualized workspace performance. Two animation frames after each synchronous React update. Explicit GC only after all timings and unmount, for retention diagnosis.',
  summary: { spawnToReadyMs: summarize(runs.map(r => r.spawnToReadyMs)), operationsMs: Object.fromEntries(Object.keys(runs[0].result.measurementsMs).map(name => [name, summarize(runs.flatMap(r => r.result.measurementsMs[name]))])) }, runs };
await writeFile(path.join(directory, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`BASELINE_RESULT=${path.join(directory, 'summary.json')}`);
