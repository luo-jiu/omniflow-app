/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';
// Node-only probe. Never launch this driver from an Electron process.
// Usage: node tools/computer-use/software-compatibility-smoke.cjs --list
//        node tools/computer-use/software-compatibility-smoke.cjs --window-id 123
//        node tools/computer-use/software-compatibility-smoke.cjs --plan /absolute/plan.json
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const { assertNodeSupervisor, runFixture } = await import('./safe-fixture-launcher.mjs');
  assertNodeSupervisor();
  const args = process.argv.slice(2);
  const list = args.length === 1 && args[0] === '--list';
  const windowId = args.length === 2 && args[0] === '--window-id' && /^[1-9][0-9]{0,9}$/.test(args[1])
    && Number(args[1]) <= 0xffffffff ? args[1] : undefined;
  const planPath = args.length === 2 && args[0] === '--plan' && path.isAbsolute(args[1]) ? args[1] : undefined;
  if (!list && !windowId && !planPath) throw new Error('Usage: node software-compatibility-smoke.cjs --list | --window-id <positive integer> | --plan /absolute/plan.json');
  if (process.platform !== 'darwin') throw new Error('The software compatibility probe requires macOS.');
  let planSource;
  if (planPath) {
    if (fs.statSync(planPath).size > 16 * 1024) throw new Error('Plan exceeds 16 KiB.');
    planSource = fs.readFileSync(planPath, 'utf8');
    JSON.parse(planSource); // Fail before any build/spawn. The fixture validates the complete finite schema.
  }
  const projectRoot = path.resolve(__dirname, '../..');
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-software-compatibility-'));
  if (planSource !== undefined) fs.writeFileSync(path.join(runDirectory, 'plan.json'), planSource, { mode: 0o600, flag: 'wx' });
  await require('esbuild').build({
    entryPoints: [path.join(projectRoot, 'electron/platform/computer-use/index.ts')],
    outfile: path.join(runDirectory, 'platform.cjs'), bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], logLevel: 'silent',
  });
  const supervision = await runFixture({
    fixture: path.join(__dirname, 'software-compatibility-fixture.cjs'), durationMs: 45_000, maxProcesses: 12,
    allowedExecutables: [path.join(projectRoot, 'build/native/computer-use', `darwin-${process.arch}`, 'omniflow-click')],
    env: { OMNIFLOW_SOFTWARE_COMPATIBILITY_RUN_DIR: runDirectory,
      OMNIFLOW_SOFTWARE_COMPATIBILITY_MODE: list ? 'list' : planPath ? 'plan' : 'window',
      OMNIFLOW_SOFTWARE_COMPATIBILITY_WINDOW_ID: windowId || '' },
  });
  fs.writeFileSync(path.join(runDirectory, 'supervision.json'), JSON.stringify(supervision, null, 2), { mode: 0o600 });
  let report;
  try {
    const resultPath = path.join(runDirectory, 'result.json');
    if (fs.statSync(resultPath).size > 64 * 1024) throw new Error('Oversize result');
    report = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch { report = { status: 'failed', detail: 'Fixture exited without a bounded final report.' }; }
  const cleaned = supervision.cleanupConfirmed === true && supervision.reason === 'completed'
    && report.cleanup?.menuSessionClosed === true && report.cleanup?.pointerClosed === true;
  report.cleanup = { ...report.cleanup, helperProcessesClosed: supervision.cleanupConfirmed === true };
  const passed = cleaned && supervision.exitCode === 0 && report.status === 'passed';
  const blocked = cleaned && supervision.exitCode === 2 && report.status === 'blocked';
  if (!passed && !blocked) report.status = 'failed';
  console.log(JSON.stringify({ ...report, supervision, runDirectory }));
  process.exitCode = passed ? 0 : blocked ? 2 : 1;
}

main().catch(error => { console.error(String(error).slice(0, 1024)); process.exitCode = 1; });
