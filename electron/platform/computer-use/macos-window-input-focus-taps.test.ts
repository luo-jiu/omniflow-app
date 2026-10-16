import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('native focus tap runloop lifecycle', () => {
  it('installs before ready, cancels queued work, poisons disabled taps and confirms actual thread teardown without GUI taps', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-focus-taps-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import Foundation
import CoreGraphics
import Darwin
var checks = 0
func check(_ value: Bool, _ detail: String = "") { checks += 1; guard value else { fatalError("Focus-tap check \(checks): \(detail)") } }
final class Fixture {
    let lock = NSLock()
    var ports: [CFMachPort] = []
    var enabled = Set<mach_port_t>()
    var callbacks: [(CGEventTapCallBack, UnsafeMutableRawPointer)] = []
    var installCount = 0
    var enableCount = 0
    var disableCount = 0
    var failAt = 0
    var faults = 0
    var ranQueued = false
    var callbackOnWorker = false
    func fault() { lock.lock(); faults += 1; lock.unlock() }
    func incrementQueued() { lock.lock(); ranQueued = true; lock.unlock() }
    func backend() -> WindowInputFocusTapBackend {
        WindowInputFocusTapBackend(create: { spec, callback, info in
            self.lock.lock(); self.installCount += 1; let fail = self.failAt == self.installCount; self.lock.unlock()
            if fail { return nil }
            // A fresh ordinary Mach receive port is a real runloop source but
            // never observes GUI input and requests no system permissions.
            var context = CFMachPortContext(version: 0, info: nil, retain: nil, release: nil, copyDescription: nil)
            guard let port = CFMachPortCreate(kCFAllocatorDefault, { _, _, _, _ in }, &context, nil) else { return nil }
            self.lock.lock(); self.ports.append(port); self.callbacks.append((callback, info)); self.lock.unlock()
            return port
        }, enable: { port, value in
            self.lock.lock(); defer { self.lock.unlock() }
            if value { self.enabled.insert(CFMachPortGetPort(port)); self.enableCount += 1 }
            else { self.enabled.remove(CFMachPortGetPort(port)); self.disableCount += 1 }
        }, enabled: { port in
            self.lock.lock(); defer { self.lock.unlock() }; return self.enabled.contains(CFMachPortGetPort(port))
        })
    }
}
let spec = WindowInputFocusTapSpec(pid: 123, placement: .headInsertEventTap, options: .defaultTap,
    types: [10, 11, 12], handler: { _, event in event })
do {
    let fixture = Fixture()
    let runtime = try WindowInputFocusTapThread(backend: fixture.backend(), specs: [spec], onUnsafe: fixture.fault)
    check(runtime.isHealthy && fixture.installCount == 1 && fixture.enableCount == 1, "Ready requires enabled tap")
    check(try runtime.perform { !Thread.isMainThread })
    let id = try runtime.add(WindowInputFocusTapSpec(pid: nil, placement: .tailAppendEventTap, options: .defaultTap,
        types: [21], handler: { _, event in event }))
    check(fixture.installCount == 2 && fixture.enableCount == 2)
    try runtime.remove(id); check(fixture.disableCount == 1 && !CFMachPortIsValid(fixture.ports[1]))
    try runtime.remove(id); check(fixture.disableCount == 1, "Removal is idempotent")
    check(runtime.stop() && !runtime.isHealthy)
    check(fixture.disableCount == 2 && fixture.ports.allSatisfy { !CFMachPortIsValid($0) })
    check(runtime.stop(), "Repeated stop retains actual exit acknowledgement")
    check((try? runtime.perform { 1 }) == nil)
}
do {
    let fixture = Fixture(); fixture.failAt = 2
    let runtime = try? WindowInputFocusTapThread(backend: fixture.backend(), specs: [spec, spec], onUnsafe: fixture.fault)
    check(runtime == nil && fixture.installCount == 2 && fixture.faults == 1)
    check(fixture.disableCount == 1 && fixture.ports.allSatisfy { !CFMachPortIsValid($0) }, "Partial initialization must dismantle earlier tap")
}
do {
    let fixture = Fixture(), original = fixture.backend()
    let entered = DispatchSemaphore(value: 0), leave = DispatchSemaphore(value: 0), done = DispatchSemaphore(value: 0)
    let resultLock = NSLock()
    var cleanupUnconfirmed = false
    let backend = WindowInputFocusTapBackend(create: { spec, callback, info in
        entered.signal(); _ = leave.wait(timeout: .now() + 4)
        return original.create(spec, callback, info)
    }, enable: original.enable, enabled: original.enabled)
    DispatchQueue.global().async {
        do { _ = try WindowInputFocusTapThread(backend: backend, specs: [spec], onUnsafe: fixture.fault) }
        catch WindowInputFocusTapError.cleanupUnconfirmed { resultLock.lock(); cleanupUnconfirmed = true; resultLock.unlock() }
        catch { }
        done.signal()
    }
    check(entered.wait(timeout: .now() + 1) == .success)
    check(done.wait(timeout: .now() + 2.5) == .success, "Initialization teardown is bounded")
    resultLock.lock(); let wasUnconfirmed = cleanupUnconfirmed; resultLock.unlock()
    check(wasUnconfirmed, "A live initialization thread cannot be reported as a clean rejection")
    leave.signal()
    let deadline = Date().addingTimeInterval(1)
    while Date() < deadline {
        fixture.lock.lock(); let clean = !fixture.ports.isEmpty && fixture.ports.allSatisfy { !CFMachPortIsValid($0) }; fixture.lock.unlock()
        if clean { break }; usleep(1000)
    }
    check(fixture.enableCount == 0 && fixture.ports.allSatisfy { !CFMachPortIsValid($0) }, "Late installation cannot re-enable a stopped owner")
}
do {
    let fixture = Fixture()
    let runtime = try WindowInputFocusTapThread(backend: fixture.backend(), specs: [spec], onUnsafe: fixture.fault)
    let entered = DispatchSemaphore(value: 0), leave = DispatchSemaphore(value: 0), done = DispatchSemaphore(value: 0)
    DispatchQueue.global().async {
        _ = try? runtime.perform(timeout: 1) { entered.signal(); _ = leave.wait(timeout: .now() + 1); return 1 }
        done.signal()
    }
    check(entered.wait(timeout: .now() + 1) == .success)
    let queued = try? runtime.perform(timeout: 0.02) { fixture.incrementQueued(); return 2 }
    check(queued == nil && !runtime.isHealthy && fixture.faults == 1)
    check(!runtime.stop(timeout: 0.02), "Blocked worker is not a confirmed exit")
    leave.signal(); check(done.wait(timeout: .now() + 1) == .success)
    check(runtime.stop() && !fixture.ranQueued, "Timed-out queued task may never run later")
    check(fixture.ports.allSatisfy { !CFMachPortIsValid($0) })
}
do {
    let fixture = Fixture()
    let runtime = try WindowInputFocusTapThread(backend: fixture.backend(), specs: [spec], onUnsafe: fixture.fault)
    let event = CGEvent(source: nil)!
    try runtime.perform {
        let pair = fixture.callbacks[0]
        _ = pair.0(OpaquePointer(bitPattern: 1)!, .tapDisabledByTimeout, event, pair.1)
        _ = pair.0(OpaquePointer(bitPattern: 1)!, .tapDisabledByUserInput, event, pair.1)
    }
    check(!runtime.isHealthy && fixture.faults == 1, "A disabled tap poisons the owner once and cannot be re-enabled into health")
    check((try? runtime.add(spec)) == nil)
    check(runtime.stop() && fixture.disableCount == 1)
}
do {
    let fixture = Fixture()
    let runtime = try WindowInputFocusTapThread(backend: fixture.backend(), onUnsafe: fixture.fault)
    check(runtime.isHealthy)
    for invalid in [WindowInputFocusTapSpec(pid: 0, placement: .headInsertEventTap, options: .defaultTap, types: [10], handler: { _, e in e }),
                    WindowInputFocusTapSpec(pid: nil, placement: .headInsertEventTap, options: .defaultTap, types: [10], handler: { _, e in e }),
                    WindowInputFocusTapSpec(pid: 123, placement: .headInsertEventTap, options: .defaultTap, types: [1], handler: { _, e in e }),
                    WindowInputFocusTapSpec(pid: 123, placement: .headInsertEventTap, options: .defaultTap, types: [10, 10], handler: { _, e in e })] {
        check((try? runtime.add(invalid)) == nil)
    }
    check(fixture.installCount == 0 && runtime.isHealthy, "Invalid masks do not install arbitrary GUI taps")
    check(runtime.stop())
}
print("focus-taps-ok \(checks)")
`);
      const source = fileURLToPath(new URL('./macos-window-input-focus-taps.swift', import.meta.url));
      const executable = path.join(directory, 'focus-taps');
      const compiled = spawnSync('/usr/bin/xcrun', ['swiftc', source, harness, '-o', executable], { encoding: 'utf8', timeout: 30_000 });
      expect(compiled.status, compiled.stderr).toBe(0);
      const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10_000 });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toMatch(/^focus-taps-ok \d+\s*$/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 45_000);
});
