import AppKit
import ApplicationServices
import Foundation
import os

// These finite semantic operations never synthesize keyboard, wheel or mouse
// events. Their names describe the exact AX callback or writable attribute.
enum SemanticOperation: String, Codable, CaseIterable {
    case press, replaceText, insertText
    case scrollUpPage, scrollDownPage, scrollLeftPage, scrollRightPage
    case scrollUpStep, scrollDownStep, scrollLeftStep, scrollRightStep
    case scrollUpFraction, scrollDownFraction, scrollLeftFraction, scrollRightFraction

    var textAttribute: String? {
        switch self {
        case .replaceText: return kAXValueAttribute
        case .insertText: return kAXSelectedTextAttribute
        default: return nil
        }
    }
    var pageAction: String? {
        switch self {
        case .scrollUpPage: return "AXScrollUpByPage"
        case .scrollDownPage: return "AXScrollDownByPage"
        case .scrollLeftPage: return "AXScrollLeftByPage"
        case .scrollRightPage: return "AXScrollRightByPage"
        default: return nil
        }
    }
    var stepOrientation: ScrollOrientation? {
        switch self {
        case .scrollUpStep, .scrollDownStep: return .vertical
        case .scrollLeftStep, .scrollRightStep: return .horizontal
        default: return nil
        }
    }
    var stepAction: String? {
        switch self {
        case .scrollUpStep, .scrollLeftStep: return kAXDecrementAction
        case .scrollDownStep, .scrollRightStep: return kAXIncrementAction
        default: return nil
        }
    }
    var fractionOrientation: ScrollOrientation? {
        switch self {
        case .scrollUpFraction, .scrollDownFraction: return .vertical
        case .scrollLeftFraction, .scrollRightFraction: return .horizontal
        default: return nil
        }
    }
    var scrollOrientation: ScrollOrientation? { stepOrientation ?? fractionOrientation }
}

enum ScrollOrientation: String, Codable { case vertical, horizontal }
enum CandidateEnabledState: String, Codable { case enabled, absent }

struct CandidateAvailability {
    let enabledState: CandidateEnabledState
    let operations: [SemanticOperation]
}

// Writability or an actual page callback proves only these semantic routes can
// operate when a native AppKit text/scroll area omits its AXEnabled attribute.
// Missing AXEnabled never proves press, scrollbar or text-field availability.
func enabledAbsenceOperation(role: String, operation: SemanticOperation) -> Bool {
    (role == kAXTextAreaRole && operation.textAttribute != nil)
        || (role == kAXScrollAreaRole && operation.pageAction != nil)
}

func candidateEnabledCapabilities(_ error: AXError, _ raw: CFTypeRef?, role: String,
                                  operations: [SemanticOperation], budget: ScanBudget? = nil) -> CandidateAvailability? {
    if let budget = budget, !budget.ready() { return nil }
    if error == .attributeUnsupported || error == .noValue {
        guard raw == nil else { budget?.truncated = true; return nil }
        let allowed = operations.filter { enabledAbsenceOperation(role: role, operation: $0) }
        guard !allowed.isEmpty else { budget?.noteRequiredReadFailure(error); return nil }
        return CandidateAvailability(enabledState: .absent, operations: allowed)
    }
    // Strict CFBoolean decoding remains shared with the original click rule;
    // false is known disabled, while malformed/success-nil/error are partial.
    guard candidateEnabled(error, raw, budget: budget) == true else { return nil }
    return CandidateAvailability(enabledState: .enabled, operations: operations)
}

func candidateAvailabilityMatches(_ current: CandidateAvailability, observed: Candidate, operation: SemanticOperation) -> Bool {
    current.enabledState == observed.enabledState && current.operations.contains(operation)
}

struct TextSelection: Codable, Equatable {
    let location: Int
    let length: Int
    var valid: Bool {
        location >= 0 && length >= 0 && location <= 9_007_199_254_740_991
            && length <= 9_007_199_254_740_991 - location
    }
    var json: [String: Any] { ["location": location, "length": length] }
}

struct TextState: Codable, Equatable {
    // null binds confirmed absence, independently of an explicitly empty value.
    let subrole: String?
    var selection: TextSelection? = nil
    var valid: Bool {
        (subrole == nil || validSemanticText(subrole!, maximumBytes: 64))
            && (selection == nil || selection!.valid)
    }
    var json: [String: Any] {
        var value: [String: Any] = ["subrole": subrole.map { $0 as Any } ?? NSNull()]
        if let selection = selection { value["selection"] = selection.json }
        return value
    }
}

// The native value range is confirmed, never inferred as 0...1 from the role.
// All three numbers remain in the private observation/binding fingerprint.
struct ScrollState: Codable, Equatable {
    let value: Double
    let minValue: Double
    let maxValue: Double
    var valid: Bool {
        value.isFinite && minValue.isFinite && maxValue.isFinite && minValue < maxValue
            && (maxValue - minValue).isFinite && value >= minValue && value <= maxValue
            && (maxValue - minValue) / 10 > 0
    }
    var json: [String: Any] { ["value": value, "minValue": minValue, "maxValue": maxValue] }
    func destination(for operation: SemanticOperation) -> Double? {
        guard valid, operation.fractionOrientation != nil else { return nil }
        let positive = operation == .scrollDownFraction || operation == .scrollRightFraction
        let step = (maxValue - minValue) / 10
        // Avoid overflow while clamping near the range endpoints.
        return positive ? value + min(step, maxValue - value) : value - min(step, value - minValue)
    }
}

// A semantic page button binds its actual scrollbar parent; the parent may
// extend beyond the window, but the unmodified child rectangle must be inside.
struct ScrollButtonState: Codable, Equatable {
    let parentBounds: Rect
    let orientation: ScrollOrientation
    var valid: Bool { parentBounds.valid }
    var json: [String: Any] { ["parentBounds": parentBounds.json, "orientation": orientation.rawValue] }
}

func nativeScrollButtonOperation(subrole: String?, orientation: ScrollOrientation) -> SemanticOperation? {
    switch (subrole, orientation) {
    case (kAXIncrementPageSubrole, .vertical): return .scrollDownPage
    case (kAXDecrementPageSubrole, .vertical): return .scrollUpPage
    case (kAXIncrementPageSubrole, .horizontal): return .scrollRightPage
    case (kAXDecrementPageSubrole, .horizontal): return .scrollLeftPage
    default: return nil
    }
}

func nativeScrollButtonEligible(role: String, nativeContext: Bool, actions: Set<String>,
                                enabledError: AXError, enabledRaw: CFTypeRef?, hasRoot: Bool) -> Bool {
    nativeContext && role == kAXButtonRole && actions.contains(kAXPressAction) && hasRoot
        && enabledRaw == nil && (enabledError == .attributeUnsupported || enabledError == .noValue)
}

func semanticScrollNumber(_ error: AXError, _ raw: CFTypeRef?, budget: ScanBudget? = nil) -> Double? {
    if let budget = budget, !budget.ready() { return nil }
    if error == .attributeUnsupported || error == .noValue {
        if raw != nil { budget?.truncated = true }
        return nil
    }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return nil }
    guard let raw = raw, CFGetTypeID(raw) == CFNumberGetTypeID(), let number = raw as? NSNumber,
          number.doubleValue.isFinite else { budget?.truncated = true; return nil }
    return number.doubleValue
}

