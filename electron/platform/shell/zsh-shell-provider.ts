import {
  probeAgentShellProvider,
  type AgentShellProviderDefinition,
} from './shell-provider-probe';
import type {
  AgentShellProviderProbeDependencies,
  AgentShellProviderProbeResult,
} from './shell-provider.types';

const ZSH_VERSION_PATTERN = /\bzsh\s+([0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?)/iu;

export interface ProbeZshShellProviderOptions {
  readonly candidates?: readonly string[];
  readonly dependencies?: Partial<AgentShellProviderProbeDependencies>;
  readonly probeGeneration: number;
}

export const DEFAULT_MACOS_ZSH_CANDIDATES = Object.freeze(['/bin/zsh']);

export async function probeZshShellProvider(
  options: ProbeZshShellProviderOptions,
): Promise<AgentShellProviderProbeResult> {
  const definition: AgentShellProviderDefinition = {
    analyzerRevision: 'zsh-analysis-contract-v1',
    candidates: options.candidates || DEFAULT_MACOS_ZSH_CANDIDATES,
    dialect: 'zsh',
    encodingRevisionForVersion: () => 'utf8-stream-v1',
    encodingForVersion: () => Object.freeze({
      commandTransport: 'argv-unicode' as const,
      stderrDecoder: 'utf8' as const,
      stdoutDecoder: 'utf8' as const,
    }),
    environmentRevision: 'agent-shell-env-policy-v1',
    fixedArgs: Object.freeze(['-f', '-c']),
    implementationId: 'omniflow.shell.system-zsh.v1',
    invocationRevision: 'zsh-no-rc-invocation-v1',
    parseVersion: output => output.match(ZSH_VERSION_PATTERN)?.[1] || null,
    platform: 'darwin',
    probeArgs: Object.freeze(['-f', '--version']),
    providerId: 'system-zsh',
    terminationRevision: 'posix-process-group-v1',
  };
  return probeAgentShellProvider({
    definition,
    dependencies: options.dependencies,
    probeGeneration: options.probeGeneration,
  });
}
