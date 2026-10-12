import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (process.platform !== 'darwin') throw new Error('后台定向输入夹具仅用于 macOS。');

// --build compiles but never launches, grants permission or posts input. --exercise
// requires an already open, covered fixture. It never activates another app.
if (mode === '--build' && process.argv.length === 3) {
  const root = await mkdtemp('/tmp/omniflow-input-qa-');
  const app = path.join(root, 'Omniflow Window Input QA.app');
  const contents = path.join(app, 'Contents');
  const bin = path.join(contents, 'MacOS');
  await mkdir(bin, { recursive: true });
  const executable = path.join(bin, 'OmniflowWindowInputQA');
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'AppKit', '-target',
    process.arch === 'arm64' ? 'arm64-apple-macosx11.0' : 'x86_64-apple-macosx11.0',
    fileURLToPath(new URL('./input-fixture.swift', import.meta.url)), '-o', executable], { stdio: 'inherit' });
  await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Omniflow Window Input QA</string>
<key>CFBundleIdentifier</key><string>com.omniflow.window-input-qa</string>
<key>CFBundleExecutable</key><string>OmniflowWindowInputQA</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>InputFixtureApplication</string>
</dict></plist>
`);
  console.log(JSON.stringify({ app, executable, state: path.join(root, 'state.json'), profile: 'appkit-fixture-v1', launched: false }));
} else if (['--exercise', '--drag', '--cancel', '--focus'].includes(mode) && process.argv.length === 4) {
  const statePath = path.resolve(process.argv[3]);
  if (!/^\/(?:private\/)?tmp\/omniflow-input-qa-[^/]+\/state\.json$/u.test(statePath)) throw new Error('仅接收本工具生成的夹具状态文件。');
  const helper = path.join(projectRoot, 'build/native/computer-use', `darwin-${process.arch}`, 'omniflow-click');
  const run = (helperMode, input) => {
    const raw = execFileSync(helper, [helperMode], { input: input ? JSON.stringify(input) : undefined, encoding: 'utf8' });
    return JSON.parse(raw);
  };
  const state = async () => JSON.parse(await readFile(statePath, 'utf8'));
  const window = run('--windows').windows.find(entry => entry.windowLabel === 'Omniflow Window Input QA');
  if (!window) throw new Error('夹具尚未打开。');
  const identity = { windowId: window.windowId, pid: window.pid, processStartedAt: window.processStartedAt,
    layer: window.layer, bounds: window.bounds, ...(window.title !== undefined ? { title: window.title } : {}) };
  const check = () => {
    const receipt = run('--window-input-check', { window: identity });
    if (!receipt.ready || receipt.profile !== 'appkit-fixture-v1') throw new Error(`夹具尚未处于后台输入资格：${receipt.reason}`);
  };
  const at = (x, y) => ({ x: identity.bounds.x + x, y: identity.bounds.y + identity.bounds.height - y });
  const poll = async predicate => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await state();
      if (predicate(current)) return current;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('接收端业务状态未达到预期；不重发输入。');
  };
  const input = (operation, extra = {}) => {
    check();
    return run('--window-input', { window: identity, profile: 'appkit-fixture-v1', operation, ...extra });
  };
  const before = await state();
  const receipts = [];
  if (mode === '--exercise') {
    receipts.push(input('rightClick', { point: at(520, 200) }));
    await poll(current => current.rightDowns === before.rightDowns + 1 && current.rightUps === before.rightUps + 1);
    receipts.push(input('doubleClick', { point: at(520, 200) }));
    await poll(current => current.doubleDowns === before.doubleDowns + 1 && current.leftUps === before.leftUps + 2);
    receipts.push(input('shortcut', { shortcut: { key: 'b', modifiers: ['command'] } }));
    await poll(current => current.shortcuts === before.shortcuts + 1);
  }
  if (mode === '--exercise' || mode === '--drag') {
    receipts.push(input('drag', { point: at(before.circle.x, before.circle.y), endPoint: at(300, 210), durationMs: 100 }));
    await poll(current => current.dragMoves > before.dragMoves && !current.tracking && Math.abs(current.circle.x - 300) < 1 && Math.abs(current.circle.y - 210) < 1);
  }
  if (mode === '--drag') {
    console.log(JSON.stringify({ profile: 'appkit-fixture-v1', mode, receipts, before, final: await state(), businessEffectsVerified: true }));
    process.exit(0);
  }
  if (mode === '--focus') {
    // Signals only tell our disposable receiver to change its own key window.
    // It orders the second window behind other apps; no app is activated.
    process.kill(identity.pid, 'SIGUSR1');
    let denied;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      denied = run('--window-input-check', { window: identity });
      if (denied.reason === 'focused_window_mismatch') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (denied?.ready !== false || denied.reason !== 'focused_window_mismatch') throw new Error('第二窗口未形成预期focus漂移拒绝。');
    process.kill(identity.pid, 'SIGUSR2');
    console.log(JSON.stringify({ profile: 'appkit-fixture-v1', mode, denied, before, final: await state(), noInputPosted: true }));
    process.exit(0);
  }

  // Stop an independent gesture after its down callback. The original trajectory
  // is never replayed. State verifies a real final mouseUp and cleared tracking.
  check();
  const afterDrag = await state();
  const child = spawn(helper, ['--window-input'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
  child.stdin.end(JSON.stringify({ window: identity, profile: 'appkit-fixture-v1', operation: 'drag',
    point: at(afterDrag.circle.x, afterDrag.circle.y), endPoint: at(480, 210), durationMs: 1000 }));
  try {
    await poll(current => current.singleDowns > afterDrag.singleDowns && current.tracking);
    child.kill('SIGTERM');
    await finished;
  } catch (error) { child.kill('SIGTERM'); await finished; throw error; }
  const cancelled = JSON.parse(output);
  if (cancelled.dispatched !== 'unknown' || cancelled.releaseSent !== true) throw new Error('取消未取得未知投递与已发送释放的独立回执。');
  const final = await poll(current => !current.tracking && current.leftUps === afterDrag.leftUps + 1);
  if (final.eventWindowNumber !== final.windowNumber || final.frontmost) throw new Error('接收窗口不一致或目标被激活。');
  console.log(JSON.stringify({ profile: 'appkit-fixture-v1', receipts, cancelled, before, final, businessEffectsVerified: true }));
} else {
  throw new Error('用法：node tools/computer-use/input-fixture-driver.mjs --build | --exercise/--drag/--cancel/--focus /tmp/omniflow-input-qa-*/state.json');
}
