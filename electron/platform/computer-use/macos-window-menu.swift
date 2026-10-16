import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import ScreenCaptureKit
import os

// A menu lease owns AX references, never a global input channel. The approved
// window anchors the process, while an explicit menu scope also permits that
// application's menu bar and current menus as separate accessibility roots.
enum WindowMenuOperation: String, Decodable, CaseIterable { case open, press, cancel }

struct WindowMenuCommand: Decodable {
    let requestId: String
    let command: String
    let observationId: String?
    let itemId: String?
    let operation: WindowMenuOperation?
    let pointerWindow: WindowIdentity?
}

func windowMenuToken(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 64
        && value.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95 }
}

func parseWindowMenuCommand(_ data: Data) throws -> WindowMenuCommand? {
    if data.isEmpty { return nil }
    let (_, object) = try parseInput(data)
    guard let name = object["command"] as? String else { throw invalidRequest() }
    switch name {
    case "observe", "close": _ = try fields(object, required: ["requestId", "command"])
    case "action", "resolvePointer": _ = try fields(object, required: ["requestId", "command", "observationId", "itemId", "operation"])
    case "capture", "captureWindow":
        let required: Set<String> = name == "capture" ? ["requestId", "command", "observationId"] : ["requestId", "command"]
        _ = try fields(object, required: required, optional: ["pointerWindow"])
        if let pointer = object["pointerWindow"] {
            let fields = try fields(pointer, required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
            if let title = fields["title"], !(title is String) { throw invalidRequest() }
            try validateRectFields(fields["bounds"])
        }
    default: throw invalidRequest()
    }
    guard let value = try? JSONDecoder().decode(WindowMenuCommand.self, from: data), windowMenuToken(value.requestId),
          value.observationId.map(windowMenuToken) != false, value.itemId.map(windowMenuToken) != false else { throw invalidRequest() }
    if name == "action" || name == "resolvePointer" {
        guard value.observationId != nil, value.itemId != nil, value.operation != nil else { throw invalidRequest() }
    }
    if name == "capture", value.observationId == nil { throw invalidRequest() }
    return value
}

// Only the session's frozen ordinary window can be captured here. No caller
// window, menu union, observation scope or arbitrary extra surface is accepted.
func windowMenuCaptureWindowRequest(_ command: WindowMenuCommand, window: WindowIdentity) throws -> WindowRequest {
    guard command.command == "captureWindow", windowMenuToken(command.requestId),
          command.observationId == nil, command.itemId == nil, command.operation == nil else { throw invalidRequest() }
    let request = WindowRequest(window: window, pointerWindow: command.pointerWindow)
    try validateWindowRequest(request, allowPointer: true)
    return request
}

struct WindowMenuFingerprint: Equatable {
    let role: String
    let title: String
    let description: String?
    let identifier: String?
    let bounds: Rect
    let enabled: Bool?
    let actions: Set<String>
    let hasSubmenu: Bool

    var label: String {
        if !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        if let description = description, !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return description }
        return role == kAXMenuRole ? "Menu" : "Context menu (\(role))"
    }
    var operations: [WindowMenuOperation] {
        // Preserve the exact actionable identity; an overlong label is omitted
        // rather than shortened into the label of a different menu item.
        guard label.utf8.count <= 256, label.unicodeScalars.count <= 200 else { return [] }
        if role == kAXMenuRole { return actions.contains(kAXCancelAction) ? [.cancel] : [] }
        guard enabled != false else { return [] }
        if role == kAXMenuBarItemRole {
            return enabled == true && (actions.contains(kAXPressAction) || actions.contains(kAXShowMenuAction)) ? [.open] : []
        }
        if role == kAXMenuItemRole {
            guard enabled == true else { return [] }
            var result: [WindowMenuOperation] = []
            if actions.contains(kAXShowMenuAction) || (hasSubmenu && actions.contains(kAXPressAction)) { result.append(.open) }
            if !hasSubmenu && (actions.contains(kAXPickAction) || actions.contains(kAXPressAction)) { result.append(.press) }
            return result
        }
        return actions.contains(kAXShowMenuAction) ? [.open] : []
    }
    func action(_ operation: WindowMenuOperation) -> String? {
        guard operations.contains(operation) else { return nil }
        switch operation {
        case .cancel: return kAXCancelAction
        case .press: return actions.contains(kAXPickAction) ? kAXPickAction : kAXPressAction
        case .open: return actions.contains(kAXShowMenuAction) ? kAXShowMenuAction : kAXPressAction
        }
    }
}

func windowMenuFingerprintChainMatches<Element>(_ observed: [(Element, WindowMenuFingerprint)],
                                                read: (Element) -> WindowMenuFingerprint?) -> Bool {
    observed.allSatisfy { read($0.0) == $0.1 }
}

let windowMenuApplicationRoles: Set<String> = [kAXMenuRole, kAXMenuItemRole, kAXMenuBarRole, kAXMenuBarItemRole]

// Application menu scope is deliberately separate from ordinary window scope.
// No AXWindow, sheet or arbitrary application child is traversed on this route.
func windowMenuApplicationAncestry<Element>(_ chain: [Element], application: Element, pid: Int32,
                                           equal: (Element, Element) -> Bool,
                                           read: (Element) -> WindowMenuAncestryNode<Element>?,
                                           linked: (Element, Element, String) -> Bool) -> Bool {
    guard chain.count >= 2, chain.count <= maximumAXPathDepth + 1, equal(chain[0], application) else { return false }
    for (index, element) in chain.enumerated() {
        guard let node = read(element), node.pid == pid else { return false }
        if index == 0 { guard node.role == kAXApplicationRole else { return false }; continue }
        guard windowMenuApplicationRoles.contains(node.role),
              let parent = node.parent, equal(parent, chain[index - 1]),
              !chain.prefix(index).contains(where: { equal($0, element) }),
              linked(parent, element, node.role) else { return false }
    }
    return true
}

// Real AppKit contextual menus can name their originating AXWindow as parent
// while being absent from AXWindow.children. A fresh notification from the
// target application's observer supplies precisely that missing first edge.
// It does not waive menu ancestry, process identity or later child membership.
func windowMenuOpenedWindowAncestry<Element>(_ chain: [Element], root: Element, pid: Int32,
                                            notificationCurrent: Bool,
                                            equal: (Element, Element) -> Bool,
                                            read: (Element) -> WindowMenuAncestryNode<Element>?,
                                            linked: (Element, Element, String) -> Bool) -> Bool {
    guard notificationCurrent, chain.count >= 2, chain.count <= maximumAXPathDepth + 1,
          equal(chain[0], root) else { return false }
    for (index, element) in chain.enumerated() {
        guard let node = read(element), node.pid == pid else { return false }
        if index == 0 { guard node.role == kAXWindowRole else { return false }; continue }
        guard (node.role == kAXMenuRole || node.role == kAXMenuItemRole),
              let parent = node.parent, equal(parent, chain[index - 1]),
              !chain.prefix(index).contains(where: { equal($0, element) }) else { return false }
        if index == 1 { guard node.role == kAXMenuRole else { return false } }
        else if !linked(parent, element, node.role) { return false }
        if let window = node.window, !equal(window, root) { return false }
    }
    return true
}

struct WindowMenuAncestryNode<Element> {
    let element: Element
    let pid: Int32
    let role: String
    let parent: Element?
    let window: Element?
}

