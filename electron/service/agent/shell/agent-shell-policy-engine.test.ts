import { describe, expect, it } from 'vitest';

import type {
  AgentShellPreparedAssessment,
  AgentShellRiskFacet,
} from '../../../../src/shared/agent/shell/agent-shell.types';
import {
  createAgentShellPolicyEngine,
  type AgentShellMatchedPermissionRule,
  type AgentShellPermissionMode,
} from './agent-shell-policy-engine';

const AUTHORIZATION_IDENTITY = `v1:${'a'.repeat(64)}`;

function assessment(input: {
  facets?: readonly AgentShellRiskFacet[];
  persistentRuleEligible?: boolean;
  risk?: AgentShellPreparedAssessment['risk'];
  unresolved?: readonly string[];
} = {}): AgentShellPreparedAssessment {
  const facets = input.facets || ['filesystem.read'];
  return Object.freeze({
    facets: Object.freeze([...facets]),
    operations: Object.freeze([Object.freeze({
      argvPrefix: Object.freeze([]),
      effects: Object.freeze([...facets]),
      executable: 'fixture',
    })]),
    persistentRuleEligible: input.persistentRuleEligible ?? true,
    risk: input.risk || 'read',
    unresolved: Object.freeze([...(input.unresolved || [])]),
  });
}

function matchedRule(
  behavior: 'allow' | 'deny',
  overrides: Partial<AgentShellMatchedPermissionRule> = {},
): AgentShellMatchedPermissionRule {
  return Object.freeze({
    authorizationIdentity: AUTHORIZATION_IDENTITY,
    behavior,
    lifetime: 'session',
    revision: 1,
    ruleId: `shell-${behavior}-1`,
    ...overrides,
  });
}

function evaluate(input: {
  assessment?: AgentShellPreparedAssessment;
  matchedRules?: readonly AgentShellMatchedPermissionRule[];
  mode?: AgentShellPermissionMode;
  workspaceBoundaryVerified?: boolean;
} = {}) {
  return createAgentShellPolicyEngine().evaluate({
    assessment: input.assessment || assessment(),
    authorizationIdentity: AUTHORIZATION_IDENTITY,
    matchedRules: input.matchedRules,
    mode: input.mode || 'ask',
    workspaceBoundaryVerified: input.workspaceBoundaryVerified ?? true,
  });
}

