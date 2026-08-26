export type ClosureGraphTraversal = 'both' | 'forward' | 'reverse'

export type ClosureGraphSeed = {
  nodeId: string
  traversal: ClosureGraphTraversal
}

export type ClosureGraphEdge = {
  edgeId: string
  fromNodeId: string
  runtimeCapable: boolean
  toNodeId: string
}

export type ClosureGraphInput = {
  edges: readonly ClosureGraphEdge[]
  nodeIds: readonly string[]
  runtimeSeedNodeIds: readonly string[]
  scopeSeeds: readonly ClosureGraphSeed[]
}

export type ClosureGraphIssueCode =
  | 'budget-invalid'
  | 'conflicting-edge-id'
  | 'duplicate-edge-id'
  | 'duplicate-node-id'
  | 'edge-budget-exhausted'
  | 'empty-edge-id'
  | 'empty-node-id'
  | 'invalid-edge-endpoint'
  | 'invalid-edge-id'
  | 'invalid-edge-record'
  | 'invalid-input'
  | 'invalid-node-id'
  | 'invalid-runtime-capable'
  | 'invalid-runtime-seed'
  | 'invalid-scope-seed'
  | 'invalid-scope-traversal'
  | 'node-budget-exhausted'
  | 'round-budget-exhausted'
  | 'seed-budget-exhausted'
  | 'traversal-budget-exhausted'
  | 'unknown-edge-endpoint'
  | 'unknown-runtime-seed'
  | 'unknown-scope-seed'

export type ClosureGraphIssue = {
  code: ClosureGraphIssueCode
  message: string
  refId: string
}

export type ClosureGraphBudgets = Readonly<{
  maxEdges: number
  maxNodes: number
  maxRounds: number
  maxSeeds: number
  maxTraversalSteps: number
}>

export type ClosureGraphBudgetOverrides = Partial<ClosureGraphBudgets>

export const DEFAULT_CLOSURE_GRAPH_BUDGETS: ClosureGraphBudgets = Object.freeze({
  maxEdges: 250_000,
  maxNodes: 50_000,
  maxRounds: 200_000,
  maxSeeds: 100_000,
  maxTraversalSteps: 2_000_000,
})

export type CanonicalClosureGraphSeed = {
  nodeId: string
  traversal: ClosureGraphTraversal
}

export type ScopeFrontierEntry = {
  nodeId: string
  traversal: ClosureGraphTraversal
}

export type ScopeDiscoveryRef = {
  edgeId: string
  traversal: 'forward' | 'reverse'
}

export type ScopeRoundAddition = ScopeFrontierEntry & {
  via: ScopeDiscoveryRef[]
}

export type ScopeClosureRound = {
  added: ScopeRoundAddition[]
  frontier: ScopeFrontierEntry[]
  iteration: number
}

export type ScopeClosureResult = {
  domainNodeIds: string[]
  iterationCount: number
  rounds: ScopeClosureRound[]
  seeds: CanonicalClosureGraphSeed[]
}

export type RuntimeRoundAddition = {
  nodeId: string
  viaEdgeIds: string[]
}

export type RuntimeClosureRound = {
  added: RuntimeRoundAddition[]
  frontierNodeIds: string[]
  iteration: number
}

export type RuntimeClosureResult = {
  iterationCount: number
  reachableNodeIds: string[]
  rounds: RuntimeClosureRound[]
  seedNodeIds: string[]
}

export type ClosureGraphResult =
  | {
      issues: ClosureGraphIssue[]
      ok: false
      runtime: null
      scope: null
    }
  | {
      issues: []
      ok: true
      runtime: RuntimeClosureResult
      scope: ScopeClosureResult
    }

type TraversalBit = 1 | 2

type ScopeTransition = {
  edgeId: string
  nodeId: string
  traversal: TraversalBit
}

type RuntimeTransition = {
  edgeId: string
  nodeId: string
}

const FORWARD: TraversalBit = 1
const REVERSE: TraversalBit = 2

