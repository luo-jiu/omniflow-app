import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolDirectory, '../..')
const vitestPath = path.join(projectRoot, 'node_modules/vitest/vitest.mjs')
const durationArgument = process.argv.find(argument => argument.startsWith('--duration-ms='))
const durationMs = durationArgument?.slice('--duration-ms='.length) || '300000'

const child = spawn(process.execPath, [
  vitestPath,
  'run',
  'electron/service/embeddedBrowserLiveWallClock.test.ts',
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    CAT_CATCH_LIVE_WALL_CLOCK: '1',
    CAT_CATCH_LIVE_WALL_CLOCK_MS: durationMs,
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
