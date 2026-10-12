import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import ScreenCaptureKit
import os

// This helper never posts mouse events, raises windows, or activates applications.
// One invocation performs at most one public AX mutation on a revalidated element.
let maximumAXPathDepth = 32
let maximumAXObservationOutputBytes = 64 * 1024
let readableTextFieldSubroles: Set<String> = [kAXSearchFieldSubrole]
let scopedReadableTextFieldSubroles: Set<String> = [kAXSearchFieldSubrole, "AXTextField"]

// Preserve exact semantic identity instead of normalizing or truncating it into
// another control's name. Unbounded or control-bearing fields are not actionable.
func validSemanticText(_ text: String, maximumBytes: Int) -> Bool {
    guard text.utf8.prefix(maximumBytes + 1).count <= maximumBytes else { return false }
    return !text.unicodeScalars.contains { scalar in
        let code = scalar.value
        return code < 32 || (code >= 127 && code <= 159)
            || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
    }
}

enum CandidateSemanticField: Int, CaseIterable {
    case description, subrole, identifier
    var attribute: String {
        switch self {
        case .description: return kAXDescriptionAttribute
        case .subrole: return kAXSubroleAttribute
        case .identifier: return kAXIdentifierAttribute
        }
    }
    var maximumBytes: Int { self == .subrole ? 64 : 256 }
}

// Unsupported optional reads do not have consistent AXError codes across apps.
// Confirm support first, and keep both parsing and each following read bounded.
func candidateAttributeNames(_ raw: CFArray?, budget: ScanBudget? = nil) -> Set<String>? {
    if let budget = budget, !budget.ready() { return nil }
    guard let raw = raw, CFArrayGetCount(raw) <= 128, let names = raw as? [String] else { return nil }
    var bytes = 0
    var result: Set<String> = []
    for name in names {
        if let budget = budget, !budget.ready() { return nil }
        guard !name.isEmpty, validSemanticText(name, maximumBytes: 128) else { return nil }
        bytes += name.utf8.count
        guard bytes <= 8 * 1024 else { return nil }
        result.insert(name)
    }
    return result
}

func candidateSemanticFields(_ attributes: Set<String>, budget: ScanBudget? = nil,
                                     fields: [CandidateSemanticField] = [.description, .identifier],
                                     read: (String) -> (AXError, CFTypeRef?)) -> [String: String]? {
    var result: [String: String] = [:]
    for field in fields {
        if let budget = budget, !budget.ready() { return nil }
        // Some apps omit AXDescription from CopyAttributeNames while returning
        // its primary human-readable identity. Subrole is not needed by AXPress
        // and is excluded from production fields; retain opt-in legacy tests.
        guard field == .description || attributes.contains(field.attribute) else {
            budget?.semanticMissing[field.rawValue] += 1
            continue
        }
        let (error, raw) = read(field.attribute)
        if let budget = budget, !budget.ready() { return nil }
        if error == .noValue || (field == .description && error == .attributeUnsupported) {
            budget?.semanticMissing[field.rawValue] += 1
            continue
        }
        guard error == .success else {
            budget?.noteSemanticReadFailure(field, error: error)
            return nil
        }
        guard let text = raw as? String, validSemanticText(text, maximumBytes: field.maximumBytes) else {
            budget?.semanticInvalid[field.rawValue] += 1
            budget?.truncated = true
            return nil
        }
        result[field.attribute] = text
    }
    return result
}

func copiedPrefixElements<Element>(_ error: AXError, _ raw: CFArray?, expectedCount: Int, budget: ScanBudget? = nil,
                                          isValid: (Element) -> Bool) -> [Element]? {
    guard error == .success else { budget?.noteRequiredReadFailure(error); return nil }
    if let budget = budget, !budget.ready() { return nil }
    guard expectedCount >= 0, expectedCount <= 64,
          let raw = raw, CFArrayGetCount(raw) == expectedCount, let array = raw as? [Element],
          array.allSatisfy(isValid) else { budget?.truncated = true; return nil }
    return array
}

// A sealed path identifies one control. Later siblings cannot change its index;
// only the bounded prefix through that index is needed before strict identity
// revalidation. No geometric hit-test or missing-sibling inference occurs here.
func resolveCandidatePath<Element>(_ root: Element, path: [Int],
                                           readChildren: (Element, Int) -> [Element]?) -> Element? {
    guard path.count <= maximumAXPathDepth, path.allSatisfy({ $0 >= 0 && $0 < 64 }) else { return nil }
    var element = root
    for index in path {
        guard let children = readChildren(element, index + 1), children.count == index + 1 else { return nil }
        element = children[index]
    }
    return element
}

struct Rect: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    var valid: Bool {
        x.isFinite && y.isFinite && width.isFinite && height.isFinite
            && abs(x) <= 10_000_000 && abs(y) <= 10_000_000
            && width > 0 && height > 0 && width <= 100_000 && height <= 100_000
    }
    var cg: CGRect { CGRect(x: x, y: y, width: width, height: height) }
    var json: [String: Any] { ["x": x, "y": y, "width": width, "height": height] }
    func contains(_ other: Rect) -> Bool {
        other.x >= x && other.y >= y && other.x + other.width <= x + width && other.y + other.height <= y + height
    }
    func contains(x: Double, y: Double) -> Bool { x >= self.x && y >= self.y && x < self.x + width && y < self.y + height }
    func matchesAX(_ other: Rect) -> Bool {
        abs(x - other.x) <= 0.5 && abs(y - other.y) <= 0.5 && abs(width - other.width) <= 0.5 && abs(height - other.height) <= 0.5
    }
    func intersection(_ other: Rect) -> Rect? {
        guard valid, other.valid else { return nil }
        let left = max(x, other.x), top = max(y, other.y)
        let right = min(x + width, other.x + other.width), bottom = min(y + height, other.y + other.height)
        let result = Rect(x: left, y: top, width: right - left, height: bottom - top)
        return result.valid ? result : nil
    }
}

// A document can grow beyond its containing window after text replacement.
// Only a proven text-only identifier profile may use its visible viewport;
// the complete AX rectangle remains a separate frozen identity fingerprint.
func clippedNativeTextBounds(document: Rect, window: Rect, viewport: Rect,
                             profile: CandidateIdentityProfile?) -> Rect? {
    guard profile == .nativeTextIdentifierV1, document.valid, window.valid, viewport.valid,
          window.contains(viewport), let visible = document.intersection(viewport),
          window.contains(visible) else { return nil }
    return visible
}

struct NativeTextAncestor<Element> {
    let element: Element
    let role: String
    let pid: Int32
    let bounds: Rect?
}

// The nearest parent must really be a scroll area and the bounded parent chain
// must end at the exact approved AX window, without crossing a web/secure tree.
func nativeTextViewport<Element>(_ element: Element, root: Element, window: WindowIdentity,
                                 equal: (Element, Element) -> Bool,
                                 readParent: (Element) -> NativeTextAncestor<Element>?) -> Rect? {
    var child = element
    var visited = [element]
    var viewport: Rect?
    for depth in 0..<maximumAXPathDepth {
        guard let parent = readParent(child), parent.pid == window.pid,
              !visited.contains(where: { equal($0, parent.element) }),
              !parent.role.isEmpty, parent.role != "AXWebArea", !parent.role.contains("Secure"),
              parent.role != kAXApplicationRole else { return nil }
        if depth == 0 {
            guard parent.role == kAXScrollAreaRole, let bounds = parent.bounds,
                  bounds.valid, window.bounds.contains(bounds) else { return nil }
            viewport = bounds
        }
        if equal(parent.element, root) {
            guard parent.role == kAXWindowRole, parent.bounds.map({ window.bounds.matchesAX($0) }) == true else { return nil }
            return viewport
        }
        guard parent.role != kAXWindowRole else { return nil }
        visited.append(parent.element)
        child = parent.element
    }
    return nil
}

// An unreadable identity is different from a control confirmed not actionable.
// Any rejected read must keep coordinate hit-testing from treating it as absent.
func candidateProcessMatches(_ error: AXError, _ pid: Int32, expected: Int32, budget: ScanBudget? = nil) -> Bool {
    if let budget = budget, !budget.ready() { return false }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return false }
    guard pid > 0 else { budget?.truncated = true; return false }
    return pid == expected
}

func candidateIdentityText(_ error: AXError, _ raw: CFTypeRef?, maximumBytes: Int,
                                   allowMissing: Bool = false, allowEmpty: Bool = true,
                                   budget: ScanBudget? = nil) -> String? {
    if let budget = budget, !budget.ready() { return nil }
    if allowMissing && (error == .attributeUnsupported || error == .noValue) { return "" }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return nil }
    guard let value = raw as? String, (allowEmpty || !value.isEmpty),
          validSemanticText(value, maximumBytes: maximumBytes) else { budget?.truncated = true; return nil }
    return value
}

func candidateEnabled(_ error: AXError, _ raw: CFTypeRef?, budget: ScanBudget? = nil) -> Bool? {
    if let budget = budget, !budget.ready() { return nil }
    guard error == .success else { budget?.noteRequiredReadFailure(error); return nil }
    guard let raw = raw, CFGetTypeID(raw) == CFBooleanGetTypeID() else { budget?.truncated = true; return nil }
    return CFEqual(raw, kCFBooleanTrue)
}

