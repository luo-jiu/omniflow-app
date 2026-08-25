import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  listGitTreeEntriesAtCommit,
  readGitPathAtCommit,
  tryResolveGitCommit,
} from './git-input.ts'
import { decodeUtf8Bytes, sha256Bytes } from './json.ts'
import {
  createIssue,
  type ContractLoadResult,
  type JsonObject,
  type LoadedContracts,
  type ValidationIssue,
} from './types.ts'

const DATA_SCHEMA_PAIRS = [
  ['upstream-state.json', 'upstream-state.schema.json'],
  ['capability-ledger.json', 'capability-ledger.schema.json'],
  ['legacy-inventory.json', 'legacy-inventory.schema.json'],
  ['release-targets.json', 'release-targets.schema.json'],
  ['risk-policy.json', 'risk-policy.schema.json'],
  ['automation-policy.json', 'automation-policy.schema.json'],
  ['evidence-retention-policy.json', 'evidence-retention-policy.schema.json'],
  ['validator-trust-policy.json', 'validator-trust-policy.schema.json'],
  ['report-index/index.json', 'report-index.schema.json'],
] as const

const LOCAL_CLOSURE_DATA_SCHEMA_PAIRS = DATA_SCHEMA_PAIRS.filter(
  ([dataFile]) => dataFile !== 'report-index/index.json',
)

const REQUIRED_SCHEMA_FILES = [
  'artifact-availability-report.schema.json',
  'automation-policy.schema.json',
  'capability-ledger.schema.json',
  'capability-state-report.schema.json',
  'decision-record.schema.json',
  'evidence-artifact.schema.json',
  'evidence-retention-policy.schema.json',
  'gate-report.schema.json',
  'legacy-inventory.schema.json',
  'local-closure-report.schema.json',
  'release-targets.schema.json',
  'report-index-entry.schema.json',
  'report-index.schema.json',
  'risk-policy.schema.json',
  'seal-report.schema.json',
  'upstream-state.schema.json',
  'validator-trust-policy.schema.json',
] as const

const DEFAULT_CAT_CATCH_RELATIVE_DIRECTORY = 'docs/cat-catch'
const FULL_GIT_COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/

type ContractFileState =
  | { status: 'absent' }
  | { status: 'present'; bytes: Buffer; source: string }
  | { status: 'unavailable'; message: string }

type ContractFileReader = (relativePath: string) => ContractFileState

function formatAjvError(error: ErrorObject): string {
  const location = error.instancePath || '/'
  return `${location} ${error.message || error.keyword}`
}

function resolveValidator(
  ajv: Ajv2020,
  schema: Record<string, unknown>,
  schemaFile: string,
): ValidateFunction {
  const schemaId = typeof schema.$id === 'string' ? schema.$id : null
  const validator = schemaId ? ajv.getSchema(schemaId) : null
  if (validator) return validator
  try {
    return ajv.compile(schema)
  } catch (error) {
    throw new Error(`${schemaFile}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: false,
    strict: true,
    validateFormats: true,
  })
  addFormats(ajv)
  return ajv
}

function createEmptyContracts(): LoadedContracts {
  return {
    documents: new Map<string, JsonObject>(),
    inputHashes: {},
    schemas: new Map<string, JsonObject>(),
  }
}

function parseJsonObject(bytes: Buffer, source: string): JsonObject {
  const value: unknown = JSON.parse(decodeUtf8Bytes(bytes, source))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object`)
  }
  return value as JsonObject
}