struct SemanticCapabilities {
    var operations: [SemanticOperation] = []
    var textState: TextState? = nil
    var orientation: ScrollOrientation? = nil
    var scrollState: ScrollState? = nil
}

struct SemanticTarget: Decodable { let window: WindowIdentity; let candidate: Candidate }
struct SetTextRequest: Decodable { let target: SemanticTarget; let operation: SemanticOperation; let text: String }
struct ScrollRequest: Decodable { let target: SemanticTarget; let operation: SemanticOperation }

func validCandidateCapabilities(_ candidate: Candidate) -> Bool {
    let operations = candidate.effectiveOperations
    if let profile = candidate.identityProfile {
        switch profile {
        case .nativeTextIdentifierV1:
            guard candidate.role == kAXTextAreaRole, candidate.title.isEmpty,
                  candidate.description == nil, candidate.descriptionDeclared != nil,
                  candidate.identifier.map({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) == true,
                  !operations.isEmpty, operations.allSatisfy({ $0.textAttribute != nil }) else { return false }
        case .nativeScrollButtonV1:
            guard candidate.role == kAXButtonRole, !candidate.path.isEmpty,
                  validSemanticText(candidate.title, maximumBytes: 256), candidate.description == nil, candidate.identifier == nil,
                  candidate.descriptionDeclared == nil, candidate.documentBounds == nil,
                  candidate.textState == nil, candidate.scrollState == nil, candidate.orientation == nil,
                  candidate.enabledState == .absent, let state = candidate.scrollButtonState, state.valid,
                  state.parentBounds.contains(candidate.bounds),
                  let operation = nativeScrollButtonOperation(subrole: candidate.subrole, orientation: state.orientation),
                  candidate.operations == [operation] else { return false }
        }
    } else if candidate.descriptionDeclared != nil { return false }
    if (candidate.scrollButtonState != nil) != (candidate.identityProfile == .nativeScrollButtonV1) { return false }
    if let document = candidate.documentBounds {
        guard candidate.identityProfile == .nativeTextIdentifierV1, document.valid,
              document != candidate.bounds, document.contains(candidate.bounds) else { return false }
    }
    if operations.contains(where: { $0 != .press }), candidate.enabledState == nil { return false }
    if candidate.enabledState == .absent && candidate.identityProfile != .nativeScrollButtonV1
        && !operations.allSatisfy({ enabledAbsenceOperation(role: candidate.role, operation: $0) }) { return false }
    guard !operations.isEmpty, operations.count <= SemanticOperation.allCases.count,
          Set(operations).count == operations.count else { return false }
    let hasText = operations.contains(.replaceText) || operations.contains(.insertText)
    guard hasText == (candidate.textState != nil), candidate.textState?.valid != false else { return false }
    if operations.contains(.insertText), candidate.textState?.selection == nil { return false }
    if let state = candidate.textState, !nativeTextRole(candidate.role, subrole: state.subrole) { return false }
    let orientedOperations = operations.filter { $0.scrollOrientation != nil }
    guard orientedOperations.isEmpty == (candidate.orientation == nil) else { return false }
    if !orientedOperations.isEmpty {
        guard candidate.role == kAXScrollBarRole,
              orientedOperations.allSatisfy({ $0.scrollOrientation == candidate.orientation }) else { return false }
    }
    let hasFraction = operations.contains { $0.fractionOrientation != nil }
    guard hasFraction == (candidate.scrollState != nil), candidate.scrollState?.valid != false else { return false }
    return true
}

func semanticScrollAction(candidate: Candidate, operation: SemanticOperation) -> String? {
    if candidate.identityProfile == .nativeScrollButtonV1 {
        guard candidate.valid, candidate.effectiveOperations == [operation] else { return nil }
        return kAXPressAction
    }
    return operation.pageAction ?? operation.stepAction
}

func validInputText(_ text: String, operation: SemanticOperation) -> Bool {
    guard operation.textAttribute != nil, operation != .insertText || !text.isEmpty,
          text.utf8.prefix(16_384 + 1).count <= 16_384 else { return false }
    var count = 0
    for scalar in text.unicodeScalars {
        count += 1
        let code = scalar.value
        guard count <= 4096, !(code < 32 && code != 9 && code != 10 && code != 13),
              !(code >= 127 && code <= 159), !(code >= 0x202a && code <= 0x202e),
              !(code >= 0x2066 && code <= 0x2069) else { return false }
    }
    return true
}

func nativeTextContext(_ parent: Bool, role: String?, root: Bool = false) -> Bool {
    guard parent, let role = role, !role.isEmpty, role != "AXWebArea",
          !role.contains("Secure"), role != kAXApplicationRole else { return false }
    return role != kAXWindowRole || root
}

func nativeTextRole(_ role: String, subrole: String?) -> Bool {
    if role == kAXTextFieldRole { return subrole == kAXSearchFieldSubrole || subrole == "AXTextField" }
    return role == kAXTextAreaRole && !(subrole?.contains("Secure") ?? false)
}

func candidateActionNames(_ error: AXError, _ raw: CFArray?, budget: ScanBudget? = nil) -> Set<String>? {
    if let budget = budget, !budget.ready() { return nil }
    if error == .actionUnsupported { return [] }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return nil }
    guard let raw = raw, CFArrayGetCount(raw) <= 32, let names = raw as? [String],
          names.allSatisfy({ !$0.isEmpty && validSemanticText($0, maximumBytes: 64) }) else {
        budget?.truncated = true
        return nil
    }
    return Set(names)
}

func semanticSubrole(_ error: AXError, _ raw: CFTypeRef?, budget: ScanBudget? = nil) -> TextState? {
    if let budget = budget, !budget.ready() { return nil }
    if error == .attributeUnsupported || error == .noValue { return TextState(subrole: nil) }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return nil }
    guard let value = raw as? String, validSemanticText(value, maximumBytes: 64) else { budget?.truncated = true; return nil }
    return TextState(subrole: value)
}

func semanticSettable(_ error: AXError, _ settable: Bool, budget: ScanBudget? = nil) -> Bool {
    if let budget = budget, !budget.ready() { return false }
    if error == .attributeUnsupported || error == .noValue { return false }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return false }
    return settable
}

func semanticSelection(_ error: AXError, _ raw: CFTypeRef?, budget: ScanBudget? = nil,
                       decode: (CFTypeRef) -> TextSelection?) -> TextSelection? {
    if let budget = budget, !budget.ready() { return nil }
    if error == .attributeUnsupported || error == .noValue { return nil }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return nil }
    guard let raw = raw, let selection = decode(raw), selection.valid else { budget?.truncated = true; return nil }
    return selection
}

func semanticOrientation(_ error: AXError, _ raw: CFTypeRef?, budget: ScanBudget? = nil) -> ScrollOrientation? {
    if let budget = budget, !budget.ready() { return nil }
    if error == .attributeUnsupported || error == .noValue { return nil }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return nil }
    guard let value = raw as? String else { budget?.truncated = true; return nil }
    if value == kAXVerticalOrientationValue { return .vertical }
    if value == kAXHorizontalOrientationValue { return .horizontal }
    budget?.truncated = true
    return nil
}

