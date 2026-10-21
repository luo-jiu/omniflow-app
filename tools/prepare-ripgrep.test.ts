import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { prepareRipgrep, readPackageArchive } = require('./prepare-ripgrep.cjs');
const prepareDesktopNative = require('./prepare-desktop-native.cjs');
const version = '1.18.0';
const roots: string[] = [];
const digest = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

function archive(platform: string, architecture: string, name = `@vscode/ripgrep-${platform}-${architecture}`) {
  const entries = { [`package/bin/${platform === 'win32' ? 'rg.exe' : 'rg'}`]: 'binary fixture',
    'package/LICENSE': 'license fixture', 'package/package.json': JSON.stringify({ name, version, os: [platform], cpu: [architecture] }) };
  const chunks: Buffer[] = [];
  for (const [file, content] of Object.entries(entries)) {
    const bytes = Buffer.from(content), header = Buffer.alloc(512);
    header.write(file); header.write(bytes.length.toString(8).padStart(11, '0'), 124); header[156] = 48;
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
async function project(platform: string, architecture: string, bytes = archive(platform, architecture)) {
  const root = await mkdtemp(path.join(tmpdir(), 'omniflow-rg-build-')); roots.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@vscode/ripgrep': version } }));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/@vscode/ripgrep': { version },
    [`node_modules/@vscode/ripgrep-${platform}-${architecture}`]: { version, integrity: digest(bytes), resolved: 'https://registry.npmjs.org/fixture.tgz' },
  } }));
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('locked ripgrep build preparation', () => {
  it('checks the locked archive before reading its binary and license', () => {
    const bytes = archive('linux', 'arm64');
    expect(readPackageArchive(bytes, digest(bytes), 'rg').get('package/LICENSE').toString()).toBe('license fixture');
    expect(() => readPackageArchive(Buffer.concat([bytes, Buffer.from('tampered')]), digest(bytes), 'rg')).toThrow('integrity');
    expect(() => readPackageArchive(bytes, digest(bytes), 'rg.exe')).toThrow('Missing');
  });
  it('prepares the requested cross-platform binary and license, reuses verified cache and repairs modified bytes', async () => {
    const bytes = archive('win32', 'x64'), root = await project('win32', 'x64', bytes);
    const download = vi.fn(async () => bytes);
    const directory = await prepareRipgrep(root, 'win32', 'x64', { download });
    expect(await readFile(path.join(directory, 'rg.exe'), 'utf8')).toBe('binary fixture');
    expect(await readFile(path.join(directory, 'LICENSE'), 'utf8')).toBe('license fixture');
    await prepareRipgrep(root, 'win32', 'x64', { download });
    expect(download).toHaveBeenCalledTimes(1);
    await writeFile(path.join(directory, 'rg.exe'), 'modified');
    await prepareRipgrep(root, 'win32', 'x64', { download });
    expect(download).toHaveBeenCalledTimes(2);
    expect(await readFile(path.join(directory, 'rg.exe'), 'utf8')).toBe('binary fixture');
  });
  it('fails on target/version mismatch or missing resources instead of accepting the host package', async () => {
    const wrong = archive('linux', 'x64', '@vscode/ripgrep-linux-arm64');
    const root = await project('linux', 'x64', wrong);
    await expect(prepareRipgrep(root, 'linux', 'x64', { download: async () => wrong })).rejects.toThrow('metadata mismatch');
    await expect(prepareRipgrep(root, 'linux', 'arm64')).rejects.toThrow('Missing exact locked');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@vscode/ripgrep': '^1.18.0' } }));
    await expect(prepareRipgrep(root, 'linux', 'x64')).rejects.toThrow('exact version');
  });
  it.skipIf(process.platform !== 'darwin')('does not publish a macOS universal binary unless both architectures verify', async () => {
    const arm = archive('darwin', 'arm64'), x64 = archive('darwin', 'x64');
    const root = await project('darwin', 'arm64', arm);
    const lockPath = path.join(root, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.packages['node_modules/@vscode/ripgrep-darwin-x64'] = { version, integrity: digest(x64), resolved: 'https://registry.npmjs.org/x64.tgz' };
    await writeFile(lockPath, JSON.stringify(lock));
    const execFileSync = vi.fn((_file: string, args: string[]) => {
      if (args.includes('-verify_arch')) throw new Error('missing x86_64 architecture');
    });
    await expect(prepareRipgrep(root, 'darwin', 'universal', { download: async (entry: { resolved: string }) =>
      entry.resolved.includes('x64') ? x64 : arm, execFileSync })).rejects.toThrow('missing x86_64');
    expect(execFileSync.mock.calls[1][1].slice(1)).toEqual(['-verify_arch', 'arm64', 'x86_64']);
    await expect(readFile(path.join(root, 'build/native/ripgrep/darwin-universal/rg'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('normalizes builder numeric architectures and preserves SQLite hook ordering and its false rebuild result', async () => {
    const calls: string[] = [];
    const prepareRipgrep = vi.fn(async (_root: string, _platform: string, architecture: string) => { calls.push(`rg:${architecture}`); });
    const prepareSQLite = vi.fn(async (context: { arch: string }) => { calls.push(`sqlite:${context.arch}`); return false; });
    for (const arch of [1, 3, 'x64', 'arm64']) {
      await expect(prepareDesktopNative({ appDir: '/fixture', platform: { nodeName: 'darwin' }, arch },
        { prepareRipgrep, prepareSQLite })).resolves.toBe(false);
    }
    expect(calls).toEqual(['rg:x64', 'sqlite:x64', 'rg:arm64', 'sqlite:arm64', 'rg:x64', 'sqlite:x64', 'rg:arm64', 'sqlite:arm64']);
    prepareRipgrep.mockRejectedValueOnce(new Error('missing locked archive'));
    await expect(prepareDesktopNative({ appDir: '/fixture', platform: { nodeName: 'darwin' }, arch: 1 },
      { prepareRipgrep, prepareSQLite })).rejects.toThrow('missing locked archive');
    expect(prepareSQLite).toHaveBeenCalledTimes(4);
  });
});
