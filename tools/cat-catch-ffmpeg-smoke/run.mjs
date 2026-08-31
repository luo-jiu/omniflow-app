import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolDirectory, '../..')
const vitestPath = path.join(projectRoot, 'node_modules/vitest/vitest.mjs')

const child = spawn(process.execPath, [
  vitestPath,
  'run',
  'electron/service/embeddedBrowserFfmpegLargeMedia.test.ts',
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    CAT_CATCH_REAL_MEDIA_STRESS: '1',
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
