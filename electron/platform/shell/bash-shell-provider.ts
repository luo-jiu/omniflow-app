import {
  probeAgentShellProvider,
  type AgentShellProviderDefinition,
} from './shell-provider-probe';
import type {
  AgentShellProviderProbeDependencies,
  AgentShellProviderProbeResult,
} from './shell-provider.types';

const BASH_VERSION_PATTERN = /\bversion\s+([0-9]+(?:\.[0-9]+){1,3})/iu;

export interface ProbeBashShellProviderOptions {
  readonly candidates?: readonly string[];
  readonly dependencies?: Partial<AgentShellProviderProbeDependencies>;
  readonly probeGeneration: number;
}

export const DEFAULT_LINUX_BASH_CANDIDATES = Object.freeze([
  '/bin/bash',
  '/usr/bin/bash',
]);

export async function probeBashShellProvider(
  options: ProbeBashShellProviderOptions,
): Promise<AgentShellProviderProbeResult> {
  const definition: AgentShellProviderDefinition = {
    analyzerRevision: 'bash-analysis-contract-v1',
    candidates: options.candidates || DEFAULT_LINUX_BASH_CANDIDATES,
    dialect: 'bash',
    encodingRevisionForVersion: () => 'utf8-stream-v1',
    encodingForVersion: () => Object.freeze({
      commandTransport: 'argv-unicode' as const,
      stderrDecoder: 'utf8' as const,
      stdoutDecoder: 'utf8' as const,
    }),
    environmentRevision: 'agent-shell-env-policy-v1',
    fixedArgs: Object.freeze(['--noprofile', '--norc', '-c']),
    implementationId: 'omniflow.shell.system-bash.v1',
    invocationRevision: 'bash-no-profile-invocation-v1',
    parseVersion: output => output.match(BASH_VERSION_PATTERN)?.[1] || null,
    platform: 'linux',
    probeArgs: Object.freeze(['--noprofile', '--norc', '--version']),
    providerId: 'system-bash',
    terminationRevision: 'posix-process-group-v1',
  };
  return probeAgentShellProvider({
    definition,
    dependencies: options.dependencies,
    probeGeneration: options.probeGeneration,
  });
}