func candidatePressAction(_ error: AXError, _ raw: CFArray?, budget: ScanBudget? = nil) -> Bool? {
    candidateActionNames(error, raw, budget: budget).map { $0.contains(kAXPressAction) }
}

func candidateGeometry(_ positionError: AXError, _ position: CFTypeRef?,
                               _ sizeError: AXError, _ size: CFTypeRef?, budget: ScanBudget? = nil,
                               decode: (CFTypeRef, CFTypeRef) -> Rect?) -> Rect? {
    if let budget = budget, !budget.ready() { return nil }
    guard positionError == .success else { budget?.noteRequiredReadFailure(positionError); return nil }
    guard sizeError == .success else { budget?.noteRequiredReadFailure(sizeError); return nil }
    guard let position = position, let size = size, let bounds = decode(position, size), bounds.valid else {
        budget?.truncated = true
        return nil
    }
    if let budget = budget, !budget.ready() { return nil }
    return bounds
}

enum CandidateIdentityProfile: String, Codable {
    case nativeTextIdentifierV1 = "native-text-identifier-v1"
    case nativeScrollButtonV1 = "native-scroll-button-v1"
}

struct Candidate: Codable {
    let path: [Int]
    let role: String
    let title: String
    let description: String?
    let subrole: String?
    let identifier: String?
    let bounds: Rect
    var operations: [SemanticOperation]? = nil
    var textState: TextState? = nil
    var orientation: ScrollOrientation? = nil
    var enabledState: CandidateEnabledState? = nil
    var scrollState: ScrollState? = nil
    var identityProfile: CandidateIdentityProfile? = nil
    var descriptionDeclared: Bool? = nil
    var documentBounds: Rect? = nil
    var scrollButtonState: ScrollButtonState? = nil
    var effectiveOperations: [SemanticOperation] { operations ?? [.press] }
    var valid: Bool {
        path.count <= maximumAXPathDepth && path.allSatisfy { $0 >= 0 && $0 < 64 }
            && !role.isEmpty && role.utf8.count <= 64 && title.utf8.count <= 256 && bounds.valid
            && (description == nil || validSemanticText(description!, maximumBytes: 256))
            && (subrole == nil || validSemanticText(subrole!, maximumBytes: 64))
            && (identifier == nil || validSemanticText(identifier!, maximumBytes: 256))
            && validCandidateCapabilities(self)
    }
    var textBytes: Int {
        role.utf8.count + title.utf8.count + (description?.utf8.count ?? 0)
            + (subrole?.utf8.count ?? 0) + (identifier?.utf8.count ?? 0) + (textState?.subrole?.utf8.count ?? 0)
    }
    func matchesSemanticFields(of observed: Candidate) -> Bool {
        if identityProfile != observed.identityProfile || descriptionDeclared != observed.descriptionDeclared
            || documentBounds != observed.documentBounds || scrollButtonState != observed.scrollButtonState { return false }
        if let expected = observed.enabledState, enabledState != expected { return false }
        if observed.operations != nil && scrollState != observed.scrollState { return false }
        // Explicit operations distinguish fresh observations from legacy helper
        // receipts. Fresh identities bind confirmed absence as well as values.
        if observed.operations != nil {
            return description == observed.description && subrole == observed.subrole && identifier == observed.identifier
        }
        return (observed.description == nil || description == observed.description)
            && (observed.subrole == nil || subrole == observed.subrole)
            && (observed.identifier == nil || identifier == observed.identifier)
    }
    var json: [String: Any] {
        var value: [String: Any] = ["path": path, "role": role, "title": title, "bounds": bounds.json]
        if let description = description { value["description"] = description }
        if let subrole = subrole { value["subrole"] = subrole }
        if let identifier = identifier { value["identifier"] = identifier }
        if let operations = operations { value["operations"] = operations.map { $0.rawValue } }
        if let textState = textState { value["textState"] = textState.json }
        if let orientation = orientation { value["orientation"] = orientation.rawValue }
        if let enabledState = enabledState { value["enabledState"] = enabledState.rawValue }
        if let scrollState = scrollState { value["scrollState"] = scrollState.json }
        if let identityProfile = identityProfile { value["identityProfile"] = identityProfile.rawValue }
        if let descriptionDeclared = descriptionDeclared { value["descriptionDeclared"] = descriptionDeclared }
        if let documentBounds = documentBounds { value["documentBounds"] = documentBounds.json }
        if let scrollButtonState = scrollButtonState { value["scrollButtonState"] = scrollButtonState.json }
        return value
    }
}

struct WindowIdentity: Codable {
    let windowId: UInt32
    let pid: Int32
    let processStartedAt: Int64?
    let layer: Int32
    let bounds: Rect
    let title: String?
    var valid: Bool {
        windowId > 0 && pid > 0 && layer == 0 && bounds.valid
            && processStartedAt != nil && processStartedAt! > 0 && processStartedAt! <= 9_007_199_254_740_991
            && (title == nil || title!.utf8.count <= 256)
    }
    var json: [String: Any] {
        var value: [String: Any] = ["windowId": windowId, "pid": pid, "processStartedAt": processStartedAt.map { $0 as Any } ?? NSNull(), "layer": layer, "bounds": bounds.json]
        if let title = title { value["title"] = title }
        return value
    }
}

struct ClickRequest: Decodable {
    struct Target: Decodable { let window: WindowIdentity; let candidate: Candidate }
    let x: Double
    let y: Double
    let button: String
    let clickCount: Int
    let target: Target
}

struct TargetsRequest: Decodable { let displayBounds: Rect }
struct ObservationScope: Decodable {
    let anchor: Candidate
    let ancestorLevels: Int
    var valid: Bool { anchor.valid && ancestorLevels >= 0 && ancestorLevels <= 3 && ancestorLevels <= anchor.path.count }
}
struct WindowRequest: Decodable { let window: WindowIdentity; var scope: ObservationScope? = nil }

struct ResolvedObservationScope<Element> {
    let element: Element
    let path: [Int]
    let nativeContext: Bool
}

struct ObservationScopeNodeIdentity {
    let pid: Int32
    let role: String
    var secureTextField = false
}

func safeScopedObservationRole(_ role: String, textFieldSubrole: String? = nil) -> Bool {
    guard !role.isEmpty, validSemanticText(role, maximumBytes: 64), !role.contains("Secure") else { return false }
    return role != kAXTextFieldRole || textFieldSubrole.map { scopedReadableTextFieldSubroles.contains($0) } == true
}

func sameObservationScopeAnchor(_ current: Candidate, _ observed: Candidate) -> Bool {
    current.valid && observed.valid && current.path == observed.path && current.role == observed.role && current.title == observed.title
        && current.bounds == observed.bounds && current.description == observed.description
        && current.subrole == observed.subrole && current.identifier == observed.identifier
        && current.operations == observed.operations && current.enabledState == observed.enabledState
        && current.textState == observed.textState && current.orientation == observed.orientation
        && current.scrollState == observed.scrollState && current.matchesSemanticFields(of: observed)
}

// Resolve the complete window-relative anchor before selecting a local region.
// Every child must also point back to its actual preceding parent. Web ancestry
// remains readable but permanently removes native-only text/scroll eligibility.
func resolveObservationScope<Element>(_ root: Element, path: [Int], ancestorLevels: Int, pid: Int32,
                                      budget: ScanBudget? = nil, equal: (Element, Element) -> Bool,
                                      readIdentity: (Element) -> ObservationScopeNodeIdentity?,
                                      readParent: (Element) -> Element?,
                                      readChildren: (Element, Int) -> [Element]?,
                                      validateAnchor: (Element, Bool) -> Bool) -> ResolvedObservationScope<Element>? {
    func identity(_ node: Element, depth: Int) -> ObservationScopeNodeIdentity? {
        if let budget = budget {
            guard budget.ready(), budget.nodes < 2048 else { budget.truncated = true; return nil }
            budget.nodes += 1
            budget.maxDepth = max(budget.maxDepth, depth)
        }
        return readIdentity(node)
    }
    guard pid > 0, path.count <= maximumAXPathDepth, path.allSatisfy({ $0 >= 0 && $0 < 64 }),
          ancestorLevels >= 0, ancestorLevels <= 3, ancestorLevels <= path.count,
          budget?.ready() ?? true, let rootIdentity = identity(root, depth: 0), rootIdentity.pid == pid,
          rootIdentity.role == kAXWindowRole, !rootIdentity.secureTextField else { return nil }
    var visited = [ResolvedObservationScope(element: root, path: [], nativeContext: true)]
    for (depth, index) in path.enumerated() {
        guard budget?.ready() ?? true, let current = visited.last,
              let children = readChildren(current.element, index + 1), children.count == index + 1,
              budget?.ready() ?? true else { return nil }
        let child = children[index]
        guard !visited.contains(where: { equal($0.element, child) }),
              let childIdentity = identity(child, depth: depth + 1), childIdentity.pid == pid, !childIdentity.role.isEmpty,
              validSemanticText(childIdentity.role, maximumBytes: 64), childIdentity.role != kAXWindowRole,
              childIdentity.role != kAXApplicationRole, !childIdentity.role.contains("Secure"), !childIdentity.secureTextField,
              budget?.ready() ?? true, let parent = readParent(child), equal(parent, current.element),
              budget?.ready() ?? true else { return nil }
        visited.append(ResolvedObservationScope(element: child, path: Array(path.prefix(depth + 1)),
            nativeContext: nativeTextContext(current.nativeContext, role: childIdentity.role)))
    }
    guard budget?.ready() ?? true, let anchor = visited.last, validateAnchor(anchor.element, anchor.nativeContext),
          budget?.ready() ?? true else { return nil }
    return visited[path.count - ancestorLevels]
}

