import { describe, expect, it } from 'vitest';

import type { AgentShellDialect } from '../../../../src/shared/agent/shell/agent-shell.types';
import {
  AGENT_SHELL_COMMAND_ANALYZER_REVISION,
  createAgentShellCommandAnalyzer,
} from './agent-shell-command-analyzer';

const analyzer = createAgentShellCommandAnalyzer();

function analyze(
  command: string,
  dialect: AgentShellDialect = 'zsh',
  overrides: Partial<{
    hasEnvironmentOverrides: boolean;
    logicalCwd: string;
    persistentRuleEligible: boolean;
  }> = {},
) {
  return analyzer.analyze({
    command,
    dialect,
    hasEnvironmentOverrides: overrides.hasEnvironmentOverrides ?? false,
    logicalCwd: overrides.logicalCwd || 'work',
    persistentRuleEligible: overrides.persistentRuleEligible ?? false,
    providerAnalyzerRevision: `${dialect}-analysis-contract-v1`,
  });
}

describe('Agent Shell command analyzer', () => {
  it('produces a complete, frozen assessment for a static pathless command', async () => {
    const result = await analyze('printf "hello\\n"');

    expect(result).toEqual({
      analysisIdentity: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
      analyzerRevision: AGENT_SHELL_COMMAND_ANALYZER_REVISION,
      assessment: {
        facets: ['process_launch'],
        operations: [{
          argvPrefix: ['hello\\n'],
          effects: ['process_launch'],
          executable: 'printf',
        }],
        persistentRuleEligible: false,
        risk: 'read',
        unresolved: [],
      },
      workspaceBoundaryVerified: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.assessment.operations[0]?.argvPrefix)).toBe(true);
  });

  it('analyzes a static pipeline and output redirection inside the workspace', async () => {
    const result = await analyze(
      'cat ../input/fixture.txt | wc -c > ../output/count.txt',
    );

    expect(result.assessment).toMatchObject({
      facets: [
        'filesystem.read',
        'filesystem.write',
        'process_launch',
        'redirection',
      ],
      risk: 'write',
      unresolved: [],
    });
    expect(result.assessment.operations).toEqual([
      {
        argvPrefix: ['../input/fixture.txt'],
        effects: ['filesystem.read', 'process_launch'],
        executable: 'cat',
      },
      {
        argvPrefix: ['-c'],
        effects: ['filesystem.read', 'process_launch'],
        executable: 'wc',
      },
    ]);
    expect(result.workspaceBoundaryVerified).toBe(true);
  });

  it.each(['zsh', 'bash'] as const)(
    'keeps Unicode and quoted workspace paths static in %s',
    async (dialect) => {
      const result = await analyze(
        'cat "../input/中文 文件.txt" > "../output/结果 文件.txt"',
        dialect,
      );

      expect(result.assessment).toMatchObject({
        facets: [
          'filesystem.read',
          'filesystem.write',
          'process_launch',
          'redirection',
        ],
        risk: 'write',
        unresolved: [],
      });
      expect(result.workspaceBoundaryVerified).toBe(true);
    },
  );

  it('preserves operation effects for repeated commands in one static list', async () => {
    const result = await analyze('cat ../input/a.txt; cat ../input/b.txt');
    expect(result.assessment.operations).toHaveLength(2);
    expect(result.assessment.operations[0]?.effects).toEqual([
      'filesystem.read',
      'process_launch',
    ]);
    expect(result.assessment.operations[1]?.effects).toEqual([
      'filesystem.read',
      'process_launch',
    ]);
  });

  it.each([
    {
      command: 'cp ../input/source.txt ../output/result.txt',
      facets: ['filesystem.read', 'filesystem.write', 'process_launch'],
      risk: 'write',
    },
    {
      command: 'rm -rf ../output/result.txt',
      facets: ['filesystem.delete', 'process_launch'],
      risk: 'destructive',
    },
    {
      command: 'ffmpeg -hide_banner -nostdin -i ../input/video.mp4 -vn -c:a copy ../output/audio.m4a',
      facets: ['filesystem.read', 'filesystem.write', 'process_launch'],
      risk: 'write',
    },
    {
      command: 'ffprobe -v error -show_streams -of json ../input/video.mp4',
      facets: ['filesystem.read', 'process_launch'],
      risk: 'read',
    },
  ])('fully analyzes workspace command: $command', async ({ command, facets, risk }) => {
    const result = await analyze(command);
    expect(result.assessment).toMatchObject({ facets, risk, unresolved: [] });
    expect(result.workspaceBoundaryVerified).toBe(true);
    expect(result.analysisIdentity).toMatch(/^v1:[a-f0-9]{64}$/u);
  });

  it('blocks automatic treatment of mutations under the read-only input root', async () => {
    const result = await analyze('rm -rf ../input/source.txt');
    expect(result.assessment.unresolved).toContain('read-only-input-mutation');
    expect(result.assessment.facets).toContain('unknown_syntax');
    expect(result.workspaceBoundaryVerified).toBe(false);
    expect(result.analysisIdentity).toBeNull();
  });

  it('marks a static host path as external without pretending parsing failed', async () => {
    const result = await analyze('cat /etc/passwd');
    expect(result.assessment).toMatchObject({
      facets: ['external_path', 'filesystem.read', 'process_launch'],
      risk: 'external',
      unresolved: [],
    });
    expect(result.workspaceBoundaryVerified).toBe(false);
    expect(result.analysisIdentity).toMatch(/^v1:[a-f0-9]{64}$/u);
  });

  it('does not miss an external destination carried by an option value', async () => {
    const inline = await analyze('cp --target-directory=/etc ../input/source.txt');
    const separate = await analyze('cp -t /etc ../input/source.txt');

    expect(inline.assessment.facets).toContain('external_path');
    expect(inline.workspaceBoundaryVerified).toBe(false);
    expect(separate.assessment.facets).toContain('external_path');
    expect(separate.workspaceBoundaryVerified).toBe(false);
  });

  it.each([
    'cp -t ../input ../work/source.txt',
    'mv --target-directory=../input ../work/source.txt',
  ])('does not lose the read-only destination carried by an option: %s', async (command) => {
    const result = await analyze(command);
    expect(result.assessment.unresolved).toContain('read-only-input-mutation');
    expect(result.workspaceBoundaryVerified).toBe(false);
  });

  it('does not lose a PowerShell destination when named parameters are reordered', async () => {
    const result = await analyze(
      'Copy-Item -Destination ..\\input\\a.txt -Path ..\\work\\a.txt -Force',
      'powershell',
    );
    expect(result.assessment.unresolved).toContain('read-only-input-mutation');
    expect(result.workspaceBoundaryVerified).toBe(false);
  });

  it.each([
    'cp -l ../input/source.txt ../output/result.txt',
    'cp -s ../input/source.txt ../output/result.txt',
    'cp --symbolic-link ../input/source.txt ../output/result.txt',
  ])('fails closed for link-producing copy option: %s', async (command) => {
    const result = await analyze(command);
    expect(result.assessment.unresolved).toContain('link-creation');
    expect(result.analysisIdentity).toBeNull();
  });

  it.each([
    'cp -i ../input/source.txt ../output/result.txt',
    'mv --interactive ../work/source.txt ../output/result.txt',
    'rm -I ../output/result.txt',
  ])('marks prompt-producing file option as interactive: %s', async (command) => {
    const result = await analyze(command);
    expect(result.assessment.facets).toContain('interactive');
  });

  it.each([
    { command: 'cat ~other/private.txt', dialect: 'bash' as const },
    { command: 'cat =ls', dialect: 'zsh' as const },
  ])('does not treat shell-expanded host path as workspace-local: $command', async ({
    command,
    dialect,
  }) => {
    const result = await analyze(command, dialect);
    expect(result.assessment.facets).toContain('external_path');
    expect(result.workspaceBoundaryVerified).toBe(false);
  });

  it('fails closed for pathless-looking commands with platform-dependent file options', async () => {
    const result = await analyze('date --file=/etc/passwd', 'bash');
    expect(result.assessment.unresolved).toContain('unsupported-command');
    expect(result.analysisIdentity).toBeNull();
  });

  it.each([
    {
      command: 'echo $(whoami)',
      facets: ['command_substitution', 'process_launch', 'unknown_syntax'],
      reason: 'dynamic-command_substitution',
    },
    {
      command: 'if test -f ../input/a; then cat ../input/a; fi',
      facets: expect.arrayContaining(['unknown_syntax']),
      reason: 'unsupported-if_statement',
    },
    {
      command: 'opaque-command value',
      facets: ['process_launch', 'unknown_syntax'],
      reason: 'unsupported-command',
    },
    {
      command: 'bash -c "cat ../input/a"',
      facets: ['nested_shell', 'process_launch', 'unknown_syntax'],
      reason: 'nested-command-language',
    },
  ])('fails closed for incomplete syntax: $command', async ({ command, facets, reason }) => {
    const result = await analyze(command);
    expect(result.assessment.facets).toEqual(facets);
    expect(result.assessment.unresolved).toContain(reason);
    expect(result.workspaceBoundaryVerified).toBe(false);
    expect(result.analysisIdentity).toBeNull();
  });

  it.each([
    { command: 'sleep 1 &', facet: 'detached' },
    { command: 'sudo cat ../input/a', facet: 'privilege_escalation' },
    { command: 'vim ../work/a', facet: 'interactive' },
  ])('identifies immutable deny facet $facet', async ({ command, facet }) => {
    const result = await analyze(command);
    expect(result.assessment.facets).toContain(facet);
    expect(result.assessment.unresolved).toEqual([]);
  });

  it.each([
    { command: '/usr/bin/sudo cat ../input/a', facet: 'privilege_escalation' },
    { command: '/usr/bin/vim ../work/a', facet: 'interactive' },
  ])('keeps immutable deny visible through an absolute command head: $command', async ({
    command,
    facet,
  }) => {
    const result = await analyze(command);
    expect(result.assessment.facets).toContain(facet);
    expect(result.assessment.unresolved).toContain('dynamic-command-head');
  });

  it('keeps explicit environment overrides visible to deterministic policy', async () => {
    const result = await analyze('pwd', 'bash', { hasEnvironmentOverrides: true });
    expect(result.assessment).toMatchObject({
      facets: ['environment_change', 'process_launch'],
      risk: 'write',
      unresolved: [],
    });
    expect(result.workspaceBoundaryVerified).toBe(true);
  });

  it('classifies network and package commands without auto-approved workspace claims', async () => {
    const network = await analyze('curl https://example.com');
    const install = await analyze('npm install fixture');

    expect(network.assessment.facets).toEqual(['external_path', 'network', 'process_launch']);
    expect(network.assessment.unresolved).toEqual([]);
    expect(network.workspaceBoundaryVerified).toBe(false);
    expect(install.assessment.facets).toEqual([
      'external_path',
      'package_install',
      'process_launch',
    ]);
    expect(install.assessment.unresolved).toEqual([]);
    expect(install.workspaceBoundaryVerified).toBe(false);
  });

  it.each([
    {
      command: 'Get-ChildItem -Path ..\\input -Recurse',
      facets: ['filesystem.read', 'process_launch'],
      operation: 'get-childitem',
      risk: 'read',
    },
    {
      command: 'Copy-Item -Path ..\\input\\a.txt -Destination ..\\output\\a.txt -Force',
      facets: ['filesystem.read', 'filesystem.write', 'process_launch'],
      operation: 'copy-item',
      risk: 'write',
    },
    {
      command: 'Remove-Item -Path ..\\output\\a.txt -Recurse',
      facets: ['filesystem.delete', 'process_launch'],
      operation: 'remove-item',
      risk: 'destructive',
    },
  ])('analyzes static PowerShell command: $command', async ({ command, facets, operation, risk }) => {
    const result = await analyze(command, 'powershell');
    expect(result.assessment).toMatchObject({ facets, risk, unresolved: [] });
    expect(result.assessment.operations[0]?.executable).toBe(operation);
    expect(result.workspaceBoundaryVerified).toBe(true);
  });

  it('treats non-filesystem PowerShell provider paths as external', async () => {
    const registry = await analyze('Get-Item Registry::HKEY_CURRENT_USER\\Software', 'powershell');
    const environment = await analyze('Get-Item Env:PATH', 'powershell');

    expect(registry.assessment.facets).toContain('external_path');
    expect(registry.workspaceBoundaryVerified).toBe(false);
    expect(environment.assessment.facets).toContain('external_path');
    expect(environment.workspaceBoundaryVerified).toBe(false);
  });

  it('keeps quoted Unicode PowerShell paths static across a pipeline', async () => {
    const result = await analyze(
      'Get-Content "..\\input\\中文 文件.txt" | Set-Content "..\\output\\结果 文件.txt"',
      'powershell',
    );

    expect(result.assessment).toMatchObject({
      facets: ['filesystem.read', 'filesystem.write', 'process_launch'],
      risk: 'write',
      unresolved: [],
    });
    expect(result.assessment.operations).toHaveLength(2);
    expect(result.workspaceBoundaryVerified).toBe(true);
  });

  it.each([
    { command: 'cat "unterminated', dialect: 'bash' as const },
    { command: 'Get-Content "unterminated', dialect: 'powershell' as const },
  ])('fails closed for malformed $dialect input', async ({ command, dialect }) => {
    const result = await analyze(command, dialect);
    expect(result.assessment.unresolved).toContain('syntax-error');
    expect(result.workspaceBoundaryVerified).toBe(false);
    expect(result.analysisIdentity).toBeNull();
  });

  it.each([
    { command: 'Write-Output $value', reason: 'dynamic-variable' },
    { command: 'Write-Output $(Get-Date)', reason: 'dynamic-sub_expression' },
  ])('fails closed for dynamic PowerShell expression: $command', async ({ command, reason }) => {
    const result = await analyze(command, 'powershell');
    expect(result.assessment.unresolved).toContain(reason);
    expect(result.assessment.facets).toContain('unknown_syntax');
    expect(result.analysisIdentity).toBeNull();
  });

  it('detects PowerShell detached process launch as immutable deny', async () => {
    const result = await analyze('Start-Process ffmpeg', 'powershell');
    expect(result.assessment.facets).toEqual(['detached', 'process_launch']);
    expect(result.assessment.unresolved).toEqual([]);
  });

  it('detects an absolute PowerShell privilege command before unknown-head fallback', async () => {
    const result = await analyze(
      'C:\\Windows\\System32\\runas.exe /user:Administrator cmd.exe',
      'powershell',
    );
    expect(result.assessment.facets).toContain('privilege_escalation');
    expect(result.assessment.unresolved).toContain('dynamic-command-head');
  });

  it('generates deterministic identities that bind command, cwd, and provider dialect', async () => {
    const first = await analyze('pwd');
    const same = await analyze('pwd');
    const changedCommand = await analyze('uname');
    const changedCwd = await analyze('pwd', 'zsh', { logicalCwd: 'output' });
    const changedDialect = await analyze('pwd', 'bash');

    expect(first.analysisIdentity).toBe(same.analysisIdentity);
    expect(changedCommand.analysisIdentity).not.toBe(first.analysisIdentity);
    expect(changedCwd.analysisIdentity).not.toBe(first.analysisIdentity);
    expect(changedDialect.analysisIdentity).not.toBe(first.analysisIdentity);
  });
});
