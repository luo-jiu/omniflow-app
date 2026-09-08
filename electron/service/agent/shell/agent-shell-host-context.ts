import crypto from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';

const HOST_CONTEXT_POLICY_REVISION = 'shell-host-context-v1';
const HOST_ENVIRONMENT_POLICY_REVISION = 'shell-host-environment-v1';
// Keep preparation at or below the ProcessSupervisor grant boundary so an
// accepted host snapshot cannot become unspawnable later in the same chain.
const HOST_ENVIRONMENT_MAX_ENTRIES = 128;
const HOST_ENVIRONMENT_MAX_NAME_BYTES = 128;
const HOST_ENVIRONMENT_MAX_VALUE_BYTES = 16 * 1024;
const HOST_CWD_MAX_BYTES = 4 * 1024;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const UNSAFE_ENVIRONMENT_NAMES = new Set([
  'BASH_ENV',
  'COMSPEC',
  'ENV',
  'GIT_ASKPASS',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'GIT_PAGER',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'JDK_JAVA_OPTIONS',
  'JAVA_TOOL_OPTIONS',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'NPM_CONFIG_USERCONFIG',
  'PERL5LIB',
  'PERL5OPT',
  'PROMPT_COMMAND',
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYLIB',
  'RUBYOPT',
  'SHELL',
  'SSH_ASKPASS',
  'SUDO_ASKPASS',
]);
const PROTECTED_ENVIRONMENT_NAMES = new Set([
  'COMSPEC',
  'HOME',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
]);
const SENSITIVE_ENVIRONMENT_NAME_PARTS = [
  'AUTH',
  'COOKIE',
  'CREDENTIAL',
  'KEY',
  'PASSWORD',
  'SECRET',
  'TOKEN',
] as const;
const SENSITIVE_ENVIRONMENT_NAME_PATTERN = new RegExp(
  `(?:${SENSITIVE_ENVIRONMENT_NAME_PARTS.join('|')})`,
  'u',
);
const HOST_ENVIRONMENT_DENY_PREFIXES = ['DYLD_', 'GIT_CONFIG_', 'LC_'] as const;

export interface AgentShellHostCwdIdentity {
  readonly ctimeNs: string;
  readonly device: string;
  readonly inode: string;
  readonly mode: string;
  readonly mtimeNs: string;
  readonly nlink: string;
  readonly size: string;
}

export interface AgentShellHostCwd {
  readonly requestedCwd?: string;
  /** Canonical path and identity are main-only and must never enter public action. */
  readonly canonicalPath: string;
  readonly identity: AgentShellHostCwdIdentity;
  readonly lexicalPath: string;
}

export interface AgentShellHostEnvironmentEntry {
  readonly name: string;
  readonly value: string;
}

export interface AgentShellHostEnvironmentSnapshot {
  readonly entries: readonly AgentShellHostEnvironmentEntry[];
  readonly environmentIdentity: string;
  readonly pathHash: string;
  readonly policyRevision: typeof HOST_ENVIRONMENT_POLICY_REVISION;
}

export interface AgentShellHostContext {
  readonly contextIdentity: string;
  readonly cwd: AgentShellHostCwd;
  readonly environment: AgentShellHostEnvironmentSnapshot;
  readonly environmentId: 'local';
  readonly policyRevision: typeof HOST_CONTEXT_POLICY_REVISION;
}

export interface AgentShellHostCwdResolverOptions {
  readonly defaultCwd?: string;
  readonly homedir?: string;
  readonly requestedCwd?: string;
  readonly platform?: NodeJS.Platform;
}

export interface AgentShellHostEnvironmentOptions {
  readonly overrides?: Readonly<Record<string, string>>;
  readonly source?: Readonly<Record<string, string | undefined>>;
}

export interface AgentShellHostContextOptions extends AgentShellHostCwdResolverOptions {
  readonly environment?: AgentShellHostEnvironmentOptions;
}

