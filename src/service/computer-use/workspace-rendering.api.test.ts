import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRenderingRegistrationToken } from '@/shared/computer-use/workspace-rendering-contract';
import { workspaceRenderingAPI } from './workspace-rendering.api';

const input = { instanceId: randomUUID(), ownerScope: { accountScope: 'user:7', backendScope: 'http://127.0.0.1:8850/api' }, libraryId: 3 };
const token: WorkspaceRenderingRegistrationToken = { registrationId: randomUUID(), documentGeneration: randomUUID() };
afterEach(() => vi.unstubAllGlobals());

describe('workspace rendering renderer service', () => {
  it('validates narrow messages before IPC and rejects forged registration output', async () => {
    const bridge = { register: vi.fn(async () => token), unregister: vi.fn(async () => true) };
    vi.stubGlobal('window', { electronAgentRendering: bridge });
    await expect(workspaceRenderingAPI.register(input)).resolves.toEqual(token);
    await expect(workspaceRenderingAPI.unregister(token)).resolves.toBe(true);
    await expect(workspaceRenderingAPI.register({ ...input, sessionId: randomUUID() } as typeof input)).rejects.toThrow();
    await expect(workspaceRenderingAPI.unregister({ ...token, execute: true } as typeof token)).rejects.toThrow();
    expect(bridge.register).toHaveBeenCalledOnce(); expect(bridge.unregister).toHaveBeenCalledOnce();
    bridge.register.mockResolvedValueOnce({ ...token, registrationId: 'forged' });
    await expect(workspaceRenderingAPI.register(input)).rejects.toThrow();
  });

  it('handles unavailable preload without retaining renderer state', async () => {
    vi.stubGlobal('window', {});
    await expect(workspaceRenderingAPI.register(input)).rejects.toThrow('绘制桥不可用');
    await expect(workspaceRenderingAPI.unregister(token)).resolves.toBe(false);
  });
});
