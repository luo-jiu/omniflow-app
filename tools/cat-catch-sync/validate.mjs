import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/
const CAPABILITY_STATES = new Set([
  'pending',
  'porting',
  'ported-unverified',
  'verified',
  'excluded',
])
const CLOSED_CAPABILITY_STATES = new Set(['verified', 'excluded'])
const ORIGINS = new Set(['upstream-derived', 'cross-boundary', 'omniflow-integration'])
const UPSTREAM_RELATIONS = new Set([
  'exact',
  'semantic-equivalent',
  'platform-substitute',
  'not-applicable',
])
const CLEANUP_ACTIONS = new Set(['remove-after-cutover', 'retain-or-adapt'])
const CLEANUP_CLASSIFICATIONS = new Set(['legacy', 'omniflow-integration'])
const TEST_PATH_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const defaultAppRoot = path.resolve(scriptDirectory, '../..')

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function validateStringArray(value, label, issues, { minimum = 0 } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`)
    return []
  }
  const valid = []
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.length === 0) {
      issues.push(`${label}[${index}] must be a non-empty string`)
      continue
    }
    valid.push(item)
  }
  if (valid.length < minimum) issues.push(`${label} must contain at least ${minimum} item(s)`)
  return valid
}

function requireUniqueValues(values, label, issues) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) issues.push(`${label} contains duplicate value: ${value}`)
    seen.add(value)
  }
  return seen
}

function requireUniqueIds(items, label, issues) {
  const seen = new Set()
  for (const [index, item] of items.entries()) {
    const id = isObject(item) ? item.id : null
    if (typeof id !== 'string' || id.length === 0) {
      issues.push(`${label}[${index}].id must be a non-empty string`)
      continue
    }
    if (seen.has(id)) issues.push(`${label} contains duplicate id: ${id}`)
    seen.add(id)
  }
  return seen
}

function parseRef(ref) {
  if (typeof ref !== 'string') return null
  const separator = ref.indexOf('#')
  if (separator <= 0 || separator === ref.length - 1) return null
  return { relativePath: ref.slice(0, separator), symbol: ref.slice(separator + 1) }
}

function isCapabilityCompleteForTarget(capability, migrationTarget) {
  return CLOSED_CAPABILITY_STATES.has(capability?.syncState)
    && capability.syncedThrough === migrationTarget
}

function resolveLocalPath(appRoot, relativePath, label, issues) {
  const absolutePath = path.resolve(appRoot, relativePath)
  const rootPrefix = `${path.resolve(appRoot)}${path.sep}`
  if (absolutePath !== path.resolve(appRoot) && !absolutePath.startsWith(rootPrefix)) {
    issues.push(`${label} escapes the app root: ${relativePath}`)
    return null
  }
  return absolutePath
}

function readLocalSource(absolutePath, sourceCache) {
  if (sourceCache.has(absolutePath)) return sourceCache.get(absolutePath)
  const source = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null
  sourceCache.set(absolutePath, source)
  return source
}

function validateLocalRef({
  appRoot,
  ref,
  label,
  issues,
  sourceCache,
  mustExist = false,
  mustBeAbsent = false,
}) {
  const parsed = parseRef(ref)
  if (!parsed) {
    issues.push(`${label} must use path#symbol: ${String(ref)}`)
    return
  }
  const absolutePath = resolveLocalPath(appRoot, parsed.relativePath, label, issues)
  if (!absolutePath) return
  const source = readLocalSource(absolutePath, sourceCache)
  const symbolExists = source?.includes(parsed.symbol) === true
  if (mustExist && source === null) {
    issues.push(`${label} path does not exist: ${parsed.relativePath}`)
  } else if (mustExist && !symbolExists) {
    issues.push(`${label} symbol does not exist in ${parsed.relativePath}: ${parsed.symbol}`)
  }
  if (mustBeAbsent && symbolExists) {
    issues.push(`${label} symbol must be removed from ${parsed.relativePath}: ${parsed.symbol}`)
  }
}

function validateCleanupRef({
  appRoot,
  entry,
  label,
  issues,
  sourceCache,
  mustExist,
}) {
  if (typeof entry.path !== 'string' || entry.path.length === 0) {
    issues.push(`${label}.path must be a non-empty string`)
    return
  }
  if (typeof entry.symbol !== 'string' || entry.symbol.length === 0) {
    issues.push(`${label}.symbol must be a non-empty string`)
    return
  }
  validateLocalRef({
    appRoot,
    ref: `${entry.path}#${entry.symbol}`,
    label,
    issues,
    sourceCache,
    mustExist,
    mustBeAbsent: !mustExist,
  })
}

