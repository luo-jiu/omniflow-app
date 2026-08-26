import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EXACT_SEMANTIC_SCAN_BUDGETS,
  EXACT_SEMANTIC_MATCH_PROFILE,
  scanExactSemanticBlobs,
  type ExactSemanticScanRule,
} from './exact-semantic-scan.ts'
import { sha256Bytes } from './json.ts'

function rule(overrides: Partial<ExactSemanticScanRule> = {}): ExactSemanticScanRule {
  return {
    excludedPaths: [],
    id: 'scan.default',
    includedExtensions: ['.ts'],
    matchProfile: EXACT_SEMANTIC_MATCH_PROFILE,
    pathScopes: ['src'],
    patternGroups: [['needle']],
    resultKind: 'candidate',
    ...overrides,
  }
}

function bytes(source: string): Buffer {
  return Buffer.from(source, 'utf8')
}

describe('exact semantic blob scan', () => {
  it('matches literal metacharacters case-sensitively and preserves every occurrence', () => {
    const source = 'pi: π a.b* a.b* A.B*'
    const result = scanExactSemanticBlobs(
      new Map([['src/literal.ts', bytes(source)]]),
      [rule({ patternGroups: [['a.b*']] })],
    )

    expect(result.complete).toBe(true)
    expect(result.unresolved).toEqual([])
    expect(result.matches).toEqual([
      {
        byteEnd: 11,
        byteStart: 7,
        codeUnitEnd: 10,
        codeUnitStart: 6,
        groupIndex: 0,
        path: 'src/literal.ts',
        pattern: 'a.b*',
        resultKind: 'candidate',
        ruleId: 'scan.default',
        sourceHash: sha256Bytes(source),
      },
      {
        byteEnd: 16,
        byteStart: 12,
        codeUnitEnd: 15,
        codeUnitStart: 11,
        groupIndex: 0,
        path: 'src/literal.ts',
        pattern: 'a.b*',
        resultKind: 'candidate',
        ruleId: 'scan.default',
        sourceHash: sha256Bytes(source),
      },
    ])
  })

  it('reports UTF-8 byte offsets separately from JS code-unit offsets', () => {
    const source = '😀éx😀'
    const result = scanExactSemanticBlobs(
      new Map([['src/unicode.ts', bytes(source)]]),
      [rule({ patternGroups: [['éx']] })],
    )

    expect(result.matches).toEqual([
      expect.objectContaining({
        byteEnd: 7,
        byteStart: 4,
        codeUnitEnd: 4,
        codeUnitStart: 2,
      }),
    ])
  })

  it('preserves overlapping literal occurrences', () => {
    const result = scanExactSemanticBlobs(
      new Map([['src/overlap.ts', bytes('aaaa')]]),
      [rule({ patternGroups: [['aa']] })],
    )

    expect(result.matches.map(match => [match.codeUnitStart, match.codeUnitEnd])).toEqual([
      [0, 2],
      [1, 3],
      [2, 4],
    ])
  })

  it('uses exact path boundaries, unions overlapping scopes, and filters extensions literally', () => {
    const result = scanExactSemanticBlobs(new Map([
      ['src/file.ts', bytes('needle')],
      ['src/module.cts', bytes('needle')],
      ['src/module.mts', bytes('needle')],
      ['src/nested/file.ts', bytes('needle')],
      ['src/file.tsx', bytes('needle')],
      ['src/file.TS', bytes('needle')],
      ['src-other/file.ts', bytes('needle')],
    ]), [rule({
      includedExtensions: ['.cts', '.mts', '.ts'],
      pathScopes: ['src/nested', 'src'],
    })])

    expect(result.complete).toBe(true)
    expect(result.visited.paths).toEqual([
      'src/file.ts',
      'src/module.cts',
      'src/module.mts',
      'src/nested/file.ts',
    ])
    expect(result.matches.map(match => match.path)).toEqual(result.visited.paths)
  })

  it('retains independent provenance when multiple rules match the same path and occurrence', () => {
    const result = scanExactSemanticBlobs(
      new Map([['src/shared.ts', bytes('needle')]]),
      [rule({ id: 'scan.second' }), rule({ id: 'scan.first' })],
    )

    expect(result.matches).toHaveLength(2)
    expect(result.matches.map(match => match.ruleId)).toEqual(['scan.first', 'scan.second'])
    expect(result.visited.ruleIds).toEqual(['scan.first', 'scan.second'])
  })

  it('requires every group, treats patterns within a group as OR, and retains group provenance', () => {
    const result = scanExactSemanticBlobs(new Map([
      ['src/anchor-only.ts', bytes('embeddedBrowser')],
      ['src/qualified.ts', bytes('embeddedBrowser embedded-browser cookie requestHeaders cookie')],
      ['src/sensitive-only.ts', bytes('cookie')],
    ]), [rule({
      patternGroups: [
        ['embeddedBrowser', 'embedded-browser'],
        ['requestHeaders', 'cookie'],
      ],
      resultKind: 'audit-reference',
    })])

    expect(result.complete).toBe(true)
    expect(result.visited.paths).toEqual([
      'src/anchor-only.ts',
      'src/qualified.ts',
      'src/sensitive-only.ts',
    ])
    expect(result.matches.map(match => ({
      groupIndex: match.groupIndex,
      path: match.path,
      pattern: match.pattern,
      resultKind: match.resultKind,
    }))).toEqual([
      {
        groupIndex: 0,
        path: 'src/qualified.ts',
        pattern: 'embeddedBrowser',
        resultKind: 'audit-reference',
      },
      {
        groupIndex: 0,
        path: 'src/qualified.ts',
        pattern: 'embedded-browser',
        resultKind: 'audit-reference',
      },
      {
        groupIndex: 1,
        path: 'src/qualified.ts',
        pattern: 'cookie',
        resultKind: 'audit-reference',
      },
      {
        groupIndex: 1,
        path: 'src/qualified.ts',
        pattern: 'requestHeaders',
        resultKind: 'audit-reference',
      },
      {
        groupIndex: 1,
        path: 'src/qualified.ts',
        pattern: 'cookie',
        resultKind: 'audit-reference',
      },
    ])
  })

  it('fails closed on invalid UTF-8 without manufacturing replacement-character matches', () => {
    const invalidUtf8 = Uint8Array.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xc3, 0x28])
    const result = scanExactSemanticBlobs(
      new Map([['src/invalid.ts', invalidUtf8]]),
      [rule()],
    )

    expect(result.complete).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.visited.paths).toEqual(['src/invalid.ts'])
    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: 'semantic-scan.source-invalid-utf8',
      kind: 'unresolved-source',
      path: 'src/invalid.ts',
      ruleId: 'scan.default',
      value: sha256Bytes(Buffer.from(invalidUtf8)),
    }))
  })

  it('fails closed on unsupported profiles, duplicate ids, and empty rule fields', () => {
    const result = scanExactSemanticBlobs(
      new Map([['src/file.ts', bytes('needle')]]),
      [
        rule({ id: 'scan.duplicate' }),
        rule({ id: 'scan.duplicate', patternGroups: [['other']] }),
        rule({ id: 'scan.unsupported', matchProfile: 'regexp-v1' }),
        rule({ id: 'scan.unsupported-result', resultKind: 'unknown' }),
        rule({ id: 'scan.empty-scope', pathScopes: [''] }),
        rule({ id: 'scan.empty-pattern', patternGroups: [['']] }),
        rule({ id: 'scan.empty-pattern-group', patternGroups: [[]] }),
        rule({ id: 'scan.empty-extension', includedExtensions: [] }),
      ],
    )

    expect(result.complete).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.visited).toEqual({ paths: [], ruleIds: [] })
    expect(result.unresolved.map(item => item.code)).toEqual(expect.arrayContaining([
      'semantic-scan.included-extensions-empty',
      'semantic-scan.match-profile-unsupported',
      'semantic-scan.pattern-group-empty',
      'semantic-scan.path-scope-empty',
      'semantic-scan.pattern-empty',
      'semantic-scan.result-kind-unsupported',
      'semantic-scan.rule-id-duplicate',
    ]))
  })

  it('rejects the legacy flat patterns field even when v2 groups are also present', () => {
    const legacyRule = {
      ...rule(),
      patterns: ['needle'],
    } as ExactSemanticScanRule
    const result = scanExactSemanticBlobs(
      new Map([['src/file.ts', bytes('needle')]]),
      [legacyRule],
    )

    expect(result.complete).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.visited).toEqual({ paths: [], ruleIds: [] })
    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: 'semantic-scan.patterns-legacy-unsupported',
      kind: 'invalid-input',
    }))
  })

  it('rejects non-canonical repository-relative scopes and exclusions', () => {
    const invalidPaths = [
      '/src',
      'C:/src',
      './src',
      'src/../electron',
      'src//nested',
      'src\\nested',
      `src/${String.fromCharCode(1)}nested`,
      'src/',
    ]

    for (const [index, invalidPath] of invalidPaths.entries()) {
      const invalidScope = scanExactSemanticBlobs(
        new Map([['src/file.ts', bytes('needle')]]),
        [rule({ id: `scan.invalid-scope-${index}`, pathScopes: [invalidPath] })],
      )
      expect(invalidScope.complete).toBe(false)
      expect(invalidScope.visited).toEqual({ paths: [], ruleIds: [] })
      expect(invalidScope.unresolved).toContainEqual(expect.objectContaining({
        code: 'semantic-scan.path-scope-invalid',
        kind: 'invalid-input',
        value: invalidPath,
      }))

      const invalidExclusion = scanExactSemanticBlobs(
        new Map([['src/file.ts', bytes('needle')]]),
        [rule({ id: `scan.invalid-exclusion-${index}`, excludedPaths: [invalidPath] })],
      )
      expect(invalidExclusion.complete).toBe(false)
      expect(invalidExclusion.visited).toEqual({ paths: [], ruleIds: [] })
      expect(invalidExclusion.unresolved).toContainEqual(expect.objectContaining({
        code: 'semantic-scan.excluded-path-invalid',
        kind: 'invalid-input',
        value: invalidPath,
      }))
    }
  })

  it('fails closed on non-canonical blob map keys before scanning canonical aliases', () => {
    const invalidPaths = [
      'src/../x.ts',
      'src//x.ts',
      './src/x.ts',
      'src\\x.ts',
      `src/${String.fromCharCode(0xd800)}.ts`,
    ]

    for (const invalidPath of invalidPaths) {
      const result = scanExactSemanticBlobs(new Map([
        ['src/x.ts', bytes('needle')],
        [invalidPath, bytes('needle')],
      ]), [rule()])

      expect(result.complete).toBe(false)
      expect(result.matches).toEqual([])
      expect(result.visited).toEqual({ paths: [], ruleIds: [] })
      expect(result.unresolved).toEqual([
        expect.objectContaining({
          code: 'semantic-scan.blob-path-invalid',
          kind: 'invalid-input',
          path: invalidPath,
          value: invalidPath,
        }),
      ])
    }
  })

  it('rejects duplicate values within every rule collection', () => {
    const result = scanExactSemanticBlobs(
      new Map([['src/file.ts', bytes('needle')]]),
      [
        rule({ id: 'scan.duplicate-scope', pathScopes: ['src', 'src'] }),
        rule({ id: 'scan.duplicate-pattern', patternGroups: [['needle'], ['needle']] }),
        rule({ id: 'scan.duplicate-extension', includedExtensions: ['.ts', '.ts'] }),
        rule({ id: 'scan.duplicate-exclusion', excludedPaths: ['src/generated', 'src/generated'] }),
      ],
    )

    expect(result.complete).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.visited).toEqual({ paths: [], ruleIds: [] })
    expect(result.unresolved.map(item => item.code)).toEqual(expect.arrayContaining([
      'semantic-scan.excluded-path-duplicate',
      'semantic-scan.included-extension-duplicate',
      'semantic-scan.path-scope-duplicate',
      'semantic-scan.pattern-duplicate',
    ]))
    expect(result.unresolved.every(item => item.kind === 'invalid-input')).toBe(true)
  })

  it('requires approval for exclusions and applies exclusion boundaries exactly', () => {
    const result = scanExactSemanticBlobs(new Map([
      ['src/generated/file.ts', bytes('needle')],
      ['src/generated-next/file.ts', bytes('needle')],
      ['src/kept.ts', bytes('needle')],
    ]), [rule({ excludedPaths: ['src/generated'] })])

    expect(result.complete).toBe(false)
    expect(result.visited.paths).toEqual(['src/generated-next/file.ts', 'src/kept.ts'])
    expect(result.matches.map(match => match.path)).toEqual([
      'src/generated-next/file.ts',
      'src/kept.ts',
    ])
    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: 'semantic-scan.excluded-path-approval-required',
      kind: 'approval-required',
      path: 'src/generated',
      ruleId: 'scan.default',
    }))
  })

  it('marks a declared scope unresolved when it contains no included blob', () => {
    const result = scanExactSemanticBlobs(
      new Map([['src/file.tsx', bytes('needle')]]),
      [rule()],
    )

    expect(result.complete).toBe(false)
    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: 'semantic-scan.scope-unresolved',
      ruleId: 'scan.default',
      value: 'src',
    }))
  })

  it('uses finite default budgets and rejects invalid overrides before scanning', () => {
    expect(Object.values(DEFAULT_EXACT_SEMANTIC_SCAN_BUDGETS).every(value => (
      Number.isSafeInteger(value) && value > 0
    ))).toBe(true)

    const result = scanExactSemanticBlobs(
      new Map([['src/file.ts', bytes('needle')]]),
      [rule()],
      { maxHits: -1 },
    )

    expect(result.complete).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.visited).toEqual({ paths: [], ruleIds: [] })
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        code: 'semantic-scan.budget-invalid',
        kind: 'invalid-input',
        value: 'maxHits=-1',
      }),
    ])
  })

  it('enforces path, input-byte, rule, and pattern budgets before scan materialization', () => {
    const pathBudget = scanExactSemanticBlobs(new Map([
      ['src/a.ts', bytes('needle')],
      ['src/b.ts', bytes('needle')],
    ]), [rule()], { maxPaths: 1 })
    const inputByteBudget = scanExactSemanticBlobs(
      new Map([['src/file.ts', bytes('needle')]]),
      [rule()],
      { maxInputBytes: bytes('needle').byteLength - 1 },
    )
    const ruleBudget = scanExactSemanticBlobs(
      new Map([['src/file.ts', bytes('needle')]]),
      [rule({ id: 'scan.first' }), rule({ id: 'scan.second' })],
      { maxRules: 1 },
    )
    const patternBudget = scanExactSemanticBlobs(
      new Map([['src/file.ts', bytes('needle')]]),
      [rule({ patternGroups: [['needle', 'other']] })],
      { maxPatterns: 1 },
    )

    expect([
      pathBudget,
      inputByteBudget,
      ruleBudget,
      patternBudget,
    ].map(result => result.unresolved.map(item => item.code))).toEqual([
      ['semantic-scan.path-budget-exhausted'],
      ['semantic-scan.input-byte-budget-exhausted'],
      ['semantic-scan.rule-budget-exhausted'],
      ['semantic-scan.pattern-budget-exhausted'],
    ])
    for (const result of [pathBudget, inputByteBudget, ruleBudget, patternBudget]) {
      expect(result.complete).toBe(false)
      expect(result.matches).toEqual([])
      expect(result.visited).toEqual({ paths: [], ruleIds: [] })
    }
  })

  it('preflights total search work before UTF-8 decode or literal matching', () => {
    const invalidUtf8 = Uint8Array.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xc3, 0x28])
    const result = scanExactSemanticBlobs(
      new Map([['src/invalid.ts', invalidUtf8]]),
      [rule()],
      { maxSearchWork: 10 },
    )

    expect(result.complete).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.visited).toEqual({ paths: [], ruleIds: [] })
    expect(result.unresolved.map(item => item.code)).toEqual([
      'semantic-scan.search-work-budget-exhausted',
    ])
  })

  it('stops at the hit budget without returning partial semantic evidence', () => {
    const result = scanExactSemanticBlobs(
      new Map([['src/file.ts', bytes('needle needle')]]),
      [rule()],
      { maxHits: 1 },
    )

    expect(result.complete).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.visited).toEqual({
      paths: ['src/file.ts'],
      ruleIds: ['scan.default'],
    })
    expect(result.unresolved.map(item => item.code)).toEqual([
      'semantic-scan.hit-budget-exhausted',
    ])
  })

  it('is independent of map, rule, scope, OR-pattern, and extension input ordering', () => {
    const firstBlobs = new Map([
      ['src/z.ts', bytes('alpha beta')],
      ['src/a.ts', bytes('beta alpha')],
    ])
    const secondBlobs = new Map([...firstBlobs].reverse())
    const firstRules = [
      rule({
        id: 'scan.z',
        includedExtensions: ['.tsx', '.ts'],
        pathScopes: ['src/z.ts', 'src'],
        patternGroups: [['beta', 'alpha']],
      }),
      rule({ id: 'scan.a', patternGroups: [['alpha']] }),
    ]
    const secondRules = [
      rule({ id: 'scan.a', patternGroups: [['alpha']] }),
      rule({
        id: 'scan.z',
        includedExtensions: ['.ts', '.tsx'],
        pathScopes: ['src', 'src/z.ts'],
        patternGroups: [['alpha', 'beta']],
      }),
    ]

    expect(scanExactSemanticBlobs(secondBlobs, secondRules))
      .toEqual(scanExactSemanticBlobs(firstBlobs, firstRules))
  })

  it('uses only the supplied blob even when its path exists in the worktree', () => {
    const supplied = 'literal-only-in-supplied-blob'
    const result = scanExactSemanticBlobs(
      new Map([['package.json', bytes(supplied)]]),
      [rule({
        includedExtensions: ['.json'],
        pathScopes: ['package.json'],
        patternGroups: [[supplied, '"name"']],
      })],
    )

    expect(result.matches.map(match => match.pattern)).toEqual([supplied])
    expect(result.matches[0]?.sourceHash).toBe(sha256Bytes(supplied))
  })
})
