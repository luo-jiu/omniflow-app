import path from 'node:path'

import ts from 'typescript'

import { decodeUtf8Bytes, sha256Bytes } from './json.ts'
import { inspectSourceLocator } from './source-locator.ts'
import type { LocalClosureManifestEntry } from './types.ts'

const VIRTUAL_REPOSITORY_ROOT = '/__omniflow_exact_commit__'
const DEFAULT_TSCONFIG_PATH = 'tsconfig.json'
const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])
const FACTORY_CALLEE_PATTERN = /^(?:bind|build|create|inject|make|provide|register)(?:[A-Z0-9_].*)?$/

export type ExactStaticLocatorKind = 'declaration' | 'member' | 'runtime-literal'

export type ExactStaticLocator = {
  locatorKind: ExactStaticLocatorKind | null
  path: string
  symbol: string | null
}

export type ExactStaticInventoryLocator = ExactStaticLocator & {
  nodeId: string
  sourceHash: string
}

export type ExactStaticGraphInput = {
  blobByPath: ReadonlyMap<string, Buffer>
  budget?: Partial<ExactStaticGraphBudget>
  commit: string
  inventoryLocators?: readonly ExactStaticInventoryLocator[]
  manifestByPath: ReadonlyMap<string, LocalClosureManifestEntry>
  tsconfigPath?: string
}

export type ExactStaticGraphBudget = {
  maxBlobEntries: number
  maxInventoryLocators: number
  maxManifestEntries: number
  maxSupportedSourceBytes: number
  maxSupportedSourceFiles: number
  maxTotalBlobBytes: number
}

export const DEFAULT_EXACT_STATIC_GRAPH_BUDGET: Readonly<ExactStaticGraphBudget> = Object.freeze({
  maxBlobEntries: 10_000,
  maxInventoryLocators: 2_000,
  maxManifestEntries: 10_000,
  maxSupportedSourceBytes: 64 * 1024 * 1024,
  maxSupportedSourceFiles: 3_000,
  maxTotalBlobBytes: 128 * 1024 * 1024,
})

const EXACT_STATIC_GRAPH_BUDGET_KEYS = [
  'maxBlobEntries',
  'maxInventoryLocators',
  'maxManifestEntries',
  'maxSupportedSourceBytes',
  'maxSupportedSourceFiles',
  'maxTotalBlobBytes',
] as const satisfies readonly (keyof ExactStaticGraphBudget)[]

export type ExactStaticNodeKind =
  | 'asset'
  | 'declaration'
  | 'external-module'
  | 'member'
  | 'module'
  | 'runtime-literal'

export type ExactStaticSite = {
  end: number
  line: number
  path: string
  resolutionRule: string | null
  start: number
  syntaxKind: string
  typeOnly: boolean
}

export type ExactStaticNode = {
  declarationSites: ExactStaticSite[]
  externalSpecifier: string | null
  inventoryNodeId: string | null
  kind: ExactStaticNodeKind
  locator: ExactStaticLocator | null
  nodeKey: string
  projectable: boolean
  sourceHash: string | null
}

export type ExactStaticEdgeKind =
  | 'call'
  | 'construct'
  | 'dependency-injection'
  | 'export'
  | 'import'

export type ExactStaticEdge = {
  edgeId: string
  fromNodeKey: string
  kind: ExactStaticEdgeKind
  sites: ExactStaticSite[]
  toNodeKey: string
}

export type ExactStaticSiteRole =
  | 'call-target'
  | 'commonjs-export-binding'
  | 'commonjs-export-helper'
  | 'commonjs-export-target'
  | 'construct-target'
  | 'declaration-export'
  | 'dynamic-module-specifier'
  | 'export-target'
  | 'factory-injection-target'
  | 'import-type-specifier'
  | 'module-specifier'
  | 'constructor-injection-target'
  | 'bundler-glob-loader'

export type ExactStaticAnalysisSite = ExactStaticSite & {
  edgeKind: ExactStaticEdgeKind
  expressionHash: string
  ownerNodeKey: string
  role: ExactStaticSiteRole
  siteId: string
  sourceHash: string
}

export type ExactStaticResolution = {
  attemptedPaths: string[]
  blocking: boolean
  candidateTargetNodeKeys: string[]
  containingPath: string
  edgeKind: ExactStaticEdgeKind
  expression: string
  projectedEdgeId: string | null
  reason: string
  resolutionId: string
  site: ExactStaticSite
  siteId: string
  sourceNodeKey: string
  specifier: string | null
  status: 'external' | 'local' | 'unresolved'
  terminal: 'resolved-external' | 'resolved-static' | 'unresolved'
  targetNodeKey: string | null
}

export type ExactStaticDiagnostic = {
  code: string
  fatal: boolean
  message: string
  path: string | null
  site: ExactStaticSite | null
}

export type ExactStaticCoverageStatus = 'blocked' | 'complete' | 'partial'

export type ExactStaticCoverage = {
  call: ExactStaticCoverageStatus
  construct: ExactStaticCoverageStatus
  dependencyInjection: ExactStaticCoverageStatus
  importExport: ExactStaticCoverageStatus
  moduleResolution: ExactStaticCoverageStatus
  reverseIndex: ExactStaticCoverageStatus
  sourceParsing: ExactStaticCoverageStatus
  staticDependencyGraph: ExactStaticCoverageStatus
}

export type ExactStaticAnalyzerProfileLimitation = {
  affectedCoverage: Array<keyof ExactStaticCoverage>
  code: string
  reason: string
}

const ANALYZER_PROFILE_LIMITATIONS: ExactStaticAnalyzerProfileLimitation[] = [
  {
    affectedCoverage: ['call', 'staticDependencyGraph'],
    code: 'call-target-fixed-point-not-expanded',
    reason: 'Callable aliases, higher-order values, and all possible runtime dispatch targets are not expanded to a fixed point.',
  },
  {
    affectedCoverage: ['construct', 'staticDependencyGraph'],
    code: 'construct-target-fixed-point-not-expanded',
    reason: 'Constructor aliases, heritage dispatch, and all possible runtime constructor targets are not expanded to a fixed point.',
  },
  {
    affectedCoverage: ['dependencyInjection', 'staticDependencyGraph'],
    code: 'dependency-injection-pattern-catalog-incomplete',
    reason: 'Dependency injection discovery is limited to constructor arguments and a narrow factory-name profile.',
  },
  {
    affectedCoverage: ['importExport', 'staticDependencyGraph'],
    code: 'module-loader-and-commonjs-pattern-catalog-incomplete',
    reason: 'Bundler loaders and CommonJS export helpers are not exhaustively expanded.',
  },
]

export type ExactStaticGraphResult = {
  analyzerProfileLimitations: ExactStaticAnalyzerProfileLimitation[]
  coverage: ExactStaticCoverage
  diagnostics: ExactStaticDiagnostic[]
  edges: ExactStaticEdge[]
  incomingEdgeIdsByNodeKey: ReadonlyMap<string, readonly string[]>
  nodes: ExactStaticNode[]
  outgoingEdgeIdsByNodeKey: ReadonlyMap<string, readonly string[]>
  resolutions: ExactStaticResolution[]
  sites: ExactStaticAnalysisSite[]
}

type MutableNode = ExactStaticNode & {
  injectable: boolean
  logicalIdentity: string
}

type AstCandidate = {
  associatedNodes?: readonly ts.Node[]
  family: 'accessor-get' | 'accessor-set' | 'constructor-overload' | 'function-overload' | 'method-overload' | 'ordinary'
  hasBody: boolean
  injectable: boolean
  locatorKind: 'declaration' | 'member'
  node: ts.Node
  path: string
  scopeKey: string
  sourceFile: ts.SourceFile
  symbol: string
}

type ModuleTarget =
  | { attemptedPaths: string[]; node: MutableNode; path: string; status: 'local' }
  | { attemptedPaths: string[]; node: MutableNode; specifier: string; status: 'external' }
  | { attemptedPaths: string[]; reason: string; status: 'unresolved' }

type ExpressionTarget =
  | { node: MutableNode; status: 'local' }
  | { node: MutableNode; specifier: string; status: 'external' }
  | { candidateNodes: MutableNode[]; reason: string; status: 'unresolved' }

type TrackedAssetBinding =
  | { sourceHash: string; status: 'valid' }
  | { reason: string; status: 'invalid' }

type TrackedAssetCandidates = {
  attemptedPaths: string[]
  matches: string[]
}

type SnapshotState = {
  blobByPath: Map<string, Buffer>
  directories: Set<string>
  host: ts.CompilerHost
  readText: (relativePath: string) => string | null
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isSupportedSourcePath(relativePath: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())
}

function blockedCoverage(): ExactStaticCoverage {
  return {
    call: 'blocked',
    construct: 'blocked',
    dependencyInjection: 'blocked',
    importExport: 'blocked',
    moduleResolution: 'blocked',
    reverseIndex: 'blocked',
    sourceParsing: 'blocked',
    staticDependencyGraph: 'blocked',
  }
}

function budgetFailureResult(diagnostic: ExactStaticDiagnostic): ExactStaticGraphResult {
  return {
    analyzerProfileLimitations: ANALYZER_PROFILE_LIMITATIONS.map(limitation => ({
      ...limitation,
      affectedCoverage: [...limitation.affectedCoverage],
    })),
    coverage: blockedCoverage(),
    diagnostics: [diagnostic],
    edges: [],
    incomingEdgeIdsByNodeKey: new Map(),
    nodes: [],
    outgoingEdgeIdsByNodeKey: new Map(),
    resolutions: [],
    sites: [],
  }
}

function budgetDiagnostic(
  code: 'static-graph-budget-exceeded' | 'static-graph-budget-invalid',
  message: string,
): ExactStaticDiagnostic {
  return { code, fatal: true, message, path: null, site: null }
}

function resolveStaticGraphBudget(
  override: ExactStaticGraphInput['budget'],
): ExactStaticGraphBudget | ExactStaticDiagnostic {
  if (override !== undefined && (!override || typeof override !== 'object' || Array.isArray(override))) {
    return budgetDiagnostic(
      'static-graph-budget-invalid',
      'Exact static graph budget override must be an object.',
    )
  }
  const unknownKeys = override
    ? Object.keys(override).filter(key => !EXACT_STATIC_GRAPH_BUDGET_KEYS.includes(key as keyof ExactStaticGraphBudget))
    : []
  if (unknownKeys.length > 0) {
    return budgetDiagnostic(
      'static-graph-budget-invalid',
      `Exact static graph budget contains unknown keys: ${unknownKeys.sort(compareCodeUnits).join(', ')}.`,
    )
  }
  const budget: ExactStaticGraphBudget = { ...DEFAULT_EXACT_STATIC_GRAPH_BUDGET, ...override }
  for (const key of EXACT_STATIC_GRAPH_BUDGET_KEYS) {
    const value = budget[key]
    if (Number.isSafeInteger(value) && value > 0) continue
    return budgetDiagnostic(
      'static-graph-budget-invalid',
      `Exact static graph budget ${key} must be a positive safe integer; received ${String(value)}.`,
    )
  }
  return budget
}

function preflightStaticGraphBudget(input: ExactStaticGraphInput): ExactStaticDiagnostic | null {
  const budget = resolveStaticGraphBudget(input.budget)
  if ('fatal' in budget) return budget
  const inventoryLocatorCount = input.inventoryLocators?.length || 0
  const entryChecks: Array<[keyof ExactStaticGraphBudget, number]> = [
    ['maxBlobEntries', input.blobByPath.size],
    ['maxManifestEntries', input.manifestByPath.size],
    ['maxInventoryLocators', inventoryLocatorCount],
  ]
  for (const [key, actual] of entryChecks) {
    if (actual <= budget[key]) continue
    return budgetDiagnostic(
      'static-graph-budget-exceeded',
      `Exact static graph budget ${key} exceeded: ${actual} > ${budget[key]}.`,
    )
  }

  let supportedSourceBytes = 0
  let supportedSourceFiles = 0
  let totalBlobBytes = 0
  for (const [relativePath, bytes] of input.blobByPath) {
    totalBlobBytes += bytes.byteLength
    if (!isSupportedSourcePath(relativePath)) continue
    supportedSourceFiles += 1
    supportedSourceBytes += bytes.byteLength
  }
  const workChecks: Array<[keyof ExactStaticGraphBudget, number]> = [
    ['maxTotalBlobBytes', totalBlobBytes],
    ['maxSupportedSourceFiles', supportedSourceFiles],
    ['maxSupportedSourceBytes', supportedSourceBytes],
  ]
  for (const [key, actual] of workChecks) {
    if (actual <= budget[key]) continue
    return budgetDiagnostic(
      'static-graph-budget-exceeded',
      `Exact static graph budget ${key} exceeded: ${actual} > ${budget[key]}.`,
    )
  }
  return null
}

