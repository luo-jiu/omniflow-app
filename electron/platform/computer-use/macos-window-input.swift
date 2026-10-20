import AppKit
import ApplicationServices
import CoreGraphics
import CryptoKit
import Darwin
import Foundation
import os

// A single directed route with a bounded generic receiver profile. PostToPid
// has no window consumption acknowledgement; its void return never proves a
// business effect. Exact-version profiles retain their earlier guard policy.
enum WindowInputOperation: String, Codable, CaseIterable {
    case shortcut, rightClick, doubleClick, drag, click, typeText, scroll
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
    let text: String?
    let deltaX: Int?
    let deltaY: Int?
    let focusToken: String?
    // Main-only, one-request association. It never becomes an input receiver.
    let completionWindow: WindowIdentity?
    var valid: Bool {
        guard window.valid, !profile.isEmpty, validSemanticText(profile, maximumBytes: 64) else { return false }
        if let completionWindow {
            guard profile == "directed-v1", operation == .rightClick,
                  windowInputCompletionIdentityAllowed(completionWindow, original: window) else { return false }
        }
        switch operation {
        case .shortcut:
            return point == nil && endPoint == nil && durationMs == nil && shortcut?.valid == true
                && text == nil && deltaX == nil && deltaY == nil && focusToken == nil
        case .click, .rightClick, .doubleClick:
            return point.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) } == true
                && endPoint == nil && shortcut == nil && durationMs == nil
                && text == nil && deltaX == nil && deltaY == nil && focusToken == nil
        case .drag:
            return point.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) } == true
                && endPoint.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) } == true
                && point != endPoint && shortcut == nil && durationMs.map { (100...1000).contains($0) } == true
                && text == nil && deltaX == nil && deltaY == nil && focusToken == nil
        case .typeText:
            return text.map { validInputText($0, operation: .insertText) } == true
                && point == nil && endPoint == nil && shortcut == nil && durationMs == nil && deltaX == nil && deltaY == nil
                && focusToken.map(validWindowInputFocusToken) == true
        case .scroll:
            return point.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) } == true
                && endPoint == nil && shortcut == nil && durationMs == nil && text == nil && focusToken == nil
                && deltaX.map { (-1000...1000).contains($0) } == true
                && deltaY.map { (-1000...1000).contains($0) } == true
                && (deltaX != 0 || deltaY != 0)
        }
    }
    var requiresFocusedElement: Bool { operation == .shortcut || operation == .typeText }
}

func windowInputCompletionIdentityAllowed(_ completion: WindowIdentity, original: WindowIdentity) -> Bool {
    completion.valid && completion.pid == original.pid && completion.processStartedAt == original.processStartedAt
        && completion.windowId != original.windowId && completion.layer == 0 && original.bounds.contains(completion.bounds)
}

