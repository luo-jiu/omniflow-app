import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import JSON5 from 'json5'
import ts from 'typescript'

import { getString, getStringArray, isJsonObject } from './json.ts'
import type { JsonObject, ValidationContext, ValidationIssue } from './types.ts'

type ReleasePlatform = 'linux' | 'macos' | 'windows'

type ReleaseConfigurationFindingCode =
  | 'release-builder-config-invalid'
  | 'release-builder-config-missing'
  | 'release-builder-target-missing-from-policy'
  | 'release-builder-target-shape-unsupported'
  | 'release-policy-target-missing-from-builder'
  | 'release-source-ref-path-missing'
  | 'release-source-ref-selector-unresolved'
  | 'release-target-architecture-mismatch'
  | 'release-target-duplicate'
  | 'release-target-format-mismatch'

export type ReleaseConfigurationFinding = Omit<ValidationIssue, 'severity'> & {
  code: ReleaseConfigurationFindingCode
}

type PolicyTarget = {
  architectures: string[]
  formats: string[]
  id: string
  path: string
  platform: ReleasePlatform
  value: JsonObject
}

type BuilderTarget = {
  architectures: string[]
  format: string
  path: string
  platform: ReleasePlatform
}

type BuilderConfiguration = {
  configuration: JsonObject | null
  findings: ReleaseConfigurationFinding[]
  targets: BuilderTarget[]
  unresolvedPlatforms: Set<ReleasePlatform>
}

const BUILDER_PLATFORMS = [
  ['mac', 'macos'],
  ['win', 'windows'],
  ['linux', 'linux'],
] as const satisfies ReadonlyArray<readonly [string, ReleasePlatform]>