function normalizeRepositoryPath(value: string): string | null {
  if (
    !value
    || value.includes('\\')
    || value.includes('\0')
    || path.posix.isAbsolute(value)
    || value.split('/').includes('..')
  ) return null
  const normalized = path.posix.normalize(value)
  return normalized === value && normalized !== '.' ? normalized : null
}

function repositoryPathToVirtual(relativePath: string): string {
  return path.posix.join(VIRTUAL_REPOSITORY_ROOT, relativePath)
}

function virtualPathToRepository(fileName: string): string | null {
  const normalized = path.posix.normalize(fileName.replaceAll('\\', '/'))
  const prefix = `${VIRTUAL_REPOSITORY_ROOT}/`
  if (!normalized.startsWith(prefix)) return null
  return normalizeRepositoryPath(normalized.slice(prefix.length))
}

function hashIdentifier(prefix: string, parts: readonly unknown[]): string {
  const digest = sha256Bytes(JSON.stringify(parts)).slice('sha256:'.length)
  return `${prefix}.${digest}`
}

function createSite(
  sourceFile: ts.SourceFile,
  relativePath: string,
  node: ts.Node,
  options: { resolutionRule?: string | null; typeOnly?: boolean } = {},
): ExactStaticSite {
  const start = node.getStart(sourceFile, false)
  const location = sourceFile.getLineAndCharacterOfPosition(start)
  return {
    end: node.end,
    line: location.line + 1,
    path: relativePath,
    resolutionRule: options.resolutionRule ?? null,
    start,
    syntaxKind: ts.SyntaxKind[node.kind] || String(node.kind),
    typeOnly: options.typeOnly ?? false,
  }
}

function siteKey(site: ExactStaticSite): string {
  return JSON.stringify([
    site.path,
    site.start,
    site.end,
    site.syntaxKind,
    site.typeOnly,
    site.resolutionRule,
  ])
}

function sortAndDedupeSites(sites: readonly ExactStaticSite[]): ExactStaticSite[] {
  return [...new Map(sites.map(site => [siteKey(site), site])).values()].sort((left, right) => (
    compareCodeUnits(left.path, right.path)
    || left.start - right.start
    || left.end - right.end
    || compareCodeUnits(left.resolutionRule || '', right.resolutionRule || '')
  ))
}

function scriptKindForPath(relativePath: string): ts.ScriptKind {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case '.cjs':
    case '.js':
    case '.mjs':
      return ts.ScriptKind.JS
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.tsx':
      return ts.ScriptKind.TSX
    default:
      return ts.ScriptKind.TS
  }
}

function formatTypescriptDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

const diagnosticKeysByCollection = new WeakMap<ExactStaticDiagnostic[], Set<string>>()

function addDiagnostic(
  diagnostics: ExactStaticDiagnostic[],
  diagnostic: ExactStaticDiagnostic,
): void {
  const key = JSON.stringify([
    diagnostic.code,
    diagnostic.path,
    diagnostic.site ? siteKey(diagnostic.site) : null,
    diagnostic.message,
  ])
  let keys = diagnosticKeysByCollection.get(diagnostics)
  if (!keys) {
    keys = new Set<string>()
    diagnosticKeysByCollection.set(diagnostics, keys)
  }
  if (keys.has(key)) return
  keys.add(key)
  diagnostics.push(diagnostic)
}

