import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import electron from 'electron';

if (process.env.OMNIFLOW_CONTEXT_LIVE !== '1') {
  throw new Error('Paid model test: explicitly set OMNIFLOW_CONTEXT_LIVE=1');
}
const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-context-live-'));
try {
  const entry = process.argv.includes('--transport-smoke') ? './transport-smoke.ts' : './main.ts';
  await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
    outfile: path.join(directory, 'main.cjs'), logLevel: 'warning' });
  const env = { ...process.env, OMNIFLOW_CONTEXT_TEST_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(directory, 'main.cjs')], { env, stdio: 'inherit' });
  const stop = () => child.kill('SIGTERM');
  const timeout = setTimeout(stop, 30 * 60 * 1000);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    clearTimeout(timeout);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
