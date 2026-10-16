'use strict';
// Node-only driver. Build the disposable AppKit receiver with build-menu-fixture.mjs first.
// Usage: node menu-chain-smoke.cjs /absolute/OmniflowNativeMenuQA [--sanity|--pointer]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const { assertNodeSupervisor, runFixture } = await import('./safe-fixture-launcher.mjs');
  assertNodeSupervisor();
  const [executable, option] = process.argv.slice(2);
  if (!executable || !path.isAbsolute(executable) || path.basename(executable) !== 'OmniflowNativeMenuQA'
    || option && !['--sanity', '--pointer'].includes(option) || process.argv.length > 4) throw new Error('Expected the compiled disposable menu fixture path and optional --sanity or --pointer.');
  const projectRoot = path.resolve(__dirname, '../..');
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-menu-chain-'));
  await require('esbuild').build({ entryPoints: [path.join(projectRoot, 'electron/platform/computer-use/index.ts')],
    outfile: path.join(runDirectory, 'platform.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' });
  const supervision = await runFixture({ fixture: path.join(__dirname, 'menu-chain-fixture.cjs'), durationMs: 45_000, maxProcesses: 12,
    allowedExecutables: [executable, path.join(projectRoot, 'build/native/computer-use', `darwin-${process.arch}`, 'omniflow-click')],
    env: { OMNIFLOW_MENU_CHAIN_RUN_DIR: runDirectory, OMNIFLOW_MENU_CHAIN_EXECUTABLE: executable,
      OMNIFLOW_MENU_CHAIN_MODE: option === '--sanity' ? 'sanity' : option === '--pointer' ? 'pointer' : 'chain' } });
  fs.writeFileSync(path.join(runDirectory, 'supervision.json'), JSON.stringify(supervision, null, 2));
  let report;
  try {
    const resultPath = path.join(runDirectory, 'result.json');
    if (fs.statSync(resultPath).size > 64 * 1024) throw new Error('Oversize result');
    report = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch { report = { status: 'failed', detail: 'Fixture exited without a bounded final report.' }; }
  const cleaned = supervision.cleanupConfirmed && supervision.reason === 'completed' && report.cleanup?.receiverClosed === true;
  const passed = cleaned && supervision.exitCode === 0 && report.status === 'passed';
  const blocked = cleaned && supervision.exitCode === 2 && report.status === 'blocked';
  console.log(JSON.stringify({ ...report, supervision, runDirectory }));
  process.exitCode = passed ? 0 : blocked ? 2 : 1;
}
main().catch(error => { console.error(String(error).slice(0, 1024)); process.exitCode = 1; });
