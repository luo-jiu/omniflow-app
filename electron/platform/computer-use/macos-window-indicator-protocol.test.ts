import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// These checks call pure parsing, stream framing, bounded event-drain, geometry and ordering recovery policy only. They never
// create a panel, read an AX tree, capture the display or post input.
describe.skipIf(process.platform !== 'darwin')('native window indicator policy', () => {
  it('separates a stable visual attachment from exact approved updates and keeps a small safe surface', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-indicator-policy-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import AppKit
import Foundation
var checks = 0
func check(_ value: Bool, line: UInt = #line) { checks += 1; guard value else { fatalError("Indicator check \(checks) failed at line \(line)") } }
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

// A visual color is a six-digit RGB value, never CSS/executable content or an
// input permission. Missing color retains the fixed theme fallback.
check(windowIndicatorAccentRGB(nil) == windowIndicatorAccentRGB("#5a9e7c"))
check(windowIndicatorAccentRGB("#000000") == WindowIndicatorRGB(red: 0, green: 0, blue: 0))
check(windowIndicatorAccentRGB("#FFFFFF") == WindowIndicatorRGB(red: 1, green: 1, blue: 1))
check(windowIndicatorAccentRGB("#AABBCC") == windowIndicatorAccentRGB("#aabbcc"))
for color in ["#000000", "#FFFFFF", "#5a9e7c", "#AAbbCc"] {
    for op in ["click", "rightClick", "doubleClick"] {
        check((try? parseWindowIndicatorRequest(data(op, ["accentColor": color])))?.accentColor == color)
    }
    check((try? parseWindowIndicatorRequest(data("drag", ["accentColor": color, "endPoint": ["x": 20, "y": 70]])))?.accentColor == color)
}
for color in [NSNull(), true, 123456, [:], "#fff", "5a9e7c", "#12345678", "#12345g", " #123456",
    "#123456\n", "red", "rgb(1,2,3)", "var(--primary-color)", "#１２３４５６"] as [Any] {
    check((try? parseWindowIndicatorRequest(data("click", ["accentColor": color]))) == nil)
    check((try? windowIndicatorUpdate(data("click", ["accentColor": color]), frozenWindow: window)) == nil)
}
check((try? windowIndicatorUpdate(data("click", ["accentColor": "#AABBCC"]), frozenWindow: window))?.accentColor == "#AABBCC")
let validColorBase = String(decoding: data("click"), as: UTF8.self)
let duplicateColor = Data((String(validColorBase.dropLast()) + ",\"accentColor\":\"#000000\",\"accentColor\":\"#ffffff\"}").utf8)
check((try? parseWindowIndicatorRequest(duplicateColor)) == nil)

// A heartbeat has no request/ACK. Nonempty updates retain every identity field;
// another point/operation can change without changing the shared target.
check((try? windowIndicatorUpdate(Data(), frozenWindow: window)) == nil)
for op in ["click", "rightClick", "doubleClick"] {
    check((try? windowIndicatorUpdate(data(op, ["point": ["x": 50, "y": 100]]), frozenWindow: window))?.point == WindowInputPoint(x: 50, y: 100))
}
check((try? windowIndicatorUpdate(data("drag", ["endPoint": ["x": 20, "y": 70]]), frozenWindow: window))?.operation == .drag)
for (key, value) in [("windowId", 12), ("pid", 124), ("processStartedAt", 1000), ("layer", 1),
    ("title", "Other"), ("bounds", Rect(x: -99, y: 40, width: 760, height: 460).json),
    ("bounds", Rect(x: -100, y: 41, width: 760, height: 460).json),
    ("bounds", Rect(x: -100, y: 40, width: 761, height: 460).json),
    ("bounds", Rect(x: -100, y: 40, width: 760, height: 461).json)] as [(String, Any)] {
    var changed = window.json; changed[key] = value
    check((try? windowIndicatorUpdate(data("click", identity: changed), frozenWindow: window)) == nil)
}
var missingTitle = window.json; missingTitle.removeValue(forKey: "title")
check((try? windowIndicatorUpdate(data("click", identity: missingTitle), frozenWindow: window)) == nil)
for bad in [Data(" ".utf8), Data("\r".utf8), Data([255]), Data("{}".utf8), data("click", ["activate": true])] {
    check((try? windowIndicatorUpdate(bad, frozenWindow: window)) == nil)
}
check(windowIndicatorSameWindow(window, window))
let untitled = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: window.bounds, title: nil)
check(windowIndicatorSameWindow(untitled, untitled))
check(!windowIndicatorSameWindow(window, untitled))

// Reads can divide JSON anywhere or combine requests with heartbeats. Partial
// data is retained without losing a later frame or permitting an oversized one.
let clickLine = data("click")
let doubleLine = data("doubleClick")
var combined = clickLine; combined.append(10); combined.append(10)
combined.append(doubleLine); combined.append(10); combined.append(Data("partial".utf8))
var framing = WindowIndicatorLineBuffer()
let combinedLines = try! framing.append(combined)
check(combinedLines.count == 3 && combinedLines[0] == clickLine && combinedLines[1].isEmpty && combinedLines[2] == doubleLine)
check((try! framing.append(Data("-tail\n".utf8))) == [Data("partial-tail".utf8)])
check((try! framing.append(Data())).isEmpty)
var fragmented = WindowIndicatorLineBuffer()
for byte in clickLine { check((try! fragmented.append(Data([byte]))).isEmpty) }
check((try! fragmented.append(Data([10]))) == [clickLine])
var maximum = WindowIndicatorLineBuffer()
for _ in 0..<4 { check((try! maximum.append(Data(repeating: 32, count: 1024))).isEmpty) }
check((try! maximum.append(Data([10]))).first?.count == 4096)
var oversized = WindowIndicatorLineBuffer()
for _ in 0..<4 { _ = try! oversized.append(Data(repeating: 32, count: 1024)) }
check((try? oversized.append(Data([32]))) == nil)
var oversizedRead = WindowIndicatorLineBuffer()
check((try? oversizedRead.append(Data(repeating: 32, count: 1025))) == nil)
var heartbeatFlood = WindowIndicatorLineBuffer()
check((try! heartbeatFlood.append(Data(repeating: 10, count: 64))).count == 64)
check((try? heartbeatFlood.append(Data(repeating: 10, count: 65))) == nil)

// A continuously nonempty event queue cannot starve protocol/identity checks.
// Exercise the production drain driver with fake events; its AppKit adapter
// is never invoked, so this test does not create or activate an application.
var dequeuedEvents = 0
var sentEvents: [Int] = []
var updates = 0
windowIndicatorDrainEvents(deadline: 100, now: { 0 }, cancelled: { false }, next: { remaining in
    check(remaining == 100)
    dequeuedEvents += 1
    return dequeuedEvents
}, send: { sentEvents.append($0) }, update: { updates += 1 })
check(dequeuedEvents == 64 && sentEvents == Array(1...64) && updates == 1)
// A silent queue waits at most the caller's remaining slice, then updates
// windows once. An expired slice must not dequeue or send another event.
dequeuedEvents = 0; sentEvents = []; updates = 0
windowIndicatorDrainEvents(deadline: 100, now: { 25 }, cancelled: { false }, next: { remaining -> Int? in
    check(remaining == 75); dequeuedEvents += 1; return nil
}, send: { sentEvents.append($0) }, update: { updates += 1 })
check(dequeuedEvents == 1 && sentEvents.isEmpty && updates == 1)
windowIndicatorDrainEvents(deadline: 100, now: { 100 }, cancelled: { false }, next: { _ -> Int? in
    fatalError("Expired pump dequeued an event")
}, send: { _ in fatalError("Expired pump sent an event") }, update: { updates += 1 })
check(updates == 2)
// Time advancing while events are available stops at the deadline, without
// discarding a dequeued event. Cancellation also stops an ongoing flood.
var clock: UInt64 = 0
sentEvents = []; updates = 0
windowIndicatorDrainEvents(deadline: 20, now: { clock }, cancelled: { false }, next: { remaining in
    check(remaining == 20 || remaining == 10); return 1
}, send: { sentEvents.append($0); clock += 10 }, update: { updates += 1 })
check(sentEvents == [1, 1] && clock == 20 && updates == 1)
sentEvents = []; updates = 0
windowIndicatorDrainEvents(deadline: 100, now: { 0 }, cancelled: { sentEvents.count == 2 },
    next: { _ in 1 }, send: { sentEvents.append($0) }, update: { updates += 1 })
check(sentEvents == [1, 1] && updates == 1)
windowIndicatorDrainEvents(deadline: 100, now: { 0 }, cancelled: { true }, next: { _ -> Int? in
    fatalError("Cancelled pump dequeued an event")
}, send: { _ in fatalError("Cancelled pump sent an event") }, update: { updates += 1 })
check(updates == 2)

// Exact tip, all four body mirrors and a fractional point. The complete
// bounded glow surface stays within the frozen window without moving the tip.
for (point, sx, sy) in [
    (WindowInputPoint(x: -93, y: 47), 1.0, 1.0),
    (WindowInputPoint(x: 653, y: 47), -1.0, 1.0),
    (WindowInputPoint(x: -93, y: 493), 1.0, -1.0),
    (WindowInputPoint(x: 653, y: 493), -1.0, -1.0),
    (WindowInputPoint(x: 50.25, y: 190.25), 1.0, 1.0)
] {
    for op in WindowIndicatorOperation.allCases {
        let end = op == .drag ? WindowInputPoint(x: 100, y: 200) : nil
        let request = WindowIndicatorRequest(window: window, operation: op, point: point, endPoint: end)
        guard let geometry = windowIndicatorGeometry(request) else { fatalError("Safe arrow declined") }
        check(window.bounds.contains(geometry.surface))
        check(geometry.surface.contains(x: point.x, y: point.y))
        check(geometry.surface.contains(x: geometry.displayPoint.x, y: geometry.displayPoint.y))
        check(geometry.displayPoint == point)
        check(geometry.xDirection == sx && geometry.yDirection == sy)
        check(geometry.surface.width <= 36 && geometry.surface.height <= 36)
        let arrow = windowIndicatorArrowPath(geometry)
        // Path construction is pure: no drawing/window/capture. The widest
        // stroke and glow shrink with the body, while the already certified
        // 35/36-point surface and exact action hotspot remain unchanged.
        let painted = arrow.bounds.insetBy(dx: -3.975, dy: -3.975)
        check(painted.minX >= 0 && painted.minY >= 0)
        check(painted.maxX <= geometry.surface.width && painted.maxY <= geometry.surface.height)
        var hotspot = [NSPoint](repeating: .zero, count: 3)
        let first = hotspot.withUnsafeMutableBufferPointer { arrow.element(at: 0, associatedPoints: $0.baseAddress!) }
        check(first == .moveTo)
        check(hotspot[0].x + geometry.surface.x == point.x && hotspot[0].y + geometry.surface.y == point.y)
        var vertex = [NSPoint](repeating: .zero, count: 3)
        let body = vertex.withUnsafeMutableBufferPointer { arrow.element(at: 2, associatedPoints: $0.baseAddress!) }
        check(body == .lineTo)
        check(vertex[0].x + geometry.surface.x == point.x + 14.25 * sx)
        check(vertex[0].y + geometry.surface.y == point.y + 4.5 * sy)
    }
}
// A point whose outline would cross a window edge is not clamped or clipped.
for point in [WindowInputPoint(x: -100, y: 40), WindowInputPoint(x: 659.5, y: 40),
    WindowInputPoint(x: -100, y: 499.5), WindowInputPoint(x: 659.5, y: 499.5),
    WindowInputPoint(x: -93.01, y: 200), WindowInputPoint(x: 653.01, y: 200),
    WindowInputPoint(x: 100, y: 46.99), WindowInputPoint(x: 100, y: 493.01)] {
    for op in WindowIndicatorOperation.allCases {
        check(windowIndicatorGeometry(WindowIndicatorRequest(window: window, operation: op, point: point,
            endPoint: op == .drag ? WindowInputPoint(x: 100, y: 200) : nil)) == nil)
    }
}
let tiny = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 0, y: 0, width: 10, height: 10), title: nil)
let tinyPlan = WindowIndicatorRequest(window: tiny, operation: .click, point: WindowInputPoint(x: 0, y: 0), endPoint: nil)
check(windowIndicatorGeometry(tinyPlan) == nil)
check(windowIndicatorGeometry(WindowIndicatorRequest(window: tiny, operation: .click,
    point: WindowInputPoint(x: -1, y: 0), endPoint: nil)) == nil)
let narrow = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 0, y: 0, width: 100, height: 100), title: nil)
let narrowPoint = WindowInputPoint(x: 50, y: 20)
let narrowArrow = windowIndicatorGeometry(WindowIndicatorRequest(window: narrow, operation: .click,
    point: narrowPoint, endPoint: nil))
