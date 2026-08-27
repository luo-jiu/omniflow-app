import crypto from 'node:crypto';

import { probeBashShellProvider } from '../../../platform/shell/bash-shell-provider';
import {
  probePowerShellCoreProvider,
  probeWindowsPowerShellProvider,
  type PowerShellCandidateEnvironment,
} from '../../../platform/shell/powershell-provider';
import type {
  AgentShellProvider,
  AgentShellProviderProbeDependencies,
  AgentShellProviderProbeFailure,
  AgentShellProviderProbeResult,
  AgentShellProviderPublicIdentity,
  AgentShellSupportedPlatform,
} from '../../../platform/shell/shell-provider.types';
import { probeZshShellProvider } from '../../../platform/shell/zsh-shell-provider';

interface AgentShellProviderCandidateOverrides {
  readonly darwin?: readonly string[];
  readonly linux?: readonly string[];
  readonly powerShellCore?: readonly string[];
  readonly windowsPowerShell?: readonly string[];
}

export interface AgentShellProviderRegistrySnapshot {
  readonly defaultProviderId: string | null;
  readonly defaultProviderRegistrationIdentity: string | null;
  readonly failures: readonly AgentShellProviderProbeFailure[];
  readonly getProvider: (registrationIdentity: string) => AgentShellProvider | undefined;
  readonly getProviderById: (providerId: string) => AgentShellProvider | undefined;
  readonly platform: NodeJS.Platform;
  readonly probeGeneration: number;
  /** Safe enumerable projection. Absolute executable paths remain in getProvider(). */
  readonly providers: readonly AgentShellProviderPublicIdentity[];
  readonly snapshotIdentity: string;
}

export interface AgentShellProviderRegistry {
  readonly getSnapshot: () => AgentShellProviderRegistrySnapshot;
  readonly refresh: () => Promise<AgentShellProviderRegistrySnapshot>;
}

export interface CreateAgentShellProviderRegistryOptions {
  readonly candidates?: AgentShellProviderCandidateOverrides;
  readonly environment?: PowerShellCandidateEnvironment;
  readonly platform?: NodeJS.Platform;
  readonly probeDependencies?: Partial<AgentShellProviderProbeDependencies>;
}

function isSupportedPlatform(platform: NodeJS.Platform): platform is AgentShellSupportedPlatform {
  return platform === 'darwin' || platform === 'linux' || platform === 'win32';
}

function snapshotIdentity(input: {
  failures: readonly AgentShellProviderProbeFailure[];
  platform: NodeJS.Platform;
  probeGeneration: number;
  providers: readonly AgentShellProviderPublicIdentity[];
}): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify([
    'agent-shell-provider-snapshot-v1',
    input.platform,
    input.probeGeneration,
    input.providers,
    input.failures,
  ])).digest('hex');
  return `v1:${digest}`;
}

function createSnapshot(input: {
  defaultProviderId?: string;
  platform: NodeJS.Platform;
  probeGeneration: number;
  results?: readonly AgentShellProviderProbeResult[];
}): AgentShellProviderRegistrySnapshot {
  const mainProviders = Object.freeze((input.results || [])
    .filter((result): result is Extract<AgentShellProviderProbeResult, { available: true }> => (
      result.available
    ))
    .map(result => result.provider));
  const providers = Object.freeze(mainProviders.map(provider => provider.publicIdentity));
  const failures = Object.freeze((input.results || [])
    .filter((result): result is AgentShellProviderProbeFailure => !result.available));
  const providerByRegistrationIdentity = new Map(
    mainProviders.map(provider => [
      provider.publicIdentity.registrationIdentity,
      provider,
    ] as const),
  );
  const providerById = new Map(
    mainProviders.map(provider => [provider.publicIdentity.providerId, provider] as const),
  );
  const defaultProvider = input.defaultProviderId
    ? providerById.get(input.defaultProviderId)
    : mainProviders[0];
  const identity = snapshotIdentity({
    failures,
    platform: input.platform,
    probeGeneration: input.probeGeneration,
    providers,
  });
  return Object.freeze({
    defaultProviderId: defaultProvider?.publicIdentity.providerId || null,
    defaultProviderRegistrationIdentity:
      defaultProvider?.publicIdentity.registrationIdentity || null,
    failures,
    getProvider: (registrationIdentity: string) => (
      providerByRegistrationIdentity.get(registrationIdentity)
    ),
    getProviderById: (providerId: string) => providerById.get(providerId),
    platform: input.platform,
    probeGeneration: input.probeGeneration,
    providers,
    snapshotIdentity: identity,
  });
}

