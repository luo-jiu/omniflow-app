export type IssueSeverity = 'error' | 'blocker' | 'warning'

export type ValidationIssue = {
  code: string
  message: string
  path?: string
  severity: IssueSeverity
}

export type JsonObject = Record<string, unknown>

export type LoadedContracts = {
  documents: Map<string, JsonObject>
  inputHashes: Record<string, string>
  schemas: Map<string, JsonObject>
}

export type ValidationContext = LoadedContracts & {
  appRoot: string
  catCatchDirectory: string
  upstreamRoot: string
}

export type CandidatePreflightReport = {
  schemaVersion: 1
  reportType: 'g0-candidate-preflight'
  promotable: false
  generatedAt: string
  validatorSourceManifestHash: string
  validatorToolchainFingerprintHash: string
  workspace: {
    appHead: string | null
    appCommitInputTreeHash: string | null
    dirtyTrackedPaths: string[]
    untrackedInputPaths: string[]
    upstreamHead: string | null
    worktreeInputHash: string
  }
  inputHashes: Record<string, string>
  structuralStatus: 'passed' | 'failed'
  g0Status: 'in-progress' | 'blocked'
  errors: ValidationIssue[]
  blockers: ValidationIssue[]
  warnings: ValidationIssue[]
}

export function createIssue(
  severity: IssueSeverity,
  code: string,
  message: string,
  path?: string,
): ValidationIssue {
  return path ? { code, message, path, severity } : { code, message, severity }
}