check(narrowArrow?.surface.contains(x: narrowPoint.x, y: narrowPoint.y) == true)
check(narrowArrow?.displayPoint == narrowPoint)
let huge = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 0, y: 0, width: 50_000, height: 50_000), title: nil)
let hugeArrow = windowIndicatorGeometry(WindowIndicatorRequest(window: huge, operation: .drag,
    point: WindowInputPoint(x: 100, y: 100), endPoint: WindowInputPoint(x: 49_999, y: 49_999)))
check(hugeArrow.map { $0.surface.width <= 36 && $0.surface.height <= 36 } == true)
check(hugeArrow?.surface.contains(x: 49_999, y: 49_999) == false)

let geometryWindow = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 309, y: 103, width: 673, height: 439), title: "QA")
for (start, end) in [
    (WindowInputPoint(x: 318, y: 156), WindowInputPoint(x: 490, y: 156)),
    (WindowInputPoint(x: 490, y: 156), WindowInputPoint(x: 318, y: 156)),
    (WindowInputPoint(x: 318.99, y: 156.99), WindowInputPoint(x: 490.99, y: 156.99)),
    (WindowInputPoint(x: 318, y: 156), WindowInputPoint(x: 318, y: 400)),
    (WindowInputPoint(x: 400, y: 250), WindowInputPoint(x: 450, y: 300))
] {
    let plan = WindowIndicatorRequest(window: geometryWindow, operation: .drag, point: start, endPoint: end)
    let geometry = windowIndicatorGeometry(plan)
    check(geometry != nil && geometryWindow.bounds.contains(geometry!.surface))
    check(geometry!.displayPoint == start)
    // A long drag keeps the same small, exact tip as a click at its start.
    let click = windowIndicatorGeometry(WindowIndicatorRequest(window: geometryWindow,
        operation: .click, point: start, endPoint: nil))!
    check(geometry!.surface == click.surface)
    check(geometry!.xDirection == click.xDirection && geometry!.yDirection == click.yDirection)
    check(plan.point == start && plan.endPoint == end)
}
let diagonal = windowIndicatorGeometry(WindowIndicatorRequest(window: geometryWindow,
    operation: .drag, point: WindowInputPoint(x: 400, y: 250), endPoint: WindowInputPoint(x: 450, y: 300)))!
check(diagonal.xDirection == 1 && diagonal.yDirection == 1)
// Bounds alone can decline a visual, including a drag starting at the corner.
check(windowIndicatorGeometry(WindowIndicatorRequest(window: geometryWindow, operation: .drag,
    point: WindowInputPoint(x: 309, y: 103), endPoint: WindowInputPoint(x: 500, y: 294))) == nil)

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
// Non-overlapping title-bar attachments can sit between the normal panel and
// target. The same proof applies to other applications, never PID alone.
let accessoryBounds = Rect(x: 300, y: 46, width: 66, height: 20)
for pid in [Int32(123), 456, 999] {
    check(safe([foreground, panel, entry(55, pid: pid, bounds: accessoryBounds), target]))
    check(!safe([foreground, panel, entry(55, pid: pid), target]))
    // Reject intersection with the whole panel surface, including an area
    // that does not contain the arrow hotspot.
    check(!safe([foreground, panel,
        entry(55, pid: pid, bounds: Rect(x: 20.5, y: 90.5, width: 1, height: 1)), target]))
}
check(safe([foreground, panel, entry(55, pid: 123, bounds: accessoryBounds),
    entry(56, pid: 999, bounds: Rect(x: -99, y: 100, width: 120, height: 20)), target]))
check(!safe([foreground, panel, entry(55, pid: 123, bounds: accessoryBounds), entry(56), target]))
// Rect intersection treats touching edges and corners as disjoint, including
// negative display origins; any positive intersection still hides the plan.
for touching in [Rect(x: 21, y: 41, width: 66, height: 20),
    Rect(x: -99, y: 91, width: 120, height: 20),
    Rect(x: -199, y: 41, width: 100, height: 50),
    Rect(x: -99, y: -9, width: 120, height: 50),
    Rect(x: 21, y: 91, width: 20, height: 20)] {
    check(safe([foreground, panel, entry(55, bounds: touching), target]))
}
check(!safe([foreground, panel,
    entry(55, bounds: Rect(x: -199, y: 41, width: 100.01, height: 50)), target]))
// Missing or invalid geometric proof cannot be treated as "no intersection".
for invalid in [Rect(x: Double.nan, y: 46, width: 66, height: 20),
    Rect(x: 300, y: Double.infinity, width: 66, height: 20),
    Rect(x: 300, y: 46, width: 0, height: 20),
    Rect(x: 300, y: 46, width: -66, height: 20),
    Rect(x: 300, y: 46, width: 66, height: Double.nan),
    Rect(x: 300, y: 46, width: 66, height: Double.infinity),
    Rect(x: 10_000_001, y: 46, width: 66, height: 20),
    Rect(x: 300, y: 46, width: 100_001, height: 20)] {
    check(!safe([foreground, panel, entry(55, bounds: invalid), target]))
    check(!safe([foreground, entry(22, bounds: invalid), target], bounds: invalid))
}
for invalid in [entry(0, bounds: accessoryBounds), entry(55, pid: 0, bounds: accessoryBounds),
    entry(55, pid: -1, bounds: accessoryBounds), entry(55, layer: 3, bounds: accessoryBounds),
    entry(55, layer: -1, bounds: accessoryBounds), entry(55, bounds: accessoryBounds, onScreen: false)] {
    check(!safe([foreground, panel, invalid, target]))
}
for alpha in [0, -0.1, 1.01, Double.nan, Double.infinity] {
    check(!safe([foreground, panel, entry(55, bounds: accessoryBounds, alpha: alpha), target]))
}
let accessory = entry(55, bounds: accessoryBounds)
check(!safe([foreground, panel, accessory, accessory, target]))
check(!safe(Array(repeating: foreground, count: 4095) + [panel, target]))
// Real TextEdit GUI regression: its 66x20 title-bar surface sits above the
// main window but never intersects the frozen 231x44 action plan surface.
let textEditWindow = WindowIdentity(windowId: 314, pid: 6966, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 309, y: 103, width: 673, height: 439), title: "QA")
let textEditPanelBounds = Rect(x: 315, y: 149, width: 231, height: 44)
let textEditTarget = entry(314, pid: 6966, bounds: textEditWindow.bounds, title: "QA")
let textEditPanel = entry(448, pid: 8574, bounds: textEditPanelBounds)
let textEditAccessory = entry(426, pid: 6966, bounds: Rect(x: 315, y: 109, width: 66, height: 20))
check(windowIndicatorStackIsSafe([textEditPanel, textEditAccessory, textEditTarget],
    target: textEditWindow, targetStartedAt: 999, panelId: 448, panelPID: 8574, panelBounds: textEditPanelBounds))
check(!windowIndicatorStackIsSafe([textEditPanel,
    entry(426, pid: 6966, bounds: Rect(x: 315, y: 149, width: 66, height: 20)), textEditTarget],
    target: textEditWindow, targetStartedAt: 999, panelId: 448, panelPID: 8574, panelBounds: textEditPanelBounds))
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
    entry(11, pid: 123, bounds: window.bounds, title: "QA", alpha: 1.01),
    entry(11, pid: 123, bounds: window.bounds, title: "QA", alpha: Double.nan),
    entry(11, pid: 123, bounds: window.bounds, title: "QA", onScreen: false)] {
    check(!safe([foreground, panel, badTarget]))
}
for badPanel in [entry(22, pid: 457), entry(22, layer: 3), entry(22, bounds: window.bounds),
    entry(22, alpha: 0), entry(22, alpha: 1.01), entry(22, alpha: Double.nan), entry(22, onScreen: false)] {
    check(!safe([foreground, badPanel, target]))
}
check(!safe([foreground, panel, target], bounds: Rect(x: -101, y: 41, width: 120, height: 50)))

