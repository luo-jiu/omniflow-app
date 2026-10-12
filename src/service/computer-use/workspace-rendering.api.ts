import {
  normalizeWorkspaceRenderingRegistration,
  normalizeWorkspaceRenderingRegistrationToken,
  type WorkspaceRenderingRegistrationInput,
  type WorkspaceRenderingRegistrationToken,
} from '@/shared/computer-use/workspace-rendering-contract';

export interface WorkspaceRenderingBridge {
  register(input: WorkspaceRenderingRegistrationInput): Promise<WorkspaceRenderingRegistrationToken>;
  unregister(token: WorkspaceRenderingRegistrationToken): Promise<boolean>;
}

function bridge(): WorkspaceRenderingBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAgentRendering;
}

/** Rendering registration grants neither observation nor input authority. */
export const workspaceRenderingAPI: WorkspaceRenderingBridge = {
  async register(input) {
    const current = bridge();
    if (!current) throw new Error('Agent 工作区绘制桥不可用');
    return normalizeWorkspaceRenderingRegistrationToken(await current.register(normalizeWorkspaceRenderingRegistration(input)));
  },
  async unregister(token) {
    return await bridge()?.unregister(normalizeWorkspaceRenderingRegistrationToken(token)) ?? false;
  },
};