const CLOSURE_GRAPH_BUDGET_NAMES = [
  'maxEdges',
  'maxNodes',
  'maxRounds',
  'maxSeeds',
  'maxTraversalSteps',
] as const satisfies readonly (keyof ClosureGraphBudgets)[]

type RawClosureGraphCollections = {
  edges: unknown[]
  nodeIds: unknown[]
  runtimeSeedNodeIds: unknown[]
  scopeSeeds: unknown[]
}

type ClosureGraphBudgetState = {
  budgets: ClosureGraphBudgets
  rounds: number
  traversalSteps: number
}

type BudgetedClosureResult<Result> =
  | { issue: ClosureGraphIssue; result: null }
  | { issue: null; result: Result }

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function traversalMask(traversal: ClosureGraphTraversal): number {
  if (traversal === 'forward') return FORWARD
  if (traversal === 'reverse') return REVERSE
  return FORWARD | REVERSE
}

function traversalFromMask(mask: number): ClosureGraphTraversal {
  if (mask === FORWARD) return 'forward'
  if (mask === REVERSE) return 'reverse'
  return 'both'
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodeUnits)
}

function canonicalScopeEntries(states: ReadonlyMap<string, number>): ScopeFrontierEntry[] {
  return [...states.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([nodeId, mask]) => ({ nodeId, traversal: traversalFromMask(mask) }))
}

function canonicalSeeds(seeds: readonly ClosureGraphSeed[]): CanonicalClosureGraphSeed[] {
  const masks = new Map<string, number>()
  for (const seed of seeds) {
    masks.set(seed.nodeId, (masks.get(seed.nodeId) || 0) | traversalMask(seed.traversal))
  }
  return canonicalScopeEntries(masks)
}

function canonicalIssues(issues: ClosureGraphIssue[]): ClosureGraphIssue[] {
  const unique = new Map<string, ClosureGraphIssue>()
  for (const issue of issues) {
    unique.set(`${issue.code}\0${issue.refId}\0${issue.message}`, issue)
  }
  return [...unique.values()].sort((left, right) => (
    compareCodeUnits(left.code, right.code)
      || compareCodeUnits(left.refId, right.refId)
      || compareCodeUnits(left.message, right.message)
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTraversal(value: unknown): value is ClosureGraphTraversal {
  return value === 'both' || value === 'forward' || value === 'reverse'
}

function appendMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key)
  if (values) {
    values.push(value)
    return
  }
  map.set(key, [value])
}

function edgeSemanticKey(edge: ClosureGraphEdge): string {
  return JSON.stringify([edge.fromNodeId, edge.toNodeId, edge.runtimeCapable])
}

function failure(issues: ClosureGraphIssue[]): ClosureGraphResult {
  return { issues: canonicalIssues(issues), ok: false, runtime: null, scope: null }
}

function budgetExhaustedIssue(
  code: Extract<ClosureGraphIssueCode, `${string}-budget-exhausted`>,
  resource: string,
  limit: number,
  required: number,
  refId: string,
): ClosureGraphIssue {
  return {
    code,
    message: `Closure graph ${resource} budget exhausted: required ${required}, limit ${limit}.`,
    refId,
  }
}

function resolveBudgets(
  budgetOverrides: unknown,
): { budgets: ClosureGraphBudgets | null; issues: ClosureGraphIssue[] } {
  if (!isRecord(budgetOverrides)) {
    return {
      budgets: null,
      issues: [{
        code: 'budget-invalid',
        message: 'Closure graph budget overrides must be an object',
        refId: '<budgets>',
      }],
    }
  }

  const issues: ClosureGraphIssue[] = []
  const knownNames = new Set<string>(CLOSURE_GRAPH_BUDGET_NAMES)
  for (const name of Object.keys(budgetOverrides)) {
    if (knownNames.has(name)) continue
    issues.push({
      code: 'budget-invalid',
      message: `Closure graph budget override is unknown: ${name}`,
      refId: name,
    })
  }

  const budgets = { ...DEFAULT_CLOSURE_GRAPH_BUDGETS }
  for (const name of CLOSURE_GRAPH_BUDGET_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(budgetOverrides, name)) continue
    const value = budgetOverrides[name]
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      issues.push({
        code: 'budget-invalid',
        message: `Closure graph budget must be a non-negative safe integer: ${name}`,
        refId: name,
      })
      continue
    }
    budgets[name] = value as number
  }

  if (issues.length > 0) return { budgets: null, issues: canonicalIssues(issues) }
  return { budgets, issues: [] }
}

