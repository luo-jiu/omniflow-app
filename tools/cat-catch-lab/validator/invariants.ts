import {
  gitCommitTouchesPath,
  gitCommitContainsPathScope,
  gitObjectExists,
  isGitAncestor,
  readGitFileAtCommit,
  readGitPathAtCommit,
  tryReadGitHead,
} from './git-input.ts'
import { getString, getStringArray, isJsonObject, sha256Bytes } from './json.ts'
import { validateReleaseConfiguration } from './release-config.ts'
import { deriveCapabilityRiskSignals } from './risk-signals.ts'
import { inspectSourceLocator, normalizeSourceLocatorKind } from './source-locator.ts'
import { validateGitSourceReference } from './source-validation.ts'
import { createIssue, type ValidationContext, type ValidationIssue } from './types.ts'
import { validateUpstreamState as validatePinnedUpstreamState } from './upstream-validation.ts'

const DERIVED_LEDGER_FIELDS = new Set([
  'artifactId',
  'artifactRefs',
  'deployment',
  'effectiveRiskTags',
  'freshness',
  'pass',
  'status',
  'verifiedThrough',
])

const BASE_BEFORE_CUTOVER = ['fixture', 'behavior']
const BASE_FOR_COMPLETION = ['fixture', 'behavior']
const CANONICAL_REPOSITORY_PATH_PATTERN = /^(?!(?:.*\/)?\.{1,2}(?:\/|$))(?!.*\\)[^/]+(?:\/[^/]+)*$/
const EXTERNAL_PROCESS_TARGET_PATTERN = /^external-process\/[a-z0-9][a-z0-9._-]*$/

const ARTIFACT_SCHEMA_IDS: Record<string, string> = {
  'artifact-availability': 'https://omniflow.local/schemas/cat-catch/artifact-availability-report.schema.json',
  'capability-state': 'https://omniflow.local/schemas/cat-catch/capability-state-report.schema.json',
  decision: 'https://omniflow.local/schemas/cat-catch/decision-record.schema.json',
  evidence: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
  gate: 'https://omniflow.local/schemas/cat-catch/gate-report.schema.json',
  'local-closure': 'https://omniflow.local/schemas/cat-catch/local-closure-report.schema.json',
  seal: 'https://omniflow.local/schemas/cat-catch/seal-report.schema.json',
}

type LedgerIndex = {
  capabilityCutoverUnitIds: Map<string, string>
  capabilityIds: Set<string>
  cutoverUnitIds: Set<string>
  fixtureIds: Set<string>
  fixturesByCapability: Map<string, Set<string>>
}