func windowInputCompletionSurfaceMatches(_ actual: WindowIdentity, expected: WindowIdentity) -> Bool {
    actual.windowId == expected.windowId && actual.pid == expected.pid
        && actual.processStartedAt == expected.processStartedAt && actual.layer == expected.layer && actual.bounds == expected.bounds
        && (expected.title == nil || actual.title == expected.title)
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
    // Escaped astral text can occupy twelve JSON bytes per Unicode scalar.
    let (_, object) = try parseInput(data, maximumBytes: 64 * 1024)
    _ = try fields(object, required: ["window", "profile", "operation"], optional: ["point", "endPoint", "shortcut", "durationMs", "text", "deltaX", "deltaY", "focusToken", "completionWindow"])
    let operationFields: [String]
    switch object["operation"] as? String {
    case "shortcut": operationFields = ["shortcut"]
    case "click", "rightClick", "doubleClick": operationFields = ["point"]
    case "drag": operationFields = ["point", "endPoint", "durationMs"]
    case "typeText": operationFields = ["text", "focusToken"]
    case "scroll": operationFields = ["point", "deltaX", "deltaY"]
    default: throw invalidRequest()
    }
    _ = try fields(object, required: Set(["window", "profile", "operation"] + operationFields),
        optional: object["operation"] as? String == "rightClick" ? ["completionWindow"] : [])
    _ = try fields(object["window"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
    let window = object["window"] as! [String: Any]
    try validateRectFields(window["bounds"])
    if let completion = object["completionWindow"] {
        let completion = try fields(completion, required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
        try validateRectFields(completion["bounds"])
    }
    for key in ["point", "endPoint"] where object[key] != nil { _ = try fields(object[key], required: ["x", "y"]) }
    if let shortcut = object["shortcut"] { _ = try fields(shortcut, required: ["key", "modifiers"]) }
    guard let request = try? JSONDecoder().decode(WindowInputRequest.self, from: data), request.valid else { throw invalidRequest() }
    return request
}

func readWindowInputRequest() throws -> WindowInputRequest {
    let (data, _) = try readInput(maximumBytes: 64 * 1024)
    return try parseWindowInputRequest(data)
}

// Generic eligibility means only that the directed protocol may be attempted;
// it is not a compatibility assertion. The caller still binds the actual
// bundle executable, frozen process/window and current AX receiver every time.
// Neither a framework name nor the profile promises application consumption.
func windowInputReceiverProfile(bundleIdentifier: String?, buildVersion: String?, shortVersion: String?, systemBuild: String? = nil) -> String? {
    if bundleIdentifier == "com.omniflow.window-input-qa", buildVersion == "1", shortVersion == "1.0" {
        return "appkit-fixture-v1"
    }
    if bundleIdentifier == "com.apple.TextEdit", buildVersion == "415", shortVersion == "1.20", systemBuild == "25F84" {
        return "textedit-415-25f84-v1"
    }
    if bundleIdentifier == "com.omniflow.window-input-qa" { return nil }
    guard let identifier = bundleIdentifier, !identifier.isEmpty, validSemanticText(identifier, maximumBytes: 256),
          identifier.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-").contains($0) }),
          identifier.contains("."), let build = buildVersion, !build.isEmpty, validSemanticText(build, maximumBytes: 128),
          let version = shortVersion, !version.isEmpty, validSemanticText(version, maximumBytes: 128) else { return nil }
    return "directed-v1"
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
    case "appkit-fixture-v1", "textedit-415-25f84-v1", "directed-v1": return WindowInputOperation.allCases
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
              role != kAXApplicationRole, role != kAXWindowRole, role != kAXMenuRole,
              role != kAXMenuItemRole, role != kAXMenuBarRole, role != kAXSheetRole, !role.contains("Secure") else { return false }
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
    let focusedElement: AXUIElement?
    let targetHasKeyboardFocus: Bool
}

// An already active app needs no synthetic activation. Its focused native
// window must still be the exact granted receiver, including pointer actions.
func windowInputRequiresFocusedWindow(profile: String, targetIsForeground: Bool, requiresFocusedElement: Bool) -> Bool {
    profile != "directed-v1" || targetIsForeground || requiresFocusedElement
}

enum WindowInputForegroundCheck { case original, completionRequired, rejected }

// This only classifies a possible handoff. completionRequired is not admission:
// the exact newly opened CG/AX receiver and its complete focus ancestry must
// still be proved before the original right-up can be sent.
func windowInputForegroundCheck(profile: String, operation: WindowInputOperation, postedEventCount: Int,
    originalForegroundPID: Int32, targetPID: Int32, currentForegroundPID: Int32?, completionBound: Bool) -> WindowInputForegroundCheck {
    guard originalForegroundPID > 0, targetPID > 0 else { return .rejected }
    if currentForegroundPID == originalForegroundPID { return .original }
    guard profile == "directed-v1", originalForegroundPID != targetPID, currentForegroundPID == targetPID, completionBound,
          windowInputCompletionPhaseAllowed(operation: operation, postedEventCount: postedEventCount) else { return .rejected }
    return .completionRequired
}

func windowInputForegroundAllowed(_ check: WindowInputForegroundCheck, completionVerified: Bool) -> Bool {
    switch check {
    case .original: return true
    case .completionRequired: return completionVerified
    case .rejected: return false
    }
}

enum WindowInputDispatchFocusRoute: String { case foreground, alreadyFocused, command, safe, plain }
func windowInputDispatchFocusRoute(targetIsForeground: Bool, inheritedFocus: Bool,
                                  commandClick: Bool, protectedFocus: Bool) -> WindowInputDispatchFocusRoute {
    if targetIsForeground { return .foreground }
    if inheritedFocus { return .alreadyFocused }
    if commandClick { return .command }
    return protectedFocus ? .safe : .plain
}

enum WindowInputCommandClickClassification: String {
    case plain, eligibleButton, eligibleCheckBox, eligibleRadio, rejectedScope, rejectedSemantic, unavailable
    var eligible: Bool { self == .eligibleButton || self == .eligibleCheckBox || self == .eligibleRadio }
}

enum WindowInputCommandClickStage: String {
    case none, scopeBinding, hitUnavailable, hitProcess, cycle, nodeUnavailable, processMismatch, hitIsRoot
    case leafRole, leafSubrole, leafEnabled, leafGeometryMissing, leafGeometryOutsideWindow, leafPointOutside
    case rootRole, foreignWindow, ancestorRole, selectedSettableUnknown, selectedWritable
    case selectedRows, selectedCells, selectedChildren, parentUnavailable, depthLimit
}

enum WindowInputCommandClickPhase: String { case initial, firstPost }

struct WindowInputCommandClickNode {
    let pid: Int32
    let role: String
    var subrole: String? = nil
    var attributes: Set<String> = []
    var selectedSettable: Bool? = nil
    var enabled: Bool? = nil
    // Optional semantic metadata is never a prerequisite for mouse delivery.
    // Production does not probe AX action names on this directed route.
    var press: Bool? = nil
    var bounds: Rect? = nil
}

func windowInputCommandClickLeaf(_ role: String, subrole: String?) -> WindowInputCommandClickClassification {
    switch role {
    case kAXButtonRole where subrole == nil || subrole == "AXButton" || subrole == "AXToolbarButton": return .eligibleButton
    case kAXCheckBoxRole where subrole == nil || subrole == "AXCheckBox": return .eligibleCheckBox
    case kAXRadioButtonRole where subrole == nil || subrole == "AXRadioButton": return .eligibleRadio
    default: return .rejectedSemantic
    }
}

func windowInputCommandClickAncestor(_ role: String) -> Bool {
    [kAXGroupRole, kAXToolbarRole, kAXSplitGroupRole, kAXScrollAreaRole, kAXRadioGroupRole].contains(role)
}

// Codex's selection check inspects supported attributes, never selection text:
// writable AXSelected, or any AXSelectedRows/Cells/Children declaration, makes
// Command-click selection-sensitive. An unreadable settable probe is unknown.
func windowInputCommandClickSelection(_ node: WindowInputCommandClickNode,
    diagnostic: (WindowInputCommandClickStage) -> Void = { _ in }) -> WindowInputCommandClickClassification? {
    for (attribute, stage) in [(kAXSelectedRowsAttribute, WindowInputCommandClickStage.selectedRows),
                               (kAXSelectedCellsAttribute, .selectedCells), (kAXSelectedChildrenAttribute, .selectedChildren)] {
        if node.attributes.contains(attribute) { diagnostic(stage); return .rejectedSemantic }
    }
    if node.attributes.contains(kAXSelectedAttribute) {
        guard let settable = node.selectedSettable else { diagnostic(.selectedSettableUnknown); return .unavailable }
        if settable { diagnostic(.selectedWritable); return .rejectedSemantic }
    }
    return nil
}

// A native hit is useful only when its complete, ordinary ancestor chain binds
// to the exact approved root. Geometry never substitutes for that binding.
// Keep the policy injectable so tests use fake AX nodes without UI interaction.
func windowInputCommandClickPolicy<Node>(_ hit: Node, root: Node, window: WindowIdentity, point: WindowInputPoint,
    equal: (Node, Node) -> Bool, read: (Node, Bool) -> WindowInputCommandClickNode?, parent: (Node) -> Node?,
    maximumDepth: Int = 32, diagnostic: (WindowInputCommandClickStage, Int) -> Void = { _, _ in }) -> WindowInputCommandClickClassification {
    var current = hit
    var visited: [Node] = []
    var classification = WindowInputCommandClickClassification.rejectedSemantic
    func reject(_ classification: WindowInputCommandClickClassification, _ stage: WindowInputCommandClickStage, _ depth: Int) -> WindowInputCommandClickClassification {
        diagnostic(stage, min(32, max(0, depth)))
        return classification
    }
    for depth in 0...maximumDepth {
        guard !visited.contains(where: { equal($0, current) }) else { return reject(.rejectedScope, .cycle, depth) }
        let isRoot = equal(current, root)
        guard let node = read(current, depth == 0) else { return reject(.unavailable, .nodeUnavailable, depth) }
        guard node.pid == window.pid else { return reject(.rejectedScope, .processMismatch, depth) }
        if depth == 0 {
            guard !isRoot else { return reject(.rejectedSemantic, .hitIsRoot, depth) }
            guard windowInputCommandClickLeaf(node.role, subrole: nil).eligible else { return reject(.rejectedSemantic, .leafRole, depth) }
            classification = windowInputCommandClickLeaf(node.role, subrole: node.subrole)
            guard classification.eligible else { return reject(.rejectedSemantic, .leafSubrole, depth) }
            guard node.enabled == true else { return reject(.rejectedSemantic, .leafEnabled, depth) }
            guard let bounds = node.bounds, bounds.valid else { return reject(.rejectedSemantic, .leafGeometryMissing, depth) }
            guard window.bounds.contains(bounds) else { return reject(.rejectedSemantic, .leafGeometryOutsideWindow, depth) }
            guard bounds.contains(x: point.x, y: point.y) else { return reject(.rejectedSemantic, .leafPointOutside, depth) }
        } else if isRoot {
            guard node.role == kAXWindowRole else { return reject(.rejectedScope, .rootRole, depth) }
        } else {
            guard node.role != kAXWindowRole, node.role != kAXApplicationRole else { return reject(.rejectedScope, .foreignWindow, depth) }
            guard windowInputCommandClickAncestor(node.role) else { return reject(.rejectedSemantic, .ancestorRole, depth) }
        }
        if let rejected = windowInputCommandClickSelection(node, diagnostic: { diagnostic($0, min(32, max(0, depth))) }) { return rejected }
        if isRoot { return classification }
        guard depth < maximumDepth else { return reject(.unavailable, .depthLimit, depth) }
        guard let ancestor = parent(current) else { return reject(.unavailable, .parentUnavailable, depth) }
        visited.append(current)
        current = ancestor
    }
    return .unavailable
}

struct WindowInputCommandClickTarget<Node> {
    let element: Node
    let classification: WindowInputCommandClickClassification
    let role: String
    let subrole: String?
    let bounds: Rect
}

func requireWindowInputCommandClickProof<Node>(_ initial: WindowInputCommandClickTarget<Node>?,
    fresh: () -> WindowInputCommandClickTarget<Node>?, equal: (Node, Node) -> Bool) throws {
    guard let initial else { return }
    guard let current = fresh(), initial.classification.eligible,
          current.classification == initial.classification, equal(initial.element, current.element),
          initial.role == current.role, initial.subrole == current.subrole, initial.bounds == current.bounds else {
        throw windowInputError("target_changed")
    }
}

private var windowInputCommandClickDiagnosticCount = 0
func logWindowInputCommandClick(_ classification: WindowInputCommandClickClassification, stage: WindowInputCommandClickStage = .none,
    depth: Int = 0, phase: WindowInputCommandClickPhase = .initial) {
    guard windowInputCommandClickDiagnosticCount < 8 else { return }
    windowInputCommandClickDiagnosticCount += 1
    let boundedDepth = min(32, max(0, depth))
    windowInputLogger.notice("commandClick=\(classification.rawValue, privacy: .public) commandClickStage=\(stage.rawValue, privacy: .public) commandClickDepth=\(boundedDepth, privacy: .public) commandClickPhase=\(phase.rawValue, privacy: .public)")
}

func windowInputCommandClickTarget(_ receiver: WindowInputReceiver, request: WindowInputRequest,
    phase: WindowInputCommandClickPhase = .initial) -> WindowInputCommandClickTarget<AXUIElement>? {
    guard request.profile == "directed-v1", request.operation == .click, receiver.foregroundPID != request.window.pid,
          let point = request.point else {
        logWindowInputCommandClick(.plain, phase: phase); return nil
    }
    let budget = ScanBudget(deadline: DispatchTime.now().uptimeNanoseconds + 500_000_000)
    var failureStage = WindowInputCommandClickStage.none
    var failureDepth = 0
    func reject(_ reason: WindowInputCommandClickClassification, stage: WindowInputCommandClickStage? = nil) -> WindowInputCommandClickTarget<AXUIElement>? {
        logWindowInputCommandClick(reason, stage: stage ?? failureStage, depth: failureDepth, phase: phase); return nil
    }
    guard axWindowBindingMatches(receiver.window, expected: request.window, budget: budget) else { return reject(.rejectedScope, stage: .scopeBinding) }
    var rawHit: AXUIElement?
    // This API is application-scoped and respects that app's own window order.
    // Never use system-wide hit testing or pretend a window is an application.
    guard budget.ready(), AXUIElementCopyElementAtPosition(receiver.application, Float(point.x), Float(point.y), &rawHit) == .success,
          let hit = rawHit, budget.ready() else { return reject(.unavailable, stage: .hitUnavailable) }
    var hitPID: pid_t = 0
    guard AXUIElementGetPid(hit, &hitPID) == .success, hitPID == request.window.pid else { return reject(.rejectedScope, stage: .hitProcess) }
    var leaf: WindowInputCommandClickNode?
    let classification = windowInputCommandClickPolicy(hit, root: receiver.window, window: request.window, point: point,
        equal: { CFEqual($0, $1) }, read: { element, isLeaf in
            guard budget.ready() else { return nil }
            var pid: pid_t = 0
            guard AXUIElementGetPid(element, &pid) == .success, pid == request.window.pid else { return nil }
            let (roleError, rawRole) = axAttribute(element, kAXRoleAttribute, budget: budget)
            guard roleError == .success, let role = rawRole as? String, validSemanticText(role, maximumBytes: 64), budget.ready() else { return nil }
            var node = WindowInputCommandClickNode(pid: pid, role: role)
            // Do not probe optional attributes on an already excluded context.
            if isLeaf ? !windowInputCommandClickLeaf(role, subrole: nil).eligible
                : (!CFEqual(element, receiver.window) && !windowInputCommandClickAncestor(role)) { return node }
            guard let attributes = axCandidateAttributeNames(element, budget: budget), budget.ready() else { return nil }
            node.attributes = attributes
            if attributes.contains(kAXSelectedAttribute) {
                var settable = DarwinBoolean(false)
                guard budget.ready(), AXUIElementIsAttributeSettable(element, kAXSelectedAttribute as CFString, &settable) == .success,
                      budget.ready() else { return nil }
                node.selectedSettable = settable.boolValue
            }
            if isLeaf {
                if attributes.contains(kAXSubroleAttribute) {
                    let (error, value) = axAttribute(element, kAXSubroleAttribute, budget: budget)
                    guard let state = semanticSubrole(error, value, budget: budget), budget.ready() else { return nil }
                    node.subrole = state.subrole
                }
                let (enabledError, enabled) = axAttribute(element, kAXEnabledAttribute, budget: budget)
                guard enabledError == .success, let enabled, CFGetTypeID(enabled) == CFBooleanGetTypeID(), budget.ready() else { return nil }
                node.enabled = CFEqual(enabled, kCFBooleanTrue)
                node.bounds = axRect(element, budget: budget)
                leaf = node
            }
            return budget.ready() ? node : nil
        }, parent: { element in
            guard budget.ready() else { return nil }
            return windowInputAXElement(element, attribute: kAXParentAttribute)
        }, diagnostic: { stage, depth in failureStage = stage; failureDepth = depth })
    guard classification.eligible, let leaf, let bounds = leaf.bounds else { return reject(classification) }
    guard budget.ready(), axWindowBindingMatches(receiver.window, expected: request.window, budget: budget), budget.ready() else {
        return reject(.rejectedScope, stage: .scopeBinding)
    }
    logWindowInputCommandClick(classification, phase: phase)
    return WindowInputCommandClickTarget(element: hit, classification: classification, role: leaf.role, subrole: leaf.subrole, bounds: bounds)
}

func validWindowInputFocusToken(_ token: String) -> Bool {
    token.utf8.count == 64 && token.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}

func windowInputTextFocusRoleSafe(_ role: String, subrole: String?) -> Bool {
    guard !role.isEmpty, validSemanticText(role, maximumBytes: 64), !role.contains("Secure"),
          ![kAXApplicationRole, kAXWindowRole, kAXMenuRole, kAXMenuItemRole, kAXMenuBarRole, kAXSheetRole].contains(role),
          subrole.map({ validSemanticText($0, maximumBytes: 64) && !$0.contains("Secure") }) != false else { return false }
    return role != kAXTextFieldRole || nativeTextRole(role, subrole: subrole)
}

// This small guard is also used between text chunks. Bounds/path/identifier
// intentionally stay out: entering text may legitimately grow the document.
func windowInputTextFocusNodeSafe(read: (String) -> (AXError, CFTypeRef?)) -> Bool {
    let (roleError, roleRaw) = read(kAXRoleAttribute)
    guard roleError == .success, let role = roleRaw as? String else { return false }
    var subrole: String?
    if role == kAXTextFieldRole || role == kAXTextAreaRole {
        let (error, raw) = read(kAXSubroleAttribute)
        if role == kAXTextAreaRole, (error == .attributeUnsupported || error == .noValue), raw == nil {
            subrole = nil
        } else {
            guard error == .success, let value = raw as? String else { return false }
            subrole = value
        }
    }
    return windowInputTextFocusRoleSafe(role, subrole: subrole)
}

// Locate only the focused control's ancestor chain. This shares the ordinary
// candidate protocol's bounded child-index path; it never scans a whole IDE.
func windowInputFocusPath<Node>(_ element: Node, root: Node, equal: (Node, Node) -> Bool,
                                parent: (Node) -> Node?, children: (Node, Int) -> [Node]?) -> [Int]? {
    var current = element
    var visited: [Node] = []
    var reverse: [Int] = []
    while !equal(current, root) {
        guard reverse.count < maximumAXPathDepth, !visited.contains(where: { equal($0, current) }),
              let ancestor = parent(current), let siblings = children(ancestor, 64), siblings.count <= 64 else { return nil }
        let matches = siblings.indices.filter { equal(siblings[$0], current) }
        guard matches.count == 1, let index = matches.first else { return nil }
        visited.append(current)
        reverse.append(index)
        current = ancestor
    }
    let path = Array(reverse.reversed())
    guard let resolved = resolveCandidatePath(root, path: path, readChildren: children), equal(resolved, element) else { return nil }
    return path
}

func windowInputFocusFingerprint(window: WindowIdentity, path: [Int], role: String, subrole: String?,
                                 identifier: String?, subroleDeclared: Bool, identifierDeclared: Bool, bounds: Rect) -> String? {
    guard window.valid, path.count <= maximumAXPathDepth, path.allSatisfy({ (0..<64).contains($0) }),
          !role.isEmpty, validSemanticText(role, maximumBytes: 64), bounds.valid,
          subrole.map({ validSemanticText($0, maximumBytes: 64) }) != false,
          identifier.map({ validSemanticText($0, maximumBytes: 256) }) != false else { return nil }
    let object: [String: Any] = ["version": "focus-v1", "window": window.json, "path": path, "role": role,
        "subrole": subrole as Any? ?? NSNull(), "identifier": identifier as Any? ?? NSNull(),
        "subroleDeclared": subroleDeclared, "identifierDeclared": identifierDeclared, "bounds": bounds.json]
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), data.count <= 4096 else { return nil }
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

// This opaque, main-only structural identity binds observation to dispatch.
// No Value, SelectedText, Title, Description or text content is read. It does
// not claim to distinguish replacement objects with identical AX structure.
func windowInputFocusToken(_ receiver: WindowInputReceiver, window: WindowIdentity) -> String? {
    guard receiver.targetHasKeyboardFocus, let element = receiver.focusedElement else { return nil }
    let budget = ScanBudget(deadline: DispatchTime.now().uptimeNanoseconds + 500_000_000)
    let path = windowInputFocusPath(element, root: receiver.window, equal: { CFEqual($0, $1) }, parent: { child in
        guard budget.ready() else { return nil }
        guard windowInputTextFocusNodeSafe(read: { axAttribute(child, $0, budget: budget) }), budget.ready(),
              let result = windowInputAXElement(child, attribute: kAXParentAttribute), budget.ready() else { return nil }
        return result
    }, children: { parent, limit in
        guard budget.ready() else { return nil }
        return axElements(parent, attribute: kAXChildrenAttribute, limit: limit, budget: budget)
    })
    guard let path, budget.ready() else { return nil }
    let (roleError, roleRaw) = axAttribute(element, kAXRoleAttribute, budget: budget)
    guard roleError == .success, let role = roleRaw as? String, let bounds = axRect(element, budget: budget), budget.ready() else { return nil }
    var rawAttributes: CFArray?
    let attributesError = AXUIElementCopyAttributeNames(element, &rawAttributes)
    guard attributesError == .success, let attributes = candidateAttributeNames(rawAttributes, budget: budget), budget.ready() else { return nil }
    var values: [String: String] = [:]
    for (attribute, limit) in [(kAXSubroleAttribute, 64), (kAXIdentifierAttribute, 256)] where attributes.contains(attribute) {
        let (error, raw) = axAttribute(element, attribute, budget: budget)
        guard budget.ready() else { return nil }
        if error == .attributeUnsupported || error == .noValue {
            guard raw == nil else { return nil }
            continue
        }
        guard error == .success, let value = raw as? String, validSemanticText(value, maximumBytes: limit) else { return nil }
        values[attribute] = value
    }
    guard windowInputTextFocusRoleSafe(role, subrole: values[kAXSubroleAttribute]), budget.ready(),
          let current = windowInputAXElement(receiver.application, attribute: kAXFocusedUIElementAttribute),
          CFEqual(current, element), budget.ready() else { return nil }
    return windowInputFocusFingerprint(window: window, path: path, role: role, subrole: values[kAXSubroleAttribute],
        identifier: values[kAXIdentifierAttribute], subroleDeclared: attributes.contains(kAXSubroleAttribute),
        identifierDeclared: attributes.contains(kAXIdentifierAttribute), bounds: bounds)
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

enum WindowInputTransientStage: String {
    case targetModal, targetSheets, focusedWindowRole, focusedWindowModal, focusedWindowSheets, focusChain, raisedSurface
}

// Fixed classifications only, capped per helper process. This adds no AX/CG
// reads and never records UI text, dynamic roles or application identity.
private var windowInputTransientDiagnosticCount = 0
func windowInputTransientError(_ stage: WindowInputTransientStage? = nil) -> HelperError {
    if let stage, windowInputTransientDiagnosticCount < 8 {
        windowInputTransientDiagnosticCount += 1
        windowInputLogger.notice("transientStage=\(stage.rawValue, privacy: .public)")
    }
    return windowInputError("transient_ui_active")
}

enum WindowInputFocusCheck: String { case originalGeometry, originalReceiver, completionReceiver }
private var windowInputFocusDiagnosticCount = 0
func windowInputFocusedWindowError(_ check: WindowInputFocusCheck) -> HelperError {
    if windowInputFocusDiagnosticCount < 8 {
        windowInputFocusDiagnosticCount += 1
        windowInputLogger.notice("focusCheck=\(check.rawValue, privacy: .public)")
    }
    return windowInputError("focused_window_mismatch")
}

enum WindowInputTargetCheck: String {
    case inheritedFocus, deadlineBefore, originalProcess, originalWindow, foreground
    case completionBeforeDown, completionReceiverChanged, deadlineAfter
    case commandProof, commandIdentity, commandWindow, commandDeadline
}
private var windowInputTargetDiagnosticCount = 0
func logWindowInputTargetCheck(_ check: WindowInputTargetCheck, postedEventCount: Int,
    completionBound: Bool, completionPhase: Bool, expectedForegroundPID: Int32,
    sampledForeground: Bool = false, currentForegroundPID: Int32? = nil, completionVisible: Bool? = nil) {
    guard windowInputTargetDiagnosticCount < 8 else { return }
    windowInputTargetDiagnosticCount += 1
    // Reuse only values already read by the guard. No diagnostic AX/CG read,
    // UI text, or window content is added to the input path.
    let frontChanged = sampledForeground ? String(currentForegroundPID != expectedForegroundPID) : "unknown"
    let visible = completionVisible.map { String($0) } ?? "unknown"
    let detail = "guard=\(check.rawValue) postedEventCount=\(postedEventCount) completionBound=\(completionBound) completionPhase=\(completionPhase) completionVisible=\(visible) frontSampled=\(sampledForeground) frontKnown=\(currentForegroundPID != nil) frontChanged=\(frontChanged) expectedForegroundPID=\(expectedForegroundPID) currentForegroundPID=\(currentForegroundPID ?? 0)"
    windowInputLogger.notice("targetCheck=\(detail, privacy: .public)")
}

func requireWindowInputNotModal(_ root: AXUIElement, diagnosticStage: WindowInputTransientStage? = nil) throws {
    let (modalError, modalRaw) = axAttribute(root, kAXModalAttribute)
    if modalError == .success {
        guard let modalRaw = modalRaw, CFGetTypeID(modalRaw) == CFBooleanGetTypeID(), !CFEqual(modalRaw, kCFBooleanTrue) else {
            throw windowInputTransientError(diagnosticStage)
        }
    } else if modalError != .attributeUnsupported && modalError != .noValue { throw windowInputTransientError(diagnosticStage) }
}

func requireWindowInputNoSheets(_ root: AXUIElement, diagnosticStage: WindowInputTransientStage? = nil) throws {
    let (sheetsError, sheetsRaw) = axAttribute(root, "AXSheets")
    if sheetsError == .success {
        guard let sheetsRaw, CFGetTypeID(sheetsRaw) == CFArrayGetTypeID(),
              let sheets = sheetsRaw as? [AXUIElement], sheets.isEmpty else { throw windowInputTransientError(diagnosticStage) }
    } else if sheetsError != .attributeUnsupported && sheetsError != .noValue { throw windowInputTransientError(diagnosticStage) }
}

func requireWindowInputTransientFree(_ root: AXUIElement) throws {
    try requireWindowInputNotModal(root)
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

enum WindowInputFocusedChainState: Equatable { case ordinary, transient, unknown }

// A menu inside the one associated first-party window may take focus only
// after this request's original right-down. Prove the complete ancestry rather
// than waiving every menu-like role in the application's focus chain.
func windowInputCompletionFocusBelongsToWindow<Node>(_ element: Node, root: Node, pid: Int32,
    equal: (Node, Node) -> Bool, read: (Node) -> (pid: Int32, role: String, parent: Node?)?, maximumDepth: Int = 32) -> Bool {
    var current = element, visited: [Node] = []
    for _ in 0...maximumDepth {
        guard !visited.contains(where: { equal($0, current) }), let node = read(current), node.pid == pid else { return false }
        if equal(current, root) { return node.role == kAXWindowRole }
        guard ![kAXWindowRole, kAXApplicationRole, kAXSheetRole, "AXPopover"].contains(node.role),
              !node.role.contains("Secure"), let parent = node.parent else { return false }
        visited.append(current); current = parent
    }
    return false
}

struct WindowInputCompletionReceiver {
    let window: WindowIdentity
    let root: AXUIElement
}

func requireWindowInputCompletionReceiver(_ expected: WindowIdentity, focused: AXUIElement) throws -> WindowInputCompletionReceiver {
    guard processStart(expected.pid) == expected.processStartedAt,
          try cgWindows().contains(where: { windowInputCompletionSurfaceMatches($0, expected: expected) }),
          axWindowBindingMatches(focused, expected: expected) else { throw windowInputFocusedWindowError(.completionReceiver) }
    try requireWindowInputNotModal(focused)
    try requireWindowInputNoSheets(focused)
    return WindowInputCompletionReceiver(window: expected, root: focused)
}

// This is a transient hint, not a keyboard receiver binding. Incomplete IDE
// parent links must not turn an unrelated ordinary focus into a pointer gate.
func windowInputFocusedChainState<Node>(_ element: Node, equal: (Node, Node) -> Bool,
                                        role: (Node) -> String?, parent: (Node) -> Node?,
                                        maximumDepth: Int = 32) -> WindowInputFocusedChainState {
    var current = element
    var visited: [Node] = []
    for _ in 0...maximumDepth {
        guard !visited.contains(where: { equal($0, current) }), let value = role(current) else { return .unknown }
        if [kAXMenuRole, kAXMenuItemRole, kAXMenuBarRole, kAXMenuBarItemRole, kAXSheetRole, "AXPopover"].contains(value) { return .transient }
        if value == kAXWindowRole || value == kAXApplicationRole { return .ordinary }
        visited.append(current)
        guard let ancestor = parent(current) else { return .unknown }
        current = ancestor
    }
    return .unknown
}

// Complex IDEs legitimately expose thousands of ordinary AX descendants. A
// partial normal tree is not evidence of a menu. The generic profile instead
// checks the current receiver and independent transient surfaces without
// traversing or granting any other window. This is deliberately not a claim of
// universal absence: an application can hide its own custom popup from AX/CG.
func requireGenericWindowInputTransientFree(_ root: AXUIElement, application: AXUIElement, window: WindowIdentity,
                                           completion: WindowInputCompletionReceiver? = nil) throws {
    try requireWindowInputNotModal(root, diagnosticStage: .targetModal)
    try requireWindowInputNoSheets(root, diagnosticStage: .targetSheets)
    // A popup can be attached below a deeply nested editor or be an independent
    // menu window. Its focused ancestry and same-process raised CG surface do
    // not require scanning the unrelated project tree.
    guard let focusedWindow = windowInputAXElement(application, attribute: kAXFocusedWindowAttribute) else {
        throw windowInputFocusedWindowError(completion == nil ? .originalReceiver : .completionReceiver)
    }
    let (windowRoleError, windowRoleRaw) = axAttribute(focusedWindow, kAXRoleAttribute)
    guard windowRoleError == .success, windowRoleRaw as? String == kAXWindowRole else { throw windowInputTransientError(.focusedWindowRole) }
    try requireWindowInputNotModal(focusedWindow, diagnosticStage: .focusedWindowModal)
    if !CFEqual(focusedWindow, root) { try requireWindowInputNoSheets(focusedWindow, diagnosticStage: .focusedWindowSheets) }
    let focusedElement = windowInputAXElement(application, attribute: kAXFocusedUIElementAttribute)
    if completion != nil && focusedElement == nil { throw windowInputTransientError(.focusChain) }
    if let focus = focusedElement {
        let budget = ScanBudget(deadline: DispatchTime.now().uptimeNanoseconds + 150_000_000)
        let belongsToCompletion = completion.map { completion in
            CFEqual(focusedWindow, completion.root) && windowInputCompletionFocusBelongsToWindow(focus, root: completion.root, pid: window.pid,
                equal: { CFEqual($0, $1) }, read: { element in
                    guard budget.ready() else { return nil }
                    var pid: pid_t = 0
                    guard AXUIElementGetPid(element, &pid) == .success, pid == window.pid else { return nil }
                    let (error, raw) = axAttribute(element, kAXRoleAttribute, budget: budget)
                    guard error == .success, let role = raw as? String, validSemanticText(role, maximumBytes: 64), budget.ready() else { return nil }
                    return (pid, role, CFEqual(element, completion.root) ? nil : windowInputAXElement(element, attribute: kAXParentAttribute))
                })
        } ?? false
        if completion != nil && !belongsToCompletion { throw windowInputTransientError(.focusChain) }
        let state = windowInputFocusedChainState(focus, equal: { CFEqual($0, $1) }, role: { element in
            guard budget.ready() else { return nil }
            var pid: pid_t = 0
            guard AXUIElementGetPid(element, &pid) == .success, pid == window.pid else { return nil }
            let (error, raw) = axAttribute(element, kAXRoleAttribute, budget: budget)
            guard error == .success, let role = raw as? String, validSemanticText(role, maximumBytes: 64), budget.ready() else { return nil }
            return role
        }, parent: { element in
            guard budget.ready() else { return nil }
            return windowInputAXElement(element, attribute: kAXParentAttribute)
        })
        guard belongsToCompletion || state != .transient else { throw windowInputTransientError(.focusChain) }
    }
    // Unknown focus ancestry does not authorize a different receiver: pointer
    // events still carry only the exact frozen target window's native hints.
    // Keyboard operations retain their separate complete focus/window checks.
    let windows = try cgWindows()
    if let completion {
        guard CFEqual(focusedWindow, completion.root), axWindowBindingMatches(completion.root, expected: completion.window),
              windows.contains(where: { windowInputCompletionSurfaceMatches($0, expected: completion.window) }) else { throw windowInputFocusedWindowError(.completionReceiver) }
    }
    guard !windows.contains(where: { entry in
        entry.pid == window.pid && entry.windowId != window.windowId && entry.layer > window.layer
            && !(completion.map { windowInputCompletionSurfaceMatches(entry, expected: $0.window) } ?? false)
    }) else {
        throw windowInputTransientError(.raisedSurface)
    }
}

func requireWindowInputTransientFree(_ receiver: WindowInputReceiver, window: WindowIdentity,
                                    completion: WindowInputCompletionReceiver? = nil) throws {
    if receiver.profile == "directed-v1" {
        try requireGenericWindowInputTransientFree(receiver.window, application: receiver.application, window: window, completion: completion)
    } else { try requireWindowInputTransientFree(receiver.window) }
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
    windowInputMainRunLoopService.service()
    guard let foregroundPID = NSWorkspace.shared.frontmostApplication?.processIdentifier, foregroundPID > 0 else {
        throw windowInputError("foreground_unknown")
    }
    // Legacy calibrated profiles retain their background-only contract.
    guard foregroundPID != window.pid || profile == "directed-v1" else { throw windowInputError("target_frontmost") }
    guard !windowInputPhysicalInputActive(includeOrdinaryKeys: foregroundPID == window.pid || requireFocusedElement) else { throw windowInputError("user_input_active") }
    let application = AXUIElementCreateApplication(window.pid)
    _ = AXUIElementSetMessagingTimeout(application, 0.15)
    guard let root = axWindow(window), let focusedWindow = windowInputAXElement(application, attribute: kAXFocusedWindowAttribute) else {
        throw windowInputFocusedWindowError(.originalReceiver)
    }
    let targetHasKeyboardFocus = CFEqual(root, focusedWindow)
    guard !windowInputRequiresFocusedWindow(profile: profile, targetIsForeground: foregroundPID == window.pid,
        requiresFocusedElement: requireFocusedElement) || targetHasKeyboardFocus else {
        throw windowInputFocusedWindowError(.originalReceiver)
    }
    _ = AXUIElementSetMessagingTimeout(root, 0.15)
    // Sheets and menus can consume input in another native surface. Never extend
    // a one-window grant to their separate window or to an application menu bar.
    let focusedElement = windowInputAXElement(application, attribute: kAXFocusedUIElementAttribute)
    if requireFocusedElement {
        guard let element = focusedElement,
              windowInputElementBelongsToWindow(element, root: root, pid: window.pid) else { throw windowInputError("focused_element_mismatch") }
    }
    let receiver = WindowInputReceiver(profile: profile, application: application, window: root,
        foregroundPID: foregroundPID, focusedElement: focusedElement, targetHasKeyboardFocus: targetHasKeyboardFocus)
    try requireWindowInputTransientFree(receiver, window: window)
    return receiver
}

func windowInputCheck(_ request: WindowRequest) {
    do {
        let receiver = try requireWindowInputReceiver(request.window)
        var focusToken: String?
        var operations = windowInputProfileOperations(receiver.profile).filter { $0 != .shortcut && $0 != .typeText }
        if receiver.targetHasKeyboardFocus, let element = windowInputAXElement(receiver.application, attribute: kAXFocusedUIElementAttribute),
           windowInputElementBelongsToWindow(element, root: receiver.window, pid: request.window.pid),
           !windowInputPhysicalInputActive(includeOrdinaryKeys: true) {
            if windowInputProfileOperations(receiver.profile).contains(.shortcut) { operations.insert(.shortcut, at: 0) }
            if windowInputProfileOperations(receiver.profile).contains(.typeText), let token = windowInputFocusToken(receiver, window: request.window) {
                focusToken = token
                operations.append(.typeText)
            }
        }
        var result: [String: Any] = ["ok": true, "ready": true, "profile": receiver.profile, "operations": operations.map { $0.rawValue }]
        if let focusToken { result["focusToken"] = focusToken }
        emit(result)
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

// Optional fd3 carries only posted pointer progress. A missing/closed/full pipe
// disables this stream without delaying, cancelling or settling real input.
// In particular, paired release must never wait for the indicator's consumer.
final class WindowInputPointerFeedback {
    private var descriptor: Int32?
    private var sequence = 0
    private var bytes = 0
    private let requestID: String?

    init(descriptor selected: Int32? = nil, enabled: Bool = true, requestID: String? = nil) {
        self.requestID = requestID
        guard enabled else { return }
        if let requestID, requestID.range(of: "^[1-9][0-9]{0,8}$", options: .regularExpression) == nil { return }
        // Without this private opt-in, a framework may already have reused fd3
        // for its own socket. Legacy invocations must never write to that fd.
        guard let descriptor = selected ?? (ProcessInfo.processInfo.environment["OMNIFLOW_WINDOW_INPUT_POINTER_FD"] == "3" ? 3 : nil) else { return }
        var status = stat()
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0, flags & O_ACCMODE != O_RDONLY, fstat(descriptor, &status) == 0,
              [S_IFIFO, S_IFSOCK].contains(status.st_mode & S_IFMT),
              fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETNOSIGPIPE, 1) == 0 else { return }
        self.descriptor = descriptor
    }

    func posted(_ event: CGEvent) {
        guard let descriptor else { return }
        let phase: String
        switch event.type {
        case .leftMouseDown, .rightMouseDown: phase = "down"
        case .leftMouseDragged, .rightMouseDragged: phase = "move"
        case .leftMouseUp, .rightMouseUp: phase = "up"
        default: return
        }
        let point = event.location
        var object: [String: Any] = ["phase": phase, "point": ["x": point.x, "y": point.y], "sequence": sequence + 1]
        if let requestID { object["requestId"] = requestID }
        guard sequence < 64, point.x.isFinite, point.y.isFinite,
              let data = try? JSONSerialization.data(withJSONObject: object),
              !data.isEmpty, data.count <= 256, bytes + data.count + 1 <= 16_384 else {
            self.descriptor = nil
            return
        }
        var frame = data
        frame.append(10)
        let written = frame.withUnsafeBytes { buffer in
            Darwin.write(descriptor, buffer.baseAddress!, buffer.count)
        }
        // One nonblocking write only: no retry/ACK, including EINTR or EAGAIN.
        // A partial frame permanently silences the stream; stdout stays intact.
        guard written == frame.count else { self.descriptor = nil; return }
        sequence += 1
        bytes += written
    }
}

// Both normal posts and the runner's one cleanup release share this exit.
// The callback is observational and runs only after the post closure returns.
func postWindowInputEvent(_ event: CGEvent, feedback: WindowInputPointerFeedback, post: (CGEvent) -> Void) {
    // Events and their cleanup releases are preallocated before focus/AX work.
    // Codex SynthesizedEvent.send (0x100752194...0x1007521c8) timestamps each
    // actual send, so a click never retains an earlier-than-activation time.
    event.timestamp = DispatchTime.now().uptimeNanoseconds
    post(event)
    feedback.posted(event)
}

struct WindowInputEvent {
    let event: CGEvent
    let delayBeforeMs: Int
    let release: CGEvent?
    let completesRelease: Bool
}

enum WindowInputFailurePhase: String { case beforeStep, completion }

struct WindowInputExecutionError: Error {
    let code: String
    let eventCount: Int
    let releaseSent: Bool
    // Internal diagnostics only. Cleanup posts count in eventCount, but never
    // in completedStepCount; neither field changes the public receipt.
    let failurePhase: WindowInputFailurePhase
    let completedStepCount: Int
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
    // Only a physical focus handoff was observed. Main must validate its new
    // trusted overlay promotion before treating the association as authorized.
    var completionWindowId: UInt32? = nil
}

func windowInputCompletionPhaseAllowed(operation: WindowInputOperation, postedEventCount: Int) -> Bool {
    operation == .rightClick && (1...2).contains(postedEventCount)
}

func runDirectedInputSequence<Event>(_ steps: [DirectedInputStep<Event>],
    wait: (Int) throws -> Void, validate: () throws -> Void, canRelease: () -> Bool,
    post: (Event) -> Void) throws -> DirectedInputResult {
    var count = 0
    var completedStepCount = 0
    var failurePhase = WindowInputFailurePhase.beforeStep
    var pending: Event?
    // A wheel event holds no key/button. True also means there is no pending
    // release; a down step changes it to false until its matching up is posted.
    var released = true
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
            failurePhase = .beforeStep
            try wait(step.delayBeforeMs)
            try validate()
            if let release = step.release { pending = release; released = false }
            post(step.event)
            count += 1
            completedStepCount += 1
            if step.completesRelease { pending = nil; released = true }
        }
        failurePhase = .completion
        try validate()
        return DirectedInputResult(eventCount: count, releaseSent: released)
    } catch let error as HelperError {
        releasePending()
        guard count > 0 else { throw error }
        throw WindowInputExecutionError(code: error.code, eventCount: count, releaseSent: released,
            failurePhase: failurePhase, completedStepCount: completedStepCount)
    } catch {
        releasePending()
        guard count > 0 else { throw windowInputError("invalid_request") }
        throw WindowInputExecutionError(code: "target_changed", eventCount: count, releaseSent: released,
            failurePhase: failurePhase, completedStepCount: completedStepCount)
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
                           clickCount: Int, eventNumber: Int16, source: CGEventSource) throws -> CGEvent {
    let local = NSPoint(x: point.x - window.bounds.x, y: window.bounds.height - (point.y - window.bounds.y))
    guard let native = NSEvent.mouseEvent(with: type, location: local, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: Int(window.windowId), context: nil, eventNumber: Int(eventNumber), clickCount: clickCount,
          pressure: type == .leftMouseUp || type == .rightMouseUp ? 0 : 1), let event = native.cgEvent?.copy() else { throw invalidRequest() }
    event.setSource(source)
    event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
    event.location = point.cg
    event.flags = []
    let rightButton = type == .rightMouseDown || type == .rightMouseUp || type == .rightMouseDragged
    event.setIntegerValueField(.mouseEventButtonNumber, value: rightButton ? 1 : 0)
    // Codex SynthesizedEvent.mouseEvent (0x1007526ec...0x100752708)
    // explicitly writes the button and subtype 3. NSEvent's CG bridge leaves
    // both at zero, including right clicks; retain this directed-event marker.
    // The subtype field is public, but value 3 is not a public SDK enum case.
    event.setIntegerValueField(.mouseEventSubtype, value: 3)
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

// The public CG keyboard payload has a small UTF-16 representation. Keep each
// chunk below twenty code units, without splitting an astral scalar. All
// chunks are allocated before dispatch and remain private to this helper.
func windowInputUnicodeChunks(_ text: String) -> [[UniChar]] {
    var result: [[UniChar]] = []
    var current: [UniChar] = []
    for scalar in text.unicodeScalars {
        let units = Array(String(scalar).utf16)
        if current.count + units.count > 20 { result.append(current); current = [] }
        current.append(contentsOf: units)
    }
    if !current.isEmpty { result.append(current) }
    return result
}

func windowInputUnicodeEvent(_ units: [UniChar], down: Bool, window: WindowIdentity, source: CGEventSource) throws -> CGEvent {
    guard !units.isEmpty, units.count <= 20,
          let native = NSEvent.keyEvent(with: down ? .keyDown : .keyUp, location: .zero, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: Int(window.windowId), context: nil,
            characters: String(decoding: units, as: UTF16.self), charactersIgnoringModifiers: String(decoding: units, as: UTF16.self),
            isARepeat: false, keyCode: 0), let event = native.cgEvent?.copy() else { throw invalidRequest() }
    event.setSource(source)
    event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
    event.flags = []
    event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
    event.setIntegerValueField(.keyboardEventAutorepeat, value: 0)
    event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(window.pid))
    return event
}

func windowInputScrollEvent(point: WindowInputPoint, deltaX: Int, deltaY: Int, window: WindowIdentity,
                            source: CGEventSource) throws -> CGEvent {
    guard let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: deltaX == 0 ? 1 : 2,
          wheel1: Int32(deltaY), wheel2: Int32(deltaX), wheel3: 0), let setter = windowInputLocalPositionSetter,
          let scrollWindowField = CGEventField(rawValue: 51) else {
        throw windowInputError("unsupported_receiver")
    }
    // Positive vertical deltas retain CoreGraphics' upward direction. This is a
    // single pixel wheel event, not AX page emulation or a replayable gesture.
    event.location = point.cg
    event.flags = []
    event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(window.pid))
    event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window.windowId))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window.windowId))
    // WindowServer's native window number is field 51. The public mouse-only
    // fields 91/92 do not round-trip on a wheel event on the tested macOS build.
    event.setIntegerValueField(scrollWindowField, value: Int64(window.windowId))
    setter(Unmanaged.passUnretained(event).toOpaque(), CGPoint(x: point.x - window.bounds.x, y: point.y - window.bounds.y))
    return event
}