func semanticOperations(actions: Set<String>, role: String, orientation: ScrollOrientation?,
                        textState: TextState?, replaceSettable: Bool, insertSettable: Bool,
                        scrollState: ScrollState? = nil) -> [SemanticOperation] {
    return SemanticOperation.allCases.filter { operation in
        if operation == .press { return actions.contains(kAXPressAction) }
        if operation == .replaceText { return textState != nil && replaceSettable }
        if operation == .insertText { return textState?.selection != nil && insertSettable }
        if let action = operation.pageAction { return actions.contains(action) }
        if let action = operation.stepAction { return role == kAXScrollBarRole && orientation == operation.stepOrientation && actions.contains(action) }
        if let axis = operation.fractionOrientation { return role == kAXScrollBarRole && orientation == axis && scrollState?.valid == true }
        return false
    }
}

func discoverSemanticCapabilities(role: String, nativeContext: Bool, actions: Set<String>, budget: ScanBudget? = nil,
                                  read: (String) -> (AXError, CFTypeRef?),
                                  settable: (String) -> Bool, selection: () -> TextSelection?,
                                  scrollValue: (() -> ScrollState?)? = nil) -> SemanticCapabilities {
    var state: TextState?
    var replaceSettable = false
    var insertSettable = false
    if nativeContext && (role == kAXTextFieldRole || role == kAXTextAreaRole) {
        let (error, value) = read(kAXSubroleAttribute)
        if let readState = semanticSubrole(error, value, budget: budget), nativeTextRole(role, subrole: readState.subrole) {
            replaceSettable = settable(kAXValueAttribute)
            insertSettable = settable(kAXSelectedTextAttribute)
            var confirmed = readState
            if insertSettable { confirmed.selection = selection() }
            if replaceSettable || (insertSettable && confirmed.selection != nil) { state = confirmed }
        }
    }
    var orientation: ScrollOrientation?
    let scrollState = role == kAXScrollBarRole ? scrollValue?() : nil
    if role == kAXScrollBarRole && (actions.contains(kAXIncrementAction) || actions.contains(kAXDecrementAction) || scrollState != nil) {
        let (error, value) = read(kAXOrientationAttribute)
        orientation = semanticOrientation(error, value, budget: budget)
    }
    let operations = semanticOperations(actions: actions, role: role, orientation: orientation, textState: state,
                                       replaceSettable: replaceSettable, insertSettable: insertSettable, scrollState: scrollState)
        .filter { role != kAXScrollAreaRole || nativeContext || $0.pageAction == nil }
    return SemanticCapabilities(operations: operations, textState: state, orientation: orientation,
                                scrollState: operations.contains { $0.fractionOrientation != nil } ? scrollState : nil)
}

func selectedCandidateIdentityProfile(role: String, title: String, nativeContext: Bool,
                                     operations: [SemanticOperation], textState: TextState?,
                                     attributes: Set<String>) -> CandidateIdentityProfile? {
    guard nativeContext, role == kAXTextAreaRole, title.isEmpty,
          !operations.isEmpty, operations.allSatisfy({ $0.textAttribute != nil }),
          let state = textState, state.valid, nativeTextRole(role, subrole: state.subrole),
          !operations.contains(.insertText) || state.selection != nil,
          attributes.contains(kAXIdentifierAttribute) else { return nil }
    return .nativeTextIdentifierV1
}

struct CandidateIdentityFields {
    let profile: CandidateIdentityProfile?
    let descriptionDeclared: Bool?
    let semantics: [String: String]
}

func candidateIdentityFields(profile: CandidateIdentityProfile?, requiredProfile: CandidateIdentityProfile? = nil,
                             attributes: Set<String>, budget: ScanBudget? = nil,
                             read: (String) -> (AXError, CFTypeRef?)) -> CandidateIdentityFields? {
    // A frozen identifier route cannot turn into a Description route during
    // prepare/final checks, even when its eligibility or declaration changes.
    if let expected = requiredProfile, profile != expected { budget?.truncated = true; return nil }
    // The page-button profile has its own semantic identity reader; it cannot
    // accidentally fall through to the ordinary Description identity route.
    if profile == .nativeScrollButtonV1 { budget?.truncated = true; return nil }
    if profile == .nativeTextIdentifierV1 {
        guard attributes.contains(kAXIdentifierAttribute) else { budget?.truncated = true; return nil }
        if let budget = budget, !budget.ready() { return nil }
        let (error, raw) = read(kAXIdentifierAttribute)
        if let budget = budget, !budget.ready() { return nil }
        guard error == .success else { budget?.noteSemanticReadFailure(.identifier, error: error); return nil }
        guard let raw = raw, CFGetTypeID(raw) == CFStringGetTypeID(), let identifier = raw as? String,
              !identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              validSemanticText(identifier, maximumBytes: 256) else {
            budget?.semanticInvalid[CandidateSemanticField.identifier.rawValue] += 1
            budget?.truncated = true
            return nil
        }
        return CandidateIdentityFields(profile: profile, descriptionDeclared: attributes.contains(kAXDescriptionAttribute),
                                       semantics: [kAXIdentifierAttribute: identifier])
    }
    guard let semantics = candidateSemanticFields(attributes, budget: budget, read: read) else { return nil }
    return CandidateIdentityFields(profile: nil, descriptionDeclared: nil, semantics: semantics)
}


func validateCandidateFields(_ value: Any?) throws {
    let candidate = try fields(value, required: ["path", "role", "title", "bounds"],
                               optional: ["description", "subrole", "identifier", "operations", "textState", "orientation", "enabledState", "scrollState", "identityProfile", "descriptionDeclared", "documentBounds", "scrollButtonState"])
    for name in ["description", "subrole", "identifier", "orientation", "enabledState", "identityProfile"] {
        if let value = candidate[name], !(value is String) { throw invalidRequest() }
    }
    if let raw = candidate["descriptionDeclared"], CFGetTypeID(raw as CFTypeRef) != CFBooleanGetTypeID() { throw invalidRequest() }
    if let raw = candidate["operations"] {
        guard let operations = raw as? [String], !operations.isEmpty, operations.count <= SemanticOperation.allCases.count,
              Set(operations).count == operations.count,
              operations.allSatisfy({ SemanticOperation(rawValue: $0) != nil }) else { throw invalidRequest() }
    }
    if let raw = candidate["textState"] {
        let state = try fields(raw, required: ["subrole"], optional: ["selection"])
        guard state["subrole"] is String || state["subrole"] is NSNull else { throw invalidRequest() }
        if let rawSelection = state["selection"] { _ = try fields(rawSelection, required: ["location", "length"]) }
    }
    if let raw = candidate["scrollState"] {
        let state = try fields(raw, required: ["value", "minValue", "maxValue"])
        for field in ["value", "minValue", "maxValue"] {
            guard semanticScrollNumber(.success, state[field] as CFTypeRef?) != nil else { throw invalidRequest() }
        }
    }
    if let raw = candidate["scrollButtonState"] {
        let state = try fields(raw, required: ["parentBounds", "orientation"])
        guard let orientation = state["orientation"] as? String, ScrollOrientation(rawValue: orientation) != nil else { throw invalidRequest() }
        try validateRectFields(state["parentBounds"])
    }
    try validateRectFields(candidate["bounds"])
    if let document = candidate["documentBounds"] { try validateRectFields(document) }
}

