import crypto from 'node:crypto';

import type {
  AgentToolExecutionContext,
  AgentToolKind,
  AgentToolRegistrySnapshot,
  AgentToolSnapshot,
  AgentToolValidation,
} from './agent-tool-registry';
import type {
  AgentSkillActivationEnvelopeV1,
  AgentSkillDefinitionV1,
  AgentSkillSnapshotV1,
  AgentSkillSummaryV1,
} from './skills/agent-skill.types';
import { getAgentSkillInstructionsHash } from './skills/agent-skill-registry';
import type { AgentToolResult } from '@/shared/agent/agent.types';

/**
 * Tool classification is part of the built-in Tool registration contract.
 * The registry owns the value; a Run snapshot only consumes it.
 */
export type AgentRunCapabilityToolKind = AgentToolKind;

const SNAPSHOT_VERSION = 1;
const INVISIBLE_TOOL_MESSAGE = 'Agent Tool 当前未被 Run capability snapshot 暴露';
const UNKNOWN_SKILL_MESSAGE = 'Agent Skill 不存在';

function normalizeId(value: unknown): string {
  return String(value || '').trim();
}

function toolKind(tool: AgentToolSnapshot): AgentRunCapabilityToolKind {
  return tool.kind;
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(',')}}`;
  }
  return 'null';
}

function createSnapshotIdentity(
  tools: readonly AgentToolSnapshot[],
  skills: readonly AgentSkillDefinitionV1[],
): string {
  const normalizedTools = tools
    .map(tool => ({
      kind: toolKind(tool),
      name: tool.name,
      registrationId: tool.registrationId,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const normalizedSkills = skills
    .map(skill => ({
      id: skill.id,
      instructionsHash: getAgentSkillInstructionsHash(skill),
      toolAllowlist: [...skill.toolAllowlist],
      version: skill.version,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const payload = stableSerialize({
    snapshotVersion: SNAPSHOT_VERSION,
    skills: normalizedSkills,
    tools: normalizedTools,
  });
  return `v${SNAPSHOT_VERSION}:${crypto.createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export interface AgentRunCapabilitySnapshotOptions {
  readonly skillSnapshot: AgentSkillSnapshotV1;
  readonly toolSnapshot: AgentToolRegistrySnapshot;
}

export interface AgentRunCapabilitySnapshot {
  /** Immutable source snapshots captured at the same Run boundary. */
  readonly skillSnapshot: AgentSkillSnapshotV1;
  readonly toolSnapshot: AgentToolRegistrySnapshot;
  /** Stable identity for audit and stale-run diagnostics. */
  readonly identity: string;
  readonly toolRevision: number;
  readonly skillRevision: number;
  /** All registered Tools, before an optional Skill allowlist is applied. */
  readonly tools: readonly AgentToolSnapshot[];
  readonly skills: readonly AgentSkillDefinitionV1[];
  readonly getToolKind: (name: string) => AgentRunCapabilityToolKind | null;
  /** Returns null for an unknown or currently hidden Tool. */
  readonly getTool: (
    name: string,
    activeSkillId?: string | null,
  ) => AgentToolSnapshot | null;
  readonly getSkill: (skillId: string) => AgentSkillDefinitionV1 | null;
  readonly getSkillSummary: (skillId: string) => AgentSkillSummaryV1 | null;
  readonly getSkillActivationEnvelope: (
    skillId: string,
  ) => AgentSkillActivationEnvelopeV1 | null;
  readonly listTools: (activeSkillId?: string | null) => readonly AgentToolSnapshot[];
  readonly listBusinessTools: (activeSkillId?: string | null) => readonly AgentToolSnapshot[];
  readonly listControlTools: (activeSkillId?: string | null) => readonly AgentToolSnapshot[];
  readonly isToolVisible: (name: string, activeSkillId?: string | null) => boolean;
  readonly validateInput: (
    name: string,
    input: unknown,
    activeSkillId?: string | null,
    expectedRegistrationId?: string,
  ) => AgentToolValidation;
  readonly execute: (
    name: string,
    input: unknown,
    context: AgentToolExecutionContext,
    activeSkillId?: string | null,
    expectedRegistrationId?: string,
  ) => Promise<AgentToolResult>;
}

/**
 * Compose the two independent registries into one immutable Run view.
 *
 * A Skill can only reduce the business Tool set. Control Tools remain visible
 * because they are protocol capabilities owned by the application, not by a
 * Skill definition. The returned methods close over the captured maps and do
 * not consult either live registry.
 */
export function createAgentRunCapabilitySnapshot(
  options: AgentRunCapabilitySnapshotOptions,
): AgentRunCapabilitySnapshot {
  if (!options || !options.toolSnapshot || !options.skillSnapshot) {
    throw new Error('Agent Run capability snapshot 需要 Tool 与 Skill 快照');
  }

  const sourceTools = Object.freeze([...options.toolSnapshot.tools]);
  const sourceSkills = Object.freeze([...options.skillSnapshot.skills]);
  const skillById = new Map(sourceSkills.map(skill => [skill.id, skill]));
  const kindByName = new Map(sourceTools.map(tool => [tool.name, toolKind(tool)]));

  function resolveSkill(skillId: string | null | undefined): AgentSkillDefinitionV1 | null {
    const normalized = normalizeId(skillId);
    if (!normalized) return null;
    return skillById.get(normalized) || null;
  }

  function visibleTools(activeSkillId?: string | null): readonly AgentToolSnapshot[] {
    const skill = resolveSkill(activeSkillId);
    if (normalizeId(activeSkillId) && !skill) {
      throw new Error(`${UNKNOWN_SKILL_MESSAGE}：${normalizeId(activeSkillId)}`);
    }
    if (!skill) return sourceTools;
    const allowlist = new Set(skill.toolAllowlist);
    // Preserve registry order for stable Provider schemas; only business Tools
    // are filtered. Control Tools are never granted or removed by a Skill.
    return Object.freeze(sourceTools.filter(tool => (
      toolKind(tool) === 'control' || allowlist.has(tool.name)
    )));
  }

  function visibleTool(name: string, activeSkillId?: string | null): AgentToolSnapshot | null {
    const normalized = normalizeId(name);
    if (!normalized) return null;
    const visible = visibleTools(activeSkillId);
    return visible.find(tool => tool.name === normalized) || null;
  }

  function requireVisibleTool(name: string, activeSkillId?: string | null): AgentToolSnapshot {
    const tool = visibleTool(name, activeSkillId);
    if (!tool) throw new Error(`${INVISIBLE_TOOL_MESSAGE}：${normalizeId(name)}`);
    return tool;
  }

  const snapshot: AgentRunCapabilitySnapshot = {
    execute: (name, input, context, activeSkillId, expectedRegistrationId) => {
      const tool = requireVisibleTool(name, activeSkillId);
      return options.toolSnapshot.execute(
        tool.name,
        input,
        context,
        expectedRegistrationId || tool.registrationId,
      );
    },
    getSkill: skillId => skillById.get(normalizeId(skillId)) || null,
    getSkillActivationEnvelope: skillId => (
      options.skillSnapshot.getActivationEnvelope(normalizeId(skillId))
    ),
    getSkillSummary: skillId => options.skillSnapshot.getSummary(normalizeId(skillId)),
    getTool: (name, activeSkillId) => visibleTool(name, activeSkillId),
    getToolKind: name => kindByName.get(normalizeId(name)) || null,
    identity: createSnapshotIdentity(sourceTools, sourceSkills),
    isToolVisible: (name, activeSkillId) => visibleTool(name, activeSkillId) !== null,
    listBusinessTools: activeSkillId => Object.freeze(
      visibleTools(activeSkillId).filter(tool => toolKind(tool) === 'business'),
    ),
    listControlTools: activeSkillId => Object.freeze(
      visibleTools(activeSkillId).filter(tool => toolKind(tool) === 'control'),
    ),
    listTools: activeSkillId => visibleTools(activeSkillId),
    skillRevision: options.skillSnapshot.catalogRevision,
    skills: sourceSkills,
    skillSnapshot: options.skillSnapshot,
    toolRevision: options.toolSnapshot.revision,
    tools: sourceTools,
    toolSnapshot: options.toolSnapshot,
    validateInput: (name, input, activeSkillId, expectedRegistrationId) => {
      const tool = requireVisibleTool(name, activeSkillId);
      return options.toolSnapshot.validateInput(
        tool.name,
        input,
        expectedRegistrationId || tool.registrationId,
      );
    },
  };
  return Object.freeze(snapshot);
}
