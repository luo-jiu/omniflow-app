import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// These checks call pure parsing, geometry and stack policy only. They never
// create a panel, read an AX tree, capture the display or post input.
describe.skipIf(process.platform !== 'darwin')('native window indicator policy', () => {
  it('strictly binds one frozen window and keeps plans inside its actual layer and bounds', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-indicator-policy-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import Foundation
var checks = 0
func check(_ value: Bool) { checks += 1; guard value else { fatalError("Indicator check \(checks) failed") } }
let window = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: -100, y: 40, width: 760, height: 460), title: "QA")
let point = WindowInputPoint(x: -99, y: 41)
func data(_ op: String, _ extra: [String: Any] = [:], identity: [String: Any]? = nil) -> Data {
    var value: [String: Any] = ["window": identity ?? window.json, "operation": op, "point": ["x": point.x, "y": point.y]]
    for (key, valueItem) in extra { value[key] = valueItem }
    return try! JSONSerialization.data(withJSONObject: value)
}
for op in ["click", "rightClick", "doubleClick"] {
    check((try? parseWindowIndicatorRequest(data(op))) != nil)
    check((try? parseWindowIndicatorRequest(data(op, ["endPoint": ["x": 20, "y": 70]]))) == nil)
}
check((try? parseWindowIndicatorRequest(data("drag", ["endPoint": ["x": 20, "y": 70]]))) != nil)
check((try? parseWindowIndicatorRequest(data("drag"))) == nil)
check((try? parseWindowIndicatorRequest(data("drag", ["endPoint": ["x": point.x, "y": point.y]]))) == nil)
for op in ["shortcut", "scroll", "rightclick", "constructor", "", "click\n"] {
    check((try? parseWindowIndicatorRequest(data(op))) == nil)
}
for key in ["profile", "shortcut", "durationMs", "level", "pid", "topmost", "activate", "text", "command", "windowRef"] {
    check((try? parseWindowIndicatorRequest(data("click", [key: "unused"]))) == nil)
}
for invalidPoint in [["x": true, "y": 41], ["x": 660, "y": 41], ["x": -99, "y": 500],
    ["x": -101, "y": 41], ["x": -99, "y": 39], ["x": -99, "y": 41, "more": 1]] as [[String: Any]] {
    check((try? parseWindowIndicatorRequest(data("click", ["point": invalidPoint]))) == nil)
    check((try? parseWindowIndicatorRequest(data("drag", ["endPoint": invalidPoint]))) == nil)
}
for key in ["windowId", "pid", "processStartedAt", "layer", "bounds"] {
    var identity = window.json
    identity.removeValue(forKey: key)
    check((try? parseWindowIndicatorRequest(data("click", identity: identity))) == nil)
}
for (key, value) in [("pid", true), ("windowId", 0), ("layer", 1), ("processStartedAt", NSNull()),
    ("title", NSNull()), ("extra", 1)] as [(String, Any)] {
    var identity = window.json
    identity[key] = value
    check((try? parseWindowIndicatorRequest(data("click", identity: identity))) == nil)
}
check((try? parseWindowIndicatorRequest(Data("{\"operation\":\"click\",\"operation\":\"drag\"}".utf8))) == nil)
check((try? parseWindowIndicatorRequest(Data(repeating: 32, count: 4097))) == nil)

for point in [WindowInputPoint(x: -100, y: 40), WindowInputPoint(x: 659.5, y: 40),
    WindowInputPoint(x: -100, y: 499.5), WindowInputPoint(x: 659.5, y: 499.5), WindowInputPoint(x: 50.25, y: 190.25)] {
    for op in WindowIndicatorOperation.allCases {
        let end = op == .drag ? WindowInputPoint(x: 100, y: 200) : nil
        let request = WindowIndicatorRequest(window: window, operation: op, point: point, endPoint: end)
        let geometry = windowIndicatorGeometry(request, labelWidth: 100)
        check(geometry != nil && window.bounds.contains(geometry!.surface))
        check(geometry!.surface.contains(x: point.x, y: point.y))
        check(geometry!.label.map { window.bounds.contains($0) && geometry!.surface.contains($0) } == true)
        check(geometry!.label.map { !$0.contains(x: point.x, y: point.y) } == true)
        if let end = end { check(geometry!.surface.contains(x: end.x, y: end.y)) }
    }
}
let tiny = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 0, y: 0, width: 10, height: 10), title: nil)
let tinyPlan = WindowIndicatorRequest(window: tiny, operation: .click, point: WindowInputPoint(x: 0, y: 0), endPoint: nil)
check(windowIndicatorGeometry(tinyPlan, labelWidth: 100)?.label == nil)
check(windowIndicatorGeometry(tinyPlan, labelWidth: 100).map { tiny.bounds.contains($0.surface) } == true)
check(windowIndicatorGeometry(tinyPlan, labelWidth: Double.nan) == nil)
check(windowIndicatorGeometry(tinyPlan, labelWidth: 161) == nil)
let narrow = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 0, y: 0, width: 100, height: 100), title: nil)
let narrowPoint = WindowInputPoint(x: 50, y: 20)
let narrowLabel = windowIndicatorGeometry(WindowIndicatorRequest(window: narrow, operation: .click,
    point: narrowPoint, endPoint: nil), labelWidth: 56)?.label