function unsupportedPlatformResult(
  platform: NodeJS.Platform,
  probeGeneration: number,
): AgentShellProviderProbeFailure {
  return Object.freeze({
    available: false as const,
    platform,
    probeGeneration,
    reasonCode: 'unsupported-platform' as const,
  });
}

export function createAgentShellProviderRegistry(
  options: CreateAgentShellProviderRegistryOptions = {},
): AgentShellProviderRegistry {
  const platform = options.platform || process.platform;
  const candidates = Object.freeze({
    ...(options.candidates?.darwin
      ? { darwin: Object.freeze([...options.candidates.darwin]) }
      : {}),
    ...(options.candidates?.linux
      ? { linux: Object.freeze([...options.candidates.linux]) }
      : {}),
    ...(options.candidates?.powerShellCore
      ? { powerShellCore: Object.freeze([...options.candidates.powerShellCore]) }
      : {}),
    ...(options.candidates?.windowsPowerShell
      ? { windowsPowerShell: Object.freeze([...options.candidates.windowsPowerShell]) }
      : {}),
  });
  const environment = options.environment
    ? Object.freeze({
        ProgramFiles: options.environment.ProgramFiles,
        SystemRoot: options.environment.SystemRoot,
        WINDIR: options.environment.WINDIR,
      })
    : undefined;
  const probeDependencies = Object.freeze({
    accessExecutable: options.probeDependencies?.accessExecutable,
    readExecutableIdentity: options.probeDependencies?.readExecutableIdentity,
    resolveExecutable: options.probeDependencies?.resolveExecutable,
    runProbe: options.probeDependencies?.runProbe,
  });
  let nextProbeGeneration = 0;
  let currentSnapshot = createSnapshot({ platform, probeGeneration: 0 });

  const refresh = async (): Promise<AgentShellProviderRegistrySnapshot> => {
    const probeGeneration = nextProbeGeneration + 1;
    nextProbeGeneration = probeGeneration;
    let results: readonly AgentShellProviderProbeResult[];
    let defaultProviderId: string | undefined;
    if (!isSupportedPlatform(platform)) {
      results = [unsupportedPlatformResult(platform, probeGeneration)];
    } else if (platform === 'darwin') {
      results = [await probeZshShellProvider({
        candidates: candidates.darwin,
        dependencies: probeDependencies,
        probeGeneration,
      })];
      defaultProviderId = 'system-zsh';
    } else if (platform === 'linux') {
      results = [await probeBashShellProvider({
        candidates: candidates.linux,
        dependencies: probeDependencies,
        probeGeneration,
      })];
      defaultProviderId = 'system-bash';
    } else {
      results = await Promise.all([
        probePowerShellCoreProvider({
          candidates: candidates.powerShellCore,
          dependencies: probeDependencies,
          environment,
          probeGeneration,
        }),
        probeWindowsPowerShellProvider({
          candidates: candidates.windowsPowerShell,
          dependencies: probeDependencies,
          environment,
          probeGeneration,
        }),
      ]);
      defaultProviderId = results[0]?.available ? 'pwsh' : 'windows-powershell';
    }
    const snapshot = createSnapshot({
      defaultProviderId,
      platform,
      probeGeneration,
      results,
    });
    if (snapshot.probeGeneration > currentSnapshot.probeGeneration) {
      currentSnapshot = snapshot;
      return snapshot;
    }
    return currentSnapshot;
  };

  return Object.freeze({
    getSnapshot: () => currentSnapshot,
    refresh,
  });
}
