/**
 * The V1 Skill contract is deliberately data-only.  A Skill describes how to
 * compose already registered Tools; it is never an executor and must not
 * carry callbacks, IPC channels, UI values, or file references.
 */

export const AGENT_SKILL_SOURCE_V1 = 'built-in' as const;
export type AgentSkillSourceV1 = typeof AGENT_SKILL_SOURCE_V1;

export interface AgentSkillDefinitionV1 {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly toolAllowlist: readonly string[];
  readonly instructions: string;
  readonly source: AgentSkillSourceV1;
}

/** The compact projection used in the initial Skill catalog prompt. */
export interface AgentSkillSummaryV1 {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly whenToUse: string;
}

/**
 * The complete result returned by a future `skill.activate` control Tool.
 * Keeping this shape here makes the registration-time budget check use the
 * same envelope as activation-time serialization.
 */
export interface AgentSkillActivationEnvelopeV1 {
  readonly skillId: string;
  readonly version: string;
  readonly instructions: string;
  readonly toolAllowlist: readonly string[];
  readonly instructionsHash: string;
}

export interface AgentSkillSnapshotV1 {
  readonly catalogRevision: number;
  readonly skills: readonly AgentSkillDefinitionV1[];
  readonly get: (skillId: string) => AgentSkillDefinitionV1 | null;
  readonly list: () => readonly AgentSkillDefinitionV1[];
  readonly listSummaries: () => readonly AgentSkillSummaryV1[];
  readonly getSummary: (skillId: string) => AgentSkillSummaryV1 | null;
  readonly getActivationEnvelope: (
    skillId: string,
  ) => AgentSkillActivationEnvelopeV1 | null;
}

export interface AgentSkillRegistryOptionsV1 {
  /**
   * Tool visibility is intentionally injected instead of importing the Tool
   * Registry.  This keeps Skill registration independent from executor code
   * and lets a Run validate against its own Tool snapshot later.
   */
  readonly toolExists?: (toolName: string) => boolean;
  /** Alias accepted for callers that name the dependency a validator. */
  readonly validateTool?: (toolName: string) => boolean;
  /** Estimate serialized text in provider tokens. */
  readonly estimateTokens?: (serialized: string) => number;
  /** Maximum tokens for one compact summary. */
  readonly maxSummaryTokens?: number;
  /** Maximum tokens for the complete activation envelope. */
  readonly maxActivationTokens?: number;
  /** Optional maximum for the whole initial catalog projection. */
  readonly maxCatalogTokens?: number;
}

export interface AgentSkillSnapshotOptionsV1 {
  /** Override the default catalog token budget for this Run snapshot. */
  readonly maxCatalogTokens?: number;
}

