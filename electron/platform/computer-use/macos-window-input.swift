import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import os

// This is a receiver-specific, single-route experiment. PostToPid has no window
// consumption acknowledgement; its void return never proves a business effect.
enum WindowInputOperation: String, Codable, CaseIterable {
    case shortcut, rightClick, doubleClick, drag
}

struct WindowInputPoint: Decodable, Equatable {
    let x: Double
    let y: Double
    var valid: Bool { x.isFinite && y.isFinite && abs(x) <= 10_000_000 && abs(y) <= 10_000_000 }
    var cg: CGPoint { CGPoint(x: x, y: y) }
}

struct WindowInputShortcut: Decodable {
    let key: String
    let modifiers: [String]
    var valid: Bool {
        windowInputKeys[key] != nil && modifiers.count <= 4
            && modifiers == windowInputModifierOrder.filter { modifiers.contains($0) }
            && (key.count != 1 || modifiers.contains("command") || modifiers.contains("control"))
    }
}

struct WindowInputRequest: Decodable {
    let window: WindowIdentity
    let profile: String
    let operation: WindowInputOperation
    let point: WindowInputPoint?
    let endPoint: WindowInputPoint?
    let shortcut: WindowInputShortcut?
    let durationMs: Int?
    var valid: Bool {
        guard window.valid, !profile.isEmpty, validSemanticText(profile, maximumBytes: 64) else { return false }
        switch operation {
        case .shortcut:
            return point == nil && endPoint == nil && durationMs == nil && shortcut?.valid == true
        case .rightClick, .doubleClick:
            return point.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) } == true
                && endPoint == nil && shortcut == nil && durationMs == nil
        case .drag:
            return point.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) } == true
                && endPoint.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) } == true
                && point != endPoint && shortcut == nil && durationMs.map { (100...1000).contains($0) } == true
        }
    }
}

let windowInputModifierOrder = ["command", "shift", "option", "control"]
// These are physical ANSI virtual key positions. This does not synthesize
// Unicode text, change the input source, or write the shared clipboard itself.
let windowInputKeys: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
    "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    "return": 36, "tab": 48, "space": 49, "backspace": 51, "escape": 53, "delete": 117,
    "home": 115, "end": 119, "pageUp": 116, "pageDown": 121,
    "arrowLeft": 123, "arrowRight": 124, "arrowDown": 125, "arrowUp": 126,
]

func windowInputFlags(_ modifiers: [String]) -> CGEventFlags {
    var flags: CGEventFlags = []
    for modifier in modifiers {
        switch modifier {
        case "command": flags.insert(.maskCommand)
        case "control": flags.insert(.maskControl)
        case "option": flags.insert(.maskAlternate)
        case "shift": flags.insert(.maskShift)
        default: break
        }
    }
    return flags
}

