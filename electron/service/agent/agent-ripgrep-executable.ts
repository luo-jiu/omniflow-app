import { resolveDesktopRipgrepExecutable, type DesktopRipgrepLocation } from '../../platform/ripgrepExecutable';

let cached: { key: string; executable: string | null; expiresAt: number } | undefined;
/** Main-only bundled lookup. No shell, PATH dependency, package script or runtime download. */
export async function resolveAgentRipgrepExecutable(location?: DesktopRipgrepLocation): Promise<string | null> {
  if (!location) {
    const app = process.versions.electron ? (await import('electron')).app : undefined;
    location = { platform: process.platform, architecture: process.arch,
      appPath: app?.getAppPath() ?? process.env.APP_ROOT ?? process.cwd(),
      resourcesPath: process.resourcesPath, isPackaged: app?.isPackaged ?? false };
  }
  const key = JSON.stringify(location);
  if (cached?.key === key && cached.expiresAt > Date.now()) return cached.executable;
  const executable = await resolveDesktopRipgrepExecutable(location);
  cached = { key, executable, expiresAt: Date.now() + (executable ? 10_000 : 1_000) };
  return executable;
}
