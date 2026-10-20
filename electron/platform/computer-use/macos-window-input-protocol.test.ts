import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('native directed window-input protocol', () => {
  it('validates bounded directed receivers, private Unicode and exactly one cleanup after partial sequences', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-window-input-policy-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import Foundation
import AppKit
import CoreGraphics
import Darwin
var checks = 0
func check(_ value: Bool, _ detail: String = "") { checks += 1; guard value else { fatalError("Directed-input check \(checks) failed: \(detail)") } }
check(windowInputReceiverProfile(bundleIdentifier: "com.omniflow.window-input-qa", buildVersion: "1", shortVersion: "1.0") == "appkit-fixture-v1")
for bundle in [nil, "", "Electron", "com.omniflow.window-input-qa\n", "com.example.app\u{202e}"] as [String?] {
    check(windowInputReceiverProfile(bundleIdentifier: bundle, buildVersion: "1", shortVersion: "1.0") == nil)
}
for (build, version) in [(nil, "1.0"), ("1", nil), ("2", "1.0"), ("1", "1.1"), ("1", "1.0\n")] as [(String?, String?)] {
    check(windowInputReceiverProfile(bundleIdentifier: "com.omniflow.window-input-qa", buildVersion: build, shortVersion: version) == nil)
}
check(windowInputReceiverProfile(bundleIdentifier: "com.apple.TextEdit", buildVersion: "415", shortVersion: "1.20", systemBuild: "25F84") == "textedit-415-25f84-v1")
for bundle in ["com.apple.TextEdit", "com.google.Chrome", "com.github.Electron", "com.jetbrains.WebStorm"] {
    check(windowInputReceiverProfile(bundleIdentifier: bundle, buildVersion: "1", shortVersion: "1.0") == "directed-v1")
}
for systemBuild in [nil, "25F83", "25F84\n", "26.5.2"] as [String?] {
    check(windowInputReceiverProfile(bundleIdentifier: "com.apple.TextEdit", buildVersion: "415", shortVersion: "1.20", systemBuild: systemBuild) == "directed-v1")
}
for (build, version) in [(nil, "1.20"), ("415", nil), ("", "1.20"), ("415\n", "1.20")] as [(String?, String?)] {
    check(windowInputReceiverProfile(bundleIdentifier: "com.apple.TextEdit", buildVersion: build, shortVersion: version, systemBuild: "25F84") == nil)
}
check(windowInputProfileOperations("textedit-415-25f84-v1") == WindowInputOperation.allCases)
check(windowInputProfileOperations("directed-v1") == WindowInputOperation.allCases)
check(windowInputProfileOperations("unknown").isEmpty)
let treeRoles = ["AXWindow", "AXScrollArea", "AXTextArea", "AXMenu"]
check(!windowInputTransientFree(0, role: { treeRoles[$0] }, children: { node, _ in node < 3 ? [node + 1] : [] }))
check(windowInputTransientFree(0, role: { treeRoles[$0] }, children: { node, _ in node < 2 ? [node + 1] : [] }))
check(!windowInputTransientFree(0, role: { treeRoles[$0] }, children: { _, _ in [0] }, maximumNodes: 10))
check(!windowInputTransientFree(0, role: { _ in "AXWindow" }, children: { _, _ in nil }))
check(!windowInputTransientFree(0, role: { _ in nil }, children: { _, _ in [] }))
func focusedChain(_ roles: [String?], maximumDepth: Int = 32) -> WindowInputFocusedChainState {
    windowInputFocusedChainState(0, equal: ==, role: { roles[$0] }, parent: { $0 + 1 < roles.count ? $0 + 1 : nil }, maximumDepth: maximumDepth)
}
check(focusedChain(["AXTextArea", "AXGroup", "AXWindow"]) == .ordinary)
check(focusedChain(["AXTextArea", "AXGroup", nil]) == .unknown, "A partial unrelated IDE focus is not a keyboard-binding failure for pointers")
check(focusedChain([nil]) == .unknown)
check(focusedChain(["AXTextArea"]) == .unknown)
check(focusedChain(["AXGroup", "AXGroup", "AXWindow"], maximumDepth: 1) == .unknown)
check(windowInputFocusedChainState(0, equal: ==, role: { _ in "AXGroup" }, parent: { _ in 0 }) == .unknown)
for role in ["AXMenu", "AXMenuItem", "AXMenuBar", "AXMenuBarItem", "AXSheet", "AXPopover"] {
    check(focusedChain(["AXTextArea", role, "AXWindow"]) == .transient)
    check(focusedChain([role, nil]) == .transient, "A known transient rejects without requiring a complete parent chain")
}
check(WindowInputShortcut(key: "escape", modifiers: []).valid)
check(!WindowInputShortcut(key: "a", modifiers: []).valid)
check(WindowInputShortcut(key: "a", modifiers: ["command", "shift", "option", "control"]).valid)
for modifiers in [["shift", "command"], ["command", "command"], ["ctrl"], ["control", "option"], ["command", "shift", "option", "control", "extra"]] {
    check(!WindowInputShortcut(key: "a", modifiers: modifiers).valid)
}
for key in ["A", "Enter", "left", "", "é", "f1", "constructor", "__proto__"] { check(!WindowInputShortcut(key: key, modifiers: []).valid) }
let window = WindowIdentity(windowId: 1, pid: 123, processStartedAt: 999, layer: 0,
    bounds: Rect(x: -100, y: 40, width: 760, height: 460), title: "QA")
for profile in ["directed-v1", "appkit-fixture-v1", "textedit-415-25f84-v1"] {
    for foreground in [false, true] {
        for keyboard in [false, true] {
            check(windowInputRequiresFocusedWindow(profile: profile, targetIsForeground: foreground,
                requiresFocusedElement: keyboard) == (profile != "directed-v1" || foreground || keyboard),
                "Foreground pointers require the exact focused native window, not merely the same PID")
        }
    }
}
for inherited in [false, true] {
    for command in [false, true] {
        for protected in [false, true] {
            let route = windowInputDispatchFocusRoute(targetIsForeground: true, inheritedFocus: inherited,
                commandClick: command, protectedFocus: protected)
            check(route == .foreground && route != .safe && route != .command,
                "Real foreground input never synthesizes focus or Command, including a retained owner")
        }
    }
}
check(windowInputDispatchFocusRoute(targetIsForeground: false, inheritedFocus: true, commandClick: false, protectedFocus: true) == .alreadyFocused)
check(windowInputDispatchFocusRoute(targetIsForeground: false, inheritedFocus: false, commandClick: true, protectedFocus: true) == .command)
check(windowInputDispatchFocusRoute(targetIsForeground: false, inheritedFocus: false, commandClick: false, protectedFocus: true) == .safe)
check(windowInputDispatchFocusRoute(targetIsForeground: false, inheritedFocus: false, commandClick: false, protectedFocus: false) == .plain)
do {
    var owner = WindowInputFocusPreventerPolicy(targetPID: 10, servicePID: 99, auxiliaryPID: 40, currentFocusPID: 10)
    check(owner.allowsForegroundPassthrough(actualFocusPID: 10))
    check(!owner.allowsForegroundPassthrough(actualFocusPID: nil))
    check(!owner.allowsForegroundPassthrough(actualFocusPID: 20))
    owner.currentFocusPID = 20
    check(!owner.allowsForegroundPassthrough(actualFocusPID: 10), "Workspace foreground cannot replace the owner tracker")
    owner.currentFocusPID = 10
    owner.pending = WindowInputFocusPending(thiefPID: 10, originalTargetPID: 20)
    check(!owner.allowsForegroundPassthrough(actualFocusPID: 10), "A pending keyboard reroute cannot enter foreground input")
    owner.pending = nil; owner.releaseFailed = true
    check(!owner.allowsForegroundPassthrough(actualFocusPID: 10))
    let fresh = WindowInputFocusSession(window: window)
    try fresh.requireForegroundPassthrough()
    check(fresh.snapshot.state == .inactive && fresh.snapshot.postedCount == 0,
        "Foreground readiness must not create a focus owner, tap or synthetic focus event")
}
let fixtureFocusToken = String(repeating: "a", count: 64)
let focusParents = [1: 0, 2: 1, 3: 1]
let focusChildren = [0: [1], 1: [2, 3]]
func focusPath(_ focus: Int) -> [Int]? {
    windowInputFocusPath(focus, root: 0, equal: ==, parent: { focusParents[$0] },
        children: { node, limit in Array((focusChildren[node] ?? []).prefix(limit)) })
}
check(focusPath(2) == [0, 0] && focusPath(3) == [0, 1])
check(windowInputFocusPath(2, root: 0, equal: ==, parent: { _ in 2 }, children: { _, _ in [2] }) == nil)
check(windowInputFocusPath(2, root: 0, equal: ==, parent: { _ in 0 }, children: { _, _ in [2, 2] }) == nil)
check(windowInputFocusPath(2, root: 0, equal: ==, parent: { _ in 0 }, children: { _, _ in [] }) == nil)
let fieldBounds = Rect(x: -50, y: 80, width: 100, height: 40)
func focusFingerprint(_ path: [Int], role: String = "AXTextField", subrole: String? = "AXTextField", identifier: String? = nil,
                      subroleDeclared: Bool = true, identifierDeclared: Bool = false, bounds: Rect = fieldBounds) -> String? {
    windowInputFocusFingerprint(window: window, path: path, role: role, subrole: subrole, identifier: identifier,
        subroleDeclared: subroleDeclared, identifierDeclared: identifierDeclared, bounds: bounds)
}
let focusA = focusFingerprint(focusPath(2)!)!, focusB = focusFingerprint(focusPath(3)!)!
check(validWindowInputFocusToken(focusA) && validWindowInputFocusToken(focusB) && focusA != focusB)
check(focusFingerprint([0, 0]) == focusA, "The same control stays stable across helper requests")
check(focusFingerprint([0, 0], role: "AXTextArea") != focusA)
check(focusFingerprint([0, 0], identifier: "control-B") != focusA)
check(focusFingerprint([0, 0], identifierDeclared: true) != focusA)
check(focusFingerprint([0, 0], bounds: Rect(x: -49, y: 80, width: 100, height: 40)) != focusA)
check(focusFingerprint([64]) == nil)
check(windowInputTextFocusRoleSafe("AXTextField", subrole: "AXTextField"))
check(windowInputTextFocusRoleSafe("AXTextField", subrole: "AXSearchField"))
check(windowInputTextFocusRoleSafe("AXTextArea", subrole: nil))
check(!windowInputTextFocusRoleSafe("AXTextArea", subrole: "AXSecureTextArea"))
check(!windowInputTextFocusRoleSafe("AXWindow", subrole: nil))
for subrole in [nil, "", "AXUnknown", "AXSecureTextField"] as [String?] {
    check(!windowInputTextFocusRoleSafe("AXTextField", subrole: subrole))
}
for role in ["AXSecureTextArea", "AXMenu", "AXSheet", "AXApplication"] {
    check(!windowInputTextFocusRoleSafe(role, subrole: nil))
}
func textFocusNodeSafe(_ role: String, subrole: String?, error: AXError = .success) -> Bool {
    windowInputTextFocusNodeSafe { attribute in
        if attribute == "AXRole" { return (.success, role as CFString) }
        check(attribute == "AXSubrole", "Safety guards must not read input content")
        return (error, subrole.map { $0 as CFString })
    }
}
check(["AXTextField", "AXUnknown", "AXSecureTextField"].map { textFocusNodeSafe("AXTextField", subrole: $0) } == [true, false, false],
      "The same TextField becoming unknown or secure stops later chunks")
check(["AXTextArea", "AXSecureTextArea"].map { textFocusNodeSafe("AXTextArea", subrole: $0) } == [true, false],
      "The same TextArea or ancestor gaining a secure subrole stops text")
check(textFocusNodeSafe("AXTextArea", subrole: nil, error: .attributeUnsupported))
check(textFocusNodeSafe("AXTextArea", subrole: nil, error: .noValue))
check(!textFocusNodeSafe("AXTextArea", subrole: nil, error: .cannotComplete))
check(!textFocusNodeSafe("AXTextField", subrole: nil, error: .attributeUnsupported))
func input(_ operation: String, extra: [String: Any] = [:]) -> Data {
    var request: [String: Any] = ["window": window.json, "profile": "appkit-fixture-v1", "operation": operation]
    if operation == "typeText" { request["focusToken"] = fixtureFocusToken }
    for (key, value) in extra { request[key] = value }
    return try! JSONSerialization.data(withJSONObject: request)
}
check((try? parseWindowInputRequest(input("shortcut", extra: ["shortcut": ["key": "escape", "modifiers": []]]))) != nil)
check((try? parseWindowInputRequest(input("rightClick", extra: ["point": ["x": -99, "y": 41]]))) != nil)
check((try? parseWindowInputRequest(input("doubleClick", extra: ["point": ["x": -99, "y": 41]]))) != nil)
check((try? parseWindowInputRequest(input("click", extra: ["point": ["x": -99, "y": 41]]))) != nil)
let completionWindow = WindowIdentity(windowId: 2, pid: window.pid, processStartedAt: window.processStartedAt, layer: 0,
    bounds: Rect(x: -90, y: 60, width: 700, height: 400), title: nil)
let associatedRightClick = try parseWindowInputRequest(input("rightClick", extra: ["profile": "directed-v1",
    "point": ["x": -99, "y": 41], "completionWindow": completionWindow.json]))
check(associatedRightClick.completionWindow?.windowId == 2 && associatedRightClick.window.windowId == 1)
for operation in ["click", "doubleClick", "scroll", "typeText", "shortcut", "drag"] {
    check((try? parseWindowInputRequest(input(operation, extra: ["profile": "directed-v1", "point": ["x": -99, "y": 41],
        "completionWindow": completionWindow.json]))) == nil)
}
check((try? parseWindowInputRequest(input("rightClick", extra: ["point": ["x": -99, "y": 41], "completionWindow": completionWindow.json]))) == nil)
for changed in [
    WindowIdentity(windowId: 1, pid: window.pid, processStartedAt: window.processStartedAt, layer: 0, bounds: completionWindow.bounds, title: nil),
    WindowIdentity(windowId: 2, pid: window.pid + 1, processStartedAt: window.processStartedAt, layer: 0, bounds: completionWindow.bounds, title: nil),
    WindowIdentity(windowId: 2, pid: window.pid, processStartedAt: window.processStartedAt! + 1, layer: 0, bounds: completionWindow.bounds, title: nil),
    WindowIdentity(windowId: 2, pid: window.pid, processStartedAt: window.processStartedAt, layer: 102, bounds: completionWindow.bounds, title: nil),
    WindowIdentity(windowId: 2, pid: window.pid, processStartedAt: window.processStartedAt, layer: 0, bounds: Rect(x: -101, y: 60, width: 700, height: 400), title: nil)
] {
    check((try? parseWindowInputRequest(input("rightClick", extra: ["profile": "directed-v1", "point": ["x": -99, "y": 41],
        "completionWindow": changed.json]))) == nil, "No other process, original window, raised surface or expanded capture bounds can become a completion")
    check(!windowInputCompletionSurfaceMatches(changed, expected: completionWindow))
}
check(windowInputCompletionSurfaceMatches(completionWindow, expected: completionWindow))
for operation in WindowInputOperation.allCases {
    for count in 0...3 {
        check(windowInputCompletionPhaseAllowed(operation: operation, postedEventCount: count) == (operation == .rightClick && (1...2).contains(count)),
            "Only the original right-up and completion, never another press, can accept a handoff")
    }
}
// A foreground classification is deliberately insufficient without the
// independent exact completion receiver/focus proof. Exercise all operation,
// phase, process, profile, association and proof combinations.
for profile in ["directed-v1", "appkit-fixture-v1", "textedit-415-25f84-v1", "unknown"] {
    for operation in WindowInputOperation.allCases {
        for count in 0...3 {
            for current in [nil, 0, 10, window.pid, window.pid + 1] as [Int32?] {
                for bound in [false, true] {
                    let route = windowInputForegroundCheck(profile: profile, operation: operation, postedEventCount: count,
                        originalForegroundPID: 10, targetPID: window.pid, currentForegroundPID: current, completionBound: bound)
                    let original = current == 10
                    let candidate = !original && current == window.pid && profile == "directed-v1" && bound
                        && operation == .rightClick && (1...2).contains(count)
                    check(route == (original ? .original : candidate ? .completionRequired : .rejected))
                    for verified in [false, true] {
                        check(windowInputForegroundAllowed(route, completionVerified: verified) == (original || candidate && verified),
                            "No pre-down, unrelated app, legacy profile or unproved same-PID window may bypass foreground admission")
                    }
                }
            }
        }
    }
}
for (original, target, current) in [(Int32(0), window.pid, Int32(0)), (Int32(10), Int32(0), Int32(10)),
                                   (Int32(-1), window.pid, window.pid), (window.pid, window.pid, window.pid + 1)] {
    check(windowInputForegroundCheck(profile: "directed-v1", operation: .rightClick, postedEventCount: 1,
        originalForegroundPID: original, targetPID: target, currentForegroundPID: current, completionBound: true) == .rejected)
}
do {
    typealias Node = (pid: Int32, role: String, parent: Int?)
    let nodes: [Int: Node] = [0: (window.pid, "AXWindow", nil), 1: (window.pid, "AXMenu", 0), 2: (window.pid, "AXMenuItem", 1),
        3: (window.pid, "AXWindow", 0), 4: (window.pid, "AXMenuItem", 3), 5: (window.pid + 1, "AXMenuItem", 1),
        6: (window.pid, "AXSheet", 0), 7: (window.pid, "AXMenuItem", 6), 8: (window.pid, "AXGroup", 8),
        10: (window.pid, "AXApplication", 0), 11: (window.pid, "AXPopover", 0), 12: (window.pid, "AXSecureTextField", 1)]
    func belongs(_ element: Int) -> Bool {
        windowInputCompletionFocusBelongsToWindow(element, root: 0, pid: window.pid, equal: ==, read: { nodes[$0] })
    }
    check(belongs(0) && belongs(1) && belongs(2))
    for bad in [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] { check(!belongs(bad), "Sibling windows, foreign PID, sheets, secure/popover/app roots, cycles and missing ancestry are not the associated overlay") }
}
for operation in ["click", "rightClick", "doubleClick"] {
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
for text in ["中文🌟\t\n\r e\u{301}", String(repeating: "🪟", count: 4096)] {
    let request = try parseWindowInputRequest(input("typeText", extra: ["text": text]))
    check(request.text == text && request.requiresFocusedElement)
}
for text in ["", "secret\u{0}", "a\u{7f}", "a\u{202e}", String(repeating: "a", count: 4097)] {
    check((try? parseWindowInputRequest(input("typeText", extra: ["text": text]))) == nil)
}
for extra in [["text": "a", "point": ["x": -99, "y": 41]], ["text": "a", "deltaX": 1],
              ["text": "a", "durationMs": 100], ["text": true]] as [[String: Any]] {
    check((try? parseWindowInputRequest(input("typeText", extra: extra))) == nil)
}
for token in ["", String(repeating: "A", count: 64), String(repeating: "a", count: 63), String(repeating: "g", count: 64), "\(fixtureFocusToken)\n"] {
    check((try? parseWindowInputRequest(input("typeText", extra: ["text": "a", "focusToken": token]))) == nil)
}
var noFocusToken = try JSONSerialization.jsonObject(with: input("typeText", extra: ["text": "a"])) as! [String: Any]
noFocusToken.removeValue(forKey: "focusToken")
check((try? parseWindowInputRequest(JSONSerialization.data(withJSONObject: noFocusToken))) == nil)
check((try? parseWindowInputRequest(input("click", extra: ["point": ["x": -99, "y": 41], "focusToken": fixtureFocusToken]))) == nil)
for (dx, dy) in [(-1000, 0), (1000, -1000), (0, 1)] {
    let request = try parseWindowInputRequest(input("scroll", extra: ["point": ["x": -99, "y": 41], "deltaX": dx, "deltaY": dy]))
    check(request.deltaX == dx && request.deltaY == dy && !request.requiresFocusedElement)
}
for extra in [["point": ["x": -99, "y": 41], "deltaX": 0, "deltaY": 0],
    ["point": ["x": -99, "y": 41], "deltaX": 1001, "deltaY": 0],
    ["point": ["x": -99, "y": 41], "deltaX": 0, "deltaY": -1001],
    ["point": ["x": -99, "y": 41], "deltaX": 0.5, "deltaY": 0],
    ["point": ["x": -99, "y": 41], "deltaX": true, "deltaY": 0],
    ["point": ["x": -99, "y": 41], "deltaX": 1],
    ["point": ["x": -99, "y": 41], "deltaX": 1, "deltaY": 0, "text": "a"]] as [[String: Any]] {
    check((try? parseWindowInputRequest(input("scroll", extra: extra))) == nil)
}

// Construct and round-trip real event objects without posting, opening a
// window or creating NSApplication. This verifies the AppKit/CG bridge retains
// representable positive Int16 press identities, not merely a pure model.
let source = CGEventSource(stateID: .privateState)!
let point = WindowInputPoint(x: -99, y: 41)
let commandBounds = Rect(x: -100, y: 40, width: 30, height: 30)
func commandNode(_ role: String = "AXButton", pid: Int32 = 123, subrole: String? = nil, attributes: Set<String> = [],
                 selectedSettable: Bool? = nil, enabled: Bool? = true, press: Bool? = true,
                 bounds: Rect? = commandBounds) -> WindowInputCommandClickNode {
    WindowInputCommandClickNode(pid: pid, role: role, subrole: subrole, attributes: attributes,
        selectedSettable: selectedSettable, enabled: enabled, press: press, bounds: bounds)
}
let commandTree = [0: commandNode("AXWindow"), 1: commandNode("AXGroup"), 2: commandNode()]
func commandPolicy(_ nodes: [Int: WindowInputCommandClickNode] = commandTree, parents: [Int: Int] = [2: 1, 1: 0],
                   maximumDepth: Int = 32,
                   diagnostic: (WindowInputCommandClickStage, Int) -> Void = { _, _ in }) -> WindowInputCommandClickClassification {
    windowInputCommandClickPolicy(2, root: 0, window: window, point: point, equal: ==,
        read: { node, _ in nodes[node] }, parent: { parents[$0] }, maximumDepth: maximumDepth, diagnostic: diagnostic)
}
for (role, expected) in [("AXButton", WindowInputCommandClickClassification.eligibleButton),
                         ("AXCheckBox", .eligibleCheckBox), ("AXRadioButton", .eligibleRadio)] {
    var nodes = commandTree; nodes[2] = commandNode(role)
    check(commandPolicy(nodes) == expected)
}
var commandNodes = commandTree
commandNodes[2] = commandNode(subrole: "AXToolbarButton")
check(commandPolicy(commandNodes) == .eligibleButton)
for subrole in ["AXCloseButton", "AXMinimizeButton", "AXZoomButton", "AXFullScreenButton", "AXUnknown"] {
    commandNodes = commandTree; commandNodes[2] = commandNode(subrole: subrole)
    check(commandPolicy(commandNodes) == .rejectedSemantic)
}
for role in ["AXTextArea", "AXTextField", "AXList", "AXRow", "AXTabGroup", "AXStaticText", "AXUnknown"] {
    commandNodes = commandTree; commandNodes[2] = commandNode(role)
    check(commandPolicy(commandNodes) == .rejectedSemantic)
}
for role in ["AXWebArea", "AXTextArea", "AXList", "AXTable", "AXOutline", "AXRow", "AXCell", "AXTabGroup", "AXMenu", "AXUnknown"] {
    commandNodes = commandTree; commandNodes[1] = commandNode(role)
    check(commandPolicy(commandNodes) == .rejectedSemantic)
}
for node in [commandNode(enabled: false), commandNode(enabled: nil),
             commandNode(bounds: nil), commandNode(bounds: Rect(x: -50, y: 80, width: 10, height: 10)),
             commandNode(bounds: Rect(x: -110, y: 30, width: 30, height: 30))] {
    commandNodes = commandTree; commandNodes[2] = node
    check(commandPolicy(commandNodes) == .rejectedSemantic)
}
// Custom-drawn buttons can have no semantic AXPress callback. Their directed
// mouse eligibility still depends on the same role, scope and selection proof.
for press in [false, nil] as [Bool?] {
    for (role, expected) in [("AXButton", WindowInputCommandClickClassification.eligibleButton),
                             ("AXCheckBox", .eligibleCheckBox), ("AXRadioButton", .eligibleRadio)] {
        commandNodes = commandTree; commandNodes[2] = commandNode(role, press: press)
        check(commandPolicy(commandNodes) == expected, "Mouse delivery does not require AXPress")
    }
}
for index in [0, 1, 2] {
    for attribute in ["AXSelectedRows", "AXSelectedCells", "AXSelectedChildren"] {
        commandNodes = commandTree; commandNodes[index]!.attributes.insert(attribute)
        check(commandPolicy(commandNodes) == .rejectedSemantic, "Selection-sensitive ancestor")
    }
    commandNodes = commandTree; commandNodes[index]!.attributes.insert("AXSelected"); commandNodes[index]!.selectedSettable = true
    check(commandPolicy(commandNodes) == .rejectedSemantic)
    commandNodes[index]!.selectedSettable = nil
    check(commandPolicy(commandNodes) == .unavailable)
    commandNodes[index]!.selectedSettable = false
    check(commandPolicy(commandNodes) == .eligibleButton, "Readonly AXSelected is not a selection grant")
    commandNodes = commandTree; commandNodes[index] = nil
    check(commandPolicy(commandNodes) == .unavailable)
    commandNodes = commandTree; commandNodes[index] = commandNode(index == 0 ? "AXWindow" : index == 1 ? "AXGroup" : "AXButton", pid: 456)
    check(commandPolicy(commandNodes) == .rejectedScope)
}
commandNodes = commandTree; commandNodes[1] = commandNode("AXWindow")
check(commandPolicy(commandNodes) == .rejectedScope, "Another same-PID window cannot authorize flags")
check(commandPolicy(parents: [2: 1, 1: 2]) == .rejectedScope)
check(commandPolicy(parents: [2: 1]) == .unavailable)
check(commandPolicy(maximumDepth: 0) == .unavailable)

// Diagnostics classify the same rejected fake AX facts without exposing their
// dynamic role/subrole text or changing the original decision.
for (index, node, expectedStage, depth, expectedResult) in [
    (2, commandNode("AXUnknown"), WindowInputCommandClickStage.leafRole, 0, WindowInputCommandClickClassification.rejectedSemantic),
    (2, commandNode(subrole: "AXCloseButton"), .leafSubrole, 0, .rejectedSemantic),
    (2, commandNode(enabled: false), .leafEnabled, 0, .rejectedSemantic),
    (2, commandNode(bounds: nil), .leafGeometryMissing, 0, .rejectedSemantic),
    (2, commandNode(bounds: Rect(x: -110, y: 30, width: 30, height: 30)), .leafGeometryOutsideWindow, 0, .rejectedSemantic),
    (2, commandNode(bounds: Rect(x: -50, y: 80, width: 10, height: 10)), .leafPointOutside, 0, .rejectedSemantic),
    (1, commandNode("AXList"), .ancestorRole, 1, .rejectedSemantic),
    (0, commandNode("AXWindow", attributes: ["AXSelected"], selectedSettable: true), .selectedWritable, 2, .rejectedSemantic),
    (2, commandNode(attributes: ["AXSelected"]), .selectedSettableUnknown, 0, .unavailable),
    (1, commandNode("AXGroup", attributes: ["AXSelectedRows"]), .selectedRows, 1, .rejectedSemantic),
    (1, commandNode("AXGroup", attributes: ["AXSelectedCells"]), .selectedCells, 1, .rejectedSemantic),
    (1, commandNode("AXGroup", attributes: ["AXSelectedChildren"]), .selectedChildren, 1, .rejectedSemantic)
] {
    commandNodes = commandTree; commandNodes[index] = node
    var diagnostics: [(WindowInputCommandClickStage, Int)] = []
    check(commandPolicy(commandNodes, diagnostic: { diagnostics.append(($0, $1)) }) == expectedResult)
    check(diagnostics.count == 1 && diagnostics[0].0 == expectedStage && diagnostics[0].1 == depth)
}
var eligibleDiagnosticCount = 0
check(commandPolicy(diagnostic: { _, _ in eligibleDiagnosticCount += 1 }) == .eligibleButton)
check(eligibleDiagnosticCount == 0, "Eligibility does not fabricate a rejected stage")

let commandProof = WindowInputCommandClickTarget(element: 2, classification: WindowInputCommandClickClassification.eligibleButton,
    role: "AXButton", subrole: nil, bounds: commandBounds)
for fresh in [nil, WindowInputCommandClickTarget(element: 3, classification: .eligibleButton, role: "AXButton", subrole: nil, bounds: commandBounds),
              WindowInputCommandClickTarget(element: 2, classification: .eligibleButton, role: "AXButton", subrole: nil,
                  bounds: Rect(x: -99, y: 40, width: 30, height: 30))] as [WindowInputCommandClickTarget<Int>?] {
    var posted = 0
    do {
        _ = try runDirectedInputSequence([DirectedInputStep(event: "down", delayBeforeMs: 0, release: "up", completesRelease: false)],
            wait: { _ in }, validate: { try requireWindowInputCommandClickProof(commandProof, fresh: { fresh }, equal: ==) },
            canRelease: { true }, post: { _ in posted += 1 })
        fatalError("Changed Command-click proof must reject before first post")
    } catch let error as HelperError { check(error.code == "target_changed" && posted == 0, "No orphan press or release") }
}
var unnecessaryCommandReads = 0
try requireWindowInputCommandClickProof(nil as WindowInputCommandClickTarget<Int>?, fresh: {
    unnecessaryCommandReads += 1; return nil
}, equal: ==)
check(unnecessaryCommandReads == 0, "Plain clicks do not add a first-post hit probe")
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
// AppKit's bridge leaves the button at zero even for a right-mouse NSEvent.
// Verify real directed CG objects carry both their button and the subtype used
// by Codex, and that assigning the private source cannot erase those fields.
for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp, .leftMouseDragged,
             .rightMouseDown, .rightMouseUp, .rightMouseDragged] {
    let event = try windowInputMouseEvent(type, point: point, window: window,
        clickCount: 1, eventNumber: 123, source: source)
    let right = type == .rightMouseDown || type == .rightMouseUp || type == .rightMouseDragged
    for resetSource in [false, true] {
        if resetSource { event.setSource(source) }
        check(event.getIntegerValueField(.mouseEventButtonNumber) == (right ? 1 : 0), "Directed mouse button")
        check(event.getIntegerValueField(.mouseEventSubtype) == 3, "Directed mouse subtype")
        check(event.location == point.cg && event.flags.isEmpty, "Directed mouse location and flags")
        check(NSEvent(cgEvent: event)?.buttonNumber == (right ? 1 : 0), "AppKit preserves the explicit button")
        check(NSEvent(cgEvent: event)?.type == type, "AppKit preserves the mouse type")
    }
}
func preparedMouseEvents(_ operation: String, extra: [String: Any]) throws -> [WindowInputEvent] {
    try prepareWindowInputEvents(parseWindowInputRequest(input(operation, extra: extra)), source: source)
}
let commandRequest = try parseWindowInputRequest(input("click", extra: ["profile": "directed-v1", "point": ["x": -99, "y": 41]]))
let commandEvents = try prepareWindowInputEvents(commandRequest, source: source, inactiveCommandClick: true)
check(commandEvents.count == 2)
for step in commandEvents {
    for event in [step.event, step.release].compactMap({ $0 }) {
        check(event.flags == .maskCommand && event.getIntegerValueField(.eventSourceStateID) == 0, "Only CG Command flag in source0")
        check(event.type == .leftMouseDown || event.type == .leftMouseUp, "No modifier key/flagsChanged event")
        check(event.getIntegerValueField(.mouseEventSubtype) == 3 && event.getIntegerValueField(.mouseEventButtonNumber) == 0)
    }
}
let commandSteps = commandEvents.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
    release: $0.release, completesRelease: $0.completesRelease) }
var commandPosted: [CGEvent] = []
let commandResult = try runDirectedInputSequence(commandSteps, wait: { _ in }, validate: {
    if commandPosted.isEmpty { try requireWindowInputCommandClickProof(commandProof, fresh: { commandProof }, equal: ==) }
}, canRelease: { true }, post: { commandPosted.append($0) })
check(commandResult.releaseSent && commandPosted.count == 2 && commandPosted.allSatisfy { $0.flags == .maskCommand })
commandPosted = []
do {
    _ = try runDirectedInputSequence(commandSteps, wait: { _ in }, validate: {
        if !commandPosted.isEmpty { throw windowInputError("cancelled") }
    }, canRelease: { true }, post: { commandPosted.append($0) })
    fatalError("Interrupted Command click must release")
} catch let error as WindowInputExecutionError {
    check(error.releaseSent && commandPosted.count == 2 && commandPosted.last!.type == .leftMouseUp)
    check(commandPosted.allSatisfy { $0.flags == .maskCommand }, "Cleanup keeps the original event's flags")
}
for (operation, extra) in [("rightClick", ["point": ["x": -99, "y": 41]]),
                           ("doubleClick", ["point": ["x": -99, "y": 41]]),
                           ("drag", ["point": ["x": -99, "y": 41], "endPoint": ["x": 0, "y": 100], "durationMs": 100]),
                           ("typeText", ["text": "A"]), ("shortcut", ["shortcut": ["key": "escape", "modifiers": []]]),
                           ("scroll", ["point": ["x": -99, "y": 41], "deltaX": 0, "deltaY": -1])] as [(String, [String: Any])] {
    var generic = extra; generic["profile"] = "directed-v1"
    let request = try parseWindowInputRequest(input(operation, extra: generic))
    check((try? prepareWindowInputEvents(request, source: source, inactiveCommandClick: true)) == nil, "Command marker cannot reach another operation")
}
let legacyClick = try parseWindowInputRequest(input("click", extra: ["point": ["x": -99, "y": 41]]))
check((try? prepareWindowInputEvents(legacyClick, source: source, inactiveCommandClick: true)) == nil)
// Read the private local field itself: converting an event against a dummy
// window number cannot establish a cross-process NSEvent's local position.
typealias WindowInputTestLocalGetter = @convention(c) (UnsafeMutableRawPointer) -> CGPoint
let localGetterSymbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGEventGetWindowLocation")!
let localGetter = unsafeBitCast(localGetterSymbol, to: WindowInputTestLocalGetter.self)
for profile in ["directed-v1", "appkit-fixture-v1", "textedit-415-25f84-v1"] {
    for operation in ["click", "rightClick", "doubleClick", "drag"] {
        var extra: [String: Any] = ["profile": profile, "point": ["x": -99, "y": 41]]
        if operation == "drag" { extra["endPoint"] = ["x": 0, "y": 100]; extra["durationMs"] = 100 }
        let events = try preparedMouseEvents(operation, extra: extra)
        for step in events {
            for event in [step.event, step.release].compactMap({ $0 }) {
                let state = profile == "directed-v1" ? CGEventSourceStateID.combinedSessionState.rawValue : source.sourceStateID.rawValue
                check(event.getIntegerValueField(.eventSourceStateID) == Int64(state), "Pointer source profile")
                check(CGEventSource(event: event)?.sourceStateID.rawValue == state, "Pointer source object")
                check(event.flags.isEmpty && event.getIntegerValueField(.mouseEventSubtype) == 3, "Pointer marker and flags")
                check(event.getIntegerValueField(.mouseEventButtonNumber) == (operation == "rightClick" ? 1 : 0), "Pointer button")
                check(event.getIntegerValueField(CGEventField(rawValue: 51)!) == Int64(window.windowId), "Pointer native window")
                check(event.getIntegerValueField(.mouseEventWindowUnderMousePointer) == Int64(window.windowId), "Pointer window hint")
                check(event.getIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent) == Int64(window.windowId), "Pointer receiver hint")
                check(localGetter(Unmanaged.passUnretained(event).toOpaque()) == CGPoint(x: event.location.x - window.bounds.x,
                    y: event.location.y - window.bounds.y), "Pointer local field survives source selection")
            }
        }
    }
}
for (operation, extra) in [("typeText", ["text": "A"]), ("shortcut", ["shortcut": ["key": "escape", "modifiers": []]]),
                           ("scroll", ["point": ["x": -99, "y": 41], "deltaX": 0, "deltaY": -1])] as [(String, [String: Any])] {
    var generic = extra; generic["profile"] = "directed-v1"
    for step in try preparedMouseEvents(operation, extra: generic) {
        check(step.event.getIntegerValueField(.eventSourceStateID) == Int64(source.sourceStateID.rawValue), "Non-pointer private source")
    }
}
let clickEvents = try preparedMouseEvents("click", extra: ["point": ["x": -99, "y": 41]])
check(clickEvents.count == 2 && clickEvents[0].event.type == .leftMouseDown && clickEvents[1].event.type == .leftMouseUp)
check(pressNumber(clickEvents[0].event) == pressNumber(clickEvents[1].event))
check(pressNumber(clickEvents[0].release!) == pressNumber(clickEvents[1].event))
check(clickEvents.allSatisfy { $0.event.getIntegerValueField(.mouseEventClickState) == 1 })
do {
    let events = try prepareWindowInputEvents(associatedRightClick, source: source)
    var sent: [CGEvent] = []
    let result = try runDirectedInputSequence(events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
        release: $0.release, completesRelease: $0.completesRelease) }, wait: { _ in }, validate: {
            if !sent.isEmpty { check(windowInputCompletionPhaseAllowed(operation: .rightClick, postedEventCount: sent.count)) }
        }, canRelease: { true }, post: { sent.append($0) })
    check(result.releaseSent && result.eventCount == 2 && sent.map { $0.type } == [.rightMouseDown, .rightMouseUp])
    check(sent.allSatisfy { $0.getIntegerValueField(CGEventField(rawValue: 51)!) == Int64(window.windowId) },
        "The completion surface never replaces the original receiver of down, normal up or cleanup")
    check(pressNumber(sent[0]) == pressNumber(sent[1]))
    check(windowInputSuccessReceipt(result)["completionWindowId"] == nil)
    let receipt = windowInputSuccessReceipt(DirectedInputResult(eventCount: 2, releaseSent: true, completionWindowId: 2))
    check(receipt["completionWindowId"] as? UInt32 == 2 && receipt["releaseSent"] as? Bool == true)
    sent = []
    do {
        _ = try runDirectedInputSequence(events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
            release: $0.release, completesRelease: $0.completesRelease) }, wait: { _ in }, validate: {
                if !sent.isEmpty { throw windowInputError("focused_window_mismatch") }
            }, canRelease: { true }, post: { sent.append($0) })
        fatalError("A different popup must not complete the right click")
    } catch let error as WindowInputExecutionError {
        check(error.eventCount == 2 && error.releaseSent && error.completedStepCount == 1)
        check(sent.map { $0.type } == [.rightMouseDown, .rightMouseUp] && pressNumber(sent[0]) == pressNumber(sent[1]))
        check(sent[1].getIntegerValueField(CGEventField(rawValue: 51)!) == Int64(window.windowId))
        check(windowInputFailureReceipt(error)["dispatched"] as? String == "unknown")
    }
}
do {
    let events = try prepareWindowInputEvents(associatedRightClick, source: source)
    let steps = events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
        release: $0.release, completesRelease: $0.completesRelease) }
    // Use real prepared CG events and the production sequence runner. Only the
    // independently verified focus/CG facts and physical input are injected;
    // nothing is posted to macOS by this harness.
    func sequence(_ label: String, before: Int32? = 10, afterDown: Int32? = window.pid,
        afterUp: Int32? = window.pid, bound: Bool = true, proof: Bool = true,
        physicalCheck: Int = 0, finalSwitch: Int32? = nil, expectedSteps: Int = 2,
        success: Bool = true, expectedCompletion: Bool = true) throws {
        var sent: [CGEvent] = []
        var observedCompletion: UInt32?
        do {
            let result = try runDirectedInputSequence(steps, wait: { _ in }, validate: {
                let count = sent.count
                let current = count == 0 ? before : count == 1 ? afterDown : afterUp
                let route = windowInputForegroundCheck(profile: associatedRightClick.profile, operation: associatedRightClick.operation,
                    postedEventCount: count, originalForegroundPID: 10, targetPID: window.pid,
                    currentForegroundPID: current, completionBound: bound)
                guard route != .rejected else { throw windowInputError("target_changed") }
                if count == 1 && physicalCheck == 1 {
                    check(route == .completionRequired, "The new target-frontmost route must check ordinary keys before AX")
                    throw windowInputError("user_input_active")
                }
                let verified = count > 0 && proof
                guard windowInputForegroundAllowed(route, completionVerified: verified) else { throw windowInputError("target_changed") }
                if verified { observedCompletion = completionWindow.windowId }
                if route == .completionRequired, let finalSwitch = finalSwitch {
                    let finalRoute = windowInputForegroundCheck(profile: associatedRightClick.profile, operation: associatedRightClick.operation,
                        postedEventCount: count, originalForegroundPID: 10, targetPID: window.pid,
                        currentForegroundPID: finalSwitch, completionBound: bound)
                    guard windowInputForegroundAllowed(finalRoute, completionVerified: verified) else { throw windowInputError("target_changed") }
                }
                if count == 1 && physicalCheck == 2 {
                    check(route == .completionRequired, "The target-frontmost route must also check ordinary keys after AX")
                    throw windowInputError("user_input_active")
                }
            }, canRelease: { true }, post: { sent.append($0) })
            check(success && result.eventCount == 2 && result.releaseSent, label)
            let receipt = windowInputSuccessReceipt(DirectedInputResult(eventCount: result.eventCount,
                releaseSent: result.releaseSent, completionWindowId: observedCompletion))
            check((receipt["completionWindowId"] as? UInt32) == (expectedCompletion ? completionWindow.windowId : nil),
                "Only an actually observed completion receiver may be acknowledged")
        } catch let error as WindowInputExecutionError {
            check(!success && expectedSteps > 0 && error.completedStepCount == expectedSteps && error.eventCount == 2 && error.releaseSent, label)
            check(windowInputFailureReceipt(error)["dispatched"] as? String == "unknown")
            check(windowInputFailureReceipt(error)["completionWindowId"] == nil, "Failed completion never fabricates success proof")
        } catch let error as HelperError {
            check(!success && expectedSteps == 0 && error.code == "target_changed" && sent.isEmpty, label)
        }
        check(sent.count == (expectedSteps == 0 ? 0 : 2), "No replay or extra release: \(label)")
        if !sent.isEmpty {
            check(sent.map { $0.type } == [.rightMouseDown, .rightMouseUp] && pressNumber(sent[0]) == pressNumber(sent[1]), label)
            check(sent.allSatisfy { $0.getIntegerValueField(CGEventField(rawValue: 51)!) == Int64(window.windowId)
                && $0.getIntegerValueField(CGEventField(rawValue: 91)!) == Int64(window.windowId)
                && $0.getIntegerValueField(CGEventField(rawValue: 92)!) == Int64(window.windowId) },
                "Both normal and cleanup up stay bound to the original main window")
        }
    }
    try sequence("exact new overlay may complete its original right-up")
    try sequence("unchanged original foreground retains existing behavior", afterDown: 10, afterUp: 10,
        bound: false, proof: false, expectedCompletion: false)
    try sequence("returning to the original foreground keeps only the observed overlay proof", afterUp: 10)
    try sequence("a target takeover before down cannot authorize a press", before: window.pid, expectedSteps: 0, success: false)
    try sequence("another app after down receives only original cleanup", afterDown: window.pid + 1, expectedSteps: 1, success: false)
    try sequence("unknown foreground after down receives only original cleanup", afterDown: nil, expectedSteps: 1, success: false)
    try sequence("unbound same-PID overlay is not a completion", bound: false, expectedSteps: 1, success: false)
    try sequence("wrong same-PID window or failed CG/AX focus proof", proof: false, expectedSteps: 1, success: false)
    try sequence("ordinary key activity before AX ends the original press", physicalCheck: 1, expectedSteps: 1, success: false)
    try sequence("ordinary key activity after AX ends the original press", physicalCheck: 2, expectedSteps: 1, success: false)
    try sequence("a third-app switch during AX verification is still refused", finalSwitch: window.pid + 1, expectedSteps: 1, success: false)
    try sequence("a third-app switch after normal up has no second cleanup", afterUp: window.pid + 1, expectedSteps: 2, success: false)
}
do {
    let route = windowInputDispatchFocusRoute(targetIsForeground: true, inheritedFocus: false, commandClick: false, protectedFocus: true)
    let request = try parseWindowInputRequest(input("doubleClick", extra: ["profile": "directed-v1", "point": ["x": -99, "y": 41]]))
    let events = try prepareWindowInputEvents(request, source: source, inactiveCommandClick: route == .command)
    let steps = events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
        release: $0.release, completesRelease: $0.completesRelease) }
    var sent: [CGEvent] = []
    let result = try runDirectedInputSequence(steps, wait: { _ in }, validate: {}, canRelease: { true }, post: { sent.append($0) })
    check(result.eventCount == 4 && result.releaseSent && sent.count == 4)
    check(sent.map { $0.type } == [.leftMouseDown, .leftMouseUp, .leftMouseDown, .leftMouseUp])
    check(sent.map { $0.getIntegerValueField(.mouseEventClickState) } == [1, 1, 2, 2])
    check(sent.allSatisfy { $0.flags.isEmpty && $0.getIntegerValueField(CGEventField(rawValue: 51)!) == Int64(window.windowId) })
    for reason in ["target_changed", "focused_window_mismatch", "user_input_active", "cancelled"] {
        sent = []
        do {
            _ = try runDirectedInputSequence(steps, wait: { _ in }, validate: {
                if !sent.isEmpty { throw windowInputError(reason) }
            }, canRelease: { true }, post: { sent.append($0) })
            fatalError("Changed foreground state did not stop the double click")
        } catch let error as WindowInputExecutionError {
            check(error.releaseSent && error.eventCount == 2 && sent.map { $0.type } == [.leftMouseDown, .leftMouseUp],
                "Interrupt after down releases only its original up and never starts the second click")
        }
    }
}
for text in ["中文🌟\t\n\r e\u{301}", String(repeating: "a", count: 19) + "🌟z", String(repeating: "🪟", count: 4096)] {
    let chunks = windowInputUnicodeChunks(text)
    check(chunks.flatMap { $0 } == Array(text.utf16) && chunks.allSatisfy { !$0.isEmpty && $0.count <= 20 })
    for chunk in chunks {
        check(String(decoding: chunk, as: UTF16.self).utf16.elementsEqual(chunk), "No unpaired surrogate chunk")
    }
    let events = try preparedMouseEvents("typeText", extra: ["text": text])
    check(events.count == chunks.count * 2 && events.count <= 1024)
    for (index, chunk) in chunks.enumerated() {
        let down = events[index * 2], up = events[index * 2 + 1]
        check(down.event.type == .keyDown && up.event.type == .keyUp && down.release === up.event)
        check(!down.completesRelease && up.completesRelease && down.delayBeforeMs == 0 && up.delayBeforeMs == 0)
        for event in [down.event, up.event] {
            var actualLength = 0
            var units = [UniChar](repeating: 0, count: 20)
            event.keyboardGetUnicodeString(maxStringLength: 20, actualStringLength: &actualLength, unicodeString: &units)
            check(Array(units.prefix(actualLength)) == chunk && event.flags.isEmpty)
            check(event.getIntegerValueField(.eventTargetUnixProcessID) == Int64(window.pid))
            check(NSEvent(cgEvent: event)?.windowNumber == Int(window.windowId), "Unicode window number")
        }
    }
}
for (dx, dy) in [(0, -200), (200, 0), (-1000, 1000)] {
    let events = try preparedMouseEvents("scroll", extra: ["point": ["x": -99, "y": 41], "deltaX": dx, "deltaY": dy])
    check(events.count == 1 && events[0].event.type == .scrollWheel && events[0].release == nil && !events[0].completesRelease, "One wheel event")
    let event = events[0].event
    check(event.location == point.cg && event.flags.isEmpty, "Wheel location and flags")
    check(event.getIntegerValueField(.scrollWheelEventIsContinuous) == 1, "Continuous pixel wheel")
    check(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1) == Int64(dy), "Vertical pixel delta: \(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1)) vs \(dy)")
    check(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2) == Int64(dx), "Horizontal pixel delta: \(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2)) vs \(dx)")
    check(event.getIntegerValueField(CGEventField(rawValue: 51)!) == Int64(window.windowId), "Wheel window field51: \(event.getIntegerValueField(CGEventField(rawValue: 51)!)); field91 \(event.getIntegerValueField(.mouseEventWindowUnderMousePointer)), field92 \(event.getIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent))")
    check(event.getIntegerValueField(.eventTargetUnixProcessID) == Int64(window.pid), "Wheel PID")
    var posted = 0
    let result = try runDirectedInputSequence(events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
        release: $0.release, completesRelease: $0.completesRelease) }, wait: { _ in }, validate: {}, canRelease: { false }, post: { _ in posted += 1 })
    check(posted == 1 && result.eventCount == 1 && result.releaseSent, "A wheel event never needs a synthetic up")
    var validations = 0
    do {
        _ = try runDirectedInputSequence(events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
            release: $0.release, completesRelease: $0.completesRelease) }, wait: { _ in }, validate: {
                validations += 1; if validations == 2 { throw windowInputError("target_changed") }
            }, canRelease: { false }, post: { _ in })
        fatalError("Post-wheel receiver change must stay unknown")
    } catch let error as WindowInputExecutionError { check(error.releaseSent && error.eventCount == 1) }
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

