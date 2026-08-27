export const AGENT_SHELL_RUN_TOOL_NAME = 'shell.run' as const;

export const AGENT_SHELL_PREPARED_ACTION_VERSION = 1 as const;

export const AGENT_SHELL_DEFAULT_CWD = 'work';

export const AGENT_SHELL_DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;

export const AGENT_SHELL_MAX_TIMEOUT_MS = 6 * 60 * 60 * 1_000;

export const AGENT_SHELL_MAX_COMMAND_BYTES = 24_576;

export const AGENT_SHELL_MAX_CWD_BYTES = 1_024;

export const AGENT_SHELL_MAX_ENVIRONMENT_ENTRIES = 32;

export const AGENT_SHELL_MAX_ENVIRONMENT_BYTES = 16 * 1_024;

export const AGENT_SHELL_FORBIDDEN_ENVIRONMENT_NAMES = Object.freeze([
  '__PROTO__',
  '_JAVA_OPTIONS',
  'BASH_ENV',
  'BROWSER',
  'BUNDLE_GEMFILE',
  'COMSPEC',
  'CONSTRUCTOR',
  'EDITOR',
  'ENV',
  'GIT_ASKPASS',
  'GIT_PAGER',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'HOME',
  'JDK_JAVA_OPTIONS',
  'JAVA_TOOL_OPTIONS',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'LESSOPEN',
  'MANPAGER',
  'NPM_CONFIG_USERCONFIG',
  'NODE_OPTIONS',
  'PAGER',
  'PATHEXT',
  'PERL5LIB',
  'PERL5OPT',
  'PATH',
  'POWERSHELL_TELEMETRY_OPTOUT',
  'PROMPT_COMMAND',
  'PROTOTYPE',
  'PSMODULEPATH',
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RSYNC_RSH',
  'RUBYLIB',
  'RUBYOPT',
  'SHELL',
  'SSH_ASKPASS',
  'SUDO_ASKPASS',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'VISUAL',
  'WINDIR',
] as const);

export const AGENT_SHELL_FORBIDDEN_ENVIRONMENT_PREFIXES = Object.freeze([
  'DYLD_',
  'GIT_CONFIG_',
  'LC_',
] as const);

export const AGENT_SHELL_SENSITIVE_ENVIRONMENT_NAME_PARTS = Object.freeze([
  'AUTH',
  'COOKIE',
  'CREDENTIAL',
  'KEY',
  'PASSWORD',
  'SECRET',
  'TOKEN',
] as const);

export type AgentShellDialect = 'bash' | 'powershell' | 'zsh';

export type AgentShellRisk = 'destructive' | 'external' | 'read' | 'write';

export type AgentShellRiskFacet =
  | 'command_substitution'
  | 'detached'
  | 'dynamic_command_head'
  | 'environment_change'
  | 'external_path'
  | 'filesystem.delete'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'interactive'
  | 'nested_shell'
  | 'network'
  | 'package_install'
  | 'privilege_escalation'
  | 'process_launch'
  | 'redirection'
  | 'system_configuration'
  | 'unknown_syntax';

export interface AgentShellRunInputV1 {
  command: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
  providerId?: string;
  timeoutMs: number;
}

export interface AgentShellPreparedOperation {
  argvPrefix: readonly string[];
  effects: readonly AgentShellRiskFacet[];
  executable: string;
}

export interface AgentShellPreparedAssessment {
  facets: readonly AgentShellRiskFacet[];
  operations: readonly AgentShellPreparedOperation[];
  persistentRuleEligible: boolean;
  risk: AgentShellRisk;
  unresolved: readonly string[];
}

export interface AgentShellPreparedStagedInput {
  contentHash: string;
  displayName: string;
  logicalPath: string;
  sourceKind: 'library' | 'local-picker';
}

export interface AgentShellPreparedActionPublicV1 {
  aiDestination: {
    identityHash: string;
    profileLabel: string;
    providerType: string;
  };
  assessment: AgentShellPreparedAssessment;
  command: string;
  commandHash: string;
  cwd: {
    kind: 'run-workspace';
    path: string;
  };
  dataScope: {
    stagedInputs: readonly AgentShellPreparedStagedInput[];
    unresolvedWorkspaceRead: boolean;
  };
  environment: readonly {
    name: string;
    value: string;
  }[];
  kind: typeof AGENT_SHELL_RUN_TOOL_NAME;
  provider: {
    dialect: AgentShellDialect;
    id: string;
    version: string;
  };
  timeoutMs: number;
  version: typeof AGENT_SHELL_PREPARED_ACTION_VERSION;
}

