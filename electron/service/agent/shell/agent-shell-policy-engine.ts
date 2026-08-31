import type {
  AgentShellPermissionMode,
  AgentShellPreparedAssessment,
  AgentShellRisk,
  AgentShellRiskFacet,
} from '../../../../src/shared/agent/shell/agent-shell.types';

export const AGENT_SHELL_POLICY_REVISION = 'shell-policy-v1';
export const AGENT_SHELL_IMMUTABLE_DENY_REVISION = 'shell-immutable-deny-v1';

export type { AgentShellPermissionMode } from '../../../../src/shared/agent/shell/agent-shell.types';

export type AgentShellPermissionRuleLifetime = 'library' | 'session';

export type AgentShellPolicyReasonCode =
  | 'explicit-deny'
  | 'immutable-detached'
  | 'immutable-interactive'
  | 'immutable-privilege-escalation'
  | 'matched-allow'
  | 'mode-auto'
  | 'mode-full-access'
  | 'mode-requires-confirmation'
  | 'rule-ineligible'
  | 'unresolved-analysis'
  | 'workspace-boundary-unverified';

export interface AgentShellMatchedPermissionRule {
  readonly authorizationIdentity: string;
  readonly behavior: 'allow' | 'deny';
  readonly lifetime: AgentShellPermissionRuleLifetime;
  readonly revision: number;
  readonly ruleId: string;
}

export interface AgentShellPolicyEvaluationInput {
  readonly assessment: AgentShellPreparedAssessment;
  readonly authorizationIdentity?: string;
  readonly matchedRules?: readonly AgentShellMatchedPermissionRule[];
  readonly mode: AgentShellPermissionMode;
  /** True only when main has proved every analyzed path remains in the Run workspace. */
  readonly workspaceBoundaryVerified: boolean;
}

interface AgentShellPolicyDecisionBase {
  readonly reasonCodes: readonly AgentShellPolicyReasonCode[];
  readonly risk: AgentShellRisk;
}

export type AgentShellPolicyDecision =
  | (AgentShellPolicyDecisionBase & {
    readonly behavior: 'allow';
    readonly matchedRule?: AgentShellMatchedPermissionRule;
    readonly source: 'auto' | 'full-access' | 'rule';
  })
  | (AgentShellPolicyDecisionBase & {
    readonly behavior: 'ask';
  })
  | (AgentShellPolicyDecisionBase & {
    readonly behavior: 'deny';
  });

const IMMUTABLE_DENY_REASON_BY_FACET = new Map<
  AgentShellRiskFacet,
  AgentShellPolicyReasonCode
>([
  ['detached', 'immutable-detached'],
  ['interactive', 'immutable-interactive'],
  ['privilege_escalation', 'immutable-privilege-escalation'],
]);

const AUTO_CONFIRMATION_FACETS = new Set<AgentShellRiskFacet>([
  'command_substitution',
  'dynamic_command_head',
  'environment_change',
  'external_path',
  'nested_shell',
  'network',
  'package_install',
  'system_configuration',
  'unknown_syntax',
]);

const AUTHORIZATION_IDENTITY_PATTERN = /^v[1-9]\d*:[a-f0-9]{64}$/u;
const RULE_ID_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;

function uniqueReasons(
  reasons: readonly AgentShellPolicyReasonCode[],
): readonly AgentShellPolicyReasonCode[] {
  return Object.freeze([...new Set(reasons)].sort());
}

function freezeMatchedRule(
  rule: AgentShellMatchedPermissionRule,
): AgentShellMatchedPermissionRule {
  return Object.freeze({ ...rule });
}

function validMatchedRule(
  rule: AgentShellMatchedPermissionRule,
  authorizationIdentity: string | undefined,
): boolean {
  return Boolean(
    authorizationIdentity
    && AUTHORIZATION_IDENTITY_PATTERN.test(authorizationIdentity)
    && rule.authorizationIdentity === authorizationIdentity
    && AUTHORIZATION_IDENTITY_PATTERN.test(rule.authorizationIdentity)
    && RULE_ID_PATTERN.test(rule.ruleId)
    && Number.isSafeInteger(rule.revision)
    && rule.revision > 0
    && (rule.lifetime === 'library' || rule.lifetime === 'session')
    && (rule.behavior === 'allow' || rule.behavior === 'deny'),
  );
}