typealias WindowInputLocalPositionSetter = @convention(c) (UnsafeMutableRawPointer, CGPoint) -> Void
let windowInputLocalPositionSetter: WindowInputLocalPositionSetter? = {
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGEventSetWindowLocation") else { return nil }
    return unsafeBitCast(symbol, to: WindowInputLocalPositionSetter.self)
}()

func prepareWindowInputEvents(_ request: WindowInputRequest, source: CGEventSource, inactiveCommandClick: Bool = false) throws -> [WindowInputEvent] {
    guard !inactiveCommandClick || request.profile == "directed-v1" && request.operation == .click else { throw invalidRequest() }
    var result: [WindowInputEvent] = []
    let mouseSource: CGEventSource
    if request.profile == "directed-v1" && [WindowInputOperation.click, .rightClick, .doubleClick, .drag].contains(request.operation) {
        // Codex keeps NSEvent mouse events in the combined-session source.
        // Align only the generic pointer route; the proven receiver profiles
        // and keyboard/wheel events retain their private source. Physical-input
        // guards read HID state independently of this synthetic source table.
        guard let combined = CGEventSource(stateID: .combinedSessionState) else { throw invalidRequest() }
        mouseSource = combined
    } else { mouseSource = source }
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
    case .typeText:
        guard let text = request.text else { throw invalidRequest() }
        for units in windowInputUnicodeChunks(text) {
            let down = try windowInputUnicodeEvent(units, down: true, window: request.window, source: source)
            let up = try windowInputUnicodeEvent(units, down: false, window: request.window, source: source)
            result.append(WindowInputEvent(event: down, delayBeforeMs: 0, release: up, completesRelease: false))
            result.append(WindowInputEvent(event: up, delayBeforeMs: 0, release: nil, completesRelease: true))
        }
        guard !result.isEmpty, result.count <= 1024 else { throw invalidRequest() }
    case .scroll:
        guard let point = request.point, let deltaX = request.deltaX, let deltaY = request.deltaY else { throw invalidRequest() }
        let event = try windowInputScrollEvent(point: point, deltaX: deltaX, deltaY: deltaY, window: request.window, source: source)
        result = [WindowInputEvent(event: event, delayBeforeMs: 0, release: nil, completesRelease: false)]
    case .click, .rightClick, .doubleClick:
        guard let point = request.point else { throw invalidRequest() }
        let right = request.operation == .rightClick
        let count = request.operation == .doubleClick ? 2 : 1
        // Helpers are short-lived, so a process-local counter restarting at zero
        // would always reuse press identities. The real AppKit/CG field narrows
        // to signed Int16, even through CGEventSetIntegerValueField. Randomize
        // a positive representable start with room for both double-click
        // presses; each matching up keeps its down's kCGMouseEventNumber.
        // Random starts reduce cross-helper reuse; they do not promise global
        // uniqueness across the finite field or physical input sources.
        let firstEventNumber = Int16.random(in: 1..<Int16.max)
        for click in 1...count {
            let eventNumber = firstEventNumber + Int16(click - 1)
            let down = try windowInputMouseEvent(right ? .rightMouseDown : .leftMouseDown, point: point, window: request.window, clickCount: click, eventNumber: eventNumber, source: mouseSource)
            let up = try windowInputMouseEvent(right ? .rightMouseUp : .leftMouseUp, point: point, window: request.window, clickCount: click, eventNumber: eventNumber, source: mouseSource)
            result.append(WindowInputEvent(event: down, delayBeforeMs: click == 1 ? 0 : 60, release: up, completesRelease: false))
            result.append(WindowInputEvent(event: up, delayBeforeMs: 15, release: nil, completesRelease: true))
        }
    case .drag:
        guard let point = request.point, let endPoint = request.endPoint, let duration = request.durationMs else { throw invalidRequest() }
        let eventNumber = Int16.random(in: 1...Int16.max)
        let down = try windowInputMouseEvent(.leftMouseDown, point: point, window: request.window, clickCount: 1, eventNumber: eventNumber, source: mouseSource)
        let up = try windowInputMouseEvent(.leftMouseUp, point: endPoint, window: request.window, clickCount: 1, eventNumber: eventNumber, source: mouseSource)
        let startUp = try windowInputMouseEvent(.leftMouseUp, point: point, window: request.window, clickCount: 1, eventNumber: eventNumber, source: mouseSource)
        result.append(WindowInputEvent(event: down, delayBeforeMs: 0, release: startUp, completesRelease: false))
        let steps = min(32, max(8, duration / 32))
        for step in 1...steps {
            let fraction = Double(step) / Double(steps)
            let current = WindowInputPoint(x: point.x + (endPoint.x - point.x) * fraction, y: point.y + (endPoint.y - point.y) * fraction)
            let event = try windowInputMouseEvent(.leftMouseDragged, point: current, window: request.window, clickCount: 1, eventNumber: eventNumber, source: mouseSource)
            let currentUp = try windowInputMouseEvent(.leftMouseUp, point: current, window: request.window, clickCount: 1, eventNumber: eventNumber, source: mouseSource)
            result.append(WindowInputEvent(event: event, delayBeforeMs: duration * step / steps - duration * (step - 1) / steps,
                                          release: currentUp, completesRelease: false))
        }
        result.append(WindowInputEvent(event: up, delayBeforeMs: 0, release: nil, completesRelease: true))
    }
    if inactiveCommandClick {
        for step in result {
            step.event.flags = .maskCommand
            step.release?.flags = .maskCommand
        }
    }
    for step in result {
        step.event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
        step.release?.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
    }
    return result
}

let windowInputLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "window-input")

// Availability diagnostics only: read the already-bound target, never resolve a
// different window or use these optional values to authorize/post activation.
// The fixed flags deliberately contain no target identity or geometry.
func logWindowInputActivationAvailability(_ receiver: WindowInputReceiver, window: WindowIdentity) {
    let budget = ScanBudget(deadline: DispatchTime.now().uptimeNanoseconds + 150_000_000)
    let expected = AXWindowNumberIdentity(pid: window.pid, windowId: window.windowId)
    let identityBefore = axWindowNumberIdentity(receiver.window, budget: budget)
    var frame: Rect?
    var activationPoint: CGPoint?
    if identityBefore == expected {
        frame = axRect(receiver.window, budget: budget)
        let (error, raw) = axAttribute(receiver.window, "AXActivationPoint", budget: budget)
        if error == .success, let raw = raw, CFGetTypeID(raw) == AXValueGetTypeID() {
            let value = raw as! AXValue
            var point = CGPoint.zero
            if AXValueGetType(value) == .cgPoint, AXValueGetValue(value, .cgPoint, &point),
               point.x.isFinite, point.y.isFinite { activationPoint = point }
        }
    }
    let identityStable = identityBefore == expected && axWindowNumberIdentity(receiver.window, budget: budget) == expected
    let windowIDAvailable = identityStable
    let frameAvailable = identityStable && frame?.valid == true
    let windowActivationPointAvailable = identityStable && activationPoint != nil
    let activationPointWithinWindow = identityStable && frame.map { current in
        current.valid && window.bounds.matchesAX(current) && activationPoint.map {
            current.contains(x: $0.x, y: $0.y) && window.bounds.contains(x: $0.x, y: $0.y)
        } == true
    } == true
    windowInputLogger.notice("windowActivationPointAvailable=\(windowActivationPointAvailable, privacy: .public) windowIDAvailable=\(windowIDAvailable, privacy: .public) frameAvailable=\(frameAvailable, privacy: .public) activationPointWithinWindow=\(activationPointWithinWindow, privacy: .public)")
}