const SHELL_RUN_INPUT_FIELDS = new Set(['command', 'cwd', 'env', 'providerId', 'timeoutMs']);
const SHELL_PREPARED_ACTION_FIELDS = new Set([
  'aiDestination',
  'assessment',
  'command',
  'commandHash',
  'cwd',
  'dataScope',
  'environment',
  'kind',
  'provider',
  'timeoutMs',
  'version',
]);
const AI_DESTINATION_FIELDS = new Set(['identityHash', 'profileLabel', 'providerType']);
const ASSESSMENT_FIELDS = new Set([
  'facets',
  'operations',
  'persistentRuleEligible',
  'risk',
  'unresolved',
]);
const OPERATION_FIELDS = new Set(['argvPrefix', 'effects', 'executable']);
const CWD_FIELDS = new Set(['kind', 'path']);
const DATA_SCOPE_FIELDS = new Set(['stagedInputs', 'unresolvedWorkspaceRead']);
const STAGED_INPUT_FIELDS = new Set(['contentHash', 'displayName', 'logicalPath', 'sourceKind']);
const ENVIRONMENT_ENTRY_FIELDS = new Set(['name', 'value']);
const PROVIDER_FIELDS = new Set(['dialect', 'id', 'version']);
const SHELL_RISKS = new Set<AgentShellRisk>(['destructive', 'external', 'read', 'write']);
const SHELL_RISK_FACETS = new Set<AgentShellRiskFacet>([
  'command_substitution',
  'detached',
  'dynamic_command_head',
  'environment_change',
  'external_path',
  'filesystem.delete',
  'filesystem.read',
  'filesystem.write',
  'interactive',
  'nested_shell',
  'network',
  'package_install',
  'privilege_escalation',
  'process_launch',
  'redirection',
  'system_configuration',
  'unknown_syntax',
]);
const SHELL_DIALECTS = new Set<AgentShellDialect>(['bash', 'powershell', 'zsh']);
const SHELL_WORKSPACE_ROOTS = new Set(['home', 'input', 'output', 'tmp', 'work']);
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SHELL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const VERSIONED_IDENTITY_PATTERN = /^v[1-9]\d*:[a-f0-9]{64}$/u;
const FORBIDDEN_ENVIRONMENT_NAMES: ReadonlySet<string> = new Set(
  AGENT_SHELL_FORBIDDEN_ENVIRONMENT_NAMES,
);
const SENSITIVE_ENVIRONMENT_NAME_PATTERN = new RegExp(
  `(?:${AGENT_SHELL_SENSITIVE_ENVIRONMENT_NAME_PARTS.join('|')})`,
  'u',
);
const WINDOWS_FORBIDDEN_PATH_CHARACTER_PATTERN = /[<>:"|?*]/u;
const WINDOWS_RESERVED_PATH_SEGMENT_PATTERN = /^(?:AUX|COM[1-9]|CON|LPT[1-9]|NUL|PRN)(?:\.|$)/iu;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function strictObject(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label}无效`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label}无效`);
  }
  const source = input as Record<string, unknown>;
  if (Object.keys(source).some(key => UNSAFE_OBJECT_KEYS.has(key))) {
    throw new Error(`${label}无效`);
  }
  return source;
}

function assertExactFields(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  if (Object.keys(source).some(key => !allowed.has(key))) {
    throw new Error(`${label}包含未知字段`);
  }
}

function boundedText(
  input: unknown,
  label: string,
  maximumBytes: number,
  options: { allowControl?: boolean; preserveWhitespace?: boolean } = {},
): string {
  if (typeof input !== 'string') throw new Error(`${label}无效`);
  const value = options.preserveWhitespace ? input : input.trim();
  if (!value || utf8Length(value) > maximumBytes || value.includes('\u0000')) {
    throw new Error(`${label}无效`);
  }
  if (!options.allowControl && Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  })) {
    throw new Error(`${label}无效`);
  }
  return value;
}

function normalizeIdentifier(input: unknown, label: string): string {
  const value = boundedText(input, label, 128);
  if (!SHELL_ID_PATTERN.test(value)) throw new Error(`${label}无效`);
  return value;
}

