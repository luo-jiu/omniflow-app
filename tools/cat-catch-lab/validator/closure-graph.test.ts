import { describe, expect, it } from 'vitest'

import {
  computeClosureGraph,
  DEFAULT_CLOSURE_GRAPH_BUDGETS,
  type ClosureGraphEdge,
  type ClosureGraphInput,
} from './closure-graph.ts'

function edge(
  edgeId: string,
  fromNodeId: string,
  toNodeId: string,
  runtimeCapable = true,
): ClosureGraphEdge {
  return { edgeId, fromNodeId, runtimeCapable, toNodeId }
}

function requireResult(input: ClosureGraphInput): Extract<ReturnType<typeof computeClosureGraph>, { ok: true }> {
  const result = computeClosureGraph(input)
  if (!result.ok) throw new Error(`Expected a valid graph: ${JSON.stringify(result.issues)}`)
  return result
}

describe('closure graph fixed points', () => {
  it.each([
    ['forward', 'a', ['a', 'b', 'c']],
    ['reverse', 'c', ['a', 'b', 'c']],
    ['reverse', 'a', ['a']],
    ['both', 'b', ['a', 'b', 'c']],
  ] as const)('propagates %s scope traversal from %s', (traversal, nodeId, expected) => {
    const result = requireResult({
      edges: [edge('edge.a-b', 'a', 'b'), edge('edge.b-c', 'b', 'c')],
      nodeIds: ['a', 'b', 'c'],
      runtimeSeedNodeIds: [],
      scopeSeeds: [{ nodeId, traversal }],
    })

    expect(result.scope.domainNodeIds).toEqual(expected)
    expect(result.scope.rounds.at(-1)?.added).toEqual([])
    expect(result.scope.iterationCount).toBe(result.scope.rounds.length)
  })

  it('combines duplicate directional seeds canonically', () => {
    const result = requireResult({
      edges: [],
      nodeIds: ['z', 'a'],
      runtimeSeedNodeIds: [],
      scopeSeeds: [
        { nodeId: 'z', traversal: 'reverse' },
        { nodeId: 'a', traversal: 'forward' },
        { nodeId: 'z', traversal: 'forward' },
      ],
    })

    expect(result.scope.seeds).toEqual([
      { nodeId: 'a', traversal: 'forward' },
      { nodeId: 'z', traversal: 'both' },
    ])
    expect(result.scope.domainNodeIds).toEqual(['a', 'z'])
  })

  it('keeps forward and reverse taint separate after a both-direction seed', () => {
    const result = requireResult({
      edges: [
        edge('edge.caller-root', 'caller', 'root'),
        edge('edge.caller-dependency', 'caller', 'dependency'),
      ],
      nodeIds: ['root', 'caller', 'dependency'],
      runtimeSeedNodeIds: [],
      scopeSeeds: [{ nodeId: 'root', traversal: 'both' }],
    })

    expect(result.scope.domainNodeIds).toEqual(['caller', 'root'])
    expect(result.scope.rounds[0]?.added).toEqual([{
      nodeId: 'caller',
      traversal: 'reverse',
      via: [{ edgeId: 'edge.caller-root', traversal: 'reverse' }],
    }])
  })

  it('does not grant forward scope to a reverse-discovered caller', () => {
    const result = requireResult({
      edges: [
        edge('edge.grand-caller', 'grand-caller', 'caller'),
        edge('edge.caller-root', 'caller', 'root'),
        edge('edge.caller-unrelated', 'caller', 'unrelated'),
        edge('edge.root-helper', 'root', 'helper'),
      ],
      nodeIds: ['grand-caller', 'caller', 'root', 'unrelated', 'helper'],
      runtimeSeedNodeIds: [],
      scopeSeeds: [{ nodeId: 'root', traversal: 'both' }],
    })

    expect(result.scope.domainNodeIds).toEqual(['caller', 'grand-caller', 'helper', 'root'])
    expect(result.scope.domainNodeIds).not.toContain('unrelated')
    expect(result.scope.rounds).toEqual([
      {
        added: [
          {
            nodeId: 'caller',
            traversal: 'reverse',
            via: [{ edgeId: 'edge.caller-root', traversal: 'reverse' }],
          },
          {
            nodeId: 'helper',
            traversal: 'forward',
            via: [{ edgeId: 'edge.root-helper', traversal: 'forward' }],
          },
        ],
        frontier: [{ nodeId: 'root', traversal: 'both' }],
        iteration: 1,
      },
      {
        added: [{
          nodeId: 'grand-caller',
          traversal: 'reverse',
          via: [{ edgeId: 'edge.grand-caller', traversal: 'reverse' }],
        }],
        frontier: [
          { nodeId: 'caller', traversal: 'reverse' },
          { nodeId: 'helper', traversal: 'forward' },
        ],
        iteration: 2,
      },
      {
        added: [],
        frontier: [{ nodeId: 'grand-caller', traversal: 'reverse' }],
        iteration: 3,
      },
    ])
  })

  it('keeps runtime reachability forward-only and runtime-capable', () => {
    const result = requireResult({
      edges: [
        edge('edge.dynamic', 'a', 'b'),
        edge('edge.scope-only', 'b', 'c', false),
      ],
      nodeIds: ['a', 'b', 'c', 'disconnected'],
      runtimeSeedNodeIds: ['a'],
      scopeSeeds: [{ nodeId: 'c', traversal: 'reverse' }],
    })

    expect(result.scope.domainNodeIds).toEqual(['a', 'b', 'c'])
    expect(result.runtime.reachableNodeIds).toEqual(['a', 'b'])
    expect(result.runtime.rounds.at(-1)?.added).toEqual([])
    expect(result.runtime.reachableNodeIds).not.toContain('disconnected')
  })

  it('does not let a reverse scope seed manufacture runtime reachability', () => {
    const result = requireResult({
      edges: [edge('edge.a-b', 'a', 'b'), edge('edge.b-c', 'b', 'c')],
      nodeIds: ['a', 'b', 'c'],
      runtimeSeedNodeIds: ['c'],
      scopeSeeds: [{ nodeId: 'c', traversal: 'reverse' }],
    })

    expect(result.scope.domainNodeIds).toEqual(['a', 'b', 'c'])
    expect(result.runtime.reachableNodeIds).toEqual(['c'])
  })

  it('records canonical auditable additions and an extra stable round', () => {
    const result = requireResult({
      edges: [
        edge('edge.a-b.second', 'a', 'b'),
        edge('edge.a-b.first', 'a', 'b'),
        edge('edge.b-c', 'b', 'c'),
      ],
      nodeIds: ['c', 'b', 'a'],
      runtimeSeedNodeIds: ['a'],
      scopeSeeds: [{ nodeId: 'a', traversal: 'forward' }],
    })

    expect(result.scope.rounds).toEqual([
      {
        added: [{
          nodeId: 'b',
          traversal: 'forward',
          via: [
            { edgeId: 'edge.a-b.first', traversal: 'forward' },
            { edgeId: 'edge.a-b.second', traversal: 'forward' },
          ],
        }],
        frontier: [{ nodeId: 'a', traversal: 'forward' }],
        iteration: 1,
      },
      {
        added: [{
          nodeId: 'c',
          traversal: 'forward',
          via: [{ edgeId: 'edge.b-c', traversal: 'forward' }],
        }],
        frontier: [{ nodeId: 'b', traversal: 'forward' }],
        iteration: 2,
      },
      {
        added: [],
        frontier: [{ nodeId: 'c', traversal: 'forward' }],
        iteration: 3,
      },
    ])
    expect(result.scope.iterationCount).toBe(3)
    expect(result.runtime.iterationCount).toBe(3)
  })

  it('records a stable round for an empty seed set', () => {
    const result = requireResult({
      edges: [edge('edge.a-b', 'a', 'b')],
      nodeIds: ['a', 'b'],
      runtimeSeedNodeIds: [],
      scopeSeeds: [],
    })

    expect(result.scope).toEqual({
      domainNodeIds: [],
      iterationCount: 1,
      rounds: [{ added: [], frontier: [], iteration: 1 }],
      seeds: [],
    })
    expect(result.runtime).toEqual({
      iterationCount: 1,
      reachableNodeIds: [],
      rounds: [{ added: [], frontierNodeIds: [], iteration: 1 }],
      seedNodeIds: [],
    })
  })

  it('terminates canonically across cycles and self edges', () => {
    const result = requireResult({
      edges: [
        edge('edge.a-self', 'a', 'a'),
        edge('edge.a-b', 'a', 'b'),
        edge('edge.b-a', 'b', 'a'),
      ],
      nodeIds: ['b', 'a'],
      runtimeSeedNodeIds: ['a'],
      scopeSeeds: [{ nodeId: 'a', traversal: 'both' }],
    })

    expect(result.scope.domainNodeIds).toEqual(['a', 'b'])
    expect(result.runtime.reachableNodeIds).toEqual(['a', 'b'])
    expect(result.scope.rounds).toHaveLength(2)
    expect(result.runtime.rounds).toHaveLength(2)
    expect(result.scope.rounds.at(-1)?.added).toEqual([])
    expect(result.runtime.rounds.at(-1)?.added).toEqual([])
  })

  it('fails closed for every unknown seed and edge endpoint', () => {
    const result = computeClosureGraph({
      edges: [edge('edge.invalid', 'missing-source', 'missing-target')],
      nodeIds: ['known'],
      runtimeSeedNodeIds: ['missing-runtime'],
      scopeSeeds: [{ nodeId: 'missing-scope', traversal: 'both' }],
    })

    expect(result).toEqual({
      issues: [
        {
          code: 'unknown-edge-endpoint',
          message: 'Edge edge.invalid references an unknown source node: missing-source',
          refId: 'edge.invalid.fromNodeId',
        },
        {
          code: 'unknown-edge-endpoint',
          message: 'Edge edge.invalid references an unknown target node: missing-target',
          refId: 'edge.invalid.toNodeId',
        },
        {
          code: 'unknown-runtime-seed',
          message: 'Runtime seed references an unknown node: missing-runtime',
          refId: 'missing-runtime',
        },
        {
          code: 'unknown-scope-seed',
          message: 'Scope seed references an unknown node: missing-scope',
          refId: 'missing-scope',
        },
      ],
      ok: false,
      runtime: null,
      scope: null,
    })
  })

  it('is order-independent, idempotent, and does not mutate input', () => {
    const firstInput: ClosureGraphInput = {
      edges: [edge('edge.b-c', 'b', 'c'), edge('edge.a-b', 'a', 'b')],
      nodeIds: ['c', 'a', 'b'],
      runtimeSeedNodeIds: ['a', 'a'],
      scopeSeeds: [
        { nodeId: 'c', traversal: 'reverse' },
        { nodeId: 'a', traversal: 'forward' },
      ],
    }
    const snapshot = structuredClone(firstInput)
    const reorderedInput: ClosureGraphInput = {
      edges: [...firstInput.edges].reverse(),
      nodeIds: [...firstInput.nodeIds].reverse(),
      runtimeSeedNodeIds: [...firstInput.runtimeSeedNodeIds].reverse(),
      scopeSeeds: [...firstInput.scopeSeeds].reverse(),
    }

    const first = computeClosureGraph(firstInput)
    expect(computeClosureGraph(firstInput)).toEqual(first)
    expect(computeClosureGraph(reorderedInput)).toEqual(first)
    expect(firstInput).toEqual(snapshot)
  })

  it('fails closed for empty or duplicate graph identities', () => {
    const result = computeClosureGraph({
      edges: [
        edge('', 'a', 'b'),
        edge('edge.duplicate', 'a', 'b'),
        edge('edge.duplicate', 'a', 'b'),
        edge('edge.conflict', 'a', 'b'),
        edge('edge.conflict', 'b', 'a'),
      ],
      nodeIds: ['', 'a', 'a', 'b'],
      runtimeSeedNodeIds: [],
      scopeSeeds: [],
    })

    expect(result.ok).toBe(false)
    expect(result.issues.map(issue => issue.code)).toEqual([
      'conflicting-edge-id',
      'duplicate-edge-id',
      'duplicate-node-id',
      'empty-edge-id',
      'empty-node-id',
    ])
    expect(result).toEqual(expect.objectContaining({ runtime: null, scope: null }))
  })

  it('merges repeated valid scope seeds but rejects an invalid runtime traversal value', () => {
    const valid = requireResult({
      edges: [],
      nodeIds: ['seed'],
      runtimeSeedNodeIds: [],
      scopeSeeds: [
        { nodeId: 'seed', traversal: 'forward' },
        { nodeId: 'seed', traversal: 'forward' },
      ],
    })
    expect(valid.scope.seeds).toEqual([{ nodeId: 'seed', traversal: 'forward' }])

    const invalid = computeClosureGraph({
      edges: [],
      nodeIds: ['seed'],
      runtimeSeedNodeIds: [],
      scopeSeeds: [{ nodeId: 'seed', traversal: 'sideways' }],
    } as unknown as ClosureGraphInput)
    expect(invalid).toEqual({
      issues: [{
        code: 'invalid-scope-traversal',
        message: 'Scope seed traversal is invalid for seed: sideways',
        refId: 'seed',
      }],
      ok: false,
      runtime: null,
      scope: null,
    })
  })

  it.each([
    [
      'node ID',
      { edges: [], nodeIds: [7], runtimeSeedNodeIds: [], scopeSeeds: [] },
      [{ code: 'invalid-node-id', refId: 'nodeIds[0]' }],
    ],
    [
      'edge ID',
      {
        edges: [{ edgeId: 7, fromNodeId: 'a', runtimeCapable: true, toNodeId: 'a' }],
        nodeIds: ['a'],
        runtimeSeedNodeIds: [],
        scopeSeeds: [],
      },
      [{ code: 'invalid-edge-id', refId: 'edges[0].edgeId' }],
    ],
    [
      'edge endpoint IDs',
      {
        edges: [{ edgeId: 'edge.invalid', fromNodeId: 7, runtimeCapable: true, toNodeId: false }],
        nodeIds: ['a'],
        runtimeSeedNodeIds: [],
        scopeSeeds: [],
      },
      [
        { code: 'invalid-edge-endpoint', refId: 'edges[0].fromNodeId' },
        { code: 'invalid-edge-endpoint', refId: 'edges[0].toNodeId' },
      ],
    ],
    [
      'scope seed node ID',
      {
        edges: [],
        nodeIds: ['a'],
        runtimeSeedNodeIds: [],
        scopeSeeds: [{ nodeId: 7, traversal: 'forward' }],
      },
      [{ code: 'invalid-scope-seed', refId: 'scopeSeeds[0].nodeId' }],
    ],
    [
      'runtime seed node ID',
      { edges: [], nodeIds: ['a'], runtimeSeedNodeIds: [null], scopeSeeds: [] },
      [{ code: 'invalid-runtime-seed', refId: 'runtimeSeedNodeIds[0]' }],
    ],
    [
      'empty edge endpoint ID',
      {
        edges: [{ edgeId: 'edge.invalid', fromNodeId: '', runtimeCapable: true, toNodeId: 'a' }],
        nodeIds: ['a'],
        runtimeSeedNodeIds: [],
        scopeSeeds: [],
      },
      [{ code: 'invalid-edge-endpoint', refId: 'edges[0].fromNodeId' }],
    ],
    [
      'empty scope seed node ID',
      {
        edges: [],
        nodeIds: ['a'],
        runtimeSeedNodeIds: [],
        scopeSeeds: [{ nodeId: '', traversal: 'forward' }],
      },
      [{ code: 'invalid-scope-seed', refId: 'scopeSeeds[0].nodeId' }],
    ],
    [
      'empty runtime seed node ID',
      { edges: [], nodeIds: ['a'], runtimeSeedNodeIds: [''], scopeSeeds: [] },
      [{ code: 'invalid-runtime-seed', refId: 'runtimeSeedNodeIds[0]' }],
    ],
  ] as const)('fails closed for an invalid runtime %s', (_label, input, expectedIssues) => {
    const result = computeClosureGraph(input as unknown as ClosureGraphInput)

    expect(result.ok).toBe(false)
    expect(result.issues.map(({ code, refId }) => ({ code, refId }))).toEqual(expectedIssues)
    expect(result).toEqual(expect.objectContaining({ runtime: null, scope: null }))
  })

  it('requires runtimeCapable to be a boolean instead of accepting a truthy false string', () => {
    const result = computeClosureGraph({
      edges: [{
        edgeId: 'edge.a-b',
        fromNodeId: 'a',
        runtimeCapable: 'false',
        toNodeId: 'b',
      }],
      nodeIds: ['a', 'b'],
      runtimeSeedNodeIds: ['a'],
      scopeSeeds: [],
    } as unknown as ClosureGraphInput)

    expect(result).toEqual({
      issues: [{
        code: 'invalid-runtime-capable',
        message: 'Graph edge runtimeCapable must be a boolean: edges[0].runtimeCapable',
        refId: 'edges[0].runtimeCapable',
      }],
      ok: false,
      runtime: null,
      scope: null,
    })
  })

  it('fails closed for malformed JSON collections and records', () => {
    const malformedCollection = computeClosureGraph({
      edges: [],
      nodeIds: 'a',
      runtimeSeedNodeIds: [],
      scopeSeeds: [],
    } as unknown as ClosureGraphInput)
    const malformedRecord = computeClosureGraph({
      edges: [null],
      nodeIds: [],
      runtimeSeedNodeIds: [],
      scopeSeeds: [],
    } as unknown as ClosureGraphInput)

    expect(malformedCollection.issues).toEqual([expect.objectContaining({
      code: 'invalid-input',
      refId: 'nodeIds',
    })])
    expect(malformedRecord.issues).toEqual([expect.objectContaining({
      code: 'invalid-edge-record',
      refId: 'edges[0]',
    })])
  })

  it('publishes bounded immutable default budgets', () => {
    expect(Object.isFrozen(DEFAULT_CLOSURE_GRAPH_BUDGETS)).toBe(true)
    expect(Object.values(DEFAULT_CLOSURE_GRAPH_BUDGETS).every(value => (
      Number.isSafeInteger(value) && value > 0
    ))).toBe(true)
  })

  it('fails closed deterministically for invalid or unknown budget overrides', () => {
    const input: ClosureGraphInput = {
      edges: [],
      nodeIds: [],
      runtimeSeedNodeIds: [],
      scopeSeeds: [],
    }
    const invalid = computeClosureGraph(input, {
      maxEdges: -1,
      maxNodes: 1.5,
    })
    const unknown = computeClosureGraph(input, {
      maxWork: 1,
    } as unknown as Parameters<typeof computeClosureGraph>[1])

    expect(invalid.issues).toEqual([
      {
        code: 'budget-invalid',
        message: 'Closure graph budget must be a non-negative safe integer: maxEdges',
        refId: 'maxEdges',
      },
      {
        code: 'budget-invalid',
        message: 'Closure graph budget must be a non-negative safe integer: maxNodes',
        refId: 'maxNodes',
      },
    ])
    expect(unknown.issues).toEqual([{
      code: 'budget-invalid',
      message: 'Closure graph budget override is unknown: maxWork',
      refId: 'maxWork',
    }])
    expect(invalid).toEqual(expect.objectContaining({ ok: false, runtime: null, scope: null }))
    expect(unknown).toEqual(expect.objectContaining({ ok: false, runtime: null, scope: null }))
  })

  it.each([
    [
      'node',
      { edges: [], nodeIds: ['a'], runtimeSeedNodeIds: [], scopeSeeds: [] },
      { maxNodes: 0 },
      'node-budget-exhausted',
      'maxNodes',
    ],
    [
      'edge',
      {
        edges: [edge('edge.a-a', 'a', 'a')],
        nodeIds: ['a'],
        runtimeSeedNodeIds: [],
        scopeSeeds: [],
      },
      { maxEdges: 0 },
      'edge-budget-exhausted',
      'maxEdges',
    ],
    [
      'seed',
      { edges: [], nodeIds: ['a'], runtimeSeedNodeIds: ['a'], scopeSeeds: [] },
      { maxSeeds: 0 },
      'seed-budget-exhausted',
      'maxSeeds',
    ],
  ] as const)(
    'fails closed before traversal when the %s count budget is exhausted',
    (_label, input, budget, code, refId) => {
      const result = computeClosureGraph(input, budget)

      expect(result.issues).toEqual([expect.objectContaining({ code, refId })])
      expect(result).toEqual(expect.objectContaining({ ok: false, runtime: null, scope: null }))
    },
  )

  it('enforces shared total round and transition-inspection budgets', () => {
    const emptyInput: ClosureGraphInput = {
      edges: [],
      nodeIds: [],
      runtimeSeedNodeIds: [],
      scopeSeeds: [],
    }
    const edgeInput: ClosureGraphInput = {
      edges: [edge('edge.a-b', 'a', 'b')],
      nodeIds: ['a', 'b'],
      runtimeSeedNodeIds: ['a'],
      scopeSeeds: [],
    }

    expect(computeClosureGraph(emptyInput, { maxRounds: 1 })).toEqual({
      issues: [{
        code: 'round-budget-exhausted',
        message: 'Closure graph round count during scope traversal budget exhausted: required 2, limit 1.',
        refId: 'scope.maxRounds',
      }],
      ok: false,
      runtime: null,
      scope: null,
    })
    expect(computeClosureGraph(edgeInput, { maxTraversalSteps: 0 })).toEqual({
      issues: [{
        code: 'traversal-budget-exhausted',
        message: 'Closure graph transition inspection during runtime traversal budget exhausted: required 1, limit 0.',
        refId: 'runtime.maxTraversalSteps',
      }],
      ok: false,
      runtime: null,
      scope: null,
    })
  })

  it('accepts a graph exactly at small overridden resource budgets', () => {
    const result = computeClosureGraph({
      edges: [edge('edge.a-b', 'a', 'b')],
      nodeIds: ['a', 'b'],
      runtimeSeedNodeIds: ['a'],
      scopeSeeds: [{ nodeId: 'a', traversal: 'forward' }],
    }, {
      maxEdges: 1,
      maxNodes: 2,
      maxRounds: 4,
      maxSeeds: 2,
      maxTraversalSteps: 3,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected exact budget boundary to pass: ${JSON.stringify(result.issues)}`)
    expect(result.runtime.reachableNodeIds).toEqual(['a', 'b'])
    expect(result.scope.domainNodeIds).toEqual(['a', 'b'])
  })

  it('is monotone when a valid directed edge is added', () => {
    const base: ClosureGraphInput = {
      edges: [edge('edge.a-b', 'a', 'b')],
      nodeIds: ['a', 'b', 'c'],
      runtimeSeedNodeIds: ['a'],
      scopeSeeds: [{ nodeId: 'a', traversal: 'forward' }],
    }
    const extended: ClosureGraphInput = {
      ...base,
      edges: [...base.edges, edge('edge.b-c.dynamic', 'b', 'c')],
    }
    const baseResult = requireResult(base)
    const extendedResult = requireResult(extended)

    expect(baseResult.scope.domainNodeIds.every(nodeId => (
      extendedResult.scope.domainNodeIds.includes(nodeId)
    ))).toBe(true)
    expect(baseResult.runtime.reachableNodeIds.every(nodeId => (
      extendedResult.runtime.reachableNodeIds.includes(nodeId)
    ))).toBe(true)
    expect(extendedResult.scope.domainNodeIds).toEqual(['a', 'b', 'c'])
    expect(extendedResult.runtime.reachableNodeIds).toEqual(['a', 'b', 'c'])
  })
})