// The session owns cancellation and lifetime. This worker never resets a signal
// flag or writes stdout, so a TERM received between requests cannot be lost.
func executeWindowInput(_ request: WindowInputRequest, pointerFeedback: WindowInputPointerFeedback,
                        focusSession: WindowInputFocusSession? = nil,
                        lifetimeGuard: () throws -> Void = {}) throws -> DirectedInputResult {
    try lifetimeGuard()
    guard windowInputCancelled == 0 else { throw windowInputError("cancelled") }
    let receiver = try requireWindowInputReceiver(request.window, expectedProfile: request.profile, requireFocusedElement: request.requiresFocusedElement)
    guard windowInputProfileOperations(receiver.profile).contains(request.operation) else { throw windowInputError("unsupported_receiver") }
    if let completion = request.completionWindow {
        // A pre-existing visible popup is not this right-down's newly opened
        // context. Hidden IDs come only from the main-owned overlay controller.
        guard !((try cgWindows()).contains { $0.windowId == completion.windowId }) else { throw windowInputError("target_changed") }
    }
    if request.operation == .typeText {
        guard let expected = request.focusToken, windowInputFocusToken(receiver, window: request.window) == expected else {
            throw windowInputError("focused_element_mismatch")
        }
    }
    guard let source = CGEventSource(stateID: .privateState) else { throw invalidRequest() }
    try focusSession?.requireHealthy()
    // This route is frozen before allocating or posting anything. A retained
    // perceived focus uses unmodified mouse flags. A valid narrow Command
    // proof remains the cheaper route; a failed fresh proof never upgrades it.
    let targetIsForeground = receiver.foregroundPID == request.window.pid
    let checksOrdinaryKeys = targetIsForeground || request.requiresFocusedElement
    if targetIsForeground { try focusSession?.requireForegroundPassthrough() }
    let inheritedFocus = !targetIsForeground && focusSession?.hasPerceivedFocus == true
    let commandClick = targetIsForeground || inheritedFocus ? nil : windowInputCommandClickTarget(receiver, request: request)
    let protectedFocus = !targetIsForeground && request.profile == "directed-v1" && commandClick == nil
        && [.click, .rightClick, .doubleClick, .drag, .scroll].contains(request.operation) && focusSession != nil
    let focusRoute = windowInputDispatchFocusRoute(targetIsForeground: targetIsForeground, inheritedFocus: inheritedFocus,
        commandClick: commandClick != nil, protectedFocus: protectedFocus)
    windowInputLogger.notice("focusRoute=\(focusRoute.rawValue, privacy: .public)")
    if request.profile == "directed-v1", request.operation == .click {
        logWindowInputActivationAvailability(receiver, window: request.window)
    }
    // Every event, including every possible release, is constructed before any
    // post. Allocation failure can therefore never leave a button/key held down.
    let events = try prepareWindowInputEvents(request, source: source, inactiveCommandClick: focusRoute == .command)
    var postedFirstEvent = false
    var postedEventCount = 0
    var completionReceiver: WindowInputCompletionReceiver?
    let pointerBefore = NSEvent.mouseLocation
    let maximumDurationMs = request.operation == .typeText ? 12_000 : (request.durationMs ?? 100) + (focusRoute == .safe ? 3500 : 1800)
    let maximumDeadline = DispatchTime.now().uptimeNanoseconds + UInt64(maximumDurationMs) * 1_000_000
    func noteTargetCheck(_ check: WindowInputTargetCheck, sampledForeground: Bool = false,
        currentForegroundPID: Int32? = nil, completionVisible: Bool? = nil) {
        logWindowInputTargetCheck(check, postedEventCount: postedEventCount,
            completionBound: request.completionWindow != nil,
            completionPhase: windowInputCompletionPhaseAllowed(operation: request.operation, postedEventCount: postedEventCount),
            expectedForegroundPID: receiver.foregroundPID, sampledForeground: sampledForeground,
            currentForegroundPID: currentForegroundPID, completionVisible: completionVisible)
    }
    func targetChanged(_ check: WindowInputTargetCheck) -> HelperError {
        noteTargetCheck(check)
        return windowInputError("target_changed")
    }
    func ongoingGuard() throws {
        try lifetimeGuard()
        try focusSession?.requireHealthy()
        if focusRoute == .alreadyFocused, focusSession?.hasPerceivedFocus != true { throw targetChanged(.inheritedFocus) }
        guard windowInputCancelled == 0 else { throw windowInputError("cancelled") }
        guard DispatchTime.now().uptimeNanoseconds < maximumDeadline else { throw targetChanged(.deadlineBefore) }
        guard processStart(request.window.pid) == request.window.processStartedAt else { throw targetChanged(.originalProcess) }
        do { try revalidateWindow(request.window) }
        catch { noteTargetCheck(.originalWindow); throw error }
        guard windowInputReceiverProfile(request.window.pid) == request.profile else { throw windowInputError("receiver_changed") }
        windowInputMainRunLoopService.service(until: maximumDeadline)
        try lifetimeGuard(); try focusSession?.requireHealthy()
        let currentForegroundPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let foregroundCheck = windowInputForegroundCheck(profile: request.profile, operation: request.operation,
            postedEventCount: postedEventCount, originalForegroundPID: receiver.foregroundPID, targetPID: request.window.pid,
            currentForegroundPID: currentForegroundPID, completionBound: request.completionWindow != nil)
        guard foregroundCheck != .rejected else {
            noteTargetCheck(.foreground, sampledForeground: true, currentForegroundPID: currentForegroundPID)
            throw windowInputError("target_changed")
        }
        if targetIsForeground { try focusSession?.requireForegroundPassthrough() }
        // A background right-click may make only its own associated menu truly
        // active. Ordinary physical keys must then gate both remaining checks.
        let checksCurrentOrdinaryKeys = checksOrdinaryKeys || foregroundCheck == .completionRequired
        guard !windowInputPhysicalInputActive(includeOrdinaryKeys: checksCurrentOrdinaryKeys) else { throw windowInputError("user_input_active") }
        guard axRect(receiver.window).map({ request.window.bounds.matchesAX($0) }) == true else { throw windowInputFocusedWindowError(.originalGeometry) }
        var currentCompletion: WindowInputCompletionReceiver?
        if let completion = request.completionWindow {
            if !windowInputCompletionPhaseAllowed(operation: request.operation, postedEventCount: postedEventCount) {
                guard postedEventCount == 0 else { throw targetChanged(.completionBeforeDown) }
                let completionVisible = (try cgWindows()).contains { $0.windowId == completion.windowId }
                guard !completionVisible else {
                    noteTargetCheck(.completionBeforeDown, completionVisible: completionVisible)
                    throw windowInputError("target_changed")
                }
            } else {
                guard let focused = windowInputAXElement(receiver.application, attribute: kAXFocusedWindowAttribute) else {
                    throw windowInputFocusedWindowError(.completionReceiver)
                }
                if !CFEqual(focused, receiver.window) {
                    let current = try requireWindowInputCompletionReceiver(completion, focused: focused)
                    if let previous = completionReceiver, !CFEqual(previous.root, current.root) { throw targetChanged(.completionReceiverChanged) }
                    currentCompletion = current
                } else if completionReceiver != nil { throw windowInputFocusedWindowError(.completionReceiver) }
            }
        }
        if windowInputRequiresFocusedWindow(profile: request.profile, targetIsForeground: targetIsForeground,
            requiresFocusedElement: request.requiresFocusedElement) {
            guard let focused = windowInputAXElement(receiver.application, attribute: kAXFocusedWindowAttribute),
                  CFEqual(focused, currentCompletion?.root ?? receiver.window) else {
                throw windowInputFocusedWindowError(currentCompletion == nil ? .originalReceiver : .completionReceiver)
            }
        }
        try requireWindowInputTransientFree(receiver, window: request.window, completion: currentCompletion)
        guard windowInputForegroundAllowed(foregroundCheck, completionVerified: currentCompletion != nil) else {
            noteTargetCheck(.foreground, sampledForeground: true, currentForegroundPID: currentForegroundPID)
            throw windowInputError("target_changed")
        }
        if let currentCompletion { completionReceiver = currentCompletion }
        if request.requiresFocusedElement {
            guard let element = windowInputAXElement(receiver.application, attribute: kAXFocusedUIElementAttribute),
                  windowInputElementBelongsToWindow(element, root: receiver.window, pid: request.window.pid) else { throw windowInputError("focused_element_mismatch") }
            // A Tab/Return or application callback can move the text receiver.
            // Never continue the remaining private text in a different field.
            if request.operation == .typeText {
                guard let initial = receiver.focusedElement, CFEqual(initial, element),
                      windowInputTextFocusNodeSafe(read: { axAttribute(element, $0) }) else { throw windowInputError("focused_element_mismatch") }
            }
        }
        guard windowInputCancelled == 0 else { throw windowInputError("cancelled") }
        guard DispatchTime.now().uptimeNanoseconds < maximumDeadline else { throw targetChanged(.deadlineAfter) }
        if foregroundCheck == .completionRequired {
            // AX verification may take time. A user switch to any third app
            // still revokes this exception immediately; it never follows focus.
            let finalForegroundPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
            let finalCheck = windowInputForegroundCheck(profile: request.profile, operation: request.operation,
                postedEventCount: postedEventCount, originalForegroundPID: receiver.foregroundPID, targetPID: request.window.pid,
                currentForegroundPID: finalForegroundPID, completionBound: request.completionWindow != nil)
            guard windowInputForegroundAllowed(finalCheck, completionVerified: currentCompletion != nil) else {
                noteTargetCheck(.foreground, sampledForeground: true, currentForegroundPID: finalForegroundPID)
                throw windowInputError("target_changed")
            }
        }
        guard !windowInputPhysicalInputActive(includeOrdinaryKeys: checksCurrentOrdinaryKeys) else { throw windowInputError("user_input_active") }
        try lifetimeGuard()
        if !postedFirstEvent, commandClick != nil {
            do {
                try requireWindowInputCommandClickProof(commandClick, fresh: {
                    windowInputCommandClickTarget(receiver, request: request, phase: .firstPost)
                }, equal: { CFEqual($0, $1) })
            } catch { noteTargetCheck(.commandProof); throw error }
            guard processStart(request.window.pid) == request.window.processStartedAt,
                  NSWorkspace.shared.frontmostApplication?.processIdentifier == receiver.foregroundPID else { throw targetChanged(.commandIdentity) }
            do { try revalidateWindow(request.window) }
            catch { noteTargetCheck(.commandWindow); throw error }
            try requireWindowInputTransientFree(receiver, window: request.window)
            guard windowInputCancelled == 0, DispatchTime.now().uptimeNanoseconds < maximumDeadline else { throw targetChanged(.commandDeadline) }
            guard !windowInputPhysicalInputActive(includeOrdinaryKeys: checksOrdinaryKeys) else { throw windowInputError("user_input_active") }
            try lifetimeGuard()
        }
    }
    if focusRoute == .safe {
        try ongoingGuard()
        try focusSession?.enforce(foregroundPID: receiver.foregroundPID, lifetimeGuard: {
            try lifetimeGuard()
            guard windowInputCancelled == 0, DispatchTime.now().uptimeNanoseconds < maximumDeadline else { throw windowInputError("cancelled") }
        })
        try ongoingGuard()
    }
    let result: DirectedInputResult
    do {
        result = try runDirectedInputSequence(events.map { DirectedInputStep(event: $0.event, delayBeforeMs: $0.delayBeforeMs,
            release: $0.release, completesRelease: $0.completesRelease) }, wait: { milliseconds in
            let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(milliseconds) * 1_000_000
            while DispatchTime.now().uptimeNanoseconds < deadline {
                guard windowInputCancelled == 0 else { throw windowInputError("cancelled") }
                try lifetimeGuard()
                usleep(5_000)
            }
        }, validate: ongoingGuard, canRelease: {
            // A reused PID must never receive cleanup. The result remains unknown
            // when the original process died; no new receiver inherits its up.
            guard processStart(request.window.pid) == request.window.processStartedAt else { return false }
            guard (try? revalidateWindow(request.window)) != nil else { return false }
            let (error, role) = axAttribute(receiver.window, kAXRoleAttribute)
            guard error == .success, role as? String == kAXWindowRole else { return false }
            if request.profile != "directed-v1" || request.requiresFocusedElement {
                guard let focused = windowInputAXElement(receiver.application, attribute: kAXFocusedWindowAttribute), CFEqual(focused, receiver.window) else { return false }
            }
            if request.operation == .typeText {
                guard let initial = receiver.focusedElement,
                      let current = windowInputAXElement(receiver.application, attribute: kAXFocusedUIElementAttribute), CFEqual(initial, current) else { return false }
            }
            return true
        }, post: { event in
            postWindowInputEvent(event, feedback: pointerFeedback, post: { $0.postToPid(request.window.pid) })
            postedFirstEvent = true
            postedEventCount += 1
        })
    } catch let error as WindowInputExecutionError {
        windowInputLogger.notice("operation=\(request.operation.rawValue, privacy: .public) interrupted=true code=\(error.code, privacy: .public) eventCount=\(error.eventCount, privacy: .public) posted=true releaseSent=\(error.releaseSent, privacy: .public) failurePhase=\(error.failurePhase.rawValue, privacy: .public) completedStepCount=\(error.completedStepCount, privacy: .public)")
        throw error
    }
    let frontmostAfter = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let pointerAfter = NSEvent.mouseLocation
    windowInputLogger.notice("operation=\(request.operation.rawValue, privacy: .public) posted=true releaseSent=\(result.releaseSent, privacy: .public) targetFrontmostAfter=\(frontmostAfter == request.window.pid, privacy: .public) frontmostChanged=\(frontmostAfter != receiver.foregroundPID, privacy: .public) pointerMoved=\(pointerBefore != pointerAfter, privacy: .public)")
    return DirectedInputResult(eventCount: result.eventCount, releaseSent: result.releaseSent,
        completionWindowId: completionReceiver?.window.windowId)
}

