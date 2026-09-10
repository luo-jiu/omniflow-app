import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn(), remove: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../../../platform/processTree', () => ({ terminateDesktopProcessTree: mocks.terminate }));
vi.mock('node:fs/promises', () => ({
  access: vi.fn(async () => undefined), stat: vi.fn(async () => ({ isFile: () => true, size: 12 })),
  mkdtemp: vi.fn(async () => '/tmp/office-test'), mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from('%PDF-fixture')), rm: mocks.remove,
}));
import { convertPresentationToPdf } from './office-renderer';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe('presentation renderer lifecycle', () => {
  it('uses fixed argv without a shell and cleans the private conversion directory', async () => {
    vi.stubEnv('OMNIFLOW_LIBREOFFICE_PATH', '/test/soffice');
    mocks.spawn.mockImplementation(() => { const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0)); return child; });
    expect(Buffer.from(await convertPresentationToPdf(new Uint8Array(), new AbortController().signal)).toString()).toContain('%PDF');
    expect(mocks.spawn).toHaveBeenCalledWith('/test/soffice', expect.arrayContaining(['--headless', '--convert-to']), expect.objectContaining({ shell: false }));
    expect(mocks.remove).toHaveBeenCalledWith('/tmp/office-test', { recursive: true, force: true });
  });
  it('cancels and escalates termination before resolving and cleaning files', async () => {
    vi.useFakeTimers(); vi.stubEnv('OMNIFLOW_LIBREOFFICE_PATH', '/test/soffice');
    const child = new EventEmitter(); mocks.spawn.mockReturnValue(child);
    mocks.terminate.mockImplementation((_child, options) => { if (options.force) child.emit('close', null); });
    const controller = new AbortController();
    const pending = convertPresentationToPdf(new Uint8Array(), controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(mocks.terminate).toHaveBeenCalledWith(child, expect.objectContaining({ force: false }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    await rejection;
    expect(mocks.terminate).toHaveBeenCalledWith(child, expect.objectContaining({ force: true }));
    expect(mocks.remove).toHaveBeenCalled();
  });
  it('times out stuck conversions and reaps the process', async () => {
    vi.useFakeTimers(); vi.stubEnv('OMNIFLOW_LIBREOFFICE_PATH', '/test/soffice');
    const child = new EventEmitter(); mocks.spawn.mockReturnValue(child);
    mocks.terminate.mockImplementation(() => child.emit('close', null));
    const pending = convertPresentationToPdf(new Uint8Array(), new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(45000); await rejection;
    expect(mocks.remove).toHaveBeenCalled();
  });
});
