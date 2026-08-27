import path from 'node:path';

import {
  probeAgentShellProvider,
  type AgentShellProviderDefinition,
} from './shell-provider-probe';
import type {
  AgentShellProviderProbeDependencies,
  AgentShellProviderProbeResult,
} from './shell-provider.types';

const POWERSHELL_VERSION_PATTERN = /\b([0-9]+(?:\.[0-9]+){1,3})\b/u;
const POWERSHELL_FIXED_ARGS = Object.freeze([
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
]);

export interface PowerShellCandidateEnvironment {
  readonly ProgramFiles?: string;
  readonly SystemRoot?: string;
  readonly WINDIR?: string;
}

interface ProbePowerShellProviderOptions {
  readonly candidates?: readonly string[];
  readonly dependencies?: Partial<AgentShellProviderProbeDependencies>;
  readonly environment?: PowerShellCandidateEnvironment;
  readonly probeGeneration: number;
}

export function getDefaultPowerShellCoreCandidates(
  environment?: PowerShellCandidateEnvironment,
): readonly string[] {
  const source = environment || { ProgramFiles: process.env.ProgramFiles };
  const programFiles = String(source.ProgramFiles || '').trim();
  return Object.freeze(programFiles
    ? [path.win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe')]
    : []);
}

export function getDefaultWindowsPowerShellCandidates(
  environment?: PowerShellCandidateEnvironment,
): readonly string[] {
  const source = environment || {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
  };
  const systemRoot = String(source.SystemRoot || source.WINDIR || '').trim();
  return Object.freeze(systemRoot
    ? [path.win32.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )]
    : []);
}

function powerShellVersion(output: string): string | null {
  return output.match(POWERSHELL_VERSION_PATTERN)?.[1] || null;
}

function powerShellMajor(version: string): number | null {
  const major = Number.parseInt(version.split('.')[0] || '', 10);
  return Number.isSafeInteger(major) ? major : null;
}

export async function probePowerShellCoreProvider(
  options: ProbePowerShellProviderOptions,
): Promise<AgentShellProviderProbeResult> {
  const definition: AgentShellProviderDefinition = {
    analyzerRevision: 'pwsh-ast-analysis-contract-v1',
    candidates: options.candidates || getDefaultPowerShellCoreCandidates(options.environment),
    dialect: 'powershell',
    encodingForVersion: () => Object.freeze({
      commandTransport: 'argv-unicode' as const,
      stderrDecoder: 'utf8' as const,
      stdoutDecoder: 'utf8' as const,
    }),
    encodingRevisionForVersion: () => 'pwsh-utf8-stream-v1',
    environmentRevision: 'agent-shell-windows-env-policy-v1',
    fixedArgs: POWERSHELL_FIXED_ARGS,
    implementationId: 'omniflow.shell.pwsh.v1',
    invocationRevision: 'pwsh-no-profile-invocation-v1',
    parseVersion: powerShellVersion,
    platform: 'win32',
    probeArgs: Object.freeze([
      ...POWERSHELL_FIXED_ARGS,
      '$PSVersionTable.PSVersion.ToString()',
    ]),
    providerId: 'pwsh',
    terminationRevision: 'windows-job-object-required-v1',
    validateVersion: version => (powerShellMajor(version) || 0) >= 6,
  };
  return probeAgentShellProvider({
    definition,
    dependencies: options.dependencies,
    probeGeneration: options.probeGeneration,
  });
}

export async function probeWindowsPowerShellProvider(
  options: ProbePowerShellProviderOptions,
): Promise<AgentShellProviderProbeResult> {
  const definition: AgentShellProviderDefinition = {
    analyzerRevision: 'windows-powershell-ast-analysis-contract-v1',
    candidates: options.candidates || getDefaultWindowsPowerShellCandidates(options.environment),
    dialect: 'powershell',
    encodingForVersion: () => Object.freeze({
      commandTransport: 'argv-unicode' as const,
      stderrDecoder: 'windows-console-unimplemented' as const,
      stdoutDecoder: 'windows-console-unimplemented' as const,
    }),
    encodingRevisionForVersion: () => 'windows-powershell-decoder-pending-v1',
    environmentRevision: 'agent-shell-windows-env-policy-v1',
    fixedArgs: POWERSHELL_FIXED_ARGS,
    implementationId: 'omniflow.shell.windows-powershell.v1',
    invocationRevision: 'windows-powershell-no-profile-invocation-v1',
    parseVersion: powerShellVersion,
    platform: 'win32',
    probeArgs: Object.freeze([
      ...POWERSHELL_FIXED_ARGS,
      '$PSVersionTable.PSVersion.ToString()',
    ]),
    providerId: 'windows-powershell',
    terminationRevision: 'windows-job-object-required-v1',
    validateVersion: version => powerShellMajor(version) === 5,
  };
  return probeAgentShellProvider({
    definition,
    dependencies: options.dependencies,
    probeGeneration: options.probeGeneration,
  });
}
