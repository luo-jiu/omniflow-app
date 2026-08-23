const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SQLITE_NAPI_VERSION = '6';
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);

module.exports = async function prepareSQLiteNative(context) {
  const platform = context.platform?.nodeName;
  const architecture = context.arch;
  if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHITECTURES.has(architecture)) {
    throw new Error(`不支持的 SQLite 打包目标：${platform || 'unknown'}/${architecture || 'unknown'}`);
  }

  const projectDir = context.appDir;
  const sqlitePackagePath = path.join(projectDir, 'node_modules', 'sqlite3', 'package.json');
  const prebuildInstallPath = path.join(projectDir, 'node_modules', 'prebuild-install', 'bin.js');
  const nativeRoot = path.join(
    projectDir,
    'build',
    'native',
    'sqlite3',
    `${platform}-${architecture}`,
  );
  const nativeBinaryPath = path.join(nativeRoot, 'build', 'Release', 'node_sqlite3.node');
  const nativeMetadataPath = path.join(nativeRoot, 'omniflow-native-metadata.json');

  if (!fs.existsSync(sqlitePackagePath) || !fs.existsSync(prebuildInstallPath)) {
    throw new Error('缺少 sqlite3 / prebuild-install 依赖，请先执行 npm install');
  }

  const sqlitePackage = JSON.parse(fs.readFileSync(sqlitePackagePath, 'utf8'));
  const expectedMetadata = {
    architecture,
    napiVersion: SQLITE_NAPI_VERSION,
    platform,
    sqliteVersion: String(sqlitePackage.version || ''),
  };
  let cachedMetadata = null;
  try {
    cachedMetadata = JSON.parse(fs.readFileSync(nativeMetadataPath, 'utf8'));
  } catch {
    // A missing or invalid marker invalidates the staged native binary.
  }
  const cacheMatches = fs.existsSync(nativeBinaryPath)
    && JSON.stringify(cachedMetadata) === JSON.stringify(expectedMetadata);

  if (!cacheMatches) {
    fs.rmSync(nativeRoot, { force: true, recursive: true });
    fs.mkdirSync(nativeRoot, { recursive: true });
    fs.copyFileSync(sqlitePackagePath, path.join(nativeRoot, 'package.json'));
    execFileSync(process.execPath, [
      prebuildInstallPath,
      '--runtime',
      'napi',
      '--target',
      SQLITE_NAPI_VERSION,
      '--platform',
      platform,
      '--arch',
      architecture,
      '--path',
      nativeRoot,
      '--force',
    ], {
      cwd: nativeRoot,
      stdio: 'inherit',
    });
    fs.writeFileSync(
      nativeMetadataPath,
      `${JSON.stringify(expectedMetadata, null, 2)}\n`,
      'utf8',
    );
  }

  if (!fs.existsSync(nativeBinaryPath)) {
    throw new Error(`SQLite 预编译二进制准备失败：${nativeBinaryPath}`);
  }

  // Native dependencies are staged explicitly below; skip electron-builder's
  // Node-version-based rebuild, which is incorrect for this N-API package.
  return false;
};
