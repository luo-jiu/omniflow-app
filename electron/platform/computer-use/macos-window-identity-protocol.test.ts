import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('native AX window number binding', () => {
  it('selects confirmed exact IDs despite unreadable siblings and rejects unknown, duplicate or changed targets', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-window-identity-policy-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import Foundation
var checks = 0
func check(_ value: Bool) { checks += 1; guard value else { fatalError("Window identity check \(checks) failed") } }
let frame = Rect(x: 100, y: 100, width: 600, height: 400)
func expected(_ id: UInt32 = 11, started: Int64? = 1) -> WindowIdentity {
    WindowIdentity(windowId: id, pid: 7, processStartedAt: started, layer: 0, bounds: frame, title: "QA")
}
var identities = [1: AXWindowNumberIdentity(pid: 7, windowId: 11), 2: AXWindowNumberIdentity(pid: 7, windowId: 22)]
var frames = [1: frame, 2: frame]
var identityReads = 0
var boundsReads = 0
var unidentifiedReads = 0
func select(_ nodes: [Int] = [1, 2], target: WindowIdentity = expected()) -> Int? {
    selectExactAXWindow(nodes, expected: target, identity: { node in
        identityReads += 1; return identities[node]
    }, bounds: { node in boundsReads += 1; return frames[node] },
       unidentified: { unidentifiedReads += 1 })
}
// WebStorm-like case: two windows share PID/title/geometry. The chosen CG ID
// still resolves to exactly one AX root; array order never chooses a substitute.
check(select() == 1)
check(select([2, 1]) == 1)
check(select(target: expected(22)) == 2)
check(select([2, 1], target: expected(22)) == 2)
check(select(target: expected(33)) == nil)
check(select([]) == nil)

identities[2] = AXWindowNumberIdentity(pid: 7, windowId: 11)
boundsReads = 0
check(select() == nil)
check(boundsReads == 0)
check(select([1, 1]) == nil)
// A failed sibling does not conceal two known roots reporting the target ID.
check(select([3, 1, 2]) == nil)
identities[2] = AXWindowNumberIdentity(pid: 7, windowId: 22)

// Finder can expose desktop/hidden AX siblings without a usable window number.
// The confirmed target survives in either array order, and the read is partial.
identities[2] = nil
unidentifiedReads = 0
check(select() == 1)
check(select([2, 1]) == 1)
check(unidentifiedReads == 2)
let partialBudget = ScanBudget()
check(selectExactAXWindow([2, 1], expected: expected(), identity: { identities[$0] },
    bounds: { frames[$0] }, unidentified: { partialBudget.truncated = true }) == 1)
check(partialBudget.truncated)
identities[2] = AXWindowNumberIdentity(pid: 7, windowId: 0)
check(select() == 1)
identities[2] = AXWindowNumberIdentity(pid: 8, windowId: 22)
check(select() == 1)
identities[2] = AXWindowNumberIdentity(pid: 8, windowId: 11)
check(select() == 1)
identities[2] = AXWindowNumberIdentity(pid: 0, windowId: 11)
check(select() == 1)
identities[2] = AXWindowNumberIdentity(pid: 7, windowId: 22)
// An unreadable target still fails even when another root has identical bounds;
// no geometry is consulted without a positive exact PID + window ID match.
identities[1] = nil
boundsReads = 0
check(select() == nil)
check(boundsReads == 0)
identities[2] = nil
check(select() == nil)
check(boundsReads == 0)
identities[1] = AXWindowNumberIdentity(pid: 7, windowId: 11)
identities[2] = AXWindowNumberIdentity(pid: 7, windowId: 22)

frames[1] = nil
check(select() == nil)
frames[1] = Rect(x: 100, y: 100, width: 610, height: 400)
check(select() == nil)
frames[1] = Rect(x: .nan, y: 100, width: 600, height: 400)
check(select() == nil)
frames[1] = frame
// Unselected roots do not need their geometry read once their exact ID differs.
frames[2] = nil
check(select() == 1)
frames[2] = frame

identityReads = 0
check(select(Array(repeating: 1, count: 33)) == nil)
check(identityReads == 0)
check(select(target: expected(started: nil)) == nil)
check(select(target: expected(0)) == nil)

// The selected native element's ID/PID is reread after geometry. A matching
// rectangle cannot conceal a reference that changed its window in between.
var reads = 0
let changedID: Int? = selectExactAXWindow([1], expected: expected(), identity: { _ in
    reads += 1
    return AXWindowNumberIdentity(pid: 7, windowId: reads == 1 ? 11 : 22)
}, bounds: { _ in frame })
check(changedID == nil)
check(reads == 2)
reads = 0
let changedPID: Int? = selectExactAXWindow([1], expected: expected(), identity: { _ in
    reads += 1
    return AXWindowNumberIdentity(pid: reads == 1 ? 7 : 8, windowId: 11)
}, bounds: { _ in frame })
check(changedPID == nil)
reads = 0
let missingRecheck: Int? = selectExactAXWindow([1], expected: expected(), identity: { _ in
    reads += 1
    return reads == 1 ? AXWindowNumberIdentity(pid: 7, windowId: 11) : nil
}, bounds: { _ in frame })
check(missingRecheck == nil)
print("windowIdentityChecks=\(checks)")
`);
      const sources = ['macos-click.swift', 'macos-semantic.swift', 'macos-window-input.swift', 'macos-window-input-focus.swift', 'macos-window-input-focus-taps.swift',
        'macos-window-indicator.swift', 'macos-window-menu.swift']
        .map(name => fileURLToPath(new URL(`./${name}`, import.meta.url)));
      const binary = path.join(directory, 'window-identity-policy');
      const compiled = spawnSync('/usr/bin/xcrun', ['swiftc', ...sources, harness, '-o', binary], { encoding: 'utf8', timeout: 40_000 });
      expect(compiled.status, compiled.stderr).toBe(0);
      const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('windowIdentityChecks=35');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 55_000);
});