export function normalizeAgentShellLogicalPath(input: unknown): string {
  const value = boundedText(input, 'Agent Shell 逻辑路径', AGENT_SHELL_MAX_CWD_BYTES, {
    preserveWhitespace: true,
  });
  if (
    value.startsWith('/')
    || value.startsWith('\\')
    || value.includes('\\')
    || /^[A-Za-z]:/u.test(value)
  ) {
    throw new Error('Agent Shell 逻辑路径越界');
  }
  const segments = value.split('/');
  if (
    segments.length === 0
    || segments.some(segment => (
      !segment
      || segment === '.'
      || segment === '..'
      || WINDOWS_FORBIDDEN_PATH_CHARACTER_PATTERN.test(segment)
      || /[. ]$/u.test(segment)
      || WINDOWS_RESERVED_PATH_SEGMENT_PATTERN.test(segment)
    ))
    || !SHELL_WORKSPACE_ROOTS.has(segments[0])
  ) {
    throw new Error('Agent Shell 逻辑路径越界');
  }
  return segments.join('/');
}

function normalizeTimeout(input: unknown): number {
  if (input === undefined) return AGENT_SHELL_DEFAULT_TIMEOUT_MS;
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) {
    throw new Error('Agent Shell timeout 无效');
  }
  return Math.min(input, AGENT_SHELL_MAX_TIMEOUT_MS);
}

function normalizeEnvironment(input: unknown): Readonly<Record<string, string>> {
  if (input === undefined) return Object.freeze({});
  const source = strictObject(input, 'Agent Shell 环境变量');
  const entries = Object.entries(source);
  if (entries.length > AGENT_SHELL_MAX_ENVIRONMENT_ENTRIES) {
    throw new Error('Agent Shell 环境变量过多');
  }
  const caseInsensitiveNames = new Set<string>();
  let totalBytes = 0;
  const normalized = entries.map(([name, rawValue]) => {
    if (
      name.length > 64
      || !ENVIRONMENT_NAME_PATTERN.test(name)
      || UNSAFE_OBJECT_KEYS.has(name)
      || typeof rawValue !== 'string'
      || rawValue.includes('\u0000')
      || utf8Length(rawValue) > 2_048
    ) {
      throw new Error('Agent Shell 环境变量无效');
    }
    const foldedName = name.toUpperCase();
    if (
      FORBIDDEN_ENVIRONMENT_NAMES.has(foldedName)
      || AGENT_SHELL_FORBIDDEN_ENVIRONMENT_PREFIXES.some(
        prefix => foldedName.startsWith(prefix),
      )
      || SENSITIVE_ENVIRONMENT_NAME_PATTERN.test(foldedName)
    ) {
      throw new Error('Agent Shell 环境变量禁止覆盖');
    }
    if (caseInsensitiveNames.has(foldedName)) {
      throw new Error('Agent Shell 环境变量重复');
    }
    caseInsensitiveNames.add(foldedName);
    totalBytes += utf8Length(name) + utf8Length(rawValue);
    return [name, rawValue] as const;
  }).sort(([left], [right]) => left.localeCompare(right));
  if (totalBytes > AGENT_SHELL_MAX_ENVIRONMENT_BYTES) {
    throw new Error('Agent Shell 环境变量总大小超限');
  }
  return Object.freeze(Object.fromEntries(normalized));
}

export function normalizeAgentShellRunInputV1(input: unknown): AgentShellRunInputV1 {
  const source = strictObject(input, 'Agent Shell 输入');
  assertExactFields(source, SHELL_RUN_INPUT_FIELDS, 'Agent Shell 输入');
  const command = boundedText(
    source.command,
    'Agent Shell command',
    AGENT_SHELL_MAX_COMMAND_BYTES,
    { allowControl: true, preserveWhitespace: true },
  );
  if (!command.trim()) throw new Error('Agent Shell command 无效');
  const providerId = source.providerId === undefined
    ? undefined
    : normalizeIdentifier(source.providerId, 'Agent Shell Provider ID');
  return Object.freeze({
    command,
    cwd: normalizeAgentShellLogicalPath(source.cwd ?? AGENT_SHELL_DEFAULT_CWD),
    env: normalizeEnvironment(source.env),
    ...(providerId ? { providerId } : {}),
    timeoutMs: normalizeTimeout(source.timeoutMs),
  });
}

function normalizeHash(input: unknown, label: string, pattern: RegExp): string {
  const value = boundedText(input, label, 80);
  if (!pattern.test(value)) throw new Error(`${label}无效`);
  return value;
}

