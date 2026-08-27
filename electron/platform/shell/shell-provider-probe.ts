import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, open, realpath } from 'node:fs/promises';
import path from 'node:path';

import { terminateDesktopProcessTree } from '../processTree';
import type {
  AgentShellDialect,
  AgentShellExecutableContentIdentity,
  AgentShellProvider,
  AgentShellProviderEncoding,
  AgentShellProviderProbeDependencies,
  AgentShellProviderProbeExecutionRequest,
  AgentShellProviderProbeExecutionResult,
  AgentShellProviderProbeFailure,
  AgentShellProviderProbeResult,
  AgentShellProviderPublicIdentity,
  AgentShellProviderRegistrationHandle,
  AgentShellProbeEnvironment,
  AgentShellSupportedPlatform,
} from './shell-provider.types';

const MAX_PROBE_OUTPUT_BYTES = 16 * 1024;
const MAX_VERSION_CHARACTERS = 64;
const PROBE_TIMEOUT_MS = 3_000;
const PROBE_TERMINATION_SETTLE_MS = 2_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface AgentShellProviderProbeProcessDependencies {
  readonly spawnProcess: (
    executable: string,
    argv: readonly string[],
    options: {
      detached: boolean;
      env: AgentShellProbeEnvironment;
      shell: false;
      stdio: ['ignore', 'pipe', 'pipe'];
      windowsHide: boolean;
    },
  ) => ChildProcess;
  readonly terminateProcessTree: (
    child: ChildProcess,
    platform: AgentShellSupportedPlatform,
    environment: AgentShellProbeEnvironment,
  ) => void;
}

interface AgentShellProviderDefinition {
  readonly analyzerRevision: string;
  readonly candidates: readonly string[];
  readonly dialect: AgentShellDialect;
  readonly encodingRevisionForVersion: (version: string) => string;
  readonly encodingForVersion: (version: string) => AgentShellProviderEncoding;
  readonly environmentRevision: string;
  readonly fixedArgs: readonly string[];
  readonly implementationId: string;
  readonly invocationRevision: string;
  readonly parseVersion: (output: string) => string | null;
  readonly platform: AgentShellSupportedPlatform;
  readonly probeArgs: readonly string[];
  readonly providerId: string;
  readonly terminationRevision: string;
  readonly validateVersion?: (version: string) => boolean;
}

interface ProbeAgentShellProviderOptions {
  readonly definition: AgentShellProviderDefinition;
  readonly dependencies?: Partial<AgentShellProviderProbeDependencies>;
  readonly probeGeneration: number;
}

function appendBoundedOutput(
  chunks: Buffer[],
  chunk: Buffer | string,
  currentBytes: number,
): { bytes: number; overflow: boolean } {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const nextBytes = currentBytes + buffer.byteLength;
  if (nextBytes > MAX_PROBE_OUTPUT_BYTES) {
    return { bytes: nextBytes, overflow: true };
  }
  chunks.push(buffer);
  return { bytes: nextBytes, overflow: false };
}

