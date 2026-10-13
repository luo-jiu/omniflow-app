import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('native directed window-input protocol', () => {
  it('refuses broad receiver eligibility and preserves exactly one cleanup after partial sequences', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-window-input-policy-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import Foundation
import AppKit
import CoreGraphics
var checks = 0
func check(_ value: Bool, _ detail: String = "") { checks += 1; guard value else { fatalError("Directed-input check \(checks) failed: \(detail)") } }
check(windowInputReceiverProfile(bundleIdentifier: "com.omniflow.window-input-qa", buildVersion: "1", shortVersion: "1.0") == "appkit-fixture-v1")
for bundle in [nil, "com.apple.TextEdit", "com.google.Chrome", "com.electron.Electron", "com.omniflow.window-input-qa\n"] as [String?] {
    check(windowInputReceiverProfile(bundleIdentifier: bundle, buildVersion: "1", shortVersion: "1.0") == nil)
}
for (build, version) in [(nil, "1.0"), ("1", nil), ("2", "1.0"), ("1", "1.1"), ("1", "1.0\n")] as [(String?, String?)] {
    check(windowInputReceiverProfile(bundleIdentifier: "com.omniflow.window-input-qa", buildVersion: build, shortVersion: version) == nil)
}
check(windowInputReceiverProfile(bundleIdentifier: "com.apple.TextEdit", buildVersion: "415", shortVersion: "1.20", systemBuild: "25F84") == "textedit-415-25f84-v1")
for systemBuild in [nil, "25F83", "25F84\n", "26.5.2"] as [String?] {
    check(windowInputReceiverProfile(bundleIdentifier: "com.apple.TextEdit", buildVersion: "415", shortVersion: "1.20", systemBuild: systemBuild) == nil)
}
for (build, version) in [(nil, "1.20"), ("414", "1.20"), ("415", "1.21")] as [(String?, String?)] {
    check(windowInputReceiverProfile(bundleIdentifier: "com.apple.TextEdit", buildVersion: build, shortVersion: version, systemBuild: "25F84") == nil)
}
check(windowInputProfileOperations("textedit-415-25f84-v1") == WindowInputOperation.allCases)
check(windowInputProfileOperations("unknown").isEmpty)
let treeRoles = ["AXWindow", "AXScrollArea", "AXTextArea", "AXMenu"]
check(!windowInputTransientFree(0, role: { treeRoles[$0] }, children: { node, _ in node < 3 ? [node + 1] : [] }))
check(windowInputTransientFree(0, role: { treeRoles[$0] }, children: { node, _ in node < 2 ? [node + 1] : [] }))
check(!windowInputTransientFree(0, role: { treeRoles[$0] }, children: { _, _ in [0] }, maximumNodes: 10))
check(!windowInputTransientFree(0, role: { _ in "AXWindow" }, children: { _, _ in nil }))
check(!windowInputTransientFree(0, role: { _ in nil }, children: { _, _ in [] }))
check(WindowInputShortcut(key: "escape", modifiers: []).valid)
check(!WindowInputShortcut(key: "a", modifiers: []).valid)
check(WindowInputShortcut(key: "a", modifiers: ["command", "shift", "option", "control"]).valid)
for modifiers in [["shift", "command"], ["command", "command"], ["ctrl"], ["control", "option"], ["command", "shift", "option", "control", "extra"]] {
    check(!WindowInputShortcut(key: "a", modifiers: modifiers).valid)
}
for key in ["A", "Enter", "left", "", "é", "f1", "constructor", "__proto__"] { check(!WindowInputShortcut(key: key, modifiers: []).valid) }
let window = WindowIdentity(windowId: 1, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: -100, y: 40, width: 760, height: 460), title: "QA")
func input(_ operation: String, extra: [String: Any] = [:]) -> Data {
    var request: [String: Any] = ["window": window.json, "profile": "appkit-fixture-v1", "operation": operation]
    for (key, value) in extra { request[key] = value }
    return try! JSONSerialization.data(withJSONObject: request)
}
check((try? parseWindowInputRequest(input("shortcut", extra: ["shortcut": ["key": "escape", "modifiers": []]]))) != nil)
check((try? parseWindowInputRequest(input("rightClick", extra: ["point": ["x": -99, "y": 41]]))) != nil)
check((try? parseWindowInputRequest(input("doubleClick", extra: ["point": ["x": -99, "y": 41]]))) != nil)
for operation in ["rightClick", "doubleClick"] {
    for extra in [[:], ["point": ["x": 660, "y": 41]], ["point": ["x": -99, "y": 500]],
        ["point": ["x": -99, "y": true]], ["point": ["x": -99, "y": 41, "extra": 1]],
        ["point": ["x": -99, "y": 41], "durationMs": 300],
        ["point": ["x": -99, "y": 41], "shortcut": ["key": "a", "modifiers": []]]] as [[String: Any]] {
        check((try? parseWindowInputRequest(input(operation, extra: extra))) == nil)
    }
}
for duration in [100, 300, 1000] {
    check((try? parseWindowInputRequest(input("drag", extra: ["point": ["x": -99, "y": 41], "endPoint": ["x": 0, "y": 100], "durationMs": duration]))) != nil)
}
for duration in [99, 1001, 1.5, true] as [Any] {
    check((try? parseWindowInputRequest(input("drag", extra: ["point": ["x": -99, "y": 41], "endPoint": ["x": 0, "y": 100], "durationMs": duration]))) == nil)
}
check((try? parseWindowInputRequest(input("drag", extra: ["point": ["x": 0, "y": 100], "endPoint": ["x": 0, "y": 100], "durationMs": 300]))) == nil)
check((try? parseWindowInputRequest(input("shortcut", extra: ["shortcut": ["key": "a", "modifiers": [], "extra": 1]]))) == nil)
check((try? parseWindowInputRequest(input("shortcut", extra: ["shortcut": ["key": "a", "modifiers": ["command"]], "point": ["x": 0, "y": 100]]))) == nil)
check((try? parseWindowInputRequest(Data("{\"operation\":\"drag\",\"operation\":\"shortcut\"}".utf8))) == nil)

// Construct and round-trip real event objects without posting, opening a
// window or creating NSApplication. This verifies the AppKit/CG bridge retains
// representable positive Int16 press identities, not merely a pure model.
let source = CGEventSource(stateID: .privateState)!
let point = WindowInputPoint(x: -99, y: 41)
func pressNumber(_ event: CGEvent) -> Int64 {
    let number = event.getIntegerValueField(.mouseEventNumber)
    check(number > 0 && number <= Int64(Int16.max), "CG number \(number), event type \(event.type.rawValue)")
    check(NSEvent(cgEvent: event)?.eventNumber == Int(number), "CG number \(number), AppKit number \(String(describing: NSEvent(cgEvent: event)?.eventNumber)), event type \(event.type.rawValue)")
    return number
}
for number in [Int16(1), Int16(16384), Int16.max] {
    for type in [NSEvent.EventType.leftMouseDown, .leftMouseDragged, .leftMouseUp] {
        let event = try windowInputMouseEvent(type, point: point, window: window,
            clickCount: 1, eventNumber: number, source: source)
        check(pressNumber(event) == Int64(number))
    }
}
func preparedMouseEvents(_ operation: String, extra: [String: Any]) throws -> [WindowInputEvent] {
    try prepareWindowInputEvents(parseWindowInputRequest(input(operation, extra: extra)), source: source)
}
let rightEvents = try preparedMouseEvents("rightClick", extra: ["point": ["x": -99, "y": 41]])
check(rightEvents.count == 2)
check(pressNumber(rightEvents[0].event) == pressNumber(rightEvents[1].event))
check(pressNumber(rightEvents[0].release!) == pressNumber(rightEvents[0].event))
let doubleEvents = try preparedMouseEvents("doubleClick", extra: ["point": ["x": -99, "y": 41]])
check(doubleEvents.count == 4)
let firstPress = pressNumber(doubleEvents[0].event), secondPress = pressNumber(doubleEvents[2].event)
check(secondPress == firstPress + 1)
for index in [0, 2] {
    check(pressNumber(doubleEvents[index + 1].event) == pressNumber(doubleEvents[index].event))
    check(pressNumber(doubleEvents[index].release!) == pressNumber(doubleEvents[index].event))
    check(doubleEvents[index].event.getIntegerValueField(.mouseEventClickState) == Int64(index / 2 + 1))
}
for duration in [100, 300, 1000] {
    let events = try preparedMouseEvents("drag", extra: ["point": ["x": -99, "y": 41],
        "endPoint": ["x": 0, "y": 100], "durationMs": duration])
    let number = pressNumber(events[0].event)
    check(events[0].event.type == .leftMouseDown && events.last!.event.type == .leftMouseUp)
    for step in events {
        check(pressNumber(step.event) == number)
        if let release = step.release { check(pressNumber(release) == number) }
    }
    // Interrupt every native construction boundary. The captured callback is
    // deliberately read-only: it records objects instead of sending input.
    let directed = events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
        release: $0.release, completesRelease: $0.completesRelease) }
    for boundary in 1..<events.count {
        var validation = 0
        var captured: [CGEvent] = []
        do {
            _ = try runDirectedInputSequence(directed, wait: { _ in }, validate: {
                validation += 1
                if validation == boundary + 1 { throw windowInputError("cancelled") }
            }, canRelease: { true }, post: { captured.append($0) })
            fatalError("Native pairing cancellation must reject")
        } catch let error as WindowInputExecutionError {
            check(error.releaseSent && captured.filter { $0.type == .leftMouseUp }.count == 1)
            check(captured.allSatisfy { pressNumber($0) == number })
            check(captured.last!.type == .leftMouseUp)
        }
    }
}

