import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enumerateAgentHostFiles } from './agent-host-file-scan';

function stub(behavior?: (child: ReturnType<typeof processStub>) => void) {
  const child = processStub();
  const run = vi.fn(() => { queueMicrotask(() => behavior?.(child)); return child; });
  return { child, run: run as unknown as typeof spawn, calls: run };
}
function processStub() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true; }) });
  return child;
}
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'agent-native-scan-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('private native file enumeration', () => {
  it('fixes no-follow/hidden/ignore/config flags and validates scope before accepting paths', async () => {
    const valid = stub(child => { child.stdout.write(`${path.join(root, 'a.txt')}\0`); child.emit('close', 0); });
    const result = await enumerateAgentHostFiles(root, new AbortController().signal, { spawnProcess: valid.run });
    expect(result).toMatchObject({ engine: 'ripgrep-files', files: [path.join(root, 'a.txt')] });
    expect(valid.calls).toHaveBeenCalledWith('rg', ['--files', '--hidden', '--no-ignore', '--no-follow', '--null', '--no-config', '--color=never', '--', root],
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const escape = stub(child => { child.stdout.write(`${path.join(root, '..', 'outside.txt')}\0`); child.emit('close', 0); });
    await expect(enumerateAgentHostFiles(root, new AbortController().signal, { spawnProcess: escape.run })).rejects.toThrow('目录内');
  });
  it('does not downgrade permission/process errors or partial native output into complete fallback results', async () => {
    const denied = stub(child => child.emit('close', 2));
    await expect(enumerateAgentHostFiles(root, new AbortController().signal, { spawnProcess: denied.run })).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
    const partial = stub(child => { child.stdout.write('unterminated'); child.emit('close', 0); });
    await expect(enumerateAgentHostFiles(root, new AbortController().signal, { spawnProcess: partial.run })).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
  });
  it('kills cancelled, timed-out and over-budget scans', async () => {
    const controller = new AbortController();
    const cancelled = stub(() => controller.abort(new Error('stop scan')));
    await expect(enumerateAgentHostFiles(root, controller.signal, { spawnProcess: cancelled.run })).rejects.toThrow('stop scan');
    expect(cancelled.child.kill).toHaveBeenCalledWith('SIGKILL');
    const hanging = stub();
    await expect(enumerateAgentHostFiles(root, new AbortController().signal, { spawnProcess: hanging.run, timeoutMs: 5 })).rejects.toMatchObject({ code: 'SEARCH_BUDGET' });
    const huge = stub(child => child.stdout.write('a\0'.repeat(5_001)));
    await expect(enumerateAgentHostFiles(root, new AbortController().signal, { spawnProcess: huge.run })).rejects.toMatchObject({ code: 'SEARCH_BUDGET' });
    expect(huge.child.kill).toHaveBeenCalledOnce();
  });
  it('can explicitly test missing native resources without using an installed rg', async () => {
    const result = await enumerateAgentHostFiles(root, new AbortController().signal, { executable: '' });
    expect(result).toMatchObject({ engine: 'javascript-files', files: [] });
    await expect(enumerateAgentHostFiles(root, new AbortController().signal, { executable: '', engine: 'ripgrep' }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
  });
});