// AppKit popup menus can be present in a control's children while naming a
// different AXParent. The application's live MenuOpened reference is therefore
// an independent menu root, as in Codex's Controller menu context. It grants no
// arbitrary app descendants: only this same-process menu and proved menu edges.
func windowMenuNotifiedAncestry<Element>(_ chain: [Element], root: Element, pid: Int32,
                                        notificationCurrent: Bool,
                                        equal: (Element, Element) -> Bool,
                                        read: (Element) -> WindowMenuAncestryNode<Element>?,
                                        linked: (Element, Element, String) -> Bool) -> Bool {
    guard notificationCurrent, !chain.isEmpty, chain.count <= maximumAXPathDepth + 1,
          equal(chain[0], root) else { return false }
    for (index, element) in chain.enumerated() {
        guard let node = read(element), node.pid == pid else { return false }
        if index == 0 { guard node.role == kAXMenuRole else { return false }; continue }
        guard node.role == kAXMenuRole || node.role == kAXMenuItemRole,
              let parent = node.parent, equal(parent, chain[index - 1]),
              !chain.prefix(index).contains(where: { equal($0, element) }),
              linked(parent, element, node.role) else { return false }
    }
    return true
}

// A submenu also emits MenuOpened. Seeding it separately would let breadth-
// first traversal visit it before its parent and lose that parent's semantic
// fingerprint. Collapse proved menu-only ancestry to the outermost live
// notification; an unknown non-menu root edge remains outside this proof.
func windowMenuTopNotifiedRoot<Element>(_ element: Element, notifications: [Element], pid: Int32,
                                        equal: (Element, Element) -> Bool,
                                        read: (Element) -> WindowMenuAncestryNode<Element>?,
                                        linked: (Element, Element, String) -> Bool) -> Element? {
    guard notifications.contains(where: { equal($0, element) }) else { return nil }
    var reverse: [Element] = [], current = element
    while reverse.count <= maximumAXPathDepth {
        guard !reverse.contains(where: { equal($0, current) }), let node = read(current), node.pid == pid,
              node.role == kAXMenuRole || node.role == kAXMenuItemRole else { return nil }
        if reverse.isEmpty && node.role != kAXMenuRole { return nil }
        reverse.append(current)
        func selectedRoot() -> Element? {
            node.role == kAXMenuRole && notifications.contains(where: { equal($0, current) }) ? current : nil
        }
        guard let parent = node.parent else { return selectedRoot() }
        guard let parentNode = read(parent) else { return nil }
        if !windowMenuApplicationRoles.contains(parentNode.role) { return selectedRoot() }
        // Known menu ancestry cannot be discarded when its edge is stale or
        // unreadable. Menu-bar ancestry uses the complete application route.
        guard parentNode.pid == pid, parentNode.role == kAXMenuRole || parentNode.role == kAXMenuItemRole,
              linked(parent, current, node.role) else { return nil }
        current = parent
    }
    return nil
}

// This generic proof is exercised against cycles, foreign siblings, forged
// parent links and app-owned menu roots without creating an application.
func windowMenuAncestry<Element>(_ chain: [Element], root: Element, pid: Int32,
                                equal: (Element, Element) -> Bool,
                                read: (Element) -> WindowMenuAncestryNode<Element>?) -> Bool {
    guard !chain.isEmpty, chain.count <= maximumAXPathDepth + 1, equal(chain[0], root) else { return false }
    for (index, element) in chain.enumerated() {
        guard let node = read(element), node.pid == pid, !node.role.isEmpty,
              !node.role.contains("Secure"), node.role != kAXMenuBarRole,
              node.role != kAXApplicationRole else { return false }
        if index == 0 { guard node.role == kAXWindowRole else { return false } }
        else {
            guard node.role != kAXWindowRole, node.role != kAXSheetRole, node.role != kAXDrawerRole,
                  let parent = node.parent, equal(parent, chain[index - 1]),
                  !chain.prefix(index).contains(where: { equal($0, element) }) else { return false }
        }
        if let window = node.window, !equal(window, root) { return false }
    }
    return true
}

func windowMenuValidateBoundPath<Element>(_ path: [Int], chain: [Element], root: Element, pid: Int32,
                                         equal: (Element, Element) -> Bool,
                                         read: (Element) -> WindowMenuAncestryNode<Element>?,
                                         children: (Element, Int) -> [Element]?) -> Bool {
    guard chain.count == path.count + 1,
          windowMenuAncestry(chain, root: root, pid: pid, equal: equal, read: read) else { return false }
    for (depth, index) in path.enumerated() {
        guard index >= 0 && index < 64, let prefix = children(chain[depth], index + 1),
              prefix.count == index + 1, equal(prefix[index], chain[depth + 1]) else { return false }
    }
    return true
}

func windowMenuObservationReceipt(requestId: String, observationId: String,
                                  items: [[String: Any]], treeLines: [String], menus: [[String: Any]],
                                  truncated: Bool, maximumBytes: Int = maximumAXObservationOutputBytes,
                                  maximumTreeBytes: Int = 12 * 1024) throws -> (receipt: [String: Any], retained: Int) {
    guard items.count == treeLines.count, items.count <= 128, menus.count <= 8,
          windowMenuToken(requestId), windowMenuToken(observationId), maximumBytes > 0, maximumTreeBytes >= 0 else { throw invalidRequest() }
    var receipt: [String: Any] = ["ok": true, "requestId": requestId, "observationId": observationId,
        "items": [], "menus": menus, "axTree": "", "truncated": false]
    guard try JSONSerialization.data(withJSONObject: receipt).count < maximumBytes else { throw windowMenuError("output_limit") }
    var retained: [[String: Any]] = [], tree = "", omitted = truncated
    for (index, item) in items.enumerated() {
        let nextTree = tree + treeLines[index]
        let keepTree = nextTree.utf8.count <= maximumTreeBytes
        receipt["items"] = retained + [item]
        receipt["axTree"] = keepTree ? nextTree : tree
        // Reserve the longer spelling (false) for the complete JSON structure.
        guard try JSONSerialization.data(withJSONObject: receipt).count < maximumBytes else { omitted = true; break }
        retained.append(item)
        if keepTree { tree = nextTree } else { omitted = true }
    }
    receipt["items"] = retained; receipt["axTree"] = tree; receipt["truncated"] = omitted
    return (receipt, retained.count)
}

// A close/open callback advances the generation even if the application later
// reuses the same AX object, title and geometry for a visually identical menu.
final class WindowMenuGeneration {
    private(set) var value: UInt64 = 0
    private(set) var observationId: String?
    private(set) var observedAt: UInt64 = 0
    func invalidate() { value &+= 1; observationId = nil; observedAt = 0 }
    func install(_ id: String, generation: UInt64, now: UInt64) -> Bool {
        guard generation == value, windowMenuToken(id) else { return false }
        observationId = id; observedAt = now; return true
    }
    func matches(_ id: String, now: UInt64) -> Bool {
        observationId == id && now >= observedAt && now - observedAt < 60_000_000_000
    }
    func consume(_ id: String, now: UInt64) -> Bool {
        guard matches(id, now: now) else { return false }
        invalidate(); return true
    }
}

func windowMenuCaptureBounds(_ target: Rect, menus: [Rect]) -> Rect? {
    guard target.valid, menus.count <= 8, menus.allSatisfy({ $0.valid }) else { return nil }
    var result = target.cg
    for menu in menus { result = result.union(menu.cg) }
    let bounds = Rect(x: result.minX, y: result.minY, width: result.width, height: result.height)
    // Bounded attachment expansion is independent of the output pixel limit.
    guard bounds.valid, bounds.width <= target.width + 4096, bounds.height <= target.height + 4096 else { return nil }
    return bounds
}

// Only the owned small pointer can extend the crop beyond the proved windows.
// Intersection must be with a real source, not empty space in their union.
// This is an OmniFlow capture policy; it does not broaden the source whitelist.
func windowMenuPointerCaptureBounds(_ target: Rect, menus: [Rect], pointer: Rect) -> Rect? {
    guard let base = windowMenuCaptureBounds(target, menus: menus), pointer.valid,
          pointer.width <= 36, pointer.height <= 36,
          ([target] + menus).contains(where: { $0.intersection(pointer) != nil }) else { return nil }
    let expanded = base.cg.union(pointer.cg)
    let result = Rect(x: expanded.minX, y: expanded.minY, width: expanded.width, height: expanded.height)
    guard result.valid, result.x >= base.x - 36, result.y >= base.y - 36,
          result.x + result.width <= base.x + base.width + 36,
          result.y + result.height <= base.y + base.height + 36 else { return nil }
    return result
}

