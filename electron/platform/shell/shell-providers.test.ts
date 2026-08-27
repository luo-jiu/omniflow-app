import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { probeBashShellProvider } from './bash-shell-provider';
import {
  probePowerShellCoreProvider,
  probeWindowsPowerShellProvider,
} from './powershell-provider';
import type {
  AgentShellExecutableContentIdentity,
  AgentShellProviderProbeDependencies,
  AgentShellProviderProbeExecutionResult,
} from './shell-provider.types';
import {
  createAgentShellProbeEnvironment,
  runAgentShellProviderProbe,
  type AgentShellProviderProbeProcessDependencies,
} from './shell-provider-probe';
import { probeZshShellProvider } from './zsh-shell-provider';

const EXECUTABLE_IDENTITY: AgentShellExecutableContentIdentity = Object.freeze({
  sha256: 'a'.repeat(64),
  sizeBytes: 1_024,
});

function dependencies(
  result: AgentShellProviderProbeExecutionResult,
): AgentShellProviderProbeDependencies {
  return {
    accessExecutable: vi.fn(async () => undefined),
    readExecutableIdentity: vi.fn(async () => EXECUTABLE_IDENTITY),
    resolveExecutable: vi.fn(async executable => executable),
    runProbe: vi.fn(async () => result),
  };
}

