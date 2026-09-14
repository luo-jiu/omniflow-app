import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPackagePath, loadPluginPackage, parsePluginManifest } from './manifest';
import manifest from '../../../samples/csv-viewer/manifest.json';
const roots: string[] = [];
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'plugin-manifest-test-')); roots.push(root); await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest)); await writeFile(path.join(root, 'index.html'), '<p>test</p>'); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('plugin manifest and package', () => {
  it.each(['../secret', '/absolute', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a?b', 'a#b', 'a%20b', 'NUL.js', 'dir/con', 'trailing.'])('rejects unsafe package path %s', value => { expect(isPackagePath(value)).toBe(false); });
  it('validates host/platform/schema/version/activation/permissions', () => {
    expect(parsePluginManifest(manifest, 'darwin').id).toBe('example.csv');
    for (const patch of [{ sdkVersion: 2 }, { formatVersion: 2 }, { minHostVersion: '100.0.0' }, { entry: '../outside.html' }, { permissions: ['shell'] }, { activation: ['viewer:other'] }, { viewers: [...manifest.viewers, ...manifest.viewers] }, { token: 'extra-field' }]) expect(() => parsePluginManifest({ ...manifest, ...patch }, 'darwin')).toThrow();
    expect(() => parsePluginManifest(manifest, 'unsupported')).toThrow();
  });
  it('includes file boundaries and lengths in the package fingerprint', async () => {
    const first = await fixture(); const second = await fixture();
    await writeFile(path.join(first,'a.png'),Buffer.from('Xb.png\0Y'));
    await writeFile(path.join(second,'a.png'),'X'); await writeFile(path.join(second,'b.png'),'Y');
    expect((await loadPluginPackage(first,'darwin')).fingerprint).not.toBe((await loadPluginPackage(second,'darwin')).fingerprint);
  });
  it('snapshots package bytes independently of subsequent edits', async () => {
    const root = await fixture(); const loaded = await loadPluginPackage(root, 'darwin');
    await writeFile(path.join(root, 'index.html'), '<p>changed</p>');
    expect(loaded.assets.get('index.html')?.bytes.toString()).toBe('<p>test</p>');
    expect((await loadPluginPackage(root, 'darwin')).fingerprint).not.toBe(loaded.fingerprint);
  });
  it('rejects symlinks and unsupported/oversized assets', async () => {
    const root = await fixture(); await symlink(path.join(root, 'index.html'), path.join(root, 'link.html'));
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/symlink/);
    await rm(path.join(root, 'link.html')); await writeFile(path.join(root, 'native.node'), 'no');
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/Unsupported/);
    await rm(path.join(root, 'native.node')); await writeFile(path.join(root, 'huge.js'), Buffer.alloc(1048577));
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/oversized/);
  });
  it('rejects empty directory floods and unsafe SVG', async () => {
    const root = await fixture(); await writeFile(path.join(root, 'unsafe.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/Unsafe SVG/);
    await rm(path.join(root, 'unsafe.svg'));
    await Promise.all(Array.from({ length: 129 }, (_, i) => mkdir(path.join(root, `empty${i}`))));
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/entry limit/);
  });
});