function createSnapshotState(
  input: ExactStaticGraphInput,
  diagnostics: ExactStaticDiagnostic[],
): SnapshotState {
  const blobByPath = new Map<string, Buffer>()
  for (const [relativePath, bytes] of input.blobByPath) {
    const normalized = normalizeRepositoryPath(relativePath)
    if (!normalized) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-invalid-blob-path',
        fatal: true,
        message: `Blob path is not a canonical repository-relative path: ${relativePath}`,
        path: relativePath || null,
        site: null,
      })
      continue
    }
    if (blobByPath.has(normalized)) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-duplicate-blob-path',
        fatal: true,
        message: `Blob path is duplicated after normalization: ${normalized}`,
        path: normalized,
        site: null,
      })
      continue
    }
    blobByPath.set(normalized, bytes)
  }

  const directories = new Set<string>([VIRTUAL_REPOSITORY_ROOT])
  for (const relativePath of blobByPath.keys()) {
    let directory = path.posix.dirname(repositoryPathToVirtual(relativePath))
    while (directory.startsWith(VIRTUAL_REPOSITORY_ROOT)) {
      directories.add(directory)
      if (directory === VIRTUAL_REPOSITORY_ROOT) break
      directory = path.posix.dirname(directory)
    }
  }

  const textByPath = new Map<string, string | null>()
  const readText = (relativePath: string): string | null => {
    const cached = textByPath.get(relativePath)
    if (cached !== undefined) return cached
    const bytes = blobByPath.get(relativePath)
    if (!bytes) return null
    try {
      const text = decodeUtf8Bytes(bytes, relativePath)
      textByPath.set(relativePath, text)
      return text
    } catch (error) {
      textByPath.set(relativePath, null)
      addDiagnostic(diagnostics, {
        code: 'static-graph-invalid-utf8',
        fatal: true,
        message: error instanceof Error ? error.message : String(error),
        path: relativePath,
        site: null,
      })
      return null
    }
  }

  const host: ts.CompilerHost = {
    directoryExists: directoryName => directories.has(path.posix.normalize(directoryName.replaceAll('\\', '/'))),
    fileExists: fileName => {
      const relativePath = virtualPathToRepository(fileName)
      return relativePath !== null && blobByPath.has(relativePath)
    },
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => VIRTUAL_REPOSITORY_ROOT,
    getDefaultLibFileName: () => `${VIRTUAL_REPOSITORY_ROOT}/__no_default_lib__.d.ts`,
    getDirectories: directoryName => {
      const normalized = path.posix.normalize(directoryName.replaceAll('\\', '/'))
      const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`
      return [...directories]
        .filter(candidate => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'))
        .sort(compareCodeUnits)
    },
    getNewLine: () => '\n',
    getSourceFile: (fileName, languageVersion, onError) => {
      const relativePath = virtualPathToRepository(fileName)
      if (!relativePath) {
        onError?.(`Source path escaped the exact-commit snapshot: ${fileName}`)
        return undefined
      }
      if (!isSupportedSourcePath(relativePath)) return undefined
      const sourceText = readText(relativePath)
      if (sourceText === null) {
        onError?.(`Source blob is unavailable or not valid UTF-8: ${relativePath}`)
        return undefined
      }
      return ts.createSourceFile(
        fileName,
        sourceText,
        languageVersion,
        true,
        scriptKindForPath(relativePath),
      )
    },
    readFile: fileName => {
      const relativePath = virtualPathToRepository(fileName)
      return relativePath === null ? undefined : readText(relativePath) ?? undefined
    },
    realpath: fileName => path.posix.normalize(fileName.replaceAll('\\', '/')),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => {
      throw new Error('The exact-commit compiler host is read-only')
    },
  }
  return { blobByPath, directories, host, readText }
}

function validateManifestBindings(
  input: ExactStaticGraphInput,
  snapshot: SnapshotState,
  tsconfigPath: string,
  diagnostics: ExactStaticDiagnostic[],
): void {
  const configBytes = snapshot.blobByPath.get(tsconfigPath)
  const configManifest = input.manifestByPath.get(tsconfigPath)
  if (
    !configBytes
    || !configManifest
    || configManifest.path !== tsconfigPath
    || configManifest.byteLength !== configBytes.length
    || configManifest.contentHash !== sha256Bytes(configBytes)
    || configManifest.mode === '120000'
  ) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-tsconfig-manifest-mismatch',
      fatal: true,
      message: `TypeScript config must be bound to exact blob bytes and a regular-file manifest mode: ${tsconfigPath}`,
      path: tsconfigPath,
      site: null,
    })
  }
  const sourcePaths = new Set([
    ...[...snapshot.blobByPath.keys()].filter(isSupportedSourcePath),
    ...[...input.manifestByPath.keys()].filter(isSupportedSourcePath),
  ])
  for (const relativePath of [...sourcePaths].sort(compareCodeUnits)) {
    const bytes = snapshot.blobByPath.get(relativePath)
    const manifest = input.manifestByPath.get(relativePath)
    if (!bytes || !manifest) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-source-manifest-incomplete',
        fatal: true,
        message: `Supported source must exist in both the blob map and source manifest: ${relativePath}`,
        path: relativePath,
        site: null,
      })
      continue
    }
    if (
      manifest.path !== relativePath
      || manifest.byteLength !== bytes.length
      || manifest.contentHash !== sha256Bytes(bytes)
      || manifest.mode === '120000'
    ) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-source-manifest-mismatch',
        fatal: true,
        message: `Source manifest does not bind the exact blob bytes and regular-file mode: ${relativePath}`,
        path: relativePath,
        site: null,
      })
    }
  }
}

function loadCompilerOptions(
  snapshot: SnapshotState,
  tsconfigPath: string,
  diagnostics: ExactStaticDiagnostic[],
): ts.CompilerOptions {
  const configText = snapshot.readText(tsconfigPath)
  if (configText === null) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-tsconfig-unavailable',
      fatal: true,
      message: `Exact-commit TypeScript config is unavailable: ${tsconfigPath}`,
      path: tsconfigPath,
      site: null,
    })
    return {
      allowJs: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      noLib: true,
      target: ts.ScriptTarget.ES2022,
      types: [],
    }
  }

  const parsed = ts.parseConfigFileTextToJson(tsconfigPath, configText)
  if (parsed.error) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-tsconfig-parse-error',
      fatal: true,
      message: formatTypescriptDiagnostic(parsed.error),
      path: tsconfigPath,
      site: null,
    })
  }
  const config = parsed.config && typeof parsed.config === 'object'
    ? parsed.config as Record<string, unknown>
    : {}
  if (config.extends !== undefined) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-tsconfig-extends-unsupported',
      fatal: true,
      message: 'The first exact static graph builder does not resolve tsconfig extends; it cannot guess resolution options.',
      path: tsconfigPath,
      site: null,
    })
  }
  const rawCompilerOptions = config.compilerOptions && typeof config.compilerOptions === 'object'
    ? config.compilerOptions as Record<string, unknown>
    : {}
  if (Array.isArray(rawCompilerOptions.plugins) && rawCompilerOptions.plugins.length > 0) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-tsconfig-plugin-unsupported',
      fatal: true,
      message: 'TypeScript compiler plugins are not executed by the exact static graph builder.',
      path: tsconfigPath,
      site: null,
    })
  }
  const converted = ts.convertCompilerOptionsFromJson(
    rawCompilerOptions,
    VIRTUAL_REPOSITORY_ROOT,
    repositoryPathToVirtual(tsconfigPath),
  )
  for (const error of converted.errors) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-tsconfig-option-error',
      fatal: true,
      message: formatTypescriptDiagnostic(error),
      path: tsconfigPath,
      site: null,
    })
  }
  if (converted.options.moduleResolution === undefined) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-module-resolution-unspecified',
      fatal: true,
      message: 'compilerOptions.moduleResolution must be explicit for an auditable exact static graph.',
      path: tsconfigPath,
      site: null,
    })
  }
  for (const [alias, substitutions] of Object.entries(converted.options.paths || {})) {
    for (const substitution of substitutions) {
      const probe = substitution.replace('*', '__probe__')
      const absoluteProbe = path.posix.isAbsolute(probe)
        ? path.posix.normalize(probe)
        : path.posix.resolve(VIRTUAL_REPOSITORY_ROOT, probe)
      if (virtualPathToRepository(absoluteProbe) !== null) continue
      addDiagnostic(diagnostics, {
        code: 'static-graph-path-alias-escapes-snapshot',
        fatal: true,
        message: `TypeScript path alias escapes the exact-commit virtual repository: ${alias} -> ${substitution}`,
        path: tsconfigPath,
        site: null,
      })
    }
  }
  return {
    ...converted.options,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    noLib: true,
    skipLibCheck: true,
    types: [],
  }
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | ts.ModuleName | undefined): string | null {
  if (!name) return null
  if (
    ts.isIdentifier(name)
    || ts.isPrivateIdentifier(name)
    || ts.isStringLiteral(name)
    || ts.isNumericLiteral(name)
    || ts.isNoSubstitutionTemplateLiteral(name)
  ) return name.text
  if (ts.isComputedPropertyName(name)) {
    const expression = name.expression
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text
    }
  }
  return null
}

function collectBindingCandidates(
  name: ts.BindingName,
  canonicalNode: ts.VariableDeclaration | ts.BindingElement,
  ancestorNodes: readonly (ts.VariableDeclaration | ts.BindingElement)[] = [],
): Array<{
  associatedNodes: readonly (ts.VariableDeclaration | ts.BindingElement)[]
  node: ts.VariableDeclaration | ts.BindingElement
  symbol: string
}> {
  if (ts.isIdentifier(name)) {
    return [{
      associatedNodes: [canonicalNode, ...ancestorNodes],
      node: canonicalNode,
      symbol: name.text,
    }]
  }
  return name.elements.flatMap(element => (
    ts.isOmittedExpression(element)
      ? []
      : collectBindingCandidates(element.name, element, [canonicalNode, ...ancestorNodes])
  ))
}

function expressionLocator(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (expression.kind === ts.SyntaxKind.SuperKeyword) return 'super'
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = expressionLocator(expression.expression)
    return owner ? `${owner}.${expression.name.text}` : null
  }
  if (ts.isElementAccessExpression(expression)) {
    const owner = expressionLocator(expression.expression)
    const key = expression.argumentExpression
    if (owner && key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) {
      return `${owner}.${key.text}`
    }
  }
  return null
}

function isLocatorScope(node: ts.Node): boolean {
  return ts.isSourceFile(node)
    || ts.isBlock(node)
    || ts.isModuleBlock(node)
    || ts.isClassDeclaration(node)
    || ts.isClassExpression(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeLiteralNode(node)
    || ts.isObjectLiteralExpression(node)
}

function locatorScopeKey(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent
  while (current && !isLocatorScope(current)) current = current.parent
  return current ? `${current.kind}:${current.pos}:${current.end}` : 'root'
}

function isFunctionLikeInitializer(node: ts.Node | undefined): boolean {
  return Boolean(node && (
    ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isClassExpression(node)
  ))
}

function candidatesForNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  relativePath: string,
): AstCandidate[] {
  const base = {
    path: relativePath,
    scopeKey: locatorScopeKey(node),
    sourceFile,
  }
  if (ts.isVariableDeclaration(node)) {
    return collectBindingCandidates(node.name, node).map(binding => ({
      ...base,
      associatedNodes: binding.associatedNodes,
      family: 'ordinary' as const,
      hasBody: false,
      injectable: isFunctionLikeInitializer(node.initializer),
      locatorKind: 'declaration' as const,
      node: binding.node,
      symbol: binding.symbol,
    }))
  }
  if (ts.isFunctionDeclaration(node)) {
    const symbol = propertyNameText(node.name) || (node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : null)
    return symbol ? [{
      ...base,
      family: 'function-overload',
      hasBody: Boolean(node.body),
      injectable: true,
      locatorKind: 'declaration',
      node,
      symbol,
    }] : []
  }
  if (
    ts.isClassDeclaration(node)
    || ts.isClassExpression(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isModuleDeclaration(node)
    || ts.isImportEqualsDeclaration(node)
  ) {
    const symbol = propertyNameText(node.name)
      || ((ts.isClassDeclaration(node) || ts.isClassExpression(node))
        && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)
        ? 'default'
        : null)
    return symbol ? [{
      ...base,
      family: 'ordinary',
      hasBody: false,
      injectable: ts.isClassDeclaration(node) || ts.isClassExpression(node),
      locatorKind: 'declaration',
      node,
      symbol,
    }] : []
  }
  if (ts.isImportClause(node) || ts.isNamespaceImport(node)) {
    const symbol = propertyNameText(node.name)
    return symbol ? [{
      ...base,
      family: 'ordinary',
      hasBody: false,
      injectable: false,
      locatorKind: 'declaration',
      node,
      symbol,
    }] : []
  }
  if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node) || ts.isNamespaceExport(node)) {
    const symbol = propertyNameText(node.name)
    return symbol ? [{
      ...base,
      family: 'ordinary',
      hasBody: false,
      injectable: false,
      locatorKind: 'declaration',
      node,
      symbol,
    }] : []
  }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    const symbol = propertyNameText(node.name)
    return symbol ? [{
      ...base,
      family: 'method-overload',
      hasBody: Boolean(ts.isMethodDeclaration(node) && node.body),
      injectable: true,
      locatorKind: 'member',
      node,
      symbol,
    }] : []
  }
  if (ts.isConstructorDeclaration(node)) {
    return [{
      ...base,
      family: 'constructor-overload',
      hasBody: Boolean(node.body),
      injectable: true,
      locatorKind: 'member',
      node,
      symbol: 'constructor',
    }]
  }
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const symbol = propertyNameText(node.name)
    return symbol ? [{
      ...base,
      family: ts.isGetAccessorDeclaration(node) ? 'accessor-get' : 'accessor-set',
      hasBody: true,
      injectable: true,
      locatorKind: 'member',
      node,
      symbol,
    }] : []
  }
  if (
    ts.isPropertyDeclaration(node)
    || ts.isPropertySignature(node)
    || ts.isPropertyAssignment(node)
    || ts.isShorthandPropertyAssignment(node)
    || ts.isEnumMember(node)
  ) {
    const symbol = propertyNameText(node.name)
    const initializer = 'initializer' in node ? node.initializer : undefined
    return symbol ? [{
      ...base,
      family: 'ordinary',
      hasBody: false,
      injectable: isFunctionLikeInitializer(initializer),
      locatorKind: 'member',
      node,
      symbol,
    }] : []
  }
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    const symbol = expressionLocator(node.left)
    return symbol ? [{
      ...base,
      family: 'ordinary',
      hasBody: false,
      injectable: isFunctionLikeInitializer(node.right),
      locatorKind: 'member',
      node,
      symbol,
    }] : []
  }
  return []
}

function isValidLogicalGroup(candidates: readonly AstCandidate[]): boolean {
  if (candidates.length <= 1) return true
  const families = new Set(candidates.map(candidate => candidate.family))
  if (
    families.size === 1
    && (
      families.has('function-overload')
      || families.has('method-overload')
      || families.has('constructor-overload')
    )
  ) return candidates.filter(candidate => candidate.hasBody).length <= 1
  return [...families].every(family => family === 'accessor-get' || family === 'accessor-set')
    && candidates.filter(candidate => candidate.family === 'accessor-get').length <= 1
    && candidates.filter(candidate => candidate.family === 'accessor-set').length <= 1
}

function locatorKey(locator: ExactStaticLocator): string {
  return JSON.stringify([locator.path, locator.symbol, locator.locatorKind])
}

function buildNodeRegistry(
  sourceFiles: readonly { path: string; sourceFile: ts.SourceFile }[],
  input: ExactStaticGraphInput,
  diagnostics: ExactStaticDiagnostic[],
): {
  moduleNodeByPath: Map<string, MutableNode>
  nodeByAstNode: Map<ts.Node, MutableNode[]>
  nodes: MutableNode[]
  nodesByLocator: Map<string, MutableNode[]>
} {
  const nodes: MutableNode[] = []
  const moduleNodeByPath = new Map<string, MutableNode>()
  const nodeByAstNode = new Map<ts.Node, MutableNode[]>()
  const candidates: AstCandidate[] = []
  for (const item of sourceFiles) {
    const manifest = input.manifestByPath.get(item.path)
    const moduleNode: MutableNode = {
      declarationSites: [],
      externalSpecifier: null,
      injectable: false,
      inventoryNodeId: null,
      kind: 'module',
      locator: { locatorKind: null, path: item.path, symbol: null },
      logicalIdentity: JSON.stringify(['module', item.path]),
      nodeKey: '',
      projectable: true,
      sourceHash: manifest?.contentHash || null,
    }
    nodes.push(moduleNode)
    moduleNodeByPath.set(item.path, moduleNode)
    const visit = (node: ts.Node) => {
      candidates.push(...candidatesForNode(node, item.sourceFile, item.path))
      ts.forEachChild(node, visit)
    }
    visit(item.sourceFile)
  }

  const candidateGroups = new Map<string, AstCandidate[]>()
  for (const candidate of candidates) {
    const canMerge = candidate.family !== 'ordinary'
    const family = candidate.family === 'accessor-get' || candidate.family === 'accessor-set'
      ? 'accessor-group'
      : candidate.family
    const groupKey = JSON.stringify([
      candidate.path,
      candidate.locatorKind,
      candidate.symbol,
      candidate.scopeKey,
      family,
      ...(canMerge ? [] : [candidate.node.pos, candidate.node.end]),
    ])
    candidateGroups.set(groupKey, [...(candidateGroups.get(groupKey) || []), candidate])
  }

  for (const [groupKey, groupCandidates] of candidateGroups) {
    const groups = isValidLogicalGroup(groupCandidates)
      ? [groupCandidates]
      : groupCandidates.map(candidate => [candidate])
    if (groups.length > 1) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-logical-group-ambiguous',
        fatal: true,
        message: `Declarations cannot form a permitted overload/accessor group: ${groupCandidates[0]?.path}#${groupCandidates[0]?.symbol}`,
        path: groupCandidates[0]?.path || null,
        site: groupCandidates[0]
          ? createSite(groupCandidates[0].sourceFile, groupCandidates[0].path, groupCandidates[0].node)
          : null,
      })
    }
    for (const [index, logicalGroup] of groups.entries()) {
      const first = logicalGroup[0]
      if (!first) continue
      const declarationSites = logicalGroup.map(candidate => (
        createSite(candidate.sourceFile, candidate.path, candidate.node)
      ))
      const node: MutableNode = {
        declarationSites: sortAndDedupeSites(declarationSites),
        externalSpecifier: null,
        injectable: logicalGroup.some(candidate => candidate.injectable),
        inventoryNodeId: null,
        kind: first.locatorKind,
        locator: {
          locatorKind: first.locatorKind,
          path: first.path,
          symbol: first.symbol,
        },
        logicalIdentity: `${groupKey}:${index}`,
        nodeKey: '',
        projectable: true,
        sourceHash: input.manifestByPath.get(first.path)?.contentHash || null,
      }
      nodes.push(node)
      for (const candidate of logicalGroup) {
        for (const associatedNode of candidate.associatedNodes || [candidate.node]) {
          nodeByAstNode.set(associatedNode, [...(nodeByAstNode.get(associatedNode) || []), node])
        }
      }
    }
  }

  const nodesByLocator = new Map<string, MutableNode[]>()
  for (const node of nodes) {
    if (!node.locator) continue
    const key = locatorKey(node.locator)
    nodesByLocator.set(key, [...(nodesByLocator.get(key) || []), node])
  }
  for (const matches of nodesByLocator.values()) {
    const projectable = matches.length === 1
    for (const node of matches) node.projectable = projectable
  }
  return { moduleNodeByPath, nodeByAstNode, nodes, nodesByLocator }
}