export function loadDocuments(appRoot = defaultAppRoot) {
  const readJson = relativePath => JSON.parse(readFileSync(path.join(appRoot, relativePath), 'utf8'))
  return {
    state: readJson('docs/cat-catch/upstream-state.json'),
    capabilityMap: readJson('docs/cat-catch/capability-map.json'),
    legacyCleanup: readJson('docs/cat-catch/legacy-cleanup.json'),
  }
}

export function validateDocuments({
  appRoot = defaultAppRoot,
  state,
  capabilityMap,
  legacyCleanup,
}) {
  const issues = []
  const sourceCache = new Map()
  const hasLegacyCleanup = legacyCleanup !== null && legacyCleanup !== undefined

  if (!isObject(state) || state.schemaVersion !== 1) {
    issues.push('upstream-state.json must be a schemaVersion 1 object')
  }
  if (!isObject(capabilityMap) || capabilityMap.schemaVersion !== 1) {
    issues.push('capability-map.json must be a schemaVersion 1 object')
  }
  if (!hasLegacyCleanup) {
    issues.push('legacy-cleanup.json is required while initial cleanup validation is active')
  } else if (!isObject(legacyCleanup) || legacyCleanup.schemaVersion !== 1) {
    issues.push('legacy-cleanup.json must be a schemaVersion 1 object')
  }

  for (const field of ['baselineCursor', 'observedHead', 'migrationTarget']) {
    if (!COMMIT_PATTERN.test(String(state?.[field] || ''))) {
      issues.push(`upstream-state.${field} must be a lowercase 40-character commit`)
    }
  }
  for (const field of ['reviewedThrough', 'portedThrough']) {
    const value = state?.[field]
    if (value !== null && !COMMIT_PATTERN.test(String(value || ''))) {
      issues.push(`upstream-state.${field} must be null or a lowercase 40-character commit`)
    }
  }
  if (typeof state?.repository !== 'string' || !state.repository.startsWith('https://')) {
    issues.push('upstream-state.repository must be an https URL')
  }
  if (typeof state?.branch !== 'string' || !BRANCH_PATTERN.test(state.branch)) {
    issues.push('upstream-state.branch must be a valid non-empty branch name')
  }
  if (!DATE_PATTERN.test(String(state?.lastCheckedAt || ''))) {
    issues.push('upstream-state.lastCheckedAt must use YYYY-MM-DD')
  }

  const units = asArray(capabilityMap?.cutoverUnits)
  const capabilities = asArray(capabilityMap?.capabilities)
  const cleanupEntries = hasLegacyCleanup ? asArray(legacyCleanup?.entries) : []
  const unitIds = requireUniqueIds(units, 'capabilityMap.cutoverUnits', issues)
  const capabilityIds = requireUniqueIds(capabilities, 'capabilityMap.capabilities', issues)
  requireUniqueIds(cleanupEntries, 'legacyCleanup.entries', issues)

  const unitCapabilities = new Map([...unitIds].map(id => [id, []]))
  const capabilityById = new Map()
  const currentImplementationRefs = []
  for (const [index, capability] of capabilities.entries()) {
    if (!isObject(capability)) {
      issues.push(`capabilityMap.capabilities[${index}] must be an object`)
      continue
    }
    const label = `capability ${String(capability.id)}`
    capabilityById.set(capability.id, capability)
    if (!unitIds.has(capability.cutoverUnitId)) {
      issues.push(`${label} references unknown cutover unit: ${String(capability.cutoverUnitId)}`)
    } else {
      unitCapabilities.get(capability.cutoverUnitId).push(capability)
    }
    if (!ORIGINS.has(capability.origin)) {
      issues.push(`${label} has invalid origin: ${String(capability.origin)}`)
    }
    if (!UPSTREAM_RELATIONS.has(capability.relationToUpstream)) {
      issues.push(`${label} has invalid relationToUpstream: ${String(capability.relationToUpstream)}`)
    }
    if (!CAPABILITY_STATES.has(capability.syncState)) {
      issues.push(`${label} has invalid syncState: ${String(capability.syncState)}`)
    }
    if (capability.syncedThrough !== null
      && !COMMIT_PATTERN.test(String(capability.syncedThrough || ''))) {
      issues.push(`${label}.syncedThrough must be null or a lowercase 40-character commit`)
    }
    if (capability.syncState === 'ported-unverified'
      && capability.syncedThrough !== state?.migrationTarget) {
      issues.push(`${label}.syncedThrough must equal migrationTarget once target code is ported`)
    }
    if (CLOSED_CAPABILITY_STATES.has(capability.syncState)
      && capability.syncedThrough === null) {
      issues.push(`${label}.syncedThrough must retain the last verified or excluded commit`)
    }

    const upstreamRefs = asArray(capability.upstreamRefs)
    if (capability.origin === 'omniflow-integration') {
      if (upstreamRefs.length > 0) issues.push(`${label} cannot have upstream refs for OmniFlow-only integration`)
      if (capability.relationToUpstream !== 'not-applicable') {
        issues.push(`${label} must use relationToUpstream=not-applicable for OmniFlow-only integration`)
      }
    } else {
      if (upstreamRefs.length === 0) issues.push(`${label} must retain at least one upstream ref`)
      if (capability.relationToUpstream === 'not-applicable') {
        issues.push(`${label} must describe how it relates to upstream`)
      }
    }
    for (const [refIndex, upstreamRef] of upstreamRefs.entries()) {
      if (!isObject(upstreamRef) || typeof upstreamRef.path !== 'string' || upstreamRef.path.length === 0) {
        issues.push(`${label}.upstreamRefs[${refIndex}] must have a path`)
        continue
      }
      const anchors = validateStringArray(
        upstreamRef.anchors,
        `${label}.upstreamRefs[${refIndex}].anchors`,
        issues,
        { minimum: 1 },
      )
      requireUniqueValues(anchors, `${label}.upstreamRefs[${refIndex}].anchors`, issues)
    }

    const currentRefs = validateStringArray(
      capability.currentImplementationRefs,
      `${label}.currentImplementationRefs`,
      issues,
    )
    for (const ref of currentRefs) {
      currentImplementationRefs.push(ref)
      validateLocalRef({ appRoot, ref, label: `${label}.currentImplementationRefs`, issues, sourceCache })
    }

    const targetRefs = validateStringArray(capability.targetRefs, `${label}.targetRefs`, issues)
    if (capability.syncState !== 'excluded' && targetRefs.length === 0) {
      issues.push(`${label} must have a target ref unless excluded`)
    }
    if (capability.syncState === 'excluded' && targetRefs.length > 0) {
      issues.push(`${label} cannot have target refs when excluded`)
    }
    const targetMustExist = capability.syncState === 'ported-unverified'
      || capability.syncState === 'verified'
    for (const ref of targetRefs) {
      validateLocalRef({
        appRoot,
        ref,
        label: `${label}.targetRefs`,
        issues,
        sourceCache,
        mustExist: targetMustExist,
      })
    }

    const plannedTestIds = validateStringArray(
      capability.plannedTestIds,
      `${label}.plannedTestIds`,
      issues,
      { minimum: capability.syncState === 'excluded' ? 0 : 1 },
    )
    requireUniqueValues(plannedTestIds, `${label}.plannedTestIds`, issues)
    const testRefs = validateStringArray(capability.testRefs, `${label}.testRefs`, issues)
    requireUniqueValues(testRefs, `${label}.testRefs`, issues)
    if (capability.syncState === 'verified' && testRefs.length === 0) {
      issues.push(`${label} must have test refs when verified`)
    }
    const referencedTestIds = new Set()
    for (const ref of testRefs) {
      const parsed = parseRef(ref)
      if (parsed && !TEST_PATH_PATTERN.test(parsed.relativePath)) {
        issues.push(`${label}.testRefs must point to a test/spec file: ${parsed.relativePath}`)
      }
      if (parsed) referencedTestIds.add(parsed.symbol)
      validateLocalRef({
        appRoot,
        ref,
        label: `${label}.testRefs`,
        issues,
        sourceCache,
        mustExist: true,
      })
    }
    if (capability.syncState === 'verified') {
      for (const plannedTestId of plannedTestIds) {
        if (!referencedTestIds.has(plannedTestId)) {
          issues.push(`${label} planned test has no matching testRef: ${plannedTestId}`)
        }
      }
    }
    const acceptedDifferences = validateStringArray(
      capability.acceptedDifferences,
      `${label}.acceptedDifferences`,
      issues,
    )
    if (capability.syncState === 'excluded' && acceptedDifferences.length === 0) {
      issues.push(`${label} must record an exclusion reason in acceptedDifferences`)
    }
    if (typeof capability.notes !== 'string' || capability.notes.length === 0) {
      issues.push(`${label}.notes must be a non-empty string`)
    }
  }

  const unitClosed = new Map()
  const unitOrders = []
  for (const unit of units) {
    if (!isObject(unit)) continue
    const label = `cutover unit ${String(unit.id)}`
    if (!Number.isInteger(unit.order) || unit.order < 1) {
      issues.push(`${label}.order must be a positive integer`)
    } else {
      unitOrders.push(String(unit.order))
    }
    if (typeof unit.description !== 'string' || unit.description.length === 0) {
      issues.push(`${label}.description must be a non-empty string`)
    }
    const dispatchRefs = validateStringArray(
      unit.dispatchBoundaryRefs,
      `${label}.dispatchBoundaryRefs`,
      issues,
      { minimum: 1 },
    )
    for (const ref of dispatchRefs) {
      validateLocalRef({
        appRoot,
        ref,
        label: `${label}.dispatchBoundaryRefs`,
        issues,
        sourceCache,
        mustExist: true,
      })
    }

    const members = asArray(unitCapabilities.get(unit.id))
    if (members.length === 0) issues.push(`${label} must contain at least one capability`)
    const isClosed = members.length > 0
      && members.every(capability => (
        isCapabilityCompleteForTarget(capability, state?.migrationTarget)
      ))
    unitClosed.set(unit.id, isClosed)
    if (isClosed && !members.some(capability => capability.syncState === 'verified')) {
      issues.push(`${label} cannot close with every capability excluded`)
    }
    if (hasLegacyCleanup
      && !isClosed
      && members.some(capability => (
        capability.syncState === 'verified'
          && capability.syncedThrough === state?.migrationTarget
      ))) {
      issues.push(`${label} cannot contain verified capabilities before the whole unit closes`)
    }
    if (hasLegacyCleanup && !isClosed) {
      for (const capability of members) {
        for (const ref of asArray(capability.currentImplementationRefs)) {
          validateLocalRef({
            appRoot,
            ref,
            label: `capability ${capability.id}.currentImplementationRefs`,
            issues,
            sourceCache,
            mustExist: true,
          })
        }
      }
    }
  }
  requireUniqueValues(unitOrders, 'capabilityMap.cutoverUnits.order', issues)

  const openCapabilities = capabilities.filter(capability => (
    !isCapabilityCompleteForTarget(capability, state?.migrationTarget)
  ))
  if (openCapabilities.length === 0 && state?.portedThrough !== state?.migrationTarget) {
    issues.push('upstream-state.portedThrough must equal migrationTarget when all capabilities close')
  }
  if (openCapabilities.length === 0 && state?.reviewedThrough !== state?.migrationTarget) {
    issues.push('upstream-state.reviewedThrough must equal migrationTarget when all capabilities close')
  }
  if (state?.portedThrough !== null && state?.reviewedThrough === null) {
    issues.push('upstream-state.reviewedThrough must be set before portedThrough')
  }
  const cleanupRefs = []
  for (const [index, entry] of cleanupEntries.entries()) {
    if (!isObject(entry)) {
      issues.push(`legacyCleanup.entries[${index}] must be an object`)
      continue
    }
    const label = `legacy cleanup ${String(entry.id)}`
    const capability = capabilityById.get(entry.capabilityId)
    if (!capabilityIds.has(entry.capabilityId)) {
      issues.push(`${label} references unknown capability: ${String(entry.capabilityId)}`)
    }
    if (!unitIds.has(entry.cutoverUnitId)) {
      issues.push(`${label} references unknown cutover unit: ${String(entry.cutoverUnitId)}`)
    }
    if (capability && entry.cutoverUnitId !== capability.cutoverUnitId) {
      issues.push(`${label} cutover unit must match capability ${capability.id}`)
    }
    if (!CLEANUP_ACTIONS.has(entry.cleanupAction)) {
      issues.push(`${label} has invalid cleanupAction: ${String(entry.cleanupAction)}`)
    }
    if (!CLEANUP_CLASSIFICATIONS.has(entry.classification)) {
      issues.push(`${label} has invalid classification: ${String(entry.classification)}`)
    }
    if (entry.classification === 'legacy' && entry.cleanupAction !== 'remove-after-cutover') {
      issues.push(`${label} legacy code must use cleanupAction=remove-after-cutover`)
    }
    if (entry.classification === 'omniflow-integration'
      && entry.cleanupAction !== 'retain-or-adapt') {
      issues.push(`${label} OmniFlow integration must use cleanupAction=retain-or-adapt`)
    }
    if (typeof entry.path === 'string' && typeof entry.symbol === 'string') {
      cleanupRefs.push(`${entry.path}#${entry.symbol}`)
    }

    const removeAfterCutover = entry.cleanupAction === 'remove-after-cutover'
    const mustExist = !removeAfterCutover || !unitClosed.get(entry.cutoverUnitId)
    validateCleanupRef({ appRoot, entry, label, issues, sourceCache, mustExist })
  }
  requireUniqueValues(cleanupRefs, 'legacyCleanup path#symbol refs', issues)
  if (hasLegacyCleanup) {
    const cleanupRefSet = new Set(cleanupRefs)
    for (const ref of new Set(currentImplementationRefs)) {
      if (!cleanupRefSet.has(ref)) {
        issues.push(`current implementation ref has no legacy cleanup classification: ${ref}`)
      }
    }
  }

  return issues
}

