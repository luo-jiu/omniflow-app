import type { WebContents } from 'electron';

import { describe, expect, it } from 'vitest';

import type { AgentChatRequest } from '@/shared/agent/agent.types';
import { createAgentOrchestrator } from './agent-orchestrator';

describe('Agent orchestrator shutdown', () => {
  it('rejects new work after shutdown starts', async () => {
    const orchestrator = createAgentOrchestrator();

    await expect(orchestrator.shutdown(0)).resolves.toBe(true);
    await expect(orchestrator.start(
      {} as WebContents,
      {} as AgentChatRequest,
    )).rejects.toThrow('正在退出');
  });
});
