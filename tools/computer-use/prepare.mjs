import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('[computer-use] Native click helper is only built on macOS.');
  process.exit(0);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePaths = ['macos-click.swift', 'macos-semantic.swift', 'macos-window-input.swift', 'macos-window-indicator.swift', 'main.swift']
  .map(name => path.join(projectRoot, 'electron/platform/computer-use', name));
const outputRoot = path.join(projectRoot, 'build/native/computer-use');
const binaryName = 'omniflow-click';
const targetArchitectures = ['arm64', 'x64'];
const manifestPath = path.join(outputRoot, 'build.json');
const compileArgs = ['-O', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics'];
const sourceHash = createHash('sha256');
for (const sourcePath of sourcePaths) {
  sourceHash.update(path.basename(sourcePath)).update(await readFile(sourcePath));
}
const fingerprint = sourceHash
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(JSON.stringify(compileArgs))
  .digest('hex');

let previousBuild;
try {
  previousBuild = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  previousBuild = null;
}

const outputsReady = previousBuild?.fingerprint === fingerprint
  && (await Promise.all(targetArchitectures.map(async (architecture) => {
    try {
      const file = await stat(path.join(outputRoot, `darwin-${architecture}`, binaryName));
      return file.isFile() && file.size > 0 && (file.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }))).every(Boolean);

if (outputsReady) {
  console.log('[computer-use] Native click helper is up to date.');
  process.exit(0);
}

const temporaryRoot = path.join(outputRoot, `.prepare-${process.pid}`);
await mkdir(temporaryRoot, { recursive: true });
try {
  const sdkPath = execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  const slices = [];
  for (const [architecture, target] of [['arm64', 'arm64-apple-macosx11.0'], ['x64', 'x86_64-apple-macosx11.0']]) {
    const slice = path.join(temporaryRoot, `${binaryName}-${architecture}`);
    execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', 'swiftc', ...compileArgs, '-sdk', sdkPath, '-target', target, ...sourcePaths, '-o', slice], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    slices.push(slice);
  }
  const universalBinary = path.join(temporaryRoot, binaryName);
  execFileSync('/usr/bin/lipo', ['-create', ...slices, '-output', universalBinary], { stdio: 'inherit' });
  await chmod(universalBinary, 0o755);
  for (const architecture of targetArchitectures) {
    const directory = path.join(outputRoot, `darwin-${architecture}`);
    await mkdir(directory, { recursive: true });
    const nextPath = path.join(directory, `${binaryName}.next`);
    await cp(universalBinary, nextPath);
    await rename(nextPath, path.join(directory, binaryName));
  }
  await writeFile(manifestPath, `${JSON.stringify({ fingerprint, architectures: targetArchitectures })}\n`);
  console.log('[computer-use] Built universal macOS click helper.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
