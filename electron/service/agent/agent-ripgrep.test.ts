import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { runAgentRipgrep } from './agent-ripgrep';
import { resolveAgentRipgrepExecutable } from './agent-ripgrep-executable';

function fakeSpawn(behavior?: (child: ReturnType<typeof processStub>) => void) {
  const child = processStub();
  const run = vi.fn(() => { queueMicrotask(() => behavior?.(child)); return child; });
  return { child, run: run as unknown as typeof spawn, calls: run };
}
function processStub() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true; }) });
  return child;
}
const signal = () => new AbortController().signal;
const bundledExecutable = await resolveAgentRipgrepExecutable();

describe('private rg adapter', () => {
  it.skipIf(!bundledExecutable)('uses the prepared bundle with an empty PATH for real Unicode regex matching', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const result = await runAgentRipgrep('😀ΩΣ saved\nother\n', '\\p{Greek}+', { signal: signal(), regex: true });
      expect(result).toContain('😀ΩΣ saved');
      expect(result).toContain('"type":"match"');
    } finally { process.env.PATH = originalPath; }
  });
  it('reports explicitly missing bundled resources instead of running a bare PATH command', async () => {
    await expect(runAgentRipgrep('saved', 'x', { signal: signal(), regex: true, executable: '' }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
  });
  it('uses fixed arguments and stdin, with no shell interpolation or user configuration', async () => {
    const stub = fakeSpawn(child => { child.stdout.write(Buffer.from('json')); child.emit('close', 0); });
    const pattern = '-e $(touch /tmp/never)';
    await expect(runAgentRipgrep('snapshot', pattern, { signal: signal(), regex: false, spawnProcess: stub.run })).resolves.toBe('json');
    expect(stub.calls).toHaveBeenCalledWith('rg', expect.arrayContaining(['--no-config', '--json', '--fixed-strings', '-e', pattern, '--', '-']),
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(stub.child.stdin.read()?.toString()).toBe('snapshot');
  });
  it('distinguishes missing capability, regex rejection and executable failure', async () => {
    const absent = fakeSpawn(child => child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })));
    await expect(runAgentRipgrep('', 'x', { signal: signal(), regex: true, spawnProcess: absent.run })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    const invalid = fakeSpawn(child => { child.stderr.write('regex parse error: look-around is unsupported'); child.emit('close', 2); });
    await expect(runAgentRipgrep('', '(?=x)', { signal: signal(), regex: true, spawnProcess: invalid.run })).rejects.toMatchObject({ code: 'INVALID_PATTERN' });
    const failed = fakeSpawn(child => child.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' })));
    await expect(runAgentRipgrep('', 'x', { signal: signal(), regex: false, spawnProcess: failed.run })).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
  });
  it('kills the child on cancellation, timeout and oversized output', async () => {
    const cancel = new AbortController();
    const cancelled = fakeSpawn(() => cancel.abort(new Error('stop searching')));
    await expect(runAgentRipgrep('', 'x', { signal: cancel.signal, regex: false, spawnProcess: cancelled.run })).rejects.toThrow('stop searching');
    expect(cancelled.child.kill).toHaveBeenCalledWith('SIGKILL');
    const hanging = fakeSpawn();
    await expect(runAgentRipgrep('', 'x', { signal: signal(), regex: false, spawnProcess: hanging.run, timeoutMs: 5 })).rejects.toMatchObject({ code: 'SEARCH_BUDGET' });
    expect(hanging.child.kill).toHaveBeenCalledOnce();
    const large = fakeSpawn(child => child.stdout.write(Buffer.alloc(50)));
    await expect(runAgentRipgrep('', 'x', { signal: signal(), regex: false, spawnProcess: large.run, maxOutputBytes: 10 })).rejects.toMatchObject({ code: 'SEARCH_BUDGET' });
    expect(large.child.kill).toHaveBeenCalledOnce();
  });
});
