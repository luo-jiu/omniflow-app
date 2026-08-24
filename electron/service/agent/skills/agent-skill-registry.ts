import crypto from 'node:crypto';

import type {
  AgentSkillActivationEnvelopeV1,
  AgentSkillDefinitionV1,
  AgentSkillRegistryOptionsV1,
  AgentSkillSnapshotOptionsV1,
  AgentSkillSnapshotV1,
  AgentSkillSummaryV1,
} from './agent-skill.types';
import { AGENT_SKILL_SOURCE_V1 } from './agent-skill.types';

export const AGENT_SKILL_MAX_ID_LENGTH = 128;
export const AGENT_SKILL_MAX_VERSION_LENGTH = 64;
export const AGENT_SKILL_MAX_DESCRIPTION_LENGTH = 512;
export const AGENT_SKILL_MAX_WHEN_TO_USE_LENGTH = 512;
export const AGENT_SKILL_MAX_INSTRUCTIONS_LENGTH = 48_000;
export const AGENT_SKILL_DEFAULT_MAX_SUMMARY_TOKENS = 256;
export const AGENT_SKILL_DEFAULT_MAX_ACTIVATION_TOKENS = 1_024;
export const AGENT_SKILL_DEFAULT_MAX_CATALOG_TOKENS = 2_048;

const ALLOWED_DEFINITION_KEYS = new Set([
  'description',
  'id',
  'instructions',
  'source',
  'toolAllowlist',
  'version',
  'whenToUse',
]);
const SKILL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u;
// Tabs and line breaks are useful in Skill instructions; other C0 controls
// and DEL are never meaningful in a serialized provider prompt.
function hasDisallowedControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.codePointAt(0) || 0;
    return (code >= 0 && code <= 8)
      || code === 11
      || code === 12
      || (code >= 14 && code <= 31)
      || code === 127;
  });
}

export const AGENT_SKILL_INVALID_DEFINITION_MESSAGE = 'Agent Skill 定义无效';

type TokenEstimator = (serialized: string) => number;

function defaultEstimateTokens(serialized: string): number {
  // This is only a conservative registration fallback.  Production callers
  // should pass the same provider-aware estimator used by the Agent budget
  // preflight.
  const characters = Array.from(serialized).length;
  return Math.ceil(characters / 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function rejectAccessorOrSymbolProperties(value: Record<string, unknown>): void {
  if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')) {
    throw new Error(AGENT_SKILL_INVALID_DEFINITION_MESSAGE);
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new Error(AGENT_SKILL_INVALID_DEFINITION_MESSAGE);
    }
  }
}

function normalizeText(
  value: unknown,
  field: string,
  maximumLength: number,
  options: { collapseWhitespace?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    throw new Error(`${field}必须是文本`);
  }
  const normalized = options.collapseWhitespace
    ? value.replace(/\s+/gu, ' ').trim()
    : value.trim();
  if (!normalized) throw new Error(`${field}不能为空`);
  if (hasDisallowedControlCharacters(normalized)) {
    throw new Error(`${field}包含不允许的控制字符`);
  }
  if (Array.from(normalized).length > maximumLength) {
    throw new Error(`${field}不能超过 ${maximumLength} 个字符`);
  }
  return normalized;
}

function assertAllowedKeys(input: Record<string, unknown>): void {
  rejectAccessorOrSymbolProperties(input);
  const unknownKey = Object.keys(input).find(key => !ALLOWED_DEFINITION_KEYS.has(key));
  if (unknownKey) {
    throw new Error(`${AGENT_SKILL_INVALID_DEFINITION_MESSAGE}：包含不允许的字段 ${unknownKey}`);
  }
  if (Object.keys(input).length !== ALLOWED_DEFINITION_KEYS.size) {
    throw new Error(AGENT_SKILL_INVALID_DEFINITION_MESSAGE);
  }
}

function normalizeToolAllowlist(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Agent Skill Tool allowlist 不能为空');
  }
  if (Reflect.ownKeys(value).some(key => (
    typeof key === 'symbol'
    || (typeof key === 'string' && key !== 'length' && !/^\d+$/u.test(key))
  ))) {
    throw new Error(AGENT_SKILL_INVALID_DEFINITION_MESSAGE);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) {
      throw new Error(AGENT_SKILL_INVALID_DEFINITION_MESSAGE);
    }
  }
  const seen = new Set<string>();
  const names = value.map((rawName, index) => {
    const name = normalizeText(rawName, `Agent Skill Tool 名称（第 ${index + 1} 项）`, 160, {
      collapseWhitespace: true,
    });
    if (seen.has(name)) throw new Error(`Agent Skill Tool allowlist 包含重复 Tool：${name}`);
    seen.add(name);
    return name;
  });
  return names;
}

