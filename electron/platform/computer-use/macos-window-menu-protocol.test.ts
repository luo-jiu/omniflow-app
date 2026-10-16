import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('native window menu session contract', () => {
  it('binds exact ancestry, revokes closed menu observations and bounds private capture/output', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-window-menu-policy-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import Foundation
import ApplicationServices
var checks = 0
func check(_ value: Bool, _ detail: String = "") { checks += 1; guard value else { fatalError("Menu check \(checks) failed: \(detail)") } }
func json(_ value: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: value) }
func parses(_ value: [String: Any]) -> Bool { (try? parseWindowMenuCommand(json(value))) != nil }
for name in ["observe", "close"] {
    check(parses(["requestId": "r-1", "command": name]))
    check(!parses(["requestId": "r-1", "command": name, "observationId": "old"]))
}
for command in ["action", "resolvePointer"] {
    for operation in ["open", "press", "cancel"] {
        check(parses(["requestId": "r-2", "command": command, "observationId": "o_2", "itemId": "i-1", "operation": operation]))
    }
    for operation in ["click", "escape", "AXRaise", "AXPress", "constructor"] {
        check(!parses(["requestId": "r-2", "command": command, "observationId": "o_2", "itemId": "i-1", "operation": operation]))
    }
    check(!parses(["requestId": "r-2", "command": command, "observationId": "o_2", "itemId": "i-1"]))
    for field in ["observationId", "itemId", "operation"] {
        var missing: [String: Any] = ["requestId": "r-2", "command": command, "observationId": "o_2", "itemId": "i-1", "operation": "press"]
        missing[field] = NSNull()
        check(!parses(missing))
    }
    check(!parses(["requestId": "r-2", "command": command, "observationId": "o_2", "itemId": "i-1", "operation": "press", "point": ["x": 10, "y": 20]]))
    check(!parses(["requestId": "r-2", "command": command, "observationId": "o_2", "itemId": "i-1", "operation": "press", "menuSurface": [:]]))
}
for token in ["", "a b", "a\nb", "é", String(repeating: "a", count: 65)] {
    check(!parses(["requestId": token, "command": "observe"]))
}
check(!parses(["requestId": true, "command": "observe"]))
check(!parses(["requestId": "r", "command": "capture", "observationId": "o", "displayId": 1]))
check(!parses(["requestId": "r", "command": "capture", "observationId": NSNull()]))
check((try? parseWindowMenuCommand(Data("{\"requestId\":\"r\",\"command\":\"observe\",\"command\":\"close\"}".utf8))) == nil)
do { check(try parseWindowMenuCommand(Data()) == nil) } catch { fatalError("Heartbeat rejected") }

// A persistent menu helper can capture only its frozen ordinary window. The
// new private read has no menu observation capability or menu-expanded crop.
let captureTarget = WindowIdentity(windowId: 10, pid: 20, processStartedAt: 30, layer: 0,
    bounds: Rect(x: 100, y: 100, width: 600, height: 400), title: "Target")
let capturePointer = WindowIdentity(windowId: 11, pid: 21, processStartedAt: 31, layer: 102,
    bounds: Rect(x: 120, y: 120, width: 36, height: 36), title: "Pointer")
func captureRequest(_ object: [String: Any], window: WindowIdentity = captureTarget) throws -> WindowRequest {
    guard let command = try parseWindowMenuCommand(json(object)) else { fatalError("Missing capture command") }
    return try windowMenuCaptureWindowRequest(command, window: window)
}
let plainCaptureCommand: [String: Any] = ["requestId": "capture-1", "command": "captureWindow"]
let plainCapture = try! captureRequest(plainCaptureCommand)
check(plainCapture.window.windowId == captureTarget.windowId && plainCapture.window.bounds == captureTarget.bounds)
check(plainCapture.scope == nil && plainCapture.pointerWindow == nil)
let pointerCapture = try! captureRequest(["requestId": "capture-2", "command": "captureWindow", "pointerWindow": capturePointer.json])
check(pointerCapture.pointerWindow?.windowId == capturePointer.windowId && pointerCapture.pointerWindow?.layer == 102)
for (field, value): (String, Any) in [("observationId", "old"), ("itemId", "item"), ("operation", "cancel"),
    ("window", captureTarget.json), ("scope", [:]), ("bounds", captureTarget.bounds.json), ("menuSurface", capturePointer.json)] {
    var command = plainCaptureCommand; command[field] = value
    check(!parses(command), field)
}
for value: Any in [NSNull(), true, [:]] {
    check(!parses(["requestId": "r", "command": "captureWindow", "pointerWindow": value]))
}
var malformedPointer = capturePointer.json
malformedPointer["title"] = NSNull()
check(!parses(["requestId": "r", "command": "captureWindow", "pointerWindow": malformedPointer]))
malformedPointer = capturePointer.json; malformedPointer["extra"] = true
check(!parses(["requestId": "r", "command": "captureWindow", "pointerWindow": malformedPointer]))
for (field, value): (String, Any) in [("windowId", 0), ("windowId", true), ("pid", captureTarget.pid),
    ("processStartedAt", 0), ("processStartedAt", NSNull()), ("layer", 101)] {
    var pointer = capturePointer.json; pointer[field] = value
    check((try? captureRequest(["requestId": "r", "command": "captureWindow", "pointerWindow": pointer])) == nil, field)
}
for bounds in [Rect(x: 90, y: 100, width: 36, height: 36), Rect(x: 680, y: 120, width: 36, height: 36),
    Rect(x: 120, y: 120, width: 129, height: 36), Rect(x: 120, y: 120, width: 0, height: 36)] {
    var pointer = capturePointer.json; pointer["bounds"] = bounds.json
    check((try? captureRequest(["requestId": "r", "command": "captureWindow", "pointerWindow": pointer])) == nil)
}
let elevatedCaptureTarget = WindowIdentity(windowId: 10, pid: 20, processStartedAt: 30, layer: 101,
    bounds: captureTarget.bounds, title: "Menu")
check((try? captureRequest(plainCaptureCommand, window: elevatedCaptureTarget)) == nil)
check((try? windowMenuCaptureWindowRequest(WindowMenuCommand(requestId: "r", command: "captureWindow", observationId: "old",
    itemId: nil, operation: nil, pointerWindow: nil), window: captureTarget)) == nil)
check((try? captureRequest(["requestId": "r", "command": "capture", "observationId": "old"])) == nil)
check((try? parseWindowMenuCommand(Data("{\"requestId\":\"r\",\"command\":\"captureWindow\",\"pointerWindow\":null,\"pointerWindow\":null}".utf8))) == nil)

let rootBounds = Rect(x: 100, y: 100, width: 600, height: 400)
// A known non-window AXWindows sibling cannot suppress a real menu capture.
// Unreadable identities / real-window bounds continue to block the whitelist.
var ordinaryRoles: [Int: String] = [1: kAXWindowRole, 2: kAXScrollAreaRole]
var ordinaryRects = [1: rootBounds]
func ordinary(_ ids: [Int]) -> [Rect]? {
    windowMenuOrdinaryWindowBounds(ids, role: { ordinaryRoles[$0] }, bounds: { ordinaryRects[$0] })
}
check(ordinary([1, 2]) == [rootBounds])
check(ordinary([2, 1]) == [rootBounds])
check(ordinary([2]) == [])
check(ordinary([1, 3]) == nil)
ordinaryRoles[2] = kAXWindowRole; check(ordinary([1, 2]) == nil)
ordinaryRects[2] = Rect(x: 0, y: 0, width: 0, height: 0); check(ordinary([1, 2]) == nil)
check(ordinary(Array(repeating: 1, count: 33)) == nil)
func fingerprint(role: String = kAXMenuItemRole, title: String = "Copy", enabled: Bool? = true,
                 actions: Set<String> = [kAXPressAction], submenu: Bool = false,
                 bounds: Rect = Rect(x: 650, y: 450, width: 200, height: 24)) -> WindowMenuFingerprint {
    WindowMenuFingerprint(role: role, title: title, description: nil, identifier: "menu-copy",
        bounds: bounds, enabled: enabled, actions: actions, hasSubmenu: submenu)
}
check(fingerprint().operations == [.press])
check(fingerprint(actions: [kAXPickAction]).operations == [.press])
check(fingerprint(actions: [kAXPickAction, kAXPressAction]).action(.press) == kAXPickAction)
check(fingerprint(actions: [kAXPickAction], submenu: true).operations.isEmpty)
check(fingerprint(submenu: true).operations == [.open])
check(fingerprint(submenu: true).action(.open) == kAXPressAction)
check(fingerprint(actions: [kAXShowMenuAction], submenu: true).action(.open) == kAXShowMenuAction)
check(fingerprint(enabled: false).operations.isEmpty)
check(fingerprint(enabled: nil).operations.isEmpty)
check(fingerprint(actions: [kAXRaiseAction]).operations.isEmpty)
check(fingerprint(role: kAXTextAreaRole, enabled: nil, actions: [kAXShowMenuAction]).operations == [.open])
check(fingerprint(role: kAXTextAreaRole, actions: [kAXPressAction]).operations.isEmpty)
check(fingerprint(role: kAXMenuRole, enabled: nil, actions: [kAXCancelAction]).operations == [.cancel])
check(fingerprint(role: kAXMenuRole, actions: [kAXPressAction]).operations.isEmpty)
check(fingerprint(role: kAXMenuBarItemRole).operations == [.open])
check(fingerprint(role: kAXMenuBarItemRole).action(.open) == kAXPressAction)
check(fingerprint(role: kAXMenuBarItemRole, actions: [kAXShowMenuAction]).action(.open) == kAXShowMenuAction)
check(fingerprint(role: kAXMenuBarItemRole, enabled: false).operations.isEmpty)
check(fingerprint(title: String(repeating: "a", count: 200)).operations == [.press])
check(fingerprint(title: String(repeating: "a", count: 201)).operations.isEmpty)
check(fingerprint(title: String(repeating: "中", count: 85)).operations == [.press])
check(fingerprint(title: String(repeating: "中", count: 86)).operations.isEmpty)
check(fingerprint(title: String(repeating: "🧪", count: 65)).operations.isEmpty)

// Source fingerprints contain only the exact supported callbacks. Changes to
// ignored custom descriptors do not change what can execute, while removing
// ShowMenu or replacing it with a polluted spelling revokes the old source.
func menuSource(_ actions: [String]) -> WindowMenuFingerprint? {
    guard let supported = candidateActionNames(.success, actions as NSArray as CFArray) else { return nil }
    return fingerprint(role: kAXMenuButtonRole, title: "Group", actions: supported)
}
let frozenSource = menuSource([kAXShowMenuAction, kAXPressAction, "Name:Move\nTarget:0x0"])!
check(frozenSource.operations == [.open] && frozenSource.action(.open) == kAXShowMenuAction)
var currentSource = menuSource([kAXShowMenuAction, kAXPressAction, "Name:Changed\u{202e}"])
let frozenSourceChain = [(1, frozenSource)]
check(windowMenuFingerprintChainMatches(frozenSourceChain, read: { _ in currentSource }))
currentSource = menuSource([kAXPressAction, "Name:Move\nTarget:0x0"])
check(currentSource?.operations.isEmpty == true)
check(!windowMenuFingerprintChainMatches(frozenSourceChain, read: { _ in currentSource }))
currentSource = menuSource([kAXPressAction, "AXShow\nMenu"])
check(currentSource?.operations.isEmpty == true)
check(!windowMenuFingerprintChainMatches(frozenSourceChain, read: { _ in currentSource }))
currentSource = menuSource([kAXShowMenuAction, "Name:Move\nTarget:0x0"])
check(!windowMenuFingerprintChainMatches(frozenSourceChain, read: { _ in currentSource }))
currentSource = menuSource([kAXShowMenuAction, kAXPressAction, String(repeating: "x", count: 2048)])
check(currentSource == nil)
check(!windowMenuFingerprintChainMatches(frozenSourceChain, read: { _ in currentSource }))

// A submenu can retain its AX reference, path and rectangle while an ancestor
// item changes meaning. Capture and action must both reject that old snapshot.
let ancestor = fingerprint(title: "Transform", submenu: true)
let leafMenu = fingerprint(role: kAXMenuRole, title: "Transform submenu", enabled: nil, actions: [kAXCancelAction])
let frozenMenuChain = [(1, ancestor), (2, leafMenu)]
var currentMenuChain = [1: ancestor, 2: leafMenu]
check(windowMenuFingerprintChainMatches(frozenMenuChain, read: { currentMenuChain[$0] }))
currentMenuChain[1] = fingerprint(title: "Delete", submenu: true)
check(currentMenuChain[2] == leafMenu)
check(!windowMenuFingerprintChainMatches(frozenMenuChain, read: { currentMenuChain[$0] }))
currentMenuChain[1] = fingerprint(title: "Transform", actions: [kAXShowMenuAction], submenu: true)
check(!windowMenuFingerprintChainMatches(frozenMenuChain, read: { currentMenuChain[$0] }))
currentMenuChain[1] = nil
check(!windowMenuFingerprintChainMatches(frozenMenuChain, read: { currentMenuChain[$0] }))
currentMenuChain[1] = ancestor
check(windowMenuFingerprintChainMatches(frozenMenuChain, read: { currentMenuChain[$0] }))

// The child is already an exact retained reference. A matching title or PID
// cannot replace it, skip a link or move it to another window/application.
var roles = [0: kAXWindowRole, 1: kAXTextAreaRole, 2: kAXMenuRole, 3: kAXMenuItemRole, 4: kAXMenuRole, 5: kAXMenuItemRole]
var parents = [1: 0, 2: 1, 3: 2, 4: 3, 5: 4]
var owners: [Int: Int] = [:]
var pids: [Int: Int32] = [:]
var forward = [0: [1], 1: [2], 2: [3], 3: [4], 4: [5]]
func read(_ id: Int) -> WindowMenuAncestryNode<Int>? {
    guard let role = roles[id] else { return nil }
    return WindowMenuAncestryNode(element: id, pid: pids[id] ?? 10, role: role, parent: parents[id], window: owners[id])
}
func pathIsValid(_ path: [Int] = [0, 0, 0, 0, 0], chain: [Int] = [0, 1, 2, 3, 4, 5]) -> Bool {
    windowMenuValidateBoundPath(path, chain: chain, root: 0, pid: 10, equal: ==, read: read,
        children: { node, prefix in forward[node].map { Array($0.prefix(prefix)) } })
}
check(pathIsValid())
parents[3] = 0; check(!pathIsValid()); parents[3] = 2
owners[2] = 99; check(!pathIsValid()); owners[2] = nil
pids[5] = 20; check(!pathIsValid()); pids[5] = nil
forward[4] = [99]; check(!pathIsValid()); forward[4] = [5]
forward[4] = []; check(!pathIsValid()); forward[4] = [5]
check(!pathIsValid([0, 0, 0, 0, 64]))
check(!pathIsValid([0, 0, 0, 0, -1]))
check(!pathIsValid([0, 0, 0, 0], chain: [0, 1, 2, 3, 4, 5]))
for role in [kAXApplicationRole, kAXWindowRole, kAXMenuBarRole, kAXSheetRole, kAXDrawerRole, "AXSecureTextField"] {
    roles[2] = role; check(!pathIsValid(), role)
}
roles[2] = kAXMenuRole
check(!windowMenuAncestry([0, 1, 2, 1], root: 0, pid: 10, equal: ==, read: read))
check(!windowMenuAncestry([], root: 0, pid: 10, equal: ==, read: read))
check(!windowMenuAncestry([2, 3], root: 0, pid: 10, equal: ==, read: read))
check(pathIsValid())

// Live app notifications identify popup roots even when their reverse parent
// does not match the originating control. Descendants still need exact edges.
func notifiedValid(_ chain: [Int] = [2, 3, 4, 5], current: Bool = true) -> Bool {
    windowMenuNotifiedAncestry(chain, root: 2, pid: 10, notificationCurrent: current,
        equal: ==, read: read,
        linked: { parent, child, _ in forward[parent]?.filter { $0 == child }.count == 1 })
}
parents[2] = 99; owners[2] = 99
check(notifiedValid())
check(!notifiedValid(current: false))
check(!notifiedValid([3, 4, 5]))
check(!notifiedValid([]))
parents[3] = 99; check(!notifiedValid()); parents[3] = 2
pids[2] = 20; check(!notifiedValid()); pids[2] = nil
pids[5] = 20; check(!notifiedValid()); pids[5] = nil
forward[4] = [5, 5]; check(!notifiedValid()); forward[4] = [5]
forward[4] = []; check(!notifiedValid()); forward[4] = [5]
for role in [kAXWindowRole, kAXApplicationRole, kAXTextAreaRole, kAXMenuBarRole] {
    roles[4] = role; check(!notifiedValid())
}
roles[4] = kAXMenuRole
check(!notifiedValid([2, 3, 2]))
parents[2] = 1; owners[2] = nil
check(pathIsValid())

// Both levels emit MenuOpened. Only the outer menu may seed traversal, in
// either notification order, so the submenu cannot skip its parent item's
// fingerprint through the global visited set.
func topNotified(_ element: Int, notifications: [Int] = [2, 4]) -> Int? {
    windowMenuTopNotifiedRoot(element, notifications: notifications, pid: 10, equal: ==, read: read,
        linked: { parent, child, _ in forward[parent]?.filter { $0 == child }.count == 1 })
}
for notifications in [[2, 4], [4, 2]] {
    check(notifications.compactMap { topNotified($0, notifications: notifications) } == [2, 2])
}
check(topNotified(2, notifications: [2]) == 2)
check(topNotified(4, notifications: [4]) == nil) // An available outer menu cannot be discarded.
check(topNotified(4, notifications: []) == nil)
check(topNotified(3, notifications: [2, 3, 4]) == nil)
parents[2] = nil; check(topNotified(4) == 2); parents[2] = 1
roles[99] = kAXWindowRole; parents[2] = 99
check(topNotified(4) == 2) // The unrelated non-menu top edge is not traversed.
parents[2] = 1; roles[99] = nil
forward[3] = []; check(topNotified(4) == nil); forward[3] = [4]
forward[2] = [3, 3]; check(topNotified(4) == nil); forward[2] = [3]
roles[3] = nil; check(topNotified(4) == nil); roles[3] = kAXMenuItemRole
pids[2] = 20; check(topNotified(4) == nil); pids[2] = nil
pids[4] = 20; check(topNotified(4) == nil); pids[4] = nil
parents[2] = 3; forward[3] = [4, 2]
check(topNotified(4) == nil) // A linked cycle must not create a new independent root.
parents[2] = 1; forward[3] = [4]
roles[6] = kAXMenuRole; roles[7] = kAXMenuItemRole
parents[2] = 7; parents[7] = 6; parents[6] = nil; forward[6] = [7]; forward[7] = [2]
check(topNotified(4, notifications: [4, 6, 2]) == 6)
check(topNotified(2, notifications: [4, 6, 2]) != 2) // A retained root must remain the outermost proved root.
check(topNotified(4) == nil)
parents[2] = 1
for key in [6, 7] { roles[key] = nil; parents[key] = nil; forward[key] = nil }
check(topNotified(4) == 2 && pathIsValid())

let deepCount = maximumAXPathDepth + 2
func deepMenuNode(_ id: Int) -> WindowMenuAncestryNode<Int>? {
    let parent: Int? = id + 1 < deepCount ? id + 1 : nil
    return WindowMenuAncestryNode(element: id, pid: 10, role: kAXMenuRole, parent: parent, window: nil)
}
let tooDeepRoot: Int? = windowMenuTopNotifiedRoot(0, notifications: [0, deepCount - 1], pid: 10,
    equal: { $0 == $1 }, read: deepMenuNode, linked: { parent, child, _ in parent == child + 1 })
check(tooDeepRoot == nil)

// A menu scope has an independently selected app root. A menu bar, app-owned
// contextual menu or nested menu is eligible without traversing another window.
roles[10] = kAXApplicationRole; roles[11] = kAXMenuBarRole; roles[12] = kAXMenuBarItemRole
roles[13] = kAXMenuRole; roles[14] = kAXMenuItemRole; roles[15] = kAXMenuRole
parents[11] = 10; parents[12] = 11; parents[13] = 12; parents[14] = 13; parents[15] = 10
forward[10] = [11, 15]; forward[11] = [12]; forward[12] = [13]; forward[13] = [14]
func appValid(_ chain: [Int]) -> Bool {
    windowMenuApplicationAncestry(chain, application: 10, pid: 10, equal: ==, read: read,
        linked: { parent, child, _ in forward[parent]?.filter { $0 == child }.count == 1 })
}
check(appValid([10, 11, 12, 13, 14]))
check(appValid([10, 15]))
check(!appValid([0, 1, 2]))
check(!appValid([10]))
parents[14] = 15; check(!appValid([10, 11, 12, 13, 14])); parents[14] = 13
pids[13] = 20; check(!appValid([10, 11, 12, 13, 14])); pids[13] = nil
for role in [kAXWindowRole, kAXTextAreaRole, kAXSheetRole, kAXDrawerRole, "AXSecureTextField"] {
    roles[13] = role; check(!appValid([10, 11, 12, 13, 14]), role)
}
roles[13] = kAXMenuRole
forward[12] = []; check(!appValid([10, 11, 12, 13, 14])); forward[12] = [13]
check(!appValid([10, 11, 12, 13, 12]))
check(appValid([10, 11, 12, 13, 14]))

// Captured AppKit topology: AXMenuOpened supplies an AXMenu whose parent is
// the exact original AXWindow, although that window's children omit the menu.
parents[2] = 0
func notifiedWindowMenu(_ current: Bool = true) -> Bool {
    windowMenuOpenedWindowAncestry([0, 2, 3, 4, 5], root: 0, pid: 10,
        notificationCurrent: current, equal: ==, read: read,
        linked: { parent, child, _ in forward[parent]?.filter { $0 == child }.count == 1 })
}
check(forward[0] == [1])
check(notifiedWindowMenu())
check(!windowMenuValidateBoundPath([1, 0], chain: [0, 2, 3], root: 0, pid: 10, equal: ==, read: read,
    children: { node, prefix in forward[node].map { Array($0.prefix(prefix)) } }))
check(!notifiedWindowMenu(false))
parents[2] = 10; check(!notifiedWindowMenu()); parents[2] = 0
pids[2] = 20; check(!notifiedWindowMenu()); pids[2] = nil
owners[2] = 99; check(!notifiedWindowMenu()); owners[2] = 0
check(notifiedWindowMenu()); owners[2] = nil
forward[2] = []; check(!notifiedWindowMenu()); forward[2] = [3]
roles[3] = kAXTextAreaRole; check(!notifiedWindowMenu()); roles[3] = kAXMenuItemRole
roles[2] = kAXMenuItemRole; check(!notifiedWindowMenu()); roles[2] = kAXMenuRole
check(notifiedWindowMenu())
parents[2] = 1

let state = WindowMenuGeneration()
check(!state.matches("first", now: 100))
check(state.install("first", generation: 0, now: 100))
check(state.matches("first", now: 101))
check(!state.matches("first", now: 99))
check(!state.matches("first", now: 60_000_000_100))
check(!state.consume("wrong", now: 200))
check(state.matches("first", now: 200))
state.invalidate() // AXMenuClosed; references may be identical after reopening.
check(!state.matches("first", now: 200))
check(!state.install("stale-scan", generation: 0, now: 200))
check(state.install("second", generation: state.value, now: 200))
state.invalidate() // AXMenuOpened; a second hierarchy replaces the scan.
check(!state.consume("second", now: 300))
check(state.install("third", generation: state.value, now: 300))
check(state.consume("third", now: 301))
check(!state.consume("third", now: 302))

let target = WindowIdentity(windowId: 1, pid: 10, processStartedAt: 20, layer: 0, bounds: rootBounds, title: "Fixture")
let menuBounds = Rect(x: 650, y: 450, width: 200, height: 100)
func surface(id: UInt32 = 2, pid: Int32 = 10, started: Int64 = 20, layer: Int32 = 101, bounds: Rect = menuBounds) -> WindowIdentity {
    WindowIdentity(windowId: id, pid: pid, processStartedAt: started, layer: layer, bounds: bounds, title: nil)
}
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface()])?.windowId == 2)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface(), surface(id: 3)]) == nil)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface(pid: 11)]) == nil)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface(started: 21)]) == nil)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface(id: 1)]) == nil)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface(layer: 103)]) == nil)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface(layer: 0)]) == nil)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface(layer: 102)]) == nil)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface()], ordinaryWindowBounds: [menuBounds]) == nil)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface()], ordinaryWindowBounds: [rootBounds])?.windowId == 2)
check(windowMenuSurface(bounds: menuBounds, target: target, windows: [surface(bounds: Rect(x: 651, y: 450, width: 200, height: 100))]) == nil)
check(windowMenuCaptureBounds(rootBounds, menus: [menuBounds]) == Rect(x: 100, y: 100, width: 750, height: 450))
check(windowMenuCaptureBounds(rootBounds, menus: Array(repeating: menuBounds, count: 9)) == nil)
check(windowMenuCaptureBounds(rootBounds, menus: [Rect(x: 10000, y: 100, width: 10, height: 10)]) == nil)
check(windowMenuCaptureBounds(rootBounds, menus: [Rect(x: 100, y: .nan, width: 10, height: 10)]) == nil)

