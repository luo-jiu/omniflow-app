import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { sha256Bytes } from './json.ts'

const ancestorCache = new Map<string, GitAncestryState>()
const commitParentsCache = new Map<string, string[]>()
const objectExistsCache = new Map<string, boolean>()
const pathStateCache = new Map<string, GitPathState>()
const touchedPathCache = new Map<string, boolean>()

const GIT_GLOBAL_ARGS = ['--no-replace-objects'] as const

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', [...GIT_GLOBAL_ARGS, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

function runGitBuffer(cwd: string, args: string[]): Buffer {
  return execFileSync('git', [...GIT_GLOBAL_ARGS, ...args], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function tryReadGitHead(cwd: string): string | null {
  try {
    return runGit(cwd, ['rev-parse', 'HEAD']).trim()
  } catch {
    return null
  }
}

export function tryResolveGitCommit(cwd: string, revision: string): string | null {
  try {
    return runGit(cwd, ['rev-parse', '--verify', `${revision}^{commit}`]).trim()
  } catch {
    return null
  }
}

export function tryReadGitRemoteUrl(cwd: string, remote = 'origin'): string | null {
  try {
    return runGit(cwd, ['config', '--get', `remote.${remote}.url`]).trim() || null
  } catch {
    return null
  }
}

export function gitObjectExists(cwd: string, objectId: string): boolean {
  const cacheKey = `${cwd}\0${objectId}`
  const cached = objectExistsCache.get(cacheKey)
  if (cached !== undefined) return cached
  try {
    runGit(cwd, ['cat-file', '-e', `${objectId}^{commit}`])
    objectExistsCache.set(cacheKey, true)
    return true
  } catch {
    objectExistsCache.set(cacheKey, false)
    return false
  }
}

export type GitAncestryState = 'ancestor' | 'not-ancestor' | 'unavailable'

export function getGitAncestryState(
  cwd: string,
  ancestor: string,
  descendant: string,
): GitAncestryState {
  const cacheKey = `${cwd}\0${ancestor}\0${descendant}`
  const cached = ancestorCache.get(cacheKey)
  if (cached !== undefined) return cached

  const resolvedAncestor = tryResolveGitCommit(cwd, ancestor)
  const resolvedDescendant = tryResolveGitCommit(cwd, descendant)
  if (!resolvedAncestor || !resolvedDescendant) return 'unavailable'
  if (resolvedAncestor === resolvedDescendant) {
    ancestorCache.set(cacheKey, 'ancestor')
    return 'ancestor'
  }

  const pending = [resolvedDescendant]
  const visited = new Set<string>()
  let parentGraphUnavailable = false
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    visited.add(current)
    const parents = readGitCommitParents(cwd, current)
    if (parents === null) {
      parentGraphUnavailable = true
      continue
    }
    for (const parent of parents) {
      if (parent === resolvedAncestor) {
        ancestorCache.set(cacheKey, 'ancestor')
        return 'ancestor'
      }
      if (!visited.has(parent)) pending.push(parent)
    }
  }

  const result = parentGraphUnavailable ? 'unavailable' : 'not-ancestor'
  if (result !== 'unavailable') ancestorCache.set(cacheKey, result)
  return result
}

export function isGitAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return getGitAncestryState(cwd, ancestor, descendant) === 'ancestor'
}

export function gitCommitTouchesPath(cwd: string, commit: string, relativePath: string): boolean {
  const cacheKey = `${cwd}\0${commit}\0${relativePath}`
  const cached = touchedPathCache.get(cacheKey)
  if (cached !== undefined) return cached
  try {
    const output = runGit(cwd, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      commit,
      '--',
      relativePath,
    ])
    const touched = output.split('\n').includes(relativePath)
    touchedPathCache.set(cacheKey, touched)
    return touched
  } catch {
    touchedPathCache.set(cacheKey, false)
    return false
  }
}

