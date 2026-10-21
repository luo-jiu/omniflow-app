const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');

const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Read only the three expected regular files; never extract archive paths to disk.
function readPackageArchive(archive, integrity, binaryName) {
  if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(integrity)
    || `sha512-${createHash('sha512').update(archive).digest('base64')}` !== integrity) {
    throw new Error('ripgrep npm archive integrity mismatch');
  }
  const tar = gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 });
  const expected = new Set([`package/bin/${binaryName}`, 'package/LICENSE', 'package/package.json']);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid ripgrep npm archive size');
    const size = Number.parseInt(sizeText, 8);
    if (offset + 512 + size > tar.length) throw new Error('Truncated ripgrep npm archive');
    if (expected.has(name)) {
      if (![0, 48].includes(header[156]) || files.has(name)) throw new Error('Invalid ripgrep npm archive entry');
      files.set(name, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (files.size !== expected.size) throw new Error('Missing ripgrep binary, license or package metadata');
  return files;
}

async function downloadLockedArchive(entry) {
  const url = new URL(entry.resolved);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error('Unexpected ripgrep npm registry');
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_ARCHIVE_BYTES) {
    throw new Error(`Cannot download locked ripgrep archive: HTTP ${response.status}`);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_ARCHIVE_BYTES) throw new Error('ripgrep npm archive exceeds build budget');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function stageSlice(projectRoot, platform, architecture, version, lock, download) {
  const packageName = `@vscode/ripgrep-${platform}-${architecture}`;
  const entry = lock.packages[`node_modules/${packageName}`];
  if (entry?.version !== version || !entry.integrity || !entry.resolved) throw new Error(`Missing exact locked ${packageName}`);
  const binaryName = platform === 'win32' ? 'rg.exe' : 'rg';
  const directory = path.join(projectRoot, 'build/native/ripgrep', `${platform}-${architecture}`);
  const markerPath = path.join(directory, 'build.json');
  try {
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    const binary = await fs.readFile(path.join(directory, binaryName));
    const license = await fs.readFile(path.join(directory, 'LICENSE'));
    if (marker.version === version && marker.integrity === entry.integrity
      && marker.binaryHash === sha256(binary) && marker.licenseHash === sha256(license)) {
      await fs.chmod(path.join(directory, binaryName), 0o755);
      return { directory, binaryName, marker };
    }
  } catch { /* Missing or changed resources must be rebuilt from the locked archive. */ }
  const files = readPackageArchive(await download(entry), entry.integrity, binaryName);
  const metadata = JSON.parse(files.get('package/package.json').toString('utf8'));
  if (metadata.name !== packageName || metadata.version !== version
    || !metadata.os?.includes(platform) || !metadata.cpu?.includes(architecture)) throw new Error('ripgrep target metadata mismatch');
  const binary = files.get(`package/bin/${binaryName}`), license = files.get('package/LICENSE');
  const marker = { version, integrity: entry.integrity, binaryHash: sha256(binary), licenseHash: sha256(license) };
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, binaryName), binary, { mode: 0o755 });
  await fs.chmod(path.join(directory, binaryName), 0o755);
  await fs.writeFile(path.join(directory, 'LICENSE'), license);
  await fs.writeFile(markerPath, `${JSON.stringify(marker)}\n`);
  return { directory, binaryName, marker };
}

async function prepareRipgrep(projectRoot, platform = process.platform, architecture = process.arch, dependencies = {}) {
  if (platform === 'darwin' && architecture === 'universal') architecture = 'arm64';
  if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHITECTURES.has(architecture)) {
    throw new Error(`Unsupported ripgrep build target: ${platform}/${architecture}`);
  }
  const metadata = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const version = metadata.devDependencies?.['@vscode/ripgrep'];
  const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || lock.packages['node_modules/@vscode/ripgrep']?.version !== version) {
    throw new Error('ripgrep must have an exact version in package.json and package-lock.json');
  }
  const download = dependencies.download ?? downloadLockedArchive;
  const slice = await stageSlice(projectRoot, platform, architecture, version, lock, download);
  // Both macOS app builds copy this same verified universal resource. electron-builder
  // can merge its arm64/x64 apps without mistaking an arm64 resource for universal.
  if (platform === 'darwin') {
    if (process.platform !== 'darwin') throw new Error('macOS ripgrep universal preparation requires macOS lipo');
    const other = await stageSlice(projectRoot, platform, architecture === 'arm64' ? 'x64' : 'arm64', version, lock, download);
    const directory = path.join(projectRoot, 'build/native/ripgrep/darwin-universal');
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, 'rg');
    const slices = [slice, other].sort((a, b) => a.directory.localeCompare(b.directory));
    // Slice inputs live separately from the immutable universal resource output.
    (dependencies.execFileSync ?? execFileSync)('/usr/bin/lipo', ['-create', ...slices.map(item => path.join(item.directory, 'rg')), '-output', `${target}.next`]);
    (dependencies.execFileSync ?? execFileSync)('/usr/bin/lipo', [`${target}.next`, '-verify_arch', 'arm64', 'x86_64']);
    await fs.chmod(`${target}.next`, 0o755);
    await fs.rename(`${target}.next`, target);
    await fs.copyFile(path.join(slice.directory, 'LICENSE'), path.join(directory, 'LICENSE'));
    return directory;
  }
  return slice.directory;
}

module.exports = { prepareRipgrep, readPackageArchive };
if (require.main === module) {
  prepareRipgrep(path.resolve(__dirname, '..'), process.argv[2], process.argv[3])
    .then(directory => console.log(`[ripgrep] Prepared locked resources: ${directory}`))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