// A before-up failure with its unique cleanup release and a failure in the
// final validation have identical public dispatch receipts. Internal stage and
// completed planned-step counts must distinguish them without counting cleanup.
var equivalentFailureReceipts: [Data] = []
for (failingValidation, expectedPhase, expectedCompletedSteps) in [
    (2, WindowInputFailurePhase.beforeStep, 1), (3, WindowInputFailurePhase.completion, 2)
] {
    posts = []
    var validation = 0
    do {
        _ = try runDirectedInputSequence([down, up], wait: { _ in }, validate: {
            validation += 1
            if validation == failingValidation { throw windowInputError("transient_ui_active") }
        }, canRelease: { true }, post: { posts.append($0) })
        fatalError("A failing transient-surface guard must remain a failure at either boundary")
    } catch let error as WindowInputExecutionError {
        check(error.code == "transient_ui_active" && error.eventCount == 2 && error.releaseSent)
        check(posts == ["down", "up"] && error.failurePhase == expectedPhase)
        check(error.completedStepCount == expectedCompletedSteps,
            "The cleanup up cannot masquerade as a completed planned up")
        let receipt = windowInputFailureReceipt(error)
        check(receipt["failurePhase"] == nil && receipt["completedStepCount"] == nil,
            "Diagnostic stage/count must remain outside the public receipt")
        equivalentFailureReceipts.append(try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]))
    }
}
check(equivalentFailureReceipts.count == 2 && equivalentFailureReceipts[0] == equivalentFailureReceipts[1])

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

