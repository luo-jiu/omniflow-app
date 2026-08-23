import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { hashFile, readJsonObject } from './json.ts'
import { createIssue, type LoadedContracts, type ValidationIssue } from './types.ts'

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

export function loadAndValidateContracts(catCatchDirectory: string): {
  contracts: LoadedContracts
  issues: ValidationIssue[]
} {
  const documents = new Map<string, Record<string, unknown>>()
  const inputHashes: Record<string, string> = {}
  const issues: ValidationIssue[] = []
  const schemas = new Map<string, Record<string, unknown>>()
  const validators = new Map<string, ValidateFunction>()

  if (!existsSync(catCatchDirectory)) {
    issues.push(createIssue('error', 'contract-directory-missing', 'Cat Catch contract directory does not exist', catCatchDirectory))
    return { contracts: { documents, inputHashes, schemas }, issues }
  }

  const schemaFiles = readdirSync(catCatchDirectory)
    .filter(fileName => fileName.endsWith('.schema.json'))
    .sort()
  for (const schemaFile of REQUIRED_SCHEMA_FILES) {
    if (schemaFiles.includes(schemaFile)) continue
    issues.push(createIssue('error', 'required-schema-missing', `Required schema is missing: ${schemaFile}`, schemaFile))
  }

  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: false,
    strict: true,
    validateFormats: true,
  })
  addFormats(ajv)

  for (const schemaFile of schemaFiles) {
    const schemaPath = path.join(catCatchDirectory, schemaFile)
    try {
      const schema = readJsonObject(schemaPath)
      schemas.set(schemaFile, schema)
      inputHashes[schemaFile] = hashFile(schemaPath)
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

  for (const [dataFile, schemaFile] of DATA_SCHEMA_PAIRS) {
    const dataPath = path.join(catCatchDirectory, dataFile)
    const schema = schemas.get(schemaFile)
    if (!schema) continue
    if (!existsSync(dataPath)) {
      issues.push(createIssue('error', 'required-data-missing', `Required declaration is missing: ${dataFile}`, dataFile))
      continue
    }
    const validator = validators.get(schemaFile)
    if (!validator) continue

    try {
      const document = readJsonObject(dataPath)
      documents.set(dataFile, document)
      inputHashes[dataFile] = hashFile(dataPath)
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

  return { contracts: { documents, inputHashes, schemas }, issues }
}