func validateSemanticTargetFields(_ value: Any?) throws {
    let target = try fields(value, required: ["window", "candidate"])
    let window = try fields(target["window"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
    if let title = window["title"], !(title is String) { throw invalidRequest() }
    try validateRectFields(window["bounds"])
    try validateCandidateFields(target["candidate"])
}

func validSemanticTarget(_ target: SemanticTarget, operation: SemanticOperation) -> Bool {
    target.window.valid && target.candidate.valid && target.candidate.enabledState != nil && target.candidate.effectiveOperations.contains(operation)
        && target.window.bounds.contains(target.candidate.bounds)
        && target.candidate.documentBounds.map({ !target.window.bounds.contains($0) }) != false
}

func readSetTextRequest() throws -> SetTextRequest {
    // JSON may escape each astral scalar to a surrogate pair (12 ASCII bytes).
    let (data, _) = try readInput(maximumBytes: 64 * 1024)
    return try parseSetTextRequest(data)
}

func parseSetTextRequest(_ data: Data) throws -> SetTextRequest {
    let (_, object) = try parseInput(data, maximumBytes: 64 * 1024)
    _ = try fields(object, required: ["target", "operation", "text"])
    try validateSemanticTargetFields(object["target"])
    guard let request = try? JSONDecoder().decode(SetTextRequest.self, from: data),
          validInputText(request.text, operation: request.operation), validSemanticTarget(request.target, operation: request.operation) else { throw invalidRequest() }
    return request
}

func readScrollRequest() throws -> ScrollRequest {
    let (data, _) = try readInput()
    return try parseScrollRequest(data)
}

func parseScrollRequest(_ data: Data) throws -> ScrollRequest {
    let (_, object) = try parseInput(data)
    _ = try fields(object, required: ["target", "operation"])
    try validateSemanticTargetFields(object["target"])
    guard let request = try? JSONDecoder().decode(ScrollRequest.self, from: data),
          request.operation.pageAction != nil || request.operation.stepAction != nil || request.operation.fractionOrientation != nil,
          validSemanticTarget(request.target, operation: request.operation) else { throw invalidRequest() }
    return request
}

func semanticCapabilityMatches(_ current: SemanticCapabilities, observed: Candidate, operation: SemanticOperation) -> Bool {
    current.operations.contains(operation)
        && (operation.textAttribute == nil || current.textState == observed.textState)
        && (operation.scrollOrientation == nil || current.orientation == observed.orientation)
        && current.scrollState == observed.scrollState
}

func mutationResult(_ result: AXError) throws {
    if result == .success { return }
    // An application callback may change its UI before returning any error.
    // After invoking the mutation, no AX error proves that nothing happened.
    throw HelperError(code: "ax_action_unknown",
                      message: "AX mutation did not return success; observe before another action.", unknown: true)
}

func shouldEmitCandidateDiagnostic(roleKind: Int, stage: Int, axError: Int32) -> Bool {
    // Ordinary unknown-role nodes with no supported operations are expected,
    // as are confirmed disabled controls. Neither consumes the diagnostic cap.
    roleKind != 0 || (stage != 0 && axError != AXError.success.rawValue)
}

// Read-only debug classifications. Unknown dynamic strings are never logged,
// and none of these facts grant a candidate an operation or identity profile.
enum ScrollbarChildDiagnosticKind: Int {
    case incrementArrow = 1, decrementArrow, incrementPage, decrementPage
}

func scrollbarChildDiagnosticKind(_ error: AXError, _ raw: CFTypeRef?) -> ScrollbarChildDiagnosticKind? {
    guard error == .success, let raw = raw, CFGetTypeID(raw) == CFStringGetTypeID(), let value = raw as? String else { return nil }
    switch value {
    case kAXIncrementArrowSubrole: return .incrementArrow
    case kAXDecrementArrowSubrole: return .decrementArrow
    case kAXIncrementPageSubrole: return .incrementPage
    case kAXDecrementPageSubrole: return .decrementPage
    default: return nil
    }
}

func shouldProbeScrollbarChild(debug: Bool, windowTargetsScan: Bool, role: String, nativeContext: Bool,
                              enabledError: AXError, enabledRawPresent: Bool, hasRoot: Bool, hasBudget: Bool) -> Bool {
    debug && windowTargetsScan && role == kAXButtonRole && nativeContext && hasRoot && hasBudget
        && !enabledRawPresent && (enabledError == .attributeUnsupported || enabledError == .noValue)
}

enum ScrollbarParentDiagnosticRole: Int { case unknown, scrollbar, scrollArea, window, other }
func scrollbarParentDiagnosticRole(_ role: String?) -> ScrollbarParentDiagnosticRole {
    switch role {
    case kAXScrollBarRole: return .scrollbar
    case kAXScrollAreaRole: return .scrollArea
    case kAXWindowRole: return .window
    case nil: return .unknown
    default: return .other
    }
}

enum ScrollbarChildRelationFailure: Int {
    case none, parentUnreadable, parentNotScrollbar, processMismatch, cycle, nonNative, foreignWindow, depthLimit
}
struct ScrollbarChildRelation {
    var parentRole: ScrollbarParentDiagnosticRole = .unknown
    var parentPIDConfirmed = false
    var windowConfirmed = false
    var depth = 0
    var failure: ScrollbarChildRelationFailure = .none
}

// Probe only the same-process, nonweb parent chain to the exact approved root.
// Fake readers exercise this policy without constructing an AX object.
func scrollbarChildRelation<Element>(_ element: Element, root: Element, pid: Int32,
                                    equal: (Element, Element) -> Bool,
                                    readParent: (Element, Bool) -> NativeTextAncestor<Element>?) -> ScrollbarChildRelation {
    var result = ScrollbarChildRelation()
    var current = element
    var seen = [element]
    for depth in 0..<maximumAXPathDepth {
        guard let parent = readParent(current, depth == 0) else { result.failure = .parentUnreadable; return result }
        result.depth = depth + 1
        guard parent.pid == pid, pid > 0 else { result.failure = .processMismatch; return result }
        if depth == 0 {
            result.parentRole = scrollbarParentDiagnosticRole(parent.role)
            result.parentPIDConfirmed = true
            guard parent.role == kAXScrollBarRole else { result.failure = .parentNotScrollbar; return result }
        }
        guard !seen.contains(where: { equal($0, parent.element) }) else { result.failure = .cycle; return result }
        let isRoot = equal(parent.element, root)
        guard nativeTextContext(true, role: parent.role, root: isRoot) else {
            result.failure = parent.role == kAXWindowRole ? .foreignWindow : .nonNative
            return result
        }
        if isRoot {
            guard parent.role == kAXWindowRole else { result.failure = .nonNative; return result }
            result.windowConfirmed = true
            return result
        }
        seen.append(parent.element)
        current = parent.element
    }
    result.failure = .depthLimit
    return result
}

// Native-only adapters below. Pure protocol tests execute the policies above
// with fake reads; they never call AX, capture a screen or interact with an app.
func nativeSemanticCapabilities(_ element: AXUIElement, role: String, nativeContext: Bool,
                                actions: Set<String>, budget: ScanBudget? = nil,
                                diagnostic: NativeCandidateDiagnostic? = nil) -> SemanticCapabilities {
    discoverSemanticCapabilities(role: role, nativeContext: nativeContext, actions: actions, budget: budget,
                                 read: { attribute in
                                     let result = axAttribute(element, attribute, budget: budget)
                                     if attribute == kAXSubroleAttribute {
                                         let state = semanticSubrole(result.0, result.1)
                                         diagnostic?.subroleConfirmed = state != nil
                                         diagnostic?.textRoleEligible = state.map { nativeTextRole(role, subrole: $0.subrole) } ?? false
                                         if state == nil { diagnostic?.probeFailure(.subrole, error: result.0) }
                                     } else if attribute == kAXOrientationAttribute {
                                         diagnostic?.orientationConfirmed = semanticOrientation(result.0, result.1) != nil
                                         if diagnostic?.orientationConfirmed == false { diagnostic?.probeFailure(.orientation, error: result.0) }
                                     }
                                     return result
                                 },
                                 settable: { nativeSettable(element, $0, budget: budget, diagnostic: diagnostic) },
                                 selection: { nativeSelection(element, budget: budget, diagnostic: diagnostic) },
                                 scrollValue: { nativeScrollState(element, budget: budget, diagnostic: diagnostic) })
}

func nativeSettable(_ element: AXUIElement, _ attribute: String, budget: ScanBudget? = nil,
                    diagnostic: NativeCandidateDiagnostic? = nil) -> Bool {
    if let budget = budget, !budget.ready() { return false }
    var value = DarwinBoolean(false)
    let error = AXUIElementIsAttributeSettable(element, attribute as CFString, &value)
    let settable = semanticSettable(error, value.boolValue, budget: budget)
    if attribute == kAXValueAttribute {
        diagnostic?.valueSettable = settable
        diagnostic?.valueSettableKnown = error == .success
    } else if attribute == kAXSelectedTextAttribute {
        diagnostic?.insertSettable = settable
        diagnostic?.insertSettableKnown = error == .success
    }
    if error != .success && error != .attributeUnsupported && error != .noValue {
        diagnostic?.probeFailure(attribute == kAXValueAttribute ? .valueSettable : .insertSettable, error: error)
    }
    return settable
}

func nativeSelection(_ element: AXUIElement, budget: ScanBudget? = nil,
                     diagnostic: NativeCandidateDiagnostic? = nil) -> TextSelection? {
    let (error, value) = axAttribute(element, kAXSelectedTextRangeAttribute, budget: budget)
    let selection = semanticSelection(error, value, budget: budget) { raw in
        guard CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
        let value = raw as! AXValue
        guard AXValueGetType(value) == .cfRange else { return nil }
        var range = CFRange(location: 0, length: 0)
        guard AXValueGetValue(value, .cfRange, &range) else { return nil }
        return TextSelection(location: range.location, length: range.length)
    }
    if selection == nil { diagnostic?.probeFailure(.selection, error: error) }
    return selection
}

func nativeScrollState(_ element: AXUIElement, budget: ScanBudget? = nil,
                       diagnostic: NativeCandidateDiagnostic? = nil) -> ScrollState? {
    let (valueError, rawValue) = axAttribute(element, kAXValueAttribute, budget: budget)
    let value = semanticScrollNumber(valueError, rawValue, budget: budget)
    diagnostic?.valueNumeric = value != nil
    if value == nil { diagnostic?.probeFailure(.scrollValue, error: valueError) }
    let (minError, rawMin) = axAttribute(element, kAXMinValueAttribute, budget: budget)
    let minValue = semanticScrollNumber(minError, rawMin, budget: budget)
    diagnostic?.minNumeric = minValue != nil
    if minValue == nil { diagnostic?.probeFailure(.scrollMin, error: minError) }
    let (maxError, rawMax) = axAttribute(element, kAXMaxValueAttribute, budget: budget)
    let maxValue = semanticScrollNumber(maxError, rawMax, budget: budget)
    diagnostic?.maxNumeric = maxValue != nil
    if maxValue == nil { diagnostic?.probeFailure(.scrollMax, error: maxError) }
    let settable = nativeSettable(element, kAXValueAttribute, budget: budget, diagnostic: diagnostic)
    guard let value = value, let minValue = minValue, let maxValue = maxValue, settable else { return nil }
    let state = ScrollState(value: value, minValue: minValue, maxValue: maxValue)
    diagnostic?.rangeValid = state.valid
    guard state.valid else { budget?.truncated = true; diagnostic?.probeFailure(.scrollRange); return nil }
    return state
}

// Fixed categories/stages and booleans only. Never retain or log UI text,
// identifiers, target paths, coordinates or even the scrollbar's numeric value.
enum NativeCandidateStage: Int {
    case process = 1, actions, subrole, valueSettable, insertSettable, selection, orientation
    case scrollValue, scrollMin, scrollMax, scrollRange, operations, enabled, title, bounds, attributes, description, identifier
    case role, position, size, childrenCopy, windowsCopy, textViewport
    case scrollButtonSubrole, scrollButtonParent, scrollButtonAvailability, scrollButtonGeometry, scrollButtonProfile
}
let candidateLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "candidate-capability")
final class NativeCandidateDiagnostic {
    let roleKind: Int
    var stage = 0
    var axError: Int32 = 0
    var probeStage = 0
    var probeAXError: Int32 = 0
    var accepted = false
    var nativeContext = false
    var subroleConfirmed = false
    var textRoleEligible = false
    var valueSettableKnown = false
    var valueSettable = false
    var insertSettableKnown = false
    var insertSettable = false
    var orientationConfirmed = false
    var enabledConfirmed = false
    var enabledAbsent = false
    var descriptionKnown = false
    var descriptionDeclared = false
    var identifierDeclared = false
    var identifierReadable = false
    var identifierNonEmpty = false
    var textIdentityProfile = false
    var valueNumeric = false
    var minNumeric = false
    var maxNumeric = false
    var rangeValid = false
    var boundsInsideWindow = false
    var boundsOverlapWindow = false
    var boundsExceedWindowHeight = false
    var boundsExceedWindowWidth = false
    var textViewportConfirmed = false
    var scrollButtonProfile = false
    var scrollButtonParentConfirmed = false
    var scrollButtonParentEnabled = false
    var scrollButtonBoundsConfirmed = false
    init?(role: String?) {
        switch role {
        case kAXTextAreaRole: roleKind = 1
        case kAXTextFieldRole: roleKind = 2
        case kAXScrollBarRole: roleKind = 3
        default: roleKind = 0
        }
    }
    func reject(_ stage: NativeCandidateStage, error: AXError = .success) {
        guard self.stage == 0 else { return }
        self.stage = stage == .operations && probeStage != 0 ? probeStage : stage.rawValue
        axError = stage == .operations && probeStage != 0 ? probeAXError : error.rawValue
    }
    func probeFailure(_ stage: NativeCandidateStage, error: AXError = .success) {
        guard probeStage == 0 else { return }
        probeStage = stage.rawValue
        probeAXError = error.rawValue
    }
    func emit() {
        candidateLogger.notice("roleKind=\(self.roleKind, privacy: .public) stage=\(self.stage, privacy: .public) axError=\(self.axError, privacy: .public) probeStage=\(self.probeStage, privacy: .public) probeAXError=\(self.probeAXError, privacy: .public) accepted=\(self.accepted, privacy: .public) nativeContext=\(self.nativeContext, privacy: .public) subroleConfirmed=\(self.subroleConfirmed, privacy: .public) textRoleEligible=\(self.textRoleEligible, privacy: .public) valueSettableKnown=\(self.valueSettableKnown, privacy: .public) valueSettable=\(self.valueSettable, privacy: .public) insertSettableKnown=\(self.insertSettableKnown, privacy: .public) insertSettable=\(self.insertSettable, privacy: .public) orientationConfirmed=\(self.orientationConfirmed, privacy: .public) enabledConfirmed=\(self.enabledConfirmed, privacy: .public) enabledAbsent=\(self.enabledAbsent, privacy: .public) descriptionKnown=\(self.descriptionKnown, privacy: .public) descriptionDeclared=\(self.descriptionDeclared, privacy: .public) identifierDeclared=\(self.identifierDeclared, privacy: .public) identifierReadable=\(self.identifierReadable, privacy: .public) identifierNonEmpty=\(self.identifierNonEmpty, privacy: .public) textIdentityProfile=\(self.textIdentityProfile, privacy: .public) valueNumeric=\(self.valueNumeric, privacy: .public) minNumeric=\(self.minNumeric, privacy: .public) maxNumeric=\(self.maxNumeric, privacy: .public) rangeValid=\(self.rangeValid, privacy: .public) boundsInsideWindow=\(self.boundsInsideWindow, privacy: .public) boundsOverlapWindow=\(self.boundsOverlapWindow, privacy: .public) boundsExceedWindowHeight=\(self.boundsExceedWindowHeight, privacy: .public) boundsExceedWindowWidth=\(self.boundsExceedWindowWidth, privacy: .public) textViewportConfirmed=\(self.textViewportConfirmed, privacy: .public) scrollButtonProfile=\(self.scrollButtonProfile, privacy: .public) scrollButtonParentConfirmed=\(self.scrollButtonParentConfirmed, privacy: .public) scrollButtonParentEnabled=\(self.scrollButtonParentEnabled, privacy: .public) scrollButtonBoundsConfirmed=\(self.scrollButtonBoundsConfirmed, privacy: .public)")
    }
}

func emitCandidateDiagnostic(_ diagnostic: NativeCandidateDiagnostic?, budget: ScanBudget? = nil) {
    guard let diagnostic = diagnostic,
          (diagnostic.scrollButtonProfile || shouldEmitCandidateDiagnostic(roleKind: diagnostic.roleKind, stage: diagnostic.stage, axError: diagnostic.axError)),
          budget?.claimCandidateDiagnostic() ?? true else { return }
    diagnostic.emit()
}

let scrollbarChildLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "scrollbar-child-capability")