function normalizeRisk(input: unknown): AgentShellRisk {
  if (!SHELL_RISKS.has(input as AgentShellRisk)) throw new Error('Agent Shell 风险等级无效');
  return input as AgentShellRisk;
}

function normalizeFacetList(input: unknown, label: string): readonly AgentShellRiskFacet[] {
  if (!Array.isArray(input) || input.length > 32) throw new Error(`${label}无效`);
  const seen = new Set<AgentShellRiskFacet>();
  const values = input.map((item) => {
    if (!SHELL_RISK_FACETS.has(item as AgentShellRiskFacet) || seen.has(item as AgentShellRiskFacet)) {
      throw new Error(`${label}无效`);
    }
    seen.add(item as AgentShellRiskFacet);
    return item as AgentShellRiskFacet;
  });
  return Object.freeze(values);
}

function normalizeBoundedTextList(
  input: unknown,
  label: string,
  maximumItems: number,
  maximumItemBytes: number,
): readonly string[] {
  if (!Array.isArray(input) || input.length > maximumItems) throw new Error(`${label}无效`);
  return Object.freeze(input.map(item => boundedText(item, label, maximumItemBytes)));
}

function normalizePreparedAssessment(input: unknown): AgentShellPreparedAssessment {
  const source = strictObject(input, 'Agent Shell 分析结果');
  assertExactFields(source, ASSESSMENT_FIELDS, 'Agent Shell 分析结果');
  if (!Array.isArray(source.operations) || source.operations.length > 128) {
    throw new Error('Agent Shell 原子操作无效');
  }
  const operations = Object.freeze(source.operations.map((operation) => {
    const operationSource = strictObject(operation, 'Agent Shell 原子操作');
    assertExactFields(operationSource, OPERATION_FIELDS, 'Agent Shell 原子操作');
    return Object.freeze({
      argvPrefix: normalizeBoundedTextList(
        operationSource.argvPrefix,
        'Agent Shell 参数前缀',
        32,
        1_024,
      ),
      effects: normalizeFacetList(operationSource.effects, 'Agent Shell 操作影响'),
      executable: boundedText(operationSource.executable, 'Agent Shell 可执行项', 1_024),
    });
  }));
  if (typeof source.persistentRuleEligible !== 'boolean') {
    throw new Error('Agent Shell 规则资格无效');
  }
  return Object.freeze({
    facets: normalizeFacetList(source.facets, 'Agent Shell 风险分面'),
    operations,
    persistentRuleEligible: source.persistentRuleEligible,
    risk: normalizeRisk(source.risk),
    unresolved: normalizeBoundedTextList(
      source.unresolved,
      'Agent Shell 未解析项',
      64,
      512,
    ),
  });
}

