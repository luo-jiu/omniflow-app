import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolDirectory, '../..')
const vitestPath = path.join(projectRoot, 'node_modules/vitest/vitest.mjs')
const testPaths = [
  'electron/service/embeddedBrowserHlsLocalDownloaderService.test.ts',
  'electron/service/embedded-browser/processing/dash-task.test.ts',
]
const multiGib = process.argv.includes('--multi-gib')

const child = spawn(process.execPath, [vitestPath, 'run', ...testPaths], {
  cwd: projectRoot,
  env: {
    ...process.env,
    CAT_CATCH_PROTOCOL_STRESS: multiGib ? 'multi-gib' : '1',
  },
  stdio: 'inherit',
})

const forwardSigint = () => child.kill('SIGINT')
const forwardSigterm = () => child.kill('SIGTERM')
process.once('SIGINT', forwardSigint)
process.once('SIGTERM', forwardSigterm)

child.once('exit', (code, signal) => {
  process.removeListener('SIGINT', forwardSigint)
  process.removeListener('SIGTERM', forwardSigterm)
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
