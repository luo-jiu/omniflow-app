import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { sha256Bytes } from './json.ts'
import { writeCandidateArtifact } from './local-artifact.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const cliPath = path.join(appRoot, 'tools/cat-catch-lab/validator/cli.ts')
const localArtifactModuleUrl = pathToFileURL(
  path.join(appRoot, 'tools/cat-catch-lab/validator/local-artifact.ts'),
).href
const tsxPath = path.join(appRoot, 'node_modules/.bin/tsx')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function cloneRepository(): { commit: string; repository: string } {
  const parent = mkdtempSync(path.join(tmpdir(), 'cat-catch-local-closure-cli-'))
  temporaryDirectories.push(parent)
  const repository = path.join(parent, 'repository')
  execFileSync('git', ['clone', '--quiet', '--shared', appRoot, repository])
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim()
  return { commit, repository }
}

function runGenerator(repository: string, commit: string, extraArgs: string[] = []) {
  return spawnSync(tsxPath, [
    cliPath,
    'generate-local-closure',
    '--root',
    repository,
    '--commit',
    commit,
    ...extraArgs,
  ], {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  })
}

type ChildResult = {
  code: number | null
  stderr: string
  stdout: string
}

function collectChildResult(child: ReturnType<typeof spawn>): Promise<ChildResult> {
  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', chunk => { stdout += String(chunk) })
  child.stderr?.on('data', chunk => { stderr += String(chunk) })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve({ code, stderr, stdout }))
  })
}

