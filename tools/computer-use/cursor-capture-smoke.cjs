/*
 * Node-only: node tools/computer-use/cursor-capture-smoke.cjs
 * Run after native preparation. Existing macOS Screen Recording access only.
 * No account/library data or input operations; uses the shared bounded supervisor.
 * Exit 0 = passed, 1 = failed/unconfirmed cleanup, 2 = blocked/skipped.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function runDriver() {
  const { assertNodeSupervisor, runFixture } = await import('./safe-fixture-launcher.mjs');
  assertNodeSupervisor();
  const projectRoot = path.resolve(__dirname, '../..');
  if (process.platform !== 'darwin') {
    console.log(JSON.stringify({ status: 'skipped', detail: 'Native cursor capture requires macOS' }));
    process.exitCode = 2;
    return;
  }
  const outputRoot = process.env.OMNIFLOW_CURSOR_CAPTURE_SMOKE_OUTPUT_ROOT
    ? path.resolve(process.env.OMNIFLOW_CURSOR_CAPTURE_SMOKE_OUTPUT_ROOT) : os.tmpdir();
  fs.mkdirSync(outputRoot, { recursive: true });
  const runDirectory = fs.mkdtempSync(path.join(outputRoot, 'omniflow-cursor-capture-smoke-'));
  await require('esbuild').build({
    entryPoints: [path.join(projectRoot, 'electron/platform/computer-use/index.ts')],
    outfile: path.join(runDirectory, 'runtime.cjs'), bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], logLevel: 'silent',
  });
  const supervision = await runFixture({
    fixture: path.join(__dirname, 'cursor-capture-fixture.cjs'), durationMs: 45_000, maxProcesses: 12,
    allowedExecutables: [path.join(projectRoot, 'build/native/computer-use', `darwin-${process.arch}`, 'omniflow-click')],
    env: { OMNIFLOW_CURSOR_CAPTURE_SMOKE_RUN_DIR: runDirectory },
  });
  fs.writeFileSync(path.join(runDirectory, 'supervision.json'), JSON.stringify(supervision, null, 2));
  let report;
  try {
    const resultPath = path.join(runDirectory, 'result.json');
    assert(fs.statSync(resultPath).size <= 16_384, 'Result report exceeds its bound');
    report = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch { report = { status: 'failed', detail: 'Electron exited without a complete result report' }; }
  const cleaned = supervision.cleanupConfirmed && supervision.reason === 'completed';
  const passed = cleaned && supervision.exitCode === 0 && report.status === 'passed'
    && report.cleanup?.cursorExitConfirmed === true && report.cleanup?.fixtureDestroyed === true
    && report.cleanup?.coverDestroyed === true;
  const blocked = cleaned && supervision.exitCode === 2 && ['blocked', 'skipped'].includes(report.status);
  if (!passed && !blocked) {
    report.status = 'failed';
    report.detail ||= 'Supervised execution or cleanup was not successful';
  }
  console.log(JSON.stringify({ ...report, supervision, runDirectory }));
  process.exitCode = passed ? 0 : blocked ? 2 : 1;
}
runDriver().catch(error => {
  console.log(JSON.stringify({ status: 'failed', detail: String(error).slice(0, 1024) }));
  process.exitCode = 1;
});
