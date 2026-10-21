import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getDesktopRipgrepPath, resolveDesktopRipgrepExecutable } from './ripgrepExecutable';
import { resolveAgentRipgrepExecutable } from '../service/agent/agent-ripgrep-executable';

const preparedBundle = await resolveAgentRipgrepExecutable();

describe('bundled ripgrep resource location', () => {
  it('keeps executable outside app.asar and shares the verified universal macOS resource', () => {
    const packaged = { platform: 'darwin' as const, architecture: 'arm64', appPath: '/OmniFlow.app/Contents/Resources/app.asar',
      resourcesPath: '/OmniFlow.app/Contents/Resources', isPackaged: true };
    expect(getDesktopRipgrepPath(packaged)).toBe('/OmniFlow.app/Contents/Resources/ripgrep/rg');
    expect(getDesktopRipgrepPath({ ...packaged, architecture: 'x64' })).toBe(getDesktopRipgrepPath(packaged));
    expect(getDesktopRipgrepPath({ ...packaged, isPackaged: false, appPath: '/source' }))
      .toBe('/source/build/native/ripgrep/darwin-universal/rg');
    expect(getDesktopRipgrepPath({ ...packaged, resourcesPath: undefined })).toBeNull();
  });
  it('uses platform separators and rejects unsupported or relative locations', () => {
    expect(getDesktopRipgrepPath({ platform: 'win32', architecture: 'x64', appPath: 'C:\\source', isPackaged: true,
      resourcesPath: 'C:\\OmniFlow\\resources' })).toBe('C:\\OmniFlow\\resources\\ripgrep\\rg.exe');
    expect(getDesktopRipgrepPath({ platform: 'linux', architecture: 'arm64', appPath: '/source', isPackaged: false }))
      .toBe('/source/build/native/ripgrep/linux-arm64/rg');
    expect(getDesktopRipgrepPath({ platform: 'linux', architecture: 'ia32', appPath: '/source', isPackaged: false })).toBeNull();
    expect(getDesktopRipgrepPath({ platform: 'linux', architecture: 'x64', appPath: 'relative', isPackaged: false })).toBeNull();
  });
  it('returns missing instead of consulting PATH; requires an executable ordinary resource', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'omniflow-rg-resource-'));
    try {
      const location = { platform: process.platform, architecture: process.arch, appPath: path.join(root, 'app.asar'),
        resourcesPath: root, isPackaged: true };
      const binary = getDesktopRipgrepPath(location)!;
      expect(await resolveDesktopRipgrepExecutable(location)).toBeNull();
      await mkdir(path.dirname(binary), { recursive: true });
      await writeFile(binary, 'fixture', { mode: 0o755 });
      expect(await resolveDesktopRipgrepExecutable(location)).toBe(binary);
      await rm(binary);
      await mkdir(binary);
      expect(await resolveDesktopRipgrepExecutable(location)).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.skipIf(!preparedBundle)('runs the real bundle beside app.asar, including both macOS slices', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'omniflow-rg-asar-'));
    try {
      const source = path.join(root, 'source'), resources = path.join(root, 'Resources');
      await mkdir(source); await mkdir(path.join(resources, 'ripgrep'), { recursive: true });
      await writeFile(path.join(source, 'package.json'), '{"name":"resource-layout-fixture"}');
      const { createPackage } = createRequire(import.meta.url)('@electron/asar');
      const appPath = path.join(resources, 'app.asar');
      await createPackage(source, appPath);
      const binary = path.join(resources, 'ripgrep', process.platform === 'win32' ? 'rg.exe' : 'rg');
      await copyFile(preparedBundle!, binary);
      const executable = await resolveAgentRipgrepExecutable({ platform: process.platform, architecture: process.arch,
        appPath, resourcesPath: resources, isPackaged: true });
      expect(executable).toBe(binary);
      expect(execFileSync(executable!, ['--no-config', '--engine=default', '-e', '\\p{Greek}+', '--', '-'],
        { input: '😀ΩΣ saved\n', encoding: 'utf8', env: { ...process.env, PATH: '' } })).toBe('😀ΩΣ saved\n');
      if (process.platform === 'darwin') {
        expect(execFileSync('/usr/bin/lipo', ['-archs', executable!], { encoding: 'utf8' }).trim().split(/\s+/).sort())
          .toEqual(['arm64', 'x86_64']);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
