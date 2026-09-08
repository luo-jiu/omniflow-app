import { describe, expect, it } from 'vitest';
import { resolveAgentRunPermissionDecision } from './agent-permission-gate';
import type { AgentPreparedActionPublic } from '@/shared/agent/agent.types';
import type { AgentToolPermissionDecision } from './agent-tool-registry';

describe('Run permissions for built-in writes', () => {
  const ask: AgentToolPermissionDecision = { behavior: 'ask', risk: 'write', preview: { title: 'write', description: 'write', risk: 'write' } };
  it('auto-authorizes known non-destructive operations only in full-access', () => {
    for (const mode of ['ask', 'auto'] as const) expect(resolveAgentRunPermissionDecision('directory.create', ask, mode)).toBe(ask);
    expect(resolveAgentRunPermissionDecision('directory.create', ask, 'full-access')).toEqual({ behavior: 'allow', risk: 'write' });
    const media = { kind: 'media.extractAudio', conflictPolicy: 'auto_rename' } as AgentPreparedActionPublic;
    expect(resolveAgentRunPermissionDecision('media.extractAudio', ask, 'full-access', media)).toEqual({ behavior: 'allow', risk: 'write' });
    expect(resolveAgentRunPermissionDecision('media.extractAudio', ask, 'full-access', { ...media, conflictPolicy: 'replace' } as AgentPreparedActionPublic)).toBe(ask);
  });
  it('does not override deny, arbitrary tools, missing preparation, memory or destructive decisions', () => {
    const deny: AgentToolPermissionDecision = { behavior: 'deny', risk: 'write', message: 'denied' };
    expect(resolveAgentRunPermissionDecision('directory.create', deny, 'full-access')).toBe(deny);
    for (const name of ['unknown', 'memory.propose', 'shell.run', 'file.upload']) {
      expect(resolveAgentRunPermissionDecision(name, ask, 'full-access')).toBe(ask);
    }
    const destructive = { ...ask, risk: 'destructive' as const };
    expect(resolveAgentRunPermissionDecision('directory.create', destructive, 'full-access')).toBe(destructive);
  });
});
