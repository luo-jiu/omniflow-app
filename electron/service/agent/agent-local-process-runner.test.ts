import { describe, expect, it } from 'vitest';

import { createAgentLocalProcessRunner } from './agent-local-process-runner';

function request(
  script: string,
  controller = new AbortController(),
) {
  return {
    args: ['-e', script],
    executablePath: process.execPath,
    signal: controller.signal,
  };
}

describe('Agent local process runner', () => {
  it('passes arguments without a shell and captures both output streams', async () => {
    const runner = createAgentLocalProcessRunner();
    const result = await runner.run({
      ...request(`
        process.stdout.write(JSON.stringify(process.argv.slice(1)));
        process.stderr.write('diagnostic');
        process.exitCode = 7;
      `),
      args: [
        '-e',
        `
          process.stdout.write(JSON.stringify(process.argv.slice(1)));
          process.stderr.write('diagnostic');
          process.exitCode = 7;
        `,
        '$HOME; echo should-not-run',
      ],
    });

    expect(JSON.parse(result.stdout)).toEqual(['$HOME; echo should-not-run']);
    expect(result.stderr).toBe('diagnostic');
    expect(result.exitCode).toBe(7);
    expect(result.terminationSignal).toBeNull();
  });

  it('requires absolute executable and working-directory paths', async () => {
    const runner = createAgentLocalProcessRunner();
    await expect(runner.run({
      args: [],
      executablePath: 'ffmpeg',
      signal: new AbortController().signal,
    })).rejects.toThrow('绝对可执行文件路径');
    await expect(runner.run({
      ...request('process.exit(0)'),
      cwd: 'relative/path',
    })).rejects.toThrow('工作目录必须使用绝对路径');
  });

  it('terminates a process when cancelled', async () => {
    const controller = new AbortController();
    const runner = createAgentLocalProcessRunner();
    const running = runner.run({
      ...request('setInterval(() => undefined, 1000)', controller),
      timeoutMs: 5_000,
    });

    controller.abort();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('enforces execution timeout and output limits', async () => {
    const runner = createAgentLocalProcessRunner();
    await expect(runner.run({
      ...request('setInterval(() => undefined, 1000)'),
      timeoutMs: 20,
    })).rejects.toThrow('执行超时');
    await expect(runner.run({
      ...request(`process.stdout.write('x'.repeat(4096))`),
      maxOutputBytes: 64,
    })).rejects.toThrow('输出超过 64 字节上限');
  });

  it('enforces the configured process concurrency limit', async () => {
    const firstController = new AbortController();
    const runner = createAgentLocalProcessRunner({ maxConcurrentProcesses: 1 });
    const first = runner.run({
      ...request('setInterval(() => undefined, 1000)', firstController),
      timeoutMs: 5_000,
    });

    await expect(runner.run(request('process.exit(0)'))).rejects.toThrow('并发数已达到上限：1');
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  });
});