function bindInventoryLocators(
  input: ExactStaticGraphInput,
  snapshot: SnapshotState,
  registry: ReturnType<typeof buildNodeRegistry>,
  diagnostics: ExactStaticDiagnostic[],
): void {
  const seenNodeIds = new Set<string>()
  for (const binding of [...(input.inventoryLocators || [])].sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId))) {
    if (seenNodeIds.has(binding.nodeId)) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-inventory-node-id-duplicate',
        fatal: true,
        message: `Inventory node id is duplicated: ${binding.nodeId}`,
        path: binding.path,
        site: null,
      })
      continue
    }
    seenNodeIds.add(binding.nodeId)
    const normalizedPath = normalizeRepositoryPath(binding.path)
    const sourceBytes = normalizedPath === binding.path
      ? snapshot.blobByPath.get(binding.path)
      : undefined
    const manifest = input.manifestByPath.get(binding.path)
    const actualSourceHash = sourceBytes ? sha256Bytes(sourceBytes) : null
    if (
      normalizedPath !== binding.path
      || !sourceBytes
      || !manifest
      || manifest.path !== binding.path
      || (manifest.mode !== '100644' && manifest.mode !== '100755')
      || manifest.byteLength !== sourceBytes.length
      || manifest.contentHash !== actualSourceHash
      || binding.sourceHash !== actualSourceHash
    ) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-inventory-source-binding-mismatch',
        fatal: true,
        message: `Inventory locator path, regular-file manifest, source hash, and exact blob bytes must agree: ${binding.path}`,
        path: binding.path,
        site: null,
      })
      continue
    }
    let target: MutableNode | null = null
    if (binding.symbol === null) {
      if (binding.locatorKind !== null) {
        addDiagnostic(diagnostics, {
          code: 'static-graph-inventory-locator-kind-invalid',
          fatal: true,
          message: `A module locator cannot declare locatorKind: ${binding.nodeId}`,
          path: binding.path,
          site: null,
        })
      }
      target = registry.moduleNodeByPath.get(binding.path) || null
    } else {
      const locatorKind = binding.locatorKind || 'declaration'
      const sourceText = snapshot.readText(binding.path)
      if (sourceText !== null) {
        const inspected = inspectSourceLocator(sourceText, binding.path, binding.symbol, locatorKind)
        if (inspected.status !== 'matched') {
          addDiagnostic(diagnostics, {
            code: `static-graph-inventory-locator-${inspected.status}`,
            fatal: true,
            message: `Inventory locator must resolve to one logical exact-commit target: ${binding.path}#${binding.symbol} (${inspected.status}, ${inspected.matchCount}).`,
            path: binding.path,
            site: null,
          })
        }
        if (locatorKind === 'runtime-literal' && inspected.status === 'matched') {
          target = {
            declarationSites: [],
            externalSpecifier: null,
            injectable: false,
            inventoryNodeId: null,
            kind: 'runtime-literal',
            locator: { locatorKind, path: binding.path, symbol: binding.symbol },
            logicalIdentity: JSON.stringify(['runtime-literal', binding.path, binding.symbol]),
            nodeKey: '',
            projectable: true,
            sourceHash: actualSourceHash,
          }
          registry.nodes.push(target)
        } else if (locatorKind !== 'runtime-literal') {
          const matches = registry.nodesByLocator.get(locatorKey({
            locatorKind,
            path: binding.path,
            symbol: binding.symbol,
          })) || []
          if (matches.length === 1) target = matches[0] || null
          else {
            addDiagnostic(diagnostics, {
              code: 'static-graph-inventory-ast-group-unresolved',
              fatal: true,
              message: `Inventory locator resolved to ${matches.length} canonical AST groups: ${binding.path}#${binding.symbol}.`,
              path: binding.path,
              site: null,
            })
          }
        }
      }
    }
    if (!target) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-inventory-node-unresolved',
        fatal: true,
        message: `Inventory node cannot bind to the exact static graph: ${binding.nodeId}`,
        path: binding.path,
        site: null,
      })
      continue
    }
    if (target.inventoryNodeId) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-inventory-node-collision',
        fatal: true,
        message: `Multiple inventory ids bind the same canonical AST node: ${target.inventoryNodeId}, ${binding.nodeId}`,
        path: binding.path,
        site: null,
      })
      continue
    }
    target.inventoryNodeId = binding.nodeId
  }
}

function finalizeNodeKeys(nodes: MutableNode[], diagnostics: ExactStaticDiagnostic[]): void {
  const byKey = new Map<string, MutableNode>()
  for (const node of nodes) {
    const prefix = node.kind === 'module' ? 'module' : node.kind === 'runtime-literal' ? 'literal' : 'ast'
    const canonicalKey = node.inventoryNodeId || hashIdentifier(prefix, [node.logicalIdentity])
    node.nodeKey = canonicalKey
    const previous = byKey.get(canonicalKey)
    if (!previous) {
      byKey.set(canonicalKey, node)
      continue
    }
    addDiagnostic(diagnostics, {
      code: 'static-graph-node-key-collision',
      fatal: true,
      message: `Canonical node key is not unique: ${canonicalKey}`,
      path: node.locator?.path || null,
      site: node.declarationSites[0] || null,
    })
    node.nodeKey = hashIdentifier('collision', [canonicalKey, node.logicalIdentity])
    byKey.set(node.nodeKey, node)
  }
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && Boolean(ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function isTypeOnlyDeclaration(node: ts.Node): boolean {
  return ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isImportClause(node) && node.isTypeOnly
    || ts.isImportSpecifier(node) && node.isTypeOnly
    || ts.isExportSpecifier(node) && node.isTypeOnly
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  if (!node.importClause) return false
  if (node.importClause.isTypeOnly) return true
  if (node.importClause.name) return false
  const bindings = node.importClause.namedBindings
  return Boolean(bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
    && bindings.elements.every(element => element.isTypeOnly))
}

function exportDeclarationIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true
  const clause = node.exportClause
  return Boolean(clause && ts.isNamedExports(clause) && clause.elements.length > 0
    && clause.elements.every(element => element.isTypeOnly))
}

function configuredAliasMatches(specifier: string, options: ts.CompilerOptions): boolean {
  return Object.keys(options.paths || {}).some(pattern => {
    const star = pattern.indexOf('*')
    if (star < 0) return pattern === specifier
    return specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1))
  })
}

function isLocalModuleSpecifier(specifier: string, options: ts.CompilerOptions): boolean {
  return specifier.startsWith('./')
    || specifier.startsWith('../')
    || specifier.startsWith('/')
    || configuredAliasMatches(specifier, options)
}

function localModuleCandidateBases(
  specifier: string,
  containingPath: string,
  options: ts.CompilerOptions,
): string[] {
  const candidateBases = new Set<string>()
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const candidate = normalizeRepositoryPath(path.posix.normalize(
      path.posix.join(path.posix.dirname(containingPath), specifier),
    ))
    if (candidate) candidateBases.add(candidate)
  }
  for (const [pattern, substitutions] of Object.entries(options.paths || {})) {
    const star = pattern.indexOf('*')
    const matched = star < 0
      ? pattern === specifier ? '' : null
      : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1))
        ? specifier.slice(star, specifier.length - (pattern.length - star - 1))
        : null
    if (matched === null) continue
    for (const substitution of substitutions) {
      const replaced = substitution.replace('*', matched)
      const absoluteCandidate = path.posix.isAbsolute(replaced)
        ? path.posix.normalize(replaced)
        : path.posix.resolve(options.baseUrl || VIRTUAL_REPOSITORY_ROOT, replaced)
      const candidate = virtualPathToRepository(absoluteCandidate)
      if (candidate) candidateBases.add(candidate)
    }
  }
  return [...candidateBases].sort(compareCodeUnits)
}

function trackedAssetCandidates(
  specifier: string,
  containingPath: string,
  options: ts.CompilerOptions,
  blobByPath: ReadonlyMap<string, Buffer>,
  manifestByPath: ReadonlyMap<string, LocalClosureManifestEntry>,
): TrackedAssetCandidates {
  const candidateBases = localModuleCandidateBases(specifier, containingPath, options)
  const trackedAssetPaths = new Set<string>()
  for (const candidatePath of [...blobByPath.keys(), ...manifestByPath.keys()]) {
    if (normalizeRepositoryPath(candidatePath) !== candidatePath || isSupportedSourcePath(candidatePath)) continue
    trackedAssetPaths.add(candidatePath)
  }
  const exactMatches = candidateBases.filter(candidate => trackedAssetPaths.has(candidate))
  if (exactMatches.length > 0) {
    return {
      attemptedPaths: [...new Set([...candidateBases, ...exactMatches])].sort(compareCodeUnits),
      matches: exactMatches,
    }
  }
  const extensionMatches = [...trackedAssetPaths].filter(candidatePath => (
    !candidatePath.endsWith('.map')
    && candidateBases.some(base => {
      const baseName = path.posix.basename(base)
      if (path.posix.extname(base) || baseName.startsWith('.')) return false
      return candidatePath.startsWith(`${base}.`) || candidatePath.startsWith(`${base}/index.`)
    })
  )).sort(compareCodeUnits)
  return {
    attemptedPaths: [...new Set([...candidateBases, ...extensionMatches])].sort(compareCodeUnits),
    matches: extensionMatches,
  }
}

function validateTrackedAssetBinding(
  relativePath: string,
  input: ExactStaticGraphInput,
  snapshot: SnapshotState,
): TrackedAssetBinding {
  const bytes = snapshot.blobByPath.get(relativePath)
  const manifest = input.manifestByPath.get(relativePath)
  if (!bytes || !manifest) {
    return {
      reason: `Opaque local asset must exist in both the blob map and source manifest: ${relativePath}`,
      status: 'invalid',
    }
  }
  if (manifest.mode === '120000') {
    return {
      reason: `Opaque local asset cannot resolve through a symlink manifest entry: ${relativePath}`,
      status: 'invalid',
    }
  }
  if (
    manifest.path !== relativePath
    || manifest.byteLength !== bytes.length
    || manifest.contentHash !== sha256Bytes(bytes)
  ) {
    return {
      reason: `Opaque local asset manifest does not bind the exact blob bytes and path: ${relativePath}`,
      status: 'invalid',
    }
  }
  return { sourceHash: manifest.contentHash, status: 'valid' }
}

function expressionText(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  return expression.getText(sourceFile).slice(0, 500)
}

function symbolLocation(expression: ts.Expression): ts.Node {
  if (ts.isPropertyAccessExpression(expression)) return expression.name
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    return expression.argumentExpression
  }
  return expression
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | null {
  let current = expression
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression
  }
  return ts.isIdentifier(current) ? current : null
}

function nearestOwner(
  node: ts.Node,
  sourcePath: string,
  nodeByAstNode: ReadonlyMap<ts.Node, MutableNode[]>,
  moduleNodeByPath: ReadonlyMap<string, MutableNode>,
): MutableNode {
  let current: ts.Node | undefined = node.parent
  while (current && !ts.isSourceFile(current)) {
    const owners = nodeByAstNode.get(current) || []
    if (owners.length === 1 && owners[0] && (owners[0].inventoryNodeId || owners[0].injectable)) {
      return owners[0]
    }
    current = current.parent
  }
  const moduleNode = moduleNodeByPath.get(sourcePath)
  if (!moduleNode) throw new Error(`Module node is missing for ${sourcePath}`)
  return moduleNode
}

function declarationNodesForSymbol(
  symbol: ts.Symbol,
  nodeByAstNode: ReadonlyMap<ts.Node, MutableNode[]>,
): { nodes: MutableNode[]; trackedDeclarationCount: number } {
  const nodes = new Map<string, MutableNode>()
  let trackedDeclarationCount = 0
  for (const declaration of symbol.declarations || []) {
    const sourcePath = virtualPathToRepository(declaration.getSourceFile().fileName)
    if (!sourcePath) continue
    trackedDeclarationCount += 1
    let current: ts.Node | undefined = declaration
    while (current && !ts.isSourceFile(current)) {
      for (const node of nodeByAstNode.get(current) || []) nodes.set(node.logicalIdentity, node)
      if (nodes.size > 0 || !ts.isBindingElement(current)) break
      current = current.parent
    }
  }
  return { nodes: [...nodes.values()], trackedDeclarationCount }
}