// A nonactivating target reorder is recoverable only with complete, unchanged
// target/panel identity and normal, known metadata for every crossed window.
func orderState(_ stack: [WindowIndicatorStackEntry], start: Int64? = 999) -> WindowIndicatorReason {
    windowIndicatorStackState(stack, target: window, targetStartedAt: start,
        panelId: 22, panelPID: 456, panelBounds: panelBounds)
}
check(orderState([foreground, panel, target]) == .safe)
check(orderState([foreground, target, panel]) == .orderChanged)
check(orderState([target, foreground, panel]) == .orderChanged)
check(orderState([panel, foreground, target]) == .orderChanged)
check(orderState([panel, accessory, target]) == .safe)
check(orderState([target, accessory, panel]) == .orderChanged)
// A high-level window wholly above both surfaces need not be crossed. A high
// or unknown surface between them must not authorize relative ordering.
check(orderState([entry(44, layer: 3), target, panel]) == .orderChanged)
for malformed in [entry(0), entry(55, pid: 0), entry(55, layer: 3), entry(55, layer: -1),
    entry(55, bounds: Rect(x: Double.nan, y: 46, width: 66, height: 20)),
    entry(55, bounds: Rect(x: 300, y: 46, width: 0, height: 20)),
    entry(55, alpha: 0), entry(55, alpha: Double.nan), entry(55, onScreen: false)] {
    check(orderState([target, malformed, panel]) == .metadataInvalid)
    check(orderState([panel, malformed, target]) == .metadataInvalid)
}
check(orderState([target, accessory, accessory, panel]) == .metadataInvalid)
check(orderState([target, target, panel]) == .metadataInvalid)
check(orderState([target, panel, panel]) == .metadataInvalid)
check(orderState([panel]) == .targetUnavailable)
check(orderState([target]) == .panelUnavailable)
check(orderState([target, panel], start: nil) == .identityInvalid)
check(orderState([target, panel], start: 1000) == .identityInvalid)
for changedTarget in [entry(11, pid: 124, bounds: window.bounds, title: "QA"),
    entry(11, pid: 123, bounds: panelBounds, title: "QA"),
    entry(11, pid: 123, layer: 1, bounds: window.bounds, title: "QA"),
    entry(11, pid: 123, bounds: window.bounds, title: "other"),
    entry(11, pid: 123, bounds: window.bounds, title: "QA", alpha: 0),
    entry(11, pid: 123, bounds: window.bounds, title: "QA", onScreen: false)] {
    check(orderState([changedTarget, panel]) == .targetChanged)
    // A temporarily hidden owned panel cannot conceal a target failure.
    check(orderState([changedTarget]) == .targetChanged)
}
for changedPanel in [entry(22, pid: 457), entry(22, layer: 1), entry(22, bounds: window.bounds),
    entry(22, alpha: 0), entry(22, onScreen: false)] {
    check(orderState([target, changedPanel]) == .panelChanged)
}

// Four repairs per rolling second. A denied fifth attempt does not extend
// the window, and a backward monotonic sample fails closed.
var repairBudget = WindowIndicatorRepairBudget()
for _ in 0..<4 { check(repairBudget.reserve(now: 0)) }
check(!repairBudget.reserve(now: 0))
check(!repairBudget.reserve(now: 999_999_999))
check(repairBudget.reserve(now: 1_000_000_000))
check(!repairBudget.reserve(now: 999_999_999))
for _ in 0..<3 { check(repairBudget.reserve(now: 1_000_000_000)) }
check(!repairBudget.reserve(now: 1_999_999_999))
check(repairBudget.reserve(now: 2_000_000_000))
var rollingBudget = WindowIndicatorRepairBudget()
let rollingTimes: [UInt64] = [0, 250_000_000, 500_000_000, 750_000_000]
for stamp in rollingTimes { check(rollingBudget.reserve(now: stamp)) }
check(!rollingBudget.reserve(now: 999_999_999))
check(rollingBudget.reserve(now: 1_000_000_000))
check(!rollingBudget.reserve(now: 1_249_999_999))
check(rollingBudget.reserve(now: 1_250_000_000))

// Transparent registration is bounded at 150ms and pumps at most 5ms per
// slice. Same-window metadata/parent/display/focus failures cannot be retried.
var repairClock: UInt64 = 0
var repairStates: [WindowIndicatorReason] = [.panelUnavailable, .orderChanged, .safe]
var repairPumps: [UInt64] = []
var repairForeground: Int32? = 999
let repairSuccess = windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { repairClock }, foreground: { repairForeground }, state: { repairStates.removeFirst() }, pump: { end in
        check(end - repairClock <= 5_000_000 && end <= 150_000_000)
        repairPumps.append(end); repairClock = end
    })
check(repairSuccess == .safe && repairStates.isEmpty && repairPumps == [5_000_000, 10_000_000])
// Even an immediately safe snapshot is flushed through the owned AppKit
// queue before its post-order proof can authorize visible color again.
repairClock = 0; repairPumps = []
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { repairClock }, foreground: { 999 }, state: { .safe }, pump: { end in
        repairPumps.append(end); repairClock = end
    }) == .safe)
check(repairPumps == [5_000_000])
for failure in [WindowIndicatorReason.identityInvalid, .targetUnavailable, .targetChanged, .panelChanged,
    .metadataInvalid, .cancelled, .parentChanged, .displayChanged, .panelFocused, .helperFrontmost] {
    repairClock = 0; repairPumps = []
    let result = windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
        now: { repairClock }, foreground: { 999 }, state: { failure },
        pump: { repairPumps.append($0) })
    check(result == failure && repairPumps.isEmpty)
}
repairClock = 0; repairPumps = []
let noRegistration = windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { repairClock }, foreground: { 999 }, state: { .panelUnavailable }, pump: { end in
        check(end - repairClock <= 5_000_000 && end <= 150_000_000)
        repairPumps.append(end); repairClock = end
    })
check(noRegistration == .repairTimedOut && repairClock == 150_000_000 && repairPumps.count == 30)
// A safe result at the deadline is too late. Revalidation cannot extend the
// bound, and no event is pumped after it expires.
repairClock = 0; repairPumps = []
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { repairClock }, foreground: { 999 }, state: { repairClock = 150_000_000; return .safe },
    pump: { repairPumps.append($0) }) == .repairTimedOut)
check(repairPumps.isEmpty)
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { 150_000_000 }, foreground: { 999 }, state: { fatalError("Expired recovery checked state") },
    pump: { _ in fatalError("Expired recovery pumped events") }) == .repairTimedOut)
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: nil,
    now: { 0 }, foreground: { nil }, state: { fatalError("Unknown foreground checked state") },
    pump: { _ in fatalError("Unknown foreground pumped events") }) == .foregroundUnknown)
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 0,
    now: { 0 }, foreground: { 0 }, state: { fatalError("Invalid foreground checked state") },
    pump: { _ in fatalError("Invalid foreground pumped events") }) == .foregroundUnknown)
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { 0 }, foreground: { 888 }, state: { .safe },
    pump: { _ in fatalError("Foreground change pumped events") }) == .foregroundChanged)
repairClock = 0; repairForeground = 999; repairPumps = []
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { repairClock }, foreground: { repairForeground }, state: { .orderChanged }, pump: { end in
        repairPumps.append(end); repairClock = end; repairForeground = nil
    }) == .foregroundChanged)
check(repairPumps == [5_000_000])
// Small remaining slices stop at the original bound; no 5ms overshoot.
repairClock = 149_000_000; repairPumps = []
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { repairClock }, foreground: { 999 }, state: { .orderChanged }, pump: { end in
        repairPumps.append(end); repairClock = end
    }) == .repairTimedOut)
check(repairPumps == [150_000_000])

// Sampling a changed order must not reorder against the old foreground. Fatal
// state still wins, while unknown/changed foreground suppresses every repair.
var orderRepairCount = 0
for changedForeground: Int32? in [nil, 888] {
    check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
        now: { 0 }, foreground: { changedForeground }, state: { .orderChanged },
        repairOrder: { orderRepairCount += 1; return nil },
        pump: { _ in fatalError("Stale foreground order was pumped") }) == .foregroundChanged)
}
check(orderRepairCount == 0)
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { 0 }, foreground: { nil }, state: { .cancelled },
    repairOrder: { orderRepairCount += 1; return nil },
    pump: { _ in fatalError("Cancelled order was pumped") }) == .cancelled)
check(orderRepairCount == 0)
repairClock = 0
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { repairClock }, foreground: { 999 }, state: { repairClock = 150_000_000; return .orderChanged },
    repairOrder: { orderRepairCount += 1; return nil },
    pump: { _ in fatalError("Expired order was pumped") }) == .repairTimedOut)
check(orderRepairCount == 0)
repairClock = 0
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { repairClock }, foreground: { 999 }, state: { repairClock == 0 ? .orderChanged : .safe },
    repairOrder: { orderRepairCount += 1; return nil },
    pump: { repairClock = $0 }) == .safe)
check(orderRepairCount == 1 && repairClock == 5_000_000)
check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
    now: { 0 }, foreground: { 999 }, state: { .orderChanged },
    repairOrder: { .repairBudgetExceeded },
    pump: { _ in fatalError("Exhausted order repair was pumped") }) == .repairBudgetExceeded)

// A user switching apps during placement invalidates that visual sample, not
// the persistent attachment. Clear before retrying and reuse the exact same
// deadline. The new attempt must prove a safe order and flush it once again.
repairClock = 0; repairForeground = 999
var placementEvents: [String] = []
var placementAttempts: [Bool] = []
var placementVisible = true
let recoveredPlacement = windowIndicatorAwaitStablePlacement(deadline: 150_000_000,
    now: { repairClock }, attempt: { recovering in
        placementAttempts.append(recovering)
        if recovering { check(!placementVisible); placementEvents.append("revalidate") }
        let sampledForeground = repairForeground
        let result = windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: sampledForeground,
            now: { repairClock }, foreground: { repairForeground }, state: { .safe }, pump: { end in
                repairClock = end
                if !recovering { repairForeground = 888 }
            })
        if result == .safe { placementVisible = true; placementEvents.append("show") }
        return result
    }, suspend: { placementVisible = false; placementEvents.append("hide") },
    pump: { end in repairClock = end })
check(recoveredPlacement == .safe && placementVisible && repairClock == 15_000_000)
check(placementAttempts == [false, true] && placementEvents == ["hide", "revalidate", "show"])

// Temporary absent foreground samples keep the panel hidden. They cannot
// authorize a visible frame or repeatedly order a window before a valid PID.
repairClock = 0; repairForeground = nil; placementAttempts = []; placementVisible = false
check(windowIndicatorAwaitStablePlacement(deadline: 150_000_000, now: { repairClock }, attempt: { recovering in
    placementAttempts.append(recovering)
    let result = windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: repairForeground,
        now: { repairClock }, foreground: { repairForeground }, state: { .safe }, pump: { end in repairClock = end })
    if result == .safe { placementVisible = true }
    return result
}, suspend: { placementVisible = false }, pump: { end in
    check(!placementVisible); repairClock = end
    if repairClock >= 15_000_000 { repairForeground = 888 }
}) == .safe)
check(placementVisible && placementAttempts == [false, true, true, true] && repairClock == 20_000_000)

// Repeated unknown samples cannot renew the original deadline, including when
// less than a full event-pump slice remains. No success is accepted at expiry.
repairClock = 0; repairPumps = []; var placementCount = 0
check(windowIndicatorAwaitStablePlacement(deadline: 12_000_000, now: { repairClock }, attempt: { _ in
    placementCount += 1; return .foregroundUnknown
}, suspend: {}, pump: { end in repairPumps.append(end); repairClock = end }) == .repairTimedOut)
check(repairClock == 12_000_000 && placementCount == 3 && repairPumps == [5_000_000, 10_000_000, 12_000_000])
repairClock = 0; repairPumps = []
check(windowIndicatorAwaitStablePlacement(deadline: 12_000_000, now: { repairClock }, attempt: { _ in
    repairClock = 12_000_000; return .safe
}, suspend: {}, pump: { repairPumps.append($0) }) == .repairTimedOut)
check(repairPumps.isEmpty)
check(windowIndicatorAwaitStablePlacement(deadline: 12_000_000, now: { 12_000_000 },
    attempt: { _ in fatalError("Expired placement retried") }, suspend: {},
    pump: { _ in fatalError("Expired placement pumped") }) == .repairTimedOut)