func windowMenuSurface(bounds: Rect, target: WindowIdentity, windows: [WindowIdentity],
                       ordinaryWindowBounds: [Rect] = []) -> WindowIdentity? {
    guard bounds.valid else { return nil }
    // This capture profile is a real AppKit popup-menu surface, not merely a
    // same-process rectangle. Ordinary AXWindows (even elevated ones) cannot
    // be imported into the menu whitelist by coincident geometry.
    guard !ordinaryWindowBounds.contains(where: { bounds.matchesAX($0) }) else { return nil }
    let menuLayer = CGWindowLevelForKey(.popUpMenuWindow)
    let matches = windows.filter { $0.windowId != target.windowId && $0.pid == target.pid
        && $0.processStartedAt == target.processStartedAt && $0.layer == menuLayer && menuLayer > 0
        && bounds.matchesAX($0.bounds) }
    return matches.count == 1 ? matches[0] : nil
}

// Finder includes a non-AXWindow entry in AXWindows. Only actual AXWindow
// rectangles exclude ordinary surfaces; known other roles are not windows.
// An unreadable identity or an actual window with unknown geometry still blocks
// mapping, so this cannot silently whitelist an unknown ordinary window.
func windowMenuOrdinaryWindowBounds<Element>(_ elements: [Element],
                                             role: (Element) -> String?, bounds: (Element) -> Rect?) -> [Rect]? {
    guard elements.count <= 32 else { return nil }
    var result: [Rect] = []
    for element in elements {
        guard let currentRole = role(element), !currentRole.isEmpty else { return nil }
        guard currentRole == kAXWindowRole else { continue }
        guard let currentBounds = bounds(element), currentBounds.valid else { return nil }
        result.append(currentBounds)
    }
    return result
}

struct WindowMenuPointerTarget {
    let point: WindowInputPoint
    let menuSurface: WindowIdentity?
}

// The nearest actual AXMenu decides visual scope, even when it overlaps the
// original window. Missing submenu proof must not fall back to an outer menu
// or to the original window. Only the hotspot is constrained here: a small
// native arrow may extend beyond a short (for example 32pt-high) menu.
func windowMenuPointerTarget<Element>(item: WindowMenuFingerprint,
                                      ancestors: [(Element, WindowMenuFingerprint)],
                                      sourceIsWindow: Bool, target: WindowIdentity,
                                      surface: (Element, WindowMenuFingerprint) -> WindowIdentity?) -> WindowMenuPointerTarget? {
    guard target.valid, item.bounds.valid else { return nil }
    let point = WindowInputPoint(x: item.bounds.x + item.bounds.width / 2,
        y: item.bounds.y + item.bounds.height / 2)
    guard point.valid, item.bounds.contains(x: point.x, y: point.y) else { return nil }
    if let nearest = ancestors.last(where: { $0.1.role == kAXMenuRole }) {
        guard let mapped = surface(nearest.0, nearest.1), mapped.windowId > 0,
              windowMenuSurface(bounds: nearest.1.bounds, target: target, windows: [mapped]) != nil,
              mapped.bounds.contains(x: point.x, y: point.y) else { return nil }
        return WindowMenuPointerTarget(point: point, menuSurface: mapped)
    }
    guard sourceIsWindow, !windowMenuApplicationRoles.contains(item.role), target.bounds.contains(item.bounds) else { return nil }
    return WindowMenuPointerTarget(point: point, menuSurface: nil)
}

func windowMenuExecutablePath(_ pid: Int32) -> String? {
    guard pid > 0 else { return nil }
    var bytes = [CChar](repeating: 0, count: 4096)
    let count = proc_pidpath(pid, &bytes, UInt32(bytes.count))
    guard count > 0, count < bytes.count, bytes[Int(count)] == 0 else { return nil }
    return String(cString: bytes)
}

func revalidateWindowMenuPointer(_ pointer: WindowIdentity, target: WindowIdentity,
                                parentPID: Int32, parentStartedAt: Int64) throws {
    try revalidateCapturePointer(pointer, target: target, parentPID: parentPID, parentStartedAt: parentStartedAt)
    guard let own = windowMenuExecutablePath(getpid()), let other = windowMenuExecutablePath(pointer.pid), own == other else {
        throw invalidRequest()
    }
}

enum WindowMenuRootOrigin { case window, menuBar, applicationChild(Int), focusedMenu, openedMenu, openedWindowMenu, notifiedMenu }

struct WindowMenuRoot {
    let origin: WindowMenuRootOrigin
    let element: AXUIElement
    let selector: AXUIElement
    // Complete application -> menu-root ancestry; one element for an exact
    // window or independent live notification root.
    let ancestry: [AXUIElement]
    let ancestorFingerprints: [(AXUIElement, WindowMenuFingerprint)]
}

struct WindowMenuBoundItem {
    let itemId: String
    let element: AXUIElement
    let chain: [AXUIElement]
    let path: [Int]
    let root: WindowMenuRoot
    let fingerprint: WindowMenuFingerprint
    let menuFingerprints: [(AXUIElement, WindowMenuFingerprint)]
    var json: [String: Any] {
        ["itemId": itemId, "role": fingerprint.role, "label": fingerprint.label,
         "bounds": fingerprint.bounds.json, "operations": fingerprint.operations.map { $0.rawValue }]
    }
}

struct WindowMenuBoundSurface {
    let element: AXUIElement
    let chain: [AXUIElement]
    let path: [Int]
    let root: WindowMenuRoot
    let fingerprint: WindowMenuFingerprint
    let menuFingerprints: [(AXUIElement, WindowMenuFingerprint)]
    let surface: WindowIdentity?
    var json: [String: Any] {
        var value: [String: Any] = ["bounds": fingerprint.bounds.json]
        if let surface = surface { value["surface"] = surface.json }
        return value
    }
}

var windowMenuCancelled: sig_atomic_t = 0
private let windowMenuLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "window-menu")

final class WindowMenuSession {
    let window: WindowIdentity
    let root: AXUIElement
    let application: AXUIElement
    let parentPID: Int32
    let parentStartedAt: Int64
    let generation = WindowMenuGeneration()
    private var observer: AXObserver?
    private var registrations: [(AXUIElement, CFString)] = []
    private var items: [String: WindowMenuBoundItem] = [:]
    private var menus: [WindowMenuBoundSurface] = []
    private var openedMenus: [AXUIElement] = []
    // Fixed reason codes only: never log labels, AX values or application identity.
    private var readFailures: [String: Int] = [:]
    private func rejected<T>(_ reason: String, error: AXError? = nil) -> T? {
        let key = reason + (error.map { ":\($0.rawValue)" } ?? "")
        readFailures[key, default: 0] += 1
        return nil
    }