export function gitCommitContainsPathScope(cwd: string, commit: string, relativePath: string): boolean {
  try {
    assertRepositoryRelativePath(relativePath)
    return runGit(cwd, ['ls-tree', '-r', '--name-only', commit, '--', relativePath]).trim().length > 0
  } catch {
    return false
  }
}

function assertRepositoryRelativePath(relativePath: string): void {
  if (
    !relativePath
    || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).includes('..')
    || relativePath.includes('\0')
  ) {
    throw new Error(`Invalid repository-relative path: ${relativePath}`)
  }
}

export function readGitFileAtCommit(
  cwd: string,
  commit: string,
  relativePath: string,
): Buffer | null {
  const state = readGitPathAtCommit(cwd, commit, relativePath)
  return state.status === 'present' ? state.bytes : null
}

export type GitPathState =
  | { status: 'absent' }
  | { status: 'present'; bytes: Buffer }
  | { status: 'unavailable' }

export function readGitCommitParents(cwd: string, commit: string): string[] | null {
  const cacheKey = `${cwd}\0${commit}`
  const cached = commitParentsCache.get(cacheKey)
  if (cached !== undefined) return cached
  try {
    const commitObject = runGitBuffer(cwd, ['cat-file', 'commit', `${commit}^{commit}`])
    const headerEnd = commitObject.indexOf('\n\n')
    if (headerEnd < 0) return null
    const headerLines = commitObject.subarray(0, headerEnd).toString('utf8').split('\n')
    const parents = headerLines
      .filter(line => line.startsWith('parent '))
      .map(line => line.slice('parent '.length))
    const result = parents.every(parent => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(parent)) ? parents : null
    if (result !== null) commitParentsCache.set(cacheKey, result)
    return result
  } catch {
    return null
  }
}

export function readGitPathAtCommit(
  cwd: string,
  commit: string,
  relativePath: string,
): GitPathState {
  assertRepositoryRelativePath(relativePath)
  const cacheKey = `${cwd}\0${commit}\0${relativePath}`
  const cached = pathStateCache.get(cacheKey)
  if (cached) return cached
  try {
    const treeEntry = runGitBuffer(cwd, ['ls-tree', '-z', `${commit}^{commit}`, '--', relativePath]).toString('utf8')
    if (!treeEntry) {
      const result = { status: 'absent' } as const
      pathStateCache.set(cacheKey, result)
      return result
    }
    const records = treeEntry.split('\0').filter(Boolean)
    if (records.length !== 1) {
      const result = { status: 'unavailable' } as const
      pathStateCache.set(cacheKey, result)
      return result
    }
    const match = /^(\d+) blob ((?:[0-9a-f]{40}|[0-9a-f]{64}))\t(.+)$/.exec(records[0] || '')
    if (!match || match[3] !== relativePath) {
      const result = { status: 'unavailable' } as const
      pathStateCache.set(cacheKey, result)
      return result
    }
    const result = { status: 'present', bytes: runGitBuffer(cwd, ['cat-file', 'blob', match[2] || '']) } as const
    pathStateCache.set(cacheKey, result)
    return result
  } catch {
    const result = { status: 'unavailable' } as const
    pathStateCache.set(cacheKey, result)
    return result
  }
}

export function listDirtyTrackedPaths(cwd: string): string[] {
  const output = runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=no'])
  if (!output) return []
  return output.split('\n').map(line => line.slice(3).trim()).filter(Boolean).sort()
}

function listTrackedPaths(cwd: string): string[] {
  const output = runGitBuffer(cwd, ['ls-files', '-z'])
  return output.toString('utf8').split('\0').filter(Boolean).sort()
}