struct HelperError: Error {
    let code: String
    let message: String
    var exitCode: Int32 = 70
    var unknown = false
}

// Text/node limits do not bound path, capability or JSON-escaping overhead.
// Reserve the complete frozen window/scope and the longest boolean spellings,
// then keep only whole candidate records in their original traversal order.
// The empty AX fields also reserve their exact enclosing JSON overhead; the
// independent readable tree receives only the remaining encoded byte budget.
func boundedWindowTargetReceipt(window: WindowIdentity, candidates: [Candidate], truncated: Bool,
                                scopePath: [Int]? = nil,
                                maximumBytes: Int = maximumAXObservationOutputBytes) throws -> [String: Any] {
    // Foundation can raise an Objective-C exception for non-finite numbers;
    // reject invalid typed records before its serializer crosses that boundary.
    guard window.valid, candidates.allSatisfy({ $0.valid }) else { throw invalidRequest() }
    var target = window.json
    target["candidates"] = [[String: Any]]()
    var receipt: [String: Any] = ["ok": true, "target": target, "truncated": false,
                                  "axTree": "", "axTreeTruncated": false]
    if let path = scopePath { receipt["scope"] = ["path": path] }
    var encodedBytes = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]).count
    guard encodedBytes < maximumBytes else {
        throw HelperError(code: "output_limit", message: "The frozen observation identity exceeds the output budget.")
    }
    var retained: [[String: Any]] = []
    var omitted = false
    for candidate in candidates {
        let value = candidate.json
        let additionalBytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).count
            + (retained.isEmpty ? 0 : 1)
        guard additionalBytes < maximumBytes - encodedBytes else { omitted = true; break }
        retained.append(value)
        encodedBytes += additionalBytes
    }
    target["candidates"] = retained
    receipt["target"] = target
    receipt["truncated"] = truncated || omitted
    return receipt
}

func emit(_ result: [String: Any], maximumBytes: Int = maximumAXObservationOutputBytes) {
    guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), data.count < maximumBytes else {
        FileHandle.standardOutput.write(Data("{\"ok\":false,\"dispatched\":false,\"error\":{\"code\":\"output_limit\",\"message\":\"Observation exceeds the output budget.\"}}\n".utf8))
        exit(70)
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

func invalidRequest() -> HelperError {
    HelperError(code: "invalid_request", message: "Expected a bounded, exact AX target request.", exitCode: 64)
}

func fields(_ value: Any?, required: Set<String>, optional: Set<String> = []) throws -> [String: Any] {
    guard let result = value as? [String: Any], required.isSubset(of: Set(result.keys)), Set(result.keys).isSubset(of: required.union(optional)) else { throw invalidRequest() }
    return result
}

func validateRectFields(_ value: Any?) throws {
    _ = try fields(value, required: ["x", "y", "width", "height"])
}

// Foundation's JSON decoders otherwise accept duplicate keys. Reject those before
// decoding so a request has one unambiguous value for every identity field.
struct JSONKeyScanner {
    let bytes: [UInt8]
    var index = 0
    mutating func whitespace() {
        while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
    }
    mutating func stringToken() throws -> Data {
        guard index < bytes.count, bytes[index] == 34 else { throw invalidRequest() }
        let start = index
        index += 1
        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if byte == 34 { return Data(bytes[start..<index]) }
            if byte == 92 { index += 1 }
        }
        throw invalidRequest()
    }
    mutating func value(depth: Int = 0) throws {
        guard depth <= 32 else { throw invalidRequest() }
        whitespace()
        guard index < bytes.count else { throw invalidRequest() }
        if bytes[index] == 34 { _ = try stringToken(); return }
        if bytes[index] == 123 {
            index += 1
            whitespace()
            if index < bytes.count, bytes[index] == 125 { index += 1; return }
            var keys = Set<String>()
            while index < bytes.count {
                whitespace()
                guard let key = try? JSONDecoder().decode(String.self, from: stringToken()), keys.insert(key).inserted else { throw invalidRequest() }
                whitespace()
                guard index < bytes.count, bytes[index] == 58 else { throw invalidRequest() }
                index += 1
                try value(depth: depth + 1)
                whitespace()
                guard index < bytes.count else { throw invalidRequest() }
                let delimiter = bytes[index]
                index += 1
                if delimiter == 125 { return }
                if delimiter != 44 { throw invalidRequest() }
            }
            throw invalidRequest()
        }
        if bytes[index] == 91 {
            index += 1
            whitespace()
            if index < bytes.count, bytes[index] == 93 { index += 1; return }
            while index < bytes.count {
                try value(depth: depth + 1)
                whitespace()
                guard index < bytes.count else { throw invalidRequest() }
                let delimiter = bytes[index]
                index += 1
                if delimiter == 93 { return }
                if delimiter != 44 { throw invalidRequest() }
            }
            throw invalidRequest()
        }
        let start = index
        while index < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[index]) { index += 1 }
        guard index > start else { throw invalidRequest() }
    }
    mutating func validate() throws {
        try value()
        whitespace()
        guard index == bytes.count else { throw invalidRequest() }
    }
}

func readInput(maximumBytes: Int = 4096) throws -> (Data, [String: Any]) {
    var data = Data()
    while let chunk = try FileHandle.standardInput.read(upToCount: maximumBytes + 1 - data.count), !chunk.isEmpty {
        data.append(chunk)
        if data.count > maximumBytes { throw invalidRequest() }
    }
    return try parseInput(data, maximumBytes: maximumBytes)
}

func parseInput(_ data: Data, maximumBytes: Int = 4096) throws -> (Data, [String: Any]) {
    guard data.count <= maximumBytes else { throw invalidRequest() }
    var scanner = JSONKeyScanner(bytes: Array(data))
    try scanner.validate()
    guard let object = try? JSONSerialization.jsonObject(with: data), let dictionary = object as? [String: Any] else { throw invalidRequest() }
    return (data, dictionary)
}

func readTargetsRequest() throws -> TargetsRequest {
    let (data, object) = try readInput()
    _ = try fields(object, required: ["displayBounds"])
    try validateRectFields(object["displayBounds"])
    guard let request = try? JSONDecoder().decode(TargetsRequest.self, from: data), request.displayBounds.valid else { throw invalidRequest() }
    return request
}

func readWindowRequest(allowScope: Bool = false) throws -> WindowRequest {
    let (data, _) = try readInput()
    return try parseWindowRequest(data, allowScope: allowScope)
}