function moduleSpecifierForAliasDeclaration(declaration: ts.Declaration): string | null {
  let current: ts.Node | undefined = declaration
  while (current) {
    if ((ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) && current.moduleSpecifier) {
      return ts.isStringLiteralLike(current.moduleSpecifier) ? current.moduleSpecifier.text : null
    }
    if (ts.isImportEqualsDeclaration(current) && ts.isExternalModuleReference(current.moduleReference)) {
      const expression = current.moduleReference.expression
      return expression && ts.isStringLiteralLike(expression) ? expression.text : null
    }
    if (ts.isSourceFile(current)) break
    current = current.parent
  }
  return null
}

export function buildExactStaticGraph(input: ExactStaticGraphInput): ExactStaticGraphResult {
  const budgetFailure = preflightStaticGraphBudget(input)
  if (budgetFailure) return budgetFailureResult(budgetFailure)
  const diagnostics: ExactStaticDiagnostic[] = []
  if (!/^[0-9a-f]{40}$/.test(input.commit)) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-commit-invalid',
      fatal: true,
      message: 'Exact static graph input commit must be a full lowercase 40-character commit id.',
      path: null,
      site: null,
    })
  }
  const tsconfigPath = input.tsconfigPath || DEFAULT_TSCONFIG_PATH
  if (!normalizeRepositoryPath(tsconfigPath)) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-tsconfig-path-invalid',
      fatal: true,
      message: `TypeScript config path is not repository-relative: ${tsconfigPath}`,
      path: tsconfigPath,
      site: null,
    })
  }
  const snapshot = createSnapshotState(input, diagnostics)
  validateManifestBindings(input, snapshot, tsconfigPath, diagnostics)
  const compilerOptions = loadCompilerOptions(snapshot, tsconfigPath, diagnostics)
  const rootNames = [...snapshot.blobByPath.keys()]
    .filter(relativePath => isSupportedSourcePath(relativePath) && snapshot.readText(relativePath) !== null)
    .sort(compareCodeUnits)
    .map(repositoryPathToVirtual)
  let program: ts.Program | null = null
  try {
    program = ts.createProgram({ host: snapshot.host, options: compilerOptions, rootNames })
  } catch (error) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-program-create-failed',
      fatal: true,
      message: error instanceof Error ? error.message : String(error),
      path: null,
      site: null,
    })
  }

  const sourceFiles: Array<{ path: string; sourceFile: ts.SourceFile }> = []
  const invalidSourcePaths = new Set<string>()
  if (program) {
    for (const rootName of rootNames) {
      const relativePath = virtualPathToRepository(rootName)
      const sourceFile = program.getSourceFile(rootName)
      if (!relativePath || !sourceFile) {
        addDiagnostic(diagnostics, {
          code: 'static-graph-root-source-unavailable',
          fatal: true,
          message: `Compiler program did not retain an exact-commit root source: ${rootName}`,
          path: relativePath,
          site: null,
        })
        if (relativePath) invalidSourcePaths.add(relativePath)
        continue
      }
      const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile)
      if (syntacticDiagnostics.length > 0) invalidSourcePaths.add(relativePath)
      for (const diagnostic of syntacticDiagnostics) {
        const start = diagnostic.start ?? 0
        const location = sourceFile.getLineAndCharacterOfPosition(Math.min(start, sourceFile.end))
        addDiagnostic(diagnostics, {
          code: 'static-graph-source-parse-error',
          fatal: true,
          message: formatTypescriptDiagnostic(diagnostic),
          path: relativePath,
          site: {
            end: Math.min(sourceFile.end, start + (diagnostic.length || 0)),
            line: location.line + 1,
            path: relativePath,
            resolutionRule: null,
            start,
            syntaxKind: 'ParseDiagnostic',
            typeOnly: false,
          },
        })
      }
      if (!invalidSourcePaths.has(relativePath)) sourceFiles.push({ path: relativePath, sourceFile })
    }
  }

  const registry = buildNodeRegistry(sourceFiles, input, diagnostics)
  bindInventoryLocators(input, snapshot, registry, diagnostics)
  finalizeNodeKeys(registry.nodes, diagnostics)

  const nodeByKey = new Map(registry.nodes.map(node => [node.nodeKey, node]))
  const assetNodeByPath = new Map<string, MutableNode>()
  const getAssetNode = (relativePath: string, sourceHash: string): MutableNode => {
    const existing = assetNodeByPath.get(relativePath)
    if (existing) return existing
    const logicalIdentity = JSON.stringify(['asset', relativePath])
    const canonicalKey = hashIdentifier('asset', [logicalIdentity])
    const node: MutableNode = {
      declarationSites: [],
      externalSpecifier: null,
      injectable: false,
      inventoryNodeId: null,
      kind: 'asset',
      locator: { locatorKind: null, path: relativePath, symbol: null },
      logicalIdentity,
      nodeKey: canonicalKey,
      projectable: true,
      sourceHash,
    }
    if (nodeByKey.has(canonicalKey)) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-node-key-collision',
        fatal: true,
        message: `Canonical node key is not unique: ${canonicalKey}`,
        path: relativePath,
        site: null,
      })
      node.nodeKey = hashIdentifier('collision', [canonicalKey, logicalIdentity])
    }
    nodeByKey.set(node.nodeKey, node)
    assetNodeByPath.set(relativePath, node)
    registry.nodes.push(node)
    return node
  }

  const externalNodeBySpecifier = new Map<string, MutableNode>()
  const getExternalNode = (specifier: string): MutableNode => {
    const existing = externalNodeBySpecifier.get(specifier)
    if (existing) return existing
    const node: MutableNode = {
      declarationSites: [],
      externalSpecifier: specifier,
      injectable: false,
      inventoryNodeId: null,
      kind: 'external-module',
      locator: null,
      logicalIdentity: JSON.stringify(['external-module', specifier]),
      nodeKey: hashIdentifier('external-module', [specifier]),
      projectable: false,
      sourceHash: null,
    }
    externalNodeBySpecifier.set(specifier, node)
    registry.nodes.push(node)
    return node
  }

  const moduleResolutionCache = ts.createModuleResolutionCache(
    VIRTUAL_REPOSITORY_ROOT,
    fileName => fileName,
    compilerOptions,
  )
  const resolvedModuleCache = new Map<string, ModuleTarget>()
  const resolveModuleTarget = (specifier: string, containingPath: string): ModuleTarget => {
    const cacheKey = JSON.stringify([containingPath, specifier])
    const cached = resolvedModuleCache.get(cacheKey)
    if (cached) return cached
    const resolved = ts.resolveModuleName(
      specifier,
      repositoryPathToVirtual(containingPath),
      compilerOptions,
      snapshot.host,
      moduleResolutionCache,
    )
    // TypeScript 5.8 intentionally keeps failed lookup locations out of its public API.
    const attemptedPaths: string[] = []
    const resolvedFileName = resolved.resolvedModule?.resolvedFileName
    if (resolvedFileName) {
      const relativePath = virtualPathToRepository(resolvedFileName)
      if (!relativePath) {
        const target: ModuleTarget = {
          attemptedPaths,
          reason: `Module resolver returned a path outside the exact-commit snapshot: ${resolvedFileName}`,
          status: 'unresolved',
        }
        resolvedModuleCache.set(cacheKey, target)
        return target
      }
      const moduleNode = registry.moduleNodeByPath.get(relativePath)
      if (snapshot.blobByPath.has(relativePath) && moduleNode) {
        const target: ModuleTarget = {
          attemptedPaths: [relativePath],
          node: moduleNode,
          path: relativePath,
          status: 'local',
        }
        resolvedModuleCache.set(cacheKey, target)
        return target
      }
      if (!isSupportedSourcePath(relativePath)) {
        const binding = validateTrackedAssetBinding(relativePath, input, snapshot)
        if (binding.status === 'valid') {
          const target: ModuleTarget = {
            attemptedPaths: [relativePath],
            node: getAssetNode(relativePath, binding.sourceHash),
            path: relativePath,
            status: 'local',
          }
          resolvedModuleCache.set(cacheKey, target)
          return target
        }
        const target: ModuleTarget = {
          attemptedPaths: [relativePath],
          reason: binding.reason,
          status: 'unresolved',
        }
        resolvedModuleCache.set(cacheKey, target)
        return target
      }
      const target: ModuleTarget = {
        attemptedPaths: [relativePath],
        reason: `Resolved local module is absent, invalid, or not parsed: ${relativePath}`,
        status: 'unresolved',
      }
      resolvedModuleCache.set(cacheKey, target)
      return target
    }
    if (isLocalModuleSpecifier(specifier, compilerOptions)) {
      const candidates = trackedAssetCandidates(
        specifier,
        containingPath,
        compilerOptions,
        snapshot.blobByPath,
        input.manifestByPath,
      )
      if (candidates.matches.length === 1 && candidates.matches[0]) {
        const relativePath = candidates.matches[0]
        const binding = validateTrackedAssetBinding(relativePath, input, snapshot)
        if (binding.status === 'valid') {
          const target: ModuleTarget = {
            attemptedPaths: candidates.attemptedPaths,
            node: getAssetNode(relativePath, binding.sourceHash),
            path: relativePath,
            status: 'local',
          }
          resolvedModuleCache.set(cacheKey, target)
          return target
        }
        const target: ModuleTarget = {
          attemptedPaths: candidates.attemptedPaths,
          reason: binding.reason,
          status: 'unresolved',
        }
        resolvedModuleCache.set(cacheKey, target)
        return target
      }
      const target: ModuleTarget = {
        attemptedPaths: candidates.attemptedPaths,
        reason: candidates.matches.length > 1
          ? `Local module specifier matches multiple tracked opaque assets: ${candidates.matches.join(', ')}`
          : `Local module specifier did not resolve to exactly one supported source or opaque asset: ${specifier}`,
        status: 'unresolved',
      }
      resolvedModuleCache.set(cacheKey, target)
      return target
    }
    const externalNode = getExternalNode(specifier)
    const target: ModuleTarget = {
      attemptedPaths,
      node: externalNode,
      specifier,
      status: 'external',
    }
    resolvedModuleCache.set(cacheKey, target)
    return target
  }

  const mutableEdges = new Map<string, ExactStaticEdge>()
  const addEdge = (
    kind: ExactStaticEdgeKind,
    source: MutableNode,
    target: MutableNode,
    site: ExactStaticSite,
  ): string => {
    const key = JSON.stringify([kind, source.nodeKey, target.nodeKey])
    const existing = mutableEdges.get(key)
    if (existing) {
      existing.sites = sortAndDedupeSites([...existing.sites, site])
      return existing.edgeId
    }
    const edgeId = hashIdentifier(`static-${kind}`, [kind, source.nodeKey, target.nodeKey])
    mutableEdges.set(key, {
      edgeId,
      fromNodeKey: source.nodeKey,
      kind,
      sites: [site],
      toNodeKey: target.nodeKey,
    })
    return edgeId
  }

  const analysisSiteById = new Map<string, ExactStaticAnalysisSite>()
  const enumerateSite = (
    edgeKind: ExactStaticEdgeKind,
    owner: MutableNode,
    site: ExactStaticSite,
    role: ExactStaticSiteRole,
    expression: string,
  ): ExactStaticAnalysisSite => {
    const sourceBytes = snapshot.blobByPath.get(site.path)
    const sourceHash = sourceBytes ? sha256Bytes(sourceBytes) : sha256Bytes('')
    const sourceText = snapshot.readText(site.path) || ''
    const expressionHash = sha256Bytes(JSON.stringify([
      sourceText.slice(site.start, site.end),
      expression,
    ]))
    const siteId = hashIdentifier('static-site', [
      owner.nodeKey,
      site.path,
      sourceHash,
      site.start,
      site.end,
      site.syntaxKind,
      edgeKind,
      role,
      expressionHash,
      site.typeOnly,
      site.resolutionRule,
    ])
    const analysisSite: ExactStaticAnalysisSite = {
      ...site,
      edgeKind,
      expressionHash,
      ownerNodeKey: owner.nodeKey,
      role,
      siteId,
      sourceHash,
    }
    if (analysisSiteById.has(siteId)) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-site-enumerated-more-than-once',
        fatal: true,
        message: `An edge-capable source site was enumerated more than once: ${siteId}`,
        path: site.path,
        site,
      })
      return analysisSiteById.get(siteId) as ExactStaticAnalysisSite
    }
    analysisSiteById.set(siteId, analysisSite)
    return analysisSite
  }

  type ResolutionInput = Omit<
    ExactStaticResolution,
    'resolutionId' | 'site' | 'siteId' | 'terminal'
  >
  const resolutionsMutable: ExactStaticResolution[] = []
  const resolutionCountBySiteId = new Map<string, number>()
  const addResolution = (
    analysisSite: ExactStaticAnalysisSite,
    resolution: ResolutionInput,
  ): void => {
    const count = (resolutionCountBySiteId.get(analysisSite.siteId) || 0) + 1
    resolutionCountBySiteId.set(analysisSite.siteId, count)
    if (count !== 1) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-site-resolution-cardinality',
        fatal: true,
        message: `An edge-capable source site has more than one terminal resolution: ${analysisSite.siteId}`,
        path: analysisSite.path,
        site: analysisSite,
      })
    }
    const terminal = resolution.status === 'local'
      ? 'resolved-static'
      : resolution.status === 'external'
        ? 'resolved-external'
        : 'unresolved'
    const resolutionId = hashIdentifier('static-resolution', [
      analysisSite.siteId,
      count,
      resolution.status,
      resolution.edgeKind,
      resolution.sourceNodeKey,
      resolution.specifier,
      resolution.expression,
      resolution.reason,
      resolution.projectedEdgeId,
      resolution.targetNodeKey,
      resolution.candidateTargetNodeKeys,
    ])
    resolutionsMutable.push({
      ...resolution,
      resolutionId,
      site: {
        end: analysisSite.end,
        line: analysisSite.line,
        path: analysisSite.path,
        resolutionRule: analysisSite.resolutionRule,
        start: analysisSite.start,
        syntaxKind: analysisSite.syntaxKind,
        typeOnly: analysisSite.typeOnly,
      },
      siteId: analysisSite.siteId,
      terminal,
    })
    if (!resolution.blocking) return
    addDiagnostic(diagnostics, {
      code: 'static-graph-local-target-unresolved',
      fatal: true,
      message: resolution.reason,
      path: resolution.containingPath,
      site: analysisSite,
    })
  }

  const importBindingTargets = new Map<string, ModuleTarget>()
  const recordModuleEdge = (
    kind: 'export' | 'import',
    source: MutableNode,
    target: ModuleTarget,
    site: ExactStaticSite,
    containingPath: string,
    specifier: string,
    role: ExactStaticSiteRole = 'module-specifier',
  ): void => {
    const analysisSite = enumerateSite(kind, source, site, role, specifier)
    if (target.status === 'local') {
      const projectedEdgeId = addEdge(kind, source, target.node, site)
      addResolution(analysisSite, {
        attemptedPaths: target.attemptedPaths,
        blocking: false,
        candidateTargetNodeKeys: [target.node.nodeKey],
        containingPath,
        edgeKind: kind,
        expression: specifier,
        projectedEdgeId,
        reason: 'Module specifier resolves to one exact-commit local target.',
        sourceNodeKey: source.nodeKey,
        specifier,
        status: 'local',
        targetNodeKey: target.node.nodeKey,
      })
      return
    }
    if (target.status === 'external') {
      const projectedEdgeId = addEdge(kind, source, target.node, site)
      addResolution(analysisSite, {
        attemptedPaths: target.attemptedPaths,
        blocking: false,
        candidateTargetNodeKeys: [target.node.nodeKey],
        containingPath,
        edgeKind: kind,
        expression: specifier,
        projectedEdgeId,
        reason: 'Module specifier is outside the exact-commit local source graph.',
        sourceNodeKey: source.nodeKey,
        specifier,
        status: 'external',
        targetNodeKey: target.node.nodeKey,
      })
      return
    }
    addResolution(analysisSite, {
      attemptedPaths: target.attemptedPaths,
      blocking: true,
      candidateTargetNodeKeys: [],
      containingPath,
      edgeKind: kind,
      expression: specifier,
      projectedEdgeId: null,
      reason: target.reason,
      sourceNodeKey: source.nodeKey,
      specifier,
      status: 'unresolved',
      targetNodeKey: null,
    })
  }

  const checker = program?.getTypeChecker() || null
  const bindingKey = (relativePath: string, name: string) => JSON.stringify([relativePath, name])
  for (const item of sourceFiles) {
    const moduleNode = registry.moduleNodeByPath.get(item.path)
    if (!moduleNode) continue
    for (const statement of item.sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text
        const target = resolveModuleTarget(specifier, item.path)
        const site = createSite(item.sourceFile, item.path, statement, {
          typeOnly: importDeclarationIsTypeOnly(statement),
        })
        recordModuleEdge('import', moduleNode, target, site, item.path, specifier)
        const importClause = statement.importClause
        if (importClause?.name) importBindingTargets.set(bindingKey(item.path, importClause.name.text), target)
        const namedBindings = importClause?.namedBindings
        if (namedBindings && ts.isNamespaceImport(namedBindings)) {
          importBindingTargets.set(bindingKey(item.path, namedBindings.name.text), target)
        } else if (namedBindings) {
          for (const element of namedBindings.elements) {
            importBindingTargets.set(bindingKey(item.path, element.name.text), target)
          }
        }
      } else if (
        ts.isImportEqualsDeclaration(statement)
        && ts.isExternalModuleReference(statement.moduleReference)
        && statement.moduleReference.expression
        && ts.isStringLiteralLike(statement.moduleReference.expression)
      ) {
        const specifier = statement.moduleReference.expression.text
        const target = resolveModuleTarget(specifier, item.path)
        const site = createSite(item.sourceFile, item.path, statement, { typeOnly: statement.isTypeOnly })
        recordModuleEdge('import', moduleNode, target, site, item.path, specifier)
        importBindingTargets.set(bindingKey(item.path, statement.name.text), target)
      }
    }
  }

  const candidateNodesForTypes = (types: readonly ts.Type[]): MutableNode[] => {
    const candidates = new Map<string, MutableNode>()
    for (const type of types) {
      const symbol = type.getSymbol()
      if (!symbol) continue
      for (const node of declarationNodesForSymbol(symbol, registry.nodeByAstNode).nodes) {
        candidates.set(node.logicalIdentity, node)
      }
    }
    return [...candidates.values()].sort((left, right) => compareCodeUnits(left.nodeKey, right.nodeKey))
  }

  const candidateNodesForInitializer = (expression: ts.Expression): MutableNode[] => {
    if (ts.isParenthesizedExpression(expression)) return candidateNodesForInitializer(expression.expression)
    if (ts.isConditionalExpression(expression)) {
      const candidates = [
        ...candidateNodesForInitializer(expression.whenTrue),
        ...candidateNodesForInitializer(expression.whenFalse),
      ]
      return [...new Map(candidates.map(node => [node.logicalIdentity, node])).values()]
        .sort((left, right) => compareCodeUnits(left.nodeKey, right.nodeKey))
    }
    let symbol = checker?.getSymbolAtLocation(symbolLocation(expression))
    if (!symbol) return []
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        symbol = checker?.getAliasedSymbol(symbol) || symbol
      } catch {
        return []
      }
    }
    return declarationNodesForSymbol(symbol, registry.nodeByAstNode).nodes
      .sort((left, right) => compareCodeUnits(left.nodeKey, right.nodeKey))
  }

  const resolveExpressionTarget = (
    expression: ts.Expression,
    relativePath: string,
    edgeKind: ExactStaticEdgeKind,
  ): ExpressionTarget => {
    if (!checker) {
      return { candidateNodes: [], reason: 'Type checker is unavailable.', status: 'unresolved' }
    }
    if (expression.kind === ts.SyntaxKind.SuperKeyword) {
      return {
        candidateNodes: [],
        reason: 'super() dispatch requires heritage-target expansion that this analyzer profile does not implement.',
        status: 'unresolved',
      }
    }
    let expressionType: ts.Type | null = null
    try {
      expressionType = checker.getTypeAtLocation(expression)
    } catch {
      expressionType = null
    }
    if (expressionType && (expressionType.flags & (ts.TypeFlags.Union | ts.TypeFlags.Intersection))) {
      const constituents = 'types' in expressionType
        ? expressionType.types as readonly ts.Type[]
        : [expressionType]
      return {
        candidateNodes: candidateNodesForTypes(constituents),
        reason: `${edgeKind} target has union/intersection dispatch that is not expanded to a complete target set.`,
        status: 'unresolved',
      }
    }
    if (edgeKind === 'construct' && expressionType?.aliasSymbol) {
      return {
        candidateNodes: candidateNodesForTypes([expressionType]),
        reason: 'Constructor target resolves through a type alias whose runtime targets are not expanded.',
        status: 'unresolved',
      }
    }
    let symbol = checker.getSymbolAtLocation(symbolLocation(expression))
    const fallbackBinding = () => {
      const root = rootIdentifier(expression)
      return root ? importBindingTargets.get(bindingKey(relativePath, root.text)) || null : null
    }
    if (!symbol) {
      const binding = fallbackBinding()
      if (!binding) {
        return {
          candidateNodes: [],
          reason: 'Expression has no exact checker symbol or external import binding.',
          status: 'unresolved',
        }
      }
      if (binding.status === 'local') {
        return {
          candidateNodes: [binding.node],
          reason: 'A local import binding has no uniquely resolved checker symbol.',
          status: 'unresolved',
        }
      }
      if (binding.status === 'external') {
        return { node: binding.node, specifier: binding.specifier, status: 'external' as const }
      }
      return { candidateNodes: [], reason: binding.reason, status: 'unresolved' }
    }
    const seenAliases = new Set<ts.Symbol>()
    while (symbol.flags & ts.SymbolFlags.Alias) {
      if (seenAliases.has(symbol)) {
        return { candidateNodes: [], reason: 'Type checker alias resolution contains a cycle.', status: 'unresolved' }
      }
      seenAliases.add(symbol)
      const aliasSpecifier = (symbol.declarations || []).map(moduleSpecifierForAliasDeclaration).find(Boolean)
      let aliased: ts.Symbol
      try {
        aliased = checker.getAliasedSymbol(symbol)
      } catch {
        aliased = symbol
      }
      if (aliased === symbol || (aliasSpecifier && !aliased.declarations?.length)) {
        if (aliasSpecifier) {
          const target = resolveModuleTarget(aliasSpecifier, relativePath)
          if (target.status === 'external') {
            return { node: target.node, specifier: target.specifier, status: 'external' }
          }
          return {
            candidateNodes: target.status === 'local' ? [target.node] : [],
            reason: target.status === 'unresolved'
              ? target.reason
              : 'A local alias did not resolve to a canonical declaration.',
            status: 'unresolved',
          }
        }
        const binding = fallbackBinding()
        if (binding?.status === 'external') {
          return { node: binding.node, specifier: binding.specifier, status: 'external' }
        }
        return { candidateNodes: [], reason: 'Type checker alias did not resolve to a declaration.', status: 'unresolved' }
      }
      symbol = aliased
    }
    const resolved = declarationNodesForSymbol(symbol, registry.nodeByAstNode)
    if (resolved.nodes.length === 1 && resolved.nodes[0]) {
      if ((edgeKind === 'call' || edgeKind === 'construct') && !resolved.nodes[0].injectable) {
        const initializerCandidates = (symbol.declarations || []).flatMap(declaration => (
          ts.isVariableDeclaration(declaration) && declaration.initializer
            ? candidateNodesForInitializer(declaration.initializer)
            : []
        ))
        return {
          candidateNodes: initializerCandidates.length > 0 ? initializerCandidates : [resolved.nodes[0]],
          reason: `${edgeKind} target is a local value indirection without one canonical callable/constructable implementation.`,
          status: 'unresolved',
        }
      }
      return { node: resolved.nodes[0], status: 'local' }
    }
    if (resolved.nodes.length > 1) {
      return {
        candidateNodes: resolved.nodes,
        reason: `Checker symbol maps to ${resolved.nodes.length} incompatible canonical declarations.`,
        status: 'unresolved',
      }
    }
    if (resolved.trackedDeclarationCount > 0) {
      const declarations = symbol.declarations || []
      if (declarations.every(declaration => ts.isParameter(declaration))) {
        return {
          candidateNodes: [],
          reason: 'Parameter callback invocation has no statically complete runtime target set.',
          status: 'unresolved',
        }
      }
      return {
        candidateNodes: [],
        reason: 'Checker symbol has tracked declarations that cannot be represented canonically.',
        status: 'unresolved',
      }
    }
    return {
      candidateNodes: [],
      reason: 'Checker symbol has no declaration inside the exact-commit source graph.',
      status: 'unresolved',
    }
  }

  const recordExpressionEdge = (
    kind: 'call' | 'construct' | 'dependency-injection' | 'export',
    owner: MutableNode,
    target: ExpressionTarget,
    site: ExactStaticSite,
    relativePath: string,
    expression: ts.Expression,
    role: ExactStaticSiteRole = kind === 'call'
      ? 'call-target'
      : kind === 'construct'
        ? 'construct-target'
        : kind === 'dependency-injection'
          ? 'constructor-injection-target'
          : 'export-target',
  ): MutableNode | null => {
    const renderedExpression = expressionText(expression, expression.getSourceFile())
    const analysisSite = enumerateSite(kind, owner, site, role, renderedExpression)
    if (target.status === 'local') {
      const projectedEdgeId = addEdge(kind, owner, target.node, site)
      addResolution(analysisSite, {
        attemptedPaths: [],
        blocking: false,
        candidateTargetNodeKeys: [target.node.nodeKey],
        containingPath: relativePath,
        edgeKind: kind,
        expression: renderedExpression,
        projectedEdgeId,
        reason: 'Expression resolves to one canonical exact-commit declaration.',
        sourceNodeKey: owner.nodeKey,
        specifier: null,
        status: 'local',
        targetNodeKey: target.node.nodeKey,
      })
      return target.node
    }
    if (target.status === 'external') {
      const projectedEdgeId = addEdge(kind, owner, target.node, site)
      addResolution(analysisSite, {
        attemptedPaths: [],
        blocking: false,
        candidateTargetNodeKeys: [target.node.nodeKey],
        containingPath: relativePath,
        edgeKind: kind,
        expression: renderedExpression,
        projectedEdgeId,
        reason: 'Expression resolves through an external module binding.',
        sourceNodeKey: owner.nodeKey,
        specifier: target.specifier,
        status: 'external',
        targetNodeKey: target.node.nodeKey,
      })
      return target.node
    }
    addResolution(analysisSite, {
      attemptedPaths: [],
      blocking: true,
      candidateTargetNodeKeys: target.candidateNodes.map(node => node.nodeKey).sort(compareCodeUnits),
      containingPath: relativePath,
      edgeKind: kind,
      expression: renderedExpression,
      projectedEdgeId: null,
      reason: target.reason,
      sourceNodeKey: owner.nodeKey,
      specifier: null,
      status: 'unresolved',
      targetNodeKey: null,
    })
    return null
  }

  for (const item of sourceFiles) {
    const moduleNode = registry.moduleNodeByPath.get(item.path)
    if (!moduleNode) continue
    for (const statement of item.sourceFile.statements) {
      if (ts.isExportDeclaration(statement)) {
        if (statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
          const specifier = statement.moduleSpecifier.text
          const target = resolveModuleTarget(specifier, item.path)
          const site = createSite(item.sourceFile, item.path, statement, {
            typeOnly: exportDeclarationIsTypeOnly(statement),
          })
          recordModuleEdge('export', moduleNode, target, site, item.path, specifier)
        } else if (statement.exportClause && ts.isNamedExports(statement.exportClause) && checker) {
          for (const specifier of statement.exportClause.elements) {
            const site = createSite(item.sourceFile, item.path, specifier, { typeOnly: specifier.isTypeOnly })
            const localName = specifier.propertyName || specifier.name
            recordExpressionEdge(
              'export',
              moduleNode,
              resolveExpressionTarget(localName, item.path, 'export'),
              site,
              item.path,
              localName,
            )
          }
        }
      } else if (ts.isExportAssignment(statement)) {
        const site = createSite(item.sourceFile, item.path, statement, {
          resolutionRule: statement.isExportEquals ? 'typescript-export-equals' : 'default-export-assignment',
        })
        recordExpressionEdge(
          'export',
          moduleNode,
          resolveExpressionTarget(statement.expression, item.path, 'export'),
          site,
          item.path,
          statement.expression,
        )
      } else if (hasExportModifier(statement)) {
        const declarationNodes = ts.isVariableStatement(statement)
          ? statement.declarationList.declarations.flatMap(declaration => registry.nodeByAstNode.get(declaration) || [])
          : registry.nodeByAstNode.get(statement) || []
        for (const target of declarationNodes) {
          const site = createSite(item.sourceFile, item.path, statement, {
            typeOnly: isTypeOnlyDeclaration(statement),
          })
          const expression = target.locator?.symbol || target.nodeKey
          const analysisSite = enumerateSite('export', moduleNode, site, 'declaration-export', expression)
          const projectedEdgeId = addEdge('export', moduleNode, target, site)
          addResolution(analysisSite, {
            attemptedPaths: [],
            blocking: false,
            candidateTargetNodeKeys: [target.nodeKey],
            containingPath: item.path,
            edgeKind: 'export',
            expression,
            projectedEdgeId,
            reason: 'Export modifier binds one canonical exact-commit declaration.',
            sourceNodeKey: moduleNode.nodeKey,
            specifier: null,
            status: 'local',
            targetNodeKey: target.nodeKey,
          })
        }
      }
    }
  }

  const injectionExpressions = (argument: ts.Expression): ts.Expression[] => {
    if (ts.isIdentifier(argument) || ts.isPropertyAccessExpression(argument) || ts.isElementAccessExpression(argument)) {
      return [argument]
    }
    if (ts.isObjectLiteralExpression(argument)) {
      return argument.properties.flatMap(property => {
        if (ts.isPropertyAssignment(property)) return injectionExpressions(property.initializer)
        if (ts.isShorthandPropertyAssignment(property)) return [property.name]
        return []
      })
    }
    if (ts.isArrayLiteralExpression(argument)) {
      return argument.elements.flatMap(element => ts.isSpreadElement(element) ? [] : injectionExpressions(element))
    }
    return []
  }
  const calleeName = (expression: ts.Expression): string | null => {
    if (ts.isIdentifier(expression)) return expression.text
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text
    if (ts.isElementAccessExpression(expression)) {
      const argument = expression.argumentExpression
      return argument && ts.isStringLiteralLike(argument) ? argument.text : null
    }
    return null
  }
  const isCommonJsRequireCall = (node: ts.CallExpression): boolean => {
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'require') return false
    const symbol = checker?.getSymbolAtLocation(node.expression)
    if (!symbol || !symbol.declarations?.length) return true
    return symbol.declarations.every(declaration => (
      virtualPathToRepository(declaration.getSourceFile().fileName) === null
    ))
  }
  const isUnshadowedExternalIdentifier = (identifier: ts.Identifier): boolean => {
    if (!checker) return true
    const scopedSymbols = checker.getSymbolsInScope(identifier, ts.SymbolFlags.Value)
      .filter(symbol => symbol.name === identifier.text)
    return scopedSymbols.every(symbol => (symbol.declarations || []).every(declaration => (
      virtualPathToRepository(declaration.getSourceFile().fileName) === null
      // TypeScript represents the implicit CommonJS `module` wrapper binding with
      // the root identifier of a `module.exports` assignment as its declaration.
      || ts.isIdentifier(declaration)
    )))
  }
  const recordDynamicModuleLoad = (
    node: ts.CallExpression,
    item: { path: string; sourceFile: ts.SourceFile },
    owner: MutableNode,
    loader: 'commonjs-require' | 'dynamic-import',
  ): void => {
    const argument = node.arguments[0]
    const staticSpecifier = argument
      && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
      ? argument
      : null
    const site = createSite(item.sourceFile, item.path, node, {
      resolutionRule: `${loader}-${staticSpecifier ? 'static-specifier' : 'unresolved-expression'}`,
    })
    if (!staticSpecifier) {
      const expression = expressionText(node, item.sourceFile)
      const analysisSite = enumerateSite('import', owner, site, 'dynamic-module-specifier', expression)
      addResolution(analysisSite, {
        attemptedPaths: [],
        blocking: true,
        candidateTargetNodeKeys: [],
        containingPath: item.path,
        edgeKind: 'import',
        expression,
        projectedEdgeId: null,
        reason: argument
          ? `${loader} module specifier is not a static string literal or no-substitution template.`
          : `${loader} call has no module specifier argument.`,
        sourceNodeKey: owner.nodeKey,
        specifier: null,
        status: 'unresolved',
        targetNodeKey: null,
      })
      return
    }
    const specifier = staticSpecifier.text
    recordModuleEdge(
      'import',
      owner,
      resolveModuleTarget(specifier, item.path),
      site,
      item.path,
      specifier,
      'dynamic-module-specifier',
    )
  }
  const recordImportType = (
    node: ts.ImportTypeNode,
    item: { path: string; sourceFile: ts.SourceFile },
  ): void => {
    const owner = nearestOwner(node, item.path, registry.nodeByAstNode, registry.moduleNodeByPath)
    const site = createSite(item.sourceFile, item.path, node, {
      resolutionRule: 'import-type-static-specifier',
      typeOnly: true,
    })
    const literal = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : null
    if (!literal || (!ts.isStringLiteral(literal) && !ts.isNoSubstitutionTemplateLiteral(literal))) {
      const expression = node.getText(item.sourceFile).slice(0, 500)
      const analysisSite = enumerateSite('import', owner, site, 'import-type-specifier', expression)
      addResolution(analysisSite, {
        attemptedPaths: [],
        blocking: true,
        candidateTargetNodeKeys: [],
        containingPath: item.path,
        edgeKind: 'import',
        expression,
        projectedEdgeId: null,
        reason: 'import type module specifier is not a static string literal.',
        sourceNodeKey: owner.nodeKey,
        specifier: null,
        status: 'unresolved',
        targetNodeKey: null,
      })
      return
    }
    const specifier = literal.text
    recordModuleEdge(
      'import',
      owner,
      resolveModuleTarget(specifier, item.path),
      site,
      item.path,
      specifier,
      'import-type-specifier',
    )
  }

  const recordUnsupportedSite = (
    edgeKind: ExactStaticEdgeKind,
    owner: MutableNode,
    node: ts.Node,
    item: { path: string; sourceFile: ts.SourceFile },
    role: ExactStaticSiteRole,
    reason: string,
  ): void => {
    const site = createSite(item.sourceFile, item.path, node, { resolutionRule: role })
    const expression = node.getText(item.sourceFile).slice(0, 500)
    const analysisSite = enumerateSite(edgeKind, owner, site, role, expression)
    addResolution(analysisSite, {
      attemptedPaths: [],
      blocking: true,
      candidateTargetNodeKeys: [],
      containingPath: item.path,
      edgeKind,
      expression,
      projectedEdgeId: null,
      reason,
      sourceNodeKey: owner.nodeKey,
      specifier: null,
      status: 'unresolved',
      targetNodeKey: null,
    })
  }

  const isImportMetaGlob = (node: ts.CallExpression): boolean => (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'glob'
    && ts.isMetaProperty(node.expression.expression)
    && node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.expression.expression.name.text === 'meta'
  )
  const isCommonJsExportHelper = (node: ts.CallExpression): boolean => {
    const name = expressionLocator(node.expression)
    if (name !== 'Object.defineProperty' && name !== 'Object.assign') return false
    const helperRoot = rootIdentifier(node.expression)
    if (!helperRoot || !isUnshadowedExternalIdentifier(helperRoot)) return false
    const target = node.arguments[0]
    return Boolean(target && commonJsExportLocator(target, true))
  }
  const commonJsExportLocator = (
    expression: ts.Expression,
    allowBareExports = false,
  ): string | null => {
    const locator = expressionLocator(expression)
    const isCommonJsLocator = allowBareExports && locator === 'exports'
      || locator === 'module.exports'
      || locator?.startsWith('module.exports.')
      || locator?.startsWith('exports.')
    if (!isCommonJsLocator) return null
    const root = rootIdentifier(expression)
    return root && isUnshadowedExternalIdentifier(root) ? locator : null
  }

  for (const item of sourceFiles) {
    const visit = (node: ts.Node) => {
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && commonJsExportLocator(node.left)
      ) {
        const moduleNode = registry.moduleNodeByPath.get(item.path)
        if (moduleNode) {
          const locator = commonJsExportLocator(node.left) as string
          const memberTargets = registry.nodeByAstNode.get(node) || []
          const bindingSite = createSite(item.sourceFile, item.path, node.left, {
            resolutionRule: 'commonjs-export-assignment',
          })
          if (memberTargets.length === 1 && memberTargets[0]) {
            const member = memberTargets[0]
            const analysisSite = enumerateSite('export', moduleNode, bindingSite, 'commonjs-export-binding', locator)
            const projectedEdgeId = addEdge('export', moduleNode, member, bindingSite)
            addResolution(analysisSite, {
              attemptedPaths: [],
              blocking: false,
              candidateTargetNodeKeys: [member.nodeKey],
              containingPath: item.path,
              edgeKind: 'export',
              expression: locator,
              projectedEdgeId,
              reason: 'CommonJS export assignment binds one canonical member node.',
              sourceNodeKey: moduleNode.nodeKey,
              specifier: null,
              status: 'local',
              targetNodeKey: member.nodeKey,
            })
            recordExpressionEdge(
              'export',
              member,
              resolveExpressionTarget(node.right, item.path, 'export'),
              createSite(item.sourceFile, item.path, node.right, { resolutionRule: 'commonjs-export-target' }),
              item.path,
              node.right,
              'commonjs-export-target',
            )
          } else {
            recordUnsupportedSite(
              'export',
              moduleNode,
              node,
              item,
              'commonjs-export-binding',
              `CommonJS export assignment maps to ${memberTargets.length} canonical member nodes.`,
            )
          }
        }
      } else if (ts.isImportTypeNode(node)) {
        recordImportType(node, item)
      } else if (ts.isCallExpression(node)) {
        const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
        const commonJsRequire = isCommonJsRequireCall(node)
        const owner = nearestOwner(node, item.path, registry.nodeByAstNode, registry.moduleNodeByPath)
        if (isImportMetaGlob(node)) {
          recordUnsupportedSite(
            'import',
            owner,
            node,
            item,
            'bundler-glob-loader',
            'import.meta.glob requires exact glob expansion and asset-manifest binding that this analyzer profile does not implement.',
          )
        } else if (isCommonJsExportHelper(node)) {
          recordUnsupportedSite(
            'export',
            owner,
            node,
            item,
            'commonjs-export-helper',
            'CommonJS export helper calls require property-descriptor/export-map expansion that this analyzer profile does not implement.',
          )
        } else if (dynamicImport || commonJsRequire) {
          recordDynamicModuleLoad(
            node,
            item,
            owner,
            dynamicImport ? 'dynamic-import' : 'commonjs-require',
          )
        } else {
          const site = createSite(item.sourceFile, item.path, node)
          recordExpressionEdge(
            'call',
            owner,
            resolveExpressionTarget(node.expression, item.path, 'call'),
            site,
            item.path,
            node.expression,
          )
          const name = calleeName(node.expression)
          if (name && FACTORY_CALLEE_PATTERN.test(name)) {
            for (const argument of node.arguments.flatMap(injectionExpressions)) {
              const resolved = resolveExpressionTarget(argument, item.path, 'dependency-injection')
              const target: ExpressionTarget = resolved.status === 'local' && !resolved.node.injectable
                ? {
                    candidateNodes: [resolved.node],
                    reason: 'Factory argument does not resolve to a canonical callable injection target.',
                    status: 'unresolved',
                  }
                : resolved
              recordExpressionEdge(
                'dependency-injection',
                owner,
                target,
                createSite(item.sourceFile, item.path, argument, { resolutionRule: 'factory-callable-argument' }),
                item.path,
                argument,
                'factory-injection-target',
              )
            }
          }
        }
      } else if (ts.isNewExpression(node)) {
        const owner = nearestOwner(node, item.path, registry.nodeByAstNode, registry.moduleNodeByPath)
        recordExpressionEdge(
          'construct',
          owner,
          resolveExpressionTarget(node.expression, item.path, 'construct'),
          createSite(item.sourceFile, item.path, node),
          item.path,
          node.expression,
        )
        for (const argument of (node.arguments || []).flatMap(injectionExpressions)) {
          const target = resolveExpressionTarget(argument, item.path, 'dependency-injection')
          recordExpressionEdge(
            'dependency-injection',
            owner,
            target,
            createSite(item.sourceFile, item.path, argument, { resolutionRule: 'constructor-argument' }),
            item.path,
            argument,
            'constructor-injection-target',
          )
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(item.sourceFile)
  }

  const edges = [...mutableEdges.values()]
    .map(edge => ({ ...edge, sites: sortAndDedupeSites(edge.sites) }))
    .sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId))
  const nodes = registry.nodes
    .map(node => ({
      declarationSites: sortAndDedupeSites(node.declarationSites),
      externalSpecifier: node.externalSpecifier,
      inventoryNodeId: node.inventoryNodeId,
      kind: node.kind,
      locator: node.locator,
      nodeKey: node.nodeKey,
      projectable: node.projectable,
      sourceHash: node.sourceHash,
    }))
    .sort((left, right) => compareCodeUnits(left.nodeKey, right.nodeKey))
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const node of nodes) {
    outgoing.set(node.nodeKey, [])
    incoming.set(node.nodeKey, [])
  }
  for (const edge of edges) {
    outgoing.get(edge.fromNodeKey)?.push(edge.edgeId)
    incoming.get(edge.toNodeKey)?.push(edge.edgeId)
  }
  for (const edgeIds of outgoing.values()) edgeIds.sort(compareCodeUnits)
  for (const edgeIds of incoming.values()) edgeIds.sort(compareCodeUnits)
  const reverseIndexComplete = edges.every(edge => (
    outgoing.get(edge.fromNodeKey)?.filter(edgeId => edgeId === edge.edgeId).length === 1
    && incoming.get(edge.toNodeKey)?.filter(edgeId => edgeId === edge.edgeId).length === 1
  ))
  if (!reverseIndexComplete) {
    addDiagnostic(diagnostics, {
      code: 'static-graph-reverse-index-incomplete',
      fatal: true,
      message: 'Incoming and outgoing indexes do not exactly invert the emitted static edges.',
      path: null,
      site: null,
    })
  }

  const sites = [...analysisSiteById.values()].sort((left, right) => compareCodeUnits(left.siteId, right.siteId))
  for (const site of sites) {
    if (resolutionCountBySiteId.get(site.siteId) === 1) continue
    addDiagnostic(diagnostics, {
      code: 'static-graph-site-resolution-cardinality',
      fatal: true,
      message: `An edge-capable source site must have exactly one terminal resolution: ${site.siteId}`,
      path: site.path,
      site,
    })
  }
  const resolutions = [...resolutionsMutable].sort((left, right) => compareCodeUnits(left.resolutionId, right.resolutionId))
  const edgeById = new Map(edges.map(edge => [edge.edgeId, edge]))
  const projectionCountByEdgeSite = new Map<string, number>()
  for (const resolution of resolutions) {
    if (resolution.status === 'unresolved') {
      if (resolution.projectedEdgeId === null && resolution.targetNodeKey === null) continue
      addDiagnostic(diagnostics, {
        code: 'static-graph-unresolved-site-has-projection',
        fatal: true,
        message: `An unresolved site cannot project a static edge: ${resolution.siteId}`,
        path: resolution.containingPath,
        site: resolution.site,
      })
      continue
    }
    const edge = resolution.projectedEdgeId ? edgeById.get(resolution.projectedEdgeId) : null
    const validProjection = edge
      && edge.kind === resolution.edgeKind
      && edge.fromNodeKey === resolution.sourceNodeKey
      && edge.toNodeKey === resolution.targetNodeKey
      && edge.sites.some(site => siteKey(site) === siteKey(resolution.site))
    if (!validProjection) {
      addDiagnostic(diagnostics, {
        code: 'static-graph-site-edge-projection-invalid',
        fatal: true,
        message: `A resolved site does not project exactly to its emitted static edge: ${resolution.siteId}`,
        path: resolution.containingPath,
        site: resolution.site,
      })
      continue
    }
    const projectionKey = JSON.stringify([edge.edgeId, siteKey(resolution.site)])
    projectionCountByEdgeSite.set(projectionKey, (projectionCountByEdgeSite.get(projectionKey) || 0) + 1)
  }
  for (const edge of edges) {
    for (const site of edge.sites) {
      const projectionKey = JSON.stringify([edge.edgeId, siteKey(site)])
      if (projectionCountByEdgeSite.get(projectionKey) === 1) continue
      addDiagnostic(diagnostics, {
        code: 'static-graph-edge-site-projection-cardinality',
        fatal: true,
        message: `Every emitted edge site must have exactly one terminal resolution: ${edge.edgeId}`,
        path: site.path,
        site,
      })
    }
  }
  diagnostics.sort((left, right) => (
    compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.path || '', right.path || '')
    || compareCodeUnits(left.message, right.message)
  ))
  const sourceBlocked = diagnostics.some(diagnostic => diagnostic.fatal && (
    diagnostic.code.includes('parse')
    || diagnostic.code.includes('utf8')
    || diagnostic.code.includes('manifest')
    || diagnostic.code.includes('tsconfig')
    || diagnostic.code.includes('root-source')
  ))
  const unresolvedEdgeKinds = new Set(resolutions
    .filter(resolution => resolution.blocking || resolution.terminal === 'unresolved')
    .map(resolution => resolution.edgeKind))
  const structuralGraphBlocked = diagnostics.some(diagnostic => (
    diagnostic.fatal && diagnostic.code !== 'static-graph-local-target-unresolved'
  ))
  const limitationAffects = (coverage: keyof ExactStaticCoverage): boolean => (
    ANALYZER_PROFILE_LIMITATIONS.some(limitation => limitation.affectedCoverage.includes(coverage))
  )
  const edgeCoverage = (
    coverage: keyof ExactStaticCoverage,
    edgeKinds: readonly ExactStaticEdgeKind[],
  ): ExactStaticCoverageStatus => {
    if (structuralGraphBlocked || edgeKinds.some(kind => unresolvedEdgeKinds.has(kind))) return 'blocked'
    return limitationAffects(coverage) ? 'partial' : 'complete'
  }
  const moduleSiteRoles = new Set<ExactStaticSiteRole>([
    'bundler-glob-loader',
    'dynamic-module-specifier',
    'import-type-specifier',
    'module-specifier',
  ])
  const moduleResolutionBlocked = sourceBlocked || resolutions.some(resolution => (
    resolution.terminal === 'unresolved'
    && moduleSiteRoles.has(analysisSiteById.get(resolution.siteId)?.role as ExactStaticSiteRole)
  ))
  const graphBlocked = structuralGraphBlocked || unresolvedEdgeKinds.size > 0
  return {
    analyzerProfileLimitations: ANALYZER_PROFILE_LIMITATIONS.map(limitation => ({
      ...limitation,
      affectedCoverage: [...limitation.affectedCoverage],
    })),
    coverage: {
      call: edgeCoverage('call', ['call']),
      construct: edgeCoverage('construct', ['construct']),
      dependencyInjection: edgeCoverage('dependencyInjection', ['dependency-injection']),
      importExport: edgeCoverage('importExport', ['export', 'import']),
      moduleResolution: moduleResolutionBlocked ? 'blocked' : 'complete',
      reverseIndex: reverseIndexComplete ? 'complete' : 'blocked',
      sourceParsing: sourceBlocked ? 'blocked' : 'complete',
      staticDependencyGraph: graphBlocked
        ? 'blocked'
        : limitationAffects('staticDependencyGraph') ? 'partial' : 'complete',
    },
    diagnostics,
    edges,
    incomingEdgeIdsByNodeKey: incoming,
    nodes,
    outgoingEdgeIdsByNodeKey: outgoing,
    resolutions,
    sites,
  }
}
