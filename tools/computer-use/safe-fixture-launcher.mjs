/** Node-only entry. Never import this launcher from an Electron fixture. */
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const watchdogPath = fileURLToPath(new URL('./safe-fixture-watchdog.mjs', import.meta.url));
export const fixtureMarkers = ['OMNIFLOW_GUI_FIXTURE_CHILD', 'OMNIFLOW_GUI_FIXTURE_DEPTH', 'OMNIFLOW_GUI_FIXTURE_TOKEN'];
export const globalFixtureLock = path.join(os.tmpdir(), `omniflow-gui-fixture-${process.getuid?.() ?? 'user'}.lock`);

export function assertNodeSupervisor(runtime = process) {
  if (runtime.versions.electron || fixtureMarkers.some(key => Object.hasOwn(runtime.env, key))) {
    throw new Error('Refusing recursive GUI fixture launch: use the Node supervisor exactly once.');
  }
  if (!['darwin', 'linux'].includes(runtime.platform)) throw new Error('GUI fixture supervision requires POSIX process groups.');
}

export function fixtureLimits(options = {}) {
  const durationMs = options.durationMs ?? 30_000;
  const maxProcesses = options.maxProcesses ?? 12;
  if (!Number.isSafeInteger(durationMs) || durationMs < 500 || durationMs > 60_000) throw new Error('durationMs must be 500..60000.');
  if (!Number.isSafeInteger(maxProcesses) || maxProcesses < 1 || maxProcesses > 16) throw new Error('maxProcesses must be 1..16.');
  return { durationMs, maxProcesses };
}

// No stale takeover: an uncertain prior group must be inspected and cleaned up
// explicitly. Incomplete startup/crash records deliberately keep this lock.
export async function acquireFixtureLock(lockPath = globalFixtureLock, owner = {}) {
  try { await mkdir(lockPath, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another GUI fixture or unconfirmed cleanup owns ${lockPath}; refusing to launch.`);
    throw error;
  }
  const record = { token: randomUUID(), supervisorPid: process.pid, createdAt: new Date().toISOString(), ...owner };
  const recordPath = path.join(lockPath, 'owner.json');
  await writeFile(recordPath, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  return {
    record,
    async release() {
      const current = JSON.parse(await readFile(recordPath, 'utf8'));
      if (current.token !== record.token) throw new Error('Fixture lock identity changed; leaving it in place.');
      await unlink(recordPath);
      await rmdir(lockPath);
    },
  };
}

export async function runFixture(options, dependencies = {}) {
  const runtime = dependencies.runtime ?? process;
  // Must precede resolution, filesystem changes and every spawn/fork.
  assertNodeSupervisor(runtime);
  const limits = fixtureLimits(options);
  const fixture = await (dependencies.realpath ?? realpath)(options.fixture);
  if (!path.isAbsolute(fixture) || !/\.(?:cjs|mjs|js)$/.test(fixture)) throw new Error('Fixture must be an absolute JavaScript file.');
  const allowedExecutables = await Promise.all((options.allowedExecutables ?? []).map(executable => (dependencies.realpath ?? realpath)(executable)));
  if (allowedExecutables.length > 8 || allowedExecutables.some(executable => !path.isAbsolute(executable))) throw new Error('At most eight absolute native helpers may be declared.');
  const lock = await (dependencies.acquireLock ?? acquireFixtureLock)();
  let watchdog;
  try {
    const electron = (dependencies.resolveElectron ?? (() => require('electron')))();
    if (typeof electron !== 'string' || !path.isAbsolute(electron)) throw new Error('Node must resolve the Electron executable path.');
    const env = { ...runtime.env, ...options.env };
    // Child runtime flags must never be inherited from shells or fixture input.
    for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', ...fixtureMarkers]) delete env[key];
    watchdog = (dependencies.fork ?? fork)(watchdogPath, [], {
      execPath: runtime.execPath, execArgv: [], detached: true,
      env: { ...env, OMNIFLOW_GUI_FIXTURE_DEPTH: 'watchdog' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const config = { ...limits, fixture, allowedExecutables, electron, env, token: lock.record.token,
      lockPath: globalFixtureLock, supervisorPid: runtime.pid };
    return await new Promise((resolve, reject) => {
      let settled = false;
      let startSent = false;
      let stopping = false;
      const stop = () => { stopping = true; if (watchdog.connected) watchdog.send({ type: 'stop', token: config.token }); };
      const cleanup = () => {
        clearTimeout(startupTimer);
        runtime.removeListener('SIGINT', stop);
        runtime.removeListener('SIGTERM', stop);
      };
      const startupTimer = setTimeout(() => {
        stop();
        if (!settled) { settled = true; cleanup(); reject(new Error('Fixture watchdog did not acknowledge startup; lock retained.')); }
      }, 4000);
      runtime.on('SIGINT', stop);
      runtime.on('SIGTERM', stop);
      watchdog.on('message', message => {
        if (message?.type === 'ready' && !startSent && !settled && !stopping) {
          startSent = true;
          watchdog.send({ type: 'start', config });
        } else if (message?.type === 'started' && message.token === config.token) {
          clearTimeout(startupTimer);
        } else if (message?.type === 'result' && message.token === config.token && !settled) {
          settled = true; cleanup(); resolve(message.result);
        }
      });
      watchdog.once('error', error => {
        if (!settled) { settled = true; cleanup(); reject(error); }
      });
      watchdog.once('exit', () => {
        if (!settled) { settled = true; cleanup(); reject(new Error('Fixture watchdog exited without confirmed cleanup; lock retained.')); }
      });
    });
  } catch (error) {
    // Once the watchdog may exist, only it can prove the group has gone.
    if (!watchdog) await lock.release();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [fixture, ...args] = process.argv.slice(2);
    const options = { fixture, allowedExecutables: [] };
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === '--allow-executable' && args[i + 1]) { options.allowedExecutables.push(args[i + 1]); continue; }
      const key = { '--duration-ms': 'durationMs', '--max-processes': 'maxProcesses' }[args[i]];
      if (!key || args[i + 1] === undefined) throw new Error('Usage: node safe-fixture-launcher.mjs /absolute/entry.cjs [--duration-ms 30000] [--max-processes 12]');
      options[key] = Number(args[i + 1]);
    }
    const result = await runFixture(options);
    console.log(JSON.stringify(result));
    process.exitCode = result.reason === 'completed' && result.exitCode === 0 && result.cleanupConfirmed ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