// fd3 tests use private pipes and a recorder in place of postToPid. No event is
// ever sent to macOS, yet production's post-then-report exit is exercised.
func feedbackPipe() -> (Int32, Int32) {
    var descriptors: [Int32] = [-1, -1]
    check(descriptors.withUnsafeMutableBufferPointer { Darwin.pipe($0.baseAddress!) } == 0)
    check(fcntl(descriptors[0], F_SETFL, fcntl(descriptors[0], F_GETFL) | O_NONBLOCK) == 0)
    return (descriptors[0], descriptors[1])
}
func feedbackData(_ descriptor: Int32) -> Data {
    var result = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
        let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress!, $0.count) }
        if count <= 0 { break }
        result.append(contentsOf: buffer.prefix(count))
    }
    return result
}
func feedbackFrames(_ descriptor: Int32) -> [[String: Any]] {
    let data = feedbackData(descriptor)
    guard !data.isEmpty else { return [] }
    check(data.last == 10)
    return data.split(separator: 10).map { try! JSONSerialization.jsonObject(with: Data($0)) as! [String: Any] }
}
do {
    let (reader, writer) = feedbackPipe()
    defer { Darwin.close(reader); Darwin.close(writer) }
    let feedback = WindowInputPointerFeedback(descriptor: writer)
    check(fcntl(writer, F_GETFL) & O_NONBLOCK != 0)
    check(fcntl(writer, F_GETNOSIGPIPE) == 1)
    postWindowInputEvent(rightEvents[0].event, feedback: feedback, post: { event in
        check(event === rightEvents[0].event)
        check(feedbackData(reader).isEmpty, "No pointer report before the post returns")
    })
    postWindowInputEvent(rightEvents[1].event, feedback: feedback, post: { _ in })
    let frames = feedbackFrames(reader)
    check(frames.count == 2)
    check(frames.map { $0["phase"] as! String } == ["down", "up"])
    check(frames.map { $0["sequence"] as! Int } == [1, 2])
    check(frames.allSatisfy { Set($0.keys) == Set(["phase", "point", "sequence"]) })
    let feedbackPoint = frames[0]["point"] as! [String: Double]
    check(feedbackPoint["x"] == point.x && feedbackPoint["y"] == point.y)
    // Keyboard posts do not appear as mouse activity.
    let shortcut = try prepareWindowInputEvents(parseWindowInputRequest(input("shortcut", extra: ["shortcut": ["key": "escape", "modifiers": []]])), source: source)
    for step in shortcut { postWindowInputEvent(step.event, feedback: feedback, post: { _ in }) }
    for operation in ["typeText", "scroll"] {
        let extra: [String: Any] = operation == "typeText" ? ["text": "private中文🌟"] : ["point": ["x": -99, "y": 41], "deltaX": 0, "deltaY": -100]
        for step in try preparedMouseEvents(operation, extra: extra) { postWindowInputEvent(step.event, feedback: feedback, post: { _ in }) }
    }
    check(feedbackData(reader).isEmpty)
}
do {
    let events = try preparedMouseEvents("drag", extra: ["point": ["x": -99, "y": 41],
        "endPoint": ["x": 0, "y": 100], "durationMs": 100])
    let (reader, writer) = feedbackPipe()
    defer { Darwin.close(reader); Darwin.close(writer) }
    let feedback = WindowInputPointerFeedback(descriptor: writer)
    var captured: [CGEvent] = []
    var validation = 0
    do {
        _ = try runDirectedInputSequence(events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
            release: $0.release, completesRelease: $0.completesRelease) }, wait: { _ in }, validate: {
            validation += 1
            if validation == 3 { throw windowInputError("cancelled") }
        }, canRelease: { true }, post: { event in
            postWindowInputEvent(event, feedback: feedback, post: { captured.append($0) })
        })
        fatalError("Cancelled telemetry drag must reject")
    } catch let error as WindowInputExecutionError { check(error.releaseSent && error.eventCount == 3) }
    let frames = feedbackFrames(reader)
    check(frames.count == captured.count && frames.count == 3)
    check(frames.map { $0["phase"] as! String } == ["down", "move", "up"])
    check(frames.map { $0["sequence"] as! Int } == [1, 2, 3])
    check(captured[1].location == captured[2].location && captured[2].location != events.last!.event.location)
    for (frame, event) in zip(frames, captured) {
        let position = frame["point"] as! [String: Double]
        check(position["x"] == event.location.x && position["y"] == event.location.y)
    }
}
do {
    let (reader, writer) = feedbackPipe()
    defer { Darwin.close(writer) }
    let feedback = WindowInputPointerFeedback(descriptor: writer)
    // A dead visual consumer must produce EPIPE without SIGPIPE terminating
    // the helper, and real posts/release must still complete exactly once.
    Darwin.close(reader)
    var posted = 0
    let result = try runDirectedInputSequence(rightEvents.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
        release: $0.release, completesRelease: $0.completesRelease) }, wait: { _ in }, validate: {}, canRelease: { true }, post: { event in
        postWindowInputEvent(event, feedback: feedback, post: { _ in posted += 1 })
    })
    check(posted == 2 && result.eventCount == 2 && result.releaseSent)
}
do {
    let (reader, writer) = feedbackPipe()
    defer { Darwin.close(reader); Darwin.close(writer) }
    let feedback = WindowInputPointerFeedback(descriptor: writer)
    let filler = [UInt8](repeating: 120, count: 4096)
    while filler.withUnsafeBytes({ Darwin.write(writer, $0.baseAddress!, $0.count) }) > 0 {}
    check(errno == EAGAIN || errno == EWOULDBLOCK)
    var posted = 0
    postWindowInputEvent(rightEvents[0].event, feedback: feedback, post: { _ in posted += 1 })
    _ = feedbackData(reader)
    postWindowInputEvent(rightEvents[1].event, feedback: feedback, post: { _ in posted += 1 })
    check(posted == 2 && feedbackData(reader).isEmpty, "A full pipe disables feedback permanently without blocking up")
}
do {
    let (reader, writer) = feedbackPipe()
    defer { Darwin.close(reader); Darwin.close(writer) }
    let feedback = WindowInputPointerFeedback(descriptor: writer)
    for index in 1...64 {
        postWindowInputEvent(rightEvents[0].event, feedback: feedback, post: { _ in })
        let frames = feedbackFrames(reader)
        check(frames.count == 1 && frames[0]["sequence"] as! Int == index)
    }
    postWindowInputEvent(rightEvents[1].event, feedback: feedback, post: { _ in })
    check(feedbackData(reader).isEmpty)
}
var missingFeedbackPosts = 0
postWindowInputEvent(rightEvents[0].event, feedback: WindowInputPointerFeedback(descriptor: -1), post: { _ in missingFeedbackPosts += 1 })
check(missingFeedbackPosts == 1)
do {
    let (reader, writer) = feedbackPipe()
    defer { Darwin.close(reader); Darwin.close(writer) }
    let events = try preparedMouseEvents("drag", extra: ["point": ["x": -99, "y": 41],
        "endPoint": ["x": 0, "y": 100], "durationMs": 100])
    for requestID in ["1", "2"] {
        let feedback = WindowInputPointerFeedback(descriptor: writer, requestID: requestID)
        var posts = 0
        let result = try runDirectedInputSequence(events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
            release: $0.release, completesRelease: $0.completesRelease) }, wait: { _ in }, validate: {}, canRelease: { true }, post: { event in
            postWindowInputEvent(event, feedback: feedback, post: { _ in posts += 1 })
        })
        let frames = feedbackFrames(reader)
        check(result.eventCount == events.count && result.releaseSent && posts == events.count)
        check(frames.count == events.count && frames.allSatisfy { Set($0.keys) == ["requestId", "phase", "point", "sequence"] })
        check(frames.allSatisfy { $0["requestId"] as? String == requestID })
        check(frames.map { $0["sequence"] as! Int } == Array(1...events.count), "Each request owns an independent posted-feedback sequence")
        check(frames.first?["phase"] as? String == "down" && frames.last?["phase"] as? String == "up")
    }
    let invalid = WindowInputPointerFeedback(descriptor: writer, requestID: "0")
    var posts = 0
    postWindowInputEvent(rightEvents[0].event, feedback: invalid, post: { _ in posts += 1 })
    check(posts == 1 && feedbackData(reader).isEmpty, "Invalid visual correlation silences feedback, never the actual post")
}
for closedConsumer in [false, true] {
    let (reader, writer) = feedbackPipe()
    defer { if !closedConsumer { Darwin.close(reader) }; Darwin.close(writer) }
    let feedback = WindowInputPointerFeedback(descriptor: writer, requestID: "256")
    if closedConsumer { Darwin.close(reader) }
    else {
        let filler = [UInt8](repeating: 120, count: 4096)
        while filler.withUnsafeBytes({ Darwin.write(writer, $0.baseAddress!, $0.count) }) > 0 {}
        check(errno == EAGAIN || errno == EWOULDBLOCK)
    }
    var posts = 0, validation = 0
    do {
        _ = try runDirectedInputSequence(rightEvents.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
            release: $0.release, completesRelease: $0.completesRelease) }, wait: { _ in }, validate: {
                validation += 1
                if validation == 2 { throw windowInputError("cancelled") }
            }, canRelease: { true }, post: { event in
                postWindowInputEvent(event, feedback: feedback, post: { _ in posts += 1 })
            })
        fatalError("A cancelled session must return its input interruption")
    } catch let error as WindowInputExecutionError {
        check(posts == 2 && error.eventCount == 2 && error.releaseSent,
            "A full or dead session feedback pipe cannot delay or duplicate the one cleanup up")
    }
}

