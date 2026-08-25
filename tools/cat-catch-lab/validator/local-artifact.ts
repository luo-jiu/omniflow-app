import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

export const LOCAL_ARTIFACTS_RELATIVE_PATH = 'tools/cat-catch-lab/artifacts'

type CandidateArtifactWriteHooks = {
  beforePublish?: () => void
}

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
}

export function resolveLocalArtifactRoot(appRoot: string): string {
  return path.resolve(appRoot, LOCAL_ARTIFACTS_RELATIVE_PATH)
}

function prepareArtifactParent(appRoot: string, artifactRoot: string, outputPath: string): void {
  const realAppRoot = realpathSync(appRoot)
  const labRoot = path.join(appRoot, 'tools/cat-catch-lab')
  const expectedRealLabRoot = path.join(realAppRoot, 'tools/cat-catch-lab')
  if (realpathSync(labRoot) !== expectedRealLabRoot) {
    throw new Error('Cat Catch Lab path must not traverse a symbolic link')
  }
  if (existsSync(artifactRoot) && lstatSync(artifactRoot).isSymbolicLink()) {
    throw new Error('Cat Catch artifact root must not be a symbolic link')
  }
  mkdirSync(artifactRoot, { recursive: true })
  if (realpathSync(artifactRoot) !== path.join(realAppRoot, LOCAL_ARTIFACTS_RELATIVE_PATH)) {
    throw new Error('Cat Catch artifact root resolves outside the target app root')
  }

  const outputParent = path.dirname(outputPath)
  const relativeParent = path.relative(artifactRoot, outputParent)
  let existingParent = artifactRoot
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    existingParent = path.join(existingParent, segment)
    if (!existsSync(existingParent)) break
    const stat = lstatSync(existingParent)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Artifact output parent is not a regular directory: ${existingParent}`)
    }
  }
  mkdirSync(outputParent, { recursive: true })
  const realArtifactRoot = realpathSync(artifactRoot)
  const realOutputParent = realpathSync(outputParent)
  if (realOutputParent !== realArtifactRoot && !isPathInside(realArtifactRoot, realOutputParent)) {
    throw new Error('Artifact output path resolves outside the local artifact root')
  }
}

export function writeCandidateArtifact(
  appRoot: string,
  outputPath: string,
  canonicalBytes: Buffer,
  hooks: CandidateArtifactWriteHooks = {},
): void {
  const artifactRoot = resolveLocalArtifactRoot(appRoot)
  const resolvedOutputPath = path.resolve(outputPath)
  if (!isPathInside(artifactRoot, resolvedOutputPath)) {
    throw new Error(`Artifact output must be below the local artifact root: ${resolvedOutputPath}`)
  }
  prepareArtifactParent(appRoot, artifactRoot, resolvedOutputPath)

  const reuseExisting = (): void => {
    const stat = lstatSync(resolvedOutputPath)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Artifact output is not a regular file: ${resolvedOutputPath}`)
    }
    if (!readFileSync(resolvedOutputPath).equals(canonicalBytes)) {
      throw new Error(`Refusing to overwrite an artifact with different bytes: ${resolvedOutputPath}`)
    }
  }

  if (existsSync(resolvedOutputPath)) {
    reuseExisting()
    return
  }

  const temporaryPath = path.join(
    path.dirname(resolvedOutputPath),
    `.${path.basename(resolvedOutputPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let fileDescriptor: number | null = null
  try {
    fileDescriptor = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(fileDescriptor, canonicalBytes)
    fsyncSync(fileDescriptor)
    closeSync(fileDescriptor)
    fileDescriptor = null
    hooks.beforePublish?.()
    try {
      linkSync(temporaryPath, resolvedOutputPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      reuseExisting()
    }
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor)
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
}