function readInputCollections(
  input: unknown,
): { collections: RawClosureGraphCollections | null; issues: ClosureGraphIssue[] } {
  if (!isRecord(input)) {
    return {
      collections: null,
      issues: [{
        code: 'invalid-input',
        message: 'Closure graph input must be an object',
        refId: '<input>',
      }],
    }
  }

  const issues: ClosureGraphIssue[] = []
  for (const field of ['edges', 'nodeIds', 'runtimeSeedNodeIds', 'scopeSeeds'] as const) {
    if (Array.isArray(input[field])) continue
    issues.push({
      code: 'invalid-input',
      message: `Closure graph input ${field} must be an array`,
      refId: field,
    })
  }
  if (issues.length > 0) return { collections: null, issues: canonicalIssues(issues) }

  return {
    collections: {
      edges: input.edges as unknown[],
      nodeIds: input.nodeIds as unknown[],
      runtimeSeedNodeIds: input.runtimeSeedNodeIds as unknown[],
      scopeSeeds: input.scopeSeeds as unknown[],
    },
    issues: [],
  }
}

function validateInputBudgets(
  input: RawClosureGraphCollections,
  budgets: ClosureGraphBudgets,
): ClosureGraphIssue[] {
  const issues: ClosureGraphIssue[] = []
  if (input.nodeIds.length > budgets.maxNodes) {
    issues.push(budgetExhaustedIssue(
      'node-budget-exhausted',
      'node count',
      budgets.maxNodes,
      input.nodeIds.length,
      'maxNodes',
    ))
  }
  if (input.edges.length > budgets.maxEdges) {
    issues.push(budgetExhaustedIssue(
      'edge-budget-exhausted',
      'edge count',
      budgets.maxEdges,
      input.edges.length,
      'maxEdges',
    ))
  }
  const seedCount = input.scopeSeeds.length + input.runtimeSeedNodeIds.length
  if (seedCount > budgets.maxSeeds) {
    issues.push(budgetExhaustedIssue(
      'seed-budget-exhausted',
      'seed count',
      budgets.maxSeeds,
      seedCount,
      'maxSeeds',
    ))
  }
  return canonicalIssues(issues)
}