func parseWindowRequest(_ data: Data, allowScope: Bool = false) throws -> WindowRequest {
    let (_, object) = try parseInput(data)
    _ = try fields(object, required: ["window"], optional: allowScope ? ["scope"] : [])
    let window = try fields(object["window"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
    if let title = window["title"], !(title is String) { throw invalidRequest() }
    try validateRectFields(window["bounds"])
    if let raw = object["scope"] {
        let scope = try fields(raw, required: ["anchor", "ancestorLevels"])
        try validateCandidateFields(scope["anchor"])
    }
    guard let request = try? JSONDecoder().decode(WindowRequest.self, from: data), request.window.valid,
          request.scope?.valid != false,
          request.scope.map({ request.window.bounds.contains($0.anchor.bounds)
            && $0.anchor.documentBounds.map({ !request.window.bounds.contains($0) }) != false }) != false else { throw invalidRequest() }
    return request
}

func readClickRequest() throws -> ClickRequest {
    let (data, object) = try readInput()
    _ = try fields(object, required: ["x", "y", "button", "clickCount", "target"])
    let target = try fields(object["target"], required: ["window", "candidate"])
    let window = try fields(target["window"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
    if let title = window["title"], !(title is String) { throw invalidRequest() }
    try validateRectFields(window["bounds"])
    try validateCandidateFields(target["candidate"])
    guard let request = try? JSONDecoder().decode(ClickRequest.self, from: data), request.x.isFinite, request.y.isFinite,
          (request.button == "left" || request.button == "right"), (request.clickCount == 1 || request.clickCount == 2),
          request.target.window.valid, request.target.candidate.valid, request.target.candidate.effectiveOperations.contains(.press),
          request.target.window.bounds.contains(request.target.candidate.bounds),
          request.target.candidate.bounds.contains(x: request.x, y: request.y) else { throw invalidRequest() }
    return request
}

func parentActivityReceipt(parentPID: Int32, confirmedParentPID: Int32, frontmostPID: Int32?) -> [String: Any] {
    guard parentPID > 1, confirmedParentPID == parentPID, let frontmostPID = frontmostPID, frontmostPID > 0 else {
        return ["ok": true, "known": false, "active": false]
    }
    return ["ok": true, "known": true, "active": frontmostPID == parentPID]
}

func status() -> [String: Any] {
    let trusted = AXIsProcessTrusted()
    return ["available": trusted, "accessibilityTrusted": trusted]
}

func parentActivity() -> [String: Any] {
    // main spawns this fixed helper directly. No caller-supplied PID or other
    // application identity leaves this read-only diagnostic.
    let parentPID = getppid()
    let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    return parentActivityReceipt(parentPID: parentPID, confirmedParentPID: getppid(), frontmostPID: frontmostPID)
}

func requireTrust() throws {
    guard AXIsProcessTrusted() else { throw HelperError(code: "permission_denied", message: "Allow OmniFlow in macOS Accessibility settings.", exitCode: 77) }
}

func processStart(_ pid: Int32) -> Int64? {
    guard pid > 0 else { return nil }
    // launchDate is absent for apps started directly by npm/exec/spawn instead
    // of LaunchServices. Use one kernel identity source for every helper mode.
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
          info.pbi_pid == UInt32(pid), info.pbi_status != UInt32(SZOMB),
          info.pbi_start_tvsec > 0, info.pbi_start_tvsec <= 9_007_199_254_740,
          info.pbi_start_tvusec < 1_000_000 else { return nil }
    let milliseconds = info.pbi_start_tvsec * 1000 + info.pbi_start_tvusec / 1000
    guard milliseconds <= 9_007_199_254_740_991 else { return nil }
    return Int64(milliseconds)
}

final class ScanBudget {
    let deadline: UInt64
    init(deadline: UInt64 = DispatchTime.now().uptimeNanoseconds + 3_200_000_000) { self.deadline = deadline }
    var nodes = 0
    var candidates = 0
    var textBytes = 0
    var truncated = false
    private(set) var firstAXErrorCode: Int32?
    private(set) var candidateDiagnostics = 0
    private(set) var scrollbarChildDiagnostics = 0
    var maxDepth = 0
    var maxChildren = 0
    var depthLimit = false
    var childrenLimit = false
    var attributeNamesReadErrors = 0
    var attributeNamesInvalid = 0
    var semanticMissing = [0, 0, 0]
    var semanticReadErrors = [0, 0, 0]
    var semanticInvalid = [0, 0, 0]
    // Diagnostics have an independent cap and never consume scan capacity or
    // mark candidates partial. Single-target checks use no scan budget.
    func claimCandidateDiagnostic() -> Bool {
        guard candidateDiagnostics < 32 else { return false }
        candidateDiagnostics += 1
        return true
    }
    func claimScrollbarChildDiagnostic() -> Bool {
        guard scrollbarChildDiagnostics < 8 else { return false }
        scrollbarChildDiagnostics += 1
        return true
    }
    func ready() -> Bool {
        if DispatchTime.now().uptimeNanoseconds >= deadline { truncated = true; return false }
        return true
    }
    func reserveText(_ bytes: Int) -> Bool {
        guard textBytes + bytes <= 12 * 1024 else { truncated = true; return false }
        textBytes += bytes
        return true
    }
    func note(_ error: AXError) {
        if error != .success && error != .attributeUnsupported && error != .noValue {
            if firstAXErrorCode == nil { firstAXErrorCode = error.rawValue }
            truncated = true
        }
    }
    func noteRequiredReadFailure(_ error: AXError) {
        if firstAXErrorCode == nil { firstAXErrorCode = error.rawValue }
        truncated = true
    }
    func noteSemanticReadFailure(_ field: CandidateSemanticField, error: AXError) {
        semanticReadErrors[field.rawValue] += 1
        noteRequiredReadFailure(error)
    }
}

// Visit the approved window's shallow branches before large nested lists. The
// original child indices remain absolute AX paths used by final action checks.
// Bound total scheduled nodes as well as visited nodes so wide trees cannot
// retain an unbounded queue of cross-process AX references.
private struct CandidateScanEntry<Node> {
    let element: Node
    let path: [Int]
    let nativeContext: Bool
}

func scanCandidatesBreadthFirst<Node>(_ element: Node, path: [Int], budget: ScanBudget,
                                     result: inout [Candidate], nativeContext: Bool = true,
                                     readRole: (Node) -> String?,
                                     allowBranch: (Node, String?) -> Bool = { _, _ in true },
                                     readCandidate: (Node, [Int], Bool, String?) -> Candidate?,
                                     readChildren: (Node) -> [Node]?) {
    guard budget.ready(), budget.nodes < 2048 else { budget.truncated = true; return }
    let maximumScheduled = 2048 - budget.nodes
    var pending: [CandidateScanEntry<Node>?] = [CandidateScanEntry(element: element, path: path, nativeContext: nativeContext)]
    var head = 0
    while head < pending.count {
        guard budget.ready(), budget.nodes < 2048 else { budget.truncated = true; return }
        guard let entry = pending[head] else { preconditionFailure("Missing pending candidate node") }
        pending[head] = nil
        head += 1
        budget.nodes += 1
        budget.maxDepth = max(budget.maxDepth, entry.path.count)
        let role = readRole(entry.element)
        guard allowBranch(entry.element, role) else { budget.truncated = true; continue }
        if !entry.path.isEmpty && (role == kAXWindowRole || role == kAXApplicationRole) {
            budget.truncated = true
            continue
        }
        let context = nativeTextContext(entry.nativeContext, role: role, root: entry.path.isEmpty)
        if let candidate = readCandidate(entry.element, entry.path, context, role) {
            guard budget.candidates < 128 else { budget.truncated = true; continue }
            guard budget.reserveText(candidate.textBytes) else { continue }
            budget.candidates += 1
            result.append(candidate)
        }
        guard let children = readChildren(entry.element) else { continue }
        if children.count > 64 { budget.childrenLimit = true; budget.truncated = true }
        if entry.path.count >= maximumAXPathDepth {
            if !children.isEmpty { budget.depthLimit = true; budget.truncated = true }
            continue
        }
        for (index, child) in children.prefix(64).enumerated() {
            guard budget.ready() else { return }
            guard pending.count < maximumScheduled else { budget.truncated = true; break }
            pending.append(CandidateScanEntry(element: child, path: entry.path + [index], nativeContext: context))
        }
    }
}

func axAttribute(_ element: AXUIElement, _ name: String, budget: ScanBudget? = nil) -> (AXError, CFTypeRef?) {
    if let budget = budget, !budget.ready() { return (.cannotComplete, nil) }
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    budget?.note(error)
    return (error, value)
}

func axCandidateAttributeNames(_ element: AXUIElement, budget: ScanBudget? = nil) -> Set<String>? {
    if let budget = budget, !budget.ready() { return nil }
    var raw: CFArray?
    let error = AXUIElementCopyAttributeNames(element, &raw)
    guard error == .success else {
        budget?.attributeNamesReadErrors += 1
        budget?.noteRequiredReadFailure(error)
        return nil
    }
    guard let names = candidateAttributeNames(raw, budget: budget) else {
        budget?.attributeNamesInvalid += 1
        budget?.truncated = true
        return nil
    }
    return names
}

func axRect(_ element: AXUIElement, budget: ScanBudget? = nil,
            diagnostic: NativeCandidateDiagnostic? = nil) -> Rect? {
    let geometryDiagnostic = diagnostic ?? NativeCandidateDiagnostic(role: nil)
    defer { if diagnostic == nil { emitCandidateDiagnostic(geometryDiagnostic, budget: budget) } }
    let (positionError, position) = axAttribute(element, kAXPositionAttribute, budget: budget)
    let (sizeError, size) = axAttribute(element, kAXSizeAttribute, budget: budget)
    if positionError != .success { geometryDiagnostic?.reject(.position, error: positionError) }
    else if sizeError != .success { geometryDiagnostic?.reject(.size, error: sizeError) }
    return candidateGeometry(positionError, position, sizeError, size, budget: budget) { position, size in
        guard CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
        return Rect(x: point.x, y: point.y, width: dimensions.width, height: dimensions.height)
    }
}

func axElements(_ element: AXUIElement, attribute: String, limit: Int, requireComplete: Bool = false, budget: ScanBudget? = nil) -> [AXUIElement]? {
    if let budget = budget, !budget.ready() { return nil }
    var count = 0
    let error = AXUIElementGetAttributeValueCount(element, attribute as CFString, &count)
    if error == .attributeUnsupported || error == .noValue { return [] }
    budget?.note(error)
    guard error == .success else { return nil }
    guard count >= 0 else { budget?.truncated = true; return nil }
    if attribute == kAXChildrenAttribute, let budget = budget { budget.maxChildren = max(budget.maxChildren, count) }
    if count > limit {
        budget?.truncated = true
        if attribute == kAXChildrenAttribute { budget?.childrenLimit = true }
        if requireComplete { return nil }
    }
    guard count > 0 else { return [] }
    if let budget = budget, !budget.ready() { return nil }
    var values: CFArray?
    let copyError = AXUIElementCopyAttributeValues(element, attribute as CFString, 0, min(count, limit), &values)
    budget?.note(copyError)
    if copyError != .success {
        let diagnostic = NativeCandidateDiagnostic(role: nil)
        diagnostic?.reject(attribute == kAXWindowsAttribute ? .windowsCopy : .childrenCopy, error: copyError)
        emitCandidateDiagnostic(diagnostic, budget: budget)
    }
    return copiedPrefixElements(copyError, values, expectedCount: min(count, limit), budget: budget) { (value: AXUIElement) in
        CFGetTypeID(value) == AXUIElementGetTypeID()
    }
}

func axWindow(_ window: WindowIdentity, budget: ScanBudget? = nil) -> AXUIElement? {
    let app = AXUIElementCreateApplication(window.pid)
    // More than 32 windows cannot establish uniqueness with a bounded read.
    var count = 0
    if let budget = budget, !budget.ready() { return nil }
    let error = AXUIElementGetAttributeValueCount(app, kAXWindowsAttribute as CFString, &count)
    budget?.note(error)
    guard error == .success, count >= 0, count <= 32 else { if count > 32 { budget?.truncated = true }; return nil }
    guard let windows = axElements(app, attribute: kAXWindowsAttribute, limit: 32, requireComplete: true, budget: budget) else { return nil }
    let matching = windows.filter { element in
        var pid: pid_t = 0
        return AXUIElementGetPid(element, &pid) == .success && pid == window.pid
            && axRect(element, budget: budget).map { window.bounds.matchesAX($0) } == true
    }
    return matching.count == 1 ? matching[0] : nil
}

func candidateInfo(_ element: AXUIElement, path: [Int], window: WindowIdentity, budget: ScanBudget? = nil,
                   nativeContext: Bool = false, knownRole: String? = nil,
                   requiredProfile: CandidateIdentityProfile? = nil, root: AXUIElement? = nil) -> Candidate? {
    if let budget = budget, !budget.ready() { return nil }
    var diagnostic = NativeCandidateDiagnostic(role: knownRole)
    diagnostic?.nativeContext = nativeContext
    diagnostic?.scrollButtonProfile = requiredProfile == .nativeScrollButtonV1
    defer { emitCandidateDiagnostic(diagnostic, budget: budget) }
    var pid: pid_t = 0
    let pidError = AXUIElementGetPid(element, &pid)
    guard candidateProcessMatches(pidError, pid, expected: window.pid, budget: budget) else { diagnostic?.reject(.process, error: pidError); return nil }
    var rawActions: CFArray?
    let actionError = AXUIElementCopyActionNames(element, &rawActions)
    guard let actions = candidateActionNames(actionError, rawActions, budget: budget) else { diagnostic?.reject(.actions, error: actionError); return nil }
    let role: String
    if let knownRole = knownRole { role = knownRole }
    else {
        let (error, raw) = axAttribute(element, kAXRoleAttribute, budget: budget)
        guard let value = candidateIdentityText(error, raw, maximumBytes: 64, allowEmpty: false, budget: budget) else {
            diagnostic?.reject(.role, error: error)
            return nil
        }
        role = value
    }
    if knownRole == nil {
        diagnostic = NativeCandidateDiagnostic(role: role)
        diagnostic?.nativeContext = nativeContext
        diagnostic?.scrollButtonProfile = requiredProfile == .nativeScrollButtonV1
    }
    let capabilities = nativeSemanticCapabilities(element, role: role, nativeContext: nativeContext, actions: actions, budget: budget, diagnostic: diagnostic)
    guard !capabilities.operations.isEmpty else { diagnostic?.reject(.operations); return nil }
    let (enabledError, enabled) = axAttribute(element, kAXEnabledAttribute, budget: budget)
    probeNativeScrollbarChild(element, role: role, nativeContext: nativeContext, enabledError: enabledError,
                             enabledRaw: enabled, actions: actions, window: window, root: root, budget: budget)
    if nativeScrollButtonEligible(role: role, nativeContext: nativeContext, actions: actions,
                                  enabledError: enabledError, enabledRaw: enabled, hasRoot: root != nil), let root = root {
        guard requiredProfile == nil || requiredProfile == .nativeScrollButtonV1 else {
            budget?.truncated = true; diagnostic?.reject(.scrollButtonProfile); return nil
        }
        return nativeScrollButtonCandidate(element, path: path, window: window, root: root,
                                           enabledError: enabledError, budget: budget, diagnostic: diagnostic)
    }
    if requiredProfile == .nativeScrollButtonV1 {
        budget?.truncated = true; diagnostic?.reject(.scrollButtonProfile, error: enabledError); return nil
    }
    guard let availability = candidateEnabledCapabilities(enabledError, enabled, role: role,
                                                          operations: capabilities.operations, budget: budget) else { diagnostic?.reject(.enabled, error: enabledError); return nil }
    diagnostic?.enabledConfirmed = true
    diagnostic?.enabledAbsent = availability.enabledState == .absent
    let (titleError, rawTitle) = axAttribute(element, kAXTitleAttribute, budget: budget)
    guard let title = candidateIdentityText(titleError, rawTitle, maximumBytes: 256, allowMissing: true, budget: budget) else { diagnostic?.reject(.title, error: titleError); return nil }
    guard let rawBounds = axRect(element, budget: budget, diagnostic: diagnostic) else { diagnostic?.reject(.bounds); return nil }
    diagnostic?.boundsInsideWindow = window.bounds.contains(rawBounds)
    diagnostic?.boundsOverlapWindow = window.bounds.intersection(rawBounds) != nil
    diagnostic?.boundsExceedWindowHeight = rawBounds.height > window.bounds.height
    diagnostic?.boundsExceedWindowWidth = rawBounds.width > window.bounds.width
    guard let attributes = axCandidateAttributeNames(element, budget: budget) else { diagnostic?.reject(.attributes); return nil }
    diagnostic?.descriptionKnown = true
    diagnostic?.descriptionDeclared = attributes.contains(kAXDescriptionAttribute)
    diagnostic?.identifierDeclared = attributes.contains(kAXIdentifierAttribute)
    let profile = selectedCandidateIdentityProfile(role: role, title: title, nativeContext: nativeContext,
        operations: availability.operations, textState: capabilities.textState, attributes: attributes)
    diagnostic?.textIdentityProfile = profile == .nativeTextIdentifierV1
    guard let identity = candidateIdentityFields(profile: profile, requiredProfile: requiredProfile,
        attributes: attributes, budget: budget, read: { attribute in
        let result = axAttribute(element, attribute, budget: budget)
        if attribute == kAXIdentifierAttribute {
            diagnostic?.identifierReadable = result.0 == .success && result.1 is String
            diagnostic?.identifierNonEmpty = (result.1 as? String).map { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? false
            if profile != nil && (result.0 != .success || diagnostic?.identifierNonEmpty != true) {
                diagnostic?.reject(.identifier, error: result.0)
            }
        }
        let absence = result.0 == .noValue || (attribute == kAXDescriptionAttribute && result.0 == .attributeUnsupported)
        if !absence && (result.0 != .success || !(result.1 is String)) {
            diagnostic?.reject(attribute == kAXDescriptionAttribute ? .description : .identifier, error: result.0)
        }
        return result
    }) else { diagnostic?.reject(profile != nil || requiredProfile != nil ? .identifier : .description); return nil }
    let bounds: Rect
    var documentBounds: Rect?
    if window.bounds.contains(rawBounds) {
        bounds = rawBounds
    } else {
        guard nativeContext, profile == .nativeTextIdentifierV1, let root = root,
              let viewport = nativeTextViewport(element, root: root, window: window, equal: { CFEqual($0, $1) }, readParent: { child in
                  let (parentError, rawParent) = axAttribute(child, kAXParentAttribute, budget: budget)
                  guard parentError == .success, let rawParent = rawParent,
                        CFGetTypeID(rawParent) == AXUIElementGetTypeID() else {
                      if parentError != .success { budget?.noteRequiredReadFailure(parentError) }
                      diagnostic?.reject(.textViewport, error: parentError)
                      return nil
                  }
                  let parent = rawParent as! AXUIElement
                  var parentPID: pid_t = 0
                  let pidError = AXUIElementGetPid(parent, &parentPID)
                  guard candidateProcessMatches(pidError, parentPID, expected: window.pid, budget: budget) else { return nil }
                  let (roleError, rawRole) = axAttribute(parent, kAXRoleAttribute, budget: budget)
                  guard let parentRole = candidateIdentityText(roleError, rawRole, maximumBytes: 64, allowEmpty: false, budget: budget) else { return nil }
                  let parentBounds = parentRole == kAXScrollAreaRole || parentRole == kAXWindowRole ? axRect(parent, budget: budget) : nil
                  return NativeTextAncestor(element: parent, role: parentRole, pid: parentPID, bounds: parentBounds)
              }),
              let visible = clippedNativeTextBounds(document: rawBounds, window: window.bounds, viewport: viewport, profile: profile) else {
            budget?.truncated = true
            diagnostic?.reject(.bounds)
            return nil
        }
        bounds = visible
        documentBounds = rawBounds
        diagnostic?.textViewportConfirmed = true
    }
    diagnostic?.accepted = true
    let semantics = identity.semantics
    return Candidate(path: path, role: role, title: title,
                     description: semantics[kAXDescriptionAttribute], subrole: semantics[kAXSubroleAttribute],
                     identifier: semantics[kAXIdentifierAttribute], bounds: bounds,
                     operations: availability.operations, textState: capabilities.textState, orientation: capabilities.orientation,
                     enabledState: availability.enabledState, scrollState: capabilities.scrollState,
                     identityProfile: identity.profile, descriptionDeclared: identity.descriptionDeclared, documentBounds: documentBounds)
}

func scanCandidates(_ element: AXUIElement, path: [Int], window: WindowIdentity, budget: ScanBudget,
                    result: inout [Candidate], nativeContext: Bool = true, root: AXUIElement? = nil, scoped: Bool = false) {
    let approvedRoot = root ?? element
    scanCandidatesBreadthFirst(element, path: path, budget: budget, result: &result, nativeContext: nativeContext,
        readRole: { node in
            let (roleError, rawRole) = axAttribute(node, kAXRoleAttribute, budget: budget)
            let role = candidateIdentityText(roleError, rawRole, maximumBytes: 64, allowEmpty: false, budget: budget)
            if roleError != .success {
                let diagnostic = NativeCandidateDiagnostic(role: nil)
                diagnostic?.reject(.role, error: roleError)
                emitCandidateDiagnostic(diagnostic, budget: budget)
            }
            return role
        },
        allowBranch: { node, role in
            guard scoped else { return true }
            guard let role = role else { return false }
            if role != kAXTextFieldRole { return safeScopedObservationRole(role) }
            let (error, raw) = axAttribute(node, kAXSubroleAttribute, budget: budget)
            guard let subrole = candidateIdentityText(error, raw, maximumBytes: 64, allowEmpty: false, budget: budget) else { return false }
            return safeScopedObservationRole(role, textFieldSubrole: subrole)
        },
        readCandidate: { node, nodePath, context, role in
            candidateInfo(node, path: nodePath, window: window, budget: budget,
                          nativeContext: context, knownRole: role, root: approvedRoot)
        },
        readChildren: { node in axElements(node, attribute: kAXChildrenAttribute, limit: 64, budget: budget) })
}

// The readable tree is independent of click candidates and cannot consume their
// text budget or change their completeness/dispatch decisions.
final class AXTreeBudget {
    private let deadline: UInt64
    private let maximumEncodedBytes: Int
    private let marker: String
    private var parts: [String] = []
    private var textBytes = 0
    private var encodedBytes = 0
    private var stopped = false
    var nodes = 0
    var truncated = false

    init(scanDeadline: UInt64, maximumEncodedBytes: Int) {
        deadline = min(DispatchTime.now().uptimeNanoseconds + 1_000_000_000, scanDeadline + 600_000_000)
        self.maximumEncodedBytes = max(0, maximumEncodedBytes)
        let notice = "[AX tree truncated]\n"
        marker = Self.encodedSize(notice) <= self.maximumEncodedBytes ? notice : ""
        if maximumEncodedBytes <= 0 { truncated = true; stopped = true }
    }

    private static func encodedSize(_ text: String) -> Int {
        (try? JSONSerialization.data(withJSONObject: text, options: [.fragmentsAllowed]).count - 2) ?? Int.max
    }

    func ready() -> Bool {
        if stopped { return false }
        if DispatchTime.now().uptimeNanoseconds >= deadline { truncated = true; stopped = true; return false }
        return true
    }

    func note(_ error: AXError) {
        if error != .success && error != .attributeUnsupported && error != .noValue && error != .actionUnsupported { truncated = true }
    }

    func field(_ text: String) -> String {
        var value = ""
        var count = 0
        var inspected = 0
        for scalar in text.unicodeScalars {
            guard inspected < 1024 else { truncated = true; break }
            if inspected % 32 == 0 && !ready() { break }
            inspected += 1
            let code = scalar.value
            if (code < 32 && code != 9 && code != 10 && code != 13) || (code >= 127 && code <= 159)
                || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) { continue }
            let piece = [9, 10, 13].contains(code) ? " " : String(scalar)
            guard count < 200, value.utf8.count + piece.utf8.count <= 256 else { truncated = true; break }
            value += piece
            count += 1
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func quoted(_ text: String) -> String {
        let value = field(text)
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let quoted = String(data: data, encoding: .utf8) else { truncated = true; return "\"\"" }
        return quoted
    }

    func append(_ line: String) {
        let part = line + "\n"
        let encoded = Self.encodedSize(part)
        guard textBytes + part.utf8.count <= 12 * 1024 - marker.utf8.count,
              encoded <= maximumEncodedBytes - Self.encodedSize(marker) - encodedBytes else {
            truncated = true; stopped = true; return
        }
        parts.append(part)
        textBytes += part.utf8.count
        encodedBytes += encoded
    }

    var text: String { parts.joined() + (truncated ? marker : "") }
}

func treeAttribute(_ element: AXUIElement, _ name: String, budget: AXTreeBudget) -> CFTypeRef? {
    guard budget.ready() else { return nil }
    let (error, value) = axAttribute(element, name)
    budget.note(error)
    return error == .success ? value : nil
}

func treeChildren(_ element: AXUIElement, budget: AXTreeBudget) -> [AXUIElement] {
    guard budget.ready() else { return [] }
    var count = 0
    let error = AXUIElementGetAttributeValueCount(element, kAXChildrenAttribute as CFString, &count)
    budget.note(error)
    if error == .attributeUnsupported || error == .noValue { return [] }
    guard error == .success, count >= 0 else { budget.truncated = true; return [] }
    if count > 64 { budget.truncated = true }
    guard count > 0, budget.ready() else { return [] }
    var values: CFArray?
    let copyError = AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, 0, min(count, 64), &values)
    budget.note(copyError)
    guard copyError == .success, let values = values, let children = values as? [AXUIElement],
          children.count == min(count, 64), children.allSatisfy({ CFGetTypeID($0) == AXUIElementGetTypeID() }) else {
        budget.truncated = true; return []
    }
    return children
}

func scanAXTree(_ element: AXUIElement, depth: Int, window: WindowIdentity, budget: AXTreeBudget,
                pathDepth: Int? = nil, scoped: Bool = false) {
    guard budget.ready(), budget.nodes < 2048 else { budget.truncated = true; return }
    budget.nodes += 1
    var pid: pid_t = 0
    guard AXUIElementGetPid(element, &pid) == .success, pid == window.pid,
          let rawRole = treeAttribute(element, kAXRoleAttribute, budget: budget) as? String else {
        budget.truncated = true; return
    }
    // Descendants from a different AX window/application are outside this grant.
    if depth > 0 && (rawRole == kAXWindowRole || rawRole == kAXApplicationRole) { budget.truncated = true; return }
    if scoped {
        // Local traversal must not use a safe region root to bypass a sensitive
        // descendant's ancestry. Full-window legacy summary behavior is unchanged.
        let subrole = rawRole == kAXTextFieldRole ? treeAttribute(element, kAXSubroleAttribute, budget: budget) as? String : nil
        guard safeScopedObservationRole(rawRole, textFieldSubrole: subrole) else { budget.truncated = true; return }
    }
    var fields = [budget.field(rawRole)]
    for (attribute, label) in [(kAXTitleAttribute, "title"), (kAXDescriptionAttribute, "description")] {
        if let value = treeAttribute(element, attribute, budget: budget) as? String, !value.isEmpty { fields.append(label + "=" + budget.quoted(value)) }
    }
    if let enabled = treeAttribute(element, kAXEnabledAttribute, budget: budget), CFGetTypeID(enabled) == CFBooleanGetTypeID() {
        fields.append("enabled=" + (CFEqual(enabled, kCFBooleanTrue) ? "true" : "false"))
    }
    var mayReadValue = !rawRole.contains("Secure")
    if rawRole == kAXTextFieldRole {
        // An absent/unknown subrole must not expose a potentially secure value.
        let allowed = scoped ? scopedReadableTextFieldSubroles : readableTextFieldSubroles
        mayReadValue = (treeAttribute(element, kAXSubroleAttribute, budget: budget) as? String).map { allowed.contains($0) } ?? false
    }
    if mayReadValue, let value = treeAttribute(element, kAXValueAttribute, budget: budget) {
        if let value = value as? String, !value.isEmpty { fields.append("value=" + budget.quoted(value)) }
        else if CFGetTypeID(value) == CFBooleanGetTypeID() { fields.append("value=" + (CFEqual(value, kCFBooleanTrue) ? "true" : "false")) }
        else if let number = value as? NSNumber { fields.append("value=" + budget.quoted(number.stringValue)) }
    }
    if budget.ready() {
        var actions: CFArray?
        let error = AXUIElementCopyActionNames(element, &actions)
        budget.note(error)
        if error == .success {
            if let names = actions as? [String] {
                if names.count > 8 { budget.truncated = true }
                if !names.isEmpty { fields.append("actions=[" + names.prefix(8).map { budget.quoted($0) }.joined(separator: ", ") + "]") }
            } else { budget.truncated = true }
        }
    }
    budget.append(String(repeating: "  ", count: depth) + fields.joined(separator: " "))
    let children = treeChildren(element, budget: budget)
    let absoluteDepth = pathDepth ?? depth
    if absoluteDepth >= maximumAXPathDepth { if !children.isEmpty { budget.truncated = true }; return }
    for child in children {
        if !budget.ready() { break }
        scanAXTree(child, depth: depth + 1, window: window, budget: budget, pathDepth: absoluteDepth + 1, scoped: scoped)
    }
}

func cgWindows(display: Rect? = nil, budget: ScanBudget? = nil) throws -> [WindowIdentity] {
    guard let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        throw HelperError(code: "window_unavailable", message: "Cannot observe onscreen windows.")
    }
    var windows: [WindowIdentity] = []
    for item in raw {
        guard let layer = item[kCGWindowLayer as String] as? Int, layer >= 0 else { continue }
        if let alpha = item[kCGWindowAlpha as String] as? Double, alpha <= 0 { continue }
        guard let dictionary = item[kCGWindowBounds as String] as? [String: Any], let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary) else { budget?.truncated = true; continue }
        let rect = Rect(x: bounds.origin.x, y: bounds.origin.y, width: bounds.width, height: bounds.height)
        guard rect.valid else { budget?.truncated = true; continue }
        if let display = display, !display.cg.intersects(rect.cg) { continue }
        guard let number = item[kCGWindowNumber as String] as? UInt32, number > 0,
              let owner = item[kCGWindowOwnerPID as String] as? Int32, owner >= 0, layer <= Int32.max else { budget?.truncated = true; continue }
        if windows.count >= 64, display != nil { budget?.truncated = true; break }
        let rawTitle = item[kCGWindowName as String] as? String
        let title = rawTitle.flatMap { $0.utf8.count <= 256 ? $0 : nil }
        if let title = title, let budget = budget, !budget.reserveText(title.utf8.count) { break }
        windows.append(WindowIdentity(windowId: number, pid: owner, processStartedAt: processStart(owner), layer: Int32(layer), bounds: rect, title: title))
    }
    return windows
}

func ambiguousCGWindow(_ window: WindowIdentity, windows: [WindowIdentity]) -> Bool {
    windows.filter { $0.pid == window.pid && $0.layer == 0 && $0.bounds == window.bounds }.count != 1
}

func targets(_ request: TargetsRequest) throws {
    try requireTrust()
    _ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15)
    let budget = ScanBudget()
    let windows = try cgWindows(display: request.displayBounds, budget: budget)
    var targets: [[String: Any]] = []
    for window in windows {
        var candidates: [Candidate] = []
        if window.valid, !ambiguousCGWindow(window, windows: windows), budget.ready(), let element = axWindow(window, budget: budget) {
            scanCandidates(element, path: [], window: window, budget: budget, result: &candidates)
        }
        var value = window.json
        value["candidates"] = candidates.map { $0.json }
        targets.append(value)
    }
    emit(["ok": true, "targets": targets, "truncated": budget.truncated])
}

func revalidateWindow(_ expected: WindowIdentity, requireUniqueAXWindow: Bool = true) throws {
    guard processStart(expected.pid) == expected.processStartedAt else { throw HelperError(code: "target_changed", message: "The target process identity changed.") }
    let windows = try cgWindows()
    guard let actual = windows.first(where: { $0.windowId == expected.windowId }), actual.pid == expected.pid,
          actual.layer == expected.layer, actual.bounds == expected.bounds, actual.title == expected.title,
          actual.processStartedAt == expected.processStartedAt, (!requireUniqueAXWindow || !ambiguousCGWindow(actual, windows: windows)) else {
        throw HelperError(code: "target_changed", message: "The target window identity changed.")
    }
}

func label(_ text: String, fallback: String) -> String {
    var result = ""
    var count = 0
    for scalar in text.unicodeScalars {
        let code = scalar.value
        if code < 32 || (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) { continue }
        let value = String(scalar)
        if count >= 200 || result.utf8.count + value.utf8.count > 256 { break }
        result += value
        count += 1
    }
    result = result.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{FEFF}")))
    return result.isEmpty ? fallback : result
}

func sharedWindows() throws {
    // CG/NSRunningApplication metadata only: no screen image or AX application query.
    let windows = try cgWindows().filter { $0.valid }
    var result: [[String: Any]] = []
    var textBytes = 0
    var truncated = false
    for window in windows {
        guard result.count < 64 else { truncated = true; break }
        let applicationLabel = label(NSRunningApplication(processIdentifier: window.pid)?.localizedName ?? "", fallback: "Application \(window.pid)")
        let windowLabel = label(window.title ?? "", fallback: "Window \(window.windowId)")
        let bytes = applicationLabel.utf8.count + windowLabel.utf8.count + (window.title?.utf8.count ?? 0)
        guard textBytes + bytes <= 12 * 1024 else { truncated = true; break }
        textBytes += bytes
        var value = window.json
        value["applicationLabel"] = applicationLabel
        value["windowLabel"] = windowLabel
        result.append(value)
    }
    emit(["ok": true, "windows": result, "truncated": truncated])
}

let windowScanLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "window-targets")

func nativeObservationScope(_ root: AXUIElement, scope: ObservationScope, window: WindowIdentity,
                            budget: ScanBudget) -> ResolvedObservationScope<AXUIElement>? {
    resolveObservationScope(root, path: scope.anchor.path, ancestorLevels: scope.ancestorLevels, pid: window.pid,
        budget: budget, equal: { CFEqual($0, $1) }, readIdentity: { node in
            guard budget.ready() else { return nil }
            var pid: pid_t = 0
            let pidError = AXUIElementGetPid(node, &pid)
            guard candidateProcessMatches(pidError, pid, expected: window.pid, budget: budget) else { return nil }
            let (roleError, rawRole) = axAttribute(node, kAXRoleAttribute, budget: budget)
            guard let role = candidateIdentityText(roleError, rawRole, maximumBytes: 64, allowEmpty: false, budget: budget) else { return nil }
            var secureTextField = false
            if role == kAXTextFieldRole {
                let (error, raw) = axAttribute(node, kAXSubroleAttribute, budget: budget)
                guard error == .success, let subrole = candidateIdentityText(error, raw, maximumBytes: 64, allowEmpty: false, budget: budget) else {
                    if error != .success { budget.noteRequiredReadFailure(error) } else { budget.truncated = true }
                    return nil
                }
                secureTextField = subrole.contains("Secure")
                // Unknown text-field classification cannot prove its descendant
                // values safe for local summarization. No whole-window fallback.
                guard secureTextField || safeScopedObservationRole(role, textFieldSubrole: subrole) else { return nil }
            }
            return ObservationScopeNodeIdentity(pid: pid, role: role, secureTextField: secureTextField)
        }, readParent: { node in
            let (error, raw) = axAttribute(node, kAXParentAttribute, budget: budget)
            guard error == .success, let raw = raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else {
                if error != .success { budget.noteRequiredReadFailure(error) } else { budget.truncated = true }
                return nil
            }
            return (raw as! AXUIElement)
        }, readChildren: { parent, prefixCount in
            axElements(parent, attribute: kAXChildrenAttribute, limit: prefixCount, requireComplete: false, budget: budget)
        }, validateAnchor: { node, context in
            guard let current = candidateInfo(node, path: scope.anchor.path, window: window, budget: budget,
                                              nativeContext: context, requiredProfile: scope.anchor.identityProfile, root: root) else { return false }
            return sameObservationScopeAnchor(current, scope.anchor)
        })
}

func windowTargets(_ request: WindowRequest) throws {
    try requireTrust()
    _ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15)
    let window = request.window
    try revalidateWindow(window, requireUniqueAXWindow: request.scope != nil)
    let budget = ScanBudget()
    var axWindowMatched = false
    defer {
        // Numeric scan diagnostics only; never log target identity or UI content.
        windowScanLogger.notice("scan nodes=\(budget.nodes, privacy: .public) candidates=\(budget.candidates, privacy: .public) textBytes=\(budget.textBytes, privacy: .public) truncated=\(budget.truncated, privacy: .public) firstAXError=\(budget.firstAXErrorCode ?? 0, privacy: .public) axWindowMatched=\(axWindowMatched, privacy: .public) maxDepth=\(budget.maxDepth, privacy: .public) maxChildren=\(budget.maxChildren, privacy: .public) depthLimit=\(budget.depthLimit, privacy: .public) childrenLimit=\(budget.childrenLimit, privacy: .public)")
        windowScanLogger.notice("optional namesReadErrors=\(budget.attributeNamesReadErrors, privacy: .public) namesInvalid=\(budget.attributeNamesInvalid, privacy: .public) descriptionMissing=\(budget.semanticMissing[0], privacy: .public) descriptionReadErrors=\(budget.semanticReadErrors[0], privacy: .public) descriptionInvalid=\(budget.semanticInvalid[0], privacy: .public) subroleMissing=\(budget.semanticMissing[1], privacy: .public) subroleReadErrors=\(budget.semanticReadErrors[1], privacy: .public) subroleInvalid=\(budget.semanticInvalid[1], privacy: .public) identifierMissing=\(budget.semanticMissing[2], privacy: .public) identifierReadErrors=\(budget.semanticReadErrors[2], privacy: .public) identifierInvalid=\(budget.semanticInvalid[2], privacy: .public)")
    }
    if let title = window.title { _ = budget.reserveText(title.utf8.count) }
    var candidates: [Candidate] = []
    // Only the approved window's tree is traversed. Other applications' z-order
    // does not occlude a desktop-independent window screenshot or its AX actions.
    let windows = try cgWindows()
    var matchedWindow: AXUIElement?
    var scopePath: [Int]?
    if !ambiguousCGWindow(window, windows: windows), let element = axWindow(window, budget: budget) {
        axWindowMatched = true
        if let scope = request.scope {
            guard let region = nativeObservationScope(element, scope: scope, window: window, budget: budget) else {
                throw HelperError(code: "target_changed", message: "The observation anchor or scope changed.")
            }
            scanCandidates(region.element, path: region.path, window: window, budget: budget, result: &candidates,
                           nativeContext: region.nativeContext, root: element, scoped: true)
            matchedWindow = region.element
            scopePath = region.path
        } else {
            scanCandidates(element, path: [], window: window, budget: budget, result: &candidates)
            matchedWindow = element
        }
    } else if request.scope != nil {
        throw HelperError(code: "target_changed", message: "Cannot resolve the approved observation scope window.")
    }
    var receipt = try boundedWindowTargetReceipt(window: window, candidates: candidates,
                                                truncated: budget.truncated, scopePath: scopePath)
    if receipt["truncated"] as? Bool == true { budget.truncated = true }
    let size = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]).count
    let tree = AXTreeBudget(scanDeadline: budget.deadline,
                            maximumEncodedBytes: maximumAXObservationOutputBytes - 1 - size)
    if let element = matchedWindow {
        scanAXTree(element, depth: 0, window: window, budget: tree, pathDepth: scopePath?.count ?? 0, scoped: request.scope != nil)
    }
    else { tree.truncated = true }
    receipt["axTree"] = tree.text
    receipt["axTreeTruncated"] = tree.truncated
    try revalidateWindow(window, requireUniqueAXWindow: request.scope != nil)
    emit(receipt)
}

