import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveAgentRipgrepExecutable } from '../electron/service/agent/agent-ripgrep-executable';

const require = createRequire(import.meta.url);
const preparedBinary = process.platform === 'darwin' ? await resolveAgentRipgrepExecutable() : null;
const helper = path.resolve('build/native/computer-use/darwin-arm64/omniflow-click');
const hasHelper = process.platform === 'darwin' && await access(helper).then(() => true, () => false);

describe('macOS bundled ripgrep universal packaging', () => {
  it.skipIf(!preparedBinary || !hasHelper)('requires precise rules for both premerged resources and preserves their executable universal bytes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'omniflow-rg-universal-'));
    try {
      const { makeUniversalApp } = require('@electron/universal');
      const { createPackage } = require('@electron/asar');
      const { parse } = require('json5');
      const { build: buildPlist } = require('plist');
      const configuration = parse(await readFile(path.resolve('electron-builder.json5'), 'utf8'));
      const source = path.join(root, 'source');
      await mkdir(source);
      await writeFile(path.join(source, 'package.json'), '{"name":"universal-rg-fixture","version":"1.0.0","main":"index.js"}');
      await writeFile(path.join(source, 'index.js'), 'module.exports = {};');
      const commonAsar = path.join(root, 'common.asar');
      await createPackage(source, commonAsar);
      const apps: Record<string, string> = {};
      for (const architecture of ['x86_64', 'arm64']) {
        const app = path.join(root, `${architecture}.app`);
        apps[architecture] = app;
        const contents = path.join(app, 'Contents');
        await mkdir(path.join(contents, 'Resources/ripgrep'), { recursive: true });
        await mkdir(path.join(contents, 'Resources/computer-use'));
        await mkdir(path.join(contents, 'MacOS'));
        await writeFile(path.join(contents, 'Info.plist'), buildPlist({ CFBundleIdentifier: 'com.omniflow.rg-universal-qa',
          CFBundleExecutable: 'Fixture', CFBundleName: 'Fixture' }));
        await copyFile(commonAsar, path.join(contents, 'Resources/app.asar'));
        await copyFile(preparedBinary!, path.join(contents, 'Resources/ripgrep/rg'));
        await copyFile(helper, path.join(contents, 'Resources/computer-use/omniflow-click'));
        await copyFile(path.join(path.dirname(preparedBinary!), 'LICENSE'), path.join(contents, 'Resources/ripgrep/LICENSE'));
        // The fake app's executable is a real thin Mach-O, so universal also exercises
        // its ordinary lipo merge while the already universal resource is preserved.
        execFileSync('/usr/bin/lipo', [preparedBinary!, '-thin', architecture, '-output', path.join(contents, 'MacOS/Fixture')]);
      }
      const options = { x64AppPath: apps.x86_64, arm64AppPath: apps.arm64, outAppPath: path.join(root, 'Universal.app'),
        force: false, mergeASARs: true };
      await expect(makeUniversalApp(options)).rejects.toThrow(/same in both x64 and arm64 builds.*x64ArchFiles/s);
      await expect(makeUniversalApp({ ...options, x64ArchFiles: 'Contents/Resources/ripgrep/rg' }))
        .rejects.toThrow(/Contents\/Resources\/computer-use\/omniflow-click.*x64ArchFiles/s);
      await makeUniversalApp({ ...options, x64ArchFiles: configuration.mac.x64ArchFiles });
      const merged = path.join(options.outAppPath, 'Contents/Resources/ripgrep/rg');
      for (const [output, input] of [[merged, preparedBinary!],
        [path.join(options.outAppPath, 'Contents/Resources/computer-use/omniflow-click'), helper]]) {
        expect(execFileSync('/usr/bin/lipo', ['-archs', output], { encoding: 'utf8' }).trim().split(/\s+/).sort())
          .toEqual(['arm64', 'x86_64']);
        expect(await readFile(output)).toEqual(await readFile(input));
      }
      expect(await readFile(path.join(path.dirname(merged), 'LICENSE')))
        .toEqual(await readFile(path.join(path.dirname(preparedBinary!), 'LICENSE')));
      expect(execFileSync(merged, ['--no-config', '--engine=default', '-e', '\\p{Greek}+', '--', '-'],
        { input: '😀ΩΣ saved\n', encoding: 'utf8', env: { ...process.env, PATH: '' } })).toBe('😀ΩΣ saved\n');
      // The precise allow rule must continue rejecting other identical Mach-O files.
      for (const app of Object.values(apps)) {
        await copyFile(preparedBinary!, path.join(app, 'Contents/Resources/unrelated-rg'));
      }
      await expect(makeUniversalApp({ ...options, outAppPath: path.join(root, 'Unrelated.app'),
        x64ArchFiles: configuration.mac.x64ArchFiles })).rejects.toThrow(/Contents\/Resources\/unrelated-rg.*x64ArchFiles/s);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);
});
