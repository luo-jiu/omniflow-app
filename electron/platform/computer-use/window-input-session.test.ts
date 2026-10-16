import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerWindowIdentity } from './desktop-computer';
import type { AgentComputerWindowInputRequest } from './window-input';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('electron', () => ({ app: {}, desktopCapturer: {}, screen: {}, systemPreferences: {} }));
vi.mock('./desktop-computer', async importOriginal => ({
  ...await importOriginal<typeof import('./desktop-computer')>(), resolveAgentComputerHelperPath: () => '/native/omniflow-click',
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const window: AgentComputerWindowIdentity = { windowId: 81, pid: 31042, processStartedAt: 1700000000000,
  layer: 0, bounds: { x: -800, y: 100, width: 800, height: 600 }, title: 'QA' };
const request: AgentComputerWindowInputRequest = { window, profile: 'directed-v1', operation: 'click', point: { x: -750, y: 200 } };
const ready = { ok: true, type: 'ready', protocol: 2 };
const focus = { focusPosted: false, focusState: 'inactive' };
const success = (requestId = '1', eventCount = 2) => ({ requestId, ok: true, dispatched: true,
  method: 'CGEventPostToPid', eventCount, releaseSent: true, ...focus });
const refusal = (requestId = '1') => ({ requestId, ok: false, dispatched: false,
  error: { code: 'target_changed', message: 'The frozen window changed.' }, ...focus });
const partial = (releaseSent: boolean, requestId = '1') => ({ requestId, ok: false, dispatched: 'unknown',
  method: 'CGEventPostToPid', eventCount: 2, releaseSent, error: { code: 'cancelled', message: 'Cancelled.' }, ...focus });
const signal = () => new AbortController().signal;
class Pipe extends EventEmitter { destroy = vi.fn(); }
class Child extends EventEmitter {
  stdin = Object.assign(new Pipe(), { write: vi.fn<(value: string) => boolean>().mockReturnValue(true) });
  stdout = new Pipe(); stderr = new Pipe(); kill = vi.fn(() => true);
  progress = new Pipe();
  stdio = [this.stdin, this.stdout, this.stderr, this.progress];
  reply(value: unknown) { this.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`)); }
  feedback(requestId: string, phase: string, sequence: number, point = request.point!) {
    this.progress.emit('data', Buffer.from(`${JSON.stringify({ requestId, phase, sequence, point })}\n`));
  }
  stop(focusState = 'inactive') { this.reply({ ok: true, type: 'stopped', focusState }); this.emit('close', 0); }
}
let createSession: typeof import('./window-input-session')['createAgentComputerWindowInputSession'];
async function setup(startupSignal = signal(), identity = window) {
  const child = new Child(); mocks.spawn.mockReturnValueOnce(child);
  const opening = createSession(identity, startupSignal); child.reply(ready);
  return { child, lease: await opening };
}

beforeEach(async () => {
  vi.resetAllMocks(); vi.resetModules(); vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  createSession = (await import('./window-input-session')).createAgentComputerWindowInputSession;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); Object.defineProperty(process, 'platform', platform); });

describe('persistent directed window input transport', () => {
  it('spawns one fixed native session and reuses it with monotonic request IDs', async () => {
    const { child, lease } = await setup();
    expect(mocks.spawn).toHaveBeenCalledWith('/native/omniflow-click', ['--window-input-session'],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: expect.objectContaining({ OMNIFLOW_WINDOW_INPUT_POINTER_FD: '3' }) });
    expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toEqual({ window });
    for (const id of ['1', '2']) {
      const input = lease.input(request, signal());
      expect(JSON.parse(child.stdin.write.mock.calls.at(-1)![0])).toEqual({ requestId: id, command: 'input', request });
      child.reply(success(id)); await expect(input).resolves.toEqual({ dispatched: true, method: 'CGEventPostToPid', eventCount: 2, releaseSent: true });
    }
    expect(mocks.spawn).toHaveBeenCalledOnce();
    lease.close(); lease.dispose();
    expect(JSON.parse(child.stdin.write.mock.calls.at(-1)![0])).toEqual({ requestId: '3', command: 'close' });
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.reply({ requestId: '3', ok: true, type: 'closed' });
    let ended = false; void lease.closed.then(() => { ended = true; }); await Promise.resolve(); expect(ended).toBe(false);
    child.stop(); await expect(lease.closed).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0); expect(child.stdout.listenerCount('data')).toBe(0);
    child.stdin.emit('error', new Error('late EPIPE'));
    child.progress.emit('error', new Error('late feedback EPIPE'));
  });

  it('keeps double-click and drag post feedback ordered without mixing their request IDs', async () => {
    const { child, lease } = await setup(); const first = vi.fn(), second = vi.fn();
    const doubleClick = { ...request, operation: 'doubleClick' as const };
    const click = lease.input(doubleClick, signal(), first);
    child.feedback('1', 'down', 1); child.feedback('1', 'up', 2);
    child.feedback('1', 'down', 3); child.feedback('1', 'up', 4);
    expect(first.mock.calls.map(([event]) => event.phase)).toEqual(['down', 'up', 'down', 'up']);
    child.reply(success('1', 4)); await click;
    const drag = { ...request, operation: 'drag' as const, endPoint: { x: -700, y: 250 }, durationMs: 100 };
    const dragging = lease.input(drag, signal(), second);
    child.feedback('1', 'down', 1); // Late, already-settled request cannot animate the new intention.
    const frame = Buffer.from(`${JSON.stringify({ requestId: '2', phase: 'down', sequence: 1, point: request.point })}\n`);
    child.progress.emit('data', frame.subarray(0, 15)); child.progress.emit('data', frame.subarray(15));
    child.feedback('2', 'move', 2, drag.endPoint); child.feedback('2', 'up', 3, drag.endPoint);
    expect(first).toHaveBeenCalledTimes(4);
    expect(second.mock.calls.map(([event]) => event)).toEqual([
      { phase: 'down', point: request.point, sequence: 1 },
      { phase: 'move', point: drag.endPoint, sequence: 2 },
      { phase: 'up', point: drag.endPoint, sequence: 3 },
    ]);
    child.reply(success('2', 10)); await dragging;
    child.feedback('2', 'down', 1); expect(second).toHaveBeenCalledTimes(3);
    child.stop(); await lease.closed;
    expect(child.progress.destroy).toHaveBeenCalledOnce(); expect(child.progress.listenerCount('data')).toBe(0);
  });

  it.each(['malformed', 'oversized', 'future request', 'sequence gap', 'outside point', 'callback throw', 'pipe error', 'pipe end'] as const)(
    'isolates %s feedback from authoritative dispatch and subsequent requests', async fault => {
      const { child, lease } = await setup(); const events = vi.fn();
      if (fault === 'callback throw') events.mockImplementationOnce(() => { throw new Error('visual stopped'); });
      const input = lease.input(request, signal(), events);
      if (fault === 'malformed') child.progress.emit('data', Buffer.from('invalid\n'));
      else if (fault === 'oversized') child.progress.emit('data', Buffer.alloc(257, 120));
      else if (fault === 'future request') child.feedback('2', 'down', 1);
      else if (fault === 'sequence gap') child.feedback('1', 'down', 2);
      else if (fault === 'outside point') child.feedback('1', 'down', 1, { x: 100, y: 200 });
      else if (fault === 'pipe error') child.progress.emit('error', new Error('EPIPE'));
      else if (fault === 'pipe end') child.progress.emit('end');
      else child.feedback('1', 'down', 1);
      const count = events.mock.calls.length;
      child.feedback('1', 'down', 1); child.feedback('1', 'up', 2);
      expect(events).toHaveBeenCalledTimes(count);
      expect(child.kill).not.toHaveBeenCalled();
      child.reply(success()); await expect(input).resolves.toMatchObject({ eventCount: 2, releaseSent: true });
      const next = lease.input(request, signal()); child.reply(success('2')); await expect(next).resolves.toMatchObject({ dispatched: true });
      child.stop(); await expect(lease.closed).resolves.toBe(true);
    });

  it('stops cancelled feedback immediately while retaining the paired-release and focus cleanup wait', async () => {
    const { child, lease } = await setup(); const controller = new AbortController(); const events = vi.fn();
    const input = lease.input(request, controller.signal, events); const rejected = expect(input).rejects.toMatchObject({ releaseState: 'confirmed' });
    child.feedback('1', 'down', 1); controller.abort();
    child.feedback('1', 'up', 2); expect(events).toHaveBeenCalledOnce();
    child.reply(partial(true)); child.stop(); await rejected; await expect(lease.closed).resolves.toBe(true);
  });

  it.each(['shortcut', 'typeText', 'scroll'] as const)('does not fabricate pointer callbacks for %s', async operation => {
    const { child, lease } = await setup(); const events = vi.fn();
    const keyboard: AgentComputerWindowInputRequest = operation === 'shortcut'
      ? { window, profile: 'directed-v1', operation, shortcut: { key: 'escape', modifiers: [] } }
      : operation === 'typeText' ? { window, profile: 'directed-v1', operation, text: '测试', focusToken: 'a'.repeat(64) }
        : { ...request, operation, deltaX: 0, deltaY: -10 };
    const input = lease.input(keyboard, signal(), events);
    child.feedback('1', 'down', 1); expect(events).not.toHaveBeenCalled();
    child.reply(success('1', operation === 'scroll' ? 1 : 2)); await input; child.stop();
  });

  it('does not keep a completed startup signal as session lifetime', async () => {
    const controller = new AbortController(); const { child, lease } = await setup(controller.signal);
    controller.abort(); expect(child.kill).not.toHaveBeenCalled();
    const input = lease.input(request, signal()); child.reply(success()); await input; child.stop();
  });

  it.each([
    { windowId: 82 }, { pid: 31043 }, { processStartedAt: 1700000000001 }, { title: 'another' },
    { bounds: { ...window.bounds, x: -799.9 } }, { bounds: { ...window.bounds, width: 801 } }, { layer: 1 },
  ])('refuses a changed frozen identity before writing %j', async changed => {
    const { child, lease } = await setup(); const calls = child.stdin.write.mock.calls.length;
    await expect(lease.input({ ...request, window: { ...window, ...changed } }, signal()))
      .rejects.toMatchObject({ dispatchState: 'not-dispatched', releaseState: 'not-required' });
    expect(child.stdin.write).toHaveBeenCalledTimes(calls); expect(child.kill).not.toHaveBeenCalled(); child.stop();
  });

  it('freezes startup identity independently from caller mutation and rejects legacy profiles', async () => {
    const mutable = structuredClone(window); const { child, lease } = await setup(signal(), mutable); mutable.bounds.x += 1;
    await expect(lease.input({ ...request, window: mutable }, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    await expect(lease.input({ ...request, profile: 'appkit-fixture-v1' }, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    const input = lease.input(request, signal()); child.reply(success()); await input; child.stop();
  });

  it('rejects a second pending request and pre-cancelled input without any new write', async () => {
    const { child, lease } = await setup(); const controller = new AbortController(); controller.abort();
    await expect(lease.input(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const input = lease.input(request, signal());
    await expect(lease.input(request, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(child.stdin.write).toHaveBeenCalledTimes(2); child.reply(success()); await input; child.stop();
  });

  it('preserves an explicit pre-dispatch refusal and permits a fresh request', async () => {
    const { child, lease } = await setup(); const input = lease.input(request, signal()); child.reply(refusal());
    await expect(input).rejects.toMatchObject({ dispatchState: 'not-dispatched', releaseState: 'not-required' });
    expect(child.kill).not.toHaveBeenCalled();
    const next = lease.input(request, signal()); child.reply(success('2')); await next; child.stop();
  });

  it('uses the shared Unicode and event-count parser with the longer text deadline', async () => {
    const { child, lease } = await setup();
    const text = { window, profile: 'directed-v1', operation: 'typeText' as const, text: '中文🌟'.repeat(8), focusToken: 'a'.repeat(64) };
    const input = lease.input(text, signal()); await vi.advanceTimersByTimeAsync(6000);
    expect(child.kill).not.toHaveBeenCalled(); child.reply(success('1', 4)); await input;
    const next = lease.input(request, signal()); const rejected = expect(next).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
    child.reply(success('2', 4)); expect(child.kill).toHaveBeenCalledWith('SIGTERM'); child.stop(); await rejected;
  });

  it.each([success(), partial(true), refusal()])('holds cancellation through real exit and parses the final release receipt %j', async receipt => {
    const { child, lease } = await setup(); const controller = new AbortController(); let settled = false;
    const input = lease.input(request, controller.signal).catch(error => { settled = true; return error; });
    controller.abort(); expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.reply(receipt); await Promise.resolve(); expect(settled).toBe(false);
    await expect(lease.input(request, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    child.stop();
    expect(await input).toMatchObject(receipt.dispatched === false
      ? { dispatchState: 'not-dispatched', releaseState: 'not-required' }
      : { dispatchState: 'unknown', releaseState: 'confirmed' });
    await expect(lease.closed).resolves.toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it('drains the release receipt after exit and before stdio close', async () => {
    const { child, lease } = await setup(); const controller = new AbortController();
    const input = lease.input(request, controller.signal); const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'confirmed' });
    controller.abort(); child.emit('exit', 0); child.reply(partial(true));
    await vi.advanceTimersByTimeAsync(299); child.stop(); await rejected;
    await expect(lease.closed).resolves.toBe(true); expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
  });

  it('accepts a real exit without a close event only after its bounded stdout drain', async () => {
    const { child, lease } = await setup(); lease.close(); child.reply({ ok: true, type: 'stopped', focusState: 'inactive' }); child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(300); await expect(lease.closed).resolves.toBe(true);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not treat a close ACK and real exit as confirmation that synthetic focus was released', async () => {
    const { child, lease } = await setup(); lease.close();
    child.reply({ requestId: '1', ok: true, type: 'closed' }); child.emit('close', 0);
    await expect(lease.closed).resolves.toBe(false);
    await expect(createSession(window, signal())).rejects.toMatchObject({ name: 'AgentComputerWindowInputSessionCloseError' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('accepts the clean terminal focus receipt after exit while still waiting for stdout to drain', async () => {
    const { child, lease } = await setup(); lease.close(); child.emit('exit', 0);
    child.reply({ ok: true, type: 'stopped', focusState: 'released' });
    await vi.advanceTimersByTimeAsync(300);
    await expect(lease.closed).resolves.toBe(true);
  });

  it('reports focus notification effects as unknown without inventing a mouse release or event count', async () => {
    const { child, lease } = await setup();
    const input = lease.input(request, signal());
    child.reply({ ...refusal(), focusPosted: true, focusState: 'retained' });
    await expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'not-required' });
    expect(child.kill).not.toHaveBeenCalled();
    lease.close(); child.stop('released'); await expect(lease.closed).resolves.toBe(true);
  });

  it.each([
    { focusPosted: true, focusState: 'inactive' },
    { focusPosted: false, focusState: 'retained' },
    { focusPosted: false, focusState: 'released' },
  ])('does not let an inactive terminal receipt erase observed focus effects %j', async currentFocus => {
    const { child, lease } = await setup(); const input = lease.input(request, signal());
    child.reply({ ...success(), ...currentFocus }); await input;
    lease.close(); child.stop('inactive'); await expect(lease.closed).resolves.toBe(false);
    await expect(createSession(window, signal())).rejects.toMatchObject({ name: 'AgentComputerWindowInputSessionCloseError' });
  });

  it('holds an unconfirmed focus receipt behind the permanent barrier even if later cleanup claims success', async () => {
    const { child, lease } = await setup(); const input = lease.input(request, signal());
    const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'confirmed' });
    child.reply({ ...success(), focusPosted: true, focusState: 'unconfirmed' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM'); child.stop('released'); await rejected;
    await expect(lease.closed).resolves.toBe(false);
    await expect(createSession(window, signal())).rejects.toMatchObject({ name: 'AgentComputerWindowInputSessionCloseError' });
  });

  it('keeps mouse release confirmation when terminal focus cleanup is unconfirmed', async () => {
    const { child, lease } = await setup(); const controller = new AbortController();
    const input = lease.input(request, controller.signal);
    const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'confirmed' });
    controller.abort(); child.reply({ ...partial(true), focusPosted: true, focusState: 'released' });
    child.stop('unconfirmed'); await rejected; await expect(lease.closed).resolves.toBe(false);
  });

  it.each([
    { ok: true, type: 'stopped', focusState: 'retained' },
    { ok: true, type: 'stopped', focusState: 'released', requestId: '1' },
    { ok: true, type: 'stopped', focusState: 'released', extra: true },
  ])('does not accept a widened or nonterminal cleanup receipt %j', async terminal => {
    const { child, lease } = await setup(); lease.close(); child.reply(terminal); child.emit('close', 0);
    await expect(lease.closed).resolves.toBe(false);
  });

  it('does not accept duplicate terminal focus receipts as a clean close', async () => {
    const { child, lease } = await setup(); lease.close();
    child.reply({ ok: true, type: 'stopped', focusState: 'released' });
    child.reply({ ok: true, type: 'stopped', focusState: 'released' }); child.emit('close', 0);
    await expect(lease.closed).resolves.toBe(false);
  });

  it.each([
    { ...success(), focusPosted: undefined }, { ...success(), focusPosted: 'true' },
    { ...success(), focusState: 'active' },
  ])('refuses input receipts without the exact private focus contract %j', async response => {
    const { child, lease } = await setup(); const input = lease.input(request, signal());
    const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
    child.reply(response); child.stop(); await rejected; await expect(lease.closed).resolves.toBe(false);
  });

  it('keeps at least two seconds for paired release before KILL and globally blocks after unconfirmed closure', async () => {
    const { child, lease } = await setup(); const controller = new AbortController();
    const input = lease.input(request, controller.signal); const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
    controller.abort(); await vi.advanceTimersByTimeAsync(1999); expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(1); expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    await vi.advanceTimersByTimeAsync(300); await rejected; await expect(lease.closed).resolves.toBe(false);
    await expect(createSession(window, signal())).rejects.toMatchObject({ name: 'AgentComputerWindowInputSessionCloseError' });
    child.emit('exit', 0); child.stop();
    await expect(createSession(window, signal())).rejects.toMatchObject({ name: 'AgentComputerWindowInputSessionCloseError' });
    expect(mocks.spawn).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves confirmed release while independently reporting unconfirmed process closure', async () => {
    const { child, lease } = await setup(); const controller = new AbortController();
    const input = lease.input(request, controller.signal); const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'confirmed' });
    controller.abort(); child.reply(partial(true)); await vi.advanceTimersByTimeAsync(2300); await rejected;
    await expect(lease.closed).resolves.toBe(false);
    await expect(createSession(window, signal())).rejects.toMatchObject({ name: 'AgentComputerWindowInputSessionCloseError' });
  });

  it('waits for an existing closing session before admitting another native process', async () => {
    const { child, lease } = await setup(); lease.close(); const nextChild = new Child(); mocks.spawn.mockReturnValueOnce(nextChild);
    const opening = createSession(window, signal()); expect(mocks.spawn).toHaveBeenCalledOnce();
    child.stop(); await Promise.resolve(); await Promise.resolve(); nextChild.reply(ready);
    const next = await opening; expect(mocks.spawn).toHaveBeenCalledTimes(2); nextChild.stop(); await next.closed;
  });

  it('times out input once without replay and waits for native exit', async () => {
    const { child, lease } = await setup(); let settled = false;
    const input = lease.input(request, signal()).catch(error => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(5000); expect(child.kill.mock.calls).toEqual([['SIGTERM']]); expect(settled).toBe(false);
    child.reply(partial(true)); child.stop();
    expect(await input).toMatchObject({ dispatchState: 'unknown', releaseState: 'confirmed' });
    expect(child.stdin.write).toHaveBeenCalledTimes(2); expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    { ...success(), requestId: '2' }, { ...success(), type: 'closed' }, { ...success(), extra: true },
    { ...partial(true), eventCount: 0 }, { ...refusal(), method: 'CGEventPostToPid', eventCount: 2, releaseSent: true },
  ])('rejects mismatched or widened input envelopes without replay %j', async receipt => {
    const { child, lease } = await setup(); const input = lease.input(request, signal());
    const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
    child.reply(receipt); expect(child.kill).toHaveBeenCalledWith('SIGTERM'); child.stop(); await rejected;
    expect(child.stdin.write).toHaveBeenCalledTimes(2);
  });

  it('rejects a duplicate earlier request ID while another input is pending', async () => {
    const { child, lease } = await setup(); const first = lease.input(request, signal()); child.reply(success()); await first;
    const second = lease.input(request, signal()); const rejected = expect(second).rejects.toMatchObject({ dispatchState: 'unknown' });
    child.reply(success()); child.stop(); await rejected; expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it.each(['invalid-utf8', 'empty-line', 'unterminated-oversize', 'multiple-json'])('fails closed on bounded JSONL framing: %s', async kind => {
    const { child, lease } = await setup(); const input = lease.input(request, signal());
    const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown', releaseState: 'unconfirmed' });
    child.stdout.emit('data', kind === 'invalid-utf8' ? Buffer.from([0xc0, 0xaf, 10])
      : Buffer.from(kind === 'empty-line' ? '\n' : kind === 'multiple-json' ? '{} {}\n' : 'x'.repeat(4097)));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM'); child.stop(); await rejected;
  });

  it('parses a split UTF8 frame without broadening its bounded JSONL protocol', async () => {
    const { child, lease } = await setup(); const input = lease.input(request, signal());
    const response = Buffer.from(`${JSON.stringify({ ...refusal(), error: { code: 'target_changed', message: '窗口变更' } })}\n`);
    const split = response.indexOf(Buffer.from('窗')) + 1;
    child.stdout.emit('data', response.subarray(0, split)); child.stdout.emit('data', response.subarray(split));
    await expect(input).rejects.toMatchObject({ dispatchState: 'not-dispatched' }); child.stop();
  });

  it('closes on diagnostic overflow and on an accepted-but-blocked stdin write', async () => {
    const { child, lease } = await setup(); child.stdin.write.mockReturnValueOnce(false);
    const input = lease.input(request, signal()); const rejected = expect(input).rejects.toMatchObject({ dispatchState: 'unknown' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM'); child.stderr.emit('data', Buffer.alloc(64 * 1024 + 1));
    child.stop(); await rejected; expect(child.stdin.write).toHaveBeenCalledTimes(2);
  });

  it('caps a session at 256 inputs and reserves the next ID for close', async () => {
    const { child, lease } = await setup();
    for (let id = 1; id <= 256; id += 1) { const input = lease.input(request, signal()); child.reply(success(String(id))); await input; }
    await expect(lease.input(request, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    expect(JSON.parse(child.stdin.write.mock.calls.at(-1)![0])).toEqual({ requestId: '257', command: 'close' }); child.stop();
  });

  it.each([{ ok: true, ready: true }, { ...ready, protocol: 1 }, { ...ready, unexpected: true }])('rejects an incompatible startup without relinquishing its process %j', async receipt => {
    const child = new Child(); mocks.spawn.mockReturnValueOnce(child); let rejected = false;
    const opening = createSession(window, signal()).catch(error => { rejected = true; return error; });
    child.reply(receipt); await Promise.resolve(); expect(rejected).toBe(false); child.stop();
    expect(await opening).toMatchObject({ dispatchState: 'not-dispatched' }); expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('preserves startup refusal only after actual process termination', async () => {
    const child = new Child(); mocks.spawn.mockReturnValueOnce(child); let rejected = false;
    const opening = createSession(window, signal()).catch(error => { rejected = true; return error; });
    child.reply({ ok: false, dispatched: false, error: { code: 'target_changed', message: 'The frozen window changed.' } });
    await Promise.resolve(); expect(rejected).toBe(false); child.stop();
    expect((await opening).message).toContain('target_changed');
  });

  it('holds startup cancellation through exit and refuses a late ready', async () => {
    const child = new Child(); mocks.spawn.mockReturnValueOnce(child); const controller = new AbortController(); let settled = false;
    const opening = createSession(window, controller.signal).catch(error => { settled = true; return error; });
    controller.abort(); child.reply(ready); await vi.advanceTimersByTimeAsync(1000); expect(settled).toBe(false);
    child.stop(); expect(await opening).toMatchObject({ name: 'AbortError' }); expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('reports startup cleanup failure distinctly and keeps its global launch barrier', async () => {
    const child = new Child(); mocks.spawn.mockReturnValueOnce(child);
    const opening = createSession(window, signal()); const rejected = expect(opening).rejects.toMatchObject({ name: 'AgentComputerWindowInputSessionCloseError' });
    await vi.advanceTimersByTimeAsync(5300); await rejected;
    await expect(createSession(window, signal())).rejects.toMatchObject({ name: 'AgentComputerWindowInputSessionCloseError' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('refuses pre-cancelled startup, unsupported platforms and invalid identities before spawning', async () => {
    const controller = new AbortController(); controller.abort(); await expect(createSession(window, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(createSession({ ...window, layer: 1 }, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' });
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    await expect(createSession(window, signal())).rejects.toMatchObject({ dispatchState: 'not-dispatched' }); expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
