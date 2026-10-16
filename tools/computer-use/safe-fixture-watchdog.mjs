/** Independent Node watchdog; never run inside the fixture process group. */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fixtureLimits, globalFixtureLock } from './safe-fixture-launcher.mjs';

const exec = promisify(execFile);
const entryPath = fileURLToPath(new URL('./safe-fixture-entry.cjs', import.meta.url));
export function parseProcessSnapshot(text) {
  return text.trim().split('\n').filter(Boolean).map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) throw new Error('Unable to parse process identity; cleanup remains unconfirmed.');
    return { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), startedAt: match[4] };
  });
}
async function processSnapshot() {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], {
    encoding: 'utf8', timeout: 1000, maxBuffer: 2 * 1024 * 1024,
  });
  return parseProcessSnapshot(stdout);
}
function signalGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid owned process group.');
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export async function superviseFixture(config, dependencies = {}) {
  fixtureLimits(config);
  const runtime = dependencies.runtime ?? process;
  const snapshot = dependencies.snapshot ?? processSnapshot;
  const killGroup = dependencies.signalGroup ?? signalGroup;
  const save = dependencies.writeFile ?? writeFile;
  const runDirectory = await (dependencies.makeRunDirectory ?? (() => mkdtemp(path.join(os.tmpdir(), 'omniflow-gui-fixture-'))))();
  const parent = (await snapshot()).find(item => item.pid === config.supervisorPid);
  if (!parent || !runtime.connected) throw new Error('Supervisor disappeared before fixture startup.');
  let child;
  let reason;
  let exitCode = null;
  let exited = false;
  let finished = false;
  let checking = false;
  let maxObservedProcesses = 0;
  let logs = Buffer.alloc(0);
  let killTimer;
  let giveUpTimer;
  let pollTimer;
  let deadlineTimer;
  let entryStarted = false;
  let entryReady = false;
  let metadataReady = false;
  let leaderStartedAt;
  let finish;
  const result = new Promise(resolve => { finish = resolve; });
  const signalOwnedGroup = async signal => {
    try {
      const processes = await snapshot();
      if (finished) return;
      const leader = processes.find(item => item.pid === child.pid);
      const group = processes.filter(item => item.pgid === child.pid);
      if (leader && (!leaderStartedAt || leader.startedAt !== leaderStartedAt || leader.pgid !== child.pid)) {
        await complete(false); return;
      }
      if (group.length === 0) {
        if (exited || !leader) await complete(true);
      } else if (leaderStartedAt) killGroup(child.pid, signal);
      else await complete(false);
    } catch { /* Inspection failure never authorizes signaling an unknown group. */ }
  };
  const stop = why => {
    if (finished || reason) return;
    reason = why;
    if (child?.pid) {
      void signalOwnedGroup('SIGTERM');
      killTimer = setTimeout(() => {
        void signalOwnedGroup('SIGKILL');
      }, 700);
      giveUpTimer = setTimeout(() => complete(false), 2500);
    } else complete(true);
  };
  const onDisconnect = () => stop('supervisor-lost');
  const onSignal = () => stop('interrupted');
  const onMessage = message => { if (message?.type === 'stop' && message.token === config.token) stop('interrupted'); };
  const complete = async cleanupConfirmed => {
    if (finished) return;
    finished = true;
    clearInterval(pollTimer); clearTimeout(deadlineTimer); clearTimeout(killTimer); clearTimeout(giveUpTimer);
    runtime.removeListener('disconnect', onDisconnect);
    runtime.removeListener('SIGTERM', onSignal); runtime.removeListener('SIGINT', onSignal);
    runtime.removeListener('message', onMessage);
    child?.stdout?.destroy(); child?.stderr?.destroy();
    if (child?.connected) child.disconnect();
    child?.unref();
    const report = { reason, exitCode, cleanupConfirmed, electronSpawnCount: child ? 1 : 0,
      maxObservedProcesses, processLimit: config.maxProcesses, durationLimitMs: config.durationMs,
      groupId: child?.pid ?? null, runDirectory };
    try {
      await save(path.join(runDirectory, 'fixture.log'), logs, { mode: 0o600 });
      if (cleanupConfirmed) await (dependencies.releaseLock ?? (async () => {
        const ownerPath = path.join(config.lockPath, 'owner.json');
        const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
        if (owner.token !== config.token) throw new Error('Fixture lock owner changed.');
        await unlink(ownerPath); await rmdir(config.lockPath);
      }))();
    } catch (error) { report.cleanupConfirmed = false; report.detail = String(error).slice(0, 1000); }
    // Parent-loss callers read this file: publish only after the lock outcome is
    // known, never an optimistic cleanup result followed by an in-memory error.
    try { await save(path.join(runDirectory, 'result.json'), JSON.stringify(report), { mode: 0o600 }); }
    catch (error) { report.cleanupConfirmed = false; report.detail = String(error).slice(0, 1000); }
    finish(report);
  };
  runtime.once('disconnect', onDisconnect);
  runtime.on('SIGTERM', onSignal); runtime.on('SIGINT', onSignal);
  runtime.on('message', onMessage);
  deadlineTimer = setTimeout(() => stop('deadline'), config.durationMs);
  try {
    child = (dependencies.spawn ?? spawn)(config.electron, [entryPath, `--fixture-token=${config.token}`], {
      shell: false, detached: true, cwd: path.dirname(config.fixture),
      env: { ...config.env, OMNIFLOW_GUI_FIXTURE_CHILD: '1', OMNIFLOW_GUI_FIXTURE_DEPTH: '1', OMNIFLOW_GUI_FIXTURE_TOKEN: config.token },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const collect = bytes => { if (logs.length < 65536) logs = Buffer.concat([logs, bytes.subarray(0, 65536 - logs.length)]); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    const startEntry = () => {
      if (metadataReady && entryReady && !entryStarted && !reason && runtime.connected) {
        entryStarted = true;
        child.send({ type: 'run', token: config.token, fixture: config.fixture,
          allowedExecutables: config.allowedExecutables, profile: path.join(runDirectory, 'profile') });
      }
    };
    child.on('message', message => {
      if (message?.type === 'entry-ready' && message.token === config.token) { entryReady = true; startEntry(); }
    });
    child.once('error', () => stop('spawn-error'));
    child.once('exit', code => { exited = true; exitCode = code; stop('completed'); });
    if (!child.pid) stop('spawn-error');
    else {
      const leader = (await snapshot()).find(item => item.pid === child.pid);
      if (!leader || leader.pgid !== child.pid || leader.ppid !== runtime.pid) throw new Error('Unable to establish owned process group.');
      leaderStartedAt = leader.startedAt;
      // Persist identity before allowing the fixture's first import. The entry
      // waits for IPC, so a crash here cannot start its fixture workload.
      await save(path.join(config.lockPath, 'owner.json'), JSON.stringify({
        token: config.token, supervisorPid: config.supervisorPid, watchdogPid: runtime.pid,
        groupId: child.pid, leaderStartedAt, runDirectory,
      }), { mode: 0o600 });
      metadataReady = true;
      startEntry();
      if (runtime.connected) runtime.send({ type: 'started', token: config.token });
    }
  } catch { stop('startup-error'); }
  const check = async () => {
    if (checking || finished || !child?.pid) return;
    checking = true;
    try {
      const processes = await snapshot();
      if (finished) return;
      const group = processes.filter(item => item.pgid === child.pid);
      maxObservedProcesses = Math.max(maxObservedProcesses, group.length);
      const sameParent = processes.some(item => item.pid === parent.pid && item.startedAt === parent.startedAt);
      if (!sameParent || !runtime.connected) stop('supervisor-lost');
      if (group.length > config.maxProcesses) stop('process-limit');
      if (reason && group.length === 0 && (exited || !processes.some(item => item.pid === child.pid))) await complete(true);
    } catch { stop('process-inspection-failed'); }
    finally { checking = false; }
  };
  if (!finished) { pollTimer = setInterval(check, 100); await check(); }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.versions.electron || process.env.OMNIFLOW_GUI_FIXTURE_DEPTH !== 'watchdog'
      || process.env.OMNIFLOW_GUI_FIXTURE_CHILD || process.env.OMNIFLOW_GUI_FIXTURE_TOKEN
      || !process.connected) throw new Error('Watchdog requires the Node supervisor IPC.');
  const startupTimer = setTimeout(() => process.exit(1), 3000);
  const beforeStartDisconnect = () => process.exit(1);
  process.once('disconnect', beforeStartDisconnect);
  process.once('message', async message => {
    clearTimeout(startupTimer);
    process.removeListener('disconnect', beforeStartDisconnect);
    const config = message?.config;
    if (message?.type !== 'start' || !config || config.supervisorPid !== process.ppid
        || config.lockPath !== globalFixtureLock || typeof config.token !== 'string') process.exit(1);
    try {
      const owner = JSON.parse(await readFile(path.join(config.lockPath, 'owner.json'), 'utf8'));
      if (owner.token !== config.token || owner.supervisorPid !== config.supervisorPid) throw new Error('Fixture lock mismatch.');
      const result = await superviseFixture(config);
      if (process.connected) process.send({ type: 'result', token: config.token, result }, () => process.exit(result.cleanupConfirmed ? 0 : 1));
      else process.exit(result.cleanupConfirmed ? 0 : 1);
    } catch { process.exit(1); }
  });
  process.send({ type: 'ready' });
}
