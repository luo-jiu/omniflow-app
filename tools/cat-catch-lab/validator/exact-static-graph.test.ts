import { describe, expect, it } from 'vitest'

import {
  buildExactStaticGraph,
  type ExactStaticGraphInput,
  type ExactStaticGraphResult,
  type ExactStaticInventoryLocator,
} from './exact-static-graph.ts'
import { sha256Bytes } from './json.ts'
import type { LocalClosureManifestEntry } from './types.ts'

const COMMIT = 'a'.repeat(40)
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    jsx: 'react-jsx',
    module: 'ESNext',
    moduleResolution: 'bundler',
    paths: { '@/*': ['./src/*'] },
    target: 'ES2022',
  },
})

type FixtureFiles = Record<string, Buffer | string>
type FixtureLocator = Omit<ExactStaticInventoryLocator, 'sourceHash'>

function bytesFor(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
}

function createInput(
  fixtureFiles: FixtureFiles,
  inventoryLocators: readonly FixtureLocator[] = [],
): ExactStaticGraphInput {
  const files: FixtureFiles = { 'tsconfig.json': TSCONFIG, ...fixtureFiles }
  const entries = Object.entries(files)
  const blobByPath = new Map(entries.map(([relativePath, value]) => [relativePath, bytesFor(value)]))
  const manifestByPath = new Map<string, LocalClosureManifestEntry>(entries.map(([relativePath, value]) => {
    const bytes = bytesFor(value)
    return [relativePath, {
      byteLength: bytes.length,
      contentHash: sha256Bytes(bytes),
      mode: '100644',
      path: relativePath,
    }]
  }))
  return {
    blobByPath,
    commit: COMMIT,
    inventoryLocators: inventoryLocators.map(locator => ({
      ...locator,
      sourceHash: manifestByPath.get(locator.path)?.contentHash || '',
    })),
    manifestByPath,
  }
}

function findNode(result: ExactStaticGraphResult, relativePath: string, symbol: string | null) {
  return result.nodes.find(node => node.locator?.path === relativePath && node.locator.symbol === symbol)
}

function serializableResult(result: ExactStaticGraphResult) {
  return {
    ...result,
    incomingEdgeIdsByNodeKey: [...result.incomingEdgeIdsByNodeKey],
    outgoingEdgeIdsByNodeKey: [...result.outgoingEdgeIdsByNodeKey],
  }
}

function expectLosslessSiteLedger(result: ExactStaticGraphResult): void {
  expect(new Set(result.sites.map(site => site.siteId)).size).toBe(result.sites.length)
  expect(result.resolutions).toHaveLength(result.sites.length)
  for (const site of result.sites) {
    const resolutions = result.resolutions.filter(resolution => resolution.siteId === site.siteId)
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]).toMatchObject({
      edgeKind: site.edgeKind,
      sourceNodeKey: site.ownerNodeKey,
    })
    expect(site.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(site.expressionHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(site.siteId).toMatch(/^static-site\.[0-9a-f]{64}$/)
  }
}

function expectEmptyBudgetFailure(
  result: ExactStaticGraphResult,
  code: 'static-graph-budget-exceeded' | 'static-graph-budget-invalid',
  messagePart: string,
): void {
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ code, fatal: true, message: expect.stringContaining(messagePart) }),
  ])
  expect(Object.values(result.coverage)).toEqual(Array(8).fill('blocked'))
  expect(result.nodes).toEqual([])
  expect(result.edges).toEqual([])
  expect(result.resolutions).toEqual([])
  expect(result.sites).toEqual([])
  expect([...result.incomingEdgeIdsByNodeKey]).toEqual([])
  expect([...result.outgoingEdgeIdsByNodeKey]).toEqual([])
}

