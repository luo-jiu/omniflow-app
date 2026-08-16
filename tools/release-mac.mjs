import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const IDENTITY_NAME = 'OmniFlow Local Update';
const CREDENTIAL_SERVICE = 'com.loyce.omniflow.local-signing';
const REMOTE_HOST = 'omniflow-cn';
const REMOTE_DIRECTORY = '/srv/omniflow/desktop-updates/stable/mac-arm64';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} exited with status ${result.status}`);
}

function readUpdateBaseUrl() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) fail('.env.local is required for a release build.');
  const match = /^VITE_UPDATE_BASE_URL=(.+)$/m.exec(readFileSync(envPath, 'utf8'));
  if (!match) fail('VITE_UPDATE_BASE_URL is missing from .env.local.');
  const value = match[1].trim().replace(/^['"]|['"]$/g, '');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`Invalid VITE_UPDATE_BASE_URL: ${value}`);
  }
  if (parsed.protocol !== 'https:') fail('Release update feeds must use HTTPS.');
  return parsed.toString();
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

async function readPublishedVersion(updateBaseUrl) {
  const manifestUrl = new URL('latest-mac.yml', updateBaseUrl);
  let response;
  try {
    response = await fetch(manifestUrl);
  } catch (error) {
    fail(`Unable to read the current update manifest: ${error.message}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) fail(`Update manifest returned HTTP ${response.status}.`);
  const match = /^version:\s*([^\s]+)\s*$/m.exec(await response.text());
  if (!match || !VERSION_PATTERN.test(match[1])) {
    fail('The published update manifest has an invalid version.');
  }
  return match[1];
}

const args = process.argv.slice(2);
const version = args.find(arg => !arg.startsWith('--'));
const publish = args.includes('--publish');
const unexpected = args.filter(arg => arg !== version && arg !== '--publish');

if (process.platform !== 'darwin') fail('macOS releases must be built on macOS.');
if (!version || !VERSION_PATTERN.test(version)) {
  fail('Usage: npm run release:mac -- <version> [--publish]');
}
if (unexpected.length > 0) fail(`Unknown option: ${unexpected.join(', ')}`);

const updateBaseUrl = readUpdateBaseUrl();
if (publish) {
  const publishedVersion = await readPublishedVersion(updateBaseUrl);
  if (publishedVersion && compareVersions(version, publishedVersion) <= 0) {
    fail(`Version ${publishedVersion} is already published; release a higher version.`);
  }
}
const accountName = os.userInfo().username;
const keychainPath = path.join(os.homedir(), 'Library', 'Keychains', 'omniflow-local-signing.keychain-db');
if (!existsSync(keychainPath)) {
  fail('Local signing identity is not configured. Run npm run signing:setup:mac first.');
}

let keychainPassword;
try {
  keychainPassword = execFileSync('security', [
    'find-generic-password',
    '-a', accountName,
    '-s', CREDENTIAL_SERVICE,
    '-w',
  ], { encoding: 'utf8' }).trim();
} catch {
  fail(`Unable to read ${CREDENTIAL_SERVICE} from the macOS login keychain.`);
}

const identities = execFileSync('security', [
  'find-identity', '-v', '-p', 'codesigning', keychainPath,
], { encoding: 'utf8' });
if (!identities.includes(`"${IDENTITY_NAME}"`)) {
  fail(`Signing identity is missing or invalid: ${IDENTITY_NAME}`);
}

run('security', ['unlock-keychain', '-p', keychainPassword, keychainPath]);
run('npm', ['version', version, '--no-git-tag-version', '--allow-same-version']);
run('npm', ['run', 'build:mac'], {
  env: {
    CSC_KEYCHAIN: keychainPath,
    CSC_NAME: IDENTITY_NAME,
  },
});

const releaseDirectory = path.join(process.cwd(), 'release', version);
const appPath = path.join(releaseDirectory, 'mac-arm64', 'Omniflow.app');
const manifestPath = path.join(releaseDirectory, 'latest-mac.yml');
if (!existsSync(appPath) || !existsSync(manifestPath)) {
  fail(`Expected macOS release artifacts were not generated in ${releaseDirectory}.`);
}
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

const artifacts = readdirSync(releaseDirectory)
  .filter(name => /\.(?:dmg|zip|blockmap)$/.test(name))
  .map(name => path.join(releaseDirectory, name))
  .filter(filePath => statSync(filePath).isFile());
if (!artifacts.some(filePath => filePath.endsWith('.dmg')) || !artifacts.some(filePath => filePath.endsWith('.zip'))) {
  fail('The release must contain both DMG and ZIP artifacts.');
}

if (publish) {
  run('ssh', [REMOTE_HOST, 'mkdir', '-p', REMOTE_DIRECTORY]);
  run('rsync', ['-av', ...artifacts, `${REMOTE_HOST}:${REMOTE_DIRECTORY}/`]);
  run('rsync', ['-av', manifestPath, `${REMOTE_HOST}:${REMOTE_DIRECTORY}/latest-mac.yml`]);
  run('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--output', '/dev/null',
    new URL('latest-mac.yml', updateBaseUrl).toString(),
  ]);
  const publishedVersion = await readPublishedVersion(updateBaseUrl);
  if (publishedVersion !== version) {
    fail(`Published manifest version mismatch: expected ${version}, received ${publishedVersion}.`);
  }
  console.log(`Published ${version} to ${updateBaseUrl}`);
} else {
  console.log(`Built ${version} without publishing. Add --publish after local verification.`);
}

console.log(`DMG: ${artifacts.find(filePath => filePath.endsWith('.dmg'))}`);
console.log(`Manifest: ${manifestPath}`);
