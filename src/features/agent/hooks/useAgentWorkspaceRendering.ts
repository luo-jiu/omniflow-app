import React from 'react';
import type { AgentOwnerScope } from '@/shared/agent/agent.types';
import { normalizeWorkspaceRenderingRegistrationToken, type WorkspaceRenderingRegistrationToken } from '@/shared/computer-use/workspace-rendering-contract';
import { workspaceRenderingAPI, type WorkspaceRenderingBridge } from '@/service/computer-use/workspace-rendering.api';

export interface AgentWorkspaceRenderingInput {
  active: boolean;
  libraryId: number;
  ownerScope: AgentOwnerScope | null;
  bridge?: WorkspaceRenderingBridge;
}

/** Retain drawing for a visible workspace, independently of its conversation and Run. */
export function useAgentWorkspaceRendering(input: AgentWorkspaceRenderingInput) {
  const accountScope = input.ownerScope?.accountScope;
  const backendScope = input.ownerScope?.backendScope;
  const { active, libraryId, bridge = workspaceRenderingAPI } = input;
  React.useLayoutEffect(() => {
    if (!active || !accountScope || !backendScope) return;
    let released = false;
    let token: WorkspaceRenderingRegistrationToken | undefined;
    const unregister = (registered: WorkspaceRenderingRegistrationToken) => {
      try { void bridge.unregister(registered).catch(() => undefined); } catch { /* Best-effort cleanup; main also owns navigation/owner teardown. */ }
    };
    const release = () => {
      if (released) return;
      released = true;
      if (token) unregister(token);
    };
    try {
      void bridge.register({ instanceId: crypto.randomUUID(), ownerScope: { accountScope, backendScope }, libraryId })
        .then(registered => {
          token = normalizeWorkspaceRenderingRegistrationToken(registered);
          if (released) unregister(token);
        }).catch(release);
    } catch { release(); }
    return release;
  }, [active, accountScope, backendScope, libraryId, bridge]);
}