// This optional probe bypasses candidate parsers and status mutation. Its own
// read errors never grant an operation or mark a scan partial; the ordinary
// elapsed scan deadline still applies while debug reads are enabled.
func probeNativeScrollbarChild(_ element: AXUIElement, role: String, nativeContext: Bool,
                               enabledError: AXError, enabledRaw: CFTypeRef?, actions: Set<String>,
                               window: WindowIdentity, root: AXUIElement?, budget: ScanBudget?) {
    let arguments = CommandLine.arguments
    guard shouldProbeScrollbarChild(debug: ProcessInfo.processInfo.environment["OMNIFLOW_COMPUTER_CONTROLS_DEBUG"] == "1",
                                    windowTargetsScan: arguments.count == 2 && arguments[1] == "--window-targets",
                                    role: role, nativeContext: nativeContext, enabledError: enabledError,
                                    enabledRawPresent: enabledRaw != nil, hasRoot: root != nil, hasBudget: budget != nil),
          let root = root, let budget = budget,
          DispatchTime.now().uptimeNanoseconds < budget.deadline, budget.claimScrollbarChildDiagnostic() else { return }
    let deadline = min(budget.deadline, DispatchTime.now().uptimeNanoseconds + 250_000_000)
    var deadlineReached = false
    func read(_ target: AXUIElement, _ attribute: String) -> (AXError, CFTypeRef?) {
        guard DispatchTime.now().uptimeNanoseconds < deadline else { deadlineReached = true; return (.cannotComplete, nil) }
        return axAttribute(target, attribute)
    }
    let (subroleError, rawSubrole) = read(element, kAXSubroleAttribute)
    guard let kind = scrollbarChildDiagnosticKind(subroleError, rawSubrole) else { return }
    var parentReadError: Int32 = 0
    var parentRoleError: Int32 = 0
    var parentPIDError: Int32 = 0
    var chainReadStage = 0
    var chainReadError: Int32 = 0
    var parentRoleMalformed = false
    var orientationError: Int32 = 0
    var orientationKind = 0 // 0 unknown, 1 vertical, 2 horizontal
    var parentEnabledError: Int32 = 0
    var parentEnabledKind = 0 // 0 unknown, 1 disabled, 2 enabled
    var immediateParent: AXUIElement?
    let relation = scrollbarChildRelation(element, root: root, pid: window.pid, equal: { CFEqual($0, $1) }, readParent: { child, immediate in
        let (parentError, rawParent) = read(child, kAXParentAttribute)
        if immediate { parentReadError = parentError.rawValue }
        guard parentError == .success, let rawParent = rawParent, CFGetTypeID(rawParent) == AXUIElementGetTypeID() else {
            chainReadStage = 1; chainReadError = parentError.rawValue
            return nil
        }
        let parent = rawParent as! AXUIElement
        guard DispatchTime.now().uptimeNanoseconds < deadline else {
            deadlineReached = true; chainReadStage = 2; chainReadError = AXError.cannotComplete.rawValue
            return nil
        }
        var pid: pid_t = 0
        let pidError = AXUIElementGetPid(parent, &pid)
        if immediate { parentPIDError = pidError.rawValue }
        guard pidError == .success else { chainReadStage = 2; chainReadError = pidError.rawValue; return nil }
        // Do not query an attribute on a parent that escaped the approved PID.
        if pid != window.pid { return NativeTextAncestor(element: parent, role: "", pid: pid, bounds: nil) }
        let (roleError, rawRole) = read(parent, kAXRoleAttribute)
        if immediate { parentRoleError = roleError.rawValue }
        guard roleError == .success, let rawRole = rawRole, CFGetTypeID(rawRole) == CFStringGetTypeID(),
              let parentRole = rawRole as? String, !parentRole.isEmpty, validSemanticText(parentRole, maximumBytes: 64) else {
            chainReadStage = 3; chainReadError = roleError.rawValue
            if immediate { parentRoleMalformed = roleError == .success }
            return nil
        }
        if immediate, pid == window.pid { immediateParent = parent }
        return NativeTextAncestor(element: parent, role: parentRole, pid: pid, bounds: nil)
    })
    if relation.windowConfirmed, relation.parentRole == .scrollbar, let parent = immediateParent {
        let (error, raw) = read(parent, kAXOrientationAttribute)
        orientationError = error.rawValue
        switch semanticOrientation(error, raw) {
        case .vertical: orientationKind = 1
        case .horizontal: orientationKind = 2
        case nil: break
        }
        let (errorEnabled, rawEnabled) = read(parent, kAXEnabledAttribute)
        parentEnabledError = errorEnabled.rawValue
        if errorEnabled == .success, let rawEnabled = rawEnabled, CFGetTypeID(rawEnabled) == CFBooleanGetTypeID() {
            parentEnabledKind = CFBooleanGetValue((rawEnabled as! CFBoolean)) ? 2 : 1
        }
    }
    func geometry(_ target: AXUIElement) -> (Int32, Int32, Rect?) {
        let (positionError, position) = read(target, kAXPositionAttribute)
        let (sizeError, size) = read(target, kAXSizeAttribute)
        guard positionError == .success, sizeError == .success, let position = position, let size = size,
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else {
            return (positionError.rawValue, sizeError.rawValue, nil)
        }
        var point = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else {
            return (positionError.rawValue, sizeError.rawValue, nil)
        }
        return (positionError.rawValue, sizeError.rawValue, Rect(x: point.x, y: point.y, width: dimensions.width, height: dimensions.height))
    }
    let childGeometry = geometry(element)
    let parentGeometry = relation.windowConfirmed ? immediateParent.map { geometry($0) } : nil
    let childValid = childGeometry.2?.valid == true
    let parentValid = parentGeometry?.2?.valid == true
    let childInsideWindow = childValid && childGeometry.2.map { window.bounds.contains($0) } == true
    let parentInsideWindow = parentValid && parentGeometry?.2.map { window.bounds.contains($0) } == true
    let childInsideParent = childValid && parentValid && childGeometry.2.map { child in parentGeometry?.2?.contains(child) == true } == true
    scrollbarChildLogger.notice("childKind=\(kind.rawValue, privacy: .public) enabledError=\(enabledError.rawValue, privacy: .public) pressDeclared=\(actions.contains(kAXPressAction), privacy: .public) actionCount=\(actions.count, privacy: .public) parentRoleKind=\(relation.parentRole.rawValue, privacy: .public) parentReadError=\(parentReadError, privacy: .public) parentRoleError=\(parentRoleError, privacy: .public) parentRoleMalformed=\(parentRoleMalformed, privacy: .public) parentPIDError=\(parentPIDError, privacy: .public) parentPIDConfirmed=\(relation.parentPIDConfirmed, privacy: .public) approvedWindowConfirmed=\(relation.windowConfirmed, privacy: .public) relationFailure=\(relation.failure.rawValue, privacy: .public) parentDepth=\(relation.depth, privacy: .public) chainReadStage=\(chainReadStage, privacy: .public) chainReadError=\(chainReadError, privacy: .public) orientationKind=\(orientationKind, privacy: .public) orientationError=\(orientationError, privacy: .public) parentEnabledKind=\(parentEnabledKind, privacy: .public) parentEnabledError=\(parentEnabledError, privacy: .public) childPositionError=\(childGeometry.0, privacy: .public) childSizeError=\(childGeometry.1, privacy: .public) childGeometryDecoded=\(childGeometry.2 != nil, privacy: .public) childGeometryValid=\(childValid, privacy: .public) childInsideWindow=\(childInsideWindow, privacy: .public) parentPositionError=\(parentGeometry?.0 ?? 0, privacy: .public) parentSizeError=\(parentGeometry?.1 ?? 0, privacy: .public) parentGeometryDecoded=\(parentGeometry?.2 != nil, privacy: .public) parentGeometryValid=\(parentValid, privacy: .public) parentInsideWindow=\(parentInsideWindow, privacy: .public) childInsideParent=\(childInsideParent, privacy: .public) deadlineReached=\(deadlineReached, privacy: .public)")
}