    init(window: WindowIdentity, parentPID: Int32, parentStartedAt: Int64) throws {
        self.window = window; self.parentPID = parentPID; self.parentStartedAt = parentStartedAt
        try requireTrust()
        guard AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15) == .success else { throw invalidRequest() }
        try revalidateWindow(window)
        guard let root = axWindow(window) else { throw windowMenuError("target_changed") }
        self.root = root
        application = AXUIElementCreateApplication(window.pid)
        var created: AXObserver?
        guard AXObserverCreate(window.pid, { _, element, notification, context in
            guard let context = context else { return }
            Unmanaged<WindowMenuSession>.fromOpaque(context).takeUnretainedValue().notification(element, notification as String)
        }, &created) == .success, let created = created else { throw windowMenuError("menu_observer_unavailable") }
        observer = created
        let context = Unmanaged.passUnretained(self).toOpaque()
        for name in [kAXMenuOpenedNotification, kAXMenuClosedNotification] {
            let notification = name as CFString
            guard AXObserverAddNotification(created, application, notification, context) == .success else {
                shutdownObserver(); throw windowMenuError("menu_observer_unavailable")
            }
            registrations.append((application, notification))
        }
        for (element, name) in [(root, kAXUIElementDestroyedNotification), (application, kAXFocusedWindowChangedNotification)] {
            let notification = name as CFString
            if AXObserverAddNotification(created, element, notification, context) == .success { registrations.append((element, notification)) }
        }
        CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(created), .defaultMode)
    }
    deinit { shutdownObserver() }
    private func shutdownObserver() {
        guard let observer = observer else { return }
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
        for (element, name) in registrations { AXObserverRemoveNotification(observer, element, name) }
        registrations = []; self.observer = nil
    }
    func invalidate() { generation.invalidate(); items.removeAll(); menus.removeAll() }
    private func notification(_ element: AXUIElement, _ name: String) {
        invalidate()
        if name == kAXMenuOpenedNotification {
            if !openedMenus.contains(where: { CFEqual($0, element) }), openedMenus.count < 8 { openedMenus.append(element) }
        } else if name == kAXMenuClosedNotification {
            // A close can remove a whole subtree. Retained observer references
            // are not proof that any earlier menu in that subtree is still open.
            openedMenus.removeAll()
        }
    }
    func parentAlive() -> Bool {
        windowMenuCancelled == 0 && getppid() == parentPID && processStart(parentPID) == parentStartedAt
    }
    func validateRoot() throws {
        guard parentAlive() else { throw windowMenuError("cancelled") }
        try revalidateWindow(window)
        guard let current = axWindow(window), CFEqual(current, root) else { throw windowMenuError("target_changed") }
    }
    func pumpNotifications() { _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.001)) }

    private func node(_ element: AXUIElement, budget: ScanBudget? = nil) -> WindowMenuAncestryNode<AXUIElement>? {
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success, pid == window.pid else { return rejected("node_pid") }
        let (roleError, rawRole) = axAttribute(element, kAXRoleAttribute, budget: budget)
        guard let role = candidateIdentityText(roleError, rawRole, maximumBytes: 64, allowEmpty: false, budget: budget) else { return rejected("node_role", error: roleError) }
        if role == kAXTextFieldRole || role == kAXTextAreaRole {
            let (error, raw) = axAttribute(element, kAXSubroleAttribute, budget: budget)
            guard let state = semanticSubrole(error, raw, budget: budget), state.subrole?.contains("Secure") != true else { return nil }
        }
        func related(_ attribute: String, required: Bool) -> AXUIElement? {
            let (error, raw) = axAttribute(element, attribute, budget: budget)
            if !required && (error == .attributeUnsupported || error == .noValue) { return nil }
            guard error == .success, let raw = raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else { return rejected("node_parent", error: error) }
            return (raw as! AXUIElement)
        }
        let parent = CFEqual(element, root) || CFEqual(element, application) ? nil : related(kAXParentAttribute, required: true)
        let (windowError, rawWindow) = axAttribute(element, kAXWindowAttribute, budget: budget)
        var owner: AXUIElement?
        if windowError == .success {
            guard let rawWindow = rawWindow, CFGetTypeID(rawWindow) == AXUIElementGetTypeID() else { return rejected("node_window_type") }
            owner = (rawWindow as! AXUIElement)
        } else if windowError != .attributeUnsupported && windowError != .noValue { return rejected("node_window", error: windowError) }
        return WindowMenuAncestryNode(element: element, pid: pid, role: role, parent: parent, window: owner)
    }
    private func fingerprint(_ element: AXUIElement, budget: ScanBudget? = nil) -> WindowMenuFingerprint? {
        guard let node = node(element, budget: budget), node.pid == window.pid,
              let bounds = axRect(element, budget: budget) else { return rejected("fingerprint_node_bounds") }
        let (hiddenError, hidden) = axAttribute(element, "AXHidden", budget: budget)
        if hiddenError == .success {
            guard let hidden = hidden, CFGetTypeID(hidden) == CFBooleanGetTypeID(), !CFEqual(hidden, kCFBooleanTrue) else { return rejected("fingerprint_hidden") }
        } else if hiddenError != .attributeUnsupported && hiddenError != .noValue { return rejected("fingerprint_hidden", error: hiddenError) }
        let (titleError, titleRaw) = axAttribute(element, kAXTitleAttribute, budget: budget)
        guard let title = candidateIdentityText(titleError, titleRaw, maximumBytes: 256, allowMissing: true, budget: budget) else { return rejected("fingerprint_title", error: titleError) }
        var semantics: [String: String] = [:]
        for attribute in [kAXDescriptionAttribute, kAXIdentifierAttribute] {
            let (error, raw) = axAttribute(element, attribute, budget: budget)
            if error == .attributeUnsupported || error == .noValue { continue }
            guard let value = candidateIdentityText(error, raw, maximumBytes: 256, budget: budget) else { return rejected(attribute == kAXDescriptionAttribute ? "fingerprint_description" : "fingerprint_identifier", error: error) }
            semantics[attribute] = value
        }
        var rawActions: CFArray?
        let actionError = AXUIElementCopyActionNames(element, &rawActions)
        guard let actions = candidateActionNames(actionError, rawActions, budget: budget) else { return rejected("fingerprint_actions", error: actionError) }
        let (enabledError, enabledRaw) = axAttribute(element, kAXEnabledAttribute, budget: budget)
        let enabled: Bool?
        if enabledError == .attributeUnsupported || enabledError == .noValue { enabled = nil }
        else {
            guard let value = candidateEnabled(enabledError, enabledRaw, budget: budget) else { return rejected("fingerprint_enabled", error: enabledError) }
            enabled = value
        }
        var hasSubmenu = false
        if node.role == kAXMenuItemRole || node.role == kAXMenuBarItemRole {
            guard let children = axElements(element, attribute: kAXChildrenAttribute, limit: 64, requireComplete: true, budget: budget) else { return rejected("fingerprint_children") }
            for child in children {
                guard let identity = self.node(child, budget: budget), let parent = identity.parent, CFEqual(parent, element) else { return rejected("fingerprint_child_parent") }
                if identity.role == kAXMenuRole { hasSubmenu = true }
            }
        }
        return WindowMenuFingerprint(role: node.role, title: title, description: semantics[kAXDescriptionAttribute],
            identifier: semantics[kAXIdentifierAttribute], bounds: bounds, enabled: enabled, actions: actions, hasSubmenu: hasSubmenu)
    }
    private func related(_ element: AXUIElement, _ attribute: String, budget: ScanBudget? = nil) -> AXUIElement? {
        let (error, raw) = axAttribute(element, attribute, budget: budget)
        guard error == .success, let raw = raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        return (raw as! AXUIElement)
    }
    private func applicationLinked(_ parent: AXUIElement, _ child: AXUIElement, _ role: String,
                                   directMenuRoot: AXUIElement? = nil, budget: ScanBudget? = nil) -> Bool {
        if CFEqual(parent, application), role == kAXMenuBarRole {
            return related(application, kAXMenuBarAttribute, budget: budget).map { CFEqual($0, child) } == true
        }
        if CFEqual(parent, application), role == kAXMenuRole,
           directMenuRoot.map({ CFEqual($0, child) }) == true {
            // Focused/AXMenuOpened roots are not necessarily in AXChildren.
            // Their selectors are checked by validMenuRoot; the parent and PID
            // proof still ends at this exact authorized AXApplication.
            return true
        }
        guard let children = axElements(parent, attribute: kAXChildrenAttribute, limit: 64, requireComplete: true, budget: budget) else { return false }
        return children.filter { CFEqual($0, child) }.count == 1
    }
    private func applicationChain(_ element: AXUIElement, budget: ScanBudget? = nil) -> [AXUIElement]? {
        var reverse: [AXUIElement] = [], current = element
        while reverse.count <= maximumAXPathDepth {
            guard budget?.ready() != false, !reverse.contains(where: { CFEqual($0, current) }),
                  let identity = node(current, budget: budget) else { return nil }
            reverse.append(current)
            if CFEqual(current, application) {
                let chain = Array(reverse.reversed())
                let menuRoot = chain.count > 1 && node(chain[1], budget: budget)?.role == kAXMenuRole ? chain[1] : nil
                return windowMenuApplicationAncestry(chain, application: application, pid: window.pid,
                    equal: { CFEqual($0, $1) }, read: { node($0, budget: budget) },
                    linked: { applicationLinked($0, $1, $2, directMenuRoot: menuRoot, budget: budget) }) ? chain : nil
            }
            guard windowMenuApplicationRoles.contains(identity.role), let parent = identity.parent else { return nil }
            current = parent
        }
        return nil
    }
    private func openedWindowChain(_ element: AXUIElement, notification: AXUIElement,
                                   budget: ScanBudget? = nil) -> [AXUIElement]? {
        guard openedMenus.contains(where: { CFEqual($0, notification) }) else { return nil }
        var reverse: [AXUIElement] = [], current = element
        while reverse.count <= maximumAXPathDepth {
            guard budget?.ready() != false, !reverse.contains(where: { CFEqual($0, current) }),
                  let identity = node(current, budget: budget) else { return nil }
            reverse.append(current)
            if CFEqual(current, root) {
                let chain = Array(reverse.reversed())
                return windowMenuOpenedWindowAncestry(chain, root: root, pid: window.pid, notificationCurrent: true,
                    equal: { CFEqual($0, $1) }, read: { node($0, budget: budget) },
                    linked: { applicationLinked($0, $1, $2, budget: budget) }) ? chain : nil
            }
            guard identity.role == kAXMenuRole || identity.role == kAXMenuItemRole,
                  let parent = identity.parent else { return nil }
            current = parent
        }
        return nil
    }
    private func validMenuRoot(_ selected: WindowMenuRoot, budget: ScanBudget? = nil) -> Bool {
        switch selected.origin {
        case .window: return CFEqual(selected.element, root) && selected.ancestry.count == 1
        case .notifiedMenu:
            guard selected.ancestry.count == 1, CFEqual(selected.element, selected.selector),
                  let current = windowMenuTopNotifiedRoot(selected.element, notifications: openedMenus, pid: window.pid,
                    equal: { CFEqual($0, $1) }, read: { node($0, budget: budget) },
                    linked: { applicationLinked($0, $1, $2, budget: budget) }) else { return false }
            return CFEqual(current, selected.element)
        case .menuBar:
            guard node(selected.element, budget: budget)?.role == kAXMenuBarRole,
                  related(application, kAXMenuBarAttribute, budget: budget).map({ CFEqual($0, selected.element) }) == true else { return false }
        case .applicationChild(let index):
            guard node(selected.element, budget: budget)?.role == kAXMenuRole, index >= 0, index < 64,
                  let children = axElements(application, attribute: kAXChildrenAttribute, limit: index + 1, budget: budget),
                  children.count == index + 1, CFEqual(children[index], selected.element) else { return false }
        case .focusedMenu:
            guard node(selected.element, budget: budget)?.role == kAXMenuRole,
                  let focused = related(application, kAXFocusedUIElementAttribute, budget: budget),
                  let chain = applicationChain(focused, budget: budget), chain.contains(where: { CFEqual($0, selected.element) }) else { return false }
        case .openedMenu:
            guard node(selected.element, budget: budget)?.role == kAXMenuRole,
                  openedMenus.contains(where: { CFEqual($0, selected.selector) }),
                  let chain = applicationChain(selected.selector, budget: budget), chain.contains(where: { CFEqual($0, selected.element) }) else { return false }
        case .openedWindowMenu:
            guard node(selected.element, budget: budget)?.role == kAXMenuRole,
                  let selectorChain = openedWindowChain(selected.selector, notification: selected.selector, budget: budget),
                  selectorChain.contains(where: { CFEqual($0, selected.element) }),
                  let current = openedWindowChain(selected.element, notification: selected.selector, budget: budget),
                  current.count == selected.ancestry.count,
                  zip(current, selected.ancestry).allSatisfy({ CFEqual($0.0, $0.1) }),
                  windowMenuFingerprintChainMatches(selected.ancestorFingerprints, read: { fingerprint($0, budget: budget) }) else { return false }
            return true
        }
        guard let current = applicationChain(selected.element, budget: budget), current.count == selected.ancestry.count,
              zip(current, selected.ancestry).allSatisfy({ CFEqual($0.0, $0.1) }),
              selected.ancestorFingerprints.allSatisfy({ fingerprint($0.0, budget: budget) == $0.1 }) else { return false }
        return true
    }
    private func validChain(_ chain: [AXUIElement], selected: WindowMenuRoot, budget: ScanBudget? = nil) -> Bool {
        guard !chain.isEmpty, CFEqual(chain[0], selected.element), validMenuRoot(selected, budget: budget) else { return false }
        if case .notifiedMenu = selected.origin {
            return windowMenuNotifiedAncestry(chain, root: selected.element, pid: window.pid,
                notificationCurrent: openedMenus.contains(where: { CFEqual($0, selected.selector) }),
                equal: { CFEqual($0, $1) }, read: { node($0, budget: budget) },
                linked: { applicationLinked($0, $1, $2, budget: budget) })
        }
        if case .window = selected.origin {
            return windowMenuAncestry(chain, root: root, pid: window.pid, equal: { CFEqual($0, $1) }, read: { node($0, budget: budget) })
        }
        let complete = selected.ancestry + chain.dropFirst()
        if case .openedWindowMenu = selected.origin {
            return windowMenuOpenedWindowAncestry(complete, root: root, pid: window.pid,
                notificationCurrent: openedMenus.contains(where: { CFEqual($0, selected.selector) }),
                equal: { CFEqual($0, $1) }, read: { node($0, budget: budget) },
                linked: { applicationLinked($0, $1, $2, budget: budget) })
        }
        let menuRoot = complete.count > 1 && node(complete[1], budget: budget)?.role == kAXMenuRole ? complete[1] : nil
        return windowMenuApplicationAncestry(complete, application: application, pid: window.pid,
            equal: { CFEqual($0, $1) }, read: { node($0, budget: budget) },
            linked: { applicationLinked($0, $1, $2, directMenuRoot: menuRoot, budget: budget) })
    }
    private func validatePath(_ path: [Int], chain: [AXUIElement], selected: WindowMenuRoot) -> Bool {
        guard chain.count == path.count + 1, validChain(chain, selected: selected) else { return false }
        for (depth, index) in path.enumerated() {
            guard index >= 0, index < 64,
                  let children = axElements(chain[depth], attribute: kAXChildrenAttribute, limit: index + 1),
                  children.count == index + 1, CFEqual(children[index], chain[depth + 1]) else { return false }
        }
        return true
    }
    private func observationRoots(budget: ScanBudget) -> [WindowMenuRoot] {
        var roots = [WindowMenuRoot(origin: .window, element: root, selector: root, ancestry: [root], ancestorFingerprints: [])]
        func add(_ element: AXUIElement, origin: WindowMenuRootOrigin, selector: AXUIElement? = nil) {
            guard roots.count < 12, !roots.contains(where: { CFEqual($0.element, element) }),
                  let chain = applicationChain(element, budget: budget) else { return }
            var ancestors: [(AXUIElement, WindowMenuFingerprint)] = []
            for ancestor in chain.dropFirst().dropLast() {
                if node(ancestor, budget: budget)?.role == kAXMenuBarRole { continue }
                guard let value = fingerprint(ancestor, budget: budget) else { budget.truncated = true; return }
                ancestors.append((ancestor, value))
            }
            roots.append(WindowMenuRoot(origin: origin, element: element, selector: selector ?? element,
                ancestry: chain, ancestorFingerprints: ancestors))
        }
        if let menuBar = related(application, kAXMenuBarAttribute, budget: budget), node(menuBar, budget: budget)?.role == kAXMenuBarRole {
            add(menuBar, origin: .menuBar)
        }
        if let children = axElements(application, attribute: kAXChildrenAttribute, limit: 64, budget: budget) {
            for (index, child) in children.enumerated() where node(child, budget: budget)?.role == kAXMenuRole {
                add(child, origin: .applicationChild(index))
            }
        }
        // Prefer complete application ancestry whenever it is available.
        if let focused = related(application, kAXFocusedUIElementAttribute, budget: budget),
           let chain = applicationChain(focused, budget: budget), let menu = chain.dropFirst().first(where: { node($0, budget: budget)?.role == kAXMenuRole }) {
            add(menu, origin: .focusedMenu, selector: focused)
        }
        for opened in openedMenus {
            if let chain = applicationChain(opened, budget: budget), let menu = chain.dropFirst().first(where: { node($0, budget: budget)?.role == kAXMenuRole }) {
                add(menu, origin: .openedMenu, selector: opened)
            } else if roots.count < 12, let chain = openedWindowChain(opened, notification: opened, budget: budget), chain.count >= 2 {
                let menu = chain[1]
                if !roots.contains(where: { CFEqual($0.element, menu) }) {
                    roots.append(WindowMenuRoot(origin: .openedWindowMenu, element: menu, selector: opened,
                        ancestry: Array(chain.prefix(2)), ancestorFingerprints: []))
                }
            } else if roots.count < 12, node(opened, budget: budget)?.role == kAXMenuRole {
                guard let menu = windowMenuTopNotifiedRoot(opened, notifications: openedMenus, pid: window.pid,
                    equal: { CFEqual($0, $1) }, read: { node($0, budget: budget) },
                    linked: { applicationLinked($0, $1, $2, budget: budget) }) else { budget.truncated = true; continue }
                if !roots.contains(where: { CFEqual($0.element, menu) }) {
                    roots.append(WindowMenuRoot(origin: .notifiedMenu, element: menu, selector: menu,
                        ancestry: [menu], ancestorFingerprints: []))
                }
            }
        }
        return roots
    }
    private func ordinaryWindowBounds(budget: ScanBudget? = nil) -> [Rect]? {
        guard let windows = axElements(application, attribute: kAXWindowsAttribute, limit: 32, requireComplete: true, budget: budget) else { return nil }
        return windowMenuOrdinaryWindowBounds(windows,
            role: { node($0, budget: budget)?.role }, bounds: { axRect($0, budget: budget) })
    }

    func observe(requestId: String) throws -> [String: Any] {
        readFailures.removeAll(keepingCapacity: true)
        defer {
            let failures = readFailures.keys.sorted().map { "\($0)=\(readFailures[$0]!)" }.joined(separator: ",")
            windowMenuLogger.notice("observe failures=\(failures, privacy: .public) notificationRoots=\(self.openedMenus.count, privacy: .public) items=\(self.items.count, privacy: .public) menus=\(self.menus.count, privacy: .public)")
        }
        invalidate(); pumpNotifications(); try validateRoot()
        let epoch = generation.value
        let budget = ScanBudget(deadline: DispatchTime.now().uptimeNanoseconds + 2_500_000_000)
        let windows = try cgWindows()
        let ordinaryBounds = ordinaryWindowBounds(budget: budget)
        struct Entry { let element: AXUIElement; let chain: [AXUIElement]; let path: [Int]; let ancestors: [(AXUIElement, WindowMenuFingerprint)]; let selected: WindowMenuRoot }
        // Visit explicit app menu roots first, so a large document cannot hide
        // a currently open submenu behind its normal-window scan budget.
        let roots = observationRoots(budget: budget)
        var pending = roots.dropFirst().map { Entry(element: $0.element, chain: [$0.element], path: [], ancestors: $0.ancestorFingerprints, selected: $0) }
        pending.append(Entry(element: root, chain: [root], path: [], ancestors: [], selected: roots[0]))
        var visited: [AXUIElement] = []
        var head = 0, foundItems: [WindowMenuBoundItem] = [], foundMenus: [WindowMenuBoundSurface] = []
        while head < pending.count && budget.ready() && parentAlive() {
            if head % 16 == 0 { pumpNotifications(); guard generation.value == epoch else { throw windowMenuError("menu_changed") } }
            let entry = pending[head]; head += 1
            if visited.contains(where: { CFEqual($0, entry.element) }) { continue }
            visited.append(entry.element)
            guard validChain(entry.chain, selected: entry.selected, budget: budget), let identity = node(entry.element, budget: budget) else { readFailures["chain", default: 0] += 1; budget.truncated = true; continue }
            var ancestors = entry.ancestors
            let isMenu = identity.role == kAXMenuRole
            if isMenu {
                // Unshown submenu children normally have no usable rectangle.
                // Do not publish their descendants as visible menu choices.
                guard let menu = fingerprint(entry.element, budget: budget) else { continue }
                guard foundMenus.count < 8 else { budget.truncated = true; continue }
                ancestors.append((entry.element, menu))
                foundMenus.append(WindowMenuBoundSurface(element: entry.element, chain: entry.chain, path: entry.path,
                    root: entry.selected, fingerprint: menu, menuFingerprints: ancestors, surface: ordinaryBounds.flatMap {
                        windowMenuSurface(bounds: menu.bounds, target: window, windows: windows, ordinaryWindowBounds: $0)
                    }))
            }
            if let current = fingerprint(entry.element, budget: budget) {
                let inMenu = current.role == kAXMenuRole || (current.role == kAXMenuItemRole && !ancestors.isEmpty) || current.role == kAXMenuBarItemRole
                let source: Bool
                if case .window = entry.selected.origin {
                    source = current.role != kAXMenuItemRole && current.role != kAXMenuRole && current.role != kAXMenuBarItemRole
                        && window.bounds.contains(current.bounds) && !current.operations.isEmpty
                } else { source = false }
                if inMenu || source {
                    if foundItems.count < 128 && current.label.utf8.count <= 256 && current.label.unicodeScalars.count <= 200 {
                        foundItems.append(WindowMenuBoundItem(itemId: UUID().uuidString, element: entry.element,
                            chain: entry.chain, path: entry.path, root: entry.selected, fingerprint: current, menuFingerprints: ancestors))
                    } else { budget.truncated = true }
                }
                if current.role == kAXMenuItemRole || current.role == kAXMenuBarItemRole { ancestors.append((entry.element, current)) }
            }
            guard let children = axElements(entry.element, attribute: kAXChildrenAttribute, limit: 64, budget: budget) else { budget.truncated = true; continue }
            if entry.path.count >= maximumAXPathDepth { if !children.isEmpty { budget.truncated = true }; continue }
            for (index, child) in children.enumerated() {
                guard pending.count < 512 else { budget.truncated = true; break }
                pending.append(Entry(element: child, chain: entry.chain + [child], path: entry.path + [index], ancestors: ancestors, selected: entry.selected))
            }
        }
        if head < pending.count { budget.truncated = true }
        pumpNotifications(); try validateRoot()
        guard generation.value == epoch else { throw windowMenuError("menu_changed") }
        let observationId = UUID().uuidString
        let bounded = try windowMenuObservationReceipt(requestId: requestId, observationId: observationId,
            items: foundItems.map { $0.json }, treeLines: foundItems.map { item in
                "\(String(repeating: "  ", count: min(item.menuFingerprints.count, 8)))\(item.fingerprint.role) \(item.fingerprint.label)\(item.fingerprint.enabled == false ? " [disabled]" : "") [\(item.fingerprint.operations.map { $0.rawValue }.joined(separator: ","))]\n"
            }, menus: foundMenus.map { $0.json }, truncated: budget.truncated)
        let retained = Array(foundItems.prefix(bounded.retained))
        guard generation.install(observationId, generation: epoch, now: DispatchTime.now().uptimeNanoseconds) else { throw windowMenuError("menu_changed") }
        items = Dictionary(uniqueKeysWithValues: retained.map { ($0.itemId, $0) }); menus = foundMenus
        return bounded.receipt
    }

    // Shared by visual resolution and dispatch. Visual preparation never
    // consumes this observation; dispatch performs the same proof again.
    private func validatedItem(_ command: WindowMenuCommand) throws -> (id: String, item: WindowMenuBoundItem, action: String) {
        pumpNotifications(); try validateRoot()
        guard let id = command.observationId, generation.matches(id, now: DispatchTime.now().uptimeNanoseconds),
              let itemId = command.itemId, let item = items[itemId], let operation = command.operation,
              let action = item.fingerprint.action(operation) else { throw windowMenuError("stale_observation") }
        guard validatePath(item.path, chain: item.chain, selected: item.root), fingerprint(item.element) == item.fingerprint,
              windowMenuFingerprintChainMatches(item.menuFingerprints, read: { fingerprint($0) }) else { invalidate(); throw windowMenuError("menu_changed") }
        pumpNotifications(); try validateRoot()
        guard generation.matches(id, now: DispatchTime.now().uptimeNanoseconds) else { throw windowMenuError("stale_observation") }
        return (id, item, action)
    }

    func resolvePointer(_ command: WindowMenuCommand) throws -> [String: Any] {
        let checked = try validatedItem(command)
        let item = checked.item
        // Resolve only the retained menu's exact CG surface. This also checks
        // its complete ancestor fingerprints and excludes ordinary AXWindows.
        let frozen = try validateObservation(checked.id)
        let sourceIsWindow: Bool
        if case .window = item.root.origin { sourceIsWindow = true } else { sourceIsWindow = false }
        let resolved = windowMenuPointerTarget(item: item.fingerprint, ancestors: item.menuFingerprints,
            sourceIsWindow: sourceIsWindow, target: window, surface: { element, expected in
                let matches = frozen.filter { CFEqual($0.element, element) && $0.fingerprint == expected }
                return matches.count == 1 ? matches[0].surface : nil
            })
        // Notifications may arrive while reading the surface metadata. Keep
        // the receipt tied to this still-live observation without consuming it.
        pumpNotifications(); try validateRoot()
        guard generation.matches(checked.id, now: DispatchTime.now().uptimeNanoseconds) else { throw windowMenuError("stale_observation") }
        guard let resolved = resolved else {
            return ["ok": true, "requestId": command.requestId, "available": false, "reason": "menu_pointer_unavailable"]
        }
        var receipt: [String: Any] = ["ok": true, "requestId": command.requestId, "available": true,
            "observationId": checked.id, "itemId": item.itemId, "point": ["x": resolved.point.x, "y": resolved.point.y]]
        if let surface = resolved.menuSurface { receipt["menuSurface"] = surface.json }
        return receipt
    }

    func action(_ command: WindowMenuCommand, acknowledge: () throws -> Void) throws -> [String: Any] {
        let (id, item, action) = try validatedItem(command)
        guard generation.consume(id, now: DispatchTime.now().uptimeNanoseconds) else { throw windowMenuError("stale_observation") }
        items.removeAll(); menus.removeAll()
        guard AXUIElementSetMessagingTimeout(item.element, 0.75) == .success else { throw windowMenuError("menu_changed") }
        try acknowledge()
        let result = AXUIElementPerformAction(item.element, action as CFString)
        pumpNotifications()
        guard result == .success, parentAlive() else { throw windowMenuError("menu_action_unknown", unknown: true) }
        return ["ok": true, "requestId": command.requestId, "dispatched": true]
    }

    private func validateObservation(_ id: String) throws -> [WindowMenuBoundSurface] {
        pumpNotifications(); try validateRoot()
        guard generation.matches(id, now: DispatchTime.now().uptimeNanoseconds) else { throw windowMenuError("stale_observation") }
        let frozen = menus
        let ordinaryBounds = ordinaryWindowBounds()
        let currentWindows = try cgWindows()
        for menu in frozen {
            guard validatePath(menu.path, chain: menu.chain, selected: menu.root), fingerprint(menu.element) == menu.fingerprint,
                  windowMenuFingerprintChainMatches(menu.menuFingerprints, read: { fingerprint($0) }) else {
                invalidate(); throw windowMenuError("menu_changed")
            }
            if let surface = menu.surface {
                guard let ordinaryBounds = ordinaryBounds,
                      let current = windowMenuSurface(bounds: menu.fingerprint.bounds, target: window, windows: currentWindows,
                        ordinaryWindowBounds: ordinaryBounds), current.windowId == surface.windowId else {
                    invalidate(); throw windowMenuError("menu_changed")
                }
                try revalidateWindow(surface, requireUniqueAXWindow: false)
            }
        }
        guard generation.matches(id, now: DispatchTime.now().uptimeNanoseconds) else { throw windowMenuError("stale_observation") }
        return frozen
    }

    func captureWindow(_ command: WindowMenuCommand) throws -> [String: Any] {
        guard parentAlive() else { throw windowMenuError("cancelled") }
        let request = try windowMenuCaptureWindowRequest(command, window: window)
        // Keep capture in the same SCK process while this menu session is live.
        // This read neither replaces nor consumes its current AX observation.
        var receipt = try windowCaptureResult(request)
        guard parentAlive() else { throw windowMenuError("cancelled") }
        receipt["requestId"] = command.requestId
        return receipt
    }

    func capture(_ command: WindowMenuCommand) throws -> [String: Any] {
        guard let id = command.observationId else { throw invalidRequest() }
        let frozen = try validateObservation(id)
        func unavailable(_ reason: String) -> [String: Any] { ["ok": true, "requestId": command.requestId, "available": false, "reason": reason] }
        guard #available(macOS 14.2, *) else { return unavailable("menu_capture_unavailable") }
        guard !frozen.isEmpty else { return unavailable("no_menu") }
        guard frozen.allSatisfy({ $0.surface != nil }) else { return unavailable("menu_surface_unavailable") }
        guard CGPreflightScreenCaptureAccess() else { throw windowMenuError("screen_permission_denied") }
        let menuBounds = frozen.map { $0.fingerprint.bounds }
        guard var bounds = windowMenuCaptureBounds(window.bounds, menus: menuBounds) else { return unavailable("menu_capture_bounds_unavailable") }
        if let pointer = command.pointerWindow {
            guard let expanded = windowMenuPointerCaptureBounds(window.bounds, menus: menuBounds, pointer: pointer.bounds) else { throw invalidRequest() }
            bounds = expanded
        }
        var surfaces = [window] + frozen.compactMap { $0.surface }
        // Multiple AX menu nodes may share a surface, but conflicting identities
        // for one native window are never silently collapsed.
        var seen: [UInt32: WindowIdentity] = [:]
        for surface in surfaces {
            if let previous = seen[surface.windowId] {
                guard previous.pid == surface.pid && previous.processStartedAt == surface.processStartedAt
                    && previous.bounds == surface.bounds && previous.layer == surface.layer && previous.title == surface.title else { throw windowMenuError("menu_changed") }
            }
            seen[surface.windowId] = surface
        }
        surfaces = surfaces.filter { seen.removeValue(forKey: $0.windowId) != nil }
        let captureTarget = WindowIdentity(windowId: window.windowId, pid: window.pid, processStartedAt: window.processStartedAt,
            layer: 0, bounds: bounds, title: window.title)
        if let pointer = command.pointerWindow {
            try revalidateWindowMenuPointer(pointer, target: captureTarget, parentPID: parentPID, parentStartedAt: parentStartedAt)
            surfaces.append(pointer)
        }
        let content = try windowCaptureContent(timeout: 3)
        let displays = content.displays.filter {
            Rect(x: $0.frame.minX, y: $0.frame.minY, width: $0.frame.width, height: $0.frame.height).contains(bounds)
        }
        guard displays.count == 1, let display = displays.first else { return unavailable("menu_capture_display_unavailable") }
        let sources = try surfaces.map { try captureWindowSource($0, content: content) }
        let filter = SCContentFilter(display: display, including: sources)
        filter.includeMenuBar = false
        if #available(macOS 15.2, *) {
            guard filter.includedWindows.count == sources.count,
                  Set(filter.includedWindows.map { $0.windowID }) == Set(surfaces.map { $0.windowId }) else { throw windowMenuError("menu_capture_scope_changed") }
        }
        guard let size = windowCapturePixelSize(bounds: bounds, pointPixelScale: Double(filter.pointPixelScale)) else { throw invalidRequest() }
        let displayIdentity = WindowCaptureDisplay(displayId: display.displayID,
            bounds: Rect(x: display.frame.minX, y: display.frame.minY, width: display.frame.width, height: display.frame.height))
        let plan = WindowCaptureIncludedPlan(display: displayIdentity, windowIDs: surfaces.map { $0.windowId },
            sourceRect: bounds.cg.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY), width: size.width, height: size.height)
        let configuration = includedWindowCaptureConfiguration(plan)
        let background = CGColor(gray: 0, alpha: 0)
        configuration.backgroundColor = background
        let image: CGImage = try waitForValue(seconds: 8) { complete in
            SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
                withExtendedLifetime(background) {
                    guard error == nil, let image = image, image.width == size.width, image.height == size.height else {
                        complete(.failure(windowMenuError("window_capture_failed"))); return
                    }
                    complete(.success(image))
                }
            }
        }
        _ = try validateObservation(id)
        for surface in surfaces { try revalidateWindow(surface, requireUniqueAXWindow: false) }
        if let pointer = command.pointerWindow {
            try revalidateWindowMenuPointer(pointer, target: captureTarget, parentPID: parentPID, parentStartedAt: parentStartedAt)
        }
        try revalidateCaptureDisplay(displayIdentity)
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]), png.count <= 8 * 1024 * 1024 else {
            throw windowMenuError("window_capture_failed")
        }
        return ["ok": true, "requestId": command.requestId, "available": true, "observationId": id,
            "bounds": bounds.json, "width": image.width, "height": image.height, "pngBase64": png.base64EncodedString(),
            "captureMethod": "included-windows", "captureScope": "window-menus", "cursorIncluded": command.pointerWindow != nil]
    }
}