function normalizeInput(
  rawInput: unknown,
  budgets: ClosureGraphBudgets,
): { input: ClosureGraphInput | null; issues: ClosureGraphIssue[] } {
  const collectionResult = readInputCollections(rawInput)
  if (!collectionResult.collections) return { input: null, issues: collectionResult.issues }
  const raw = collectionResult.collections
  const budgetIssues = validateInputBudgets(raw, budgets)
  if (budgetIssues.length > 0) return { input: null, issues: budgetIssues }

  const issues: ClosureGraphIssue[] = []
  const nodeCounts = new Map<string, number>()
  const nodeIds: string[] = []
  for (const [index, nodeId] of raw.nodeIds.entries()) {
    if (typeof nodeId !== 'string') {
      issues.push({
        code: 'invalid-node-id',
        message: `Graph node ID must be a string: nodeIds[${index}]`,
        refId: `nodeIds[${index}]`,
      })
      continue
    }
    nodeIds.push(nodeId)
    nodeCounts.set(nodeId, (nodeCounts.get(nodeId) || 0) + 1)
  }
  for (const [nodeId, count] of nodeCounts) {
    const refId = nodeId || '<empty>'
    if (!nodeId) {
      issues.push({
        code: 'empty-node-id',
        message: 'Graph node IDs must be non-empty strings',
        refId,
      })
    }
    if (count > 1) {
      issues.push({
        code: 'duplicate-node-id',
        message: `Graph node ID must be unique: ${refId}`,
        refId,
      })
    }
  }
  const knownNodeIds = new Set(nodeIds.filter(nodeId => nodeId.length > 0))

  const edgesById = new Map<string, ClosureGraphEdge[]>()
  const edges: ClosureGraphEdge[] = []
  for (const [index, value] of raw.edges.entries()) {
    const edgePath = `edges[${index}]`
    if (!isRecord(value)) {
      issues.push({
        code: 'invalid-edge-record',
        message: `Graph edge must be an object: ${edgePath}`,
        refId: edgePath,
      })
      continue
    }

    const { edgeId, fromNodeId, runtimeCapable, toNodeId } = value
    if (typeof edgeId !== 'string') {
      issues.push({
        code: 'invalid-edge-id',
        message: `Graph edge ID must be a string: ${edgePath}.edgeId`,
        refId: `${edgePath}.edgeId`,
      })
    }
    if (typeof fromNodeId !== 'string' || fromNodeId.length === 0) {
      issues.push({
        code: 'invalid-edge-endpoint',
        message: `Graph edge source node ID must be a non-empty string: ${edgePath}.fromNodeId`,
        refId: `${edgePath}.fromNodeId`,
      })
    }
    if (typeof toNodeId !== 'string' || toNodeId.length === 0) {
      issues.push({
        code: 'invalid-edge-endpoint',
        message: `Graph edge target node ID must be a non-empty string: ${edgePath}.toNodeId`,
        refId: `${edgePath}.toNodeId`,
      })
    }
    if (typeof runtimeCapable !== 'boolean') {
      issues.push({
        code: 'invalid-runtime-capable',
        message: `Graph edge runtimeCapable must be a boolean: ${edgePath}.runtimeCapable`,
        refId: `${edgePath}.runtimeCapable`,
      })
    }

    const edgeRef = typeof edgeId === 'string' && edgeId.length > 0 ? edgeId : edgePath
    if (typeof fromNodeId === 'string' && fromNodeId.length > 0 && !knownNodeIds.has(fromNodeId)) {
      issues.push({
        code: 'unknown-edge-endpoint',
        message: `Edge ${edgeRef} references an unknown source node: ${fromNodeId}`,
        refId: `${edgeRef}.fromNodeId`,
      })
    }
    if (typeof toNodeId === 'string' && toNodeId.length > 0 && !knownNodeIds.has(toNodeId)) {
      issues.push({
        code: 'unknown-edge-endpoint',
        message: `Edge ${edgeRef} references an unknown target node: ${toNodeId}`,
        refId: `${edgeRef}.toNodeId`,
      })
    }

    if (
      typeof edgeId !== 'string'
      || typeof fromNodeId !== 'string'
      || fromNodeId.length === 0
      || typeof runtimeCapable !== 'boolean'
      || typeof toNodeId !== 'string'
      || toNodeId.length === 0
    ) continue
    const edge = { edgeId, fromNodeId, runtimeCapable, toNodeId }
    edges.push(edge)
    appendMapValue(edgesById, edgeId, edge)
  }
  for (const [edgeId, matchingEdges] of edgesById) {
    const refId = edgeId || '<empty>'
    if (!edgeId) {
      issues.push({
        code: 'empty-edge-id',
        message: 'Graph edge IDs must be non-empty strings',
        refId,
      })
    }
    if (matchingEdges.length < 2) continue
    const semantics = sortedUnique(matchingEdges.map(edgeSemanticKey))
    if (semantics.length === 1) {
      issues.push({
        code: 'duplicate-edge-id',
        message: `Graph edge ID must be unique: ${refId}`,
        refId,
      })
    } else {
      issues.push({
        code: 'conflicting-edge-id',
        message: `Graph edge ID has conflicting endpoint or runtime semantics: ${refId} (${semantics.join(', ')})`,
        refId,
      })
    }
  }

  const scopeSeeds: ClosureGraphSeed[] = []
  for (const [index, value] of raw.scopeSeeds.entries()) {
    const seedPath = `scopeSeeds[${index}]`
    if (!isRecord(value)) {
      issues.push({
        code: 'invalid-scope-seed',
        message: `Scope seed must be an object: ${seedPath}`,
        refId: seedPath,
      })
      continue
    }
    const { nodeId, traversal } = value
    const validNodeId = typeof nodeId === 'string' && nodeId.length > 0
    if (!validNodeId) {
      issues.push({
        code: 'invalid-scope-seed',
        message: `Scope seed node ID must be a non-empty string: ${seedPath}.nodeId`,
        refId: `${seedPath}.nodeId`,
      })
    }
    const seedRef = validNodeId ? nodeId : `${seedPath}.traversal`
    if (!isTraversal(traversal)) {
      issues.push({
        code: 'invalid-scope-traversal',
        message: `Scope seed traversal is invalid for ${seedRef}: ${String(traversal)}`,
        refId: seedRef,
      })
    }
    if (validNodeId && !knownNodeIds.has(nodeId)) {
      issues.push({
        code: 'unknown-scope-seed',
        message: `Scope seed references an unknown node: ${nodeId}`,
        refId: nodeId,
      })
    }
    if (validNodeId && isTraversal(traversal)) scopeSeeds.push({ nodeId, traversal })
  }

  const runtimeSeedNodeIds: string[] = []
  for (const [index, nodeId] of raw.runtimeSeedNodeIds.entries()) {
    const seedPath = `runtimeSeedNodeIds[${index}]`
    if (typeof nodeId !== 'string' || nodeId.length === 0) {
      issues.push({
        code: 'invalid-runtime-seed',
        message: `Runtime seed node ID must be a non-empty string: ${seedPath}`,
        refId: seedPath,
      })
      continue
    }
    runtimeSeedNodeIds.push(nodeId)
    if (!knownNodeIds.has(nodeId)) {
      issues.push({
        code: 'unknown-runtime-seed',
        message: `Runtime seed references an unknown node: ${nodeId}`,
        refId: nodeId,
      })
    }
  }

  const canonical = canonicalIssues(issues)
  if (canonical.length > 0) return { input: null, issues: canonical }
  return {
    input: { edges, nodeIds, runtimeSeedNodeIds, scopeSeeds },
    issues: [],
  }
}

