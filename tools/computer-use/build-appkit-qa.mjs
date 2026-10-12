import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Compile only. The app is deliberately not launched, attached to an Agent or
// granted any screen/accessibility permission by this script.
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  throw new Error('The AppKit QA fixture requires macOS arm64 or x64.');
}
if (process.argv.length !== 2) throw new Error('Use: node tools/computer-use/build-appkit-qa.mjs');

const root = await mkdtemp('/tmp/omniflow-computer-qa-');
const bundle = path.join(root, 'Omniflow Computer QA.app');
const contents = path.join(bundle, 'Contents');
const executableDirectory = path.join(contents, 'MacOS');
await mkdir(executableDirectory, { recursive: true });
const executable = path.join(executableDirectory, 'OmniflowComputerQA');
const source = fileURLToPath(new URL('./appkit-qa.swift', import.meta.url));
const target = process.arch === 'arm64' ? 'arm64-apple-macosx11.0' : 'x86_64-apple-macosx11.0';
execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', 'swiftc', '-O', '-framework', 'AppKit', '-target', target,
  '-module-cache-path', path.join(root, 'swift-cache'), source, '-o', executable], { stdio: 'inherit' });
await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Omniflow Computer QA</string>
<key>CFBundleDisplayName</key><string>Omniflow Computer QA</string>
<key>CFBundleIdentifier</key><string>com.omniflow.computer-qa</string>
<key>CFBundleExecutable</key><string>OmniflowComputerQA</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
`);
console.log(JSON.stringify({ app: bundle, executable, windowTitle: 'Omniflow Computer QA', launched: false }));