function createFinding(
  code: ReleaseConfigurationFindingCode,
  message: string,
  findingPath?: string,
): ReleaseConfigurationFinding {
  return findingPath ? { code, message, path: findingPath } : { code, message }
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase()
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

function sameValues(left: Iterable<string>, right: Iterable<string>): boolean {
  const normalizedLeft = sorted(left)
  const normalizedRight = sorted(right)
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function formatValues(values: Iterable<string>): string {
  const normalized = sorted(values)
  return normalized.length > 0 ? normalized.join(', ') : 'none'
}

function normalizePolicyTargets(document: JsonObject | undefined): PolicyTarget[] {
  if (!Array.isArray(document?.targets)) return []

  return document.targets.flatMap((value, index) => {
    if (!isJsonObject(value)) return []
    const platform = getString(value.platform)
    const id = getString(value.id)
    const architectures = getStringArray(value.architectures).map(normalizeValue)
    const formats = getStringArray(value.packageFormats).map(normalizeValue)
    if (!id || !isReleasePlatform(platform) || architectures.length === 0 || formats.length === 0) {
      return []
    }
    return [{
      architectures,
      formats,
      id,
      path: `release-targets.json.targets[${index}]`,
      platform,
      value,
    }]
  })
}

function isReleasePlatform(value: string | null): value is ReleasePlatform {
  return value === 'linux' || value === 'macos' || value === 'windows'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseBuilderTarget(
  value: unknown,
  platform: ReleasePlatform,
  targetPath: string,
): BuilderTarget | null {
  if (typeof value === 'string' && value.trim()) {
    return {
      architectures: [],
      format: normalizeValue(value),
      path: targetPath,
      platform,
    }
  }
  if (!isJsonObject(value)) return null

  const format = getString(value.target)
  if (!format?.trim()) return null
  let architectures: string[] = []
  if (typeof value.arch === 'string' && value.arch.trim()) {
    architectures = [normalizeValue(value.arch)]
  } else if (Array.isArray(value.arch) && value.arch.every(item => (
    typeof item === 'string' && item.trim().length > 0
  ))) {
    architectures = value.arch.map(item => normalizeValue(item as string))
  } else if (value.arch !== undefined) {
    return null
  }

  return {
    architectures,
    format: normalizeValue(format),
    path: targetPath,
    platform,
  }
}

function readBuilderConfiguration(appRoot: string): BuilderConfiguration {
  const builderPath = path.join(appRoot, 'electron-builder.json5')
  const findings: ReleaseConfigurationFinding[] = []
  if (!existsSync(builderPath)) {
    findings.push(createFinding(
      'release-builder-config-missing',
      'electron-builder.json5 does not exist',
      'electron-builder.json5',
    ))
    return { configuration: null, findings, targets: [], unresolvedPlatforms: new Set() }
  }

  let parsed: unknown
  try {
    // JSON5 parses the builder file as data; the validator never imports or executes it.
    parsed = JSON5.parse(readFileSync(builderPath, 'utf8')) as unknown
  } catch (error) {
    findings.push(createFinding(
      'release-builder-config-invalid',
      `electron-builder.json5 is not valid JSON5: ${errorMessage(error)}`,
      'electron-builder.json5',
    ))
    return { configuration: null, findings, targets: [], unresolvedPlatforms: new Set() }
  }
  if (!isJsonObject(parsed)) {
    findings.push(createFinding(
      'release-builder-config-invalid',
      'electron-builder.json5 must contain an object',
      'electron-builder.json5',
    ))
    return { configuration: null, findings, targets: [], unresolvedPlatforms: new Set() }
  }

  const targets: BuilderTarget[] = []
  const unresolvedPlatforms = new Set<ReleasePlatform>()
  for (const [builderPlatform, platform] of BUILDER_PLATFORMS) {
    const section = parsed[builderPlatform]
    if (section === undefined) continue
    const targetPath = `electron-builder.json5.${builderPlatform}.target`
    if (!isJsonObject(section) || section.target === undefined || section.target === null) {
      findings.push(createFinding(
        'release-builder-target-shape-unsupported',
        `${builderPlatform}.target must explicitly declare one or more package targets`,
        targetPath,
      ))
      unresolvedPlatforms.add(platform)
      continue
    }

    const rawTargets = Array.isArray(section.target) ? section.target : [section.target]
    if (rawTargets.length === 0) {
      findings.push(createFinding(
        'release-builder-target-shape-unsupported',
        `${builderPlatform}.target must not be empty`,
        targetPath,
      ))
      unresolvedPlatforms.add(platform)
      continue
    }

    let unsupported = false
    for (const [index, rawTarget] of rawTargets.entries()) {
      const entryPath = Array.isArray(section.target) ? `${targetPath}[${index}]` : targetPath
      const target = parseBuilderTarget(rawTarget, platform, entryPath)
      if (!target) {
        unsupported = true
        findings.push(createFinding(
          'release-builder-target-shape-unsupported',
          `Unsupported electron-builder target declaration for ${builderPlatform}`,
          entryPath,
        ))
        continue
      }
      targets.push(target)
    }
    if (unsupported) unresolvedPlatforms.add(platform)
  }

  return { configuration: parsed, findings, targets, unresolvedPlatforms }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function selectorExistsInObject(document: JsonObject, selector: string): boolean {
  if (selector === '$') return true
  if (!/^\$(?:\.[A-Za-z_$][A-Za-z0-9_$-]*)+$/.test(selector)) return false

  let current: unknown = document
  for (const key of selector.slice(2).split('.')) {
    if (!isJsonObject(current) || !Object.prototype.hasOwnProperty.call(current, key)) return false
    current = current[key]
  }
  return true
}

function readLiteralString(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null
}

function isCommandRunner(expression: ts.LeftHandSideExpression): boolean {
  const runnerName = ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : null
  return runnerName === 'run'
    || runnerName === 'spawn'
    || runnerName === 'spawnSync'
    || runnerName === 'execFile'
    || runnerName === 'execFileSync'
}

function readExplicitMacReleaseArchitectures(sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(
    'release-mac.mjs',
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  )
  const architectures = new Set<string>()

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isCommandRunner(node.expression)) {
      const command = readLiteralString(node.arguments[0])
      const argumentArray = node.arguments[1]
      if (command && argumentArray && ts.isArrayLiteralExpression(argumentArray)) {
        const commandArguments = argumentArray.elements
          .map(element => readLiteralString(element))
          .filter((value): value is string => value !== null)
        const commandLine = [command, ...commandArguments]
        if (commandLine.includes('electron-builder') || commandLine.includes('build:mac')) {
          for (const [index, argument] of commandLine.entries()) {
            if (argument === '--arm64' || argument === '--x64') {
              architectures.add(argument.slice(2))
            }
            if (argument === '--arch') {
              const architecture = commandLine[index + 1]
              if (architecture === 'arm64' || architecture === 'x64') architectures.add(architecture)
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return [...architectures]
}

function inspectSourceReferences(
  appRoot: string,
  policyTargets: PolicyTarget[],
  builderConfiguration: JsonObject | null,
): {
  architectures: Map<ReleasePlatform, Set<string>>
  findings: ReleaseConfigurationFinding[]
} {
  const architectures = new Map<ReleasePlatform, Set<string>>()
  const findings: ReleaseConfigurationFinding[] = []

  for (const target of policyTargets) {
    const sourceRefs = Array.isArray(target.value.sourceRefs) ? target.value.sourceRefs : []
    for (const [sourceIndex, source] of sourceRefs.entries()) {
      if (!isJsonObject(source)) continue
      const relativePath = getString(source.path)
      const selector = getString(source.selector)
      if (!relativePath || !selector) continue
      const normalizedPath = relativePath.replaceAll('\\', '/').replace(/^\.\//, '')
      const isBuilderReference = normalizedPath === 'electron-builder.json5'
      const isMacReleaseReference = path.posix.basename(normalizedPath) === 'release-mac.mjs'
      if (!isBuilderReference && !isMacReleaseReference) continue

      const sourcePath = `${target.path}.sourceRefs[${sourceIndex}]`
      const resolvedPath = path.resolve(appRoot, relativePath)
      if (!isPathInside(appRoot, resolvedPath) || !existsSync(resolvedPath)) {
        findings.push(createFinding(
          'release-source-ref-path-missing',
          `Release source reference does not exist: ${relativePath}`,
          sourcePath,
        ))
        continue
      }

      let selectorResolved = false
      let macReleaseSource: string | null = null
      if (isBuilderReference && builderConfiguration) {
        selectorResolved = selectorExistsInObject(builderConfiguration, selector)
      } else if (isMacReleaseReference) {
        try {
          macReleaseSource = readFileSync(resolvedPath, 'utf8')
          selectorResolved = macReleaseSource.includes(selector)
        } catch {
          selectorResolved = false
        }
      }
      if (!selectorResolved) {
        findings.push(createFinding(
          'release-source-ref-selector-unresolved',
          `Release source selector cannot be resolved in ${relativePath}: ${selector}`,
          `${sourcePath}.selector`,
        ))
        continue
      }

      // Only literal CLI arguments are recognized; script control flow and artifact paths are not interpreted.
      if (isMacReleaseReference && target.platform === 'macos' && macReleaseSource !== null) {
        const targetArchitectures = architectures.get(target.platform) || new Set<string>()
        for (const architecture of readExplicitMacReleaseArchitectures(macReleaseSource)) {
          targetArchitectures.add(architecture)
        }
        architectures.set(target.platform, targetArchitectures)
      }
    }
  }

  return { architectures, findings }
}

function findDuplicateTargets(
  policyTargets: PolicyTarget[],
  builderTargets: BuilderTarget[],
): ReleaseConfigurationFinding[] {
  const findings: ReleaseConfigurationFinding[] = []
  const policyUnits = new Map<string, string>()
  for (const target of policyTargets) {
    for (const format of target.formats) {
      for (const architecture of target.architectures) {
        const key = `${target.platform}|${format}|${architecture}`
        const previousPath = policyUnits.get(key)
        if (previousPath) {
          findings.push(createFinding(
            'release-target-duplicate',
            `Duplicate release policy target ${target.platform}/${format}/${architecture}; first declared at ${previousPath}`,
            target.path,
          ))
        } else {
          policyUnits.set(key, target.path)
        }
      }
    }
  }

  const builderUnits = new Map<string, string>()
  for (const target of builderTargets) {
    const architectures = target.architectures.length > 0 ? target.architectures : ['<unspecified>']
    for (const architecture of architectures) {
      const key = `${target.platform}|${target.format}|${architecture}`
      const previousPath = builderUnits.get(key)
      if (previousPath) {
        findings.push(createFinding(
          'release-target-duplicate',
          `Duplicate electron-builder target ${target.platform}/${target.format}/${architecture}; first declared at ${previousPath}`,
          target.path,
        ))
      } else {
        builderUnits.set(key, target.path)
      }
    }
  }
  return findings
}

function groupPolicyTargets(targets: PolicyTarget[]): Map<ReleasePlatform, PolicyTarget[]> {
  const grouped = new Map<ReleasePlatform, PolicyTarget[]>()
  for (const target of targets) {
    grouped.set(target.platform, [...(grouped.get(target.platform) || []), target])
  }
  return grouped
}

function groupBuilderTargets(targets: BuilderTarget[]): Map<ReleasePlatform, BuilderTarget[]> {
  const grouped = new Map<ReleasePlatform, BuilderTarget[]>()
  for (const target of targets) {
    grouped.set(target.platform, [...(grouped.get(target.platform) || []), target])
  }
  return grouped
}

function compareTargetMatrices(
  policyTargets: PolicyTarget[],
  builder: BuilderConfiguration,
  scriptArchitectures: Map<ReleasePlatform, Set<string>>,
): ReleaseConfigurationFinding[] {
  if (!builder.configuration) return []

  const findings: ReleaseConfigurationFinding[] = []
  const policyByPlatform = groupPolicyTargets(policyTargets)
  const builderByPlatform = groupBuilderTargets(builder.targets)
  const platforms = new Set<ReleasePlatform>([
    ...policyByPlatform.keys(),
    ...builderByPlatform.keys(),
  ])

  for (const platform of platforms) {
    if (builder.unresolvedPlatforms.has(platform)) continue
    const policyPlatformTargets = policyByPlatform.get(platform) || []
    const builderPlatformTargets = builderByPlatform.get(platform) || []
    if (policyPlatformTargets.length > 0 && builderPlatformTargets.length === 0) {
      findings.push(createFinding(
        'release-policy-target-missing-from-builder',
        `Release policy target ${policyPlatformTargets.map(target => target.id).join(', ')} has no electron-builder target for ${platform}`,
        policyPlatformTargets[0]?.path,
      ))
      continue
    }
    if (builderPlatformTargets.length > 0 && policyPlatformTargets.length === 0) {
      findings.push(createFinding(
        'release-builder-target-missing-from-policy',
        `electron-builder configures ${platform}, but release-targets.json has no matching target`,
        builderPlatformTargets[0]?.path,
      ))
      continue
    }
    if (policyPlatformTargets.length === 0 || builderPlatformTargets.length === 0) continue

    const policyFormats = new Set(policyPlatformTargets.flatMap(target => target.formats))
    const builderFormats = new Set(builderPlatformTargets.map(target => target.format))
    if (!sameValues(policyFormats, builderFormats)) {
      findings.push(createFinding(
        'release-target-format-mismatch',
        `Package format mismatch for ${platform}: policy [${formatValues(policyFormats)}], electron-builder [${formatValues(builderFormats)}]`,
        `${policyPlatformTargets[0]?.path}.packageFormats`,
      ))
    }

    for (const format of [...policyFormats].filter(value => builderFormats.has(value)).sort()) {
      const expectedArchitectures = new Set(policyPlatformTargets
        .filter(target => target.formats.includes(format))
        .flatMap(target => target.architectures))
      const configuredTargets = builderPlatformTargets.filter(target => target.format === format)
      const anchoredArchitectures = scriptArchitectures.get(platform) || new Set<string>()
      const actualArchitectures = new Set<string>(anchoredArchitectures)
      let hasUnspecifiedArchitecture = false
      for (const target of configuredTargets) {
        if (target.architectures.length === 0) {
          if (anchoredArchitectures.size === 0) hasUnspecifiedArchitecture = true
          continue
        }
        for (const architecture of target.architectures) actualArchitectures.add(architecture)
      }

      if (hasUnspecifiedArchitecture || !sameValues(expectedArchitectures, actualArchitectures)) {
        const displayedActual = new Set(actualArchitectures)
        if (hasUnspecifiedArchitecture) displayedActual.add('<unspecified>')
        findings.push(createFinding(
          'release-target-architecture-mismatch',
          `Architecture mismatch for ${platform}/${format}: policy [${formatValues(expectedArchitectures)}], explicit build configuration [${formatValues(displayedActual)}]`,
          `${policyPlatformTargets[0]?.path}.architectures`,
        ))
      }
    }
  }

  return findings
}

export function validateReleaseConfiguration(context: ValidationContext): ReleaseConfigurationFinding[] {
  const policyTargets = normalizePolicyTargets(context.documents.get('release-targets.json'))
  const builder = readBuilderConfiguration(context.appRoot)
  const sourceReferences = inspectSourceReferences(context.appRoot, policyTargets, builder.configuration)

  return [
    ...builder.findings,
    ...sourceReferences.findings,
    ...findDuplicateTargets(policyTargets, builder.targets),
    ...compareTargetMatrices(policyTargets, builder, sourceReferences.architectures),
  ]
}