// Fatal target/parent/menu/focus changes and cancellation win even if the
// foreground changed simultaneously. A recovery attempt is never a waiver.
for failure in [WindowIndicatorReason.identityInvalid, .targetUnavailable, .targetChanged, .panelChanged,
    .metadataInvalid, .cancelled, .parentChanged, .displayChanged, .panelFocused, .helperFrontmost,
    .menuUnavailable, .repairBudgetExceeded] {
    repairClock = 0; repairPumps = []; placementAttempts = []
    check(windowIndicatorAwaitSafeOrder(deadline: 150_000_000, expectedForeground: 999,
        now: { repairClock }, foreground: { 888 }, state: { failure },
        pump: { _ in fatalError("Fatal state masked by foreground change") }) == failure)
    check(windowIndicatorAwaitStablePlacement(deadline: 150_000_000, now: { repairClock }, attempt: { recovering in
        placementAttempts.append(recovering)
        return recovering ? failure : .foregroundChanged
    }, suspend: {}, pump: { end in repairPumps.append(end); repairClock = end }) == failure)
    check(placementAttempts == [false, true] && repairPumps == [5_000_000])
}

// Actual foreground recovery reorders use the original rolling repair budget;
// repeated changes cannot fight the user's foreground window indefinitely.
var foregroundRepairBudget = WindowIndicatorRepairBudget()
repairClock = 0; placementCount = 0
check(windowIndicatorAwaitStablePlacement(deadline: 150_000_000, now: { repairClock }, attempt: { recovering in
    if recovering && !foregroundRepairBudget.reserve(now: repairClock) { return .repairBudgetExceeded }
    placementCount += 1; return .foregroundChanged
}, suspend: {}, pump: { end in repairClock = end }) == .repairBudgetExceeded)
check(placementCount == 5 && repairClock == 25_000_000)