function findForbiddenFields(value: unknown, currentPath = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenFields(item, `${currentPath}[${index}]`))
  }
  if (!isJsonObject(value)) return []
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${currentPath}.${key}`
    const own = DERIVED_LEDGER_FIELDS.has(key) ? [childPath] : []
    return own.concat(findForbiddenFields(child, childPath))
  })
}

function readArray(document: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = document?.[key]
  return Array.isArray(value) ? value : []
}

function validateUniqueIds(
  issues: ValidationIssue[],
  values: unknown[],
  filePath: string,
  label: string,
): Set<string> {
  const seen = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (!isJsonObject(value)) continue
    const id = getString(value.id)
    if (!id) continue
    if (seen.has(id)) {
      issues.push(createIssue('error', 'duplicate-id', `Duplicate ${label} id: ${id}`, `${filePath}[${index}].id`))
    }
    seen.add(id)
  }
  return seen
}

function validateRequiredEvidence(
  issues: ValidationIssue[],
  capability: Record<string, unknown>,
  capabilityPath: string,
): void {
  if (capability.disposition === 'intentional-exclusion') return
  const requiredEvidence = isJsonObject(capability.requiredEvidence) ? capability.requiredEvidence : {}
  const beforeCutover = new Set(getStringArray(requiredEvidence.beforeCutover))
  const forCompletion = new Set(getStringArray(requiredEvidence.forCompletion))
  for (const dimension of BASE_BEFORE_CUTOVER) {
    if (!beforeCutover.has(dimension)) {
      issues.push(createIssue('error', 'fixed-evidence-minimum-missing', `beforeCutover must include ${dimension}`, capabilityPath))
    }
  }
  for (const dimension of BASE_FOR_COMPLETION) {
    if (!forCompletion.has(dimension)) {
      issues.push(createIssue('error', 'fixed-evidence-minimum-missing', `forCompletion must include ${dimension}`, capabilityPath))
    }
  }
}

function deriveMatchedRiskRules(
  riskPolicy: Record<string, unknown>,
  signals: Set<string>,
): Record<string, unknown>[] {
  const rules = readArray(riskPolicy, 'rules').filter(isJsonObject)
  const matchedRuleIndexes = new Set<number>()

  let changed = true
  while (changed) {
    changed = false
    for (const [index, rule] of rules.entries()) {
      if (!getStringArray(rule.whenAnySignals).some(signal => signals.has(signal))) continue
      if (!matchedRuleIndexes.has(index)) {
        matchedRuleIndexes.add(index)
        changed = true
      }
      for (const riskTag of getStringArray(rule.addRiskTags)) {
        if (signals.has(riskTag)) continue
        signals.add(riskTag)
        changed = true
      }
    }
  }

  return rules.filter((_, index) => matchedRuleIndexes.has(index))
}

function collectEvidenceRequirements(
  rules: Record<string, unknown>[],
  key: 'requireBeforeCutover' | 'requireForCompletion',
): Map<string, string[]> {
  const requirements = new Map<string, string[]>()
  for (const [index, rule] of rules.entries()) {
    const ruleId = getString(rule.id) || `rules[${index}]`
    for (const dimension of getStringArray(rule[key])) {
      requirements.set(dimension, [...(requirements.get(dimension) || []), ruleId])
    }
  }
  return requirements
}

function validateRiskEvidence(
  context: ValidationContext,
  issues: ValidationIssue[],
  riskPolicy: Record<string, unknown> | undefined,
  capability: Record<string, unknown>,
  capabilityPath: string,
): void {
  if (!riskPolicy || capability.disposition === 'intentional-exclusion') return
  const knownRiskTags = new Set(getStringArray(riskPolicy.knownRiskTags))
  const additionalRiskTags = getStringArray(capability.additionalRiskTags)
  for (const riskTag of additionalRiskTags) {
    if (!knownRiskTags.has(riskTag)) {
      issues.push(createIssue('error', 'unknown-risk-tag', `Unknown additional risk tag: ${riskTag}`, capabilityPath))
    }
  }

  const requiredEvidence = isJsonObject(capability.requiredEvidence) ? capability.requiredEvidence : {}
  const beforeCutover = new Set(getStringArray(requiredEvidence.beforeCutover))
  const forCompletion = new Set(getStringArray(requiredEvidence.forCompletion))
  const matchedRules = deriveMatchedRiskRules(
    riskPolicy,
    deriveCapabilityRiskSignals(context, capability),
  )
  const beforeRequirements = collectEvidenceRequirements(matchedRules, 'requireBeforeCutover')
  const completionRequirements = collectEvidenceRequirements(matchedRules, 'requireForCompletion')

  for (const [dimension, ruleIds] of beforeRequirements) {
    if (beforeCutover.has(dimension)) continue
    issues.push(createIssue(
      'error',
      'risk-evidence-minimum-missing',
      `Risk policy rules ${ruleIds.join(', ')} require beforeCutover ${dimension}`,
      `${capabilityPath}.requiredEvidence.beforeCutover`,
    ))
  }
  for (const [dimension, ruleIds] of completionRequirements) {
    if (forCompletion.has(dimension)) continue
    issues.push(createIssue(
      'error',
      'risk-evidence-minimum-missing',
      `Risk policy rules ${ruleIds.join(', ')} require forCompletion ${dimension}`,
      `${capabilityPath}.requiredEvidence.forCompletion`,
    ))
  }

  if (matchedRules.length === 0) {
    issues.push(createIssue('blocker', 'unclassified-risk', 'Capability did not match any versioned risk rule', capabilityPath))
  }
}

function validateLedger(context: ValidationContext, issues: ValidationIssue[]): LedgerIndex {
  const ledger = context.documents.get('capability-ledger.json')
  const riskPolicy = context.documents.get('risk-policy.json')
  const upstreamState = context.documents.get('upstream-state.json')
  const globalAuditedThrough = getString(upstreamState?.auditedThrough)
  const observedHead = getString(upstreamState?.observedHead)
  const appHead = tryReadGitHead(context.appRoot)
  const capabilities = readArray(ledger, 'capabilities')
  const capabilityIds = validateUniqueIds(issues, capabilities, 'capability-ledger.json.capabilities', 'capability')
  const cutoverUnits = readArray(ledger, 'cutoverUnits')
  const cutoverUnitIds = validateUniqueIds(
    issues,
    cutoverUnits,
    'capability-ledger.json.cutoverUnits',
    'cutover unit',
  )
  const capabilityCutoverUnitIds = new Map<string, string>()
  const fixtureIds = new Set<string>()
  const fixturesByCapability = new Map<string, Set<string>>()
  const cutoverDependencies = new Map<string, string[]>()
  for (const [index, value] of cutoverUnits.entries()) {
    if (!isJsonObject(value)) continue
    const unitId = getString(value.id)
    if (!unitId) continue
    const dependencyIds = getStringArray(value.dependsOn)
    cutoverDependencies.set(unitId, dependencyIds)
    if (value.dependencyMapping !== 'specified') {
      issues.push(createIssue(
        'blocker',
        'cutover-dependency-mapping-incomplete',
        `Cutover dependency graph is not audited for ${unitId}`,
        `capability-ledger.json.cutoverUnits[${index}].dependencyMapping`,
      ))
    }
    for (const dependencyId of dependencyIds) {
      if (!cutoverUnitIds.has(dependencyId)) {
        issues.push(createIssue(
          'error',
          'cutover-dependency-missing',
          `Cutover unit ${unitId} depends on unknown unit ${dependencyId}`,
          `capability-ledger.json.cutoverUnits[${index}].dependsOn`,
        ))
      } else if (dependencyId === unitId) {
        issues.push(createIssue(
          'error',
          'cutover-dependency-self-reference',
          `Cutover unit cannot depend on itself: ${unitId}`,
          `capability-ledger.json.cutoverUnits[${index}].dependsOn`,
        ))
      }
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visitCutoverUnit = (unitId: string): boolean => {
    if (visiting.has(unitId)) return true
    if (visited.has(unitId)) return false
    visiting.add(unitId)
    const cyclic = (cutoverDependencies.get(unitId) || []).some(visitCutoverUnit)
    visiting.delete(unitId)
    visited.add(unitId)
    return cyclic
  }
  if ([...cutoverDependencies.keys()].some(visitCutoverUnit)) {
    issues.push(createIssue(
      'error',
      'cutover-dependency-cycle',
      'Cutover dependency graph must be acyclic',
      'capability-ledger.json.cutoverUnits',
    ))
  }

  for (const forbiddenPath of findForbiddenFields(ledger)) {
    issues.push(createIssue('error', 'derived-ledger-field', 'Derived state cannot be stored in the capability ledger', forbiddenPath))
  }

  for (const [index, value] of capabilities.entries()) {
    if (!isJsonObject(value)) continue
    const capabilityPath = `capability-ledger.json.capabilities[${index}]`
    const origin = getString(value.origin)
    const capabilityId = getString(value.id) || String(index)
    const cutoverUnitId = getString(value.cutoverUnitId)
    const capabilityAuditedThrough = getString(value.auditedThrough)
    const capabilityFixtureIds = new Set(getStringArray(value.fixtures))
    if (getString(value.id)) fixturesByCapability.set(getString(value.id)!, capabilityFixtureIds)
    for (const fixtureId of capabilityFixtureIds) fixtureIds.add(fixtureId)
    if (getString(value.id) && cutoverUnitId) {
      capabilityCutoverUnitIds.set(getString(value.id)!, cutoverUnitId)
    }
    if (cutoverUnitId && !cutoverUnitIds.has(cutoverUnitId)) {
      issues.push(createIssue('error', 'capability-cutover-unit-missing', `Unknown cutover unit id: ${cutoverUnitId}`, capabilityPath))
    }
    if (value.mapping !== 'specified' || value.auditedThrough === null) {
      issues.push(createIssue('blocker', 'capability-mapping-incomplete', `Capability is not fully mapped: ${capabilityId}`, capabilityPath))
    }
    if (value.mapping === 'specified' && capabilityAuditedThrough !== globalAuditedThrough) {
      issues.push(createIssue(
        'error',
        'capability-audit-cursor-mismatch',
        `Capability ${capabilityId} must bind the global auditedThrough cursor`,
        `${capabilityPath}.auditedThrough`,
      ))
    } else if (value.mapping === 'unmapped' && capabilityAuditedThrough) {
      issues.push(createIssue(
        'error',
        'unmapped-capability-has-audit-cursor',
        `Unmapped capability ${capabilityId} cannot claim audited source coverage`,
        `${capabilityPath}.auditedThrough`,
      ))
    }
    const upstreamSources = Array.isArray(value.upstreamSources) ? value.upstreamSources : []
    const localContractRefs = Array.isArray(value.localContractRefs) ? value.localContractRefs : []
    if ((origin === 'upstream-derived' || origin === 'cross-boundary') && upstreamSources.length === 0) {
      issues.push(createIssue('error', 'upstream-source-required', `${origin} capability must declare upstream sources`, capabilityPath))
    }
    if ((origin === 'omniflow-integration' || origin === 'cross-boundary') && localContractRefs.length === 0) {
      issues.push(createIssue('error', 'local-contract-required', `${origin} capability must declare local contract refs`, capabilityPath))
    }
    const upstreamSourceCommit = capabilityAuditedThrough || observedHead
    upstreamSources.forEach((source, sourceIndex) => issues.push(...validateGitSourceReference({
      commit: upstreamSourceCommit,
      hashField: 'blobHash',
      issuePath: `${capabilityPath}.upstreamSources[${sourceIndex}]`,
      repositoryRoot: context.upstreamRoot,
      requireIntroducedBy: value.mapping === 'specified',
      source,
    })))
    localContractRefs.forEach((source, sourceIndex) => issues.push(...validateGitSourceReference({
      commit: appHead,
      hashField: 'sourceHash',
      issuePath: `${capabilityPath}.localContractRefs[${sourceIndex}]`,
      repositoryRoot: context.appRoot,
      source,
    })))
    validateRequiredEvidence(issues, value, capabilityPath)
    validateRiskEvidence(context, issues, riskPolicy, value, capabilityPath)
  }
  return {
    capabilityCutoverUnitIds,
    capabilityIds,
    cutoverUnitIds,
    fixtureIds,
    fixturesByCapability,
  }
}

function locatorKey(value: Record<string, unknown>): string | null {
  const relativePath = getString(value.path)
  if (!relativePath || !isCanonicalRepositoryPath(relativePath)) return null
  const symbol = value.symbol === null ? null : getString(value.symbol)
  if (symbol === null && value.symbol !== null) return null
  if (symbol === null) return value.locatorKind === undefined ? JSON.stringify([relativePath, null]) : null
  const locatorKind = normalizeSourceLocatorKind(value.locatorKind)
  return locatorKind ? JSON.stringify([relativePath, symbol, locatorKind]) : null
}

function isCanonicalRepositoryPath(relativePath: string): boolean {
  return CANONICAL_REPOSITORY_PATH_PATTERN.test(relativePath)
    && ![...relativePath].some(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })
}

function validateCanonicalLocatorPath(
  issues: ValidationIssue[],
  value: Record<string, unknown>,
  issuePath: string,
): boolean {
  const relativePath = getString(value.path)
  const pathValid = Boolean(relativePath && isCanonicalRepositoryPath(relativePath))
  if (relativePath && !pathValid) {
    issues.push(createIssue(
      'error',
      'noncanonical-repository-path',
      `Repository path must not contain aliases, traversal, empty segments, backslashes, or control characters: ${relativePath}`,
      `${issuePath}.path`,
    ))
  }
  const symbol = value.symbol === null ? null : getString(value.symbol)
  if (symbol === null && value.locatorKind !== undefined) {
    issues.push(createIssue(
      'error',
      'locator-kind-without-symbol',
      'locatorKind is forbidden when symbol is null or missing',
      `${issuePath}.locatorKind`,
    ))
  } else if (symbol && !normalizeSourceLocatorKind(value.locatorKind)) {
    issues.push(createIssue(
      'error',
      'locator-kind-invalid',
      `Unknown locatorKind: ${String(value.locatorKind)}`,
      `${issuePath}.locatorKind`,
    ))
  }
  return pathValid
}

function validateUniqueLocators(
  issues: ValidationIssue[],
  values: Record<string, unknown>[],
  filePath: string,
  label: string,
): void {
  const seen = new Map<string, string>()
  for (const [index, value] of values.entries()) {
    if (!validateCanonicalLocatorPath(issues, value, `${filePath}[${index}]`)) continue
    const key = locatorKey(value)
    if (!key) continue
    const existingId = seen.get(key)
    if (existingId) {
      issues.push(createIssue(
        'error',
        'duplicate-inventory-locator',
        `Duplicate ${label} locator shared by ${existingId} and ${getString(value.id) || index}`,
        `${filePath}[${index}]`,
      ))
    } else {
      seen.set(key, getString(value.id) || String(index))
    }
  }
}

function validateUniqueDynamicEdgeSemantics(
  issues: ValidationIssue[],
  edges: Record<string, unknown>[],
  filePath: string,
): void {
  const seen = new Map<string, string>()
  for (const [index, edge] of edges.entries()) {
    const kind = getString(edge.kind)
    const source = isJsonObject(edge.source) ? edge.source : null
    const target = isJsonObject(edge.target) ? edge.target : null
    const sourceValid = source
      ? validateCanonicalLocatorPath(issues, source, `${filePath}[${index}].source`)
      : false
    const targetValid = target
      ? validateCanonicalLocatorPath(issues, target, `${filePath}[${index}].target`)
      : false
    const sourceKey = sourceValid && source ? locatorKey(source) : null
    const targetKey = targetValid && target ? locatorKey(target) : null
    if (!kind || !sourceKey || !targetKey) continue
    const semanticKey = JSON.stringify([kind, sourceKey, targetKey])
    const edgeId = getString(edge.id) || String(index)
    const existingId = seen.get(semanticKey)
    if (existingId) {
      issues.push(createIssue(
        'error',
        'duplicate-dynamic-edge',
        `Dynamic edge duplicates ${existingId}: ${edgeId}`,
        `${filePath}[${index}]`,
      ))
    } else {
      seen.set(semanticKey, edgeId)
    }
  }
}

function validateInventoryMapping(
  issues: ValidationIssue[],
  value: Record<string, unknown>,
  valuePath: string,
  ledgerIndex: LedgerIndex,
): void {
  const capabilityId = getString(value.capabilityId)
  const cutoverUnitId = getString(value.cutoverUnitId)
  if (!capabilityId) {
    issues.push(createIssue(
      'blocker',
      'inventory-capability-unmapped',
      'In-scope inventory entry must map to a capability',
      `${valuePath}.capabilityId`,
    ))
  } else if (!ledgerIndex.capabilityIds.has(capabilityId)) {
    issues.push(createIssue(
      'error',
      'inventory-capability-missing',
      `Unknown capability id: ${capabilityId}`,
      `${valuePath}.capabilityId`,
    ))
  }

  if (!cutoverUnitId) {
    issues.push(createIssue(
      'blocker',
      'inventory-cutover-unit-unmapped',
      'In-scope inventory entry must map to a cutover unit',
      `${valuePath}.cutoverUnitId`,
    ))
  } else if (!ledgerIndex.cutoverUnitIds.has(cutoverUnitId)) {
    issues.push(createIssue(
      'error',
      'inventory-cutover-unit-missing',
      `Unknown cutover unit id: ${cutoverUnitId}`,
      `${valuePath}.cutoverUnitId`,
    ))
  }

  const capabilityCutoverUnitId = capabilityId
    ? ledgerIndex.capabilityCutoverUnitIds.get(capabilityId)
    : null
  if (capabilityCutoverUnitId && cutoverUnitId && capabilityCutoverUnitId !== cutoverUnitId) {
    issues.push(createIssue(
      'error',
      'inventory-cutover-unit-mismatch',
      `Capability ${capabilityId} belongs to ${capabilityCutoverUnitId}, not ${cutoverUnitId}`,
      `${valuePath}.cutoverUnitId`,
    ))
  }
}

function ownerRefKey(relativePath: string, symbol: string): string {
  return `${relativePath}#${symbol}`
}