describe('Agent Shell platform providers', () => {
  it('probes the macOS system zsh without loading profile or rc files', async () => {
    const injected = dependencies({
      exitCode: 0,
      stderr: '',
      stdout: 'zsh 5.9 (x86_64-apple-darwin23.0)',
    });
    const result = await probeZshShellProvider({
      candidates: ['/bin/zsh'],
      dependencies: injected,
      probeGeneration: 3,
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(injected.runProbe).toHaveBeenCalledWith({
      argv: ['-f', '--version'],
      executable: '/bin/zsh',
      platform: 'darwin',
      shell: false,
      timeoutMs: 3_000,
    });
    expect(result.provider.publicIdentity).toMatchObject({
      analyzerRevision: 'zsh-analysis-contract-v1',
      dialect: 'zsh',
      encoding: {
        commandTransport: 'argv-unicode',
        stderrDecoder: 'utf8',
        stdoutDecoder: 'utf8',
      },
      executionReady: false,
      fixedArgs: ['-f', '-c'],
      implementationId: 'omniflow.shell.system-zsh.v1',
      platform: 'darwin',
      probeGeneration: 3,
      probeIdentity: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
      providerId: 'system-zsh',
      registrationIdentity: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
      version: '5.9',
    });
    expect(result.provider.getMainBinding()).toEqual({
      executable: '/bin/zsh',
      executableContentIdentity: EXECUTABLE_IDENTITY,
      resolvedExecutable: '/bin/zsh',
    });
    expect(result.provider.createInvocation('printf hello')).toEqual({
      argv: ['-f', '-c', 'printf hello'],
      executable: '/bin/zsh',
      shell: false,
    });
    expect(Object.isFrozen(result.provider)).toBe(true);
    expect(Object.isFrozen(result.provider.publicIdentity)).toBe(true);
    expect(Object.isFrozen(result.provider.publicIdentity.encoding)).toBe(true);
    expect(Object.isFrozen(result.provider.publicIdentity.fixedArgs)).toBe(true);
    expect(Object.isFrozen(result.provider.getMainBinding())).toBe(true);
    expect(Object.isFrozen(result.provider.registrationHandle)).toBe(true);
  });

  it('probes Linux bash with both profile and rc loading disabled', async () => {
    const injected = dependencies({
      exitCode: 0,
      stderr: '',
      stdout: 'GNU bash, version 5.2.15(1)-release (x86_64-pc-linux-gnu)',
    });
    const result = await probeBashShellProvider({
      candidates: ['/usr/bin/bash'],
      dependencies: injected,
      probeGeneration: 4,
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(injected.runProbe).toHaveBeenCalledWith({
      argv: ['--noprofile', '--norc', '--version'],
      executable: '/usr/bin/bash',
      platform: 'linux',
      shell: false,
      timeoutMs: 3_000,
    });
    expect(result.provider.publicIdentity).toMatchObject({
      dialect: 'bash',
      fixedArgs: ['--noprofile', '--norc', '-c'],
      platform: 'linux',
      providerId: 'system-bash',
      version: '5.2.15',
    });
  });

  it('keeps Windows PowerShell 5.1 distinct and decoder-restricted', async () => {
    const executable = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
    const injected = dependencies({
      exitCode: 0,
      stderr: '',
      stdout: '5.1.22621.2506\r\n',
    });
    const result = await probeWindowsPowerShellProvider({
      candidates: [executable],
      dependencies: injected,
      probeGeneration: 5,
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(injected.runProbe).toHaveBeenCalledWith({
      argv: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$PSVersionTable.PSVersion.ToString()',
      ],
      executable,
      platform: 'win32',
      shell: false,
      timeoutMs: 3_000,
    });
    expect(result.provider.publicIdentity).toMatchObject({
      dialect: 'powershell',
      encoding: {
        commandTransport: 'argv-unicode',
        stderrDecoder: 'windows-console-unimplemented',
        stdoutDecoder: 'windows-console-unimplemented',
      },
      executionReady: false,
      implementationId: 'omniflow.shell.windows-powershell.v1',
      providerId: 'windows-powershell',
      terminationRevision: 'windows-job-object-required-v1',
      version: '5.1.22621.2506',
    });
  });

  it('keeps pwsh 7 under a different provider and implementation identity', async () => {
    const executable = String.raw`C:\Program Files\PowerShell\7\pwsh.exe`;
    const result = await probePowerShellCoreProvider({
      candidates: [executable],
      dependencies: dependencies({ exitCode: 0, stderr: '', stdout: '7.4.6' }),
      probeGeneration: 6,
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.provider.publicIdentity).toMatchObject({
      encoding: {
        commandTransport: 'argv-unicode',
        stderrDecoder: 'utf8',
        stdoutDecoder: 'utf8',
      },
      implementationId: 'omniflow.shell.pwsh.v1',
      providerId: 'pwsh',
      version: '7.4.6',
    });
  });

  it('rejects a PowerShell version from the wrong implementation family', async () => {
    const result = await probeWindowsPowerShellProvider({
      candidates: [String.raw`C:\Windows\powershell.exe`],
      dependencies: dependencies({ exitCode: 0, stderr: '', stdout: '7.4.6' }),
      probeGeneration: 7,
    });

    expect(result).toMatchObject({
      available: false,
      reasonCode: 'version-unrecognized',
    });
  });

  it('returns only a stable reason code when a probe throws sensitive details', async () => {
    const executable = '/bin/zsh';
    const result = await probeZshShellProvider({
      candidates: [executable],
      dependencies: {
        accessExecutable: vi.fn(async () => undefined),
        readExecutableIdentity: vi.fn(async () => EXECUTABLE_IDENTITY),
        resolveExecutable: vi.fn(async candidate => candidate),
        runProbe: vi.fn(async () => {
          throw new Error(`secret-token at ${executable}`);
        }),
      },
      probeGeneration: 8,
    });

    expect(result).toEqual({
      available: false,
      dialect: 'zsh',
      implementationId: 'omniflow.shell.system-zsh.v1',
      platform: 'darwin',
      probeGeneration: 8,
      providerId: 'system-zsh',
      reasonCode: 'probe-failed',
    });
    expect(JSON.stringify(result)).not.toContain(executable);
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('uses the resolved absolute executable for probe and invocation', async () => {
    const injected = dependencies({ exitCode: 0, stderr: '', stdout: 'zsh 5.9' });
    vi.mocked(injected.resolveExecutable).mockResolvedValue('/private/bin/zsh');
    const result = await probeZshShellProvider({
      candidates: ['/bin/zsh'],
      dependencies: injected,
      probeGeneration: 9,
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(injected.runProbe).toHaveBeenCalledWith(expect.objectContaining({
      executable: '/private/bin/zsh',
      shell: false,
    }));
    expect(result.provider.getMainBinding()).toEqual({
      executable: '/bin/zsh',
      executableContentIdentity: EXECUTABLE_IDENTITY,
      resolvedExecutable: '/private/bin/zsh',
    });
    expect(result.provider.createInvocation('true').executable).toBe('/private/bin/zsh');
  });

  it('never probes a relative executable candidate', async () => {
    const injected = dependencies({ exitCode: 0, stderr: '', stdout: 'zsh 5.9' });
    const result = await probeZshShellProvider({
      candidates: ['bin/zsh'],
      dependencies: injected,
      probeGeneration: 10,
    });

    expect(result).toMatchObject({
      available: false,
      reasonCode: 'invalid-executable-candidate',
    });
    expect(injected.accessExecutable).not.toHaveBeenCalled();
    expect(injected.runProbe).not.toHaveBeenCalled();
  });

  it('rejects registration when executable content changes during probe', async () => {
    const injected = dependencies({ exitCode: 0, stderr: '', stdout: 'zsh 5.9' });
    vi.mocked(injected.readExecutableIdentity)
      .mockResolvedValueOnce(EXECUTABLE_IDENTITY)
      .mockResolvedValueOnce({ sha256: 'b'.repeat(64), sizeBytes: 1_024 });

    const result = await probeZshShellProvider({
      candidates: ['/bin/zsh'],
      dependencies: injected,
      probeGeneration: 11,
    });

    expect(result).toMatchObject({
      available: false,
      reasonCode: 'executable-changed',
    });
    expect(injected.readExecutableIdentity).toHaveBeenCalledTimes(2);
  });

  it('minimizes probe environment without carrying host secrets', () => {
    expect(createAgentShellProbeEnvironment('darwin', {
      HOME: '/private/home',
      PATH: '/private/bin',
      SECRET_TOKEN: 'secret',
    })).toEqual({
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin',
    });
    expect(createAgentShellProbeEnvironment('win32', {
      SECRET_TOKEN: 'secret',
      SystemRoot: String.raw`C:\Windows`,
      TEMP: String.raw`C:\Temp`,
    })).toEqual({
      SystemRoot: String.raw`C:\Windows`,
      TEMP: String.raw`C:\Temp`,
    });
  });

  it('terminates a timed-out detached probe and waits for close before rejecting', async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      child.pid = 321;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const terminateProcessTree = vi.fn();
      const spawnProcess = vi.fn(() => child as never);
      const processDependencies: AgentShellProviderProbeProcessDependencies = {
        spawnProcess,
        terminateProcessTree,
      };
      let rejected = false;
      const pending = runAgentShellProviderProbe({
        argv: ['-f', '--version'],
        executable: '/bin/zsh',
        platform: 'darwin',
        shell: false,
        timeoutMs: 10,
      }, processDependencies).catch((error: unknown) => {
        rejected = true;
        throw error;
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(terminateProcessTree).toHaveBeenCalledWith(
        child,
        'darwin',
        { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' },
      );
      expect(spawnProcess).toHaveBeenCalledWith('/bin/zsh', ['-f', '--version'], {
        detached: true,
        env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
      });
      await Promise.resolve();
      expect(rejected).toBe(false);

      child.emit('close', null);
      await expect(pending).rejects.toThrow('timeout');
      expect(rejected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('terminates output overflow and waits for close before rejecting', async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    child.pid = 654;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const terminateProcessTree = vi.fn();
    let rejected = false;
    const pending = runAgentShellProviderProbe({
      argv: ['--version'],
      executable: '/bin/bash',
      platform: 'linux',
      shell: false,
      timeoutMs: 3_000,
    }, {
      spawnProcess: vi.fn(() => child as never),
      terminateProcessTree,
    }).catch((error: unknown) => {
      rejected = true;
      throw error;
    });

    child.stdout.emit('data', Buffer.alloc(16 * 1024 + 1));
    expect(terminateProcessTree).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(rejected).toBe(false);
    child.emit('close', null);
    await expect(pending).rejects.toThrow('output-overflow');
  });

  it('reports a stable failure when a terminated probe never closes', async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      child.pid = 777;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const pending = runAgentShellProviderProbe({
        argv: ['--version'],
        executable: '/bin/bash',
        platform: 'linux',
        shell: false,
        timeoutMs: 10,
      }, {
        spawnProcess: vi.fn(() => child as never),
        terminateProcessTree: vi.fn(),
      });

      const assertion = expect(pending).rejects
        .toThrow('Agent Shell Provider probe termination did not settle');
      await vi.advanceTimersByTimeAsync(2_010);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