// Feedback is a separate, no-ACK protocol. It cannot carry a new window,
// arbitrary controls, or a future display point outside the frozen target.
func commandData(_ value: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: value) }
func feedback(_ sequence: Any, _ phase: String, _ point: [String: Any] = ["x": 50, "y": 200]) -> Data {
    commandData(["pointer": ["sequence": sequence, "phase": phase, "point": point]])
}
if case .heartbeat = try! windowIndicatorCommand(Data(), frozenWindow: window) {} else { fatalError("Heartbeat changed") }
if case .plan(let plan) = try! windowIndicatorCommand(clickLine, frozenWindow: window) { check(plan.point == point) }
else { fatalError("Legacy update changed") }
for phase in ["down", "move", "up"] {
    if case .pointer(let event) = try! windowIndicatorCommand(feedback(1, phase), frozenWindow: window) {
        check(event.sequence == 1 && event.phase.rawValue == phase && event.point == WindowInputPoint(x: 50, y: 200))
    } else { fatalError("Valid pointer rejected") }
}
for invalid in [feedback(0, "down"), feedback(-1, "down"), feedback(true, "down"), feedback(1.5, "down"),
    feedback(9_007_199_254_740_992 as Int64, "down"), feedback(1, "click"),
    feedback(1, "down", ["x": true, "y": 200]), feedback(1, "down", ["x": 660, "y": 200]),
    feedback(1, "move", ["x": 50, "y": 200, "windowId": 22]),
    commandData(["pointer": ["sequence": 1, "phase": "down", "point": ["x": 50, "y": 200], "label": "AI"]]),
    commandData(["pointer": ["sequence": 1, "phase": "down", "point": ["x": 50, "y": 200]], "window": window.json]),
    Data(#"{"pointer":{"sequence":1,"sequence":2,"phase":"down","point":{"x":50,"y":200}}}"#.utf8)] {
    check((try? windowIndicatorCommand(invalid, frozenWindow: window)) == nil)
}
for key in ["snapshot", "inputSettled", "hide"] {
    let valid = try! windowIndicatorCommand(commandData([key: true]), frozenWindow: window)
    switch valid {
    case .snapshot: check(key == "snapshot")
    case .inputSettled: check(key == "inputSettled")
    case .hide: check(key == "hide")
    default: fatalError("Control command changed")
    }
    for invalid in [commandData([key: false]), commandData([key: 1]), commandData([key: "true"]),
        commandData([key: true, "window": window.json]), commandData([key: true, "point": ["x": 50, "y": 200]])] {
        check((try? windowIndicatorCommand(invalid, frozenWindow: window)) == nil)
    }
}
check(windowIndicatorCommandCanRunWhileHiding(.heartbeat))
for command: WindowIndicatorCommand in [.hide, .snapshot, .inputSettled, .plan(try! parseWindowIndicatorRequest(clickLine)),
    .pointer(WindowIndicatorPointerEvent(sequence: 1, phase: .down, point: point))] {
    check(!windowIndicatorCommandCanRunWhileHiding(command))
}
check((try? windowIndicatorCommand(Data(#"{"hide":true,"hide":true}"#.utf8), frozenWindow: window)) == nil)
let fade = WindowIndicatorFadeOut(began: 1_000_000_000, initialOpacity: 1)
check(fade.opacity(at: 0) == 1 && fade.opacity(at: fade.began) == 1)
check(abs(fade.opacity(at: fade.began + 220_000_000) - 0.5) < 0.00000001)
check(fade.opacity(at: fade.began + 440_000_000) == 0 && fade.opacity(at: UInt64.max) == 0)
check(abs(WindowIndicatorFadeOut(began: 0, initialOpacity: 0.4).opacity(at: 220_000_000) - 0.2) < 0.00000001)
check(windowIndicatorFadeProgress(elapsed: 0) == 0 && windowIndicatorFadeProgress(elapsed: UInt64.max) == 1)
check(windowIndicatorRegistrationBudget + windowIndicatorFadeDuration < windowIndicatorStartupBudget)
check(abs(windowIndicatorFadeProgress(elapsed: 110_000_000) - 0.12916193) < 0.00000001)
check(abs(windowIndicatorFadeProgress(elapsed: 330_000_000) - 0.87083807) < 0.00000001)
var previousFade = 0.0
for step in 0...100 {
    let progress = windowIndicatorFadeProgress(elapsed: windowIndicatorFadeDuration * UInt64(step) / 100)
    check(progress >= previousFade && progress >= 0 && progress <= 1)
    check(abs(progress + windowIndicatorFadeProgress(elapsed: windowIndicatorFadeDuration * UInt64(100 - step) / 100) - 1) < 0.00000001)
    previousFade = progress
}
var feedbackState = WindowIndicatorPointerState()
let feedbackPoint = WindowInputPoint(x: 50, y: 200)
check((try? feedbackState.accept(WindowIndicatorPointerEvent(sequence: 1, phase: .move, point: feedbackPoint))) == nil)
check(feedbackState.sequence == 0 && !feedbackState.pressed)
try! feedbackState.accept(WindowIndicatorPointerEvent(sequence: 2, phase: .down, point: feedbackPoint))
check(feedbackState.sequence == 2 && feedbackState.pressed)
check((try? feedbackState.accept(WindowIndicatorPointerEvent(sequence: 2, phase: .up, point: feedbackPoint))) == nil)
check((try? feedbackState.accept(WindowIndicatorPointerEvent(sequence: 1, phase: .up, point: feedbackPoint))) == nil)
check(feedbackState.sequence == 2 && feedbackState.pressed)
try! feedbackState.accept(WindowIndicatorPointerEvent(sequence: 3, phase: .move, point: feedbackPoint))
feedbackState.inputSettled()
check(feedbackState.sequence == 3 && !feedbackState.pressed)
check((try? feedbackState.accept(WindowIndicatorPointerEvent(sequence: 4, phase: .move, point: feedbackPoint))) == nil)
try! feedbackState.accept(WindowIndicatorPointerEvent(sequence: 5, phase: .up, point: feedbackPoint))
check(feedbackState.sequence == 5 && !feedbackState.pressed)

// Fixed, bounded envelopes cover every motion sample and do not play a drag
// endpoint. Without one common safe mirror, the existing endpoint update wins.
let motionStart = WindowInputPoint(x: -50.25, y: 100.5)
let motionEnd = WindowInputPoint(x: 400.75, y: 350.5)
let envelope = windowIndicatorEnvelope([motionStart, motionEnd], bounds: window.bounds)!
check(envelope.displayPoint == motionStart && window.bounds.contains(envelope.surface))
let stablePoint = WindowInputPoint(x: 50, y: 200)
let mirrored = WindowIndicatorGeometry(surface: windowIndicatorSurface(stablePoint, xDirection: -1, yDirection: 1),
    displayPoint: stablePoint, xDirection: -1, yDirection: 1)
check(windowIndicatorPlanCanDrawInPlace(point: stablePoint, geometry: mirrored, layer: 0, wantedLayer: 0))
check(windowIndicatorPlanCanDrawInPlace(point: stablePoint, geometry: mirrored, layer: 102, wantedLayer: 102))
check(!windowIndicatorPlanCanDrawInPlace(point: stablePoint, geometry: mirrored, layer: 0, wantedLayer: 102))
check(!windowIndicatorPlanCanDrawInPlace(point: motionStart, geometry: mirrored, layer: 0, wantedLayer: 0))
check(!windowIndicatorPlanCanDrawInPlace(point: motionStart, geometry: envelope, layer: 0, wantedLayer: 0))
check(mirrored.xDirection == -1 && window.bounds.contains(mirrored.surface))
let movement = WindowIndicatorMotion(from: motionStart, to: motionEnd, began: 1_000_000_000)!
check(movement.duration >= 120_000_000 && movement.duration <= 350_000_000)
check(movement.point(at: 0) == motionStart)
var previousX = motionStart.x, previousY = motionStart.y
for step in 0...100 {
    let time = movement.began + movement.duration * UInt64(step) / 100
    let sample = movement.point(at: time)
    check(sample.x >= previousX && sample.y >= previousY)
    let geometry = windowIndicatorGeometry(at: sample, in: envelope)!
    check(geometry.surface == envelope.surface && geometry.xDirection == envelope.xDirection && geometry.yDirection == envelope.yDirection)
    check(window.bounds.contains(windowIndicatorSurface(sample, xDirection: geometry.xDirection, yDirection: geometry.yDirection)))
    previousX = sample.x; previousY = sample.y
}
check(movement.point(at: movement.began + movement.duration) == motionEnd)
check(movement.point(at: UInt64.max) == motionEnd)
check(!movement.finished(at: movement.began + movement.duration - 1) && movement.finished(at: movement.began + movement.duration))
check(WindowIndicatorMotion(from: motionStart, to: motionStart, began: 0) == nil)
check(WindowIndicatorMotion(from: WindowInputPoint(x: Double.nan, y: 100), to: motionEnd, began: 0) == nil)
check(windowIndicatorEnvelope([], bounds: window.bounds) == nil)
check(windowIndicatorEnvelope(Array(repeating: motionStart, count: 4), bounds: window.bounds) == nil)
check(windowIndicatorEnvelope([WindowInputPoint(x: -93, y: 200), WindowInputPoint(x: 653, y: 200)], bounds: window.bounds) == nil)
check(windowIndicatorEnvelope([WindowInputPoint(x: -100, y: 40), motionEnd], bounds: window.bounds) == nil)
let wideWindow = Rect(x: -3000, y: -500, width: 3840, height: 2160)
check(windowIndicatorEnvelope([WindowInputPoint(x: -2900, y: -400), WindowInputPoint(x: 0, y: 900)], bounds: wideWindow) == nil)
check(windowIndicatorGeometry(at: WindowInputPoint(x: 654, y: 450), in: envelope) == nil)

// Long moves retain every curve span using small verified envelopes. Cubic
// subdivision preserves points and tangents rather than replacing the route.
let cubic = WindowIndicatorCubic(start: WindowInputPoint(x: 0, y: 0),
    first: WindowInputPoint(x: 40, y: 100), second: WindowInputPoint(x: 160, y: -50), end: WindowInputPoint(x: 200, y: 50))
let (leftCubic, rightCubic) = cubic.split()
check(leftCubic.end == rightCubic.start && leftCubic.end == cubic.point(0.5))
for step in 0...100 {
    let progress = Double(step) / 100
    let left = leftCubic.point(progress), originalLeft = cubic.point(progress / 2)
    let right = rightCubic.point(progress), originalRight = cubic.point(0.5 + progress / 2)
    check(hypot(left.x - originalLeft.x, left.y - originalLeft.y) < 0.000001)
    check(hypot(right.x - originalRight.x, right.y - originalRight.y) < 0.000001)
}
let leftTangent = leftCubic.tangent(1), rightTangent = rightCubic.tangent(0)
check(leftTangent == rightTangent)
let routeBounds = Rect(x: -100, y: -100, width: 3000, height: 1700)
let routeStart = WindowInputPoint(x: 250, y: 250), routeEnd = WindowInputPoint(x: 2450, y: 1200)
let longRoute = windowIndicatorRoute(from: routeStart, to: routeEnd, bounds: routeBounds)!
check(longRoute.start == routeStart && longRoute.end == routeEnd)
check(longRoute.segments.count > 2 && longRoute.segments.count <= 8)
var maximumDeviation = 0.0
for curve in longRoute.curves {
    for step in 0...100 {
        let sample = curve.point(Double(step) / 100)
        maximumDeviation = max(maximumDeviation, abs((sample.x - routeStart.x) * (routeEnd.y - routeStart.y)
            - (sample.y - routeStart.y) * (routeEnd.x - routeStart.x)) / hypot(routeEnd.x - routeStart.x, routeEnd.y - routeStart.y))
    }
}
check(maximumDeviation > 10)
if longRoute.curves.count == 2 {
    check(longRoute.curves[0].end == longRoute.curves[1].start)
    let arriving = longRoute.curves[0].tangent(1), leaving = longRoute.curves[1].tangent(0)
    check(hypot(arriving.x - leaving.x, arriving.y - leaving.y) < 0.000001)
}
for (index, segment) in longRoute.segments.enumerated() {
    check(segment.geometry.surface.width <= 1024 && segment.geometry.surface.height <= 1024)
    check(segment.geometry.surface.width * segment.geometry.surface.height <= 1_048_576)
    check(routeBounds.contains(segment.geometry.surface) && segment.lower < segment.upper)
    check(segment.geometry.displayPoint == segment.curve.start)
    if index > 0 {
        check(longRoute.segments[index - 1].curve.end == segment.curve.start)
        check(longRoute.segments[index - 1].upper == segment.lower)
    }
    for step in 0...100 {
        let sample = segment.curve.point(Double(step) / 100)
        check(windowIndicatorGeometry(at: sample, in: segment.geometry) != nil)
    }
}
var longMotion = WindowIndicatorMotion(route: longRoute, began: 1_000_000_000)
check(longMotion.duration <= 650_000_000)
var routeClock: UInt64 = longMotion.began
for (index, segment) in longRoute.segments.enumerated() {
    check(longMotion.segmentIndex == index && longMotion.point(at: routeClock) == segment.curve.start)
    while !longMotion.segmentFinished(at: routeClock) {
        check(windowIndicatorGeometry(at: longMotion.point(at: routeClock), in: segment.geometry) != nil)
        routeClock += 1_000_000
    }
    check(longMotion.point(at: routeClock) == segment.curve.end)
    if index + 1 < longRoute.segments.count {
        check(!longMotion.finished(at: routeClock))
        routeClock += 150_000_000
        longMotion.advanceSegment(at: routeClock)
        // A slow native placement pauses on the exact shared endpoint.
        check(longMotion.point(at: routeClock) == segment.curve.end)
    }
}
check(longMotion.finished(at: routeClock) && longMotion.point(at: UInt64.max) == routeEnd)
let eightSegmentRoute = windowIndicatorRoute(from: WindowInputPoint(x: 200, y: 500),
    to: WindowInputPoint(x: 7800, y: 1300), bounds: Rect(x: 0, y: 0, width: 9000, height: 2400))!
check(eightSegmentRoute.segments.count == windowIndicatorMaximumRouteSegments)
let commandBegan: UInt64 = 1_000_000_000
var worstClock = commandBegan + windowIndicatorPlacementBudget
var worstMotion = WindowIndicatorMotion(route: eightSegmentRoute, began: worstClock)
for index in eightSegmentRoute.segments.indices {
    while !worstMotion.segmentFinished(at: worstClock) { worstClock += windowIndicatorAnimationTick }
    if index + 1 < eightSegmentRoute.segments.count {
        worstClock += windowIndicatorPlacementBudget
        worstMotion.advanceSegment(at: worstClock)
    }
}
worstClock += windowIndicatorPlacementBudget
let maximumRouteDuration = windowIndicatorSegmentPlacementAllowance(segments: windowIndicatorMaximumRouteSegments)!
check(worstMotion.finished(at: worstClock))
check(worstClock - commandBegan <= maximumRouteDuration)
check(maximumRouteDuration == 2_128_000_000 && maximumRouteDuration < windowIndicatorRouteBudget)
check(windowIndicatorSegmentPlacementAllowance(segments: 0) == nil && windowIndicatorSegmentPlacementAllowance(segments: 9) == nil)
let shortRoute = windowIndicatorRoute(from: WindowInputPoint(x: 300, y: 300),
    to: WindowInputPoint(x: 400, y: 350), bounds: routeBounds)!
check(shortRoute.curves.count == 1 && shortRoute.segments.count == 1)
check(abs(shortRoute.curves[0].point(0.5).x - 350) < 0.000001)
check(windowIndicatorRoute(from: routeStart, to: routeStart, bounds: routeBounds) == nil)
check(windowIndicatorRoute(from: WindowInputPoint(x: .nan, y: 0), to: routeEnd, bounds: routeBounds) == nil)
let excessiveBounds = Rect(x: 0, y: 0, width: 100_000, height: 100_000)
check(windowIndicatorRoute(from: WindowInputPoint(x: 100, y: 100),
    to: WindowInputPoint(x: 90_000, y: 90_000), bounds: excessiveBounds) == nil)

// Press/release uses a damped spring with a .7 target. The painted path and
// shadow remain inside the existing surface, with an unchanged exact hotspot.
var press = WindowIndicatorPressSpring()
check(press.sample(at: 0).scale == 1 && press.sample(at: 0).settled)
press.setPressed(true, at: 1_000_000_000)
check(press.sample(at: 1_000_000_000).scale == 1)
check(press.sample(at: 1_100_000_000).scale < 1)
for step in 0...120 {
    let sample = press.sample(at: 1_000_000_000 + UInt64(step) * 5_000_000)
    check(sample.scale >= 0.7 && sample.scale <= 1 && sample.velocity.isFinite)
    let geometry = windowIndicatorGeometry(WindowIndicatorRequest(window: window, operation: .click,
        point: feedbackPoint, endPoint: nil))!
    let path = windowIndicatorArrowPath(geometry, pressScale: sample.scale)
    var tip = [NSPoint](repeating: .zero, count: 3)
    _ = tip.withUnsafeMutableBufferPointer { path.element(at: 0, associatedPoints: $0.baseAddress!) }
    check(tip[0].x + geometry.surface.x == feedbackPoint.x && tip[0].y + geometry.surface.y == feedbackPoint.y)
    let painted = path.bounds.insetBy(dx: -3.975 * sample.scale, dy: -3.975 * sample.scale)
    check(painted.minX >= 0 && painted.minY >= 0 && painted.maxX <= geometry.surface.width && painted.maxY <= geometry.surface.height)
}
check(press.sample(at: 1_600_000_000).scale == 0.7 && press.sample(at: 1_600_000_000).settled)
press.setPressed(false, at: 1_600_000_000)
check(press.sample(at: 1_600_000_000).scale == 0.7 && press.sample(at: 1_700_000_000).scale > 0.7)
check(press.sample(at: 2_200_000_000).scale == 1 && press.sample(at: 2_200_000_000).settled)

// A normal target keeps its own ordering during plan movement and posted
// drag feedback. Neither a requested overlay flag nor the old level-102
// heuristic can authorize crossing the user's covering window.
let raised = entry(22, layer: 102)
for elevated in [nil, false, true] as [Bool?] {
    check(windowIndicatorStackState([raised, foreground, target], target: window, targetStartedAt: 999,
        panelId: 22, panelPID: 456, panelBounds: panelBounds, expectedLayer: 102, elevated: elevated) != .safe)
    check(windowIndicatorStackState([panel, foreground, target], target: window, targetStartedAt: 999,
        panelId: 22, panelPID: 456, panelBounds: panelBounds, expectedLayer: 0, elevated: elevated) != .safe)
}
for coveringPID in [Int32(123), 999] {
    // Another window in the active target app covers this target just as an
    // unrelated app does. Stable OS occlusion needs no explicit visual hide.
    check(windowIndicatorStackState([entry(33, pid: coveringPID), panel, target], target: window,
        targetStartedAt: 999, panelId: 22, panelPID: 456, panelBounds: panelBounds, expectedLayer: 0) == .safe)
}
// The same occlusion proof holds at intermediate curve samples and actual
// straight drag positions, including the press/release frames. Moving or
// pressing cannot create a second permission to paint over the covering app.
let plannedSamples = (0...8).map { movement.point(at: movement.began + movement.duration * UInt64($0) / 8) }
var postedDrag = WindowIndicatorPointerState()
for index in 0...8 {
    let position = WindowInputPoint(x: motionStart.x + (motionEnd.x - motionStart.x) * Double(index) / 8,
        y: motionStart.y + (motionEnd.y - motionStart.y) * Double(index) / 8)
    let phase: WindowIndicatorPointerPhase = index == 0 ? .down : index == 8 ? .up : .move
    try! postedDrag.accept(WindowIndicatorPointerEvent(sequence: Int64(index + 1), phase: phase, point: position))
    check(postedDrag.pressed == (index < 8))
    for samplePoint in [plannedSamples[index], position] {
        let small = windowIndicatorSmallGeometry(point: samplePoint, bounds: window.bounds)!
        let smallPanel = entry(22, bounds: small.surface)
        let cover = entry(33, pid: 999, bounds: window.bounds)
        check(windowIndicatorStackState([cover, smallPanel, target], target: window, targetStartedAt: 999,
            panelId: 22, panelPID: 456, panelBounds: small.surface, expectedLayer: 0) == .safe)
        check(windowIndicatorStackState([smallPanel, cover, target], target: window, targetStartedAt: 999,
            panelId: 22, panelPID: 456, panelBounds: small.surface, expectedLayer: 0, elevated: true) != .safe)
    }
}
check(windowIndicatorStackState([raised, foreground, target], target: window, targetStartedAt: 999,
    panelId: 22, panelPID: 456, panelBounds: panelBounds) == .panelChanged)
check(windowIndicatorStackState([panel, foreground, target], target: window, targetStartedAt: 999,
    panelId: 22, panelPID: 456, panelBounds: panelBounds, expectedLayer: 102) != .safe)
check(windowIndicatorStackState([raised, target], target: window, targetStartedAt: 999,
    panelId: 22, panelPID: 456, panelBounds: panelBounds, expectedLayer: 103) == .identityInvalid)
check(windowIndicatorStackState([entry(22, pid: 457, layer: 102), target], target: window, targetStartedAt: 999,
    panelId: 22, panelPID: 456, panelBounds: panelBounds, expectedLayer: 102) != .safe)
let nextBounds = Rect(x: 50, y: 200, width: 35, height: 35)
for old in [panel, entry(22, bounds: nextBounds)] {
    check(windowIndicatorKnownPlacementTransition([old, target], target: window, targetStartedAt: 999,
        panelId: 22, panelPID: 456, previousBounds: panelBounds, previousLayer: 0, bounds: nextBounds, layer: 0))
}
for invalid in [entry(22, pid: 457), raised, entry(22, layer: 103), entry(22, bounds: window.bounds)] {
    check(!windowIndicatorKnownPlacementTransition([invalid, target], target: window, targetStartedAt: 999,
        panelId: 22, panelPID: 456, previousBounds: panelBounds, previousLayer: 0, bounds: nextBounds, layer: 0))
}
check(!windowIndicatorKnownPlacementTransition([raised, foreground, target], target: window, targetStartedAt: 999,
    panelId: 22, panelPID: 456, previousBounds: panelBounds, previousLayer: 102, bounds: nextBounds, layer: 0))


// Snapshot identity comes from the just-validated owned CG entry, including
// title presence. Empty and absent titles must never be normalized together.
func snapshot(_ own: WindowIndicatorStackEntry, start: Int64? = 1234,
    bounds: Rect = panelBounds, layer: Int32 = 0, stackTarget: WindowIndicatorStackEntry = target) -> [String: Any]? {
    windowIndicatorSnapshotProjection([own, stackTarget], target: window, targetStartedAt: 999,
        panelId: 22, panelPID: 456, panelStartedAt: start, panelBounds: bounds, expectedLayer: layer)
}
for title in ["", "OmniFlow pointer", String(repeating: "a", count: 256), String(repeating: "界", count: 85)] {
    let receipt = snapshot(entry(22, title: title))!
    let identity = receipt["window"] as! [String: Any]
    check(identity["title"] as? String == title)
    check(identity["windowId"] as? UInt32 == 22 && identity["pid"] as? Int32 == 456)
    check(identity["processStartedAt"] as? Int64 == 1234 && identity["layer"] as? Int32 == 0)
    check((try! JSONSerialization.data(withJSONObject: receipt)).count < 512)
}
let untitledSnapshot = snapshot(entry(22))!["window"] as! [String: Any]
check(untitledSnapshot["title"] == nil)
check(snapshot(entry(22, layer: 102, title: ""), layer: 102) == nil)
for invalidTitle in [String(repeating: "a", count: 257), "hidden\nlabel", "\u{202e}label", String(repeating: "\"", count: 256)] {
    check(snapshot(entry(22, title: invalidTitle)) == nil)
}
check(snapshot(entry(22), start: nil) == nil)
check(snapshot(entry(22), start: 0) == nil)
check(snapshot(entry(22, pid: 457)) == nil)
check(snapshot(entry(22, layer: 102)) == nil)
let largeSnapshotBounds = Rect(x: -99, y: 41, width: 129, height: 50)
check(snapshot(entry(22, bounds: largeSnapshotBounds), bounds: largeSnapshotBounds) == nil)
check(snapshot(entry(22), stackTarget: entry(11, pid: 124, bounds: window.bounds, title: "QA")) == nil)

// Visual attachment survives geometry and title changes without modifying the
// exact approved observation. Only an explicit target command can refresh it.
let movedWindow = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 80, y: 90, width: 760, height: 460), title: "Moved")
check(windowIndicatorSameAttachment(window, movedWindow))
check(!windowIndicatorSameWindow(window, movedWindow))
let syncLine = try! JSONSerialization.data(withJSONObject: ["target": movedWindow.json])
if case .target(let synced) = try! windowIndicatorCommand(syncLine, frozenWindow: window) {
    check(windowIndicatorSameWindow(synced, movedWindow))
} else { fatalError("Expected target sync") }
check((try? windowIndicatorUpdate(data("click", identity: movedWindow.json), frozenWindow: window)) == nil)
for (key, value) in [("windowId", 12), ("pid", 124), ("processStartedAt", 1000), ("layer", 1),
    ("extra", 1)] as [(String, Any)] {
    var invalid = movedWindow.json; invalid[key] = value
    let line = try! JSONSerialization.data(withJSONObject: ["target": invalid])
    check((try? windowIndicatorCommand(line, frozenWindow: window)) == nil)
}
check(!windowIndicatorCommandCanRunWhileHiding(.target(movedWindow)))
check((try? windowIndicatorCommand(try! JSONSerialization.data(withJSONObject:
    ["target": movedWindow.json, "hide": true]), frozenWindow: window)) == nil)

let localHotspot = WindowInputPoint(x: 50, y: 60)
check(windowIndicatorAttachedPoint(local: localHotspot, window: window) == WindowInputPoint(x: -50, y: 100))
check(windowIndicatorAttachedPoint(local: localHotspot, window: movedWindow) == WindowInputPoint(x: 130, y: 150))
let shrunkWindow = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: 80, y: 90, width: 40, height: 40), title: "Moved")
check(windowIndicatorAttachedPoint(local: localHotspot, window: shrunkWindow) == nil)
let nearEdge = WindowInputPoint(x: 81, y: 91)
check(windowIndicatorSmallGeometry(point: nearEdge, bounds: movedWindow.bounds, directions: (1, 1)) == nil)
let attachedGeometry = windowIndicatorSmallGeometry(point: WindowInputPoint(x: 130.5, y: 150.5), bounds: movedWindow.bounds)!
check(attachedGeometry.surface.width <= 36 && attachedGeometry.surface.height <= 36)
check(attachedGeometry.displayPoint == WindowInputPoint(x: 130.5, y: 150.5))
for segment in longRoute.segments {
    for tick in 0...24 {
        let samplePoint = segment.curve.point(Double(tick) / 24)
        let sampleGeometry = windowIndicatorSmallGeometry(point: samplePoint, bounds: routeBounds,
            directions: (segment.geometry.xDirection, segment.geometry.yDirection))
        // This independently verifies that each motion sample uses only a tiny
        // backing surface; the path proof remains its full control hull.
        check(sampleGeometry != nil)
        check(sampleGeometry!.surface.width <= 36 && sampleGeometry!.surface.height <= 36)
    }
}

let elevatedTargetWindow = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 3,
    bounds: window.bounds, title: "QA")