function parseOwnerRef(value: string): { path: string; symbol: string } | null {
  const separatorIndex = value.lastIndexOf('#')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null
  const relativePath = value.slice(0, separatorIndex)
  const symbol = value.slice(separatorIndex + 1)
  return isCanonicalRepositoryPath(relativePath) ? { path: relativePath, symbol } : null
}

function validateLegacyOwnerRefs(
  context: ValidationContext,
  issues: ValidationIssue[],
  currentNodes: Record<string, unknown>[],
): void {
  const nodesByOwnerRef = new Map<string, Record<string, unknown>[]>()
  for (const node of currentNodes) {
    const relativePath = getString(node.path)
    const symbol = getString(node.symbol)
    if (!relativePath || !symbol) continue
    const key = ownerRefKey(relativePath, symbol)
    const matches = nodesByOwnerRef.get(key) || []
    matches.push(node)
    nodesByOwnerRef.set(key, matches)
  }

  const capabilities = readArray(context.documents.get('capability-ledger.json'), 'capabilities')
  for (const [capabilityIndex, capability] of capabilities.entries()) {
    if (!isJsonObject(capability)) continue
    const capabilityId = getString(capability.id)
    const cutoverUnitId = getString(capability.cutoverUnitId)
    const ownerRefs = isJsonObject(capability.ownerRefs) ? capability.ownerRefs : null
    for (const [ownerIndex, ownerRef] of getStringArray(ownerRefs?.legacy).entries()) {
      const issuePath = `capability-ledger.json.capabilities[${capabilityIndex}].ownerRefs.legacy[${ownerIndex}]`
      const parsed = parseOwnerRef(ownerRef)
      if (!parsed) {
        issues.push(createIssue(
          'error',
          'legacy-owner-ref-invalid',
          `Legacy owner ref must use a canonical path#symbol locator: ${ownerRef}`,
          issuePath,
        ))
        continue
      }
      const matches = nodesByOwnerRef.get(ownerRefKey(parsed.path, parsed.symbol)) || []
      if (matches.length === 0) {
        issues.push(createIssue(
          'blocker',
          'legacy-owner-ref-uninventoried',
          `Legacy owner ref is not represented by a current inventory locator: ${ownerRef}`,
          issuePath,
        ))
        continue
      }
      if (matches.length > 1) {
        issues.push(createIssue(
          'blocker',
          'legacy-owner-ref-ambiguous',
          `Legacy owner ref resolves to multiple current inventory entries: ${ownerRef}`,
          issuePath,
        ))
        continue
      }
      const [node] = matches
      if (capabilityId && node?.capabilityId !== capabilityId) {
        issues.push(createIssue(
          'blocker',
          'legacy-owner-ref-capability-mismatch',
          `Legacy owner ref ${ownerRef} is inventoried under ${String(node?.capabilityId)}, not ${capabilityId}`,
          issuePath,
        ))
      }
      if (cutoverUnitId && node?.cutoverUnitId !== cutoverUnitId) {
        issues.push(createIssue(
          'blocker',
          'legacy-owner-ref-cutover-unit-mismatch',
          `Legacy owner ref ${ownerRef} is inventoried under ${String(node?.cutoverUnitId)}, not ${cutoverUnitId}`,
          issuePath,
        ))
      }
    }
  }
}