function normalizePreparedEnvironment(input: unknown): AgentShellPreparedActionPublicV1['environment'] {
  if (!Array.isArray(input) || input.length > AGENT_SHELL_MAX_ENVIRONMENT_ENTRIES) {
    throw new Error('Agent Shell 审批环境无效');
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  const environment = input.map((entry) => {
    const source = strictObject(entry, 'Agent Shell 审批环境');
    assertExactFields(source, ENVIRONMENT_ENTRY_FIELDS, 'Agent Shell 审批环境');
    if (typeof source.name !== 'string') throw new Error('Agent Shell 审批环境无效');
    const normalized = normalizeEnvironment({ [source.name]: source.value });
    const [name, value] = Object.entries(normalized)[0] || [];
    if (!name || value === undefined || seen.has(name.toUpperCase())) {
      throw new Error('Agent Shell 审批环境无效');
    }
    seen.add(name.toUpperCase());
    totalBytes += utf8Length(name) + utf8Length(value);
    return Object.freeze({ name, value });
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (totalBytes > AGENT_SHELL_MAX_ENVIRONMENT_BYTES) {
    throw new Error('Agent Shell 审批环境总大小超限');
  }
  return Object.freeze(environment);
}

function normalizeDataScope(input: unknown): AgentShellPreparedActionPublicV1['dataScope'] {
  const source = strictObject(input, 'Agent Shell 数据范围');
  assertExactFields(source, DATA_SCOPE_FIELDS, 'Agent Shell 数据范围');
  if (!Array.isArray(source.stagedInputs) || source.stagedInputs.length > 256) {
    throw new Error('Agent Shell 暂存输入无效');
  }
  if (typeof source.unresolvedWorkspaceRead !== 'boolean') {
    throw new Error('Agent Shell 数据范围无效');
  }
  const paths = new Set<string>();
  const stagedInputs = Object.freeze(source.stagedInputs.map((item) => {
    const staged = strictObject(item, 'Agent Shell 暂存输入');
    assertExactFields(staged, STAGED_INPUT_FIELDS, 'Agent Shell 暂存输入');
    const logicalPath = normalizeAgentShellLogicalPath(staged.logicalPath);
    if (paths.has(logicalPath)) throw new Error('Agent Shell 暂存输入重复');
    paths.add(logicalPath);
    if (staged.sourceKind !== 'library' && staged.sourceKind !== 'local-picker') {
      throw new Error('Agent Shell 暂存来源无效');
    }
    return Object.freeze({
      contentHash: normalizeHash(staged.contentHash, 'Agent Shell 内容 hash', SHA256_PATTERN),
      displayName: boundedText(staged.displayName, 'Agent Shell 暂存文件名', 1_024),
      logicalPath,
      sourceKind: staged.sourceKind,
    });
  }).sort((left, right) => left.logicalPath.localeCompare(right.logicalPath)));
  return Object.freeze({
    stagedInputs,
    unresolvedWorkspaceRead: source.unresolvedWorkspaceRead,
  });
}

export function normalizeAgentShellPreparedActionPublicV1(
  input: unknown,
): AgentShellPreparedActionPublicV1 {
  const source = strictObject(input, 'Agent Shell prepared action');
  if (
    source.kind !== AGENT_SHELL_RUN_TOOL_NAME
    || source.version !== AGENT_SHELL_PREPARED_ACTION_VERSION
  ) {
    throw new Error('Agent prepared action 类型或版本不受支持');
  }
  assertExactFields(source, SHELL_PREPARED_ACTION_FIELDS, 'Agent Shell prepared action');

  const provider = strictObject(source.provider, 'Agent Shell Provider');
  assertExactFields(provider, PROVIDER_FIELDS, 'Agent Shell Provider');
  if (!SHELL_DIALECTS.has(provider.dialect as AgentShellDialect)) {
    throw new Error('Agent Shell Provider 方言无效');
  }

  const cwd = strictObject(source.cwd, 'Agent Shell cwd');
  assertExactFields(cwd, CWD_FIELDS, 'Agent Shell cwd');
  if (cwd.kind !== 'run-workspace') throw new Error('Agent Shell cwd 类型无效');

  const aiDestination = strictObject(source.aiDestination, 'Agent Shell AI 目的地');
  assertExactFields(aiDestination, AI_DESTINATION_FIELDS, 'Agent Shell AI 目的地');

  const command = boundedText(
    source.command,
    'Agent Shell command',
    AGENT_SHELL_MAX_COMMAND_BYTES,
    { allowControl: true, preserveWhitespace: true },
  );
  if (!command.trim()) throw new Error('Agent Shell command 无效');

  return Object.freeze({
    aiDestination: Object.freeze({
      identityHash: normalizeHash(
        aiDestination.identityHash,
        'Agent Shell AI 目的地 identity',
        VERSIONED_IDENTITY_PATTERN,
      ),
      profileLabel: boundedText(aiDestination.profileLabel, 'Agent Shell AI 配置', 512),
      providerType: boundedText(aiDestination.providerType, 'Agent Shell AI Provider', 128),
    }),
    assessment: normalizePreparedAssessment(source.assessment),
    command,
    commandHash: normalizeHash(source.commandHash, 'Agent Shell command hash', SHA256_PATTERN),
    cwd: Object.freeze({
      kind: 'run-workspace',
      path: normalizeAgentShellLogicalPath(cwd.path),
    }),
    dataScope: normalizeDataScope(source.dataScope),
    environment: normalizePreparedEnvironment(source.environment),
    kind: AGENT_SHELL_RUN_TOOL_NAME,
    provider: Object.freeze({
      dialect: provider.dialect as AgentShellDialect,
      id: normalizeIdentifier(provider.id, 'Agent Shell Provider ID'),
      version: boundedText(provider.version, 'Agent Shell Provider version', 128),
    }),
    timeoutMs: normalizeTimeout(source.timeoutMs),
    version: AGENT_SHELL_PREPARED_ACTION_VERSION,
  });
}