// Visual scope follows the nearest AXMenu, including an overlapping submenu
// and a 32pt-high popup. It is not inferred from the original window rectangle.
let smallMenuBounds = Rect(x: 200, y: 200, width: 160, height: 32)
let smallMenu = fingerprint(role: kAXMenuRole, bounds: smallMenuBounds)
let outerMenu = fingerprint(role: kAXMenuRole, bounds: rootBounds)
let smallItem = fingerprint(bounds: Rect(x: 208, y: 204, width: 100, height: 24))
let smallSurface = surface(id: 4, bounds: smallMenuBounds)
let visualAncestors = [(1, outerMenu), (2, ancestor), (3, smallMenu)]
var resolvedAncestors: [Int] = []
let smallPointer = windowMenuPointerTarget(item: smallItem, ancestors: visualAncestors,
    sourceIsWindow: true, target: target, surface: { element, _ in
        resolvedAncestors.append(element); return smallSurface
    })
check(resolvedAncestors == [3])
check(smallPointer?.point == WindowInputPoint(x: 258, y: 216))
check(smallPointer?.menuSurface?.windowId == 4)
check(windowMenuPointerTarget(item: smallItem, ancestors: visualAncestors,
    sourceIsWindow: true, target: target, surface: { element, _ in element == 1 ? surface(bounds: rootBounds) : nil }) == nil)