check(narrowLabel != nil && !narrowLabel!.contains(x: narrowPoint.x, y: narrowPoint.y))
let huge = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 0, y: 0, width: 50_000, height: 50_000), title: nil)
check(windowIndicatorGeometry(WindowIndicatorRequest(window: huge, operation: .drag,
    point: WindowInputPoint(x: 1, y: 1), endPoint: WindowInputPoint(x: 49_999, y: 49_999)), labelWidth: 100) == nil)

let panelBounds = Rect(x: -99, y: 41, width: 120, height: 50)
func entry(_ id: UInt32, pid: Int32 = 456, layer: Int32 = 0, bounds: Rect = panelBounds,
    title: String? = nil, alpha: Double = 1, onScreen: Bool = true) -> WindowIndicatorStackEntry {
    WindowIndicatorStackEntry(windowId: id, pid: pid, layer: layer, bounds: bounds, title: title, alpha: alpha, onScreen: onScreen)
}
let target = entry(11, pid: 123, bounds: window.bounds, title: "QA")
let panel = entry(22)
let foreground = entry(33, pid: 999)
func safe(_ stack: [WindowIndicatorStackEntry], start: Int64? = 999, expected: WindowIdentity = window,
    pid: Int32 = 456, bounds: Rect = panelBounds) -> Bool {
    windowIndicatorStackIsSafe(stack, target: expected, targetStartedAt: start, panelId: 22, panelPID: pid, panelBounds: bounds)
}
check(safe([foreground, panel, target]))
// Windows above the target cover the visual exactly as they cover the target.
check(safe([entry(44, layer: 3), foreground, panel, target]))
check(!safe([panel, foreground, target]))
check(!safe([foreground, target, panel]))
check(!safe([foreground, panel]))
check(!safe([target]))
check(!safe([foreground, panel, panel, target]))
check(!safe([foreground, panel, target, target]))
check(!safe([foreground, panel, target], start: 1000))
check(!safe([foreground, panel, target], start: nil))
check(!safe([foreground, panel, target], pid: 123))
for badTarget in [entry(11, pid: 124, bounds: window.bounds, title: "QA"),
    entry(11, pid: 123, layer: 3, bounds: window.bounds, title: "QA"),
    entry(11, pid: 123, bounds: panelBounds, title: "QA"),
    entry(11, pid: 123, bounds: window.bounds, title: "changed"),
    entry(11, pid: 123, bounds: window.bounds, title: "QA", alpha: 0),
    entry(11, pid: 123, bounds: window.bounds, title: "QA", alpha: Double.nan),
    entry(11, pid: 123, bounds: window.bounds, title: "QA", onScreen: false)] {
    check(!safe([foreground, panel, badTarget]))
}
for badPanel in [entry(22, pid: 457), entry(22, layer: 3), entry(22, bounds: window.bounds),
    entry(22, alpha: 0), entry(22, alpha: Double.nan), entry(22, onScreen: false)] {
    check(!safe([foreground, badPanel, target]))
}
check(!safe([foreground, panel, target], bounds: Rect(x: -101, y: 41, width: 120, height: 50)))
print("indicatorPolicyChecks=\(checks)")
`);
      const sources = ['macos-click.swift', 'macos-semantic.swift', 'macos-window-input.swift', 'macos-window-indicator.swift']
        .map(name => fileURLToPath(new URL(`./${name}`, import.meta.url)));
      const binary = path.join(directory, 'indicator-policy');
      const compiled = spawnSync('/usr/bin/xcrun', ['swiftc', ...sources, harness, '-o', binary], { encoding: 'utf8', timeout: 30_000 });
      expect(compiled.status, compiled.stderr).toBe(0);
      const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/indicatorPolicyChecks=\d+/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 45_000);
});
