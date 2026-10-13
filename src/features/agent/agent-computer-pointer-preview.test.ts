import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerPointerPlan } from './agent-computer-pointer-plan';
import { createAgentComputerPointerPreview } from './agent-computer-pointer-preview';

const source = 'data:image/png;base64,YQ==';
const marked = 'data:image/png;base64,Yg==';
const plan: AgentComputerPointerPlan = { attachmentId: 'image', actionToolRunId: 'action', observationToolRunId: 'observe',
  width: 673, height: 439, operation: 'drag', point: { x: 9, y: 53 }, endPoint: { x: 181, y: 53 } };
class LoadedImage {
  static instances: LoadedImage[] = [];
  naturalWidth = 673;
  naturalHeight = 439;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  constructor() { LoadedImage.instances.push(this); }
}
const drawImage = vi.fn();
const toDataURL = vi.fn();
const createElement = vi.fn();
let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toDataURL: typeof toDataURL };

beforeEach(() => {
  LoadedImage.instances = [];
  canvas = { width: 0, height: 0, getContext: vi.fn(() => new Proxy({ drawImage }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : vi.fn(),
  })), toDataURL };
  createElement.mockReturnValue(canvas); toDataURL.mockReturnValue(marked);
  vi.stubGlobal('Image', LoadedImage); vi.stubGlobal('Path2D', class {});
  vi.stubGlobal('document', { createElement });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); vi.useRealTimers(); });

describe('temporary pointer preview pixels', () => {
  it('composes only the already loaded exact original PNG and clears the temporary surface', async () => {
    const pending = createAgentComputerPointerPreview(source, plan, new AbortController().signal);
    const image = LoadedImage.instances[0];
    expect(image.src).toBe(source);
    image.onload?.();
    await expect(pending).resolves.toBe(marked);
    expect(createElement).toHaveBeenCalledWith('canvas');
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0);
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(canvas).toMatchObject({ width: 0, height: 0 });
    expect(image).toMatchObject({ src: '', onload: null, onerror: null });
    expect(plan.attachmentId).toBe('image');
  });
  it.each(['width', 'height'] as const)('refuses decoded %s mismatch before allocating canvas', dimension => {
    const pending = createAgentComputerPointerPreview(source, plan, new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow('Pointer preview unavailable');
    LoadedImage.instances[0][dimension === 'width' ? 'naturalWidth' : 'naturalHeight'] += 1;
    LoadedImage.instances[0].onload?.();
    expect(createElement).not.toHaveBeenCalled();
    return rejection;
  });
  it('cancels pending decode, drops callbacks and cannot settle late bytes', async () => {
    const controller = new AbortController();
    const pending = createAgentComputerPointerPreview(source, plan, controller.signal);
    const rejection = expect(pending).rejects.toThrow();
    const lateLoad = LoadedImage.instances[0].onload;
    controller.abort(); lateLoad?.();
    await rejection;
    expect(createElement).not.toHaveBeenCalled();
    expect(LoadedImage.instances[0].onload).toBeNull();
  });
  it('bounds image loading to three seconds', async () => {
    vi.useFakeTimers();
    const pending = createAgentComputerPointerPreview(source, plan, new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000);
    await rejection;
    expect(LoadedImage.instances[0].src).toBe('');
    expect(createElement).not.toHaveBeenCalled();
  });
  it.each(['non-png', 'oversized', 'point', 'endpoint', 'pre-aborted'] as const)('refuses unsafe %s before decoding', boundary => {
    const controller = new AbortController();
    const invalid = { ...plan };
    if (boundary === 'oversized') invalid.width = 2049;
    if (boundary === 'point') invalid.point = { x: -1, y: 53 };
    if (boundary === 'endpoint') invalid.endPoint = { x: 181, y: 439 };
    if (boundary === 'pre-aborted') controller.abort();
    expect(LoadedImage.instances).toHaveLength(0);
    return expect(createAgentComputerPointerPreview(boundary === 'non-png' ? 'https://untrusted.test/image.png' : source,
      invalid, controller.signal)).rejects.toThrow();
  });
  it('falls back when the temporary canvas cannot encode a valid bounded PNG', async () => {
    toDataURL.mockReturnValue('data:image/svg+xml,<svg/>');
    const pending = createAgentComputerPointerPreview(source, plan, new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow();
    LoadedImage.instances[0].onload?.();
    await rejection;
    expect(canvas).toMatchObject({ width: 0, height: 0 });
  });
});
