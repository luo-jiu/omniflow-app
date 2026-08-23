import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

interface TerminateDesktopProcessTreeOptions {
  environment: NodeJS.ProcessEnv;
  force: boolean;
  platform?: NodeJS.Platform;
}

function terminateWindowsProcessTree(
  child: ChildProcess,
  options: TerminateDesktopProcessTreeOptions,
): void {
  if (!child.pid) return;
  const systemRoot = options.environment.SystemRoot || options.environment.WINDIR;
  if (!systemRoot) {
    child.kill(options.force ? 'SIGKILL' : 'SIGTERM');
    return;
  }
  const taskkill = spawn(
    path.win32.join(systemRoot, 'System32', 'taskkill.exe'),
    ['/PID', String(child.pid), '/T', ...(options.force ? ['/F'] : [])],
    {
      env: options.environment,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    child.kill(options.force ? 'SIGKILL' : 'SIGTERM');
  };
  taskkill.once('error', fallback);
  taskkill.once('close', (exitCode) => {
    if (exitCode !== 0) fallback();
  });
  taskkill.unref();
}

export function terminateDesktopProcessTree(
  child: ChildProcess,
  options: TerminateDesktopProcessTreeOptions,
): void {
  if (!child.pid) return;
  const platform = options.platform || process.platform;
  if (platform === 'win32') {
    terminateWindowsProcessTree(child, options);
    return;
  }
  try {
    process.kill(-child.pid, options.force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    child.kill(options.force ? 'SIGKILL' : 'SIGTERM');
  }
}