async function waitForPaths(paths: string[], timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!paths.every(existsSync)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for: ${paths.join(', ')}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function raceArtifactWriters(
  repository: string,
  outputPath: string,
  payloads: Buffer[],
): Promise<ChildResult[]> {
  const barrierDirectory = path.join(repository, `.artifact-race-${path.basename(outputPath)}`)
  mkdirSync(barrierDirectory, { recursive: true })
  const goPath = path.join(barrierDirectory, 'go')
  const readyPaths = payloads.map((_, index) => path.join(barrierDirectory, `ready-${index}`))
  const script = `
    import { existsSync, writeFileSync } from 'node:fs'
    import { writeCandidateArtifact } from ${JSON.stringify(localArtifactModuleUrl)}
    const sleeper = new Int32Array(new SharedArrayBuffer(4))
    const appRoot = process.env.CAT_CATCH_TEST_APP_ROOT
    const outputPath = process.env.CAT_CATCH_TEST_OUTPUT_PATH
    const payload = process.env.CAT_CATCH_TEST_PAYLOAD
    const readyPath = process.env.CAT_CATCH_TEST_READY_PATH
    const goPath = process.env.CAT_CATCH_TEST_GO_PATH
    if (!appRoot || !outputPath || !payload || !readyPath || !goPath) {
      throw new Error('Artifact race fixture environment is incomplete')
    }
    writeCandidateArtifact(appRoot, outputPath, Buffer.from(payload, 'base64'), {
      beforePublish() {
        writeFileSync(readyPath, 'ready')
        while (!existsSync(goPath)) Atomics.wait(sleeper, 0, 0, 10)
      },
    })
  `
  const children = payloads.map((payload, index) => spawn(tsxPath, ['--eval', script], {
    cwd: appRoot,
    env: {
      ...process.env,
      CAT_CATCH_TEST_APP_ROOT: repository,
      CAT_CATCH_TEST_GO_PATH: goPath,
      CAT_CATCH_TEST_OUTPUT_PATH: outputPath,
      CAT_CATCH_TEST_PAYLOAD: payload.toString('base64'),
      CAT_CATCH_TEST_READY_PATH: readyPaths[index],
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
  const results = children.map(collectChildResult)
  try {
    await waitForPaths(readyPaths)
  } finally {
    writeFileSync(goPath, 'go')
  }
  return Promise.all(results)
}

describe('Cat Catch local-closure CLI', () => {
  it('writes canonical bytes to a default content-addressed artifact', () => {
    const { commit, repository } = cloneRepository()
    const result = runGenerator(repository, commit, ['--json'])
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout) as { status: string }
    expect(report.status).toBe('blocked')

    const outputDirectory = path.join(
      repository,
      'tools/cat-catch-lab/artifacts/local-closure',
    )
    const outputFiles = readdirSync(outputDirectory)
    expect(outputFiles).toHaveLength(1)
    const outputBytes = readFileSync(path.join(outputDirectory, outputFiles[0] || ''))
    expect(JSON.parse(outputBytes.toString('utf8'))).toEqual(report)
    expect(outputFiles[0]).toBe(`${sha256Bytes(outputBytes).slice('sha256:'.length)}.json`)
    expect(() => execFileSync('git', [
      'check-ignore',
      '--quiet',
      path.relative(repository, path.join(outputDirectory, outputFiles[0] || '')),
    ], { cwd: repository })).not.toThrow()
  })

  it('rejects missing and abbreviated commits without writing an artifact', () => {
    const { commit, repository } = cloneRepository()
    const missing = spawnSync(tsxPath, [
      cliPath,
      'generate-local-closure',
      '--root',
      repository,
    ], {
      cwd: appRoot,
      encoding: 'utf8',
    })
    expect(missing.status).toBe(2)

    const abbreviated = runGenerator(repository, commit.slice(0, 12))
    expect(abbreviated.status).toBe(2)
    expect(existsSync(path.join(repository, 'tools/cat-catch-lab/artifacts'))).toBe(false)
  })

  it('rejects source, report-index, and symlink-escaping output paths', () => {
    const { commit, repository } = cloneRepository()
    const packagePath = path.join(repository, 'package.json')
    const packageBytes = readFileSync(packagePath)
    const newSourcePath = path.join(repository, 'outside-local-closure.json')

    const sourceOutput = runGenerator(repository, commit, ['--output', 'outside-local-closure.json'])
    expect(sourceOutput.status).toBe(2)
    expect(existsSync(newSourcePath)).toBe(false)
    expect(readFileSync(packagePath)).toEqual(packageBytes)

    const reportIndexPath = path.join(
      repository,
      'docs/cat-catch/report-index/local-closure.json',
    )
    const reportIndexOutput = runGenerator(repository, commit, [
      '--output',
      'docs/cat-catch/report-index/local-closure.json',
    ])
    expect(reportIndexOutput.status).toBe(2)
    expect(reportIndexOutput.stderr).toContain('must not be written to docs/cat-catch/report-index')
    expect(existsSync(reportIndexPath)).toBe(false)

    const artifactRoot = path.join(repository, 'tools/cat-catch-lab/artifacts')
    mkdirSync(artifactRoot, { recursive: true })
    symlinkSync(repository, path.join(artifactRoot, 'escape'))
    const symlinkOutput = runGenerator(repository, commit, [
      '--output',
      'tools/cat-catch-lab/artifacts/escape/package.json',
    ])
    expect(symlinkOutput.status).toBe(2)
    expect(readFileSync(packagePath)).toEqual(packageBytes)
  })

  it('reuses identical artifact bytes without rewriting the file', () => {
    const { repository } = cloneRepository()
    const outputPath = path.join(
      repository,
      'tools/cat-catch-lab/artifacts/manual/local-closure.json',
    )
    const canonicalBytes = Buffer.from('{"status":"blocked"}')

    writeCandidateArtifact(repository, outputPath, canonicalBytes)
    const fixedTimestamp = new Date('2000-01-01T00:00:00.000Z')
    utimesSync(outputPath, fixedTimestamp, fixedTimestamp)
    const firstStat = lstatSync(outputPath)
    writeCandidateArtifact(repository, outputPath, canonicalBytes)
    const secondStat = lstatSync(outputPath)

    expect(readFileSync(outputPath)).toEqual(canonicalBytes)
    expect(secondStat.ino).toBe(firstStat.ino)
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs)
    expect(readdirSync(path.dirname(outputPath)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('refuses to overwrite a local artifact with different canonical bytes', () => {
    const { commit, repository } = cloneRepository()
    const output = 'tools/cat-catch-lab/artifacts/manual/local-closure.json'
    const first = runGenerator(repository, commit, ['--output', output])
    expect(first.status).toBe(1)
    const outputPath = path.join(repository, output)
    const firstBytes = readFileSync(outputPath)

    const second = runGenerator(repository, commit, ['--output', output])
    expect(second.status).toBe(2)
    expect(second.stderr).toContain('Refusing to overwrite an artifact with different bytes')
    expect(readFileSync(outputPath)).toEqual(firstBytes)
  })

  it('publishes concurrent artifacts without overwriting or leaking temporary files', async () => {
    const { repository } = cloneRepository()
    const sameOutputPath = path.join(
      repository,
      'tools/cat-catch-lab/artifacts/race/same.json',
    )
    const sameBytes = Buffer.from('{"status":"same"}')
    const sameResults = await raceArtifactWriters(
      repository,
      sameOutputPath,
      [sameBytes, sameBytes],
    )
    expect(sameResults.map(result => result.code)).toEqual([0, 0])
    expect(sameResults.map(result => result.stderr)).toEqual(['', ''])
    expect(readFileSync(sameOutputPath)).toEqual(sameBytes)
    expect(readdirSync(path.dirname(sameOutputPath)).filter(name => name.endsWith('.tmp'))).toEqual([])

    const differentOutputPath = path.join(
      repository,
      'tools/cat-catch-lab/artifacts/race/different.json',
    )
    const firstBytes = Buffer.from('{"status":"first"}')
    const secondBytes = Buffer.from('{"status":"second"}')
    const differentResults = await raceArtifactWriters(
      repository,
      differentOutputPath,
      [firstBytes, secondBytes],
    )
    expect(differentResults.filter(result => result.code === 0)).toHaveLength(1)
    expect(differentResults.filter(result => result.code !== 0)).toHaveLength(1)
    const publishedBytes = readFileSync(differentOutputPath)
    expect(publishedBytes.equals(firstBytes) || publishedBytes.equals(secondBytes)).toBe(true)
    expect(readdirSync(path.dirname(differentOutputPath)).filter(name => name.endsWith('.tmp'))).toEqual([])
  }, 30_000)
})