function addScopeTransition(
  transitions: Map<string, ScopeTransition[]>,
  sourceNodeId: string,
  transition: ScopeTransition,
): void {
  appendMapValue(transitions, sourceNodeId, transition)
}

function scopeTransitionOrder(left: ScopeTransition, right: ScopeTransition): number {
  return compareCodeUnits(left.nodeId, right.nodeId)
    || left.traversal - right.traversal
    || compareCodeUnits(left.edgeId, right.edgeId)
}

function buildScopeTransitions(edges: readonly ClosureGraphEdge[]): Map<string, ScopeTransition[]> {
  const transitions = new Map<string, ScopeTransition[]>()
  for (const edge of edges) {
    addScopeTransition(transitions, edge.fromNodeId, {
      edgeId: edge.edgeId,
      nodeId: edge.toNodeId,
      traversal: FORWARD,
    })
    addScopeTransition(transitions, edge.toNodeId, {
      edgeId: edge.edgeId,
      nodeId: edge.fromNodeId,
      traversal: REVERSE,
    })
  }
  for (const adjacent of transitions.values()) adjacent.sort(scopeTransitionOrder)
  return transitions
}

function consumeRoundBudget(
  budgetState: ClosureGraphBudgetState,
  phase: 'runtime' | 'scope',
): ClosureGraphIssue | null {
  const required = budgetState.rounds + 1
  if (required > budgetState.budgets.maxRounds) {
    return budgetExhaustedIssue(
      'round-budget-exhausted',
      `round count during ${phase} traversal`,
      budgetState.budgets.maxRounds,
      required,
      `${phase}.maxRounds`,
    )
  }
  budgetState.rounds = required
  return null
}