for wrong in [surface(id: 1, bounds: smallMenuBounds), surface(id: 0, bounds: smallMenuBounds),
              surface(pid: 11, bounds: smallMenuBounds), surface(started: 21, bounds: smallMenuBounds),
              surface(layer: 0, bounds: smallMenuBounds), surface(bounds: rootBounds)] {
    check(windowMenuPointerTarget(item: smallItem, ancestors: visualAncestors,
        sourceIsWindow: true, target: target, surface: { _, _ in wrong }) == nil)
}
let outsideMenuBounds = Rect(x: 900, y: 450, width: 160, height: 32)
let outsideMenu = fingerprint(role: kAXMenuRole, bounds: outsideMenuBounds)
let outsideItem = fingerprint(bounds: Rect(x: 908, y: 454, width: 100, height: 24))
let outsidePointer = windowMenuPointerTarget(item: outsideItem, ancestors: [(1, outsideMenu)],
    sourceIsWindow: false, target: target, surface: { _, _ in surface(id: 5, bounds: outsideMenuBounds) })
check(outsidePointer?.point == WindowInputPoint(x: 958, y: 466))
check(outsidePointer?.menuSurface?.windowId == 5)
check(windowMenuPointerTarget(item: smallItem, ancestors: [(1, outsideMenu)],
    sourceIsWindow: true, target: target, surface: { _, _ in surface(id: 5, bounds: outsideMenuBounds) }) == nil)
