// Compile only: this entry never launches a GUI app or posts input.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertNodeSupervisor } from './safe-fixture-launcher.mjs';

assertNodeSupervisor();
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  throw new Error('The native menu fixture requires macOS arm64 or x64.');
}
const root = await mkdtemp('/tmp/omniflow-menu-qa-');
const bundle = path.join(root, 'Omniflow Native Menu QA.app');
const contents = path.join(bundle, 'Contents');
const executableDirectory = path.join(contents, 'MacOS');
await mkdir(executableDirectory, { recursive: true, mode: 0o700 });
const executable = path.join(executableDirectory, 'OmniflowNativeMenuQA');
execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'AppKit', '-target',
  process.arch === 'arm64' ? 'arm64-apple-macosx11.0' : 'x86_64-apple-macosx11.0',
  fileURLToPath(new URL('./menu-fixture.swift', import.meta.url)), '-o', executable], { stdio: 'inherit' });
await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Omniflow Native Menu QA</string>
<key>CFBundleIdentifier</key><string>com.omniflow.menu-qa</string>
<key>CFBundleExecutable</key><string>OmniflowNativeMenuQA</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`, { mode: 0o600 });
console.log(JSON.stringify({ root, bundle, executable, state: path.join(root, 'state.json'),
  windowTitle: 'Omniflow Native Menu QA', bundleIdentifier: 'com.omniflow.menu-qa',
  inputProfile: null, maxDurationMs: 45_000, launched: false }));