export function listUntrackedPaths(cwd: string): string[] {
  const output = runGitBuffer(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
  return output.toString('utf8').split('\0').filter(Boolean).sort()
}

function isReportIndexPath(relativePath: string): boolean {
  return relativePath === 'docs/cat-catch/report-index'
    || relativePath.startsWith('docs/cat-catch/report-index/')
}

export function hashTrackedWorktreeInputs(cwd: string): string {
  const manifest = [...new Set([...listTrackedPaths(cwd), ...listUntrackedPaths(cwd)])]
    .filter(relativePath => !isReportIndexPath(relativePath))
    .map(relativePath => {
      const absolutePath = path.join(cwd, relativePath)
      if (!existsSync(absolutePath)) return `missing\0${relativePath}`
      const stat = lstatSync(absolutePath)
      if (stat.isSymbolicLink()) {
        return `120000\0blob\0${relativePath}\0${sha256Bytes(readlinkSync(absolutePath))}`
      }
      if (stat.isDirectory()) {
        const nestedHead = tryReadGitHead(absolutePath) || 'unresolved-directory'
        return `160000\0commit\0${relativePath}\0${nestedHead}`
      }
      const mode = stat.mode & 0o111 ? '100755' : '100644'
      return `${mode}\0blob\0${relativePath}\0${sha256Bytes(readFileSync(absolutePath))}`
    })
    .join('\0')
  return sha256Bytes(manifest)
}

export function hashGitCommitInputs(cwd: string, commit: string): string | null {
  const resolvedCommit = tryResolveGitCommit(cwd, commit)
  if (!resolvedCommit) return null
  const records = runGitBuffer(cwd, ['ls-tree', '-rz', '--full-tree', '-r', resolvedCommit])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter(record => {
      const separatorIndex = record.indexOf('\t')
      if (separatorIndex < 0) return true
      return !isReportIndexPath(record.slice(separatorIndex + 1))
    })
    .sort()
  return sha256Bytes(records.join('\0'))
}

function listFilesRecursively(directory: string): string[] {
  if (!statSync(directory).isDirectory()) return [directory]
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const target = path.join(directory, entry.name)
      return entry.isDirectory() ? listFilesRecursively(target) : [target]
    })
}

export function hashValidatorSourceManifest(appRoot: string): string {
  const roots = [
    path.join(appRoot, 'tools/cat-catch-lab/validator'),
    path.join(appRoot, 'docs/cat-catch'),
  ]
  const sourceFiles = roots
    .flatMap(root => {
      try {
        return listFilesRecursively(root)
      } catch {
        return []
      }
    })
    .filter(filePath => (
      filePath.endsWith('.ts')
      || filePath.endsWith('.schema.json')
    ))
  const toolchainInputs = [
    path.join(appRoot, 'package.json'),
    path.join(appRoot, 'package-lock.json'),
    path.join(appRoot, 'tsconfig.cat-catch-tools.json'),
  ].filter(existsSync)
  const files = [...new Set([...sourceFiles, ...toolchainInputs])].sort()

  const manifest = files.map(filePath => {
    const relativePath = path.relative(appRoot, filePath)
    return `${relativePath}\0${sha256Bytes(readFileSync(filePath))}`
  }).join('\0')
  return sha256Bytes(manifest)
}

function tryReadPackageVersion(appRoot: string, packageName: string): string | null {
  const packagePath = path.join(appRoot, 'node_modules', packageName, 'package.json')
  try {
    const packageDocument: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))
    if (!packageDocument || typeof packageDocument !== 'object' || Array.isArray(packageDocument)) return null
    const version = (packageDocument as Record<string, unknown>).version
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

export function hashValidatorToolchainFingerprint(appRoot: string): string {
  return sha256Bytes(JSON.stringify({
    ajv: tryReadPackageVersion(appRoot, 'ajv'),
    ajvFormats: tryReadPackageVersion(appRoot, 'ajv-formats'),
    node: process.versions.node,
    tsx: tryReadPackageVersion(appRoot, 'tsx'),
    typescript: tryReadPackageVersion(appRoot, 'typescript'),
  }))
}