function git(sourceDir, args) {
  return execFileSync('git', args, { cwd: sourceDir, encoding: 'utf8' }).trim()
}

function isAncestor(sourceDir, older, newer) {
  return spawnSync('git', ['merge-base', '--is-ancestor', older, newer], {
    cwd: sourceDir,
    stdio: 'ignore',
  }).status === 0
}

function normalizeRepository(value) {
  return String(value || '')
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
}

function isSafeUpstreamPath(relativePath) {
  return typeof relativePath === 'string'
    && relativePath.length > 0
    && !path.posix.isAbsolute(relativePath)
    && !relativePath.includes('\\')
    && !relativePath.split('/').includes('..')
}

export function validateUpstream({ sourceDir, state, capabilityMap }) {
  const issues = []
  if (!existsSync(sourceDir)) return [`upstream source directory does not exist: ${sourceDir}`]

  try {
    const remote = git(sourceDir, ['remote', 'get-url', 'origin'])
    if (normalizeRepository(remote) !== normalizeRepository(state.repository)) {
      issues.push(`upstream origin does not match state.repository: ${remote}`)
    }
  } catch {
    issues.push('upstream origin remote is unavailable')
  }

  const commitCursors = [
    ...['baselineCursor', 'observedHead', 'migrationTarget', 'reviewedThrough', 'portedThrough']
      .map(field => [`upstream ${field}`, state[field]]),
    ...asArray(capabilityMap.capabilities)
      .filter(capability => capability?.syncedThrough !== null)
      .map(capability => [`capability ${capability.id}.syncedThrough`, capability.syncedThrough]),
  ]
  const checkedCommits = new Map()
  for (const [label, commit] of commitCursors) {
    if (commit === null) continue
    if (checkedCommits.has(commit)) {
      if (!checkedCommits.get(commit)) issues.push(`${label} is unavailable: ${String(commit)}`)
      continue
    }
    try {
      const resolvesExactly = git(sourceDir, ['rev-parse', '--verify', `${commit}^{commit}`]) === commit
      checkedCommits.set(commit, resolvesExactly)
      if (!resolvesExactly) issues.push(`${label} does not resolve exactly: ${commit}`)
    } catch {
      checkedCommits.set(commit, false)
      issues.push(`${label} is unavailable: ${String(commit)}`)
    }
  }

  try {
    const branchHead = git(sourceDir, [
      'rev-parse',
      '--verify',
      `refs/remotes/origin/${state.branch}^{commit}`,
    ])
    if (branchHead !== state.observedHead) {
      issues.push(`upstream observedHead must equal origin/${state.branch}: ${branchHead}`)
    }
  } catch {
    issues.push(`upstream origin/${state.branch} is unavailable`)
  }

  const ancestryChecks = [
    ['baselineCursor', state.baselineCursor, 'migrationTarget', state.migrationTarget],
    ['migrationTarget', state.migrationTarget, 'observedHead', state.observedHead],
  ]
  if (state.reviewedThrough !== null) {
    ancestryChecks.push(
      ['baselineCursor', state.baselineCursor, 'reviewedThrough', state.reviewedThrough],
      ['reviewedThrough', state.reviewedThrough, 'migrationTarget', state.migrationTarget],
    )
  }
  if (state.portedThrough !== null) {
    ancestryChecks.push(
      ['baselineCursor', state.baselineCursor, 'portedThrough', state.portedThrough],
      ['portedThrough', state.portedThrough, 'migrationTarget', state.migrationTarget],
    )
    if (state.reviewedThrough !== null) {
      ancestryChecks.push(
        ['portedThrough', state.portedThrough, 'reviewedThrough', state.reviewedThrough],
      )
    }
  }
  for (const capability of asArray(capabilityMap.capabilities)) {
    if (capability?.syncedThrough === null) continue
    ancestryChecks.push(
      ['baselineCursor', state.baselineCursor, `capability ${capability.id}.syncedThrough`, capability.syncedThrough],
      [`capability ${capability.id}.syncedThrough`, capability.syncedThrough, 'migrationTarget', state.migrationTarget],
    )
  }
  for (const [olderLabel, older, newerLabel, newer] of ancestryChecks) {
    if (COMMIT_PATTERN.test(String(older))
      && COMMIT_PATTERN.test(String(newer))
      && !isAncestor(sourceDir, older, newer)) {
      issues.push(`upstream ${olderLabel} must be an ancestor of ${newerLabel}`)
    }
  }

  const sourceCache = new Map()
  for (const capability of asArray(capabilityMap.capabilities)) {
    for (const upstreamRef of asArray(capability.upstreamRefs)) {
      if (!isSafeUpstreamPath(upstreamRef.path)) {
        issues.push(`capability ${capability.id} has unsafe upstream path: ${String(upstreamRef.path)}`)
        continue
      }
      const cacheKey = `${state.migrationTarget}:${upstreamRef.path}`
      let source = sourceCache.get(cacheKey)
      if (source === undefined) {
        try {
          source = git(sourceDir, ['show', cacheKey])
        } catch {
          source = null
        }
        sourceCache.set(cacheKey, source)
      }
      if (source === null) {
        issues.push(`capability ${capability.id} upstream path is unavailable: ${upstreamRef.path}`)
        continue
      }
      for (const anchor of asArray(upstreamRef.anchors)) {
        if (typeof anchor !== 'string' || !source.includes(anchor)) {
          issues.push(`capability ${capability.id} upstream anchor is missing in ${upstreamRef.path}: ${String(anchor)}`)
        }
      }
    }
  }
  return issues
}

