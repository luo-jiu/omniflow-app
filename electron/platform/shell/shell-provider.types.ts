export type AgentShellSupportedPlatform = 'darwin' | 'linux' | 'win32';

export type AgentShellDialect = 'bash' | 'powershell' | 'zsh';

export type AgentShellProbeEnvironment = Readonly<Record<string, string | undefined>>;

export interface AgentShellProviderEncoding {
  readonly commandTransport:
    | 'argv-unicode'
    | 'main-owned-script-utf16le'
    | 'main-owned-script-utf8';
  readonly stderrDecoder: 'utf8' | 'windows-console-unimplemented';
  readonly stdoutDecoder: 'utf8' | 'windows-console-unimplemented';
}

export type AgentShellProviderUnavailableReasonCode =
  | 'executable-changed'
  | 'executable-identity-unavailable'
  | 'executable-not-found'
  | 'invalid-executable-candidate'
  | 'probe-failed'
  | 'unsupported-platform'
  | 'version-unrecognized';

export interface AgentShellProviderProbeExecutionRequest {
  readonly argv: readonly string[];
  readonly executable: string;
  readonly platform: AgentShellSupportedPlatform;
  readonly shell: false;
  readonly timeoutMs: number;
}

export interface AgentShellProviderProbeExecutionResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

export interface AgentShellProviderProbeDependencies {
  readonly accessExecutable: (
    executable: string,
    platform: AgentShellSupportedPlatform,
  ) => Promise<void>;
  readonly resolveExecutable: (
    executable: string,
    platform: AgentShellSupportedPlatform,
  ) => Promise<string>;
  readonly readExecutableIdentity: (
    executable: string,
    platform: AgentShellSupportedPlatform,
  ) => Promise<AgentShellExecutableContentIdentity>;
  readonly runProbe: (
    request: AgentShellProviderProbeExecutionRequest,
  ) => Promise<AgentShellProviderProbeExecutionResult>;
}

export interface AgentShellProviderInvocation {
  readonly argv: readonly string[];
  readonly executable: string;
  readonly shell: false;
}

export interface AgentShellProviderMainBinding {
  readonly executable: string;
  readonly executableContentIdentity: AgentShellExecutableContentIdentity;
  readonly resolvedExecutable: string;
}

export interface AgentShellExecutableContentIdentity {
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface AgentShellProviderPublicIdentity {
  readonly analyzerRevision: string;
  readonly dialect: AgentShellDialect;
  readonly encoding: AgentShellProviderEncoding;
  readonly encodingRevision: string;
  readonly environmentRevision: string;
  /** Probe success is discovery only; runtime wiring must separately prove readiness. */
  readonly executionReady: false;
  readonly fixedArgs: readonly string[];
  readonly implementationId: string;
  readonly invocationRevision: string;
  readonly platform: AgentShellSupportedPlatform;
  readonly probeGeneration: number;
  readonly probeIdentity: string;
  readonly providerId: string;
  readonly registrationIdentity: string;
  readonly terminationRevision: string;
  readonly version: string;
}

declare const AGENT_SHELL_PROVIDER_REGISTRATION_HANDLE: unique symbol;

/** Opaque in-process identity. Equal metadata from a later registration cannot reuse it. */
export type AgentShellProviderRegistrationHandle = Readonly<{
  [AGENT_SHELL_PROVIDER_REGISTRATION_HANDLE]: true;
}>;

export interface AgentShellProvider {
  readonly createInvocation: (command: string) => AgentShellProviderInvocation;
  readonly getMainBinding: () => AgentShellProviderMainBinding;
  readonly publicIdentity: AgentShellProviderPublicIdentity;
  readonly registrationHandle: AgentShellProviderRegistrationHandle;
}

export interface AgentShellProviderProbeFailure {
  readonly available: false;
  readonly dialect?: AgentShellDialect;
  readonly implementationId?: string;
  readonly platform: NodeJS.Platform;
  readonly probeGeneration: number;
  readonly providerId?: string;
  readonly reasonCode: AgentShellProviderUnavailableReasonCode;
}

export interface AgentShellProviderProbeSuccess {
  readonly available: true;
  readonly provider: AgentShellProvider;
}

export type AgentShellProviderProbeResult =
  | AgentShellProviderProbeFailure
  | AgentShellProviderProbeSuccess;