describe('exact commit static graph', () => {
  it.each(([
    'maxBlobEntries',
    'maxManifestEntries',
    'maxInventoryLocators',
    'maxTotalBlobBytes',
    'maxSupportedSourceFiles',
    'maxSupportedSourceBytes',
  ] as const).map(key => ({ key })))('fails closed before parsing when $key is exceeded', ({ key }) => {
    const input = createInput({
      'src/bad-a.ts': 'export const = true\n',
      'src/bad-b.ts': 'export const = false\n',
    }, [
      { locatorKind: 'declaration', nodeId: 'node.bad-a', path: 'src/bad-a.ts', symbol: 'missingA' },
      { locatorKind: 'declaration', nodeId: 'node.bad-b', path: 'src/bad-b.ts', symbol: 'missingB' },
    ])

    const result = buildExactStaticGraph({
      ...input,
      budget: { [key]: 1 },
    })

    expectEmptyBudgetFailure(result, 'static-graph-budget-exceeded', key)
    expect(result.diagnostics.some(diagnostic => diagnostic.code.includes('parse'))).toBe(false)
  })

  it.each([
    { messagePart: 'maxBlobEntries', override: { maxBlobEntries: 0 } },
    { messagePart: 'maxSupportedSourceBytes', override: { maxSupportedSourceBytes: 1.5 } },
    { messagePart: 'unknownBudgetKey', override: { unknownBudgetKey: 1 } },
    { messagePart: 'must be an object', override: null },
  ])('fails closed for invalid budget configuration containing $messagePart', ({ messagePart, override }) => {
    const input = createInput({ 'src/main.ts': 'export const main = true\n' })
    const result = buildExactStaticGraph({
      ...input,
      budget: override as unknown as ExactStaticGraphInput['budget'],
    })

    expectEmptyBudgetFailure(result, 'static-graph-budget-invalid', messagePart)
  })

  it('resolves aliases, re-exports, calls, construction, and narrow injection from snapshot blobs', () => {
    const dependencySource = [
      'export const logger = { write() {} }',
      'export function dependency() {}',
      'export class Service {}',
      'export function registerFactory(factory: () => void) { void factory }',
      '',
    ].join('\n')
    const mainSource = [
      "import { logger, registerFactory, renamed, Service } from '@/barrel'",
      "import * as direct from './dependency'",
      "import './side-effect'",
      'export { renamed as publicDependency }',
      "export * from './dependency'",
      'export function run() {',
      '  const service = new Service(logger)',
      '  renamed()',
      '  direct.dependency()',
      '  registerFactory(renamed)',
      '  return service',
      '}',
      '',
    ].join('\n')
    const result = buildExactStaticGraph(createInput({
      'src/barrel.ts': "export { dependency as renamed, logger, registerFactory, Service } from './dependency'\n",
      'src/dependency.ts': dependencySource,
      'src/main.ts': mainSource,
      'src/side-effect.ts': 'export const sideEffect = true\n',
    }, [
      { locatorKind: 'declaration', nodeId: 'node.run', path: 'src/main.ts', symbol: 'run' },
      { locatorKind: 'declaration', nodeId: 'node.dependency', path: 'src/dependency.ts', symbol: 'dependency' },
      { locatorKind: 'declaration', nodeId: 'node.service', path: 'src/dependency.ts', symbol: 'Service' },
      { locatorKind: 'declaration', nodeId: 'node.logger', path: 'src/dependency.ts', symbol: 'logger' },
    ]))

    expect(result.diagnostics).toEqual([])
    expect(result.coverage).toMatchObject({
      call: 'partial',
      construct: 'partial',
      dependencyInjection: 'partial',
      importExport: 'partial',
      reverseIndex: 'complete',
      sourceParsing: 'complete',
      staticDependencyGraph: 'partial',
    })
    expect(findNode(result, 'src/main.ts', 'run')?.nodeKey).toBe('node.run')
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.run',
      kind: 'construct',
      toNodeKey: 'node.service',
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.run',
      kind: 'dependency-injection',
      toNodeKey: 'node.logger',
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.run',
      kind: 'dependency-injection',
      toNodeKey: 'node.dependency',
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.run',
      kind: 'call',
      sites: expect.arrayContaining([
        expect.objectContaining({ path: 'src/main.ts' }),
        expect.objectContaining({ path: 'src/main.ts' }),
      ]),
      toNodeKey: 'node.dependency',
    }))
    const mainModule = findNode(result, 'src/main.ts', null)
    const sideEffectModule = findNode(result, 'src/side-effect.ts', null)
    expect(mainModule?.nodeKey).toMatch(/^module\.[0-9a-f]{64}$/)
    expect(result.edges.every(edge => /^[a-z-]+\.[0-9a-f]{64}$/.test(edge.edgeId))).toBe(true)
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: mainModule?.nodeKey,
      kind: 'export',
      toNodeKey: 'node.dependency',
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: mainModule?.nodeKey,
      kind: 'import',
      toNodeKey: sideEffectModule?.nodeKey,
    }))
    expectLosslessSiteLedger(result)
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      projectedEdgeId: expect.stringMatching(/^static-call\.[0-9a-f]{64}$/),
      status: 'local',
      terminal: 'resolved-static',
    }))
  })

  it('preserves external modules, models exact assets, and blocks missing local modules without disk fallback', () => {
    const probePath = 'tools/cat-catch-lab/validator/probe.ts'
    const result = buildExactStaticGraph(createInput({
      'src/styles.css': '.capture { display: none }\n',
      [probePath]: [
        "import path from 'node:path'",
        "import { sha256Bytes } from './json'",
        "import './missing'",
        "import './../../../src/styles.css'",
        "path.join('a', 'b')",
        'sha256Bytes("value")',
        '',
      ].join('\n'),
    }))

    expect(result.nodes).toContainEqual(expect.objectContaining({
      externalSpecifier: 'node:path',
      kind: 'external-module',
      projectable: false,
    }))
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: false,
      specifier: 'node:path',
      status: 'external',
    }))
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      specifier: './json',
      status: 'unresolved',
    }))
    const probeModule = findNode(result, probePath, null)
    const stylesheet = findNode(result, 'src/styles.css', null)
    expect(stylesheet).toMatchObject({
      kind: 'asset',
      projectable: true,
      sourceHash: sha256Bytes(Buffer.from('.capture { display: none }\n', 'utf8')),
    })
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: probeModule?.nodeKey,
      kind: 'import',
      toNodeKey: stylesheet?.nodeKey,
    }))
    expect(result.outgoingEdgeIdsByNodeKey.get(stylesheet?.nodeKey || '')).toEqual([])
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: false,
      specifier: './../../../src/styles.css',
      status: 'local',
      terminal: 'resolved-static',
    }))
    expect(result.coverage.moduleResolution).toBe('blocked')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'static-graph-local-target-unresolved',
      fatal: true,
    }))
  })

  it('keeps relative, aliased, JSON, and binary assets as exact opaque leaf nodes', () => {
    const binaryPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00])
    const expectedHashes = new Map<string, string>([
      ['src/data.json', sha256Bytes(Buffer.from('{"enabled":true}\n', 'utf8'))],
      ['src/image.png', sha256Bytes(binaryPng)],
      ['src/styles.css', sha256Bytes(Buffer.from('.capture { display: block }\n', 'utf8'))],
      ['src/theme.less', sha256Bytes(Buffer.from('@capture-color: #1677ff;\n', 'utf8'))],
    ])
    const mainSource = [
      "import './styles.css'",
      "import '@/theme.less'",
      "import data from './data.json'",
      "import './image.png'",
      'void data',
      '',
    ].join('\n')
    const result = buildExactStaticGraph(createInput({
      'src/data.json': '{"enabled":true}\n',
      'src/image.png': binaryPng,
      'src/main.ts': mainSource,
      'src/styles.css': '.capture { display: block }\n',
      'src/styles.css.map': '{"version":3}\n',
      'src/theme.less': '@capture-color: #1677ff;\n',
    }))

    expect(result.diagnostics).toEqual([])
    const mainModule = findNode(result, 'src/main.ts', null)
    const assetPaths = ['src/data.json', 'src/image.png', 'src/styles.css', 'src/theme.less']
    for (const assetPath of assetPaths) {
      const asset = findNode(result, assetPath, null)
      expect(asset).toMatchObject({
        kind: 'asset',
        locator: { locatorKind: null, path: assetPath, symbol: null },
        projectable: true,
        sourceHash: expectedHashes.get(assetPath),
      })
      expect(result.edges).toContainEqual(expect.objectContaining({
        fromNodeKey: mainModule?.nodeKey,
        kind: 'import',
        toNodeKey: asset?.nodeKey,
      }))
      expect(result.outgoingEdgeIdsByNodeKey.get(asset?.nodeKey || '')).toEqual([])
    }
    expect(findNode(result, 'src/image.png', null)?.sourceHash).toBe(sha256Bytes(binaryPng))
    expect(findNode(result, 'src/styles.css.map', null)).toBeUndefined()
    expect(result.nodes.filter(node => node.kind === 'asset')).toHaveLength(assetPaths.length)
    expect(result.coverage.moduleResolution).toBe('complete')
  })

  it('fails closed when an extensionless local asset import is ambiguous', () => {
    const result = buildExactStaticGraph(createInput({
      'src/main.ts': "import './theme'\n",
      'src/theme.css': '.capture {}\n',
      'src/theme.less': '.capture {}\n',
    }))

    expect(result.nodes.some(node => node.kind === 'asset')).toBe(false)
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      attemptedPaths: expect.arrayContaining(['src/theme.css', 'src/theme.less']),
      blocking: true,
      reason: expect.stringContaining('multiple tracked opaque assets'),
      specifier: './theme',
      status: 'unresolved',
    }))
    expect(result.coverage.moduleResolution).toBe('blocked')
  })

  it.each([
    {
      mutate: (input: ExactStaticGraphInput) => {
        const blobByPath = new Map(input.blobByPath)
        blobByPath.delete('src/asset.css')
        return { ...input, blobByPath }
      },
      name: 'missing blob bytes',
      reason: 'both the blob map and source manifest',
    },
    {
      mutate: (input: ExactStaticGraphInput) => {
        const manifestByPath = new Map(input.manifestByPath)
        manifestByPath.delete('src/asset.css')
        return { ...input, manifestByPath }
      },
      name: 'missing manifest entry',
      reason: 'both the blob map and source manifest',
    },
    {
      mutate: (input: ExactStaticGraphInput) => {
        const manifestByPath = new Map(input.manifestByPath)
        const manifest = manifestByPath.get('src/asset.css') as LocalClosureManifestEntry
        manifestByPath.set('src/asset.css', { ...manifest, contentHash: `sha256:${'0'.repeat(64)}` })
        return { ...input, manifestByPath }
      },
      name: 'mismatched manifest bytes',
      reason: 'does not bind the exact blob bytes and path',
    },
    {
      mutate: (input: ExactStaticGraphInput) => {
        const manifestByPath = new Map(input.manifestByPath)
        const manifest = manifestByPath.get('src/asset.css') as LocalClosureManifestEntry
        manifestByPath.set('src/asset.css', { ...manifest, mode: '120000' })
        return { ...input, manifestByPath }
      },
      name: 'symlink manifest mode',
      reason: 'symlink manifest entry',
    },
  ])('fails closed for an opaque asset with $name', ({ mutate, reason }) => {
    const input = mutate(createInput({
      'src/asset.css': '.capture {}\n',
      'src/main.ts': "import './asset.css'\n",
    }))
    const result = buildExactStaticGraph(input)

    expect(findNode(result, 'src/asset.css', null)).toBeUndefined()
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      reason: expect.stringContaining(reason),
      specifier: './asset.css',
      status: 'unresolved',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'static-graph-local-target-unresolved',
      fatal: true,
    }))
    expect(result.coverage.moduleResolution).toBe('blocked')
  })

  it.each([
    {
      name: 'a manifest hash copied into the locator without matching the blob',
      mutate: (input: ExactStaticGraphInput) => {
        const forgedHash = `sha256:${'0'.repeat(64)}`
        const manifestByPath = new Map(input.manifestByPath)
        const manifest = manifestByPath.get('metadata.json') as LocalClosureManifestEntry
        manifestByPath.set('metadata.json', { ...manifest, contentHash: forgedHash })
        return {
          ...input,
          inventoryLocators: input.inventoryLocators?.map(locator => ({ ...locator, sourceHash: forgedHash })),
          manifestByPath,
        }
      },
    },
    {
      name: 'a symlink manifest mode',
      mutate: (input: ExactStaticGraphInput) => {
        const manifestByPath = new Map(input.manifestByPath)
        const manifest = manifestByPath.get('metadata.json') as LocalClosureManifestEntry
        manifestByPath.set('metadata.json', { ...manifest, mode: '120000' })
        return { ...input, manifestByPath }
      },
    },
    {
      name: 'a manifest path that differs from its map key',
      mutate: (input: ExactStaticGraphInput) => {
        const manifestByPath = new Map(input.manifestByPath)
        const manifest = manifestByPath.get('metadata.json') as LocalClosureManifestEntry
        manifestByPath.set('metadata.json', { ...manifest, path: 'other.json' })
        return { ...input, manifestByPath }
      },
    },
    {
      name: 'an incorrect byte length',
      mutate: (input: ExactStaticGraphInput) => {
        const manifestByPath = new Map(input.manifestByPath)
        const manifest = manifestByPath.get('metadata.json') as LocalClosureManifestEntry
        manifestByPath.set('metadata.json', { ...manifest, byteLength: manifest.byteLength + 1 })
        return { ...input, manifestByPath }
      },
    },
  ])('binds a non-source inventory locator to exact blob bytes despite $name', ({ mutate }) => {
    const input = mutate(createInput({
      'metadata.json': '{"marker":"opaque-marker"}\n',
    }, [
      { locatorKind: 'runtime-literal', nodeId: 'node.metadata', path: 'metadata.json', symbol: 'opaque-marker' },
    ]))

    const result = buildExactStaticGraph(input)

    expect(result.nodes.some(node => node.inventoryNodeId === 'node.metadata')).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'static-graph-inventory-source-binding-mismatch',
      fatal: true,
      path: 'metadata.json',
    }))
  })

  it('does not treat a source map sidecar as a missing exact asset', () => {
    const result = buildExactStaticGraph(createInput({
      'src/main.ts': "import './missing.css'\n",
      'src/missing.css.map': '{"version":3}\n',
    }))

    expect(findNode(result, 'src/missing.css.map', null)).toBeUndefined()
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      specifier: './missing.css',
      status: 'unresolved',
    }))
  })

  it('maps nested destructuring bindings to exact canonical declarations and owners', () => {
    const source = [
      'export function makeDefault() { return () => undefined }',
      'export const [',
      '  value = makeDefault(),',
      '  setValue,',
      '  { handler: nestedHandler = makeDefault(), branch: [, deepHandler], ...nestedRest },',
      '  ...tail',
      '] = pair',
      'export const {',
      '  handler: localHandler = makeDefault(),',
      '  nested: { deep: deepLocal },',
      '  array: [, arrayHandler],',
      '  ...rest',
      '} = objectValue',
      'export function run() {',
      '  setValue(value)',
      '  localHandler()',
      '  nestedHandler()',
      '  deepHandler()',
      '  deepLocal()',
      '  arrayHandler()',
      '  nestedRest()',
      '  rest()',
      '  tail()',
      '}',
      '',
    ].join('\n')
    const symbols = [
      'value',
      'setValue',
      'nestedHandler',
      'deepHandler',
      'nestedRest',
      'tail',
      'localHandler',
      'deepLocal',
      'arrayHandler',
      'rest',
    ]
    const result = buildExactStaticGraph(createInput({ 'src/destructuring.ts': source }, [
      { locatorKind: 'declaration', nodeId: 'node.make-default', path: 'src/destructuring.ts', symbol: 'makeDefault' },
      { locatorKind: 'declaration', nodeId: 'node.run', path: 'src/destructuring.ts', symbol: 'run' },
      ...symbols.map(symbol => ({
        locatorKind: 'declaration' as const,
        nodeId: `node.${symbol}`,
        path: 'src/destructuring.ts',
        symbol,
      })),
    ]))

    for (const symbol of symbols) {
      const node = findNode(result, 'src/destructuring.ts', symbol)
      expect(node?.nodeKey).toBe(`node.${symbol}`)
      expect(node?.declarationSites).toEqual([
        expect.objectContaining({ syntaxKind: 'BindingElement' }),
      ])
    }
    for (const symbol of symbols.filter(symbol => symbol !== 'value')) {
      expect(result.resolutions).toContainEqual(expect.objectContaining({
        blocking: true,
        candidateTargetNodeKeys: [`node.${symbol}`],
        edgeKind: 'call',
        sourceNodeKey: 'node.run',
        status: 'unresolved',
      }))
    }
    for (const owner of ['value', 'nestedHandler', 'localHandler']) {
      expect(result.edges).toContainEqual(expect.objectContaining({
        fromNodeKey: `node.${owner}`,
        kind: 'call',
        toNodeKey: 'node.make-default',
      }))
    }
  })

  it('classifies literal dynamic import and CommonJS require through exact module resolution', () => {
    const dynamicSource = [
      "export type LocalShape = import('./local').LocalShape",
      "export async function loadLocal() { return await import('./local') }",
      'export function loadAsset() { return import(`./theme.css`) }',
      "export function loadExternal() { return import('node:path') }",
      "export function requireLocal() { return require('./local') }",
      "export function requireExternal() { return require('external-package') }",
      '',
    ].join('\n')
    const functionNames = [
      'loadLocal',
      'loadAsset',
      'loadExternal',
      'requireLocal',
      'requireExternal',
    ]
    const result = buildExactStaticGraph(createInput({
      'src/dynamic.ts': dynamicSource,
      'src/local.ts': 'export type LocalShape = { value: string }\nexport const local = true\n',
      'src/theme.css': '.capture {}\n',
    }, [
      { locatorKind: 'declaration', nodeId: 'node.local-shape', path: 'src/dynamic.ts', symbol: 'LocalShape' },
      ...functionNames.map(symbol => ({
        locatorKind: 'declaration' as const,
        nodeId: `node.${symbol}`,
        path: 'src/dynamic.ts',
        symbol,
      })),
    ]))

    expect(result.diagnostics).toEqual([])
    const localModule = findNode(result, 'src/local.ts', null)
    const asset = findNode(result, 'src/theme.css', null)
    expect(asset?.kind).toBe('asset')
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.local-shape',
      kind: 'import',
      sites: expect.arrayContaining([expect.objectContaining({
        resolutionRule: 'import-type-static-specifier',
        typeOnly: true,
      })]),
      toNodeKey: localModule?.nodeKey,
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.loadLocal',
      kind: 'import',
      sites: expect.arrayContaining([expect.objectContaining({
        resolutionRule: 'dynamic-import-static-specifier',
      })]),
      toNodeKey: localModule?.nodeKey,
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.loadAsset',
      kind: 'import',
      toNodeKey: asset?.nodeKey,
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.requireLocal',
      kind: 'import',
      sites: expect.arrayContaining([expect.objectContaining({
        resolutionRule: 'commonjs-require-static-specifier',
      })]),
      toNodeKey: localModule?.nodeKey,
    }))
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: false,
      sourceNodeKey: 'node.loadExternal',
      specifier: 'node:path',
      status: 'external',
    }))
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: false,
      sourceNodeKey: 'node.requireExternal',
      specifier: 'external-package',
      status: 'external',
    }))
    expect(result.coverage).toMatchObject({ call: 'partial', importExport: 'partial' })
  })

  it('emits blocking evidence for non-literal, missing, and ambiguous dynamic module targets', () => {
    const source = [
      'export function loadDynamic(specifier: string) { return import(specifier) }',
      'export function requireDynamic(specifier: string) { return require(specifier) }',
      'export function missingImport() { return import() }',
      'export function missingRequire() { return require() }',
      "export function ambiguousImport() { return import('./theme') }",
      '',
    ].join('\n')
    const functionNames = [
      'loadDynamic',
      'requireDynamic',
      'missingImport',
      'missingRequire',
      'ambiguousImport',
    ]
    const result = buildExactStaticGraph(createInput({
      'src/dynamic-unresolved.ts': source,
      'src/theme.css': '.capture {}\n',
      'src/theme.less': '.capture {}\n',
    }, functionNames.map(symbol => ({
      locatorKind: 'declaration',
      nodeId: `node.${symbol}`,
      path: 'src/dynamic-unresolved.ts',
      symbol,
    }))))

    for (const sourceNodeKey of ['node.loadDynamic', 'node.requireDynamic']) {
      expect(result.resolutions).toContainEqual(expect.objectContaining({
        blocking: true,
        reason: expect.stringContaining('not a static string literal'),
        site: expect.objectContaining({ resolutionRule: expect.stringContaining('unresolved-expression') }),
        sourceNodeKey,
        specifier: null,
        status: 'unresolved',
      }))
    }
    for (const sourceNodeKey of ['node.missingImport', 'node.missingRequire']) {
      expect(result.resolutions).toContainEqual(expect.objectContaining({
        blocking: true,
        reason: expect.stringContaining('has no module specifier argument'),
        sourceNodeKey,
        specifier: null,
        status: 'unresolved',
      }))
    }
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      reason: expect.stringContaining('multiple tracked opaque assets'),
      sourceNodeKey: 'node.ambiguousImport',
      specifier: './theme',
      status: 'unresolved',
    }))
    expect(result.coverage.importExport).toBe('blocked')
  })

  it('keeps a shadowed local require in the ordinary checker call graph', () => {
    const source = [
      'export function require(specifier: string) { return specifier }',
      "export function useLocalRequire() { return require('./missing') }",
      '',
    ].join('\n')
    const result = buildExactStaticGraph(createInput({ 'src/shadowed-require.ts': source }, [
      { locatorKind: 'declaration', nodeId: 'node.require', path: 'src/shadowed-require.ts', symbol: 'require' },
      { locatorKind: 'declaration', nodeId: 'node.use-local-require', path: 'src/shadowed-require.ts', symbol: 'useLocalRequire' },
    ]))

    expect(result.diagnostics).toEqual([])
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.use-local-require',
      kind: 'call',
      toNodeKey: 'node.require',
    }))
    expect(result.edges).not.toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.use-local-require',
      kind: 'import',
    }))
    expect(result.resolutions).not.toContainEqual(expect.objectContaining({
      expression: expect.stringContaining('./missing'),
    }))
    expect(result.coverage).toMatchObject({ call: 'partial', importExport: 'partial' })
  })

  it('does not manufacture CommonJS exports from shadowed exports, module, or Object bindings', () => {
    const source = [
      'function local() {}',
      'function mutateLocalExports(exports) { exports.named = local }',
      'function mutateLocalModule(module) { module.exports = local }',
      'function callLocalObject(Object) {',
      '  Object.assign(exports, { named: local })',
      '}',
      '',
    ].join('\n')

    const result = buildExactStaticGraph(createInput({ 'src/shadowed-commonjs.cjs': source }))

    expect(result.sites.filter(site => site.edgeKind === 'export')).toEqual([])
    expect(result.resolutions.filter(resolution => resolution.edgeKind === 'export')).toEqual([])
    expect(result.edges.filter(edge => edge.kind === 'export')).toEqual([])
    expect(result.sites.map(site => site.role)).not.toContain('commonjs-export-binding')
    expect(result.sites.map(site => site.role)).not.toContain('commonjs-export-helper')
  })

  it('fails closed for parameter callbacks and collection or global calls instead of dropping their sites', () => {
    const source = [
      'export function first() {}',
      'export function invoke(callback: () => void) { callback() }',
      'export function run() {',
      '  const handlers = [first]',
      '  handlers.forEach(first)',
      '  setTimeout(first, 0)',
      '  console.log("done")',
      '  invoke(first)',
      '}',
      '',
    ].join('\n')
    const result = buildExactStaticGraph(createInput({ 'src/dynamic-calls.ts': source }, [
      { locatorKind: 'declaration', nodeId: 'node.first', path: 'src/dynamic-calls.ts', symbol: 'first' },
      { locatorKind: 'declaration', nodeId: 'node.invoke', path: 'src/dynamic-calls.ts', symbol: 'invoke' },
      { locatorKind: 'declaration', nodeId: 'node.run', path: 'src/dynamic-calls.ts', symbol: 'run' },
    ]))

    for (const expression of ['callback', 'handlers.forEach', 'setTimeout', 'console.log']) {
      expect(result.resolutions).toContainEqual(expect.objectContaining({
        blocking: true,
        edgeKind: 'call',
        expression,
        status: 'unresolved',
        terminal: 'unresolved',
      }))
    }
    expect(result.coverage.call).toBe('blocked')
    expect(result.coverage.staticDependencyGraph).toBe('blocked')
    expectLosslessSiteLedger(result)
  })

  it('retains known union targets and fails closed for union call, constructor, and super dispatch', () => {
    const source = [
      'export function first() {}',
      'export function second() {}',
      'export class First {}',
      'export class Second {}',
      'export class Child extends First { constructor() { super() } }',
      'export function run(condition: boolean) {',
      '  const callback = condition ? first : second',
      '  const Constructor = condition ? First : Second',
      '  callback()',
      '  new Constructor()',
      '}',
      '',
    ].join('\n')
    const result = buildExactStaticGraph(createInput({ 'src/union-dispatch.ts': source }, [
      { locatorKind: 'declaration', nodeId: 'node.first', path: 'src/union-dispatch.ts', symbol: 'first' },
      { locatorKind: 'declaration', nodeId: 'node.second', path: 'src/union-dispatch.ts', symbol: 'second' },
      { locatorKind: 'declaration', nodeId: 'node.First', path: 'src/union-dispatch.ts', symbol: 'First' },
      { locatorKind: 'declaration', nodeId: 'node.Second', path: 'src/union-dispatch.ts', symbol: 'Second' },
      { locatorKind: 'declaration', nodeId: 'node.Child', path: 'src/union-dispatch.ts', symbol: 'Child' },
      { locatorKind: 'declaration', nodeId: 'node.run', path: 'src/union-dispatch.ts', symbol: 'run' },
    ]))

    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      candidateTargetNodeKeys: ['node.first', 'node.second'],
      edgeKind: 'call',
      expression: 'callback',
      status: 'unresolved',
    }))
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      candidateTargetNodeKeys: ['node.First', 'node.Second'],
      edgeKind: 'construct',
      expression: 'Constructor',
      status: 'unresolved',
    }))
    expect(result.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      edgeKind: 'call',
      expression: 'super',
      reason: expect.stringContaining('heritage-target expansion'),
      status: 'unresolved',
    }))
    expect(result.coverage).toMatchObject({ call: 'blocked', construct: 'blocked' })
    expect(result.analyzerProfileLimitations).toContainEqual(expect.objectContaining({
      affectedCoverage: expect.arrayContaining(['construct']),
      code: 'construct-target-fixed-point-not-expanded',
    }))
    expectLosslessSiteLedger(result)
  })

  it('records TypeScript and direct CommonJS exports and blocks unsupported export or bundler-loader helpers', () => {
    const resolved = buildExactStaticGraph(createInput({
      'src/common.cjs': 'function common() {}\nmodule.exports = common\nexports.named = common\n',
      'src/export-equals.ts': 'function exported() {}\nexport = exported\n',
    }))

    expect(resolved.diagnostics).toEqual([])
    expect(resolved.sites.filter(site => site.role === 'commonjs-export-binding')).toHaveLength(2)
    expect(resolved.resolutions.filter(resolution => (
      resolution.edgeKind === 'export' && resolution.status === 'local'
    )).length).toBeGreaterThanOrEqual(5)
    expect(resolved.coverage.importExport).toBe('partial')
    expectLosslessSiteLedger(resolved)

    const unsupported = buildExactStaticGraph(createInput({
      'src/unsupported.ts': [
        'Object.defineProperty(exports, "named", { get() { return 1 } })',
        'import.meta.glob("./icons/*.svg")',
        '',
      ].join('\n'),
    }))
    expect(unsupported.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      edgeKind: 'export',
      status: 'unresolved',
    }))
    expect(unsupported.resolutions).toContainEqual(expect.objectContaining({
      blocking: true,
      edgeKind: 'import',
      status: 'unresolved',
    }))
    expect(unsupported.sites.map(site => site.role)).toEqual(expect.arrayContaining([
      'bundler-glob-loader',
      'commonjs-export-helper',
    ]))
    expect(unsupported.coverage.importExport).toBe('blocked')
    expectLosslessSiteLedger(unsupported)
  })

  it('binds tsconfig bytes and mode before using resolution options', () => {
    const input = createInput({ 'src/main.ts': 'export const main = true\n' })
    const manifestByPath = new Map(input.manifestByPath)
    const configManifest = manifestByPath.get('tsconfig.json')
    expect(configManifest).toBeDefined()
    manifestByPath.set('tsconfig.json', {
      ...(configManifest as LocalClosureManifestEntry),
      contentHash: `sha256:${'0'.repeat(64)}`,
    })

    const result = buildExactStaticGraph({ ...input, manifestByPath })

    expect(result.coverage.sourceParsing).toBe('blocked')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'static-graph-tsconfig-manifest-mismatch',
      fatal: true,
      path: 'tsconfig.json',
    }))
  })

  it('covers default and type-only exports, index resolution, declaration files, TSX, and optional calls', () => {
    const entrySource = [
      "import Widget, { optional } from './widget'",
      "import type { Contract } from './types'",
      "export { default as PublicWidget } from './widget'",
      "export type { Contract } from './types'",
      'const contract: Contract = { value: "fixture" }',
      'optional?.()',
      'Widget(contract)',
      'export default Widget',
      '',
    ].join('\n')
    const widgetSource = [
      "import type { Contract } from '../types'",
      'export default function Widget(props: Contract) {',
      '  return <div>{props.value}</div>',
      '}',
      'export const optional = () => undefined',
      '',
    ].join('\n')
    const result = buildExactStaticGraph(createInput({
      'src/entry.tsx': entrySource,
      'src/types.d.ts': 'export interface Contract { value: string }\n',
      'src/widget/index.tsx': widgetSource,
    }, [
      { locatorKind: 'declaration', nodeId: 'node.widget', path: 'src/widget/index.tsx', symbol: 'Widget' },
      { locatorKind: 'declaration', nodeId: 'node.optional', path: 'src/widget/index.tsx', symbol: 'optional' },
    ]))

    expect(result.diagnostics).toEqual([])
    const entryModule = findNode(result, 'src/entry.tsx', null)
    const typesModule = findNode(result, 'src/types.d.ts', null)
    const widgetModule = findNode(result, 'src/widget/index.tsx', null)
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: entryModule?.nodeKey,
      kind: 'import',
      toNodeKey: widgetModule?.nodeKey,
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: entryModule?.nodeKey,
      kind: 'export',
      toNodeKey: 'node.widget',
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: entryModule?.nodeKey,
      kind: 'call',
      toNodeKey: 'node.optional',
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: entryModule?.nodeKey,
      kind: 'call',
      toNodeKey: 'node.widget',
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: entryModule?.nodeKey,
      kind: 'import',
      sites: expect.arrayContaining([expect.objectContaining({ typeOnly: true })]),
      toNodeKey: typesModule?.nodeKey,
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: entryModule?.nodeKey,
      kind: 'export',
      sites: expect.arrayContaining([expect.objectContaining({ typeOnly: true })]),
      toNodeKey: typesModule?.nodeKey,
    }))
  })

  it('preserves runtime semantics for mixed imports and exact type-only re-exports', () => {
    const result = buildExactStaticGraph(createInput({
      'src/consumer.ts': [
        "import RuntimeDefault, { type FirstType } from './dependency'",
        "import { type FirstType as FirstAlias, type SecondType } from './dependency'",
        "import { type FirstType as MixedType, runtimeValue } from './dependency'",
        "export { type FirstType } from './dependency'",
        "export { type SecondType as MixedExportType, runtimeValue } from './dependency'",
        "export type * from './dependency'",
        'RuntimeDefault()',
        'void runtimeValue',
        'void (0 as unknown as FirstAlias)',
        'void (0 as unknown as SecondType)',
        'void (0 as unknown as MixedType)',
        '',
      ].join('\n'),
      'src/dependency.ts': [
        'export default function RuntimeDefault() {}',
        'export interface FirstType { first: true }',
        'export interface SecondType { second: true }',
        'export const runtimeValue = true',
        '',
      ].join('\n'),
    }))

    expect(result.diagnostics).toEqual([])
    const moduleSites = result.sites
      .filter(site => site.path === 'src/consumer.ts' && site.role === 'module-specifier')
      .map(site => ({ edgeKind: site.edgeKind, line: site.line, typeOnly: site.typeOnly }))
      .sort((left, right) => left.line - right.line)
    expect(moduleSites).toEqual([
      { edgeKind: 'import', line: 1, typeOnly: false },
      { edgeKind: 'import', line: 2, typeOnly: true },
      { edgeKind: 'import', line: 3, typeOnly: false },
      { edgeKind: 'export', line: 4, typeOnly: true },
      { edgeKind: 'export', line: 5, typeOnly: false },
      { edgeKind: 'export', line: 6, typeOnly: true },
    ])
    expectLosslessSiteLedger(result)
  })

  it.each([
    {
      code: 'static-graph-invalid-utf8',
      files: { 'src/bad.ts': Buffer.from([0xff, 0xfe]) },
      name: 'invalid UTF-8',
    },
    {
      code: 'static-graph-source-parse-error',
      files: { 'src/bad.ts': 'export const = true\n' },
      name: 'a TypeScript parse error',
    },
  ])('fails closed for $name', ({ code, files }) => {
    const result = buildExactStaticGraph(createInput(files))

    expect(result.coverage.sourceParsing).toBe('blocked')
    expect(result.coverage.staticDependencyGraph).toBe('blocked')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, fatal: true }))
  })

  it('builds deterministic cyclic/self edges and exact reverse indexes while keeping runtime literals opaque', () => {
    const files = {
      'src/a.ts': "import { b } from './b'\nexport function a() { b(); a() }\n",
      'src/b.ts': "import { a } from './a'\nexport function b() { a() }\n",
      'src/runtime.ts': 'export const marker = "opaque-marker"\n',
    }
    const locators: FixtureLocator[] = [
      { locatorKind: 'declaration', nodeId: 'node.a', path: 'src/a.ts', symbol: 'a' },
      { locatorKind: 'declaration', nodeId: 'node.b', path: 'src/b.ts', symbol: 'b' },
      { locatorKind: 'runtime-literal', nodeId: 'node.runtime', path: 'src/runtime.ts', symbol: 'opaque-marker' },
    ]
    const firstInput = createInput(files, locators)
    const secondInput: ExactStaticGraphInput = {
      ...firstInput,
      blobByPath: new Map([...firstInput.blobByPath].reverse()),
      manifestByPath: new Map([...firstInput.manifestByPath].reverse()),
    }
    const first = buildExactStaticGraph(firstInput)
    const second = buildExactStaticGraph(secondInput)

    expect(serializableResult(second)).toEqual(serializableResult(first))
    expect(first.diagnostics).toEqual([])
    expect(first.edges).toContainEqual(expect.objectContaining({
      fromNodeKey: 'node.a',
      kind: 'call',
      toNodeKey: 'node.a',
    }))
    for (const edge of first.edges) {
      expect(first.outgoingEdgeIdsByNodeKey.get(edge.fromNodeKey)).toContain(edge.edgeId)
      expect(first.incomingEdgeIdsByNodeKey.get(edge.toNodeKey)).toContain(edge.edgeId)
    }
    expect(first.outgoingEdgeIdsByNodeKey.get('node.runtime')).toEqual([])
    expect(first.incomingEdgeIdsByNodeKey.get('node.runtime')).toEqual([])
  })

  it('accepts overload/accessor groups but fails an inventory locator spanning multiple scopes', () => {
    const groupedSource = [
      'export function overloaded(value: string): string',
      'export function overloaded(value: number): number',
      'export function overloaded(value: string | number) { return `${value}` }',
      'export class Box {',
      '  get value() { return 1 }',
      '  set value(next: number) { void next }',
      '}',
      'overloaded("value")',
      '',
    ].join('\n')
    const grouped = buildExactStaticGraph(createInput({ 'src/groups.ts': groupedSource }, [
      { locatorKind: 'declaration', nodeId: 'node.overloaded', path: 'src/groups.ts', symbol: 'overloaded' },
      { locatorKind: 'member', nodeId: 'node.value', path: 'src/groups.ts', symbol: 'value' },
    ]))

    expect(grouped.diagnostics).toEqual([])
    expect(grouped.nodes.filter(node => node.nodeKey === 'node.overloaded')).toHaveLength(1)
    expect(grouped.nodes.filter(node => node.nodeKey === 'node.value')).toHaveLength(1)

    const ambiguousSource = [
      'function first() { function duplicate() {} }',
      'function second() { function duplicate() {} }',
      '',
    ].join('\n')
    const ambiguous = buildExactStaticGraph(createInput({ 'src/ambiguous.ts': ambiguousSource }, [{
      locatorKind: 'declaration',
      nodeId: 'node.duplicate',
      path: 'src/ambiguous.ts',
      symbol: 'duplicate',
    }]))

    expect(ambiguous.coverage.staticDependencyGraph).toBe('blocked')
    expect(ambiguous.diagnostics).toContainEqual(expect.objectContaining({
      code: 'static-graph-inventory-locator-ambiguous',
      fatal: true,
    }))
  })
})
