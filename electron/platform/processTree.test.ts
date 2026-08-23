import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { terminateDesktopProcessTree } from './processTree';

function childProcess(pid = 123): ChildProcess {
  return {
    kill: vi.fn(() => true),
    pid,
  } as unknown as ChildProcess;
}

describe('desktop process-tree termination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('terminates the detached process group on Unix platforms', () => {
    const child = childProcess();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    terminateDesktopProcessTree(child, {
      environment: {} as NodeJS.ProcessEnv,
      force: false,
      platform: 'darwin',
    });

    expect(kill).toHaveBeenCalledWith(-123, 'SIGTERM');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('falls back to the direct child when group or Windows helpers are unavailable', () => {
    const unixChild = childProcess();
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('missing group');
    });
    terminateDesktopProcessTree(unixChild, {
      environment: {} as NodeJS.ProcessEnv,
      force: true,
      platform: 'linux',
    });
    expect(unixChild.kill).toHaveBeenCalledWith('SIGKILL');

    const windowsChild = childProcess();
    terminateDesktopProcessTree(windowsChild, {
      environment: {} as NodeJS.ProcessEnv,
      force: false,
      platform: 'win32',
    });
    expect(windowsChild.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
