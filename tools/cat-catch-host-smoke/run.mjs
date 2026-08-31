import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const RESULT_PREFIX = 'OMNIFLOW_CAT_CATCH_HOST_SMOKE_RESULT='
const verifySystemSaveDialog = process.argv.includes('--save-dialog')
const verifyLargeMedia = process.argv.includes('--large-media')
if (verifySystemSaveDialog && verifyLargeMedia) {
  throw new Error('--save-dialog and --large-media cannot be combined')
}
const LARGE_MEDIA_FIXTURE_BYTES = 64 * 1024 * 1024
const PROCESS_TIMEOUT_MS = verifySystemSaveDialog ? 180_000 : verifyLargeMedia ? 120_000 : 30_000
const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const electronExecutable = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
)

async function runElectron(entryPath, environment) {
  return await new Promise((resolve, reject) => {
    const child = spawn(electronExecutable, [entryPath], {
      cwd: projectRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Electron host smoke timed out after ${PROCESS_TIMEOUT_MS}ms`))
    }, PROCESS_TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
      if (verifySystemSaveDialog) process.stderr.write(chunk)
    })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stderr, stdout })
    })
  })
}

const tempRootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-cat-catch-host-smoke-'))
try {
  const bundledEntryPath = path.join(tempRootPath, 'main.cjs')
  const outputRootPath = path.join(tempRootPath, 'output')
  const preloadPath = path.join(tempRootPath, 'preload.cjs')
  const userDataPath = path.join(tempRootPath, 'user-data')
  await Promise.all([
    mkdir(outputRootPath, { recursive: true }),
    mkdir(userDataPath, { recursive: true }),
    writeFile(preloadPath, `
      const { contextBridge, ipcRenderer } = require('electron')
      contextBridge.exposeInMainWorld('hostSmoke', {
        pickSavePath: (defaultPath) => (
          ipcRenderer.invoke('dialog:save-download-file', defaultPath, {
            filters: [{ name: 'Text File', extensions: ['txt'] }],
          })
        ),
        saveStagedDownload: (stagedPath, targetPath) => (
          ipcRenderer.invoke('fs:save-staged-download-file', stagedPath, targetPath)
        ),
      })
    `, 'utf8'),
  ])
  await build({
    bundle: true,
    entryPoints: [path.join(projectRoot, 'tools/cat-catch-host-smoke/main.ts')],
    external: ['electron'],
    format: 'cjs',
    logLevel: 'silent',
    outfile: bundledEntryPath,
    platform: 'node',
    target: 'node20',
  })

  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  environment.NODE_ENV = 'production'
  environment.OMNIFLOW_CAT_CATCH_SMOKE_OUTPUT_ROOT = outputRootPath
  environment.OMNIFLOW_CAT_CATCH_SMOKE_PRELOAD = preloadPath
  environment.OMNIFLOW_CAT_CATCH_SMOKE_FIXTURE_BYTES = String(LARGE_MEDIA_FIXTURE_BYTES)
  environment.OMNIFLOW_CAT_CATCH_SMOKE_LARGE_MEDIA = verifyLargeMedia ? '1' : '0'
  environment.OMNIFLOW_CAT_CATCH_SMOKE_SAVE_DIALOG = verifySystemSaveDialog ? '1' : '0'
  environment.OMNIFLOW_CAT_CATCH_SMOKE_USER_DATA = userDataPath
  const result = await runElectron(bundledEntryPath, environment)
  const resultLine = result.stdout
    .split(/\r?\n/)
    .find(line => line.startsWith(RESULT_PREFIX))
  if (result.code !== 0 || !resultLine) {
    throw new Error([
      `Electron host smoke failed (code=${result.code}, signal=${result.signal || 'none'})`,
      result.stderr.trim(),
      result.stdout.trim(),
    ].filter(Boolean).join('\n'))
  }
  const payload = JSON.parse(resultLine.slice(RESULT_PREFIX.length))
  process.stdout.write(`Cat Catch Electron host smoke passed: ${JSON.stringify(payload)}\n`)
} finally {
  await rm(tempRootPath, { force: true, recursive: true })
}