let sourceControl = fingerprint(role: kAXPopUpButtonRole, actions: [kAXShowMenuAction], bounds: smallItem.bounds)
let sourcePointer = windowMenuPointerTarget(item: sourceControl, ancestors: [] as [(Int, WindowMenuFingerprint)],
    sourceIsWindow: true, target: target, surface: { _, _ in fatalError("Source control must not guess a menu") })
check(sourcePointer?.point == WindowInputPoint(x: 258, y: 216))
check(sourcePointer != nil && sourcePointer?.menuSurface == nil)
check(windowMenuPointerTarget(item: sourceControl, ancestors: [] as [(Int, WindowMenuFingerprint)],
    sourceIsWindow: false, target: target, surface: { _, _ in smallSurface }) == nil)
check(windowMenuPointerTarget(item: fingerprint(role: kAXPopUpButtonRole, actions: [kAXShowMenuAction], bounds: outsideItem.bounds),
    ancestors: [] as [(Int, WindowMenuFingerprint)], sourceIsWindow: true,
    target: target, surface: { _, _ in smallSurface }) == nil)
for role in [kAXMenuItemRole, kAXMenuRole, kAXMenuBarRole, kAXMenuBarItemRole] {
    check(windowMenuPointerTarget(item: fingerprint(role: role, bounds: smallItem.bounds),
        ancestors: [] as [(Int, WindowMenuFingerprint)], sourceIsWindow: true,
        target: target, surface: { _, _ in smallSurface }) == nil)
}