function cloneAndFreezeDefinition(input: unknown): AgentSkillDefinitionV1 {
  if (!isPlainObject(input)) throw new Error(AGENT_SKILL_INVALID_DEFINITION_MESSAGE);
  assertAllowedKeys(input);

  const id = normalizeText(input.id, 'Agent Skill ID', AGENT_SKILL_MAX_ID_LENGTH, {
    collapseWhitespace: true,
  });
  if (!SKILL_ID_PATTERN.test(id)) {
    throw new Error('Agent Skill ID 只能包含小写字母、数字、点、短横线和下划线');
  }
  if (id.startsWith('agent.')) {
    throw new Error(`Agent Skill 不能占用控制协议名称：${id}`);
  }

  const version = normalizeText(input.version, 'Agent Skill 版本', AGENT_SKILL_MAX_VERSION_LENGTH, {
    collapseWhitespace: true,
  });
  if (!VERSION_PATTERN.test(version)) {
    throw new Error('Agent Skill 版本格式无效');
  }
  const description = normalizeText(
    input.description,
    'Agent Skill 描述',
    AGENT_SKILL_MAX_DESCRIPTION_LENGTH,
    { collapseWhitespace: true },
  );
  const whenToUse = normalizeText(
    input.whenToUse,
    'Agent Skill 适用场景',
    AGENT_SKILL_MAX_WHEN_TO_USE_LENGTH,
    { collapseWhitespace: true },
  );
  const instructions = normalizeText(
    input.instructions,
    'Agent Skill 正文',
    AGENT_SKILL_MAX_INSTRUCTIONS_LENGTH,
  );
  if (input.source !== AGENT_SKILL_SOURCE_V1) {
    throw new Error('Agent Skill 当前只支持 built-in 来源');
  }
  const toolAllowlist = normalizeToolAllowlist(input.toolAllowlist);
  return Object.freeze({
    description,
    id,
    instructions,
    source: AGENT_SKILL_SOURCE_V1,
    toolAllowlist: Object.freeze(toolAllowlist),
    version,
    whenToUse,
  });
}

function stableStringify(value: unknown): string {
  // All values reaching this helper are already primitive / frozen Skill data.
  // Sorting object keys makes the hash and budget envelope deterministic.
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function getAgentSkillInstructionsHash(
  definition: Pick<AgentSkillDefinitionV1, 'instructions'>,
): string {
  return crypto.createHash('sha256').update(definition.instructions, 'utf8').digest('hex');
}

export function createAgentSkillActivationEnvelope(
  definition: AgentSkillDefinitionV1,
): AgentSkillActivationEnvelopeV1 {
  return Object.freeze({
    instructions: definition.instructions,
    instructionsHash: getAgentSkillInstructionsHash(definition),
    skillId: definition.id,
    toolAllowlist: Object.freeze([...definition.toolAllowlist]),
    version: definition.version,
  });
}

export function serializeAgentSkillActivationEnvelope(
  envelope: AgentSkillActivationEnvelopeV1,
): string {
  return stableStringify(envelope);
}

function createSummary(definition: AgentSkillDefinitionV1): AgentSkillSummaryV1 {
  return Object.freeze({
    description: definition.description,
    id: definition.id,
    version: definition.version,
    whenToUse: definition.whenToUse,
  });
}

function sortDefinitions(
  definitions: Iterable<AgentSkillDefinitionV1>,
): AgentSkillDefinitionV1[] {
  return Array.from(definitions).sort((left, right) => (
    left.id.localeCompare(right.id)
    || left.version.localeCompare(right.version)
  ));
}

function normalizeBudget(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Agent Skill token 预算必须是正数');
  }
  return Math.floor(value);
}

function assertEstimatedBudget(
  estimator: TokenEstimator,
  serialized: string,
  maximumTokens: number,
  label: string,
): void {
  let estimated: number;
  try {
    estimated = Number(estimator(serialized));
  } catch {
    throw new Error(`${label} token 估算失败`);
  }
  if (!Number.isFinite(estimated) || estimated < 0) {
    throw new Error(`${label} token 估算结果无效`);
  }
  if (estimated > maximumTokens) {
    throw new Error(`${label}超过 token 预算：预计 ${Math.ceil(estimated)}，上限 ${maximumTokens}`);
  }
}