export function runAgentShellProviderProbe(
  request: AgentShellProviderProbeExecutionRequest,
  processDependencies: AgentShellProviderProbeProcessDependencies =
    defaultAgentShellProviderProbeProcessDependencies,
): Promise<AgentShellProviderProbeExecutionResult> {
  return new Promise((resolve, reject) => {
    const environment = createAgentShellProbeEnvironment(request.platform);
    const child = processDependencies.spawnProcess(request.executable, [...request.argv], {
      detached: request.platform !== 'win32',
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: request.platform === 'win32',
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let failure: 'output-overflow' | 'probe-error' | 'timeout' | null = null;
    let settled = false;
    let settleTimer: NodeJS.Timeout | undefined;

    const complete = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (settleTimer) clearTimeout(settleTimer);
      handler();
    };

    const terminateAndAwaitClose = (
      nextFailure: Exclude<typeof failure, null>,
    ) => {
      if (settled || failure) return;
      failure = nextFailure;
      clearTimeout(timeoutTimer);
      settleTimer = setTimeout(() => {
        complete(() => reject(new Error('Agent Shell Provider probe termination did not settle')));
      }, PROBE_TERMINATION_SETTLE_MS);
      processDependencies.terminateProcessTree(child, request.platform, environment);
    };

    const collect = (target: Buffer[], chunk: Buffer | string) => {
      if (failure) return;
      const appended = appendBoundedOutput(target, chunk, outputBytes);
      outputBytes = appended.bytes;
      if (appended.overflow) terminateAndAwaitClose('output-overflow');
    };

    const timeoutTimer = setTimeout(() => {
      terminateAndAwaitClose('timeout');
    }, request.timeoutMs);
    child.stdout?.on('data', chunk => collect(stdout, chunk));
    child.stderr?.on('data', chunk => collect(stderr, chunk));
    child.once('error', () => terminateAndAwaitClose('probe-error'));
    child.once('close', (exitCode) => complete(() => {
      if (failure) {
        reject(new Error(`Agent Shell Provider probe ${failure}`));
        return;
      }
      resolve({
        exitCode,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      });
    }));
  });
}

export function createAgentShellProbeEnvironment(
  platform: AgentShellSupportedPlatform,
  source: AgentShellProbeEnvironment = process.env,
): AgentShellProbeEnvironment {
  if (platform !== 'win32') {
    return Object.freeze({
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin',
    });
  }
  const environment: Record<string, string> = {};
  for (const key of ['ComSpec', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'WINDIR'] as const) {
    const value = source[key];
    if (value) environment[key] = value;
  }
  return Object.freeze(environment);
}

export const defaultAgentShellProviderProbeProcessDependencies:
AgentShellProviderProbeProcessDependencies = {
  spawnProcess: (executable, argv, options) => spawn(executable, [...argv], {
    ...options,
    env: options.env as NodeJS.ProcessEnv,
  }),
  terminateProcessTree: (child, platform, environment) => {
    if (platform === 'win32') {
      terminateDesktopProcessTree(child, {
        environment: environment as NodeJS.ProcessEnv,
        force: true,
        platform,
      });
      return;
    }
    if (!child.pid) {
      child.kill('SIGKILL');
      return;
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  },
};

export async function readAgentShellExecutableContentIdentity(
  executable: string,
): Promise<AgentShellExecutableContentIdentity> {
  const handle = await open(executable, 'r');
  try {
    const initialStat = await handle.stat();
    if (!initialStat.isFile() || !Number.isSafeInteger(initialStat.size) || initialStat.size < 0) {
      throw new Error('Agent Shell executable identity 无效');
    }
    const digest = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < initialStat.size) {
      const length = Math.min(buffer.byteLength, initialStat.size - position);
      const read = await handle.read(buffer, 0, length, position);
      if (read.bytesRead <= 0) break;
      digest.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    if (position !== initialStat.size) {
      throw new Error('Agent Shell executable identity 读取不完整');
    }
    return Object.freeze({
      sha256: digest.digest('hex'),
      sizeBytes: initialStat.size,
    });
  } finally {
    await handle.close();
  }
}

export const defaultAgentShellProviderProbeDependencies: AgentShellProviderProbeDependencies = {
  accessExecutable: async (executable) => {
    await access(executable, fsConstants.X_OK);
  },
  readExecutableIdentity: async executable => readAgentShellExecutableContentIdentity(executable),
  resolveExecutable: async executable => realpath(executable),
  runProbe: runAgentShellProviderProbe,
};

function pathApiForPlatform(platform: AgentShellSupportedPlatform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

function normalizeVersion(version: string | null): string | null {
  const normalized = String(version || '').trim();
  if (!normalized || Array.from(normalized).length > MAX_VERSION_CHARACTERS) return null;
  return normalized;
}

function normalizeExecutableContentIdentity(
  identity: AgentShellExecutableContentIdentity,
): AgentShellExecutableContentIdentity | null {
  const sha256 = String(identity?.sha256 || '').trim().toLowerCase();
  const sizeBytes = identity?.sizeBytes;
  if (
    !SHA256_PATTERN.test(sha256)
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
  ) {
    return null;
  }
  return Object.freeze({ sha256, sizeBytes });
}

function equalExecutableContentIdentity(
  left: AgentShellExecutableContentIdentity,
  right: AgentShellExecutableContentIdentity,
): boolean {
  return left.sha256 === right.sha256 && left.sizeBytes === right.sizeBytes;
}

function hashIdentity(namespace: string, material: readonly unknown[]): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify([
    namespace,
    ...material,
  ])).digest('hex');
  return `v1:${digest}`;
}

function createProvider(input: {
  definition: AgentShellProviderDefinition;
  executable: string;
  executableContentIdentity: AgentShellExecutableContentIdentity;
  probeGeneration: number;
  resolvedExecutable: string;
  version: string;
}): AgentShellProvider {
  const fixedArgs = Object.freeze([...input.definition.fixedArgs]);
  const encoding = input.definition.encodingForVersion(input.version);
  const encodingRevision = input.definition.encodingRevisionForVersion(input.version);
  const registrationIdentity = hashIdentity('agent-shell-provider-registration-v1', [
    input.definition.providerId,
    input.definition.implementationId,
    input.definition.platform,
    input.definition.dialect,
    input.version,
    input.executable,
    input.resolvedExecutable,
    input.executableContentIdentity,
    fixedArgs,
    encoding,
    input.definition.analyzerRevision,
    input.definition.invocationRevision,
    input.definition.environmentRevision,
    encodingRevision,
    input.definition.terminationRevision,
  ]);
  const probeIdentity = hashIdentity('agent-shell-provider-probe-v1', [
    registrationIdentity,
    input.probeGeneration,
  ]);
  const mainBinding = Object.freeze({
    executable: input.executable,
    executableContentIdentity: input.executableContentIdentity,
    resolvedExecutable: input.resolvedExecutable,
  });
  const publicIdentity: AgentShellProviderPublicIdentity = Object.freeze({
    analyzerRevision: input.definition.analyzerRevision,
    dialect: input.definition.dialect,
    encoding,
    encodingRevision,
    environmentRevision: input.definition.environmentRevision,
    executionReady: false as const,
    fixedArgs,
    implementationId: input.definition.implementationId,
    invocationRevision: input.definition.invocationRevision,
    platform: input.definition.platform,
    probeGeneration: input.probeGeneration,
    probeIdentity,
    providerId: input.definition.providerId,
    registrationIdentity,
    terminationRevision: input.definition.terminationRevision,
    version: input.version,
  });
  const registrationHandle = Object.freeze({}) as AgentShellProviderRegistrationHandle;
  return Object.freeze({
    createInvocation: (command: string) => {
      if (typeof command !== 'string' || !command || command.includes('\0')) {
        throw new Error('Agent Shell command 无效');
      }
      return Object.freeze({
        argv: Object.freeze([...fixedArgs, command]),
        executable: input.resolvedExecutable,
        shell: false as const,
      });
    },
    getMainBinding: () => mainBinding,
    publicIdentity,
    registrationHandle,
  });
}

function failure(
  definition: AgentShellProviderDefinition,
  probeGeneration: number,
  reasonCode: AgentShellProviderProbeFailure['reasonCode'],
): AgentShellProviderProbeFailure {
  return Object.freeze({
    available: false as const,
    dialect: definition.dialect,
    implementationId: definition.implementationId,
    platform: definition.platform,
    probeGeneration,
    providerId: definition.providerId,
    reasonCode,
  });
}

export async function probeAgentShellProvider(
  options: ProbeAgentShellProviderOptions,
): Promise<AgentShellProviderProbeResult> {
  if (!Number.isSafeInteger(options.probeGeneration) || options.probeGeneration <= 0) {
    throw new Error('Agent Shell probe generation 无效');
  }
  const dependencies: AgentShellProviderProbeDependencies = {
    accessExecutable: options.dependencies?.accessExecutable
      || defaultAgentShellProviderProbeDependencies.accessExecutable,
    resolveExecutable: options.dependencies?.resolveExecutable
      || defaultAgentShellProviderProbeDependencies.resolveExecutable,
    readExecutableIdentity: options.dependencies?.readExecutableIdentity
      || defaultAgentShellProviderProbeDependencies.readExecutableIdentity,
    runProbe: options.dependencies?.runProbe
      || defaultAgentShellProviderProbeDependencies.runProbe,
  };
  const pathApi = pathApiForPlatform(options.definition.platform);
  const candidates = Array.from(new Set(options.definition.candidates));
  if (candidates.length === 0) {
    return failure(options.definition, options.probeGeneration, 'executable-not-found');
  }
  let sawAbsoluteCandidate = false;
  let sawAccessibleCandidate = false;
  let lastFailure: AgentShellProviderProbeFailure['reasonCode'] = 'executable-not-found';

  for (const executable of candidates) {
    if (!pathApi.isAbsolute(executable)) {
      lastFailure = 'invalid-executable-candidate';
      continue;
    }
    sawAbsoluteCandidate = true;
    try {
      await dependencies.accessExecutable(executable, options.definition.platform);
    } catch {
      continue;
    }
    sawAccessibleCandidate = true;
    let resolvedExecutable: string;
    try {
      resolvedExecutable = await dependencies.resolveExecutable(
        executable,
        options.definition.platform,
      );
    } catch {
      lastFailure = 'probe-failed';
      continue;
    }
    if (!pathApi.isAbsolute(resolvedExecutable)) {
      lastFailure = 'probe-failed';
      continue;
    }
    let executableIdentityBefore: AgentShellExecutableContentIdentity | null;
    try {
      executableIdentityBefore = normalizeExecutableContentIdentity(
        await dependencies.readExecutableIdentity(
          resolvedExecutable,
          options.definition.platform,
        ),
      );
    } catch {
      executableIdentityBefore = null;
    }
    if (!executableIdentityBefore) {
      lastFailure = 'executable-identity-unavailable';
      continue;
    }
    let result: AgentShellProviderProbeExecutionResult;
    try {
      result = await dependencies.runProbe({
        argv: Object.freeze([...options.definition.probeArgs]),
        executable: resolvedExecutable,
        platform: options.definition.platform,
        shell: false,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
    } catch {
      lastFailure = 'probe-failed';
      continue;
    }
    if (result.exitCode !== 0) {
      lastFailure = 'probe-failed';
      continue;
    }
    const version = normalizeVersion(options.definition.parseVersion(
      `${result.stdout}\n${result.stderr}`,
    ));
    if (!version) {
      lastFailure = 'version-unrecognized';
      continue;
    }
    if (options.definition.validateVersion && !options.definition.validateVersion(version)) {
      lastFailure = 'version-unrecognized';
      continue;
    }
    let resolvedExecutableAfter: string;
    try {
      resolvedExecutableAfter = await dependencies.resolveExecutable(
        executable,
        options.definition.platform,
      );
    } catch {
      lastFailure = 'executable-identity-unavailable';
      continue;
    }
    if (resolvedExecutableAfter !== resolvedExecutable) {
      lastFailure = 'executable-changed';
      continue;
    }
    let executableIdentityAfter: AgentShellExecutableContentIdentity | null;
    try {
      executableIdentityAfter = normalizeExecutableContentIdentity(
        await dependencies.readExecutableIdentity(
          resolvedExecutableAfter,
          options.definition.platform,
        ),
      );
    } catch {
      executableIdentityAfter = null;
    }
    if (!executableIdentityAfter) {
      lastFailure = 'executable-identity-unavailable';
      continue;
    }
    if (!equalExecutableContentIdentity(executableIdentityBefore, executableIdentityAfter)) {
      lastFailure = 'executable-changed';
      continue;
    }
    return Object.freeze({
      available: true as const,
      provider: createProvider({
        definition: options.definition,
        executable,
        executableContentIdentity: executableIdentityAfter,
        probeGeneration: options.probeGeneration,
        resolvedExecutable: resolvedExecutableAfter,
        version,
      }),
    });
  }

  if (!sawAbsoluteCandidate) {
    return failure(options.definition, options.probeGeneration, 'invalid-executable-candidate');
  }
  if (!sawAccessibleCandidate) {
    return failure(options.definition, options.probeGeneration, 'executable-not-found');
  }
  return failure(options.definition, options.probeGeneration, lastFailure);
}

export type { AgentShellProviderDefinition };