// A real small pointer may extend past the popup. Empty union gaps, an
// unrelated rectangle and oversized panels cannot enlarge the capture crop.
let outsidePointerBounds = Rect(x: 1048, y: 466, width: 36, height: 36)
check(windowMenuPointerCaptureBounds(rootBounds, menus: [outsideMenuBounds], pointer: outsidePointerBounds)
    == Rect(x: 100, y: 100, width: 984, height: 402))
check(windowMenuPointerCaptureBounds(rootBounds, menus: [outsideMenuBounds],
    pointer: Rect(x: 800, y: 300, width: 36, height: 36)) == nil)
check(windowMenuPointerCaptureBounds(rootBounds, menus: [outsideMenuBounds],
    pointer: Rect(x: 1060, y: 450, width: 36, height: 36)) == nil)
check(windowMenuPointerCaptureBounds(rootBounds, menus: [outsideMenuBounds],
    pointer: Rect(x: 1048, y: 466, width: 37, height: 36)) == nil)
check(windowMenuPointerCaptureBounds(rootBounds, menus: [outsideMenuBounds],
    pointer: Rect(x: 1048, y: 466, width: 36, height: 37)) == nil)
check(windowMenuPointerCaptureBounds(rootBounds, menus: [outsideMenuBounds],
    pointer: Rect(x: 1048, y: .nan, width: 36, height: 36)) == nil)