describe('Agent shell policy engine', () => {
  it('keeps ask mode supervised when no exact rule covers the action', () => {
    expect(evaluate()).toEqual({
      behavior: 'ask',
      reasonCodes: ['mode-requires-confirmation'],
      risk: 'read',
    });
  });

  it('allows a fully analyzed workspace action in deterministic auto mode', () => {
    expect(evaluate({
      assessment: assessment({
        facets: ['filesystem.read', 'filesystem.write', 'filesystem.delete', 'redirection'],
        risk: 'destructive',
      }),
      mode: 'auto',
    })).toEqual({
      behavior: 'allow',
      reasonCodes: ['mode-auto'],
      risk: 'destructive',
      source: 'auto',
    });
  });

  it.each<AgentShellRiskFacet>([
    'command_substitution',
    'dynamic_command_head',
    'environment_change',
    'external_path',
    'nested_shell',
    'network',
    'package_install',
    'system_configuration',
    'unknown_syntax',
  ])('asks instead of auto-approving the %s facet', (facet) => {
    expect(evaluate({
      assessment: assessment({ facets: [facet], risk: 'external' }),
      mode: 'auto',
    })).toMatchObject({ behavior: 'ask', risk: 'external' });
  });

  it('requires a verified workspace boundary before deterministic auto approval', () => {
    expect(evaluate({ mode: 'auto', workspaceBoundaryVerified: false })).toEqual({
      behavior: 'ask',
      reasonCodes: ['mode-requires-confirmation', 'workspace-boundary-unverified'],
      risk: 'read',
    });
  });

  it('allows full access to continue when analysis is incomplete', () => {
    expect(evaluate({
      assessment: assessment({
        facets: ['unknown_syntax', 'external_path', 'network'],
        persistentRuleEligible: false,
        risk: 'external',
        unresolved: ['parser-unavailable'],
      }),
      mode: 'full-access',
      workspaceBoundaryVerified: false,
    })).toEqual({
      behavior: 'allow',
      reasonCodes: ['mode-full-access'],
      risk: 'external',
      source: 'full-access',
    });
  });

  it('lets full access bypass confirmation after analysis is complete', () => {
    expect(evaluate({
      assessment: assessment({
        facets: ['external_path', 'network', 'system_configuration'],
        persistentRuleEligible: false,
        risk: 'external',
      }),
      mode: 'full-access',
      workspaceBoundaryVerified: false,
    })).toEqual({
      behavior: 'allow',
      reasonCodes: ['mode-full-access'],
      risk: 'external',
      source: 'full-access',
    });
  });

  it.each<AgentShellPermissionMode>(['ask', 'auto'])(
    'keeps a fully analyzed external file read supervised in %s mode',
    (mode) => {
      expect(evaluate({
        assessment: assessment({
          facets: ['filesystem.read', 'external_path'],
          persistentRuleEligible: false,
          risk: 'external',
        }),
        mode,
        workspaceBoundaryVerified: false,
      })).toMatchObject({
        behavior: 'ask',
        risk: 'external',
      });
    },
  );

  it('allows a fully analyzed external file read without confirmation in full access mode', () => {
    expect(evaluate({
      assessment: assessment({
        facets: ['filesystem.read', 'external_path'],
        persistentRuleEligible: false,
        risk: 'external',
      }),
      mode: 'full-access',
      workspaceBoundaryVerified: false,
    })).toEqual({
      behavior: 'allow',
      reasonCodes: ['mode-full-access'],
      risk: 'external',
      source: 'full-access',
    });
  });

  it.each<AgentShellRiskFacet>([
    'detached',
    'interactive',
    'privilege_escalation',
  ])('keeps the unsupported %s facet denied in full access mode', (facet) => {
    expect(evaluate({
      assessment: assessment({ facets: [facet], risk: 'destructive' }),
      matchedRules: [matchedRule('allow')],
      mode: 'full-access',
    })).toMatchObject({
      behavior: 'deny',
      risk: 'destructive',
    });
  });

  it('produces deterministic immutable-deny reasons regardless of facet order', () => {
    const first = evaluate({
      assessment: assessment({
        facets: ['privilege_escalation', 'detached', 'interactive'],
        risk: 'destructive',
      }),
      mode: 'full-access',
    });
    const second = evaluate({
      assessment: assessment({
        facets: ['interactive', 'privilege_escalation', 'detached'],
        risk: 'destructive',
      }),
      mode: 'full-access',
    });

    expect(first).toEqual(second);
    expect(first.reasonCodes).toEqual([
      'immutable-detached',
      'immutable-interactive',
      'immutable-privilege-escalation',
    ]);
  });

  it('gives an exact deny rule precedence over allow and full access', () => {
    expect(evaluate({
      matchedRules: [matchedRule('allow'), matchedRule('deny')],
      mode: 'full-access',
    })).toEqual({
      behavior: 'deny',
      reasonCodes: ['explicit-deny'],
      risk: 'read',
    });
  });

  it('uses an exact session allow rule in ask mode', () => {
    const rule = matchedRule('allow');
    expect(evaluate({ matchedRules: [rule] })).toEqual({
      behavior: 'allow',
      matchedRule: rule,
      reasonCodes: ['matched-allow'],
      risk: 'read',
      source: 'rule',
    });
  });

  it('prefers the latest Session allow over a library allow regardless of input order', () => {
    const libraryRule = matchedRule('allow', {
      lifetime: 'library',
      revision: 9,
      ruleId: 'library-rule',
    });
    const sessionRule = matchedRule('allow', {
      lifetime: 'session',
      revision: 2,
      ruleId: 'session-rule',
    });
    const first = evaluate({ matchedRules: [libraryRule, sessionRule] });
    const second = evaluate({ matchedRules: [sessionRule, libraryRule] });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ matchedRule: sessionRule, source: 'rule' });
  });

  it('ignores stale, malformed, or ineligible allow rules', () => {
    expect(evaluate({
      assessment: assessment({ persistentRuleEligible: false }),
      matchedRules: [
        matchedRule('allow'),
        matchedRule('allow', { authorizationIdentity: `v1:${'b'.repeat(64)}` }),
        matchedRule('allow', { revision: 0 }),
      ],
    })).toEqual({
      behavior: 'ask',
      reasonCodes: ['mode-requires-confirmation', 'rule-ineligible'],
      risk: 'read',
    });
  });

  it('returns frozen decisions and frozen matched-rule snapshots', () => {
    const result = evaluate({ matchedRules: [matchedRule('allow')] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasonCodes)).toBe(true);
    if (result.behavior === 'allow') expect(Object.isFrozen(result.matchedRule)).toBe(true);
  });
});