func nativeScrollButtonCandidate(_ element: AXUIElement, path: [Int], window: WindowIdentity, root: AXUIElement,
                                 enabledError: AXError, budget: ScanBudget?, diagnostic: NativeCandidateDiagnostic?) -> Candidate? {
    // Production validation has its own bounded reads, independent of the
    // debug probe and its quota. Prepare/final also keep this deadline.
    let localBudget = ScanBudget(deadline: min(budget?.deadline ?? UInt64.max, DispatchTime.now().uptimeNanoseconds + 1_000_000_000))
    var accepted = false
    defer {
        if !accepted {
            budget?.truncated = true
            if let code = localBudget.firstAXErrorCode, let error = AXError(rawValue: code) {
                budget?.noteRequiredReadFailure(error)
            } else { budget?.noteRequiredReadFailure(enabledError) }
        }
    }
    let (subroleError, rawSubrole) = axAttribute(element, kAXSubroleAttribute, budget: localBudget)
    guard let subrole = candidateIdentityText(subroleError, rawSubrole, maximumBytes: 64, allowEmpty: false, budget: localBudget) else {
        diagnostic?.reject(.scrollButtonSubrole, error: subroleError); return nil
    }
    guard subrole == kAXIncrementPageSubrole || subrole == kAXDecrementPageSubrole else {
        // Unproven buttons retain the original missing-Enabled rejection.
        diagnostic?.reject(.enabled, error: enabledError); return nil
    }
    diagnostic?.subroleConfirmed = true
    diagnostic?.scrollButtonProfile = true
    var immediateParent: AXUIElement?
    let relation = scrollbarChildRelation(element, root: root, pid: window.pid, equal: { CFEqual($0, $1) }, readParent: { child, immediate in
        let (parentError, rawParent) = axAttribute(child, kAXParentAttribute, budget: localBudget)
        guard parentError == .success, let rawParent = rawParent, CFGetTypeID(rawParent) == AXUIElementGetTypeID() else {
            if parentError != .success { localBudget.noteRequiredReadFailure(parentError) }
            else { localBudget.truncated = true }
            diagnostic?.reject(.scrollButtonParent, error: parentError)
            return nil
        }
        let parent = rawParent as! AXUIElement
        guard localBudget.ready() else { diagnostic?.reject(.scrollButtonParent, error: .cannotComplete); return nil }
        var pid: pid_t = 0
        let pidError = AXUIElementGetPid(parent, &pid)
        guard candidateProcessMatches(pidError, pid, expected: window.pid, budget: localBudget) else {
            diagnostic?.reject(.scrollButtonParent, error: pidError); return nil
        }
        let (roleError, rawRole) = axAttribute(parent, kAXRoleAttribute, budget: localBudget)
        guard let role = candidateIdentityText(roleError, rawRole, maximumBytes: 64, allowEmpty: false, budget: localBudget) else {
            diagnostic?.reject(.scrollButtonParent, error: roleError); return nil
        }
        if immediate { immediateParent = parent }
        return NativeTextAncestor(element: parent, role: role, pid: pid, bounds: nil)
    })
    guard relation.windowConfirmed, let parent = immediateParent else { diagnostic?.reject(.scrollButtonParent); return nil }
    diagnostic?.scrollButtonParentConfirmed = true
    let (parentEnabledError, parentEnabled) = axAttribute(parent, kAXEnabledAttribute, budget: localBudget)
    guard candidateEnabled(parentEnabledError, parentEnabled, budget: localBudget) == true else {
        diagnostic?.reject(.scrollButtonAvailability, error: parentEnabledError); return nil
    }
    diagnostic?.scrollButtonParentEnabled = true
    let (orientationError, rawOrientation) = axAttribute(parent, kAXOrientationAttribute, budget: localBudget)
    guard let orientation = semanticOrientation(orientationError, rawOrientation, budget: localBudget),
          let operation = nativeScrollButtonOperation(subrole: subrole, orientation: orientation) else {
        diagnostic?.reject(.orientation, error: orientationError); return nil
    }
    diagnostic?.orientationConfirmed = true
    guard let parentBounds = axRect(parent, budget: localBudget, diagnostic: diagnostic),
          let childBounds = axRect(element, budget: localBudget, diagnostic: diagnostic),
          window.bounds.contains(childBounds), parentBounds.contains(childBounds) else {
        diagnostic?.reject(.scrollButtonGeometry); return nil
    }
    diagnostic?.scrollButtonBoundsConfirmed = true
    diagnostic?.boundsInsideWindow = true
    let (titleError, rawTitle) = axAttribute(element, kAXTitleAttribute, budget: localBudget)
    guard let title = candidateIdentityText(titleError, rawTitle, maximumBytes: 256, allowMissing: true, budget: localBudget) else {
        diagnostic?.reject(.title, error: titleError); return nil
    }
    let candidate = Candidate(path: path, role: kAXButtonRole, title: title, description: nil, subrole: subrole,
                              identifier: nil, bounds: childBounds, operations: [operation], enabledState: .absent,
                              identityProfile: .nativeScrollButtonV1,
                              scrollButtonState: ScrollButtonState(parentBounds: parentBounds, orientation: orientation))
    guard localBudget.ready(), candidate.valid else { diagnostic?.reject(.scrollButtonProfile); return nil }
    accepted = true
    diagnostic?.enabledConfirmed = true
    diagnostic?.enabledAbsent = true
    diagnostic?.accepted = true
    return candidate
}