function parseArguments(argv) {
  let sourceDir = null
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--source-dir') {
      sourceDir = argv[index + 1] || null
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return { sourceDir }
}

function run() {
  const { sourceDir } = parseArguments(process.argv.slice(2))
  const documents = loadDocuments(defaultAppRoot)
  const issues = validateDocuments({ appRoot: defaultAppRoot, ...documents })
  if (sourceDir) {
    issues.push(...validateUpstream({
      sourceDir: path.resolve(defaultAppRoot, sourceDir),
      state: documents.state,
      capabilityMap: documents.capabilityMap,
    }))
  }
  if (issues.length > 0) {
    for (const issue of issues) console.error(`- ${issue}`)
    process.exitCode = 1
    return
  }
  const plannedTestCount = new Set(documents.capabilityMap.capabilities
    .flatMap(capability => asArray(capability.plannedTestIds))).size
  const openCount = documents.capabilityMap.capabilities
    .filter(capability => (
      !isCapabilityCompleteForTarget(capability, documents.state.migrationTarget)
    )).length
  console.log([
    'Cat Catch sync metadata valid:',
    `${documents.capabilityMap.cutoverUnits.length} units,`,
    `${documents.capabilityMap.capabilities.length} capabilities (${openCount} open),`,
    `${documents.legacyCleanup.entries.length} cleanup entries,`,
    `${plannedTestCount} planned tests.`,
  ].join(' '))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) run()