check(!elevatedTargetWindow.valid && windowIndicatorVisualIdentityValid(elevatedTargetWindow))
check(windowIndicatorStackState([entry(22, layer: 3), entry(11, pid: 123, layer: 3, bounds: window.bounds, title: "QA")],
    target: elevatedTargetWindow, targetStartedAt: 999, panelId: 22, panelPID: 456, panelBounds: panelBounds,
    expectedLayer: 3) == .safe)
let elevatedTargetEntry = entry(11, pid: 123, layer: 3, bounds: window.bounds, title: "QA")
for coveringPID in [Int32(123), 999] {
    let covering = entry(33, pid: coveringPID, layer: 3)
    check(windowIndicatorStackState([covering, entry(22, layer: 3), elevatedTargetEntry],
        target: elevatedTargetWindow, targetStartedAt: 999, panelId: 22, panelPID: 456, panelBounds: panelBounds,
        expectedLayer: 3) == .safe)
    check(windowIndicatorStackState([entry(22, layer: 3), covering, elevatedTargetEntry],
        target: elevatedTargetWindow, targetStartedAt: 999, panelId: 22, panelPID: 456, panelBounds: panelBounds,
        expectedLayer: 3, elevated: true) != .safe)
}
check(windowIndicatorStackState([raised, elevatedTargetEntry], target: elevatedTargetWindow, targetStartedAt: 999,
    panelId: 22, panelPID: 456, panelBounds: panelBounds, expectedLayer: 102) != .safe)
for invalidLayer: Int32 in [-1, 103, Int32.max] {
    check(!windowIndicatorVisualIdentityValid(WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999,
        layer: invalidLayer, bounds: window.bounds, title: "QA")))
}
for (visible, hidden, alpha) in [(true, false, 1.0), (false, false, 1.0), (true, true, 1.0), (true, false, 0.0)] {
    let sample = windowIndicatorAttachmentSample([entry(11, pid: 123, bounds: movedWindow.bounds,
        title: "Moved", alpha: alpha, onScreen: visible)], anchor: window, processStartedAt: 999, applicationHidden: hidden)!
    check(sample.visible == (visible && !hidden && alpha > 0))
    check(sample.window.bounds == movedWindow.bounds && windowIndicatorSameAttachment(sample.window, window))
}
check(windowIndicatorAttachmentSample([], anchor: window, processStartedAt: 999, applicationHidden: false) == nil)
check(windowIndicatorAttachmentSample([target, target], anchor: window, processStartedAt: 999, applicationHidden: false) == nil)
check(windowIndicatorAttachmentSample([target], anchor: window, processStartedAt: 1000, applicationHidden: false) == nil)
check(windowIndicatorAttachmentSample([entry(11, pid: 124)], anchor: window, processStartedAt: 999, applicationHidden: false) == nil)
check(windowIndicatorAttachmentSample([entry(12, pid: 123)], anchor: window, processStartedAt: 999, applicationHidden: false) == nil)