func waitForValue<T>(seconds: Double, _ start: (@escaping (Result<T, HelperError>) -> Void) -> Void) throws -> T {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<T, HelperError>?
    start { value in result = value; semaphore.signal() }
    let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(seconds * 1_000_000_000)
    while semaphore.wait(timeout: .now() + .milliseconds(10)) != .success {
        guard DispatchTime.now().uptimeNanoseconds < deadline else { throw HelperError(code: "window_capture_timeout", message: "The approved window screenshot timed out.") }
        // Service callbacks without activating an application or creating a window.
        _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.001))
    }
    guard let result = result else { throw HelperError(code: "window_capture_failed", message: "Missing screenshot callback.") }
    return try result.get()
}

@available(macOS 14.0, *)
func captureWindowImage(_ expected: WindowIdentity) throws -> CGImage {
    let content: SCShareableContent = try waitForValue(seconds: 4) { complete in
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
            guard error == nil, let content = content else {
                complete(.failure(HelperError(code: "window_capture_failed", message: "Cannot resolve the approved capture window.")))
                return
            }
            complete(.success(content))
        }
    }
    let matching = content.windows.filter { $0.windowID == expected.windowId }
    guard matching.count == 1, let selected = matching.first, selected.owningApplication?.processID == expected.pid,
          selected.windowLayer == expected.layer, selected.isOnScreen,
          Rect(x: selected.frame.origin.x, y: selected.frame.origin.y, width: selected.frame.width, height: selected.frame.height) == expected.bounds else {
        throw HelperError(code: "target_changed", message: "The approved ScreenCaptureKit window identity changed.")
    }
    try revalidateWindow(expected, requireUniqueAXWindow: false)
    let filter = SCContentFilter(desktopIndependentWindow: selected)
    // Independent windows default to their entire surface, with no display crop.
    guard abs(filter.contentRect.width - expected.bounds.width) <= 0.5,
          abs(filter.contentRect.height - expected.bounds.height) <= 0.5,
          filter.pointPixelScale.isFinite, filter.pointPixelScale > 0 else {
        throw HelperError(code: "window_capture_failed", message: "Cannot map the full approved window surface.")
    }
    let scale = min(Double(filter.pointPixelScale), 2048 / max(expected.bounds.width, expected.bounds.height))
    let configuration = SCStreamConfiguration()
    configuration.width = max(1, Int((expected.bounds.width * scale).rounded()))
    configuration.height = max(1, Int((expected.bounds.height * scale).rounded()))
    configuration.scalesToFit = true
    configuration.showsCursor = false
    configuration.capturesAudio = false
    configuration.ignoreShadowsSingleWindow = true
    configuration.ignoreGlobalClipSingleWindow = true
    if #available(macOS 14.2, *) { configuration.includeChildWindows = false }
    return try waitForValue(seconds: 8) { complete in
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
            guard error == nil, let image = image, image.width == configuration.width, image.height == configuration.height else {
                complete(.failure(HelperError(code: "window_capture_failed", message: "Cannot capture the full approved window surface.")))
                return
            }
            complete(.success(image))
        }
    }
}