func parseWindowInputRequest(_ data: Data) throws -> WindowInputRequest {
    let (_, object) = try parseInput(data, maximumBytes: 4096)
    _ = try fields(object, required: ["window", "profile", "operation"], optional: ["point", "endPoint", "shortcut", "durationMs"])
    _ = try fields(object["window"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
    let window = object["window"] as! [String: Any]
    try validateRectFields(window["bounds"])
    for key in ["point", "endPoint"] where object[key] != nil { _ = try fields(object[key], required: ["x", "y"]) }
    if let shortcut = object["shortcut"] { _ = try fields(shortcut, required: ["key", "modifiers"]) }
    guard let request = try? JSONDecoder().decode(WindowInputRequest.self, from: data), request.valid else { throw invalidRequest() }
    return request
}

func readWindowInputRequest() throws -> WindowInputRequest {
    let (data, _) = try readInput()
    return try parseWindowInputRequest(data)
}

// A vendor bundle ID or framework name alone is not an eligibility proof.
// External receivers require exact app and OS builds exercised on real views.
// The disposable development fixture deliberately remains an OS-independent
// experiment; it cannot grant eligibility to another application.
func windowInputReceiverProfile(bundleIdentifier: String?, buildVersion: String?, shortVersion: String?, systemBuild: String? = nil) -> String? {
    if bundleIdentifier == "com.omniflow.window-input-qa", buildVersion == "1", shortVersion == "1.0" {
        return "appkit-fixture-v1"
    }
    if bundleIdentifier == "com.apple.TextEdit", buildVersion == "415", shortVersion == "1.20", systemBuild == "25F84" {
        return "textedit-415-25f84-v1"
    }
    return nil
}

func windowInputSystemBuild() -> String? {
    var size = 0
    guard sysctlbyname("kern.osversion", nil, &size, nil, 0) == 0, (2...128).contains(size) else { return nil }
    var buffer = [CChar](repeating: 0, count: size)
    guard sysctlbyname("kern.osversion", &buffer, &size, nil, 0) == 0,
          size > 1, size <= buffer.count, buffer[size - 1] == 0 else { return nil }
    return String(validatingUTF8: buffer)
}

func windowInputProfileOperations(_ profile: String) -> [WindowInputOperation] {
    switch profile {
    case "appkit-fixture-v1", "textedit-415-25f84-v1": return WindowInputOperation.allCases
    default: return []
    }
}

func windowInputReceiverProfile(_ pid: Int32) -> String? {
    guard let application = NSRunningApplication(processIdentifier: pid), !application.isTerminated,
          let bundleURL = application.bundleURL, let executableURL = application.executableURL,
          let bundle = Bundle(url: bundleURL), let expectedExecutable = bundle.executableURL,
          executableURL.resolvingSymlinksInPath().standardizedFileURL == expectedExecutable.resolvingSymlinksInPath().standardizedFileURL else { return nil }
    return windowInputReceiverProfile(bundleIdentifier: application.bundleIdentifier,
        buildVersion: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
        shortVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
        systemBuild: windowInputSystemBuild())
}

func windowInputError(_ code: String, unknown: Bool = false) -> HelperError {
    HelperError(code: code, message: "The approved background input receiver is not ready; observe before another operation.", unknown: unknown)
}

// Private CGEventSource does not isolate the user's active app or real window
// state. Refuse an in-flight physical key/button or modifier rather than mix it
// with our directed sequence. No global suppression/filter policy is changed.
func windowInputPhysicalInputActive(includeOrdinaryKeys: Bool = false) -> Bool {
    let modifiers: CGEventFlags = [.maskCommand, .maskControl, .maskAlternate, .maskShift, .maskSecondaryFn]
    if !CGEventSource.flagsState(.hidSystemState).intersection(modifiers).isEmpty { return true }
    for button in 0..<32 {
        if let value = CGMouseButton(rawValue: UInt32(button)), CGEventSource.buttonState(.hidSystemState, button: value) { return true }
    }
    return includeOrdinaryKeys && (0..<128).contains { CGEventSource.keyState(.hidSystemState, key: CGKeyCode($0)) }
}

func windowInputAXElement(_ element: AXUIElement, attribute: String) -> AXUIElement? {
    let (error, value) = axAttribute(element, attribute)
    guard error == .success, let value = value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

func windowInputElementBelongsToWindow(_ element: AXUIElement, root: AXUIElement, pid: Int32) -> Bool {
    var current = element
    var visited: [AXUIElement] = []
    for _ in 0...maximumAXPathDepth {
        var actualPID: pid_t = 0
        guard AXUIElementGetPid(current, &actualPID) == .success, actualPID == pid,
              !visited.contains(where: { CFEqual($0, current) }) else { return false }
        if CFEqual(current, root) { return true }
        let (error, rawRole) = axAttribute(current, kAXRoleAttribute)
        guard error == .success, let role = rawRole as? String,
              role != kAXApplicationRole, role != kAXWindowRole, !role.contains("Secure") else { return false }
        if role == kAXTextFieldRole {
            let (subroleError, subrole) = axAttribute(current, kAXSubroleAttribute)
            guard subroleError == .success, let subrole = subrole as? String, !subrole.contains("Secure") else { return false }
        }
        visited.append(current)
        guard let parent = windowInputAXElement(current, attribute: kAXParentAttribute) else { return false }
        current = parent
    }
    return false
}

struct WindowInputReceiver {
    let profile: String
    let application: AXUIElement
    let window: AXUIElement
    let foregroundPID: Int32
}

// Proving absence must cover descendants: TextEdit attaches its open context
// menu below AXTextArea, rather than directly below AXWindow. Unknown/truncated
// trees refuse input. The application menu bar is never traversed or granted.
func windowInputTransientFree<Node>(_ root: Node, role: (Node) -> String?, children: (Node, Int) -> [Node]?,
                                    maximumNodes: Int = 256, maximumDepth: Int = 16) -> Bool {
    var pending: [(Node, Int)] = [(root, 0)]
    var visited = 0
    while let (element, depth) = pending.popLast() {
        guard visited < maximumNodes, depth <= maximumDepth, let currentRole = role(element),
              currentRole != kAXSheetRole, currentRole != kAXMenuRole else { return false }
        visited += 1
        guard let descendants = children(element, maximumNodes - visited), descendants.count <= maximumNodes - visited else { return false }
        pending.append(contentsOf: descendants.map { ($0, depth + 1) })
    }
    return true
}

func requireWindowInputTransientFree(_ root: AXUIElement) throws {
    let (modalError, modalRaw) = axAttribute(root, kAXModalAttribute)
    if modalError == .success {
        guard let modalRaw = modalRaw, CFGetTypeID(modalRaw) == CFBooleanGetTypeID(), !CFEqual(modalRaw, kCFBooleanTrue) else {
            throw windowInputError("transient_ui_active")
        }
    } else if modalError != .attributeUnsupported && modalError != .noValue { throw windowInputError("transient_ui_active") }
    let deadline = DispatchTime.now().uptimeNanoseconds + 150_000_000
    let free = windowInputTransientFree(root, role: { element in
        guard DispatchTime.now().uptimeNanoseconds < deadline else { return nil }
        let (error, value) = axAttribute(element, kAXRoleAttribute)
        return error == .success ? value as? String : nil
    }, children: { element, limit in
        guard DispatchTime.now().uptimeNanoseconds < deadline else { return nil }
        return axElements(element, attribute: kAXChildrenAttribute, limit: limit, requireComplete: true)
    })
    guard free else { throw windowInputError("transient_ui_active") }
}

func requireWindowInputReceiver(_ window: WindowIdentity, expectedProfile: String? = nil,
                                requireFocusedElement: Bool = false) throws -> WindowInputReceiver {
    guard AXIsProcessTrusted() else { throw windowInputError("accessibility_denied") }
    if #available(macOS 10.15, *), !CGPreflightPostEventAccess() { throw windowInputError("accessibility_denied") }
    // The system-wide element sets this helper process's default for every AX
    // object. Setting only app/root does not bound child or ancestor requests.
    guard AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15) == .success else {
        throw windowInputError("accessibility_denied")
    }
    guard let profile = windowInputReceiverProfile(window.pid) else { throw windowInputError("unsupported_receiver") }
    guard windowInputLocalPositionSetter != nil else { throw windowInputError("unsupported_receiver") }
    guard expectedProfile == nil || profile == expectedProfile else { throw windowInputError("receiver_changed") }
    try revalidateWindow(window)
    guard let foregroundPID = NSWorkspace.shared.frontmostApplication?.processIdentifier, foregroundPID > 0 else {
        throw windowInputError("foreground_unknown")
    }
    guard foregroundPID != window.pid else { throw windowInputError("target_frontmost") }
    guard !windowInputPhysicalInputActive(includeOrdinaryKeys: requireFocusedElement) else { throw windowInputError("user_input_active") }
    let application = AXUIElementCreateApplication(window.pid)
    _ = AXUIElementSetMessagingTimeout(application, 0.15)
    guard let root = axWindow(window), let focusedWindow = windowInputAXElement(application, attribute: kAXFocusedWindowAttribute),
          CFEqual(root, focusedWindow) else { throw windowInputError("focused_window_mismatch") }
    _ = AXUIElementSetMessagingTimeout(root, 0.15)
    // Sheets and menus can consume input in another native surface. Never extend
    // a one-window grant to their separate window or to an application menu bar.
    try requireWindowInputTransientFree(root)
    if requireFocusedElement {
        guard let element = windowInputAXElement(application, attribute: kAXFocusedUIElementAttribute),
              windowInputElementBelongsToWindow(element, root: root, pid: window.pid) else { throw windowInputError("focused_element_mismatch") }
    }
    return WindowInputReceiver(profile: profile, application: application, window: root, foregroundPID: foregroundPID)
}

func windowInputCheck(_ request: WindowRequest) {
    do {
        let receiver = try requireWindowInputReceiver(request.window)
        var operations = windowInputProfileOperations(receiver.profile).filter { $0 != .shortcut }
        if let element = windowInputAXElement(receiver.application, attribute: kAXFocusedUIElementAttribute),
           windowInputElementBelongsToWindow(element, root: receiver.window, pid: request.window.pid),
           !windowInputPhysicalInputActive(includeOrdinaryKeys: true), windowInputProfileOperations(receiver.profile).contains(.shortcut) { operations.insert(.shortcut, at: 0) }
        emit(["ok": true, "ready": true, "profile": receiver.profile, "operations": operations.map { $0.rawValue }])
    } catch let error as HelperError {
        let reasons: Set<String> = ["unsupported_receiver", "target_changed", "accessibility_denied", "target_frontmost", "foreground_unknown",
                                    "focused_window_mismatch", "focused_element_mismatch", "user_input_active", "transient_ui_active", "receiver_changed"]
        emit(["ok": true, "ready": false, "operations": [], "reason": reasons.contains(error.code) ? error.code : "target_changed"])
    } catch { emit(["ok": true, "ready": false, "operations": [], "reason": "target_changed"]) }
}

// Signal handlers only set a sig_atomic_t flag. They never call Cocoa, AX or CG.
// The normal execution path owns cleanup, and the parent allows a bounded grace
// period before forced termination. SIGKILL/crash can never promise a release.
var windowInputCancelled: sig_atomic_t = 0
func installWindowInputCancellation() {
    windowInputCancelled = 0
    signal(SIGTERM) { _ in windowInputCancelled = 1 }
    signal(SIGINT) { _ in windowInputCancelled = 1 }
}

struct WindowInputEvent {
    let event: CGEvent
    let delayBeforeMs: Int
    let release: CGEvent?
    let completesRelease: Bool
}

struct WindowInputExecutionError: Error {
    let code: String
    let eventCount: Int
    let releaseSent: Bool
}

// A tiny generic runner makes cancellation/release invariants testable without
// posting events or opening any windows. Production is its only real dispatcher.
struct DirectedInputStep<Event> {
    let event: Event
    let delayBeforeMs: Int
    let release: Event?
    let completesRelease: Bool
}

struct DirectedInputResult {
    let eventCount: Int
    let releaseSent: Bool
}

func runDirectedInputSequence<Event>(_ steps: [DirectedInputStep<Event>],
    wait: (Int) throws -> Void, validate: () throws -> Void, canRelease: () -> Bool,
    post: (Event) -> Void) throws -> DirectedInputResult {
    var count = 0
    var pending: Event?
    var released = false
    func releasePending() {
        guard let event = pending else { return }
        pending = nil
        guard canRelease() else { return }
        post(event)
        count += 1
        released = true
    }
    defer { releasePending() }
    do {
        for step in steps {
            try wait(step.delayBeforeMs)
            try validate()
            if let release = step.release { pending = release; released = false }
            post(step.event)
            count += 1
            if step.completesRelease { pending = nil; released = true }
        }
        try validate()
        return DirectedInputResult(eventCount: count, releaseSent: released)
    } catch let error as HelperError {
        releasePending()
        guard count > 0 else { throw error }
        throw WindowInputExecutionError(code: error.code, eventCount: count, releaseSent: released)
    } catch {
        releasePending()
        guard count > 0 else { throw windowInputError("invalid_request") }
        throw WindowInputExecutionError(code: "target_changed", eventCount: count, releaseSent: released)
    }
}

func windowInputCharacters(_ key: String, shift: Bool) -> String {
    let special: [String: UInt32] = ["arrowUp": 0xf700, "arrowDown": 0xf701, "arrowLeft": 0xf702, "arrowRight": 0xf703,
        "home": 0xf729, "end": 0xf72b, "pageUp": 0xf72c, "pageDown": 0xf72d, "delete": 0xf728]
    if let scalar = special[key].flatMap(UnicodeScalar.init) { return String(scalar) }
    switch key {
    case "return": return "\r"
    case "tab": return "\t"
    case "space": return " "
    case "backspace": return "\u{7f}"
    case "escape": return "\u{1b}"
    default: return shift ? key.uppercased() : key
    }
}

func windowInputMouseEvent(_ type: NSEvent.EventType, point: WindowInputPoint, window: WindowIdentity,
                           clickCount: Int, source: CGEventSource) throws -> CGEvent {
    let local = NSPoint(x: point.x - window.bounds.x, y: window.bounds.height - (point.y - window.bounds.y))
    guard let native = NSEvent.mouseEvent(with: type, location: local, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: Int(window.windowId), context: nil, eventNumber: 0, clickCount: clickCount,
          pressure: type == .leftMouseUp || type == .rightMouseUp ? 0 : 1), let event = native.cgEvent?.copy() else { throw invalidRequest() }
    event.setSource(source)
    event.location = point.cg
    event.flags = []
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window.windowId))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window.windowId))
    event.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
    event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(window.pid))
    // Public location changes global coordinates, but cross-process NSEvent
    // conversion otherwise retained (-1, windowHeight+1) in real AppKit input.
    // This private setter is a required, explicit profile dependency, not a
    // second event route. Missing symbol fails before the first post.
    guard let setter = windowInputLocalPositionSetter else { throw windowInputError("unsupported_receiver") }
    setter(Unmanaged.passUnretained(event).toOpaque(), CGPoint(x: point.x - window.bounds.x, y: point.y - window.bounds.y))
    return event
}