function validateHistoricalCandidateSource(
  context: ValidationContext,
  issues: ValidationIssue[],
  candidate: Record<string, unknown>,
  candidatePath: string,
): void {
  const commit = getString(candidate.lastKnownCommit)
  const relativePath = getString(candidate.path)
  if (!commit || !relativePath) return
  if (!gitObjectExists(context.appRoot, commit)) {
    issues.push(createIssue(
      'blocker',
      'historical-candidate-commit-missing',
      `Historical candidate commit is unavailable: ${commit}`,
      `${candidatePath}.lastKnownCommit`,
    ))
    return
  }
  const bytes = readGitFileAtCommit(context.appRoot, commit, relativePath)
  if (!bytes) {
    issues.push(createIssue(
      'blocker',
      'historical-candidate-source-missing',
      `Historical candidate source is unavailable at ${commit}: ${relativePath}`,
      candidatePath,
    ))
    return
  }
  const sourceHash = getString(candidate.sourceHash)
  if (sourceHash && sha256Bytes(bytes) !== sourceHash) {
    issues.push(createIssue(
      'blocker',
      'historical-candidate-hash-mismatch',
      `Historical candidate hash is stale: ${relativePath}`,
      `${candidatePath}.sourceHash`,
    ))
  }
  const symbol = getString(candidate.symbol)
  const locatorKind = normalizeSourceLocatorKind(candidate.locatorKind)
  const locator = symbol && locatorKind
    ? inspectSourceLocator(bytes.toString('utf8'), relativePath, symbol, locatorKind)
    : null
  if (symbol && !locatorKind) {
    issues.push(createIssue(
      'error',
      'historical-candidate-locator-kind-invalid',
      `Historical candidate locator kind is invalid: ${String(candidate.locatorKind)}`,
      `${candidatePath}.locatorKind`,
    ))
  } else if (locator?.status === 'missing') {
    issues.push(createIssue(
      'blocker',
      'historical-candidate-symbol-missing',
      `Historical candidate symbol is missing: ${symbol}`,
      `${candidatePath}.symbol`,
    ))
  } else if (locator?.status === 'ambiguous') {
    issues.push(createIssue(
      'blocker',
      'historical-candidate-locator-ambiguous',
      `Historical candidate locator has ${locator.matchCount} logical matches: ${symbol}`,
      `${candidatePath}.symbol`,
    ))
  } else if (locator?.status === 'parse-error' || locator?.status === 'unsupported-language') {
    issues.push(createIssue(
      'blocker',
      'historical-candidate-locator-unverifiable',
      `Historical candidate locator cannot be parsed: ${symbol}`,
      `${candidatePath}.symbol`,
    ))
  }
}