// Persistent-session protocol/lifecycle tests use only fake dispatch and pipe
// objects: no AX query, event posting, NSApplication or GUI process is created.
func sessionCommand(_ id: String, request: Data? = nil, command: String = "input") throws -> WindowInputSessionCommand {
    var object: [String: Any] = ["requestId": id, "command": command]
    if let request { object["request"] = try JSONSerialization.jsonObject(with: request) }
    return try parseWindowInputSessionCommand(JSONSerialization.data(withJSONObject: object))
}
func genericInput(_ operation: String = "click", window selected: WindowIdentity = window, extra: [String: Any] = ["point": ["x": -99, "y": 41]]) -> Data {
    var object: [String: Any] = ["window": selected.json, "profile": "directed-v1", "operation": operation]
    for (key, value) in extra { object[key] = value }
    return try! JSONSerialization.data(withJSONObject: object)
}
let sessionClick = genericInput()
let began: UInt64 = 10_000
do {
    let session = try WindowInputSessionState(window: window, now: began)
    var executions = 0
    check(session.inputCount == 0 && !session.stopped, "Creating a protocol owner never executes input")
    let first = try session.handle(sessionCommand("1", request: sessionClick), now: began + 1) { request in
        executions += 1
        check(request.profile == "directed-v1" && request.operation == .click)
        return DirectedInputResult(eventCount: 2, releaseSent: true)
    }
    check(executions == 1 && first["requestId"] as? String == "1" && first["eventCount"] as? Int == 2)
    check(first["releaseSent"] as? Bool == true && first["dispatched"] as? Bool == true)
    check((try? session.handle(sessionCommand("1", request: sessionClick), now: began + 2) { _ in fatalError("Duplicate ID executed") }) == nil)
    let closed = try session.handle(sessionCommand("2", command: "close"), now: began + 3) { _ in fatalError("Close executed input") }
    check(Set(closed.keys) == ["requestId", "ok", "type"] && closed["type"] as? String == "closed" && session.stopped)
    check((try? session.handle(sessionCommand("3", request: sessionClick), now: began + 4) { _ in fatalError("Closed session executed") }) == nil)
}
for invalid in [
    "{}", "{\"requestId\":\"0\",\"command\":\"close\"}", "{\"requestId\":\"01\",\"command\":\"close\"}",
    "{\"requestId\":1,\"command\":\"close\"}", "{\"requestId\":\"1\",\"command\":\"observe\"}",
    "{\"requestId\":\"1\",\"command\":\"close\",\"request\":{}}", "{\"requestId\":\"1\",\"command\":\"input\"}",
    "{\"requestId\":\"1\",\"command\":\"close\",\"requestId\":\"2\"}",
    "{\"requestId\":\"1\",\"command\":\"input\",\"request\":{\"operation\":\"click\",\"operation\":\"drag\"}}"
] { check((try? parseWindowInputSessionCommand(Data(invalid.utf8))) == nil) }
do {
    let session = try WindowInputSessionState(window: window, now: began)
    let other = WindowIdentity(windowId: window.windowId, pid: window.pid, processStartedAt: window.processStartedAt,
        layer: window.layer, bounds: window.bounds, title: "Changed")
    check(!windowInputSessionWindowMatches(other, window), "Even a title-only identity change is not the frozen window")
    for (index, data) in [genericInput(window: other), input("click", extra: ["point": ["x": -99, "y": 41]]), Data("{}".utf8)].enumerated() {
        let response = try session.handle(sessionCommand(String(index + 1), request: data), now: began + UInt64(index)) { _ in fatalError("Out-of-scope session executed") }
        check(response["ok"] as? Bool == false && response["dispatched"] as? Bool == false && response["requestId"] as? String == String(index + 1))
        check(Set(response.keys) == ["requestId", "ok", "dispatched", "error", "focusPosted", "focusState"])
        check(response["focusPosted"] as? Bool == false && response["focusState"] as? String == "inactive")
    }
}
do {
    let session = try WindowInputSessionState(window: window, now: began)
    let steps = [DirectedInputStep(event: "down", delayBeforeMs: 0, release: "up", completesRelease: false),
                 DirectedInputStep(event: "up", delayBeforeMs: 15, release: nil, completesRelease: true)]
    var posts: [String] = [], validation = 0
    let response = try session.handle(sessionCommand("1", request: sessionClick), now: began + 1) { _ in
        try runDirectedInputSequence(steps, wait: { _ in }, validate: {
            validation += 1
            if validation == 2 { throw windowInputError("cancelled") }
        }, canRelease: { true }, post: { posts.append($0) })
    }
    check(posts == ["down", "up"] && response["requestId"] as? String == "1")
    check(response["dispatched"] as? String == "unknown" && response["releaseSent"] as? Bool == true && !session.stopped)
    let next = try session.handle(sessionCommand("2", request: sessionClick), now: began + 2) { _ in DirectedInputResult(eventCount: 2, releaseSent: true) }
    check(next["requestId"] as? String == "2" && next["ok"] as? Bool == true, "Each final receipt remains bound to its own request")
    let failed = try session.handle(sessionCommand("3", request: sessionClick), now: began + 3) { _ in
        throw WindowInputExecutionError(code: "target_changed", eventCount: 1, releaseSent: false,
            failurePhase: .beforeStep, completedStepCount: 1)
    }
    check(failed["releaseSent"] as? Bool == false && session.stopped)
    check((try? session.handle(sessionCommand("4", request: sessionClick), now: began + 4) { _ in fatalError("Unpaired session executed again") }) == nil)
}
do {
    let session = try WindowInputSessionState(window: window, now: began)
    for index in 1...windowInputSessionMaximumInputs {
        _ = try session.handle(sessionCommand(String(index), request: sessionClick), now: began + UInt64(index)) { _ in DirectedInputResult(eventCount: 2, releaseSent: true) }
    }
    check(session.inputCount == 256)
    let closed = try session.handle(sessionCommand("257", command: "close"), now: began + 257) { _ in fatalError("Close budget executed") }
    check(closed["type"] as? String == "closed")
    let expired = try WindowInputSessionState(window: window, now: began)
    check(!expired.withinLifetime(now: began - 1))
    check(expired.withinLifetime(now: began + windowInputSessionMaximumIdle - 1))
    check(!expired.withinLifetime(now: began + windowInputSessionMaximumIdle))
    let total = try WindowInputSessionState(window: window, now: began)
    for index in 1...6 {
        _ = try total.handle(sessionCommand(String(index), request: sessionClick), now: began + UInt64(index) * 299_000_000_000) { _ in DirectedInputResult(eventCount: 2, releaseSent: true) }
    }
    check(!total.withinLifetime(now: began + windowInputSessionMaximumLifetime), "Fresh activity cannot extend the total lifetime")
}
do {
    var lines = WindowInputSessionLineBuffer()
    let encoded = Data("{\"requestId\":\"1\",\"command\":\"close\"}\n".utf8)
    check(try lines.append(encoded.prefix(5)).isEmpty)
    let complete = try lines.append(encoded.dropFirst(5))
    check(complete.count == 1 && lines.empty)
    check(try parseWindowInputSessionCommand(complete[0]).kind == .close)
    var blank = WindowInputSessionLineBuffer()
    check((try? blank.append(Data([10]))) == nil)
    var oversized = WindowInputSessionLineBuffer()
    check((try? oversized.append(Data(repeating: 120, count: windowInputSessionMaximumLineBytes + 1))) == nil)
    var total = WindowInputSessionLineBuffer()
    let frame = Data(repeating: 120, count: windowInputSessionMaximumLineBytes) + Data([10])
    for _ in 0..<(windowInputSessionMaximumTotalBytes / frame.count) { _ = try total.append(frame) }
    check((try? total.append(frame)) == nil)
}
do {
    let (reader, writer) = feedbackPipe()
    check(windowInputSessionPipeOpen(reader))
    Darwin.close(writer)
    check(!windowInputSessionPipeOpen(reader), "EOF is visible to the active worker without reading another request")
    Darwin.close(reader)
    check(!windowInputSessionPipeOpen(reader))
    let (feedbackReader, feedbackWriter) = feedbackPipe()
    defer { Darwin.close(feedbackReader); Darwin.close(feedbackWriter) }
    let disabled = WindowInputPointerFeedback(descriptor: feedbackWriter, enabled: false)
    disabled.posted(rightEvents[0].event)
    check(feedbackData(feedbackReader).isEmpty, "Session mode cannot write uncorrelated fd3 telemetry")
}
do {
    let request = try parseWindowInputRequest(sessionClick)
    windowInputCancelled = 1
    var guarded = false
    do {
        _ = try executeWindowInput(request, pointerFeedback: WindowInputPointerFeedback(enabled: false), lifetimeGuard: {
            guarded = true
            throw windowInputError("cancelled")
        })
        fatalError("A cancelled owner reached AX")
    } catch let error as HelperError { check(error.code == "cancelled") }
    check(guarded && windowInputCancelled == 1, "The worker preserves a TERM flag installed by its session")
    windowInputCancelled = 0
}
check(windowInputFocusMask(windowInputFocusKeyboardTypes) == 0x1c00)
check(windowInputFocusMask(windowInputFocusApplicationTypes) == (1 << 13 | 1 << 20 | 1 << 19))
check(windowInputFocusMask(windowInputFocusProcessTypes) == 0x200000)
check(windowInputFocusUnrestoredSyntheticFront(actualPID: 10, targetPID: 10, humanTakeover: false), "Synthetic target-front on cancellation cannot be mistaken for human ownership")
check(!windowInputFocusUnrestoredSyntheticFront(actualPID: 10, targetPID: 10, humanTakeover: true), "An observed real human click keeps its normal target activation")
check(!windowInputFocusUnrestoredSyntheticFront(actualPID: 20, targetPID: 10, humanTakeover: false), "An unrelated human app is never pulled back")
do {
    var diagnostic = WindowInputFocusDiagnostics()
    diagnostic.recordUnsafe(.releaseCall)
    diagnostic.recordUnsafe(.settleDeadline)
    diagnostic.recordUnsafe(.tapJoin)
    check(diagnostic.firstUnsafe == .releaseCall && diagnostic.unsafeCount == 3,
          "A later cleanup timeout must preserve the first unsafe cause")
    func reason(_ unsafe: Bool = false, _ front: Bool = true, _ regular: Bool = true,
                _ focus: Bool = true, _ equal: Bool = true) -> WindowInputFocusSettleReason {
        windowInputFocusSettleReason(unsafe: unsafe, frontKnown: front, frontRegular: regular,
                                    focusKnown: focus, focusEqual: equal)
    }
    check(reason() == .confirmed)
    check(reason(true) == .unsafe, "Matching focus cannot erase an existing unsafe cause")
    check(reason(false, false, false, false, false) == .frontUnavailable)
    check(reason(false, true, true, false, false) == .focusUnavailable)
    check(reason(false, true, true, true, false) == .focusMismatch)
    check(reason(false, true, false, true, true) == .frontNonregular)
}
do {
    var belief = WindowInputFocusBelief(perceivedActive: false, perceivedFocus: false, actualActive: false)
    check(belief.nextActivation?.type == 13 && belief.nextActivation?.subtype == 1)
    belief.activated()
    check(belief.nextActivation == nil && belief.needsDeactivation)
    belief.perceivedFocus = false
    check(belief.nextActivation?.type == 21 && belief.nextActivation?.subtype == -32768)
    belief.focusReturned()
    check(belief.nextActivation == nil)
    belief.actualActive = true
    check(!belief.needsDeactivation, "The enforcer must never deactivate a genuinely active application")
    belief.actualActive = false
    belief.observe(WindowInputFocusEvent(type: 13, subtype: 2), suppressed: true)
    check(belief.perceivedActive && belief.perceivedFocus, "Suppressed events do not change perceived state")
    belief.observe(WindowInputFocusEvent(type: 13, subtype: 2))
    check(!belief.perceivedActive && !belief.perceivedFocus && !belief.actualActive)
    belief.observe(WindowInputFocusEvent(type: 20))
    check(belief.perceivedActive && belief.perceivedFocus && !belief.actualActive)
    belief.observe(WindowInputFocusEvent(type: 19))
    check(!belief.perceivedActive && !belief.perceivedFocus)
    belief.observe(WindowInputFocusEvent(type: 13, subtype: 22))
    check(!belief.perceivedActive && !belief.perceivedFocus)
    belief.observe(WindowInputFocusEvent(type: 20, subtype: Int64.max))
    check(belief.perceivedActive && belief.perceivedFocus, "Type20 does not require an Int16 AppKit subtype")
    belief.observe(WindowInputFocusEvent(type: 19, subtype: Int64.max))
    check(!belief.perceivedActive && !belief.perceivedFocus, "Type19 does not require an Int16 AppKit subtype")
}
for type in windowInputFocusKeyboardTypes {
    let physical = WindowInputFocusEvent(type: type, sourcePID: 70, targetPID: 10)
    let decision = windowInputFocusTemporaryKeyboard(physical, servicePID: 99, targetPID: 10, foregroundPID: 20)
    check(decision.drop && decision.repostPID == 20 && !decision.unsafe)
    check(!windowInputFocusTemporaryKeyboard(WindowInputFocusEvent(type: type, sourcePID: 99, targetPID: 10), servicePID: 99, targetPID: 10, foregroundPID: 20).drop)
    check(!windowInputFocusTemporaryKeyboard(WindowInputFocusEvent(type: type, sourcePID: 70, targetPID: 30), servicePID: 99, targetPID: 10, foregroundPID: 20).drop)
}
for type in [1, 2, 3, 4, 5, 6, 7, 22] as [UInt32] {
    let decision = windowInputFocusTemporaryKeyboard(WindowInputFocusEvent(type: type, sourcePID: 70, targetPID: 10), servicePID: 99, targetPID: 10, foregroundPID: 20)
    check(!decision.drop && decision.repostPID == nil, "Pointer and wheel events are never rerouted")
}
for subtype in [1, 2, 22, 23] as [Int64] { check(windowInputFocusSuppressForeground(WindowInputFocusEvent(type: 13, subtype: subtype))) }
check(!windowInputFocusSuppressForeground(WindowInputFocusEvent(type: 13, notification: 1, subtype: 0)), "AppKit suppression reads field83, not process field64")
check(windowInputFocusSuppressForeground(WindowInputFocusEvent(type: 20)) && windowInputFocusSuppressForeground(WindowInputFocusEvent(type: 19)))
do {
    var policy = WindowInputFocusPreventerPolicy(targetPID: 10, servicePID: 99, auxiliaryPID: 30, currentFocusPID: 20)
    check(policy.process(WindowInputFocusEvent(type: 21, targetPID: 20, notification: 16384, focusOwnerPID: 10)).drop)
    check(policy.pending?.thiefPID == 10 && policy.pending?.originalTargetPID == 20)
    let key = policy.keyboard(WindowInputFocusEvent(type: 10, sourcePID: 70, targetPID: 10))
    check(key.drop && key.repostPID == 20)
    check(!policy.keyboard(WindowInputFocusEvent(type: 10, sourcePID: 99, targetPID: 10)).drop)
    check(!policy.keyboard(WindowInputFocusEvent(type: 10, sourcePID: 70, targetPID: 40)).drop)
    check(policy.process(WindowInputFocusEvent(type: 21, targetPID: 20, notification: 32768)).drop)
    check(!policy.process(WindowInputFocusEvent(type: 21, targetPID: 20, notification: 32768)).drop)
    let wrongReceiver = policy.process(WindowInputFocusEvent(type: 21, targetPID: 40, notification: 61698, focusOwnerPID: 10, focusToken: 777))
    check(wrongReceiver.releaseFocusID == nil && policy.pending?.changed == false)
    let release = policy.process(WindowInputFocusEvent(type: 21, targetPID: 30, notification: 61698, focusOwnerPID: 10, focusToken: 777))
    check(release.releaseFocusID == 777, "Only Changed.field71 supplies the CPS release token")
    check(policy.process(WindowInputFocusEvent(type: 21, targetPID: 30, notification: 61698, focusOwnerPID: 10, focusToken: 888)).releaseFocusID == nil)
    _ = policy.process(WindowInputFocusEvent(type: 21, targetPID: 30, notification: 2, focusOwnerPID: 10))
    check(policy.pending == nil)
    policy.currentFocusPID = 20
    _ = policy.process(WindowInputFocusEvent(type: 21, targetPID: 20, notification: 16384, focusOwnerPID: 10))
    let invalid = policy.process(WindowInputFocusEvent(type: 21, targetPID: 30, notification: 61698, focusOwnerPID: 10, focusToken: Int64(UInt32.max) + 1))
    check(invalid.unsafe && invalid.releaseFocusID == nil && policy.releaseFailed)
}
do {
    var policy = WindowInputFocusPreventerPolicy(targetPID: 10, servicePID: 99, auxiliaryPID: 30, currentFocusPID: 20)
    check(policy.process(WindowInputFocusEvent(type: 21, targetPID: 45, notification: 16384, focusOwnerPID: 10)).drop,
        "Deny predicate compares current system identity, never a fixed old-front event target")
    check(policy.keyboard(WindowInputFocusEvent(type: 10, sourcePID: 70, targetPID: 10)).repostPID == 45,
        "Pending keyboard preservation uses the actual original event receiver")
    _ = policy.process(WindowInputFocusEvent(type: 21, targetPID: 30, notification: 61698, focusOwnerPID: 20))
    check(policy.pending == nil && policy.currentFocusPID == 20)
    _ = policy.process(WindowInputFocusEvent(type: 21, targetPID: 30, notification: 61698, focusOwnerPID: 10))
    check(policy.currentFocusPID == 10, "Changed updates current identity even without pending theft")
    check(!policy.process(WindowInputFocusEvent(type: 21, targetPID: 20, notification: 16384, focusOwnerPID: 10)).drop,
        "An already-current target is not forbidden from receiving normal system focus")
    _ = policy.process(WindowInputFocusEvent(type: 21, targetPID: 99, notification: 61698, focusOwnerPID: 20))
    check(policy.currentFocusPID == 10, "Only the real auxiliary receiver may update Changed state")
    policy.registered = false; policy.currentFocusPID = 20
    check(!policy.process(WindowInputFocusEvent(type: 21, targetPID: 20, notification: 16384, focusOwnerPID: 10)).drop)
}
do {
    var temporary = WindowInputFocusTemporaryState(lastEventAt: 0)
    check(!temporary.suppressTarget(WindowInputFocusEvent(type: 20, subtype: Int64.max), now: 1))
    check(temporary.sawEvent && !temporary.targetSawInactive && !temporary.foregroundSawActivation)
    check(temporary.suppressTarget(WindowInputFocusEvent(type: 19, subtype: Int64.max), now: 2))
    check(temporary.targetSawInactive && temporary.lastEventAt == 2)
    check(temporary.suppressForeground(WindowInputFocusEvent(type: 13, subtype: 1), now: 3))
    check(temporary.foregroundSawActivation && temporary.lastEventAt == 3)
    var quiet = WindowInputFocusTemporaryState(lastEventAt: 0)
    check(quiet.suppressForeground(WindowInputFocusEvent(type: 13, subtype: 22), now: 4))
    check(!quiet.sawEvent && !quiet.foregroundSawActivation && quiet.lastEventAt == 4)
    check(!quiet.suppressTarget(WindowInputFocusEvent(type: 13, subtype: Int64.max), now: 5))
}
do {
    let old = WindowInputFocusForegroundWindow(pid: 20, processStartedAt: 1, windowID: 55, element: AXUIElementCreateApplication(20))
    func record(_ id: UInt32, _ owner: Int32, _ layer: Int32) -> [String: Any] {
        [kCGWindowNumber as String: id, kCGWindowOwnerPID as String: owner, kCGWindowLayer as String: layer]
    }
    check(windowInputFocusNeedsOldFrontRestore([record(44, 10, 0), record(55, 20, 0)], targetPID: 10, oldWindow: old))
    check(!windowInputFocusNeedsOldFrontRestore([record(44, 10, 1), record(55, 20, 0)], targetPID: 10, oldWindow: old))
    check(!windowInputFocusNeedsOldFrontRestore([record(55, 20, 0), record(44, 10, 0)], targetPID: 10, oldWindow: old))
    check(!windowInputFocusNeedsOldFrontRestore([record(44, 10, 0), record(55, 30, 0)], targetPID: 10, oldWindow: old))
}
for (type, subtype) in [(13, 1), (13, 2), (21, -32768)] as [(UInt, Int16)] {
    let event = try windowInputFocusNotification(type: type, subtype: subtype)
    check(event.type.rawValue == UInt32(type) && NSEvent(cgEvent: event)?.locationInWindow == .zero && event.flags.isEmpty, "Focus constructor event type/location/flags: \(type) actual \(event.type.rawValue) \(event.location) \(event.flags.rawValue)")
    check(event.getIntegerValueField(CGEventField(rawValue: 51)!) == 0, "Nil-window focus must not add an activation-point click")
    let actualSubtype = event.getIntegerValueField(CGEventField(rawValue: type == 21 ? 64 : 83)!)
    check(actualSubtype == (type == 21 ? Int64(UInt16(bitPattern: subtype)) : Int64(subtype)), "Focus constructor subtype field")
    check(event.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid()), "All focus notifications identify the helper, including cleanup")
}
// Service scheduling uses a fake main loop and monotonic clock. No AppKit
// application, event tap, real notification, sleep or input event is required.
do {
    check(Thread.isMainThread)
    let mainLoop = CFRunLoopGetMain()
    var context = CFRunLoopSourceContext(version: 0, info: nil, retain: nil, release: nil,
        copyDescription: nil, equal: nil, hash: nil, schedule: nil, cancel: nil, perform: { _ in })
    let keepAlive = CFRunLoopSourceCreate(kCFAllocatorDefault, 0, &context)!
    CFRunLoopAddSource(mainLoop, keepAlive, .defaultMode)
    defer { CFRunLoopRemoveSource(mainLoop, keepAlive, .defaultMode); CFRunLoopSourceInvalidate(keepAlive) }
    var delivered = 0
    CFRunLoopPerformBlock(mainLoop, CFRunLoopMode.defaultMode.rawValue) {
        check(Thread.isMainThread); delivered += 1
    }
    CFRunLoopWakeUp(mainLoop)
    windowInputMainRunLoopService.service()
    check(delivered == 1, "The production backend services a real default-mode main-loop block without GUI or AX")
    windowInputMainRunLoopService.service()
    check(delivered == 1, "The service does not replay an already delivered callback")
}
do {
    var main = true, clock: UInt64 = 10_000_000, turns: [TimeInterval] = [], sleeps: [UInt32] = []
    let service = WindowInputMainRunLoopService(isMainThread: { main }, now: { clock }, runTurn: {
        turns.append($0)
    }, sleepMicroseconds: { sleeps.append($0); clock += UInt64($0) * 1_000 })
    service.service()
    check(turns == [0.001] && sleeps.isEmpty)
    service.service(until: clock + 250_000)
    check(turns.last == 0.00025, "One main turn is clipped to the existing deadline")
    let previousTurns = turns.count
    service.service(until: clock)
    service.service(until: clock - 1)
    main = false; service.service()
    check(turns.count == previousTurns && sleeps.isEmpty, "Expired budgets and worker callers never pump")
    main = true; turns = []
    service.pause(nanoseconds: 5_000_000)
    check(turns == [0.001] && sleeps == [5000] && clock == 15_000_000,
        "A no-source immediate return preserves the original polling wait without busy-spin")
    turns = []; sleeps = []
    service.pause(nanoseconds: 10_000_000, until: clock + 2_500_000)
    check(turns == [0.001] && sleeps == [2500] && clock == 17_500_000)
    turns = []; sleeps = []
    service.pause(nanoseconds: 0)
    service.pause(nanoseconds: 5_000_000, until: clock)
    check(turns.isEmpty && sleeps.isEmpty)
}
do {
    var clock: UInt64 = 1_000_000, turns = 0, slept: UInt32 = 0
    var service: WindowInputMainRunLoopService!
    service = WindowInputMainRunLoopService(isMainThread: { true }, now: { clock }, runTurn: { wait in
        turns += 1
        service.service()
        service.pause(nanoseconds: 5_000_000)
        clock += UInt64((wait * 1_000_000_000).rounded())
    }, sleepMicroseconds: { slept += $0; clock += UInt64($0) * 1_000 })
    service.pause(nanoseconds: 5_000_000)
    check(turns == 1 && slept == 4000 && clock == 6_000_000,
        "A delivered callback cannot recursively pump or wait, and its runtime counts toward the pause")
    service.service(until: clock + 250_000)
    check(turns == 2 && clock == 6_250_000, "The reentrancy guard resets after the outer turn")
    service = nil
}
do {
    var clock: UInt64 = 1_000_000, turns = 0, sleeps = 0
    let service = WindowInputMainRunLoopService(isMainThread: { true }, now: { clock }, runTurn: { wait in
        check(wait <= 0.001)
        turns += 1; clock += 20_000_000
    }, sleepMicroseconds: { _ in sleeps += 1 })
    let deadline = clock + 2_000_000
    service.pause(nanoseconds: 10_000_000, until: deadline)
    service.service(until: deadline)
    check(turns == 1 && sleeps == 0 && clock > deadline,
        "A long callback cannot restart a deadline or add another wait after it expires")
    check(windowInputFocusSettleReason(unsafe: true, frontKnown: true, frontRegular: true,
        focusKnown: true, focusEqual: true) == .unsafe, "A serviced main loop never washes an unsafe cleanup state")
}
do {
    func activationPointValue(_ point: CGPoint) -> AXValue {
        var point = point
        return AXValueCreate(.cgPoint, &point)!
    }
    let inside = CGPoint(x: -50, y: 80)
    let outside = CGPoint(x: -500, y: -400)
    check(windowInputFocusActivationPoint(.success, activationPointValue(inside)) == inside)
    check(windowInputFocusActivationPoint(.success, activationPointValue(outside)) == outside,
        "Reading an activation point does not authorize a mouse event at it")
    for error in [AXError.attributeUnsupported, .noValue, .cannotComplete, .invalidUIElement] {
        check(windowInputFocusActivationPoint(error, activationPointValue(inside)) == nil)
    }
    check(windowInputFocusActivationPoint(.success, nil) == nil)
    check(windowInputFocusActivationPoint(.success, "not-a-point" as CFString) == nil)
    var size = CGSize(width: 10, height: 10)
    check(windowInputFocusActivationPoint(.success, AXValueCreate(.cgSize, &size)) == nil)
    for point in [CGPoint(x: Double.nan, y: 80), CGPoint(x: -50, y: Double.infinity)] {
        check(windowInputFocusActivationPoint(.success, activationPointValue(point)) == nil)
    }
    let exact = AXWindowNumberIdentity(pid: window.pid, windowId: window.windowId)
    for point in [inside, outside] {
        let configuration = windowInputFocusActivationConfiguration(window: window, activationPoint: point,
            nativeIdentity: exact, bindingMatches: true)
        check(configuration.windowID == window.windowId && configuration.route == .windowNotificationOnly)
        let notification = try windowInputFocusNotification(type: 13, subtype: 1, windowID: configuration.windowID)
        check(notification.type.rawValue == 13 && notification.flags.rawValue == 0xc0000)
        check(NSEvent(cgEvent: notification)?.windowNumber == Int(window.windowId))
        check(NSEvent(cgEvent: notification)?.locationInWindow == .zero,
            "The optional point gates one notification and never becomes a click destination")
        check(notification.getIntegerValueField(CGEventField(rawValue: 83)!) == 1)
        check(notification.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid()))
    }
    for (point, identity, bound) in [
        (nil, exact, true), (inside, nil, true), (inside, exact, false),
        (inside, AXWindowNumberIdentity(pid: window.pid + 1, windowId: window.windowId), true),
        (inside, AXWindowNumberIdentity(pid: window.pid, windowId: window.windowId + 1), true),
        (inside, AXWindowNumberIdentity(pid: window.pid, windowId: 0), true),
        (CGPoint(x: Double.nan, y: 80), exact, true)
    ] as [(CGPoint?, AXWindowNumberIdentity?, Bool)] {
        let configuration = windowInputFocusActivationConfiguration(window: window, activationPoint: point,
            nativeIdentity: identity, bindingMatches: bound)
        check(configuration.windowID == 0 && configuration.route == .nilWindow)
        let notification = try windowInputFocusNotification(type: 13, subtype: 1, windowID: configuration.windowID)
        check(notification.flags.isEmpty && NSEvent(cgEvent: notification)?.windowNumber == 0)
    }
    for (type, subtype) in [(13, 2), (21, -32768)] as [(UInt, Int16)] {
        do {
            _ = try windowInputFocusNotification(type: type, subtype: subtype, windowID: window.windowId)
            fatalError("Only activation13/1 can carry the exact window and 0xc0000 flags")
        } catch let error as HelperError { check(error.code == "unsupported_receiver") }
    }
}
do {
    let mouse = ["ok": false, "dispatched": false] as [String: Any]
    let focus = windowInputFocusReceipt(mouse, previousPostCount: 0, snapshot: WindowInputFocusSnapshot(postedCount: 1, state: .retained))
    check(focus["dispatched"] as? Bool == false && focus["focusPosted"] as? Bool == true && focus["focusState"] as? String == "retained")
    check(focus["eventCount"] == nil && focus["releaseSent"] == nil, "Focus cannot manufacture a mouse dispatch or up")
    let later = windowInputFocusReceipt(mouse, previousPostCount: 1, snapshot: WindowInputFocusSnapshot(postedCount: 1, state: .released))
    check(later["focusPosted"] as? Bool == false && later["focusState"] as? String == "released")
}
do {
    var focus = WindowInputFocusSnapshot(postedCount: 0, state: .inactive)
    let session = try WindowInputSessionState(window: window, now: began)
    let failed = try session.handle(sessionCommand("1", request: sessionClick), now: began + 1, focusSnapshot: { focus }) { _ in
        focus = WindowInputFocusSnapshot(postedCount: 1, state: .retained)
        throw windowInputError("cancelled")
    }
    check(failed["dispatched"] as? Bool == false && failed["focusPosted"] as? Bool == true && failed["focusState"] as? String == "retained")
    check(failed["eventCount"] == nil && failed["releaseSent"] == nil, "Focus-only side effects never invent mouse events")
    let next = try session.handle(sessionCommand("2", request: sessionClick), now: began + 2, focusSnapshot: { focus }) { _ in
        focus = WindowInputFocusSnapshot(postedCount: 1, state: .unconfirmed)
        throw windowInputError("target_changed")
    }
    check(next["focusPosted"] as? Bool == false && next["focusState"] as? String == "unconfirmed" && session.stopped)
    check((try? session.handle(sessionCommand("3", request: sessionClick), now: began + 3) { _ in fatalError("Unconfirmed focus was reused") }) == nil)
    let idle = WindowInputFocusSession(window: window)
    check(idle.snapshot.state == .inactive && idle.shutdown().state == .inactive, "An unused session never starts native taps or posts focus")
}
for sequence in [clickEvents, rightEvents, doubleEvents, commandEvents] {
    for step in sequence {
        check(step.event.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid()))
        if let release = step.release { check(release.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid())) }
    }
}
do {
    let events = try preparedMouseEvents("click", extra: ["point": ["x": -99, "y": 41]])
    let down = events[0].event, up = events[1].event
    down.timestamp = 1; up.timestamp = 1
    let afterSyntheticActivation = DispatchTime.now().uptimeNanoseconds
    var sent: [UInt64] = []
    let silent = WindowInputPointerFeedback(enabled: false)
    for event in [down, up] {
        postWindowInputEvent(event, feedback: silent, post: { value in
            check(value.timestamp >= afterSyntheticActivation && value.timestamp <= DispatchTime.now().uptimeNanoseconds,
                "Preallocated mouse events must be timestamped at send, after synthetic activation")
            if let previous = sent.last { check(value.timestamp >= previous, "The actual up cannot precede its down") }
            sent.append(value.timestamp)
        })
    }
    check(sent.count == 2 && down.type == .leftMouseDown && up.type == .leftMouseUp)
    down.timestamp = 1; up.timestamp = 1
    let cancellationFloor = DispatchTime.now().uptimeNanoseconds
    var validation = 0, cleanupPosts = 0
    do {
        _ = try runDirectedInputSequence([
            DirectedInputStep(event: down, delayBeforeMs: 0, release: up, completesRelease: false),
            DirectedInputStep(event: up, delayBeforeMs: 15, release: nil, completesRelease: true)
        ], wait: { _ in }, validate: {
            validation += 1
            if validation == 2 { throw windowInputError("cancelled") }
        }, canRelease: { true }, post: { event in
            postWindowInputEvent(event, feedback: silent, post: { value in
                check(value.timestamp >= cancellationFloor && value.timestamp <= DispatchTime.now().uptimeNanoseconds,
                    "The unique cancellation release uses the same actual-send timestamp path")
                cleanupPosts += 1
            })
        })
        fatalError("Cancellation did not interrupt the prepared sequence")
    } catch let error as WindowInputExecutionError {
        check(error.eventCount == 2 && error.releaseSent && cleanupPosts == 2)
    }
}
print("directedInputChecks=\(checks)")
`);
      const sources = ['macos-click.swift', 'macos-semantic.swift', 'macos-window-input.swift', 'macos-window-input-focus.swift', 'macos-window-input-focus-taps.swift', 'macos-window-input-session.swift']
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
