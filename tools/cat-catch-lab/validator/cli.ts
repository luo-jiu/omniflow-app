#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { validateCrossFileInvariants } from './invariants.ts'
import { createCandidatePreflightReport, getCandidatePreflightExitCode } from './report.ts'
import { loadAndValidateContracts } from './schema-registry.ts'

function printUsage(): void {
  console.error('Usage: tsx tools/cat-catch-lab/validator/cli.ts validate [--root PATH] [--upstream-root PATH] [--json]')
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

function main(): void {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
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
  if (command !== 'validate' || extraPositionals.length > 0) {
    printUsage()
    process.exitCode = 2
    return
  }

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
  process.exitCode = getCandidatePreflightExitCode(report)
}

main()