export interface AgentShellHostContextDependencies {
  readonly lstat?: typeof lstat;
  readonly realpath?: typeof realpath;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function hashIdentity(domain: string, value: unknown): string {
  return `v1:${crypto.createHash('sha256').update(JSON.stringify([domain, value])).digest('hex')}`;
}

function invalid(message: string): never {
  throw new Error(message);
}

function normalizePathText(input: unknown, label: string): string {
  if (typeof input !== 'string') invalid(`${label}无效`);
  const value = input.trim();
  if (
    !value
    || utf8Length(value) > HOST_CWD_MAX_BYTES
    || value.includes('\0')
    || Array.from(value).some(character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) invalid(`${label}无效`);
  return value;
}

function normalizeHostHome(input: unknown): string {
  const value = normalizePathText(input, 'Agent Shell 宿主 home');
  if (!path.posix.isAbsolute(value)) invalid('Agent Shell 宿主 home 无效');
  return path.posix.normalize(value);
}

function statIdentity(stat: BigIntStats): AgentShellHostCwdIdentity {
  return Object.freeze({
    ctimeNs: stat.ctimeNs.toString(),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    nlink: stat.nlink.toString(),
    size: stat.size.toString(),
  });
}

function sameCwdIdentity(
  left: AgentShellHostCwdIdentity,
  right: AgentShellHostCwdIdentity,
): boolean {
  return left.ctimeNs === right.ctimeNs
    && left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.nlink === right.nlink
    && left.size === right.size;
}

function assertDirectory(stat: BigIntStats, label: string): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) invalid(`${label}必须是普通目录`);
}

function resolveRequestedPath(
  requestedCwd: string | undefined,
  defaultCwd: string,
  hostHome: string,
): string {
  const requested = requestedCwd === undefined
    ? defaultCwd
    : normalizePathText(requestedCwd, 'Agent Shell 宿主 cwd');
  const expanded = requested === '~'
    ? hostHome
    : requested.startsWith('~/')
      ? path.posix.join(hostHome, requested.slice(2))
      : requested;
  return path.posix.isAbsolute(expanded)
    ? path.posix.normalize(expanded)
    : path.posix.resolve(defaultCwd, expanded);
}

async function resolveCwd(
  options: AgentShellHostCwdResolverOptions,
  dependencies: AgentShellHostContextDependencies = {},
): Promise<AgentShellHostCwd> {
  const platform = options.platform || process.platform;
  if (platform !== 'darwin') invalid('Agent Shell host context 目前仅支持 macOS');
  const stat = dependencies.lstat || lstat;
  const canonicalize = dependencies.realpath || realpath;
  const sourceHome = options.homedir === undefined ? os.homedir() : options.homedir;
  const hostHome = normalizeHostHome(sourceHome);
  const defaultCwd = normalizePathText(options.defaultCwd || process.cwd(), 'Agent Shell 默认 cwd');
  if (!path.posix.isAbsolute(defaultCwd)) invalid('Agent Shell 默认 cwd 必须是绝对路径');
  const lexicalPath = resolveRequestedPath(options.requestedCwd, defaultCwd, hostHome);
  const lexicalStat = await stat(lexicalPath, { bigint: true });
  assertDirectory(lexicalStat, 'Agent Shell 宿主 cwd');
  const canonicalPath = path.posix.normalize(await canonicalize(lexicalPath));
  const canonicalStat = await stat(canonicalPath, { bigint: true });
  assertDirectory(canonicalStat, 'Agent Shell 宿主 cwd');
  return Object.freeze({
    ...(options.requestedCwd === undefined
      ? {}
      : { requestedCwd: normalizePathText(options.requestedCwd, 'Agent Shell 宿主 cwd') }),
    canonicalPath,
    identity: statIdentity(canonicalStat),
    lexicalPath,
  });
}

function isSensitiveName(name: string): boolean {
  const foldedName = name.toUpperCase();
  return SENSITIVE_ENVIRONMENT_NAME_PATTERN.test(foldedName);
}

function isDeniedSourceName(name: string): boolean {
  const foldedName = name.toUpperCase();
  return UNSAFE_ENVIRONMENT_NAMES.has(foldedName)
    || HOST_ENVIRONMENT_DENY_PREFIXES.some(prefix => foldedName.startsWith(prefix));
}

function normalizeEnvironmentName(input: unknown): string {
  if (typeof input !== 'string'
    || !input
    || utf8Length(input) > HOST_ENVIRONMENT_MAX_NAME_BYTES
    || !ENVIRONMENT_NAME_PATTERN.test(input)) {
    invalid('Agent Shell 宿主环境变量名无效');
  }
  return input;
}