function loadAndValidateContractFiles(
  schemaFiles: string[],
  readContractFile: ContractFileReader,
  dataSchemaPairs: ReadonlyArray<readonly [string, string]> = DATA_SCHEMA_PAIRS,
): ContractLoadResult {
  const contracts = createEmptyContracts()
  const { documents, inputHashes, schemas } = contracts
  const issues = [] as ContractLoadResult['issues']
  const validators = new Map<string, ValidateFunction>()

  for (const schemaFile of REQUIRED_SCHEMA_FILES) {
    if (schemaFiles.includes(schemaFile)) continue
    issues.push(createIssue('error', 'required-schema-missing', `Required schema is missing: ${schemaFile}`, schemaFile))
  }

  const ajv = createAjv()

  for (const schemaFile of schemaFiles) {
    const state = readContractFile(schemaFile)
    if (state.status !== 'present') {
      const message = state.status === 'unavailable'
        ? state.message
        : `Schema is absent from the selected input: ${schemaFile}`
      issues.push(createIssue('error', 'schema-load-failed', message, schemaFile))
      continue
    }
    try {
      const schema = parseJsonObject(state.bytes, state.source)
      inputHashes[schemaFile] = sha256Bytes(state.bytes)
      schemas.set(schemaFile, schema)
      ajv.addSchema(schema)
    } catch (error) {
      issues.push(createIssue(
        'error',
        'schema-load-failed',
        error instanceof Error ? error.message : String(error),
        schemaFile,
      ))
    }
  }

  for (const schemaFile of schemaFiles) {
    const schema = schemas.get(schemaFile)
    if (!schema) continue
    try {
      validators.set(schemaFile, resolveValidator(ajv, schema, schemaFile))
    } catch (error) {
      issues.push(createIssue(
        'error',
        'schema-compile-failed',
        error instanceof Error ? error.message : String(error),
        schemaFile,
      ))
    }
  }

  for (const [dataFile, schemaFile] of dataSchemaPairs) {
    const schema = schemas.get(schemaFile)
    if (!schema) continue
    const validator = validators.get(schemaFile)
    if (!validator) continue

    const state = readContractFile(dataFile)
    if (state.status === 'absent') {
      issues.push(createIssue('error', 'required-data-missing', `Required declaration is missing: ${dataFile}`, dataFile))
      continue
    }
    if (state.status === 'unavailable') {
      issues.push(createIssue('error', 'declaration-load-failed', state.message, dataFile))
      continue
    }

    try {
      const document = parseJsonObject(state.bytes, state.source)
      inputHashes[dataFile] = sha256Bytes(state.bytes)
      documents.set(dataFile, document)
      if (!validator(document)) {
        for (const error of validator.errors || []) {
          issues.push(createIssue(
            'error',
            'schema-validation-failed',
            formatAjvError(error),
            dataFile,
          ))
        }
      }
    } catch (error) {
      issues.push(createIssue(
        'error',
        'declaration-load-failed',
        error instanceof Error ? error.message : String(error),
        dataFile,
      ))
    }
  }

  return { contracts, issues }
}

export function validateContractDocument(
  contracts: LoadedContracts,
  schemaFile: string,
  document: JsonObject,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const schema = contracts.schemas.get(schemaFile)
  if (!schema) {
    return [createIssue(
      'error',
      'required-schema-missing',
      `Required schema is missing: ${schemaFile}`,
      schemaFile,
    )]
  }

  const ajv = createAjv()
  for (const [loadedSchemaFile, loadedSchema] of contracts.schemas) {
    try {
      ajv.addSchema(loadedSchema)
    } catch (error) {
      issues.push(createIssue(
        'error',
        'schema-load-failed',
        error instanceof Error ? error.message : String(error),
        loadedSchemaFile,
      ))
    }
  }
  if (issues.length > 0) return issues

  let validator: ValidateFunction
  try {
    validator = resolveValidator(ajv, schema, schemaFile)
  } catch (error) {
    return [createIssue(
      'error',
      'schema-compile-failed',
      error instanceof Error ? error.message : String(error),
      schemaFile,
    )]
  }
  if (validator(document)) return []
  for (const error of validator.errors || []) {
    issues.push(createIssue(
      'error',
      'schema-validation-failed',
      formatAjvError(error),
      schemaFile,
    ))
  }
  return issues
}

export function loadAndValidateContracts(catCatchDirectory: string): ContractLoadResult {
  if (!existsSync(catCatchDirectory)) {
    const contracts = createEmptyContracts()
    const issues = [
      createIssue('error', 'contract-directory-missing', 'Cat Catch contract directory does not exist', catCatchDirectory),
    ]
    return { contracts, issues }
  }

  const schemaFiles = readdirSync(catCatchDirectory)
    .filter(fileName => fileName.endsWith('.schema.json'))
    .sort()
  return loadAndValidateContractFiles(schemaFiles, relativePath => {
    const filePath = path.join(catCatchDirectory, relativePath)
    if (!existsSync(filePath)) return { status: 'absent' }
    try {
      return { bytes: readFileSync(filePath), source: filePath, status: 'present' }
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
        status: 'unavailable',
      }
    }
  })
}

