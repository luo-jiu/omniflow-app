import { describe, expect, it, vi } from 'vitest';
import { createReasoningStarfieldRenderer } from './reasoning-starfield-renderer';

function context() {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8,
    createProgram: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})), createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(), compileShader: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(),
    getShaderParameter: vi.fn(() => true), getProgramParameter: vi.fn(() => true),
    deleteShader: vi.fn(), deleteBuffer: vi.fn(), deleteProgram: vi.fn(),
    useProgram: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(), getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), getUniformLocation: vi.fn((_program, name: string) => name),
    uniform3fv: vi.fn(), uniform4fv: vi.fn(), uniform2f: vi.fn(), uniform1f: vi.fn(), viewport: vi.fn(), drawArrays: vi.fn(),
  };
}

describe('reasoning starfield GPU ownership', () => {
  it('leaves the CSS fallback available without WebGL', () => {
    expect(createReasoningStarfieldRenderer({ getContext: () => null } as unknown as HTMLCanvasElement)).toBeUndefined();
  });

  it.each(['compile', 'link'] as const)('releases partial allocations on a %s failure', failure => {
    const gl = context();
    if (failure === 'compile') gl.getShaderParameter.mockReturnValue(false);
    else gl.getProgramParameter.mockReturnValue(false);
    const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
    expect(createReasoningStarfieldRenderer(canvas)).toBeUndefined();
    expect(gl.deleteShader).toHaveBeenCalledTimes(failure === 'compile' ? 1 : 2);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.drawArrays).not.toHaveBeenCalled();
  });

  it('draws with the actual backing dimensions and frees its owned GPU resources', () => {
    const gl = context();
    const canvas = { getContext: () => gl, width: 460, height: 48 } as unknown as HTMLCanvasElement;
    const renderer = createReasoningStarfieldRenderer(canvas)!;
    renderer.draw(0, 230, 24, { maximum: true, fastMode: false, reducedMotion: true });
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 460, 48);
    expect(gl.uniform1f).toHaveBeenCalledWith('showField', 1);
    expect(gl.uniform3fv).toHaveBeenCalledWith('particleLayers', new Float32Array([0, 0, 0]));
    renderer.draw(1, 230, 24, { maximum: true, fastMode: false, reducedMotion: false });
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
    renderer.dispose();
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it('keeps a lower effort transparent, animates Fast dots only and goes idle after Fast exits', () => {
    const gl = context();
    const canvas = { getContext: () => gl, width: 230, height: 24 } as unknown as HTMLCanvasElement;
    const renderer = createReasoningStarfieldRenderer(canvas)!;
    const mode = { maximum: false, fastMode: false, reducedMotion: false };
    expect(renderer.draw(0, 230, 24, mode)).toBe(false);
    expect(gl.uniform1f).toHaveBeenCalledWith('showField', 0);
    expect(renderer.draw(1, 230, 24, { ...mode, fastMode: true })).toBe(true);
    expect(renderer.draw(2, 230, 24, mode)).toBe(true);
    expect(renderer.draw(2.3, 230, 24, mode)).toBe(false);
    expect(gl.uniform1f.mock.calls.filter(([uniform]) => uniform === 'showField').every(([, value]) => value === 0)).toBe(true);
    renderer.dispose();
  });
});
