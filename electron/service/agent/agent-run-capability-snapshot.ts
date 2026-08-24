import crypto from 'node:crypto';

import type { AgentToolResult } from '@/shared/agent/agent.types';
import { createAgentCapabilitySnapshot } from './capabilities/agent-capability-registry';
import type { AgentCapabilitySnapshot } from './capabilities/agent-capability.types';
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
import {
  createAgentSkillActivationEnvelope,
  getAgentSkillInstructionsHash,
} from './skills/agent-skill-registry';

export type AgentRunCapabilityToolKind = AgentToolKind;
export type AgentToolReadiness = 'ready' | 'degraded' | 'blocked';
export type AgentSkillReadiness = 'ready' | 'degraded' | 'blocked';

export interface AgentToolReadinessSnapshot {
  readonly reasonCodes: readonly string[];
  readonly state: AgentToolReadiness;
}

export interface AgentSkillReadinessSnapshot {
  readonly reasonCodes: readonly string[];
  readonly state: AgentSkillReadiness;
}

const SNAPSHOT_VERSION = 2;
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

function createSnapshotIdentity(input: {
  capabilitySnapshot: AgentCapabilitySnapshot;
  omittedSkillCount: number;
  skillReadiness: ReadonlyMap<string, AgentSkillReadinessSnapshot>;
  skillRevision: number;
  skills: readonly AgentSkillDefinitionV1[];
  toolReadiness: ReadonlyMap<string, AgentToolReadinessSnapshot>;
  toolRevision: number;
  tools: readonly AgentToolSnapshot[];
}): string {
  const normalizedTools = input.tools
    .map(tool => ({
      availability: tool.availability,
      kind: toolKind(tool),
      name: tool.name,
      readiness: input.toolReadiness.get(tool.name),
      registrationId: tool.registrationId,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const normalizedSkills = input.skills
    .map(skill => ({
      description: skill.description,
      id: skill.id,
      instructionsHash: getAgentSkillInstructionsHash(skill),
      optionalTools: [...skill.optionalTools],
      readiness: input.skillReadiness.get(skill.id),
      requiredTools: [...skill.requiredTools],
      toolAllowlist: [...skill.toolAllowlist],
      version: skill.version,
      whenToUse: skill.whenToUse,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const payload = stableSerialize({
    capabilityIdentity: input.capabilitySnapshot.identity,
    omittedSkillCount: input.omittedSkillCount,
    skillRevision: input.skillRevision,
    skills: normalizedSkills,
    snapshotVersion: SNAPSHOT_VERSION,
    toolRevision: input.toolRevision,
    tools: normalizedTools,
  });
  return `v${SNAPSHOT_VERSION}:${crypto.createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

function freezeReadiness<T extends AgentToolReadiness | AgentSkillReadiness>(
  state: T,
  reasonCodes: Iterable<string>,
): { readonly reasonCodes: readonly string[]; readonly state: T } {
  return Object.freeze({
    reasonCodes: Object.freeze(Array.from(new Set(reasonCodes)).sort()),
    state,
  });
}

function createEffectiveSkillSnapshot(
  source: AgentSkillSnapshotV1,
  effectiveSkills: readonly AgentSkillDefinitionV1[],
): AgentSkillSnapshotV1 {
  const skills = Object.freeze([...effectiveSkills]);
  const byId = new Map(skills.map(skill => [skill.id, skill]));
  const summaries = Object.freeze(skills.map((skill) => {
    const summary = source.getSummary(skill.id);
    if (!summary) throw new Error(`Agent Skill 摘要不存在：${skill.id}`);
    return summary;
  }));
  const summaryById = new Map(summaries.map(summary => [summary.id, summary]));
  const activationById = new Map(skills.map(skill => [
    skill.id,
    source.getActivationEnvelope(skill.id) || createAgentSkillActivationEnvelope(skill),
  ]));
  return Object.freeze({
    catalogRevision: source.catalogRevision,
    catalogTruncated: source.catalogTruncated,
    get: (skillId: string) => byId.get(normalizeId(skillId)) || null,
    getActivationEnvelope: (skillId: string) => activationById.get(normalizeId(skillId)) || null,
    getSummary: (skillId: string) => summaryById.get(normalizeId(skillId)) || null,
    list: () => skills,
    listSummaries: () => summaries,
    omittedSkillCount: source.omittedSkillCount,
    skills,
  });
}

export interface AgentRunCapabilitySnapshotOptions {
  readonly capabilitySnapshot?: AgentCapabilitySnapshot;
  readonly skillSnapshot: AgentSkillSnapshotV1;
  readonly toolSnapshot: AgentToolRegistrySnapshot;
}

export interface AgentRunCapabilitySnapshot {
  readonly capabilitySnapshot: AgentCapabilitySnapshot;
  readonly skillSnapshot: AgentSkillSnapshotV1;
  readonly toolSnapshot: AgentToolRegistrySnapshot;
  readonly identity: string;
  readonly toolRevision: number;
  readonly skillRevision: number;
  readonly tools: readonly AgentToolSnapshot[];
  readonly skills: readonly AgentSkillDefinitionV1[];
  readonly getToolKind: (name: string) => AgentRunCapabilityToolKind | null;
  readonly getToolReadiness: (name: string) => AgentToolReadinessSnapshot | null;
  readonly getSkillReadiness: (skillId: string) => AgentSkillReadinessSnapshot | null;
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
 * Compose Tool, Skill, and environment snapshots into one immutable Run view.
 * All returned methods close over captured maps and never consult a live registry.
 */
export function createAgentRunCapabilitySnapshot(
  options: AgentRunCapabilitySnapshotOptions,
): AgentRunCapabilitySnapshot {
  if (!options || !options.toolSnapshot || !options.skillSnapshot) {
    throw new Error('Agent Run capability snapshot 需要 Tool 与 Skill 快照');
  }

  const capabilitySnapshot = options.capabilitySnapshot || createAgentCapabilitySnapshot();
  const registeredTools = Object.freeze([...options.toolSnapshot.tools]);
  const sourceSkills = Object.freeze([...options.skillSnapshot.skills]);
  const kindByName = new Map(registeredTools.map(tool => [tool.name, toolKind(tool)]));
  const toolReadiness = new Map<string, AgentToolReadinessSnapshot>();

  for (const tool of registeredTools) {
    if (tool.kind === 'control') {
      toolReadiness.set(tool.name, freezeReadiness('ready', []));
      continue;
    }
    const requiredReasons: string[] = [];
    for (const capabilityId of tool.availability.requiredCapabilities) {
      const capability = capabilitySnapshot.get(capabilityId);
      if (!capability) {
        throw new Error(`Agent Tool ${tool.name} 缺少 Capability 快照：${capabilityId}`);
      }
      if (capability.state !== 'available') {
        requiredReasons.push(capability.reasonCode || 'capability.required_unknown');
      }
    }
    if (requiredReasons.length > 0) {
      toolReadiness.set(tool.name, freezeReadiness('blocked', requiredReasons));
      continue;
    }
    const optionalReasons: string[] = [];
    for (const capabilityId of tool.availability.optionalCapabilities) {
      const capability = capabilitySnapshot.get(capabilityId);
      if (!capability) {
        throw new Error(`Agent Tool ${tool.name} 缺少 Capability 快照：${capabilityId}`);
      }
      if (capability.state !== 'available') {
        optionalReasons.push(capability.reasonCode || 'capability.optional_unknown');
      }
    }
    toolReadiness.set(tool.name, optionalReasons.length > 0
      ? freezeReadiness('degraded', optionalReasons)
      : freezeReadiness('ready', []));
  }

  const effectiveTools = Object.freeze(registeredTools.filter(tool => (
    toolReadiness.get(tool.name)?.state !== 'blocked'
  )));

  for (const skill of sourceSkills) {
    for (const toolName of skill.toolAllowlist) {
      const referencedTool = options.toolSnapshot.get(toolName);
      if (!referencedTool) {
        throw new Error(`Agent Skill ${skill.id} 引用了 Run 快照中不存在的 Tool：${toolName}`);
      }
      if (referencedTool.kind !== 'business') {
        throw new Error(`Agent Skill ${skill.id} 不能把控制 Tool 加入 allowlist：${toolName}`);
      }
    }
  }

  const skillReadiness = new Map<string, AgentSkillReadinessSnapshot>();
  for (const skill of sourceSkills) {
    const requiredReasons: string[] = [];
    let degraded = false;
    const degradedReasons: string[] = [];
    for (const toolName of skill.requiredTools) {
      const readiness = toolReadiness.get(toolName);
      if (!readiness || readiness.state === 'blocked') {
        requiredReasons.push(...(readiness?.reasonCodes || ['capability.required_tool_blocked']));
      } else if (readiness.state === 'degraded') {
        degraded = true;
        degradedReasons.push(...readiness.reasonCodes);
      }
    }
    if (requiredReasons.length > 0) {
      skillReadiness.set(skill.id, freezeReadiness('blocked', requiredReasons));
      continue;
    }
    for (const toolName of skill.optionalTools) {
      const readiness = toolReadiness.get(toolName);
      if (!readiness || readiness.state !== 'ready') {
        degraded = true;
        degradedReasons.push(...(readiness?.reasonCodes || ['capability.optional_tool_blocked']));
      }
    }
    skillReadiness.set(skill.id, degraded
      ? freezeReadiness('degraded', degradedReasons)
      : freezeReadiness('ready', []));
  }

  const effectiveSkills = Object.freeze(sourceSkills.filter(skill => (
    skillReadiness.get(skill.id)?.state !== 'blocked'
  )));
  const effectiveSkillSnapshot = createEffectiveSkillSnapshot(
    options.skillSnapshot,
    effectiveSkills,
  );
  const skillById = new Map(effectiveSkills.map(skill => [skill.id, skill]));

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
    if (!skill) return effectiveTools;
    const allowlist = new Set(skill.toolAllowlist);
    return Object.freeze(effectiveTools.filter(tool => (
      toolKind(tool) === 'control' || allowlist.has(tool.name)
    )));
  }

  function visibleTool(name: string, activeSkillId?: string | null): AgentToolSnapshot | null {
    const normalized = normalizeId(name);
    if (!normalized) return null;
    return visibleTools(activeSkillId).find(tool => tool.name === normalized) || null;
  }

  function requireVisibleTool(name: string, activeSkillId?: string | null): AgentToolSnapshot {
    const tool = visibleTool(name, activeSkillId);
    if (!tool) throw new Error(`${INVISIBLE_TOOL_MESSAGE}：${normalizeId(name)}`);
    return tool;
  }

  const snapshot: AgentRunCapabilitySnapshot = {
    capabilitySnapshot,
    execute: (name, input, context, activeSkillId, expectedRegistrationId) => {
      const tool = requireVisibleTool(name, activeSkillId);
      return options.toolSnapshot.execute(
        tool.name,
        input,
        context,
        expectedRegistrationId ?? tool.registrationId,
      );
    },
    getSkill: skillId => skillById.get(normalizeId(skillId)) || null,
    getSkillActivationEnvelope: skillId => (
      effectiveSkillSnapshot.getActivationEnvelope(normalizeId(skillId))
    ),
    getSkillReadiness: skillId => skillReadiness.get(normalizeId(skillId)) || null,
    getSkillSummary: skillId => effectiveSkillSnapshot.getSummary(normalizeId(skillId)),
    getTool: (name, activeSkillId) => visibleTool(name, activeSkillId),
    getToolKind: name => kindByName.get(normalizeId(name)) || null,
    getToolReadiness: name => toolReadiness.get(normalizeId(name)) || null,
    identity: createSnapshotIdentity({
      capabilitySnapshot,
      omittedSkillCount: options.skillSnapshot.omittedSkillCount,
      skillReadiness,
      skillRevision: options.skillSnapshot.catalogRevision,
      skills: sourceSkills,
      toolReadiness,
      toolRevision: options.toolSnapshot.revision,
      tools: registeredTools,
    }),
    isToolVisible: (name, activeSkillId) => visibleTool(name, activeSkillId) !== null,
    listBusinessTools: activeSkillId => Object.freeze(
      visibleTools(activeSkillId).filter(tool => toolKind(tool) === 'business'),
    ),
    listControlTools: activeSkillId => Object.freeze(
      visibleTools(activeSkillId).filter(tool => toolKind(tool) === 'control'),
    ),
    listTools: activeSkillId => visibleTools(activeSkillId),
    skillRevision: options.skillSnapshot.catalogRevision,
    skills: effectiveSkills,
    skillSnapshot: effectiveSkillSnapshot,
    toolRevision: options.toolSnapshot.revision,
    tools: effectiveTools,
    toolSnapshot: options.toolSnapshot,
    validateInput: (name, input, activeSkillId, expectedRegistrationId) => {
      const tool = requireVisibleTool(name, activeSkillId);
      return options.toolSnapshot.validateInput(
        tool.name,
        input,
        expectedRegistrationId ?? tool.registrationId,
      );
    },
  };
  return Object.freeze(snapshot);
}