function normalizeEnvironmentValue(input: unknown): string {
  if (
    typeof input !== 'string'
    || utf8Length(input) > HOST_ENVIRONMENT_MAX_VALUE_BYTES
    || input.includes('\0')
    || Array.from(input).some(character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) invalid('Agent Shell 宿主环境变量值无效');
  return input;
}

function validateEnvironmentOverrideName(name: string): void {
  const foldedName = name.toUpperCase();
  if (
    PROTECTED_ENVIRONMENT_NAMES.has(foldedName)
    || isDeniedSourceName(name)
    || isSensitiveName(name)
  ) invalid('Agent Shell 宿主环境变量禁止覆盖');
}

function environmentEntries(
  options: AgentShellHostEnvironmentOptions = {},
): readonly AgentShellHostEnvironmentEntry[] {
  const source = options.source || process.env;
  const overrides = options.overrides || {};
  const values = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(source)) {
    if (rawValue === undefined) continue;
    const name = normalizeEnvironmentName(rawName);
    if (isDeniedSourceName(name) || isSensitiveName(name)) continue;
    values.set(name, normalizeEnvironmentValue(rawValue));
  }
  const seenOverrideNames = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(overrides)) {
    const name = normalizeEnvironmentName(rawName);
    const foldedName = name.toUpperCase();
    if (seenOverrideNames.has(foldedName)) invalid('Agent Shell 宿主环境变量重复');
    seenOverrideNames.add(foldedName);
    validateEnvironmentOverrideName(name);
    values.set(name, normalizeEnvironmentValue(rawValue));
  }
  if (values.size > HOST_ENVIRONMENT_MAX_ENTRIES) invalid('Agent Shell 宿主环境变量过多');
  return Object.freeze(Array.from(values.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => Object.freeze({ name, value })));
}

export function createAgentShellHostEnvironmentSnapshot(
  options: AgentShellHostEnvironmentOptions = {},
): AgentShellHostEnvironmentSnapshot {
  const entries = environmentEntries(options);
  const pathValue = entries.find(entry => entry.name === 'PATH')?.value || '';
  return Object.freeze({
    entries,
    environmentIdentity: hashIdentity('omniflow.agent.shell.host-environment-v1', {
      entries,
      policyRevision: HOST_ENVIRONMENT_POLICY_REVISION,
    }),
    pathHash: hashIdentity('omniflow.agent.shell.host-path-v1', pathValue),
    policyRevision: HOST_ENVIRONMENT_POLICY_REVISION,
  });
}

export async function resolveAgentShellHostCwd(
  options: AgentShellHostCwdResolverOptions = {},
  dependencies: AgentShellHostContextDependencies = {},
): Promise<AgentShellHostCwd> {
  return resolveCwd(options, dependencies);
}

export async function revalidateAgentShellHostCwd(
  expected: AgentShellHostCwd,
  options: Omit<AgentShellHostCwdResolverOptions, 'requestedCwd'> & {
    readonly requestedCwd?: string;
  } = {},
  dependencies: AgentShellHostContextDependencies = {},
): Promise<AgentShellHostCwd> {
  const current = await resolveCwd({
    ...options,
    requestedCwd: options.requestedCwd ?? expected.requestedCwd,
  }, dependencies);
  if (
    current.canonicalPath !== expected.canonicalPath
    || current.lexicalPath !== expected.lexicalPath
    || !sameCwdIdentity(current.identity, expected.identity)
  ) invalid('Agent Shell 宿主 cwd 在执行前已变化');
  return current;
}

export async function resolveAgentShellHostContext(
  options: AgentShellHostContextOptions = {},
  dependencies: AgentShellHostContextDependencies = {},
): Promise<AgentShellHostContext> {
  const cwd = await resolveAgentShellHostCwd(options, dependencies);
  const environment = createAgentShellHostEnvironmentSnapshot(options.environment);
  return Object.freeze({
    contextIdentity: hashIdentity('omniflow.agent.shell.host-context-v1', {
      cwd: {
        canonicalPath: cwd.canonicalPath,
        identity: cwd.identity,
      },
      environmentIdentity: environment.environmentIdentity,
      environmentId: 'local',
      policyRevision: HOST_CONTEXT_POLICY_REVISION,
    }),
    cwd,
    environment,
    environmentId: 'local',
    policyRevision: HOST_CONTEXT_POLICY_REVISION,
  });
}

export function sameAgentShellHostCwd(
  left: AgentShellHostCwd,
  right: AgentShellHostCwd,
): boolean {
  return left.canonicalPath === right.canonicalPath
    && left.lexicalPath === right.lexicalPath
    && left.requestedCwd === right.requestedCwd
    && sameCwdIdentity(left.identity, right.identity);
}

export const AGENT_SHELL_HOST_CONTEXT_POLICY_REVISION = HOST_CONTEXT_POLICY_REVISION;
export const AGENT_SHELL_HOST_ENVIRONMENT_POLICY_REVISION = HOST_ENVIRONMENT_POLICY_REVISION;