export function createAgentSkillRegistry(options: AgentSkillRegistryOptionsV1 = {}) {
  const skills = new Map<string, AgentSkillDefinitionV1>();
  const estimateTokens = options.estimateTokens || defaultEstimateTokens;
  const maxSummaryTokens = normalizeBudget(
    options.maxSummaryTokens,
    AGENT_SKILL_DEFAULT_MAX_SUMMARY_TOKENS,
  );
  const maxActivationTokens = normalizeBudget(
    options.maxActivationTokens,
    AGENT_SKILL_DEFAULT_MAX_ACTIVATION_TOKENS,
  );
  const configuredCatalogBudget = normalizeBudget(
    options.maxCatalogTokens,
    AGENT_SKILL_DEFAULT_MAX_CATALOG_TOKENS,
  );
  const toolValidator = options.toolExists || options.validateTool;
  let catalogRevision = 0;

  function validateToolReferences(definition: AgentSkillDefinitionV1): void {
    if (!toolValidator) return;
    for (const toolName of definition.toolAllowlist) {
      let known = false;
      try {
        known = toolValidator(toolName) === true;
      } catch {
        known = false;
      }
      if (!known) throw new Error(`Agent Skill 引用了未知 Tool：${toolName}`);
    }
  }

  function validateDefinitionBudgets(definition: AgentSkillDefinitionV1): void {
    const summary = createSummary(definition);
    assertEstimatedBudget(
      estimateTokens,
      stableStringify(summary),
      maxSummaryTokens,
      `Agent Skill 摘要（${definition.id}）`,
    );
    const envelope = createAgentSkillActivationEnvelope(definition);
    assertEstimatedBudget(
      estimateTokens,
      serializeAgentSkillActivationEnvelope(envelope),
      maxActivationTokens,
      `Agent Skill 正文（${definition.id}）`,
    );
  }

  function register(input: AgentSkillDefinitionV1): void {
    const definition = cloneAndFreezeDefinition(input);
    if (skills.has(definition.id)) {
      throw new Error(`Agent Skill 已注册：${definition.id}`);
    }
    validateToolReferences(definition);
    validateDefinitionBudgets(definition);
    skills.set(definition.id, definition);
    catalogRevision += 1;
  }

  function get(skillId: string): AgentSkillDefinitionV1 | null {
    const normalizedId = String(skillId || '').trim();
    return skills.get(normalizedId) || null;
  }

  function list(): readonly AgentSkillDefinitionV1[] {
    return Object.freeze(sortDefinitions(skills.values()));
  }

  function createRunSnapshot(
    snapshotOptions: AgentSkillSnapshotOptionsV1 = {},
  ): AgentSkillSnapshotV1 {
    const definitions = sortDefinitions(skills.values());
    const snapshotSkills = Object.freeze(definitions.map(definition => definition));
    const snapshotById = new Map(snapshotSkills.map(definition => [definition.id, definition]));
    const summaries = Object.freeze(snapshotSkills.map(createSummary));
    const summaryById = new Map(summaries.map(summary => [summary.id, summary]));
    const activationEnvelopes = new Map(
      snapshotSkills.map(definition => [definition.id, createAgentSkillActivationEnvelope(definition)]),
    );
    const catalogBudget = snapshotOptions.maxCatalogTokens === undefined
      ? configuredCatalogBudget
      : normalizeBudget(snapshotOptions.maxCatalogTokens, maxSummaryTokens);
    if (catalogBudget !== undefined) {
      assertEstimatedBudget(
        estimateTokens,
        stableStringify(summaries),
        catalogBudget,
        'Agent Skill 摘要目录',
      );
    }

    const snapshot: AgentSkillSnapshotV1 = {
      catalogRevision,
      get: (skillId: string) => snapshotById.get(String(skillId || '').trim()) || null,
      getActivationEnvelope: (skillId: string) => (
        activationEnvelopes.get(String(skillId || '').trim()) || null
      ),
      getSummary: (skillId: string) => summaryById.get(String(skillId || '').trim()) || null,
      list: () => snapshotSkills,
      listSummaries: () => summaries,
      skills: snapshotSkills,
    };
    return Object.freeze(snapshot);
  }

  return {
    createRunSnapshot,
    get,
    list,
    register,
  };
}

export type AgentSkillRegistryV1 = ReturnType<typeof createAgentSkillRegistry>;

/** Default empty registry; built-in definitions can be registered at startup. */
export const agentSkillRegistry = createAgentSkillRegistry();
