import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { runAgentFileDiff } from './agent-file-diff-runner';

let directory: string;
let workerUrl: URL;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'agent-diff-worker-bundle-'));
  await build({ configFile: false, logLevel: 'silent', build: { target: 'node20', outDir: directory,
    lib: { entry: path.resolve('electron/service/agent/agent-file-diff-worker.ts'), formats: ['es'], fileName: () => 'diff-worker.mjs' },
    rollupOptions: { external: ['node:worker_threads'] } } });
  workerUrl = pathToFileURL(path.join(directory, 'diff-worker.mjs'));
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe('bundled production diff worker without a GUI', () => {
  it('executes the bundled entry in a real worker and keeps multi-page Unicode output complete', async () => {
    const work = runAgentFileDiff({ before: '', after: Array.from({ length: 1200 }, (_, index) => `中文😀 ${index}`).join('\n'),
      beforeLabel: 'a/fixture', afterLabel: 'b/fixture', pageLines: 200 }, new AbortController().signal, { workerUrl });
    let mainTimerRan = false;
    await new Promise<void>(resolve => setTimeout(() => { mainTimerRan = true; resolve(); }, 0));
    const result = await work;
    expect(mainTimerRan).toBe(true); expect(result.pages.length).toBeGreaterThan(5);
    expect(result.pages.map(page => page.patch).join('')).toContain('+中文😀 1199');
    expect(result.truncated).toBe(false);
  });

  it('acknowledges cancellation only after a real worker exits', async () => {
    const controller = new AbortController();
    const work = runAgentFileDiff({ before: 'x\n'.repeat(100_000), after: 'y\n'.repeat(100_000),
      beforeLabel: 'a/fixture', afterLabel: 'b/fixture', pageLines: 200 }, controller.signal, { workerUrl });
    controller.abort(); await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  });
});