func windowCapture(_ request: WindowRequest) throws {
    guard #available(macOS 14.0, *) else {
        throw HelperError(code: "window_capture_unavailable", message: "Independent window screenshots require macOS 14 or later.")
    }
    guard CGPreflightScreenCaptureAccess() else {
        throw HelperError(code: "screen_permission_denied", message: "Allow OmniFlow in macOS Screen Recording settings.", exitCode: 77)
    }
    let window = request.window
    try revalidateWindow(window, requireUniqueAXWindow: false)
    let image = try captureWindowImage(window)
    try revalidateWindow(window, requireUniqueAXWindow: false)
    guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]), png.count <= 8 * 1024 * 1024 else {
        throw HelperError(code: "window_capture_failed", message: "The approved screenshot exceeds the PNG budget.")
    }
    emit(["ok": true, "window": window.json, "pngBase64": png.base64EncodedString(), "width": image.width, "height": image.height], maximumBytes: 12 * 1024 * 1024)
}

let clickLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "click")

func click(_ request: ClickRequest) throws {
    // Reject unsupported gestures before checking permissions or querying any UI.
    guard request.button == "left", request.clickCount == 1 else {
        throw HelperError(code: "unsupported_action", message: "Only one left AXPress action is supported.", exitCode: 64)
    }
    try requireTrust()
    _ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15)
    let expected = request.target.window
    try revalidateWindow(expected)
    guard let root = axWindow(expected) else { throw HelperError(code: "target_changed", message: "The public AX window match is not unique.") }
    guard let element = resolveCandidatePath(root, path: request.target.candidate.path, readChildren: { parent, prefixCount in
        axElements(parent, attribute: kAXChildrenAttribute, limit: prefixCount, requireComplete: false)
    }) else { throw HelperError(code: "target_changed", message: "The AX element path changed.") }
    guard let current = candidateInfo(element, path: request.target.candidate.path, window: expected),
          current.effectiveOperations.contains(.press),
          current.role == request.target.candidate.role, current.title == request.target.candidate.title,
          current.matchesSemanticFields(of: request.target.candidate),
          current.bounds == request.target.candidate.bounds, current.bounds.contains(x: request.x, y: request.y) else {
        throw HelperError(code: "target_changed", message: "The AX element identity or action changed.")
    }
    try revalidateWindow(expected)
    _ = AXUIElementSetMessagingTimeout(element, 0.75)
    let frontmostBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let pointerBefore = NSEvent.mouseLocation
    let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
    let pointerAfter = NSEvent.mouseLocation
    let frontmostAfter = NSWorkspace.shared.frontmostApplication?.processIdentifier
    // Endpoint observations do not attribute concurrent user/App changes to this
    // AXPress. Log only comparisons, never foreground PIDs or pointer positions.
    clickLogger.notice("press axError=\(result.rawValue, privacy: .public) frontmostKnownBefore=\(frontmostBefore != nil, privacy: .public) frontmostKnownAfter=\(frontmostAfter != nil, privacy: .public) targetFrontmostBefore=\(frontmostBefore == expected.pid, privacy: .public) targetFrontmostAfter=\(frontmostAfter == expected.pid, privacy: .public) frontmostChanged=\(frontmostBefore != frontmostAfter, privacy: .public) pointerMoved=\(pointerBefore != pointerAfter, privacy: .public)")
    try mutationResult(result)
    emit(["ok": true, "dispatched": true])
}
