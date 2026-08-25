#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { validateCrossFileInvariants } from './invariants.ts'
import {
  isPathInside,
  resolveLocalArtifactRoot,
  writeCandidateArtifact,
} from './local-artifact.ts'
import {
  generateCandidateLocalClosureReport,
  getCandidateLocalClosureExitCode,
  isLocalClosureReportIndexPath,
  serializeCandidateLocalClosureCanonicalBytes,
} from './local-closure.ts'
import { sha256Bytes } from './json.ts'
import { createCandidatePreflightReport, getCandidatePreflightExitCode } from './report.ts'
import { loadAndValidateContracts } from './schema-registry.ts'
import type { CandidateLocalClosureReport, ValidationIssue } from './types.ts'

function printUsage(): void {
  console.error('Usage:')
  console.error('  tsx tools/cat-catch-lab/validator/cli.ts validate [--root PATH] [--upstream-root PATH] [--json]')
  console.error('  tsx tools/cat-catch-lab/validator/cli.ts generate-local-closure --commit FULL_SHA [--root PATH] [--output PATH] [--json]')
}

function printHumanReport(report: ReturnType<typeof createCandidatePreflightReport>): void {
  console.log(`Cat Catch contract structure: ${report.structuralStatus}`)
  console.log(`G0 candidate readiness: ${report.g0Status} (promotable: no)`)
  console.log(`Input hash: ${report.workspace.worktreeInputHash}`)

  for (const [label, issues] of [
    ['Errors', report.errors],
    ['Blockers', report.blockers],
    ['Warnings', report.warnings],
  ] as const) {
    if (issues.length === 0) continue
    console.log(`${label} (${issues.length}):`)
    for (const issue of issues) {
      console.log(`- [${issue.code}] ${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
    }
  }
}

function printIssues(issues: ValidationIssue[]): void {
  for (const issue of issues) {
    console.error(`- [${issue.severity}:${issue.code}] ${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
  }
}

function runValidate(parsed: ReturnType<typeof parseArgs>): number {
  const rootOption = parsed.values.root
  const upstreamRootOption = parsed.values['upstream-root']
  const appRoot = path.resolve(typeof rootOption === 'string' ? rootOption : process.cwd())
  const upstreamRoot = path.resolve(
    typeof upstreamRootOption === 'string'
      ? upstreamRootOption
      : path.join(appRoot, '../project/cat-catch'),
  )
  const catCatchDirectory = path.join(appRoot, 'docs/cat-catch')
  const { contracts, issues: schemaIssues } = loadAndValidateContracts(catCatchDirectory)
  const invariantIssues = schemaIssues.some(issue => issue.severity === 'error')
    ? []
    : validateCrossFileInvariants({
      ...contracts,
      appRoot,
      catCatchDirectory,
      upstreamRoot,
    })
  const report = createCandidatePreflightReport({
    appRoot,
    upstreamRoot,
    contracts,
    issues: [...schemaIssues, ...invariantIssues],
  })

  if (parsed.values.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHumanReport(report)
  }
  return getCandidatePreflightExitCode(report)
}

function printLocalClosureReport(report: CandidateLocalClosureReport, outputPath: string | null): void {
  console.log(`Cat Catch candidate local closure: ${report.status}`)
  console.log(`Trust: ${report.validator.trustClassification} (promotable: no)`)
  console.log('Schema and semantic validation: passed')
  console.log('Closure complete: no (only bootstrap-root reachability is currently proven)')
  console.log(`Input commit: ${report.evidenceInputCommit}`)
  console.log(`Input tree hash: ${report.evidenceInputTreeHash}`)
  console.log(`Tracked blob manifest entries: ${report.sourceManifest.entries.length}`)
  console.log(`Proven reachable roots: ${report.discoveredNodes.length}`)
  console.log(`Unmapped in-scope nodes: ${report.counts.unmappedInScopeNodes}`)
  console.log(`Blockers: ${report.blockers.length}`)
  for (const blocker of report.blockers) {
    console.log(`- [${blocker.code}] ${blocker.message}`)
  }
  if (outputPath) console.log(`Output: ${outputPath}`)
}

function runGenerateLocalClosure(parsed: ReturnType<typeof parseArgs>): number {
  const rootOption = parsed.values.root
  const commitOption = parsed.values.commit
  const outputOption = parsed.values.output
  if (typeof commitOption !== 'string') {
    console.error('--commit must be a full 40-character Git commit SHA')
    printUsage()
    return 2
  }

  const appRoot = path.resolve(typeof rootOption === 'string' ? rootOption : process.cwd())
  const artifactRoot = resolveLocalArtifactRoot(appRoot)
  const requestedOutputPath = typeof outputOption === 'string'
    ? path.resolve(appRoot, outputOption)
    : null
  if (requestedOutputPath && isLocalClosureReportIndexPath(appRoot, requestedOutputPath)) {
    console.error('Local candidate reports must not be written to docs/cat-catch/report-index')
    return 2
  }
  if (requestedOutputPath && !isPathInside(artifactRoot, requestedOutputPath)) {
    console.error(`Local candidate reports may only be written below ${artifactRoot}`)
    return 2
  }

  const result = generateCandidateLocalClosureReport(appRoot, commitOption)
  if (!result.report) {
    console.error('Candidate local-closure generation failed:')
    printIssues(result.issues)
    return 2
  }

  const canonicalBytes = serializeCandidateLocalClosureCanonicalBytes(result.report)
  const contentHash = sha256Bytes(canonicalBytes).slice('sha256:'.length)
  const outputPath = requestedOutputPath || path.join(
    artifactRoot,
    'local-closure',
    `${contentHash}.json`,
  )
  try {
    writeCandidateArtifact(appRoot, outputPath, canonicalBytes)
  } catch (error) {
    console.error(`Unable to write local-closure candidate: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  if (parsed.values.json) {
    process.stdout.write(canonicalBytes)
    process.stdout.write('\n')
  } else {
    printLocalClosureReport(result.report, outputPath)
  }
  return getCandidateLocalClosureExitCode(result.report)
}

function main(): void {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        commit: { type: 'string' },
        json: { type: 'boolean', default: false },
        output: { type: 'string' },
        root: { type: 'string' },
        'upstream-root': { type: 'string' },
      },
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    printUsage()
    process.exitCode = 2
    return
  }

  const [command, ...extraPositionals] = parsed.positionals
  if (extraPositionals.length > 0) {
    printUsage()
    process.exitCode = 2
    return
  }
  if (command === 'validate') {
    if (parsed.values.commit !== undefined || parsed.values.output !== undefined) {
      console.error('--commit and --output are only valid with generate-local-closure')
      process.exitCode = 2
      return
    }
    process.exitCode = runValidate(parsed)
    return
  }
  if (command === 'generate-local-closure') {
    if (parsed.values['upstream-root'] !== undefined) {
      console.error('--upstream-root is only valid with validate')
      process.exitCode = 2
      return
    }
    process.exitCode = runGenerateLocalClosure(parsed)
    return
  }
  printUsage()
  process.exitCode = 2
}

main()