func windowInputSuccessReceipt(_ result: DirectedInputResult) -> [String: Any] {
    var receipt: [String: Any] = ["ok": true, "dispatched": true, "method": "CGEventPostToPid", "eventCount": result.eventCount, "releaseSent": result.releaseSent]
    if let completion = result.completionWindowId { receipt["completionWindowId"] = completion }
    return receipt
}

func windowInputFailureReceipt(_ error: Error) -> [String: Any] {
    if let error = error as? WindowInputExecutionError {
        return ["ok": false, "dispatched": "unknown", "method": "CGEventPostToPid", "eventCount": error.eventCount,
                "releaseSent": error.releaseSent, "error": ["code": error.code, "message": "Background input was partly posted; observe before another operation."]]
    }
    if let error = error as? HelperError {
        return ["ok": false, "dispatched": error.unknown ? "unknown" as Any : false,
                "error": ["code": error.code, "message": error.message]]
    }
    return ["ok": false, "dispatched": false, "error": ["code": "invalid_request", "message": "Cannot read the AX target request."]]
}

func windowInput(_ request: WindowInputRequest) throws {
    installWindowInputCancellation()
    let result = try executeWindowInput(request, pointerFeedback: WindowInputPointerFeedback())
    emit(windowInputSuccessReceipt(result))
}