check(windowMenuPointerCaptureBounds(rootBounds, menus: [], pointer: Rect(x: 80, y: 80, width: 36, height: 36))
    == Rect(x: 80, y: 80, width: 620, height: 420))
check(windowMenuPointerCaptureBounds(rootBounds, menus: Array(repeating: outsideMenuBounds, count: 9),
    pointer: outsidePointerBounds) == nil)

let manyItems: [[String: Any]] = (0..<128).map { ["itemId": "item-\($0)", "label": String(repeating: "\\\"", count: 100), "bounds": menuBounds.json] }
let lines = manyItems.map { _ in String(repeating: "中", count: 80) + "\n" }
let bounded = try! windowMenuObservationReceipt(requestId: "r", observationId: "o", items: manyItems,
    treeLines: lines, menus: [["bounds": menuBounds.json]], truncated: false)
check(bounded.retained > 0 && bounded.retained <= 128)
check((bounded.receipt["axTree"] as! String).utf8.count <= 12 * 1024)
check((try! JSONSerialization.data(withJSONObject: bounded.receipt)).count < maximumAXObservationOutputBytes)
check(bounded.receipt["truncated"] as? Bool == true)
let tight = try! windowMenuObservationReceipt(requestId: "r", observationId: "o", items: manyItems,
    treeLines: lines, menus: [["bounds": menuBounds.json]], truncated: false, maximumBytes: 2048)
