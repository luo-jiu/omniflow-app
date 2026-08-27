import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentShellExecutableContentIdentity,
  AgentShellProviderProbeExecutionRequest,
  AgentShellProviderProbeExecutionResult,
} from '../../../platform/shell/shell-provider.types';
import { createAgentShellProviderRegistry } from './agent-shell-provider-registry';

const EXECUTABLE_IDENTITY: AgentShellExecutableContentIdentity = Object.freeze({
  sha256: 'c'.repeat(64),
  sizeBytes: 2_048,
});

function injectedProbe(
  output: (request: AgentShellProviderProbeExecutionRequest) => string,
) {
  return {
    accessExecutable: vi.fn(async () => undefined),
    readExecutableIdentity: vi.fn(async () => EXECUTABLE_IDENTITY),
    resolveExecutable: vi.fn(async executable => executable),
    runProbe: vi.fn(async (request: AgentShellProviderProbeExecutionRequest) => ({
      exitCode: 0,
      stderr: '',
      stdout: output(request),
    })),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Agent Shell Provider registry', () => {
  it.each([
    {
      candidate: '/bin/zsh',
      dialect: 'zsh',
      output: 'zsh 5.9',
      platform: 'darwin' as const,
      providerId: 'system-zsh',
    },
    {
      candidate: '/bin/bash',
      dialect: 'bash',
      output: 'GNU bash, version 5.2.15(1)-release',
      platform: 'linux' as const,
      providerId: 'system-bash',
    },
  ])('selects the default $dialect Provider for $platform', async ({
    candidate,
    dialect,
    output,
    platform,
    providerId,
  }) => {
    const registry = createAgentShellProviderRegistry({
      candidates: { [platform]: [candidate] },
      platform,
      probeDependencies: injectedProbe(() => output),
    });

    const snapshot = await registry.refresh();
    expect(snapshot.platform).toBe(platform);
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]).toMatchObject({ dialect, platform, providerId });
    expect(snapshot.defaultProviderId).toBe(providerId);
    expect(snapshot.defaultProviderRegistrationIdentity)
      .toBe(snapshot.providers[0]?.registrationIdentity);
    expect(snapshot.getProvider(snapshot.defaultProviderRegistrationIdentity || '')
      ?.publicIdentity).toBe(snapshot.providers[0]);
    expect(snapshot.getProviderById(providerId)?.publicIdentity).toBe(snapshot.providers[0]);
    expect(snapshot.failures).toEqual([]);
    expect(snapshot.snapshotIdentity).toMatch(/^v1:[a-f0-9]{64}$/u);
  });

  it('discovers pwsh and Windows PowerShell as separate registrations', async () => {
    const coreExecutable = String.raw`C:\Program Files\PowerShell\7\pwsh.exe`;
    const legacyExecutable = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
    const registry = createAgentShellProviderRegistry({
      candidates: {
        powerShellCore: [coreExecutable],
        windowsPowerShell: [legacyExecutable],
      },
      platform: 'win32',
      probeDependencies: injectedProbe(request => (
        request.executable.endsWith('pwsh.exe') ? '7.4.6' : '5.1.22621.2506'
      )),
    });

    const snapshot = await registry.refresh();
    expect(snapshot.defaultProviderId).toBe('pwsh');
    expect(snapshot.providers.map(provider => provider.providerId)).toEqual([
      'pwsh',
      'windows-powershell',
    ]);
    expect(snapshot.providers[0]?.implementationId)
      .not.toBe(snapshot.providers[1]?.implementationId);
    expect(snapshot.providers[0]?.registrationIdentity)
      .not.toBe(snapshot.providers[1]?.registrationIdentity);
    expect(snapshot.getProviderById('pwsh')?.getMainBinding().resolvedExecutable)
      .toBe(coreExecutable);
    expect(snapshot.getProviderById('windows-powershell')?.getMainBinding().resolvedExecutable)
      .toBe(legacyExecutable);
  });

  it('uses process.env for default Windows candidates when no environment override is supplied', async () => {
    vi.stubEnv('ProgramFiles', String.raw`C:\Program Files`);
    vi.stubEnv('SystemRoot', String.raw`C:\Windows`);
    const probe = injectedProbe(request => (
      request.executable.endsWith('pwsh.exe') ? '7.4.6' : '5.1.22621.2506'
    ));
    const registry = createAgentShellProviderRegistry({
      platform: 'win32',
      probeDependencies: probe,
    });

    const snapshot = await registry.refresh();
    expect(snapshot.providers.map(provider => provider.providerId)).toEqual([
      'pwsh',
      'windows-powershell',
    ]);
    expect(probe.accessExecutable).toHaveBeenCalledWith(
      String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
      'win32',
    );
    expect(probe.accessExecutable).toHaveBeenCalledWith(
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      'win32',
    );
  });

  it('keeps safe public projection path-free and paths in the main-only binding', async () => {
    const executable = '/private/provider/zsh';
    const registry = createAgentShellProviderRegistry({
      candidates: { darwin: [executable] },
      platform: 'darwin',
      probeDependencies: injectedProbe(() => 'zsh 5.9'),
    });

    const snapshot = await registry.refresh();
    expect(JSON.stringify(snapshot)).not.toContain(executable);
    expect(snapshot.getProviderById('system-zsh')?.getMainBinding()).toEqual({
      executable,
      executableContentIdentity: EXECUTABLE_IDENTITY,
      resolvedExecutable: executable,
    });
  });

  it('separates stable registration identity from each probe and opaque registration', async () => {
    const registry = createAgentShellProviderRegistry({
      candidates: { darwin: ['/bin/zsh'] },
      platform: 'darwin',
      probeDependencies: injectedProbe(() => 'zsh 5.9'),
    });

    const first = await registry.refresh();
    const firstProvider = first.getProviderById('system-zsh');
    const second = await registry.refresh();
    const secondProvider = second.getProviderById('system-zsh');

    expect(first.providers[0]?.registrationIdentity)
      .toBe(second.providers[0]?.registrationIdentity);
    expect(first.providers[0]?.probeIdentity).not.toBe(second.providers[0]?.probeIdentity);
    expect(first.snapshotIdentity).not.toBe(second.snapshotIdentity);
    expect(firstProvider?.registrationHandle).not.toBe(secondProvider?.registrationHandle);
    expect(first.getProvider(second.providers[0]?.registrationIdentity || '')).toBe(firstProvider);
    expect(registry.getSnapshot()).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.providers)).toBe(true);
  });

  it('freezes version drift into a different registration identity', async () => {
    const versions = ['zsh 5.9', 'zsh 5.10'];
    const registry = createAgentShellProviderRegistry({
      candidates: { darwin: ['/bin/zsh'] },
      platform: 'darwin',
      probeDependencies: injectedProbe(() => versions.shift() || 'zsh 5.10'),
    });

    const first = await registry.refresh();
    const second = await registry.refresh();
    expect(first.providers[0]?.version).toBe('5.9');
    expect(second.providers[0]?.version).toBe('5.10');
    expect(first.providers[0]?.registrationIdentity)
      .not.toBe(second.providers[0]?.registrationIdentity);
  });

  it('binds executable content identity into registration and main binding', async () => {
    const firstIdentity = { sha256: 'd'.repeat(64), sizeBytes: 4_096 };
    const secondIdentity = { sha256: 'e'.repeat(64), sizeBytes: 4_096 };
    const identities = [
      firstIdentity,
      firstIdentity,
      secondIdentity,
      secondIdentity,
    ];
    const probe = injectedProbe(() => 'zsh 5.9');
    vi.mocked(probe.readExecutableIdentity).mockImplementation(async () => (
      identities.shift() || secondIdentity
    ));
    const registry = createAgentShellProviderRegistry({
      candidates: { darwin: ['/bin/zsh'] },
      platform: 'darwin',
      probeDependencies: probe,
    });

    const first = await registry.refresh();
    const second = await registry.refresh();

    expect(first.providers[0]?.registrationIdentity)
      .not.toBe(second.providers[0]?.registrationIdentity);
    expect(first.getProviderById('system-zsh')?.getMainBinding().executableContentIdentity)
      .toEqual(firstIdentity);
    expect(second.getProviderById('system-zsh')?.getMainBinding().executableContentIdentity)
      .toEqual(secondIdentity);
    expect(Object.isFrozen(
      second.getProviderById('system-zsh')?.getMainBinding().executableContentIdentity,
    )).toBe(true);
  });

  it('does not let a slower older refresh replace the current snapshot', async () => {
    let releaseFirst: ((result: AgentShellProviderProbeExecutionResult) => void) | undefined;
    const firstProbe = new Promise<AgentShellProviderProbeExecutionResult>((resolve) => {
      releaseFirst = resolve;
    });
    const runProbe = vi.fn((request: AgentShellProviderProbeExecutionRequest) => {
      void request;
      if (runProbe.mock.calls.length === 1) return firstProbe;
      return Promise.resolve({ exitCode: 0, stderr: '', stdout: 'zsh 5.10' });
    });
    const registry = createAgentShellProviderRegistry({
      candidates: { darwin: ['/bin/zsh'] },
      platform: 'darwin',
      probeDependencies: {
        accessExecutable: vi.fn(async () => undefined),
        readExecutableIdentity: vi.fn(async () => EXECUTABLE_IDENTITY),
        resolveExecutable: vi.fn(async executable => executable),
        runProbe,
      },
    });

    const olderRefresh = registry.refresh();
    const newerSnapshot = await registry.refresh();
    releaseFirst?.({ exitCode: 0, stderr: '', stdout: 'zsh 5.9' });
    const olderSnapshot = await olderRefresh;

    expect(olderSnapshot).toBe(newerSnapshot);
    expect(newerSnapshot.probeGeneration).toBe(2);
    expect(registry.getSnapshot()).toBe(newerSnapshot);
  });

  it('copies injected candidates before refresh', async () => {
    const candidates = ['/bin/zsh'];
    const probe = injectedProbe(() => 'zsh 5.9');
    const registry = createAgentShellProviderRegistry({
      candidates: { darwin: candidates },
      platform: 'darwin',
      probeDependencies: probe,
    });
    candidates[0] = '/tmp/replaced-zsh';

    const snapshot = await registry.refresh();
    expect(snapshot.getProviderById('system-zsh')?.getMainBinding().executable)
      .toBe('/bin/zsh');
    expect(probe.accessExecutable).toHaveBeenCalledWith('/bin/zsh', 'darwin');
  });

  it('projects probe failures without executable paths or raw errors', async () => {
    const executable = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
    const registry = createAgentShellProviderRegistry({
      candidates: { powerShellCore: [], windowsPowerShell: [executable] },
      platform: 'win32',
      probeDependencies: {
        accessExecutable: vi.fn(async () => undefined),
        readExecutableIdentity: vi.fn(async () => EXECUTABLE_IDENTITY),
        resolveExecutable: vi.fn(async candidate => candidate),
        runProbe: vi.fn(async () => {
          throw new Error(`credential=secret path=${executable}`);
        }),
      },
    });

    const snapshot = await registry.refresh();
    expect(snapshot.defaultProviderRegistrationIdentity).toBeNull();
    expect(snapshot.failures.map(failure => failure.reasonCode)).toEqual([
      'executable-not-found',
      'probe-failed',
    ]);
    expect(snapshot.providers).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain(executable);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });

  it('fails closed on an unsupported platform', async () => {
    const registry = createAgentShellProviderRegistry({ platform: 'aix' });

    const snapshot = await registry.refresh();
    expect(snapshot.failures).toEqual([{
      available: false,
      platform: 'aix',
      probeGeneration: 1,
      reasonCode: 'unsupported-platform',
    }]);
    expect(snapshot.providers).toEqual([]);
  });
});