function validateTombstoneProof(
  context: ValidationContext,
  issues: ValidationIssue[],
  tombstone: Record<string, unknown>,
  tombstonePath: string,
  reportEntriesById: Map<string, Record<string, unknown>>,
): void {
  const deletionCommit = getString(tombstone.deletionCommit)
  const relativePath = getString(tombstone.path)
  if (deletionCommit && relativePath) {
    if (!gitObjectExists(context.appRoot, deletionCommit)) {
      issues.push(createIssue(
        'blocker',
        'tombstone-deletion-commit-missing',
        `Tombstone deletion commit is unavailable: ${deletionCommit}`,
        `${tombstonePath}.deletionCommit`,
      ))
    } else {
      if (!gitCommitTouchesPath(context.appRoot, deletionCommit, relativePath)) {
        issues.push(createIssue(
          'blocker',
          'tombstone-deletion-path-unproven',
          `Deletion commit does not touch tombstone path: ${relativePath}`,
          `${tombstonePath}.deletionCommit`,
        ))
      }
      const deletedBytes = readGitFileAtCommit(context.appRoot, `${deletionCommit}^`, relativePath)
      const deletedSourceHash = getString(tombstone.deletedSourceHash)
      if (!deletedBytes) {
        issues.push(createIssue(
          'blocker',
          'tombstone-deleted-source-missing',
          `Deleted source is unavailable in the deletion commit parent: ${relativePath}`,
          tombstonePath,
        ))
      } else if (deletedSourceHash && sha256Bytes(deletedBytes) !== deletedSourceHash) {
        issues.push(createIssue(
          'blocker',
          'tombstone-deleted-source-hash-mismatch',
          `Deleted source hash is stale: ${relativePath}`,
          `${tombstonePath}.deletedSourceHash`,
        ))
      }
    }
  }

  const evidenceRef = isJsonObject(tombstone.deletionEvidenceRef)
    ? tombstone.deletionEvidenceRef
    : null
  const artifactId = getString(evidenceRef?.artifactId)
  const indexedArtifact = artifactId ? reportEntriesById.get(artifactId) : null
  if (!artifactId || !indexedArtifact) {
    issues.push(createIssue(
      'blocker',
      'tombstone-deletion-evidence-unresolved',
      `Tombstone deletion evidence is not indexed: ${artifactId || 'missing artifact id'}`,
      `${tombstonePath}.deletionEvidenceRef`,
    ))
  } else if (
    indexedArtifact.artifactKind !== 'evidence'
    || indexedArtifact.artifactSchemaId !== evidenceRef?.artifactSchemaId
    || indexedArtifact.contentHash !== evidenceRef?.contentHash
  ) {
    issues.push(createIssue(
      'blocker',
      'tombstone-deletion-evidence-mismatch',
      `Tombstone deletion evidence does not match indexed artifact ${artifactId}`,
      `${tombstonePath}.deletionEvidenceRef`,
    ))
  }
}