check(tight.retained < 128 && tight.retained > 0)
check((try! JSONSerialization.data(withJSONObject: tight.receipt)).count < 2048)
check((tight.receipt["items"] as! [[String: Any]]).count == tight.retained)
check((try? windowMenuObservationReceipt(requestId: "r", observationId: "o", items: [], treeLines: [],
    menus: [["bounds": menuBounds.json]], truncated: false, maximumBytes: 32)) == nil)
check((try? windowMenuObservationReceipt(requestId: "r", observationId: "o", items: [["itemId": "i"]], treeLines: [],
    menus: [], truncated: false)) == nil)
print("windowMenuChecks=\(checks)")
`);
      const sources = ['macos-click.swift', 'macos-semantic.swift', 'macos-window-input.swift', 'macos-window-input-focus.swift', 'macos-window-input-focus-taps.swift',
        'macos-window-indicator.swift', 'macos-window-menu.swift']
        .map(name => fileURLToPath(new URL(`./${name}`, import.meta.url)));
      const binary = path.join(directory, 'window-menu-policy');
      const compiled = spawnSync('/usr/bin/xcrun', ['swiftc', ...sources, harness, '-o', binary], { encoding: 'utf8', timeout: 40_000 });
      expect(compiled.status, compiled.stderr).toBe(0);
      const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/windowMenuChecks=\d+/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 55_000);
});
