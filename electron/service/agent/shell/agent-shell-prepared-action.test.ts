import { describe, expect, it } from 'vitest';

import type { AgentShellPreparedActionPublicV1 } from '../../../../src/shared/agent/shell/agent-shell.types';
import {
  createAgentShellCommandHash,
  sealAgentShellPreparedActionPublicV1,
  type AgentShellPreparedActionSealInputV1,
  validateAgentShellPreparedActionCommandHashV1,
} from './agent-shell-prepared-action';

function actionInput(
  overrides: Partial<AgentShellPreparedActionSealInputV1> = {},
): AgentShellPreparedActionSealInputV1 {
  return {
    aiDestination: {
      identityHash: `v1:${'a'.repeat(64)}`,
      profileLabel: 'Local DeepSeek',
      providerType: 'openai-compatible',
    },
    assessment: {
      facets: ['filesystem.read'],
      operations: [{
        argvPrefix: ['--version'],
        effects: ['filesystem.read'],
        executable: 'git',
      }],
      persistentRuleEligible: false,
      risk: 'read',
      unresolved: ['workspace-read-set'],
    },
    command: 'git --version',
    cwd: { kind: 'run-workspace', path: 'work' },
    dataScope: {
      stagedInputs: [{
        contentHash: `sha256:${'c'.repeat(64)}`,
        displayName: 'fixture.txt',
        logicalPath: 'input/fixture.txt',
        sourceKind: 'library',
      }],
      unresolvedWorkspaceRead: true,
    },
    environment: [{ name: 'MODE', value: 'test' }],
    kind: 'shell.run',
    provider: { dialect: 'zsh', id: 'system-zsh', version: '5.9' },
    timeoutMs: 60_000,
    version: 1,
    ...overrides,
  };
}

describe('Agent Shell prepared action command identity', () => {
  it('hashes the exact Unicode command UTF-8 bytes without trimming or flattening lines', () => {
    const command = '  printf "你好\n"  ';
    const action = sealAgentShellPreparedActionPublicV1(actionInput({ command }));

    expect(action.command).toBe(command);
    expect(action.commandHash).toBe(
      'sha256:dd5676f4b262ef90d4c5d845e75ad3f7d9ea848ac566ea303c6ce6dfb3165327',
    );
    expect(Object.isFrozen(action)).toBe(true);
    expect(Object.isFrozen(action.assessment.operations[0])).toBe(true);
    expect(Object.isFrozen(action.dataScope.stagedInputs[0])).toBe(true);
  });

  it('keeps multiline commands byte-distinct', () => {
    expect(createAgentShellCommandHash('第一行\n第二行')).toBe(
      'sha256:61f8655a9b219b9ce122c6c7cd59ad09feac38240699cfec8d0c9b1e81a748ab',
    );
    expect(createAgentShellCommandHash('第一行第二行'))
      .not.toBe(createAgentShellCommandHash('第一行\n第二行'));
  });

  it('rejects caller-supplied hashes at the unique seal boundary', () => {
    const input = {
      ...actionInput(),
      commandHash: `sha256:${'0'.repeat(64)}`,
    } as AgentShellPreparedActionSealInputV1;

    expect(() => sealAgentShellPreparedActionPublicV1(input)).toThrow('main 生成');
  });

  it('validates an untampered sealed action', () => {
    const action = sealAgentShellPreparedActionPublicV1(actionInput());

    expect(validateAgentShellPreparedActionCommandHashV1(action)).toEqual(action);
  });

  it('fails closed when the command changes under the sealed hash', () => {
    const action = sealAgentShellPreparedActionPublicV1(actionInput());
    const tampered = { ...action, command: 'git status' };

    expect(() => validateAgentShellPreparedActionCommandHashV1(tampered)).toThrow('hash 不匹配');
  });

  it('fails closed when a well-formed hash is replaced', () => {
    const action = sealAgentShellPreparedActionPublicV1(actionInput());
    const tampered: AgentShellPreparedActionPublicV1 = {
      ...action,
      commandHash: `sha256:${'0'.repeat(64)}`,
    };

    expect(() => validateAgentShellPreparedActionCommandHashV1(tampered)).toThrow('hash 不匹配');
  });
});