function consumeTraversalBudget(
  budgetState: ClosureGraphBudgetState,
  phase: 'runtime' | 'scope',
): ClosureGraphIssue | null {
  const required = budgetState.traversalSteps + 1
  if (required > budgetState.budgets.maxTraversalSteps) {
    return budgetExhaustedIssue(
      'traversal-budget-exhausted',
      `transition inspection during ${phase} traversal`,
      budgetState.budgets.maxTraversalSteps,
      required,
      `${phase}.maxTraversalSteps`,
    )
  }
  budgetState.traversalSteps = required
  return null
}

function computeScopeClosure(
  edges: readonly ClosureGraphEdge[],
  seeds: CanonicalClosureGraphSeed[],
  budgetState: ClosureGraphBudgetState,
): BudgetedClosureResult<ScopeClosureResult> {
  const transitions = buildScopeTransitions(edges)
  const reachedMasks = new Map<string, number>(
    seeds.map(seed => [seed.nodeId, traversalMask(seed.traversal)]),
  )
  let frontier = new Map(reachedMasks)
  const rounds: ScopeClosureRound[] = []

  if (frontier.size === 0) {
    const budgetIssue = consumeRoundBudget(budgetState, 'scope')
    if (budgetIssue) return { issue: budgetIssue, result: null }
    rounds.push({ added: [], frontier: [], iteration: 1 })
  }
  while (frontier.size > 0) {
    const roundBudgetIssue = consumeRoundBudget(budgetState, 'scope')
    if (roundBudgetIssue) return { issue: roundBudgetIssue, result: null }
    const additions = new Map<string, {
      mask: number
      via: Map<string, ScopeDiscoveryRef>
    }>()
    for (const [nodeId, frontierMask] of frontier) {
      for (const transition of transitions.get(nodeId) || []) {
        const traversalBudgetIssue = consumeTraversalBudget(budgetState, 'scope')
        if (traversalBudgetIssue) return { issue: traversalBudgetIssue, result: null }
        const allowedMask = frontierMask & transition.traversal
        if (allowedMask === 0) continue
        const reachedMask = reachedMasks.get(transition.nodeId) || 0
        const missingMask = allowedMask & ~reachedMask
        if (missingMask === 0) continue
        const addition = additions.get(transition.nodeId) || { mask: 0, via: new Map() }
        addition.mask |= missingMask
        const traversal = traversalFromMask(transition.traversal) as 'forward' | 'reverse'
        addition.via.set(`${traversal}\0${transition.edgeId}`, {
          edgeId: transition.edgeId,
          traversal,
        })
        additions.set(transition.nodeId, addition)
      }
    }

    const nextFrontier = new Map<string, number>()
    const added = [...additions.entries()]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .flatMap(([nodeId, addition]) => {
        const newMask = addition.mask & ~(reachedMasks.get(nodeId) || 0)
        if (newMask === 0) return []
        reachedMasks.set(nodeId, (reachedMasks.get(nodeId) || 0) | newMask)
        nextFrontier.set(nodeId, newMask)
        return [{
          nodeId,
          traversal: traversalFromMask(newMask),
          via: [...addition.via.values()].sort((left, right) => (
            compareCodeUnits(left.traversal, right.traversal)
              || compareCodeUnits(left.edgeId, right.edgeId)
          )),
        }]
      })

    rounds.push({
      added,
      frontier: canonicalScopeEntries(frontier),
      iteration: rounds.length + 1,
    })
    if (nextFrontier.size === 0) break
    frontier = nextFrontier
  }

  return {
    issue: null,
    result: {
      domainNodeIds: sortedUnique(reachedMasks.keys()),
      iterationCount: rounds.length,
      rounds,
      seeds,
    },
  }
}