function immutableDenyReasons(
  assessment: AgentShellPreparedAssessment,
): readonly AgentShellPolicyReasonCode[] {
  const reasons: AgentShellPolicyReasonCode[] = [];
  for (const facet of assessment.facets) {
    const reason = IMMUTABLE_DENY_REASON_BY_FACET.get(facet);
    if (reason) reasons.push(reason);
  }
  return uniqueReasons(reasons);
}

function matchingRules(
  input: AgentShellPolicyEvaluationInput,
): readonly AgentShellMatchedPermissionRule[] {
  return Object.freeze((input.matchedRules || [])
    .filter(rule => validMatchedRule(rule, input.authorizationIdentity))
    .map(freezeMatchedRule));
}

function canUseMatchedAllow(
  assessment: AgentShellPreparedAssessment,
): boolean {
  return assessment.persistentRuleEligible && assessment.unresolved.length === 0;
}

function analysisComplete(assessment: AgentShellPreparedAssessment): boolean {
  return assessment.unresolved.length === 0
    && !assessment.facets.includes('unknown_syntax')
    && !assessment.facets.includes('dynamic_command_head');
}

function autoModeCanAllow(input: AgentShellPolicyEvaluationInput): boolean {
  if (!input.workspaceBoundaryVerified || input.assessment.unresolved.length > 0) return false;
  return input.assessment.facets.every(facet => !AUTO_CONFIRMATION_FACETS.has(facet));
}

function askReasons(input: AgentShellPolicyEvaluationInput): readonly AgentShellPolicyReasonCode[] {
  const reasons: AgentShellPolicyReasonCode[] = ['mode-requires-confirmation'];
  if (input.assessment.unresolved.length > 0) reasons.push('unresolved-analysis');
  if (!input.workspaceBoundaryVerified) reasons.push('workspace-boundary-unverified');
  if (!canUseMatchedAllow(input.assessment) && (input.matchedRules?.length || 0) > 0) {
    reasons.push('rule-ineligible');
  }
  return uniqueReasons(reasons);
}

export function createAgentShellPolicyEngine() {
  function evaluate(input: AgentShellPolicyEvaluationInput): AgentShellPolicyDecision {
    const immutableReasons = immutableDenyReasons(input.assessment);
    if (immutableReasons.length > 0) {
      return Object.freeze({
        behavior: 'deny' as const,
        reasonCodes: immutableReasons,
        risk: 'destructive' as const,
      });
    }

    const rules = matchingRules(input);
    const denyRule = rules.find(rule => rule.behavior === 'deny');
    if (denyRule) {
      return Object.freeze({
        behavior: 'deny' as const,
        reasonCodes: Object.freeze(['explicit-deny'] as const),
        risk: input.assessment.risk,
      });
    }

    const allowRule = canUseMatchedAllow(input.assessment)
      ? rules
          .filter(rule => rule.behavior === 'allow')
          .sort((left, right) => {
            const lifetime = Number(left.lifetime === 'library')
              - Number(right.lifetime === 'library');
            if (lifetime !== 0) return lifetime;
            if (left.revision !== right.revision) return right.revision - left.revision;
            return left.ruleId.localeCompare(right.ruleId);
          })[0]
      : undefined;
    if (allowRule) {
      return Object.freeze({
        behavior: 'allow' as const,
        matchedRule: allowRule,
        reasonCodes: Object.freeze(['matched-allow'] as const),
        risk: input.assessment.risk,
        source: 'rule' as const,
      });
    }

    if (input.mode === 'full-access' && !analysisComplete(input.assessment)) {
      return Object.freeze({
        behavior: 'deny' as const,
        reasonCodes: Object.freeze(['unresolved-analysis'] as const),
        risk: 'destructive' as const,
      });
    }

    if (input.mode === 'full-access') {
      return Object.freeze({
        behavior: 'allow' as const,
        reasonCodes: Object.freeze(['mode-full-access'] as const),
        risk: input.assessment.risk,
        source: 'full-access' as const,
      });
    }

    if (input.mode === 'auto' && autoModeCanAllow(input)) {
      return Object.freeze({
        behavior: 'allow' as const,
        reasonCodes: Object.freeze(['mode-auto'] as const),
        risk: input.assessment.risk,
        source: 'auto' as const,
      });
    }

    return Object.freeze({
      behavior: 'ask' as const,
      reasonCodes: askReasons(input),
      risk: input.assessment.risk,
    });
  }

  return Object.freeze({ evaluate });
}

export type AgentShellPolicyEngine = ReturnType<typeof createAgentShellPolicyEngine>;
