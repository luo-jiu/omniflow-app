import { describe, expect, it } from 'vitest';

import { equalAgentPreparedActionPublic } from '../agent-prepared-action';
import {
  AGENT_SHELL_DEFAULT_TIMEOUT_MS,
  AGENT_SHELL_MAX_COMMAND_BYTES,
  AGENT_SHELL_MAX_TIMEOUT_MS,
  AGENT_SHELL_PREPARED_ACTION_VERSION,
  AGENT_SHELL_RUN_TOOL_NAME,
  normalizeAgentShellPreparedActionPublicV1,
  normalizeAgentShellHostPath,
  normalizeAgentShellRunInputV1,
} from './agent-shell.types';

function shellAction(overrides: Record<string, unknown> = {}) {
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
    commandHash: `sha256:${'b'.repeat(64)}`,
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
    kind: AGENT_SHELL_RUN_TOOL_NAME,
    provider: { dialect: 'zsh', id: 'system-zsh', version: '5.9' },
    timeoutMs: 60_000,
    version: AGENT_SHELL_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function duplicateStagedInputs() {
  const action = shellAction();
  const [stagedInput] = (action.dataScope as { stagedInputs: Record<string, unknown>[] }).stagedInputs;
  return [stagedInput, { ...stagedInput }];
}

describe('Agent Shell public contract', () => {
  it('preserves exact command bytes while applying defaults and canonical env ordering', () => {
    const command = '  printf "中文\\n"  ';
    expect(normalizeAgentShellRunInputV1({
      command,
      env: { ZETA: '2', ALPHA: '1' },
    })).toEqual({
      command,
      cwd: 'work',
      env: { ALPHA: '1', ZETA: '2' },
      timeoutMs: AGENT_SHELL_DEFAULT_TIMEOUT_MS,
    });
  });

  it('keeps workspace as the default context and accepts an explicit host context', () => {
    expect(normalizeAgentShellRunInputV1({ command: 'pwd' })).not.toHaveProperty(
      'executionContext',
    );
    expect(normalizeAgentShellRunInputV1({
      command: 'pwd',
      executionContext: 'host',
    })).toMatchObject({
      cwd: '.',
      executionContext: 'host',
    });
    expect(normalizeAgentShellRunInputV1({
      command: 'pwd',
      cwd: '/Users/example/Documents',
      executionContext: 'host',
    })).toMatchObject({
      cwd: '/Users/example/Documents',
      executionContext: 'host',
    });
  });

  it.each([
    ['/Users/example/../private', '回退'],
    ['C:relative', 'macOS'],
    ['C:/Windows', 'macOS'],
    ['C:\\Windows', 'macOS'],
    ['relative\\path', 'macOS'],
    ['/Users/example\\Documents', 'macOS'],
    ['~\\Documents', 'macOS'],
    ['\\\\server\\share', 'macOS'],
    ['//server/share', 'macOS'],
    ['~other/Documents', 'named-home'],
    ['~/Documents/../private', '回退'],
    ['/Users/example\u0000/Documents', '无效'],
    ['\t/Users/example/Documents', '无效'],
  ])('rejects unsafe host cwd %s', (cwd, message) => {
    expect(() => normalizeAgentShellRunInputV1({
      command: 'pwd',
      cwd,
      executionContext: 'host',
    })).toThrow(message);
  });

  it('clamps timeout and accepts the maximum command byte boundary', () => {
    expect(normalizeAgentShellRunInputV1({
      command: 'a'.repeat(AGENT_SHELL_MAX_COMMAND_BYTES),
      timeoutMs: AGENT_SHELL_MAX_TIMEOUT_MS + 1,
    }).timeoutMs).toBe(AGENT_SHELL_MAX_TIMEOUT_MS);
    expect(() => normalizeAgentShellRunInputV1({
      command: 'a'.repeat(AGENT_SHELL_MAX_COMMAND_BYTES + 1),
    })).toThrow('command');
  });

  it.each([
    [{ command: '' }, 'command'],
    [{ command: 'echo ok\u0000' }, 'command'],
    [{ command: 'pwd', cwd: '../outside' }, '逻辑路径'],
    [{ command: 'pwd', cwd: 'C:/outside' }, '逻辑路径'],
    [{ command: 'pwd', cwd: 'work\\outside' }, '逻辑路径'],
    [{ command: 'pwd', cwd: 'work/D:relative' }, '逻辑路径'],
    [{ command: 'pwd', cwd: 'work/trailing.' }, '逻辑路径'],
    [{ command: 'pwd', cwd: 'work/trailing ' }, '逻辑路径'],
    [{ command: 'pwd', cwd: 'work/CON.txt' }, '逻辑路径'],
    [{ command: 'pwd', providerId: '/bin/zsh' }, 'Provider'],
    [{ command: 'pwd', env: { PATH: '/tmp' } }, '环境变量'],
    [{ command: 'pwd', env: { LANG: 'zh_CN.UTF-8' } }, '环境变量'],
    [{ command: 'pwd', env: { LC_MESSAGES: 'zh_CN.UTF-8' } }, '环境变量'],
    [{ command: 'pwd', env: { PATHEXT: '.EXE' } }, '环境变量'],
    [{ command: 'pwd', extra: true }, '未知字段'],
  ])('rejects malformed input %#', (input, message) => {
    expect(() => normalizeAgentShellRunInputV1(input)).toThrow(message);
  });

  it('rejects case-insensitive duplicate env names and aggregate env overflow', () => {
    const duplicate = Object.create(null) as Record<string, string>;
    duplicate.Mode = 'one';
    duplicate.MODE = 'two';
    expect(() => normalizeAgentShellRunInputV1({ command: 'pwd', env: duplicate }))
      .toThrow('重复');

    expect(() => normalizeAgentShellRunInputV1({
      command: 'pwd',
      env: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
        `VALUE_${index}`,
        'x'.repeat(2_048),
      ])),
    })).toThrow('总大小');
  });

  it('normalizes and deeply freezes a shell.run v1 prepared action', () => {
    const normalized = normalizeAgentShellPreparedActionPublicV1(shellAction({
      environment: [
        { name: 'ZETA', value: '2' },
        { name: 'ALPHA', value: '1' },
      ],
    }));
    expect(normalized.environment.map(item => item.name)).toEqual(['ALPHA', 'ZETA']);
    expect(normalized.dataScope.stagedInputs[0]?.logicalPath).toBe('input/fixture.txt');
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.assessment.operations)).toBe(true);
    expect(Object.isFrozen(normalized.dataScope.stagedInputs[0])).toBe(true);
  });

  it('normalizes a host prepared cwd without treating it as workspace logical path', () => {
    const absolute = normalizeAgentShellPreparedActionPublicV1(shellAction({
      cwd: { kind: 'host', path: '/Users/example/Documents' },
    }));
    const relative = normalizeAgentShellPreparedActionPublicV1(shellAction({
      cwd: { kind: 'host', path: 'Documents/fixtures' },
    }));
    expect(absolute.cwd).toEqual({ kind: 'host', path: '/Users/example/Documents' });
    expect(relative.cwd).toEqual({ kind: 'host', path: 'Documents/fixtures' });
  });

  it('accepts macOS absolute, home shorthand, and safe relative host paths', () => {
    expect(normalizeAgentShellHostPath('/Users/example/Documents')).toBe(
      '/Users/example/Documents',
    );
    expect(normalizeAgentShellHostPath('~')).toBe('~');
    expect(normalizeAgentShellHostPath('~/Documents')).toBe('~/Documents');
    expect(normalizeAgentShellHostPath('.')).toBe('.');
    expect(normalizeAgentShellHostPath('Documents/fixtures')).toBe('Documents/fixtures');
  });

  it.each([
    ['unknown root field', shellAction({ extra: true })],
    ['wrong version', shellAction({ version: 2 })],
    ['blank command', shellAction({ command: ' \n\t ' })],
    ['unknown facet', shellAction({
      assessment: { ...shellAction().assessment as object, facets: ['magic'] },
    })],
    ['duplicate staged path', shellAction({
      dataScope: {
        stagedInputs: duplicateStagedInputs(),
        unresolvedWorkspaceRead: false,
      },
    })],
    ['bad command hash', shellAction({ commandHash: 'b'.repeat(64) })],
    ['bad destination identity', shellAction({
      aiDestination: {
        identityHash: 'secret-profile',
        profileLabel: 'profile',
        providerType: 'local',
      },
    })],
    ['Windows drive host cwd', shellAction({ cwd: { kind: 'host', path: 'C:/outside' } })],
    ['Windows UNC host cwd', shellAction({ cwd: { kind: 'host', path: '\\\\server\\share' } })],
    ['named-home host cwd', shellAction({ cwd: { kind: 'host', path: '~other/private' } })],
    ['host cwd traversal', shellAction({ cwd: { kind: 'host', path: '/Users/example/../private' } })],
    ['unknown cwd field', shellAction({ cwd: { kind: 'host', path: '/tmp', extra: true } })],
  ])('rejects malformed prepared action: %s', (_label, input) => {
    expect(() => normalizeAgentShellPreparedActionPublicV1(input)).toThrow();
  });

  it('compares canonical Shell actions without depending on object key order', () => {
    const action = shellAction();
    expect(equalAgentPreparedActionPublic(action, {
      ...action,
      environment: [{ value: 'test', name: 'MODE' }],
    })).toBe(true);
    expect(equalAgentPreparedActionPublic(action, shellAction({ command: 'git status' })))
      .toBe(false);
  });
});