// kCGWindowIsOnscreen is optional. The documented missing-key value is false,
// which preserves the known attachment while hiding pixels and captures.
func attachmentRow(_ identity: WindowIdentity = window) -> [String: Any] {
    var row: [String: Any] = [kCGWindowNumber as String: identity.windowId,
        kCGWindowOwnerPID as String: identity.pid, kCGWindowLayer as String: identity.layer,
        kCGWindowAlpha as String: 1.0, kCGWindowIsOnscreen as String: true,
        kCGWindowBounds as String: CGRect(x: identity.bounds.x, y: identity.bounds.y,
            width: identity.bounds.width, height: identity.bounds.height).dictionaryRepresentation]
    if let title = identity.title { row[kCGWindowName as String] = title }
    return row
}
func readAttachment(_ rows: [[String: Any]]?, startedAt: Int64? = 999,
                    hidden: Bool = false) -> WindowIndicatorAttachmentRead {
    windowIndicatorAttachmentRead(rows, anchor: window, processStartedAt: startedAt, applicationHidden: hidden)
}
func attachmentInvalid(_ value: WindowIndicatorAttachmentRead) -> Bool {
    if case .invalid = value { return true }; return false
}
func attachmentMissing(_ value: WindowIndicatorAttachmentRead) -> Bool {
    if case .missing = value { return true }; return false
}
for (visibility, expected) in [(true as Any?, true), (false as Any?, false), (nil, false)] {
    var row = attachmentRow(movedWindow)
    row[kCGWindowIsOnscreen as String] = visibility
    guard case .sample(let sample) = readAttachment([row]) else { fatalError("Valid attachment became invalid") }
    check(sample.visible == expected)
    check(sample.window.bounds == movedWindow.bounds && sample.window.title == "Moved")
    check(windowIndicatorSameAttachment(sample.window, window))
    // Observing a visual translation does not authorize the old action frame.
    check(!windowIndicatorSameWindow(sample.window, window))
}
for (hidden, alpha) in [(true, 1.0), (false, 0.0)] {
    var row = attachmentRow(); row[kCGWindowAlpha as String] = alpha
    guard case .sample(let sample) = readAttachment([row], hidden: hidden) else { fatalError("Hidden attachment became invalid") }
    check(!sample.visible)
}
check(attachmentMissing(readAttachment([])))
check(attachmentInvalid(readAttachment(nil)))
check(attachmentInvalid(readAttachment([], startedAt: nil)))
check(attachmentInvalid(readAttachment([], startedAt: 1000)))
check(attachmentInvalid(readAttachment([attachmentRow(), attachmentRow()])))
for (key, value) in [(kCGWindowNumber as String, 12), (kCGWindowOwnerPID as String, 124),
    (kCGWindowLayer as String, 103), (kCGWindowAlpha as String, Double.nan),
    (kCGWindowAlpha as String, -0.1), (kCGWindowAlpha as String, 1.1),
    (kCGWindowIsOnscreen as String, "true"), (kCGWindowIsOnscreen as String, NSNull()),
    (kCGWindowName as String, NSNull()), (kCGWindowName as String, "invalid\nname"),
    (kCGWindowBounds as String, [:])] as [(String, Any)] {
    var row = attachmentRow(); row[key] = value
    check(attachmentInvalid(readAttachment([row])))
}
for key in [kCGWindowNumber, kCGWindowOwnerPID, kCGWindowLayer, kCGWindowAlpha, kCGWindowBounds] {
    var row = attachmentRow(); row.removeValue(forKey: key as String)
    check(attachmentInvalid(readAttachment([row])))
}
// A missing row has one absolute deadline. Polling/heartbeats cannot extend it;
// only a newly confirmed same-identity row clears this visual recovery state.
var attachmentRecovery = WindowIndicatorAttachmentRecovery()
check(attachmentRecovery.missing(at: 10_000))
check(attachmentRecovery.missing(at: 10_000 + 100_000_000))
check(attachmentRecovery.missingSince == 10_000)
check(attachmentRecovery.missing(at: 10_000 + windowIndicatorAttachmentRecoveryBudget - 1))
check(!attachmentRecovery.missing(at: 10_000 + windowIndicatorAttachmentRecoveryBudget))
check(!attachmentRecovery.missing(at: 10_000 + windowIndicatorAttachmentRecoveryBudget + 1))
check(!attachmentRecovery.missing(at: 9_999))
attachmentRecovery.confirmed(); check(attachmentRecovery.missingSince == nil)
check(attachmentRecovery.missing(at: 2_000_000_000))
check(attachmentRecovery.missingSince == 2_000_000_000)

let oldSmall = Rect(x: -50, y: 100, width: 35, height: 35)
let newSmall = Rect(x: -20, y: 120, width: 36, height: 36)
func placement(_ own: WindowIndicatorStackEntry) -> WindowIndicatorReason {
    windowIndicatorPlacementState([own, target], target: window, targetStartedAt: 999, panelId: 22, panelPID: 456,
        previousBounds: oldSmall, previousLayer: 0, bounds: newSmall, layer: 0)
}
check(placement(entry(22, bounds: newSmall)) == .safe)
check(placement(entry(22, bounds: oldSmall)) == .panelUnavailable)
check(placement(entry(22, layer: 102, bounds: oldSmall)) == .panelChanged)
check(placement(entry(22, layer: 102, bounds: newSmall)) == .panelChanged)
check(placement(entry(22, pid: 457, bounds: oldSmall)) == .panelChanged)
check(placement(entry(22, layer: 101, bounds: oldSmall)) == .panelChanged)
check(placement(entry(22, bounds: panelBounds)) == .panelChanged)
// A known previous placement can never turn a stale target into a ready ACK.
check(windowIndicatorPlacementState([entry(22, bounds: oldSmall), entry(11, pid: 123, bounds: movedWindow.bounds,
    title: "Moved")], target: window, targetStartedAt: 999, panelId: 22, panelPID: 456,
    previousBounds: oldSmall, previousLayer: 0, bounds: newSmall, layer: 0) == .targetChanged)
var transitionClock: UInt64 = 0
let transitionTimeout = windowIndicatorAwaitSafeOrder(deadline: 20_000_000, expectedForeground: 999,
    now: { transitionClock }, foreground: { 999 }, state: { placement(entry(22, bounds: oldSmall)) },
    pump: { transitionClock = $0 })
check(transitionTimeout == .repairTimedOut && transitionClock == 20_000_000)
transitionClock = 0
let transitionCancelled = windowIndicatorAwaitSafeOrder(deadline: 20_000_000, expectedForeground: 999,
    now: { transitionClock }, foreground: { 999 }, state: { transitionClock == 0 ? .panelUnavailable : .cancelled },
    pump: { transitionClock = $0 })
check(transitionCancelled == .cancelled && transitionClock < 20_000_000)
transitionClock = 0
let transitionFinished = windowIndicatorAwaitSafeOrder(deadline: 20_000_000, expectedForeground: 999,
    now: { transitionClock }, foreground: { 999 }, state: {
        transitionClock == 0 ? placement(entry(22, bounds: oldSmall)) : placement(entry(22, bounds: newSmall))
    }, pump: { transitionClock = $0 })
check(transitionFinished == .safe && transitionClock == 5_000_000)

// A geometry change during posted feedback discards old global positions but
// consumes sequence numbers, so a late move does not revive the old press.
var discardedPointer = WindowIndicatorPointerState()
try! discardedPointer.accept(WindowIndicatorPointerEvent(sequence: 1, phase: .down, point: point))
discardedPointer.inputSettled()
try! discardedPointer.discardStaleGeometry(WindowIndicatorPointerEvent(sequence: 2, phase: .move, point: point))
check(!discardedPointer.pressed && discardedPointer.sequence == 2)
try! discardedPointer.discardStaleGeometry(WindowIndicatorPointerEvent(sequence: 3, phase: .up, point: point))
check(!discardedPointer.pressed && discardedPointer.sequence == 3)
check((try? discardedPointer.discardStaleGeometry(WindowIndicatorPointerEvent(sequence: 2, phase: .move, point: point))) == nil)
try! discardedPointer.accept(WindowIndicatorPointerEvent(sequence: 4, phase: .down, point: point))
check(discardedPointer.pressed)
let highTarget = WindowIdentity(windowId: 11, pid: 123, processStartedAt: 999, layer: 102,
    bounds: window.bounds, title: "QA")
let highTargetEntry = entry(11, pid: 123, layer: 102, bounds: window.bounds, title: "QA")
check(windowIndicatorStackState([entry(22, layer: 102), entry(33, pid: 999, layer: 102), highTargetEntry],
    target: highTarget, targetStartedAt: 999, panelId: 22, panelPID: 456, panelBounds: panelBounds,
    expectedLayer: 102, elevated: false) == .orderChanged)
check(windowIndicatorStackState([entry(22, layer: 102), entry(33, pid: 999, layer: 102), highTargetEntry],
    target: highTarget, targetStartedAt: 999, panelId: 22, panelPID: 456, panelBounds: panelBounds,
    expectedLayer: 102, elevated: true) != .safe)
check(windowIndicatorStackState([entry(33, pid: 123, layer: 102), entry(22, layer: 102), highTargetEntry],
    target: highTarget, targetStartedAt: 999, panelId: 22, panelPID: 456, panelBounds: panelBounds,
    expectedLayer: 102) == .safe)
check(windowIndicatorStackState([entry(22, layer: 0), highTargetEntry], target: highTarget,
    targetStartedAt: 999, panelId: 22, panelPID: 456, panelBounds: panelBounds, expectedLayer: 0) != .safe)

// Visible placement transitions cannot retain a stale surface outside the
// live target, or hide an unsafe old z-order behind the new-frame promise.
let outsideOld = Rect(x: -150, y: 100, width: 35, height: 35)
check(windowIndicatorPlacementState([entry(22, bounds: outsideOld), target], target: window,
    targetStartedAt: 999, panelId: 22, panelPID: 456, previousBounds: outsideOld, previousLayer: 0,
    bounds: newSmall, layer: 0) == .panelChanged)
check(windowIndicatorPlacementState([entry(22, bounds: outsideOld), target], target: window,
    targetStartedAt: 999, panelId: 22, panelPID: 456, previousBounds: outsideOld, previousLayer: 0,
    bounds: newSmall, layer: 0, previousVisible: false) == .panelUnavailable)
check(windowIndicatorPlacementState([entry(22, bounds: oldSmall), entry(33, pid: 999, bounds: oldSmall), target],
    target: window, targetStartedAt: 999, panelId: 22, panelPID: 456, previousBounds: oldSmall, previousLayer: 0,
    bounds: newSmall, layer: 0) == .orderChanged)
check(windowIndicatorPlacementState([entry(22, bounds: oldSmall), entry(33, pid: 0, bounds: oldSmall), target],
    target: window, targetStartedAt: 999, panelId: 22, panelPID: 456, previousBounds: oldSmall, previousLayer: 0,
    bounds: newSmall, layer: 0) == .metadataInvalid)
// Revoked menu/movement elevation cannot leave old painted pixels above a
// covering window while waiting for the new target-relative placement.
for previousElevated in [nil, false, true] as [Bool?] {
    let oldOverlay = windowIndicatorPlacementState([entry(22, layer: 102, bounds: oldSmall), foreground, target],
        target: window, targetStartedAt: 999, panelId: 22, panelPID: 456,
        previousBounds: oldSmall, previousLayer: 102, bounds: newSmall, layer: 0,
        elevated: false, previousElevated: previousElevated)
    check(oldOverlay != .safe && oldOverlay != .panelUnavailable)
}