function validateInventory(
  context: ValidationContext,
  issues: ValidationIssue[],
  ledgerIndex: LedgerIndex,
): void {
  const inventory = context.documents.get('legacy-inventory.json')
  const appHead = tryReadGitHead(context.appRoot)
  const entries = readArray(inventory, 'entries')
  const objectEntries = entries.filter(isJsonObject)
  validateUniqueIds(issues, objectEntries, 'legacy-inventory.json.entries', 'inventory entry')
  const bootstrapRoots = readArray(inventory, 'bootstrapRoots').filter(isJsonObject)
  validateUniqueIds(issues, bootstrapRoots, 'legacy-inventory.json.bootstrapRoots', 'bootstrap root')
  const semanticScanRules = readArray(inventory, 'semanticScanRules').filter(isJsonObject)
  validateUniqueIds(issues, semanticScanRules, 'legacy-inventory.json.semanticScanRules', 'semantic scan rule')
  const historicalTouchsets = readArray(inventory, 'historicalTouchsets').filter(isJsonObject)
  validateUniqueIds(issues, historicalTouchsets, 'legacy-inventory.json.historicalTouchsets', 'historical touchset')
  const historicalCandidates = readArray(inventory, 'historicalCandidates').filter(isJsonObject)
  validateUniqueIds(issues, historicalCandidates, 'legacy-inventory.json.historicalCandidates', 'historical candidate')
  const declaredDynamicEdges = readArray(inventory, 'declaredDynamicEdges').filter(isJsonObject)
  validateUniqueIds(issues, declaredDynamicEdges, 'legacy-inventory.json.declaredDynamicEdges', 'declared dynamic edge')
  validateUniqueDynamicEdgeSemantics(
    issues,
    declaredDynamicEdges,
    'legacy-inventory.json.declaredDynamicEdges',
  )
  const approvedExclusions = readArray(inventory, 'approvedExclusions').filter(isJsonObject)
  validateUniqueIds(issues, approvedExclusions, 'legacy-inventory.json.approvedExclusions', 'approved exclusion')

  validateUniqueLocators(issues, objectEntries, 'legacy-inventory.json.entries', 'inventory entry')
  validateUniqueLocators(issues, approvedExclusions, 'legacy-inventory.json.approvedExclusions', 'approved exclusion')

  const entriesById = new Map(objectEntries.flatMap(value => {
    const id = getString(value.id)
    return id ? [[id, value] as const] : []
  }))
  const approvedExclusionsById = new Map(approvedExclusions.flatMap(value => {
    const id = getString(value.id)
    return id ? [[id, value] as const] : []
  }))
  const reportEntriesById = new Map(
    readArray(context.documents.get('report-index/index.json'), 'entries')
      .filter(isJsonObject)
      .flatMap(value => {
        const id = getString(value.artifactId)
        return id ? [[id, value] as const] : []
      }),
  )

  const currentNodes = objectEntries.filter(value => value.entryType === 'current-node')
  validateLegacyOwnerRefs(context, issues, currentNodes)
  for (const [index, value] of currentNodes.entries()) {
    const nodePath = `legacy-inventory.json.entries[current:${index}]`
    issues.push(...validateGitSourceReference({
      anchorField: 'symbol',
      commit: appHead,
      hashField: 'sourceHash',
      issuePath: nodePath,
      repositoryRoot: context.appRoot,
      source: value,
    }))
    validateInventoryMapping(issues, value, nodePath, ledgerIndex)
  }

  const currentInventoryLocators = new Set(currentNodes.flatMap(value => {
    const key = locatorKey(value)
    return key ? [key] : []
  }))
  const capabilityIdsByCurrentLocator = new Map<string, Set<string>>()
  for (const node of currentNodes) {
    const nodeLocator = locatorKey(node)
    const capabilityId = getString(node.capabilityId)
    if (!nodeLocator || !capabilityId) continue
    const capabilityIds = capabilityIdsByCurrentLocator.get(nodeLocator) || new Set<string>()
    capabilityIds.add(capabilityId)
    capabilityIdsByCurrentLocator.set(nodeLocator, capabilityIds)
  }
  const approvedCurrentExclusionLocators = new Set(approvedExclusions.flatMap(value => {
    if (value.candidateKind !== 'current') return []
    const key = locatorKey(value)
    return key ? [key] : []
  }))
  for (const [index, root] of bootstrapRoots.entries()) {
    const rootPath = `legacy-inventory.json.bootstrapRoots[${index}]`
    validateCanonicalLocatorPath(issues, root, rootPath)
    issues.push(...validateGitSourceReference({
      anchorField: 'symbol',
      commit: appHead,
      hashField: 'sourceHash',
      issuePath: rootPath,
      repositoryRoot: context.appRoot,
      source: root,
    }))
    const rootLocator = locatorKey(root)
    if (
      rootLocator
      && !currentInventoryLocators.has(rootLocator)
      && !approvedCurrentExclusionLocators.has(rootLocator)
    ) {
      issues.push(createIssue(
        'blocker',
        'bootstrap-root-not-inventoried',
        `Bootstrap root is not covered by a current inventory node or approved exclusion: ${getString(root.id) || index}`,
        rootPath,
      ))
    }
  }

  for (const [index, rule] of semanticScanRules.entries()) {
    for (const [scopeIndex, pathScope] of getStringArray(rule.pathScopes).entries()) {
      if (appHead && gitCommitContainsPathScope(context.appRoot, appHead, pathScope)) continue
      issues.push(createIssue(
        'blocker',
        'semantic-scan-scope-unresolved',
        `Semantic scan scope is unavailable at the input commit: ${pathScope}`,
        `legacy-inventory.json.semanticScanRules[${index}].pathScopes[${scopeIndex}]`,
      ))
    }
  }

  for (const [index, touchset] of historicalTouchsets.entries()) {
    const touchsetPath = `legacy-inventory.json.historicalTouchsets[${index}]`
    const fromCommit = getString(touchset.fromCommit)
    const throughCommit = getString(touchset.throughCommit)
    if (!fromCommit || !gitObjectExists(context.appRoot, fromCommit)) {
      issues.push(createIssue(
        'blocker',
        'historical-touchset-start-missing',
        `Historical touchset start commit is unavailable: ${fromCommit || 'unset'}`,
        `${touchsetPath}.fromCommit`,
      ))
    }
    if (!throughCommit || !gitObjectExists(context.appRoot, throughCommit)) {
      issues.push(createIssue(
        'blocker',
        'historical-touchset-end-missing',
        `Historical touchset end commit is unavailable: ${throughCommit || 'unset'}`,
        `${touchsetPath}.throughCommit`,
      ))
    }
    if (
      fromCommit
      && throughCommit
      && gitObjectExists(context.appRoot, fromCommit)
      && gitObjectExists(context.appRoot, throughCommit)
      && !isGitAncestor(context.appRoot, fromCommit, throughCommit)
    ) {
      issues.push(createIssue(
        'error',
        'historical-touchset-range-invalid',
        'Historical touchset fromCommit must be an ancestor of throughCommit',
        touchsetPath,
      ))
    }
    if (throughCommit && appHead && !isGitAncestor(context.appRoot, throughCommit, appHead)) {
      issues.push(createIssue(
        'error',
        'historical-touchset-after-input-commit',
        'Historical touchset cannot extend beyond the candidate input commit',
        `${touchsetPath}.throughCommit`,
      ))
    }
    for (const [scopeIndex, pathScope] of getStringArray(touchset.pathScopes).entries()) {
      if (throughCommit && gitCommitContainsPathScope(context.appRoot, throughCommit, pathScope)) continue
      issues.push(createIssue(
        'blocker',
        'historical-touchset-scope-unresolved',
        `Historical touchset scope is unavailable at throughCommit: ${pathScope}`,
        `${touchsetPath}.pathScopes[${scopeIndex}]`,
      ))
    }
  }

  for (const [index, edge] of declaredDynamicEdges.entries()) {
    const edgePath = `legacy-inventory.json.declaredDynamicEdges[${index}]`
    const source = isJsonObject(edge.source) ? { ...edge.source, sourceHash: edge.sourceHash } : edge.source
    issues.push(...validateGitSourceReference({
      anchorField: 'symbol',
      commit: appHead,
      hashField: 'sourceHash',
      issuePath: `${edgePath}.source`,
      repositoryRoot: context.appRoot,
      source,
    }))
    const target = isJsonObject(edge.target) ? edge.target : null
    const targetPath = getString(target?.path)
    if (edge.kind === 'process-handoff') {
      if (
        !targetPath
        || !EXTERNAL_PROCESS_TARGET_PATTERN.test(targetPath)
        || target?.symbol !== null
      ) {
        issues.push(createIssue(
          'error',
          'process-handoff-target-invalid',
          'Process handoff targets must use a symbol-free external-process/<identifier> locator',
          `${edgePath}.target`,
        ))
      }
    } else {
      if (targetPath?.startsWith('external-process/')) {
        issues.push(createIssue(
          'error',
          'external-process-target-kind-invalid',
          'Only process-handoff edges may target the external-process/ namespace',
          `${edgePath}.target`,
        ))
      } else {
        issues.push(...validateGitSourceReference({
          anchorField: 'symbol',
          commit: appHead,
          hashField: 'sourceHash',
          issuePath: `${edgePath}.target`,
          repositoryRoot: context.appRoot,
          source: edge.target,
        }))
      }
    }
    const fixtureId = getString(edge.fixtureId)
    const fixtureGloballyMapped = fixtureId ? ledgerIndex.fixtureIds.has(fixtureId) : false
    if (fixtureId && !fixtureGloballyMapped) {
      issues.push(createIssue(
        'blocker',
        'dynamic-edge-fixture-unmapped',
        `Dynamic edge fixture is not declared by any capability: ${fixtureId}`,
        `${edgePath}.fixtureId`,
      ))
    }
    if (!fixtureId) continue
    const attributedCapabilityIds = new Set<string>()
    for (const endpointName of ['source', 'target'] as const) {
      if (edge.kind === 'process-handoff' && endpointName === 'target') continue
      const endpoint = isJsonObject(edge[endpointName]) ? edge[endpointName] : null
      const endpointPath = getString(endpoint?.path)
      const endpointSymbol = endpoint?.symbol === null ? null : getString(endpoint?.symbol)
      const endpointLocator = endpoint ? locatorKey(endpoint) : null
      const endpointLabel = endpointPath
        ? `${endpointPath}#${endpointSymbol || '<null>'}`
        : 'missing locator'
      const endpointCapabilities = endpointLocator
        ? capabilityIdsByCurrentLocator.get(endpointLocator) || new Set<string>()
        : new Set<string>()
      if (endpointCapabilities.size === 0) {
        issues.push(createIssue(
          'blocker',
          'dynamic-edge-attribution-unresolved',
          `Dynamic edge ${endpointName} has no current inventory capability: ${endpointLabel}`,
          `${edgePath}.${endpointName}`,
        ))
      } else if (endpointCapabilities.size > 1) {
        issues.push(createIssue(
          'blocker',
          'dynamic-edge-attribution-ambiguous',
          `Dynamic edge ${endpointName} maps to multiple capabilities: ${[...endpointCapabilities].sort().join(', ')}`,
          `${edgePath}.${endpointName}`,
        ))
      } else {
        attributedCapabilityIds.add([...endpointCapabilities][0]!)
      }
    }
    for (const capabilityId of attributedCapabilityIds) {
      if (!fixtureGloballyMapped) continue
      if (ledgerIndex.fixturesByCapability.get(capabilityId)?.has(fixtureId)) continue
      issues.push(createIssue(
        'blocker',
        'dynamic-edge-fixture-capability-mismatch',
        `Dynamic edge fixture ${fixtureId} is not declared by attributed capability ${capabilityId}`,
        `${edgePath}.fixtureId`,
      ))
    }
  }

  const retiredTombstones = objectEntries.filter(value => value.entryType === 'retired-tombstone')
  for (const [index, value] of retiredTombstones.entries()) {
    const tombstonePath = `legacy-inventory.json.entries[tombstone:${index}]`
    const relativePath = getString(value.path)
    const symbol = getString(value.symbol)
    if (relativePath) {
      const currentState = appHead
        ? readGitPathAtCommit(context.appRoot, appHead, relativePath)
        : { status: 'unavailable' } as const
      if (currentState.status === 'unavailable') {
        issues.push(createIssue(
          'blocker',
          'tombstone-current-path-unavailable',
          `Cannot prove that the retired tombstone path is absent from the current tree: ${relativePath}`,
          tombstonePath,
        ))
      } else if (currentState.status === 'present') {
        const locatorKind = normalizeSourceLocatorKind(value.locatorKind)
        const currentLocator = symbol && locatorKind
          ? inspectSourceLocator(currentState.bytes.toString('utf8'), relativePath, symbol, locatorKind)
          : null
        if (
          symbol
          && (!currentLocator
            || currentLocator.status === 'parse-error'
            || currentLocator.status === 'unsupported-language')
        ) {
          issues.push(createIssue(
            'blocker',
            'tombstone-current-locator-unverifiable',
            `Cannot prove that the retired tombstone locator is absent from the current tree: ${relativePath}#${symbol}`,
            tombstonePath,
          ))
        } else if (
          !symbol
          || currentLocator?.status === 'matched'
          || currentLocator?.status === 'ambiguous'
        ) {
          issues.push(createIssue(
            'error',
            'tombstone-still-current',
            `Retired tombstone still exists in the current tree: ${relativePath}`,
            tombstonePath,
          ))
        }
      }
    }
    validateInventoryMapping(issues, value, tombstonePath, ledgerIndex)
    validateTombstoneProof(context, issues, value, tombstonePath, reportEntriesById)
  }

  for (const [index, value] of historicalCandidates.entries()) {
    const candidatePath = `legacy-inventory.json.historicalCandidates[${index}]`
    validateCanonicalLocatorPath(issues, value, candidatePath)
    validateHistoricalCandidateSource(context, issues, value, candidatePath)
    if (value.resolution === null) {
      issues.push(createIssue(
        'blocker',
        'historical-candidate-unresolved',
        `Historical candidate is unresolved: ${getString(value.id) || index}`,
        candidatePath,
      ))
      continue
    }
    if (!isJsonObject(value.resolution)) continue
    const resolutionKind = getString(value.resolution.kind)
    const resolutionRefId = getString(value.resolution.refId)
    const resolvedEntry = resolutionRefId ? entriesById.get(resolutionRefId) : null
    const resolvedExclusion = resolutionRefId ? approvedExclusionsById.get(resolutionRefId) : null
    const resolvedRecord = resolutionKind === 'approved-exclusion' ? resolvedExclusion : resolvedEntry
    const resolutionMatches = resolutionKind === 'approved-exclusion'
      ? resolvedExclusion?.candidateKind === 'historical'
      : resolvedEntry?.entryType === resolutionKind
    if (!resolutionRefId || !resolutionMatches) {
      issues.push(createIssue(
        'blocker',
        'historical-candidate-resolution-unresolved',
        `Historical candidate resolution does not identify a ${resolutionKind || 'known'} record: ${resolutionRefId || 'missing ref id'}`,
        `${candidatePath}.resolution`,
      ))
    } else if (resolvedRecord && locatorKey(value) !== locatorKey(resolvedRecord)) {
      issues.push(createIssue(
        'blocker',
        'historical-candidate-resolution-locator-mismatch',
        `Historical candidate resolution points to a different locator: ${resolutionRefId}`,
        `${candidatePath}.resolution`,
      ))
    }
  }

  const decisionIds = new Set<string>()
  for (const [index, exclusion] of approvedExclusions.entries()) {
    const exclusionPath = `legacy-inventory.json.approvedExclusions[${index}]`
    const decision = isJsonObject(exclusion.decision) ? exclusion.decision : null
    if (decision?.type !== 'intentional-exclusion') {
      issues.push(createIssue(
        'error',
        'approved-exclusion-decision-kind-invalid',
        'Approved exclusions require an intentional-exclusion decision',
        `${exclusionPath}.decision.type`,
      ))
    }
    const decisionId = getString(decision?.decisionId)
    if (decisionId && decisionIds.has(decisionId)) {
      issues.push(createIssue(
        'error',
        'duplicate-decision-id',
        `Duplicate approved exclusion decision id: ${decisionId}`,
        `${exclusionPath}.decision.decisionId`,
      ))
    }
    if (decisionId) decisionIds.add(decisionId)
  }
}