func windowMenuError(_ code: String, unknown: Bool = false) -> HelperError {
    HelperError(code: code, message: "The approved window menu changed or is unavailable; observe before another operation.", unknown: unknown)
}

// The session never opens windows or invokes Electron. Bounded input, heartbeat,
// exact parent identity and bounded writes also cover a stalled/disconnected host.
func windowMenuSession() throws {
    windowMenuCancelled = 0
    signal(SIGTERM) { _ in windowMenuCancelled = 1 }; signal(SIGINT) { _ in windowMenuCancelled = 1 }
    signal(SIGPIPE, SIG_IGN)
    let parent = getppid()
    guard parent > 1, let parentStartedAt = processStart(parent) else { throw windowMenuError("cancelled") }
    let inputFlags = fcntl(STDIN_FILENO, F_GETFL), outputFlags = fcntl(STDOUT_FILENO, F_GETFL)
    guard inputFlags >= 0, outputFlags >= 0,
          fcntl(STDIN_FILENO, F_SETFL, inputFlags | O_NONBLOCK) == 0,
          fcntl(STDOUT_FILENO, F_SETFL, outputFlags | O_NONBLOCK) == 0 else { throw invalidRequest() }
    defer { _ = fcntl(STDIN_FILENO, F_SETFL, inputFlags); _ = fcntl(STDOUT_FILENO, F_SETFL, outputFlags) }
    func parentAlive() -> Bool { windowMenuCancelled == 0 && getppid() == parent && processStart(parent) == parentStartedAt }
    func send(_ receipt: [String: Any], maximumBytes: Int = maximumAXObservationOutputBytes) throws {
        var data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
        guard data.count < maximumBytes else { throw windowMenuError("output_limit") }
        data.append(10)
        let deadline = DispatchTime.now().uptimeNanoseconds + 3_000_000_000
        try data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                guard parentAlive(), DispatchTime.now().uptimeNanoseconds < deadline else { throw windowMenuError("cancelled") }
                let count = Darwin.write(STDOUT_FILENO, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if count > 0 { offset += count }
                else if count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) { usleep(1000) }
                else { throw windowMenuError("cancelled") }
            }
        }
    }
    let began = DispatchTime.now().uptimeNanoseconds
    var lastInputAt = began, bytes = [UInt8](repeating: 0, count: 1024), buffer = WindowIndicatorLineBuffer()
    var session: WindowMenuSession?
    var requestIDs: Set<String> = []
    while parentAlive() {
        let now = DispatchTime.now().uptimeNanoseconds
        guard now - began < 1_800_000_000_000, now - lastInputAt < (session == nil ? 1_500_000_000 : 2_500_000_000) else { return }
        let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
        if count == 0 { return }
        if count < 0 {
            guard errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR else { return }
            session?.pumpNotifications(); usleep(5000); continue
        }
        lastInputAt = now
        for line in try buffer.append(Data(bytes.prefix(count))) {
            guard parentAlive() else { return }
            if session == nil {
                let request = try parseWindowRequest(line)
                session = try WindowMenuSession(window: request.window, parentPID: parent, parentStartedAt: parentStartedAt)
                try send(["ok": true, "ready": true]); lastInputAt = DispatchTime.now().uptimeNanoseconds; continue
            }
            guard let command = try parseWindowMenuCommand(line), let session = session else { continue }
            guard requestIDs.count < 4096, requestIDs.insert(command.requestId).inserted else { throw invalidRequest() }
            var dispatched = false
            do {
                switch command.command {
                case "close": try send(["ok": true, "requestId": command.requestId, "closed": true]); return
                case "observe": try send(session.observe(requestId: command.requestId))
                case "resolvePointer": try send(session.resolvePointer(command))
                case "action":
                    let result = try session.action(command, acknowledge: {
                        try send(["ok": true, "requestId": command.requestId, "event": "dispatched"])
                        dispatched = true
                    })
                    try send(result)
                case "capture":
                    // This helper outlives individual screenshots. Release SCK's
                    // autoreleased capture resources before serving another request.
                    try autoreleasepool { try send(session.capture(command), maximumBytes: 12 * 1024 * 1024) }
                case "captureWindow":
                    try autoreleasepool { try send(session.captureWindow(command), maximumBytes: 12 * 1024 * 1024) }
                default: throw invalidRequest()
                }
            } catch let error as HelperError {
                try send(["ok": false, "requestId": command.requestId,
                    "dispatched": (dispatched || error.unknown) ? "unknown" as Any : false,
                    "error": ["code": error.code, "message": error.message]])
            }
            lastInputAt = DispatchTime.now().uptimeNanoseconds
        }
    }
}
