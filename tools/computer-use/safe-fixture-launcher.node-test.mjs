import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { acquireFixtureLock, assertNodeSupervisor, fixtureLimits, runFixture } from './safe-fixture-launcher.mjs';
import { superviseFixture } from './safe-fixture-watchdog.mjs';
const { hardenFixtureChildren } = createRequire(import.meta.url)('./safe-fixture-child-policy.cjs');
const directories = [];
const children = [];
afterEach(async () => {
  for (const child of children.splice(0)) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const temporary = async () => { const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-safe-launcher-test-')); directories.push(directory); return directory; };
const waitFor = async predicate => {
  const deadline = Date.now() + 6000;
  do { const result = await predicate().catch(() => undefined); if (result) return result; await new Promise(resolve => setTimeout(resolve, 30)); } while (Date.now() < deadline);
  throw new Error('Timed out waiting for Node-only watchdog evidence.');
};

describe('safe fixture startup without Electron', () => {
  it('rejects Electron and every inherited marker before resolution, IO or spawn', async () => {
    for (const runtime of [
      { versions: { electron: '30' }, env: {}, platform: 'darwin' },
      ...['OMNIFLOW_GUI_FIXTURE_CHILD', 'OMNIFLOW_GUI_FIXTURE_DEPTH', 'OMNIFLOW_GUI_FIXTURE_TOKEN'].map(key => ({ versions: {}, env: { [key]: '' }, platform: 'darwin' })),
    ]) {
      const resolveElectron = vi.fn(); const realpath = vi.fn(); const spawn = vi.fn();
      await expect(runFixture({ fixture: '/fixture.cjs' }, { runtime, resolveElectron, realpath, fork: spawn })).rejects.toThrow('recursive');
      expect(resolveElectron).not.toHaveBeenCalled(); expect(realpath).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
    }
    expect(() => assertNodeSupervisor({ versions: {}, env: {}, platform: 'win32' })).toThrow('POSIX');
  });

  it('uses an atomic exclusive lock and never takes over an incomplete or stale record', async () => {
    const directory = await temporary(); const lockPath = path.join(directory, 'lock');
    const first = await acquireFixtureLock(lockPath);
    await expect(acquireFixtureLock(lockPath)).rejects.toThrow('refusing to launch');
    await first.release();
    await mkdir(lockPath);
    await expect(acquireFixtureLock(lockPath)).rejects.toThrow('refusing to launch');
  });

  it('bounds wall duration and own process count', () => {
    expect(fixtureLimits()).toEqual({ durationMs: 30000, maxProcesses: 12 });
    for (const input of [{ durationMs: 60001 }, { durationMs: 0 }, { maxProcesses: 17 }, { maxProcesses: 0 }]) expect(() => fixtureLimits(input)).toThrow();
  });

  it('suppresses late ready after cancellation and sanitizes runtime injection flags', async () => {
    const runtime = Object.assign(new EventEmitter(), { versions: {}, env: { NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1' }, platform: 'darwin', execPath: '/node', pid: 90 });
    const watchdog = Object.assign(new EventEmitter(), { connected: true, send: vi.fn() });
    const spawn = vi.fn(() => watchdog);
    const pending = runFixture({ fixture: '/entry.cjs' }, { runtime, realpath: async p => p,
      acquireLock: async () => ({ record: { token: 'test' }, release: vi.fn() }), resolveElectron: () => '/Electron', fork: spawn });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    expect(spawn.mock.calls[0][2].env.NODE_OPTIONS).toBeUndefined();
    expect(spawn.mock.calls[0][2].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    runtime.emit('SIGTERM'); watchdog.emit('message', { type: 'ready' });
    expect(watchdog.send.mock.calls.map(([m]) => m.type)).toEqual(['stop']);
    watchdog.emit('message', { type: 'result', token: 'test', result: { cleanupConfirmed: true } });
    await expect(pending).resolves.toEqual({ cleanupConfirmed: true });
  });

  it('cannot start from a late ready after watchdog startup timed out', async () => {
    vi.useFakeTimers();
    try {
      const runtime = Object.assign(new EventEmitter(), { versions: {}, env: {}, platform: 'darwin', execPath: '/node', pid: 90 });
      const watchdog = Object.assign(new EventEmitter(), { connected: true, send: vi.fn() });
      const pending = runFixture({ fixture: '/entry.cjs' }, { runtime, realpath: async p => p,
        acquireLock: async () => ({ record: { token: 'test' }, release: vi.fn() }), resolveElectron: () => '/Electron', fork: () => watchdog }).catch(error => error);
      await vi.advanceTimersByTimeAsync(4001);
      expect((await pending).message).toContain('did not acknowledge');
      watchdog.emit('message', { type: 'ready' });
      expect(watchdog.send.mock.calls.map(([m]) => m.type)).toEqual(['stop']);
    } finally { vi.useRealTimers(); }
  });

  it('blocks recursive executables, detached children and shells before native spawn', () => {
    const childProcess = Object.fromEntries(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'].map(key => [key, vi.fn()]));
    const native = childProcess.spawn;
    hardenFixtureChildren(childProcess, ['/owned/helper', '/owned/Electron', '/bin/sh'], '/owned/Electron', p => p === '/alias/helper' ? '/owned/helper' : p);
    for (const command of ['/owned/Electron', '/unapproved/child']) expect(() => childProcess.spawn(command, [])).toThrow('refused');
    expect(() => childProcess.spawn('/owned/helper', [], { detached: true })).toThrow('refused');
    expect(() => childProcess.spawn('/owned/helper', [], { shell: true })).toThrow('refused');
    expect(() => childProcess.exec('anything')).toThrow('disabled'); expect(() => childProcess.fork('/entry')).toThrow('disabled');
    expect(native).not.toHaveBeenCalled();
    childProcess.spawn('/alias/helper', ['--read'], { detached: false, shell: false });
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0][0]).toBe('/owned/helper');
  });
});

describe('watchdog identity and startup gates', () => {
  const config = { fixture: '/entry.cjs', allowedExecutables: [], electron: '/Electron', token: 'test', lockPath: '/lock', supervisorPid: 90, durationMs: 500, maxProcesses: 12, env: {} };
  function fakeWatchdog() {
    const parent = { pid: 90, ppid: 1, pgid: 90, startedAt: 'parent-start' };
    const leader = { pid: 300, ppid: 200, pgid: 300, startedAt: 'child-start' };
    const runtime = Object.assign(new EventEmitter(), { pid: 200, connected: true, send: vi.fn() });
    const child = Object.assign(new EventEmitter(), { pid: 300, connected: true, send: vi.fn(), disconnect: vi.fn(), unref: vi.fn() });
    const state = { processes: [parent, leader] };
    const dependencies = { runtime, snapshot: async () => state.processes,
      makeRunDirectory: async () => '/report', writeFile: vi.fn(async () => {}), releaseLock: vi.fn(async () => {}), signalGroup: vi.fn(),
      spawn: vi.fn(() => { queueMicrotask(() => child.emit('message', { type: 'entry-ready', token: 'test' })); return child; }) };
    return { parent, leader, runtime, child, state, dependencies };
  }
  it('entry-ready cannot load fixture before the owned group record is persisted', async () => {
    const fake = fakeWatchdog(); let persist;
    fake.dependencies.writeFile.mockImplementation(file => file === '/lock/owner.json' ? new Promise(resolve => { persist = resolve; }) : Promise.resolve());
    const outcome = superviseFixture(config, fake.dependencies);
    await vi.waitFor(() => expect(persist).toBeTypeOf('function'));
    expect(fake.child.send).not.toHaveBeenCalled();
    persist();
    await vi.waitFor(() => expect(fake.child.send).toHaveBeenCalledTimes(1));
    fake.state.processes = [fake.parent]; fake.child.emit('exit', 0);
    expect(await outcome).toMatchObject({ reason: 'completed', cleanupConfirmed: true });
    expect(fake.dependencies.spawn).toHaveBeenCalledTimes(1);
  });
  it('does not signal a reused leader PID or release an unconfirmed group lock', async () => {
    const fake = fakeWatchdog();
    const outcome = superviseFixture(config, fake.dependencies);
    await vi.waitFor(() => expect(fake.child.send).toHaveBeenCalledTimes(1));
    fake.state.processes = [fake.parent, { ...fake.leader, startedAt: 'another-process' }];
    fake.runtime.emit('SIGTERM');
    expect(await outcome).toMatchObject({ cleanupConfirmed: false });
    expect(fake.dependencies.signalGroup).not.toHaveBeenCalled();
    expect(fake.dependencies.releaseLock).not.toHaveBeenCalled();
  });
  it('publishes the final lock failure to disk instead of an optimistic cleanup result', async () => {
    const fake = fakeWatchdog();
    fake.dependencies.releaseLock.mockRejectedValue(new Error('lock-release-failed'));
    const outcome = superviseFixture(config, fake.dependencies);
    await vi.waitFor(() => expect(fake.child.send).toHaveBeenCalledTimes(1));
    fake.state.processes = [fake.parent]; fake.child.emit('exit', 0);
    const report = await outcome;
    expect(report).toMatchObject({ cleanupConfirmed: false, detail: 'Error: lock-release-failed' });
    const [, persisted] = fake.dependencies.writeFile.mock.calls.find(([file]) => file === '/report/result.json');
    expect(JSON.parse(persisted)).toEqual(report);
  });
});

// These tests run real Node processes and POSIX groups, never Electron or a GUI.
async function createNodeHarness(mode, supervisorPid = process.pid) {
  const directory = await temporary();
  const entry = path.join(directory, 'node-entry.mjs');
  const harness = path.join(directory, 'watchdog-harness.mjs');
  const resultDirectory = path.join(directory, 'report'); await mkdir(resultDirectory);
  await writeFile(entry, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
process.once('message', m => {
  writeFileSync(process.env.FIXTURE_RUNNING, 'yes');
  if (process.env.FIXTURE_MODE === 'success') process.exit(0);
  if (process.env.FIXTURE_MODE === 'cap') for (let i=0;i<3;i++) spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setTimeout(()=>process.exit(2),8000);setInterval(()=>{},1000)'], {stdio:'ignore'});
});
process.send({type:'entry-ready',token:process.env.OMNIFLOW_GUI_FIXTURE_TOKEN});
setInterval(()=>{},1000);
setTimeout(()=>process.exit(2),8000);
`);
  const watchdogUrl = new URL('./safe-fixture-watchdog.mjs', import.meta.url).href;
  await writeFile(harness, `import { spawn } from 'node:child_process';
import { superviseFixture } from ${JSON.stringify(watchdogUrl)};
process.once('message', async config => {
  const result = await superviseFixture(config, {
    spawn: (_executable,_args,options) => spawn(process.execPath,[${JSON.stringify(entry)}],options),
    makeRunDirectory: async () => ${JSON.stringify(resultDirectory)},
  });
  if(process.connected) process.send({type:'result',result},()=>process.exit(0)); else process.exit(0);
});
`);
  const lockPath = path.join(directory, 'lock');
  const lock = await acquireFixtureLock(lockPath, { supervisorPid });
  const config = { fixture: entry, electron: '/not-used', allowedExecutables: [], token: lock.record.token,
    lockPath, supervisorPid, durationMs: mode === 'timeout' ? 500 : 5000,
    maxProcesses: mode === 'cap' ? 2 : 12,
    env: { ...process.env, FIXTURE_MODE: mode, FIXTURE_RUNNING: path.join(directory, 'running') } };
  return { directory, harness, config, resultDirectory };
}
async function startNodeHarness(mode) {
  const state = await createNodeHarness(mode);
  const child = fork(state.harness, [], { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] }); children.push(child);
  const result = new Promise((resolve, reject) => {
    child.on('message', message => { if (message.type === 'result') resolve(message.result); });
    child.on('error', reject);
  });
  child.send(state.config);
  return { ...state, child, result };
}
describe.skipIf(!['darwin', 'linux'].includes(process.platform))('independent watchdog with harmless Node children', () => {
  it.each([['success', 'completed'], ['timeout', 'deadline'], ['cap', 'process-limit']])('%s starts exactly one main and confirms group cleanup', async (mode, reason) => {
    const { result, config } = await startNodeHarness(mode);
    const report = await result;
    expect(report).toMatchObject({ reason, cleanupConfirmed: true, electronSpawnCount: 1 });
    if (mode === 'cap') expect(report.maxObservedProcesses).toBeGreaterThan(2);
    expect(() => process.kill(-report.groupId, 0)).toThrow();
    await expect(readFile(path.join(config.lockPath, 'owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 10_000);

  it('outlives a killed launcher and cleans the fixture group after parent loss', async () => {
    const state = await createNodeHarness('parent-loss');
    const supervisorPath = path.join(state.directory, 'supervisor.mjs');
    await writeFile(supervisorPath, `import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.once('message', config=>{
 config.supervisorPid=process.pid;
 writeFileSync(config.lockPath+'/owner.json',JSON.stringify({token:config.token,supervisorPid:process.pid}));
 const watchdog=fork(${JSON.stringify(state.harness)},[],{detached:true,stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
 watchdog.send(config);
});
`);
    const supervisor = fork(supervisorPath, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] }); children.push(supervisor);
    supervisor.send(state.config);
    await waitFor(() => readFile(path.join(state.directory, 'running'), 'utf8'));
    supervisor.kill('SIGKILL');
    const report = await waitFor(async () => JSON.parse(await readFile(path.join(state.resultDirectory, 'result.json'), 'utf8')));
    expect(report).toMatchObject({ reason: 'supervisor-lost', cleanupConfirmed: true, electronSpawnCount: 1 });
    expect(() => process.kill(-report.groupId, 0)).toThrow();
    await expect(readFile(path.join(state.config.lockPath, 'owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 10_000);
});