function addRuntimeTransition(
  transitions: Map<string, RuntimeTransition[]>,
  sourceNodeId: string,
  transition: RuntimeTransition,
): void {
  appendMapValue(transitions, sourceNodeId, transition)
}

function buildRuntimeTransitions(edges: readonly ClosureGraphEdge[]): Map<string, RuntimeTransition[]> {
  const transitions = new Map<string, RuntimeTransition[]>()
  for (const edge of edges) {
    if (!edge.runtimeCapable) continue
    addRuntimeTransition(transitions, edge.fromNodeId, {
      edgeId: edge.edgeId,
      nodeId: edge.toNodeId,
    })
  }
  for (const adjacent of transitions.values()) {
    adjacent.sort((left, right) => (
      compareCodeUnits(left.nodeId, right.nodeId) || compareCodeUnits(left.edgeId, right.edgeId)
    ))
  }
  return transitions
}

function computeRuntimeClosure(
  edges: readonly ClosureGraphEdge[],
  seedNodeIds: string[],
  budgetState: ClosureGraphBudgetState,
): BudgetedClosureResult<RuntimeClosureResult> {
  const transitions = buildRuntimeTransitions(edges)
  const reached = new Set(seedNodeIds)
  let frontier = [...seedNodeIds]
  const rounds: RuntimeClosureRound[] = []

  if (frontier.length === 0) {
    const budgetIssue = consumeRoundBudget(budgetState, 'runtime')
    if (budgetIssue) return { issue: budgetIssue, result: null }
    rounds.push({ added: [], frontierNodeIds: [], iteration: 1 })
  }
  while (frontier.length > 0) {
    const roundBudgetIssue = consumeRoundBudget(budgetState, 'runtime')
    if (roundBudgetIssue) return { issue: roundBudgetIssue, result: null }
    const additions = new Map<string, Set<string>>()
    for (const nodeId of frontier) {
      for (const transition of transitions.get(nodeId) || []) {
        const traversalBudgetIssue = consumeTraversalBudget(budgetState, 'runtime')
        if (traversalBudgetIssue) return { issue: traversalBudgetIssue, result: null }
        if (reached.has(transition.nodeId)) continue
        const via = additions.get(transition.nodeId) || new Set<string>()
        via.add(transition.edgeId)
        additions.set(transition.nodeId, via)
      }
    }
    const added = [...additions.entries()]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([nodeId, viaEdgeIds]) => ({
        nodeId,
        viaEdgeIds: sortedUnique(viaEdgeIds),
      }))
    rounds.push({
      added,
      frontierNodeIds: sortedUnique(frontier),
      iteration: rounds.length + 1,
    })
    if (added.length === 0) break
    frontier = added.map(addition => addition.nodeId)
    for (const nodeId of frontier) reached.add(nodeId)
  }

  return {
    issue: null,
    result: {
      iterationCount: rounds.length,
      reachableNodeIds: sortedUnique(reached),
      rounds,
      seedNodeIds,
    },
  }
}

export function computeClosureGraph(
  rawInput: ClosureGraphInput,
  budgetOverrides: ClosureGraphBudgetOverrides = {},
): ClosureGraphResult {
  const budgetResult = resolveBudgets(budgetOverrides)
  if (!budgetResult.budgets) return failure(budgetResult.issues)

  const normalized = normalizeInput(rawInput, budgetResult.budgets)
  if (!normalized.input) return failure(normalized.issues)
  const input = normalized.input
  const budgetState: ClosureGraphBudgetState = {
    budgets: budgetResult.budgets,
    rounds: 0,
    traversalSteps: 0,
  }

  const runtime = computeRuntimeClosure(
    input.edges,
    sortedUnique(input.runtimeSeedNodeIds),
    budgetState,
  )
  if (runtime.issue) return failure([runtime.issue])
  const scope = computeScopeClosure(input.edges, canonicalSeeds(input.scopeSeeds), budgetState)
  if (scope.issue) return failure([scope.issue])
  return {
    issues: [],
    ok: true,
    runtime: runtime.result,
    scope: scope.result,
  }
}