let down = DirectedInputStep(event: "down", delayBeforeMs: 0, release: "up", completesRelease: false)
let drag = DirectedInputStep<String>(event: "dragged", delayBeforeMs: 10, release: nil, completesRelease: false)
let up = DirectedInputStep<String>(event: "up", delayBeforeMs: 10, release: nil, completesRelease: true)
var posts: [String] = []
let success = try runDirectedInputSequence([down, drag, up], wait: { _ in }, validate: {}, canRelease: { true }, post: { posts.append($0) })
check(posts == ["down", "dragged", "up"] && success.eventCount == 3 && success.releaseSent)

// Cancel before the first post: known not-dispatched, without an orphan up.
posts = []
do {
    _ = try runDirectedInputSequence([down, drag, up], wait: { _ in }, validate: { throw windowInputError("cancelled") }, canRelease: { true }, post: { posts.append($0) })
    fatalError("Pre-dispatch cancellation must reject")
} catch let error as HelperError { check(!error.unknown && posts.isEmpty) }

// Every boundary after down, including delay and validation, releases exactly
// once. A confirmed cleanup still leaves the original gesture unknown.
for failingBoundary in [1, 2, 3] {
    posts = []
    var validation = 0
    do {
        _ = try runDirectedInputSequence([down, drag, up], wait: { _ in }, validate: {
            validation += 1
            if validation == failingBoundary + 1 { throw windowInputError("cancelled") }
        }, canRelease: { true }, post: { posts.append($0) })
        fatalError("Post-dispatch cancellation must reject")
    } catch let error as WindowInputExecutionError {
        check(error.releaseSent && error.eventCount == posts.count && posts.filter { $0 == "up" }.count == 1)
    }
}
posts = []
var waits = 0
do {
    _ = try runDirectedInputSequence([down, drag, up], wait: { _ in waits += 1; if waits == 2 { throw windowInputError("cancelled") } },
        validate: {}, canRelease: { true }, post: { posts.append($0) })
    fatalError("Delay cancellation must reject")
} catch let error as WindowInputExecutionError { check(error.releaseSent && posts == ["down", "up"] && error.eventCount == 2) }