export function loadAndValidateContractsAtCommit(
  appRoot: string,
  commit: string,
  catCatchRelativeDirectory = DEFAULT_CAT_CATCH_RELATIVE_DIRECTORY,
): ContractLoadResult {
  return loadAndValidateContractsAtCommitWithDataSchemaPairs(
    appRoot,
    commit,
    catCatchRelativeDirectory,
    DATA_SCHEMA_PAIRS,
  )
}

export function loadAndValidateLocalClosureContractsAtCommit(
  appRoot: string,
  commit: string,
  catCatchRelativeDirectory = DEFAULT_CAT_CATCH_RELATIVE_DIRECTORY,
): ContractLoadResult {
  return loadAndValidateContractsAtCommitWithDataSchemaPairs(
    appRoot,
    commit,
    catCatchRelativeDirectory,
    LOCAL_CLOSURE_DATA_SCHEMA_PAIRS,
  )
}

function loadAndValidateContractsAtCommitWithDataSchemaPairs(
  appRoot: string,
  commit: string,
  catCatchRelativeDirectory: string,
  dataSchemaPairs: ReadonlyArray<readonly [string, string]>,
): ContractLoadResult {
  const contracts = createEmptyContracts()
  if (!FULL_GIT_COMMIT_PATTERN.test(commit)) {
    const issues = [createIssue(
      'error',
      'contract-commit-not-full',
      'Contract snapshot commit must be a full 40-character hexadecimal Git object ID',
      commit,
    )]
    return { contracts, issues }
  }

  const resolvedCommit = tryResolveGitCommit(appRoot, commit)
  if (resolvedCommit !== commit.toLowerCase()) {
    const issues = [createIssue(
      'error',
      'contract-commit-unavailable',
      'Contract snapshot commit is unavailable or does not identify a commit object',
      commit,
    )]
    return { contracts, issues }
  }

  let treeState
  try {
    treeState = listGitTreeEntriesAtCommit(appRoot, resolvedCommit, catCatchRelativeDirectory)
  } catch (error) {
    const issues = [createIssue(
      'error',
      'contract-directory-invalid',
      error instanceof Error ? error.message : String(error),
      catCatchRelativeDirectory,
    )]
    return { contracts, issues }
  }
  if (treeState.status === 'absent') {
    const issues = [createIssue(
      'error',
      'contract-directory-missing',
      'Cat Catch contract directory does not exist at the selected commit',
      catCatchRelativeDirectory,
    )]
    return { contracts, issues }
  }
  if (treeState.status === 'unavailable') {
    const issues = [createIssue(
      'error',
      'contract-directory-unavailable',
      'Cat Catch contract tree cannot be read from the selected commit',
      catCatchRelativeDirectory,
    )]
    return { contracts, issues }
  }

  const directoryPrefix = `${catCatchRelativeDirectory.replace(/\/+$/, '')}/`
  const schemaFiles = treeState.entries
    .map(entry => entry.relativePath)
    .filter(relativePath => relativePath.startsWith(directoryPrefix))
    .map(relativePath => relativePath.slice(directoryPrefix.length))
    .filter(relativePath => !relativePath.includes('/') && relativePath.endsWith('.schema.json'))
    .sort()
  return loadAndValidateContractFiles(schemaFiles, relativePath => {
    const repositoryRelativePath = path.posix.join(catCatchRelativeDirectory, relativePath)
    const state = readGitPathAtCommit(appRoot, resolvedCommit, repositoryRelativePath)
    if (state.status === 'present') {
      return {
        bytes: state.bytes,
        source: `${resolvedCommit}:${repositoryRelativePath}`,
        status: 'present',
      }
    }
    if (state.status === 'absent') return state
    return {
      message: `Git blob is unavailable: ${resolvedCommit}:${repositoryRelativePath}`,
      status: 'unavailable',
    }
  }, dataSchemaPairs)
}