func boundSemanticElement(_ target: SemanticTarget, operation: SemanticOperation) throws -> (AXUIElement, Bool, AXUIElement) {
    try requireTrust()
    _ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15)
    let window = target.window
    try revalidateWindow(window)
    guard let root = axWindow(window) else { throw HelperError(code: "target_changed", message: "The public AX window match is not unique.") }
    var context = true
    var isRoot = true
    guard let element = resolveCandidatePath(root, path: target.candidate.path, readChildren: { parent, count in
        var pid: pid_t = 0
        let (roleError, rawRole) = axAttribute(parent, kAXRoleAttribute)
        let role = candidateIdentityText(roleError, rawRole, maximumBytes: 64, allowEmpty: false)
        guard let role = role, AXUIElementGetPid(parent, &pid) == .success, pid == window.pid,
              role != kAXApplicationRole, role != kAXWindowRole || isRoot else { return nil }
        context = nativeTextContext(context, role: role, root: isRoot)
        isRoot = false
        return axElements(parent, attribute: kAXChildrenAttribute, limit: count, requireComplete: false)
    }) else { throw HelperError(code: "target_changed", message: "The AX element path changed.") }
    let (roleError, rawRole) = axAttribute(element, kAXRoleAttribute)
    let role = candidateIdentityText(roleError, rawRole, maximumBytes: 64, allowEmpty: false)
    context = nativeTextContext(context, role: role, root: target.candidate.path.isEmpty)
    guard let current = candidateInfo(element, path: target.candidate.path, window: window, nativeContext: context, knownRole: role,
                                      requiredProfile: target.candidate.identityProfile, root: root),
          current.role == target.candidate.role, current.title == target.candidate.title,
          current.matchesSemanticFields(of: target.candidate), current.bounds == target.candidate.bounds,
          current.enabledState == target.candidate.enabledState,
          current.scrollState == target.candidate.scrollState,
          current.effectiveOperations.contains(operation),
          (operation.textAttribute == nil || current.textState == target.candidate.textState),
          (operation.scrollOrientation == nil || current.orientation == target.candidate.orientation) else {
        throw HelperError(code: "target_changed", message: "The AX element identity or capability changed.")
    }
    try revalidateWindow(window)
    return (element, context, root)
}