// A fresh menu surface is private visual context. Its hotspot can leave the
// root, but the root grant, same process identity and exact popup layer remain.
// Startup, new plans and ongoing placement share the same lifecycle gate.
// A missing/focused-only observer must not pass via nil-as-zero generation.
for supported in [nil, false] as [Bool?] {
    check(!windowIndicatorMenuLifecycleIsCurrent(hasMenus: true, supported: supported, captured: 0, current: 0))
    check(!windowIndicatorMenuLifecycleIsCurrent(hasMenus: true, supported: supported, captured: nil, current: nil))
    check(windowIndicatorMenuLifecycleIsCurrent(hasMenus: false, supported: supported, captured: nil, current: nil))
    check(windowIndicatorMenuLifecycleIsCurrent(hasMenus: false, supported: supported, captured: 0, current: 1))
}
check(!windowIndicatorMenuLifecycleIsCurrent(hasMenus: true, supported: true, captured: nil, current: 0))
check(!windowIndicatorMenuLifecycleIsCurrent(hasMenus: true, supported: true, captured: 0, current: nil))
check(windowIndicatorMenuLifecycleIsCurrent(hasMenus: true, supported: true, captured: 0, current: 0))
check(!windowIndicatorMenuLifecycleIsCurrent(hasMenus: true, supported: true, captured: 0, current: 1))
check(windowIndicatorMenuLifecycleIsCurrent(hasMenus: true, supported: true, captured: 1, current: 1))
let narrowMenu = WindowIdentity(windowId: 71, pid: 123, processStartedAt: 999, layer: 101,
    bounds: Rect(x: 650, y: 100, width: 180, height: 32), title: "Menu")
let menuPoint = WindowInputPoint(x: 700.25, y: 115.5)
let menuRequestData = data("click", ["menuSurface": narrowMenu.json, "point": ["x": menuPoint.x, "y": menuPoint.y]])
let menuRequest = try! parseWindowIndicatorRequest(menuRequestData)
check(menuRequest.window.windowId == window.windowId && menuRequest.menuSurface?.windowId == 71)
check(!window.bounds.contains(x: menuPoint.x, y: menuPoint.y))
let menuGeometry = windowIndicatorGeometry(menuRequest)!
check(menuGeometry.surface.width == 36 && menuGeometry.surface.height == 36)
check(!narrowMenu.bounds.contains(menuGeometry.surface))
check(windowIndicatorMenuDrawingBounds(narrowMenu).contains(menuGeometry.surface))
check((try? windowIndicatorUpdate(menuRequestData, frozenWindow: window)) != nil)
for op in ["drag", "doubleClick", "rightClick"] {
    check((try? parseWindowIndicatorRequest(data(op, ["menuSurface": narrowMenu.json,
        "point": ["x": menuPoint.x, "y": menuPoint.y]]))) == nil)
}
for (key, value) in [("pid", 124), ("windowId", 11), ("processStartedAt", 1000), ("layer", 0),
    ("layer", 24), ("layer", 102), ("pid", true), ("title", NSNull()), ("extra", true)] as [(String, Any)] {
    var changedMenu = narrowMenu.json; changedMenu[key] = value
    check((try? parseWindowIndicatorRequest(data("click", ["menuSurface": changedMenu,
        "point": ["x": menuPoint.x, "y": menuPoint.y]]))) == nil)
}
check((try? parseWindowIndicatorRequest(data("click", ["menuSurface": NSNull()]))) == nil)
for outside in [WindowInputPoint(x: 649, y: 115), WindowInputPoint(x: 700, y: 132),
    WindowInputPoint(x: 830, y: 115), WindowInputPoint(x: 700, y: 99)] {
    check((try? parseWindowIndicatorRequest(data("click", ["menuSurface": narrowMenu.json,
        "point": ["x": outside.x, "y": outside.y]]))) == nil)
}
let menuPointer = try! JSONSerialization.data(withJSONObject: ["pointer": ["sequence": 1, "phase": "down",
    "point": ["x": menuPoint.x, "y": menuPoint.y]]])
check((try? windowIndicatorCommand(menuPointer, frozenWindow: window)) == nil)

// The fixed menu overhang does not authorize the holes of a large enclosing
// rectangle. Continuous curves prove every whole segment surface in the union.
let menuRegions = windowIndicatorRegions(anchor: window, menus: [narrowMenu])!
let menuRegionBounds = windowIndicatorRegionBounds(menuRegions)!
let menuRouteStart = WindowInputPoint(x: 550, y: 115.5)
let menuRoute = windowIndicatorRoute(from: menuRouteStart, to: menuPoint,
    bounds: menuRegionBounds, regions: menuRegions)!
check(menuRoute.start == menuRouteStart && menuRoute.end == menuPoint)
for segment in menuRoute.segments {
    check(windowIndicatorRegionsContain(segment.geometry.surface, regions: menuRegions))
    for step in 0...100 {
        let sample = segment.curve.point(Double(step) / 100)
        let small = windowIndicatorSmallGeometry(point: sample, bounds: menuRegionBounds,
            directions: (segment.geometry.xDirection, segment.geometry.yDirection), regions: menuRegions)!
        check(small.surface.width <= 36 && small.surface.height <= 36)
        check(windowIndicatorRegionsContain(small.surface, regions: menuRegions))
    }
}
let disconnected = [Rect(x: 0, y: 0, width: 100, height: 100), Rect(x: 200, y: 0, width: 100, height: 100)]
check(windowIndicatorRegionBounds(disconnected)!.contains(Rect(x: 90, y: 25, width: 120, height: 35)))
check(!windowIndicatorRegionsContain(Rect(x: 90, y: 25, width: 120, height: 35), regions: disconnected))
check(windowIndicatorRoute(from: WindowInputPoint(x: 50, y: 50), to: WindowInputPoint(x: 250, y: 50),
    bounds: windowIndicatorRegionBounds(disconnected)!, regions: disconnected) == nil)
check(windowIndicatorRegionsContain(Rect(x: 75, y: 20, width: 50, height: 35),
    regions: [Rect(x: 0, y: 0, width: 100, height: 100), Rect(x: 100, y: 0, width: 100, height: 100)]))
check(!windowIndicatorRegionsContain(Rect(x: 75, y: 20, width: 50, height: 35),
    regions: [Rect(x: 0, y: 0, width: 100, height: 100), Rect(x: 100, y: 30, width: 100, height: 100)]))
check(windowIndicatorRegions(anchor: window, menus: [narrowMenu, narrowMenu]) == nil)

let menuEntry = entry(71, pid: 123, layer: 101, bounds: narrowMenu.bounds, title: "Menu")
let menuPanel = entry(22, layer: 102, bounds: menuGeometry.surface, title: "Pointer")
func menuStack(_ entries: [WindowIndicatorStackEntry], layer: Int32 = 102) -> WindowIndicatorReason {
    windowIndicatorStackState(entries, target: window, targetStartedAt: 999, panelId: 22, panelPID: 456,
        panelBounds: menuGeometry.surface, expectedLayer: layer, elevated: true, menuSurfaces: [narrowMenu])
}
check(menuStack([menuPanel, menuEntry, target]) == .safe)
check(menuStack([menuPanel, menuEntry]) == .targetUnavailable)
check(menuStack([menuPanel, target]) == .menuUnavailable)
check(menuStack([menuPanel, menuEntry, menuEntry, target]) == .menuUnavailable)
check(menuStack([menuEntry, menuPanel, target]) == .orderChanged)
check(menuStack([entry(22, layer: 0, bounds: menuGeometry.surface), menuEntry, target], layer: 0) != .safe)
for changed in [entry(71, pid: 124, layer: 101, bounds: narrowMenu.bounds, title: "Menu"),
    entry(71, pid: 123, layer: 24, bounds: narrowMenu.bounds, title: "Menu"),
    entry(71, pid: 123, layer: 101, bounds: narrowMenu.bounds, title: "Other"),
    entry(71, pid: 123, layer: 101, bounds: narrowMenu.bounds, title: "Menu", onScreen: false),
    entry(71, pid: 123, layer: 101, bounds: Rect(x: 651, y: 100, width: 180, height: 32), title: "Menu")] {
    check(menuStack([menuPanel, changed, target]) == .menuUnavailable)
}
func menuSnapshot(_ entries: [WindowIndicatorStackEntry], point: WindowInputPoint? = menuPoint,
    bounds: Rect = menuGeometry.surface) -> [String: Any]? {
    windowIndicatorSnapshotProjection(entries, target: window, targetStartedAt: 999,
        panelId: 22, panelPID: 456, panelStartedAt: 888, panelBounds: bounds, expectedLayer: 102,
        menuSurface: narrowMenu, point: point)
}
check(menuSnapshot([menuPanel, menuEntry, target])?["shown"] as? Bool == true)
check(menuSnapshot([menuPanel, target]) == nil)
check(menuSnapshot([menuPanel, menuEntry, target], point: nil) == nil)
check(menuSnapshot([menuPanel, menuEntry, target], point: WindowInputPoint(x: 649, y: 115)) == nil)
check(menuSnapshot([menuPanel, menuEntry, target], point: WindowInputPoint(x: 701, y: 115)) == nil)
let expandedPanel = Rect(x: menuGeometry.surface.x, y: menuGeometry.surface.y, width: 37, height: 36)
check(menuSnapshot([entry(22, layer: 102, bounds: expandedPanel), menuEntry, target], bounds: expandedPanel) == nil)
// Root-to-menu transitions may retain only the known old surface under the
// original root ordering; a stale menu can never authorize that transition.
let rootStartGeometry = windowIndicatorSmallGeometry(point: menuRouteStart, bounds: window.bounds)!
check(windowIndicatorPlacementState([menuEntry, entry(22, bounds: rootStartGeometry.surface), target],
    target: window, targetStartedAt: 999, panelId: 22, panelPID: 456,
    previousBounds: rootStartGeometry.surface, previousLayer: 0, bounds: menuGeometry.surface, layer: 102,
    elevated: true, previousElevated: false, menuSurfaces: [narrowMenu]) == .panelUnavailable)
check(windowIndicatorPlacementState([entry(22, bounds: rootStartGeometry.surface), target],
    target: window, targetStartedAt: 999, panelId: 22, panelPID: 456,
    previousBounds: rootStartGeometry.surface, previousLayer: 0, bounds: menuGeometry.surface, layer: 102,
    elevated: true, previousElevated: false, menuSurfaces: [narrowMenu]) == .menuUnavailable)

print("indicatorPolicyChecks=\(checks)")
`);
      const sources = ['macos-click.swift', 'macos-semantic.swift', 'macos-window-input.swift', 'macos-window-input-focus.swift', 'macos-window-input-focus-taps.swift', 'macos-window-indicator.swift']
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