// Restarted PID and a different focused window in the same process both forbid
// sending the saved cleanup into another receiver.
var calls = 0
for reason in ["target_changed", "focused_window_mismatch"] {
    posts = []
    calls = 0
    do {
        _ = try runDirectedInputSequence([down, drag, up], wait: { _ in }, validate: {
            calls += 1; if calls == 2 { throw windowInputError(reason) }
        }, canRelease: { false }, post: { posts.append($0) })
        fatalError("Changed receiver must reject")
    } catch let error as WindowInputExecutionError { check(!error.releaseSent && posts == ["down"] && error.eventCount == 1) }
}

// A drag's cleanup stays at the last posted point, never at its planned end.
posts = []
calls = 0
let draggedCurrent = DirectedInputStep(event: "dragged-current", delayBeforeMs: 10, release: "up-current", completesRelease: false)
do {
    _ = try runDirectedInputSequence([down, draggedCurrent, up], wait: { _ in }, validate: {
        calls += 1; if calls == 3 { throw windowInputError("cancelled") }
    }, canRelease: { true }, post: { posts.append($0) })
    fatalError("Mid-drag cancellation must reject")
} catch let error as WindowInputExecutionError {
    check(error.releaseSent && posts == ["down", "dragged-current", "up-current"] && error.eventCount == 3)
}

// Stop between the two clicks: the completed first click has no pending up.
posts = []
calls = 0
do {
    _ = try runDirectedInputSequence([down, up, down, up], wait: { _ in }, validate: {
        calls += 1; if calls == 3 { throw windowInputError("cancelled") }
    }, canRelease: { true }, post: { posts.append($0) })
    fatalError("Partial double click must reject")
} catch let error as WindowInputExecutionError { check(error.releaseSent && posts == ["down", "up"] && error.eventCount == 2) }
print("directedInputChecks=\(checks)")
`);
      const sources = ['macos-click.swift', 'macos-semantic.swift', 'macos-window-input.swift']
        .map(name => fileURLToPath(new URL(`./${name}`, import.meta.url)));
      const binary = path.join(directory, 'window-input-policy');
      const compiled = spawnSync('/usr/bin/xcrun', ['swiftc', ...sources, harness, '-o', binary], { encoding: 'utf8', timeout: 30_000 });
      expect(compiled.status, compiled.stderr).toBe(0);
      const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/directedInputChecks=\d+/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 45_000);
});
