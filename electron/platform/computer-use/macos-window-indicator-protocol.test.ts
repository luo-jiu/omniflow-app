import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// These checks call pure parsing, stream framing, bounded event-drain, geometry and ordering recovery policy only. They never
// create a panel, read an AX tree, capture the display or post input.
describe.skipIf(process.platform !== 'darwin')('native window indicator policy', () => {
  it('strictly binds persistent updates and keeps one small arrow inside its frozen window', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-indicator-policy-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import AppKit
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