func revalidateSemanticCapability(_ element: AXUIElement, context: Bool, target: SemanticTarget,
                                  operation: SemanticOperation, root: AXUIElement) throws {
    if target.candidate.identityProfile != nil {
        guard let current = candidateInfo(element, path: target.candidate.path, window: target.window,
                                          nativeContext: context, requiredProfile: target.candidate.identityProfile, root: root),
              current.role == target.candidate.role, current.title == target.candidate.title,
              current.bounds == target.candidate.bounds, current.matchesSemanticFields(of: target.candidate),
              current.textState == target.candidate.textState, current.effectiveOperations.contains(operation) else {
            throw HelperError(code: "target_changed", message: "The native identity profile changed.")
        }
        return
    }
    var rawActions: CFArray?
    let error = AXUIElementCopyActionNames(element, &rawActions)
    guard let actions = candidateActionNames(error, rawActions) else { throw HelperError(code: "target_changed", message: "Cannot confirm AX actions.") }
    let current = nativeSemanticCapabilities(element, role: target.candidate.role, nativeContext: context, actions: actions)
    let (enabledError, enabled) = axAttribute(element, kAXEnabledAttribute)
    guard let availability = candidateEnabledCapabilities(enabledError, enabled, role: target.candidate.role, operations: current.operations),
          candidateAvailabilityMatches(availability, observed: target.candidate, operation: operation),
          semanticCapabilityMatches(current, observed: target.candidate, operation: operation) else {
        throw HelperError(code: "target_changed", message: "The AX selection, orientation or capability changed.")
    }
}

let semanticLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "semantic-input")

func dispatchSemanticMutation(_ element: AXUIElement, window: WindowIdentity, operation: SemanticOperation,
                              perform: () -> AXError) throws {
    _ = AXUIElementSetMessagingTimeout(element, 0.75)
    let frontmostBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let pointerBefore = NSEvent.mouseLocation
    let result = perform()
    let pointerAfter = NSEvent.mouseLocation
    let frontmostAfter = NSWorkspace.shared.frontmostApplication?.processIdentifier
    // Content and identities are never logged. This endpoint diagnostic does not
    // prove that an application never briefly changed focus during its callback.
    semanticLogger.notice("operation=\(operation.rawValue, privacy: .public) axError=\(result.rawValue, privacy: .public) frontmostKnownBefore=\(frontmostBefore != nil, privacy: .public) frontmostKnownAfter=\(frontmostAfter != nil, privacy: .public) targetFrontmostBefore=\(frontmostBefore == window.pid, privacy: .public) targetFrontmostAfter=\(frontmostAfter == window.pid, privacy: .public) frontmostChanged=\(frontmostBefore != frontmostAfter, privacy: .public) pointerMoved=\(pointerBefore != pointerAfter, privacy: .public)")
    try mutationResult(result)
    emit(["ok": true, "dispatched": true])
}

func setText(_ request: SetTextRequest) throws {
    guard let attribute = request.operation.textAttribute else { throw invalidRequest() }
    let (element, context, root) = try boundSemanticElement(request.target, operation: request.operation)
    try revalidateSemanticCapability(element, context: context, target: request.target, operation: request.operation, root: root)
    try dispatchSemanticMutation(element, window: request.target.window, operation: request.operation) {
        AXUIElementSetAttributeValue(element, attribute as CFString, request.text as CFString)
    }
}

func scroll(_ request: ScrollRequest) throws {
    let action = semanticScrollAction(candidate: request.target.candidate, operation: request.operation)
    let destination = request.target.candidate.scrollState?.destination(for: request.operation)
    guard action != nil || destination != nil else { throw invalidRequest() }
    let (element, context, root) = try boundSemanticElement(request.target, operation: request.operation)
    try revalidateSemanticCapability(element, context: context, target: request.target, operation: request.operation, root: root)
    try dispatchSemanticMutation(element, window: request.target.window, operation: request.operation) {
        if let destination = destination {
            return AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, NSNumber(value: destination))
        }
        return AXUIElementPerformAction(element, action! as CFString)
    }
}