function validatePolicies(context: ValidationContext, issues: ValidationIssue[]): void {
  const releaseTargets = context.documents.get('release-targets.json')
  const targetValues = readArray(releaseTargets, 'targets')
  const releaseTargetIds = validateUniqueIds(
    issues,
    targetValues,
    'release-targets.json.targets',
    'release target',
  )
  const releaseBlockers = readArray(releaseTargets, 'blockers')
  const releaseBlockerIds = validateUniqueIds(
    issues,
    releaseBlockers,
    'release-targets.json.blockers',
    'release blocker',
  )
  for (const [index, value] of targetValues.entries()) {
    if (!isJsonObject(value)) continue
    const decision = getString(value.scopeDecision) || getString(value.decision) || getString(value.inclusion)
    if (decision === 'undecided') {
      issues.push(createIssue('blocker', 'release-target-undecided', `Release target is undecided: ${getString(value.id) || index}`, `release-targets.json.targets[${index}]`))
    }
    for (const blockerId of getStringArray(value.blockerIds)) {
      if (releaseBlockerIds.has(blockerId)) continue
      issues.push(createIssue(
        'error',
        'release-target-blocker-missing',
        `Release target references an unknown blocker: ${blockerId}`,
        `release-targets.json.targets[${index}].blockerIds`,
      ))
    }
  }
  for (const [index, value] of releaseBlockers.entries()) {
    if (!isJsonObject(value)) continue
    const targetId = getString(value.targetId)
    if (targetId && !releaseTargetIds.has(targetId)) {
      issues.push(createIssue(
        'error',
        'release-blocker-target-missing',
        `Release blocker references an unknown target: ${targetId}`,
        `release-targets.json.blockers[${index}].targetId`,
      ))
    }
    const target = targetValues.find(candidate => isJsonObject(candidate) && candidate.id === targetId)
    if (isJsonObject(target) && !getStringArray(target.blockerIds).includes(getString(value.id) || '')) {
      issues.push(createIssue(
        'error',
        'release-blocker-backref-missing',
        `Release blocker is not referenced by its target: ${getString(value.id) || index}`,
        `release-targets.json.blockers[${index}]`,
      ))
    }
  }
  if (releaseBlockers.length > 0) {
    issues.push(createIssue('blocker', 'release-targets-unresolved', 'Release target policy still declares blockers', 'release-targets.json.blockers'))
  }
  for (const finding of validateReleaseConfiguration(context)) {
    issues.push(createIssue('blocker', finding.code, finding.message, finding.path))
  }

  const retention = context.documents.get('evidence-retention-policy.json')
  if (
    retention?.promotionMode !== 'enabled'
    || readArray(retention, 'officialStores').length === 0
  ) {
    issues.push(createIssue('blocker', 'retention-store-unconfigured', 'Durable evidence storage and retention are not configured', 'evidence-retention-policy.json'))
  }

  const trust = context.documents.get('validator-trust-policy.json')
  if (
    trust?.trustMode !== 'active'
    || readArray(trust, 'approvalProviders').length === 0
    || readArray(trust, 'trustedValidatorBundles').length === 0
    || readArray(trust, 'trustedRunnerIdentities').length === 0
  ) {
    issues.push(createIssue('blocker', 'validator-trust-unconfigured', 'Validator trust anchor and runner identities are not configured', 'validator-trust-policy.json'))
  }
  issues.push(createIssue(
    'blocker',
    'validator-trust-verification-not-implemented',
    'Candidate validation cannot verify external approvals or trusted runner attestations',
    'validator-trust-policy.json',
  ))

  const automation = context.documents.get('automation-policy.json')
  if (automation?.runtimeModificationMode !== 'report-only') {
    issues.push(createIssue('blocker', 'automation-enabled-before-g2', 'Automatic runtime modification requires a trusted passed G2 report', 'automation-policy.json'))
  }

  const riskPolicy = context.documents.get('risk-policy.json')
  const knownRiskTags = new Set(getStringArray(riskPolicy?.knownRiskTags))
  const rules = readArray(riskPolicy, 'rules')
  validateUniqueIds(issues, rules, 'risk-policy.json.rules', 'risk rule')
  for (const [index, value] of rules.entries()) {
    if (!isJsonObject(value)) continue
    for (const riskTag of getStringArray(value.addRiskTags)) {
      if (knownRiskTags.has(riskTag)) continue
      issues.push(createIssue(
        'error',
        'risk-policy-unknown-derived-tag',
        `Risk rule adds an unknown risk tag: ${riskTag}`,
        `risk-policy.json.rules[${index}].addRiskTags`,
      ))
    }
  }
}

