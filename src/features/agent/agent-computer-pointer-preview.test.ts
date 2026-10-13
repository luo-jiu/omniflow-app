import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentComputerPointerPlan } from './agent-computer-pointer-plan';
import { createAgentComputerPointerPreview } from './agent-computer-pointer-preview';

const source = 'data:image/png;base64,YQ==';
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
const createElement = vi.fn();

beforeEach(() => {
  LoadedImage.instances = [];
  vi.stubGlobal('Image', LoadedImage);
  vi.stubGlobal('document', { createElement });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); vi.useRealTimers(); });

describe('display-only vector pointer preview', () => {
  it.each(['click', 'rightClick', 'doubleClick', 'drag'] as const)('embeds the exact original PNG with a scalable %s arrow and releases the decoder', async operation => {
    const actionPlan = { ...plan, operation, endPoint: operation === 'drag' ? plan.endPoint : undefined };
    const pending = createAgentComputerPointerPreview(source, actionPlan, new AbortController().signal);
    const image = LoadedImage.instances[0];
    expect(image.src).toBe(source);
    image.onload?.();
    const result = await pending;
    expect(result.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(result.slice(result.indexOf(',') + 1));
    expect(svg).toContain('width="673" height="439" viewBox="0 0 673 439"');
    expect(svg).toContain(`<image width="673" height="439" href="${source}"/>`);
    expect(svg).toContain('translate(9 53) scale(0.75 0.75)');
    expect(svg.match(/<path /gu)).toHaveLength(3);
    expect(svg).toContain('<title>AI · ');
    expect(svg).not.toMatch(/<(?:script|foreignObject|text|line|circle|rect)\b/u);
    expect(createElement).not.toHaveBeenCalled();
    expect(image).toMatchObject({ src: '', onload: null, onerror: null });
    expect(plan.attachmentId).toBe('image');
  });
  it.each(['width', 'height'] as const)('refuses decoded %s mismatch before producing a preview', dimension => {
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
  it('cannot inject markup through an invalid accent color', async () => {
    const pending = createAgentComputerPointerPreview(source, plan, new AbortController().signal, '"><script>alert(1)</script>');
    LoadedImage.instances[0].onload?.();
    const result = await pending;
    const svg = decodeURIComponent(result.slice(result.indexOf(',') + 1));
    expect(svg).toContain('stroke="#5a9e7c"');
    expect(svg).not.toContain('<script>');
  });
});
