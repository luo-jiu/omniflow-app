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

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

function runGitBuffer(cwd: string, args: string[]): Buffer {
  return execFileSync('git', args, {
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
  try {
    execFileSync('git', ['cat-file', '-e', `${objectId}^{commit}`], {
      cwd,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

export function isGitAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

export function gitCommitTouchesPath(cwd: string, commit: string, relativePath: string): boolean {
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
    return output.split('\n').includes(relativePath)
  } catch {
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
  assertRepositoryRelativePath(relativePath)
  try {
    return runGitBuffer(cwd, ['cat-file', 'blob', `${commit}:${relativePath}`])
  } catch {
    return null
  }
}

export function listDirtyTrackedPaths(cwd: string): string[] {
  const output = runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=no'])
  if (!output) return []
  return output.split('\n').map(line => line.slice(3).trim()).filter(Boolean).sort()
}

function listTrackedPaths(cwd: string): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
  })
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