function validateReportIndex(context: ValidationContext, issues: ValidationIssue[]): void {
  const reportIndex = context.documents.get('report-index/index.json')
  const entries = readArray(reportIndex, 'entries')
  const artifactIds = new Set<string>()
  const contentHashes = new Map<string, string>()
  for (const [index, entry] of entries.entries()) {
    if (!isJsonObject(entry)) continue
    const entryPath = `report-index/index.json.entries[${index}]`
    const artifactId = getString(entry.artifactId)
    const artifactKind = getString(entry.artifactKind)
    const contentHash = getString(entry.contentHash)
    if (artifactId) {
      if (artifactIds.has(artifactId)) {
        issues.push(createIssue('error', 'duplicate-artifact-id', `Duplicate artifact id: ${artifactId}`, `${entryPath}.artifactId`))
      }
      artifactIds.add(artifactId)
    }
    if (contentHash && artifactId) {
      const existingArtifactId = contentHashes.get(contentHash)
      if (existingArtifactId && existingArtifactId !== artifactId) {
        issues.push(createIssue(
          'error',
          'duplicate-artifact-content',
          `Content hash is indexed by both ${existingArtifactId} and ${artifactId}`,
          `${entryPath}.contentHash`,
        ))
      }
      contentHashes.set(contentHash, artifactId)
    }
    const expectedSchemaId = artifactKind ? ARTIFACT_SCHEMA_IDS[artifactKind] : null
    if (expectedSchemaId && entry.artifactSchemaId !== expectedSchemaId) {
      issues.push(createIssue(
        'error',
        'artifact-schema-kind-mismatch',
        `Artifact kind ${artifactKind} must use ${expectedSchemaId}`,
        `${entryPath}.artifactSchemaId`,
      ))
    }
    const locations = readArray(entry, 'locations').filter(isJsonObject)
    if (locations.filter(location => location.canonical === true).length !== 1) {
      issues.push(createIssue(
        'error',
        'artifact-canonical-location-invalid',
        'An indexed artifact must have exactly one canonical location',
        `${entryPath}.locations`,
      ))
    }
    const validationSummary = isJsonObject(entry.validationSummary) ? entry.validationSummary : {}
    if (
      validationSummary.schemaValidated !== true
      || validationSummary.hashValidated !== true
    ) {
      issues.push(createIssue(
        'blocker',
        'artifact-index-summary-invalid',
        'Indexed artifact summary is not schema-valid and hash-valid',
        `${entryPath}.validationSummary`,
      ))
    }
  }
  const artifactKinds = new Set(entries.flatMap(entry => (
    isJsonObject(entry) && typeof entry.artifactKind === 'string'
      ? [entry.artifactKind]
      : []
  )))
  if (!artifactKinds.has('gate')) {
    issues.push(createIssue('blocker', 'g0-report-missing', 'No canonical G0 Gate report is indexed', 'report-index/index.json'))
  } else {
    issues.push(createIssue(
      'blocker',
      'g0-report-unresolved',
      'A gate entry exists, but candidate preflight cannot establish that its canonical bytes are a passed G0 report',
      'report-index/index.json',
    ))
  }
  for (const [artifactKind, code, message] of [
    ['capability-state', 'capability-state-report-missing', 'No capability-state report is indexed'],
    ['local-closure', 'local-closure-report-missing', 'No local-closure report is indexed'],
    ['artifact-availability', 'availability-report-missing', 'No artifact-availability report is indexed'],
  ] as const) {
    if (!artifactKinds.has(artifactKind)) {
      issues.push(createIssue('blocker', code, message, 'report-index/index.json'))
    }
  }
  issues.push(createIssue(
    'blocker',
    'canonical-artifact-resolution-not-implemented',
    'Candidate preflight cannot promote report-index summaries; formal validation must resolve canonical artifact bytes and hashes',
    'report-index/index.json',
  ))
}

export function validateCrossFileInvariants(context: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = validatePinnedUpstreamState(context)
  const ledgerIndex = validateLedger(context, issues)
  validateInventory(context, issues, ledgerIndex)
  validatePolicies(context, issues)
  validateReportIndex(context, issues)
  return issues
}