typealias WindowInputLocalPositionSetter = @convention(c) (UnsafeMutableRawPointer, CGPoint) -> Void
let windowInputLocalPositionSetter: WindowInputLocalPositionSetter? = {
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGEventSetWindowLocation") else { return nil }
    return unsafeBitCast(symbol, to: WindowInputLocalPositionSetter.self)
}()

func prepareWindowInputEvents(_ request: WindowInputRequest, source: CGEventSource) throws -> [WindowInputEvent] {
    var result: [WindowInputEvent] = []
    switch request.operation {
    case .shortcut:
        guard let shortcut = request.shortcut, let key = windowInputKeys[shortcut.key] else { throw invalidRequest() }
        let flags = windowInputFlags(shortcut.modifiers)
        let nativeFlags = NSEvent.ModifierFlags(rawValue: UInt(flags.rawValue))
        func keyEvent(_ down: Bool) throws -> CGEvent {
            guard let native = NSEvent.keyEvent(with: down ? .keyDown : .keyUp, location: .zero, modifierFlags: nativeFlags,
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: Int(request.window.windowId), context: nil,
                characters: windowInputCharacters(shortcut.key, shift: shortcut.modifiers.contains("shift")),
                charactersIgnoringModifiers: windowInputCharacters(shortcut.key, shift: false), isARepeat: false, keyCode: key),
                let event = native.cgEvent?.copy() else { throw invalidRequest() }
            event.setSource(source)
            event.flags = flags
            event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(request.window.pid))
            return event
        }
        let down = try keyEvent(true), up = try keyEvent(false)
        result = [WindowInputEvent(event: down, delayBeforeMs: 0, release: up, completesRelease: false),
                  WindowInputEvent(event: up, delayBeforeMs: 15, release: nil, completesRelease: true)]
    case .rightClick, .doubleClick:
        guard let point = request.point else { throw invalidRequest() }
        let right = request.operation == .rightClick
        let count = right ? 1 : 2
        for click in 1...count {
            let down = try windowInputMouseEvent(right ? .rightMouseDown : .leftMouseDown, point: point, window: request.window, clickCount: click, source: source)
            let up = try windowInputMouseEvent(right ? .rightMouseUp : .leftMouseUp, point: point, window: request.window, clickCount: click, source: source)
            result.append(WindowInputEvent(event: down, delayBeforeMs: click == 1 ? 0 : 60, release: up, completesRelease: false))
            result.append(WindowInputEvent(event: up, delayBeforeMs: 15, release: nil, completesRelease: true))
        }
    case .drag:
        guard let point = request.point, let endPoint = request.endPoint, let duration = request.durationMs else { throw invalidRequest() }
        let down = try windowInputMouseEvent(.leftMouseDown, point: point, window: request.window, clickCount: 1, source: source)
        let up = try windowInputMouseEvent(.leftMouseUp, point: endPoint, window: request.window, clickCount: 1, source: source)
        let startUp = try windowInputMouseEvent(.leftMouseUp, point: point, window: request.window, clickCount: 1, source: source)
        result.append(WindowInputEvent(event: down, delayBeforeMs: 0, release: startUp, completesRelease: false))
        let steps = min(32, max(8, duration / 32))
        for step in 1...steps {
            let fraction = Double(step) / Double(steps)
            let current = WindowInputPoint(x: point.x + (endPoint.x - point.x) * fraction, y: point.y + (endPoint.y - point.y) * fraction)
            let event = try windowInputMouseEvent(.leftMouseDragged, point: current, window: request.window, clickCount: 1, source: source)
            let currentUp = try windowInputMouseEvent(.leftMouseUp, point: current, window: request.window, clickCount: 1, source: source)
            result.append(WindowInputEvent(event: event, delayBeforeMs: duration * step / steps - duration * (step - 1) / steps,
                                          release: currentUp, completesRelease: false))
        }
        result.append(WindowInputEvent(event: up, delayBeforeMs: 0, release: nil, completesRelease: true))
    }
    return result
}

let windowInputLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "window-input")

func windowInput(_ request: WindowInputRequest) throws {
    installWindowInputCancellation()
    let receiver = try requireWindowInputReceiver(request.window, expectedProfile: request.profile, requireFocusedElement: request.operation == .shortcut)
    guard windowInputProfileOperations(receiver.profile).contains(request.operation) else { throw windowInputError("unsupported_receiver") }
    guard let source = CGEventSource(stateID: .privateState) else { throw invalidRequest() }
    // Every event, including every possible release, is constructed before any
    // post. Allocation failure can therefore never leave a button/key held down.
    let events = try prepareWindowInputEvents(request, source: source)
    let pointerBefore = NSEvent.mouseLocation
    let maximumDeadline = DispatchTime.now().uptimeNanoseconds + UInt64((request.durationMs ?? 100) + 1800) * 1_000_000
    func ongoingGuard() throws {
        guard windowInputCancelled == 0 else { throw windowInputError("cancelled") }
        guard DispatchTime.now().uptimeNanoseconds < maximumDeadline else { throw windowInputError("target_changed") }
        guard processStart(request.window.pid) == request.window.processStartedAt else { throw windowInputError("target_changed") }
        try revalidateWindow(request.window)
        guard windowInputReceiverProfile(request.window.pid) == request.profile else { throw windowInputError("receiver_changed") }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == receiver.foregroundPID else { throw windowInputError("target_changed") }
        guard !windowInputPhysicalInputActive(includeOrdinaryKeys: request.operation == .shortcut) else { throw windowInputError("user_input_active") }
        guard let focused = windowInputAXElement(receiver.application, attribute: kAXFocusedWindowAttribute), CFEqual(focused, receiver.window),
              axRect(receiver.window).map({ request.window.bounds.matchesAX($0) }) == true else { throw windowInputError("focused_window_mismatch") }
        try requireWindowInputTransientFree(receiver.window)
        if request.operation == .shortcut {
            guard let element = windowInputAXElement(receiver.application, attribute: kAXFocusedUIElementAttribute),
                  windowInputElementBelongsToWindow(element, root: receiver.window, pid: request.window.pid) else { throw windowInputError("focused_element_mismatch") }
        }
        guard windowInputCancelled == 0 else { throw windowInputError("cancelled") }
        guard DispatchTime.now().uptimeNanoseconds < maximumDeadline else { throw windowInputError("target_changed") }
        guard !windowInputPhysicalInputActive(includeOrdinaryKeys: request.operation == .shortcut) else { throw windowInputError("user_input_active") }
    }
    let result: DirectedInputResult
    do {
        result = try runDirectedInputSequence(events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
            release: $0.release, completesRelease: $0.completesRelease) }, wait: { milliseconds in
            let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(milliseconds) * 1_000_000
            while DispatchTime.now().uptimeNanoseconds < deadline {
                guard windowInputCancelled == 0 else { throw windowInputError("cancelled") }
                usleep(5_000)
            }
        }, validate: ongoingGuard, canRelease: {
            // A reused PID must never receive cleanup. The result remains unknown
            // when the original process died; no new receiver inherits its up.
            guard processStart(request.window.pid) == request.window.processStartedAt else { return false }
            let (error, role) = axAttribute(receiver.window, kAXRoleAttribute)
            guard error == .success, role as? String == kAXWindowRole,
                  let focused = windowInputAXElement(receiver.application, attribute: kAXFocusedWindowAttribute), CFEqual(focused, receiver.window) else { return false }
            return true
        }, post: { $0.postToPid(request.window.pid) })
    } catch let error as WindowInputExecutionError {
        windowInputLogger.notice("operation=\(request.operation.rawValue, privacy: .public) interrupted=true posted=true releaseSent=\(error.releaseSent, privacy: .public)")
        throw error
    }
    let frontmostAfter = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let pointerAfter = NSEvent.mouseLocation
    windowInputLogger.notice("operation=\(request.operation.rawValue, privacy: .public) posted=true releaseSent=\(result.releaseSent, privacy: .public) targetFrontmostAfter=\(frontmostAfter == request.window.pid, privacy: .public) frontmostChanged=\(frontmostAfter != receiver.foregroundPID, privacy: .public) pointerMoved=\(pointerBefore != pointerAfter, privacy: .public)")
    emit(["ok": true, "dispatched": true, "method": "CGEventPostToPid", "eventCount": result.eventCount, "releaseSent": result.releaseSent])
}
