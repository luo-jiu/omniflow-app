import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('macOS candidate pure protocol', () => {
  it('checks bounded candidate and path policies without invoking native UI APIs', async () => {
    const source = await readFile(fileURLToPath(new URL('./macos-click.swift', import.meta.url)), 'utf8');
    const pureEnd = source.indexOf('func status()');
    const budgetStart = source.indexOf('final class ScanBudget {');
    const budgetEnd = source.indexOf('func axAttribute(', budgetStart);
    expect(pureEnd).toBeGreaterThan(0);
    expect(budgetStart).toBeGreaterThan(pureEnd);
    expect(budgetEnd).toBeGreaterThan(budgetStart);
    // Use the actual parser/policy and budget source. The AX/UI entrypoints and
    // helper main are excluded, and all attribute reads below are fake closures.
    const semantic = await readFile(fileURLToPath(new URL('./macos-semantic.swift', import.meta.url)), 'utf8');
    const semanticEnd = semantic.indexOf('func nativeSemanticCapabilities(');
    const treeBudgetStart = source.indexOf('final class AXTreeBudget {');
    const treeBudgetEnd = source.indexOf('func treeAttribute(', treeBudgetStart);
    expect(semanticEnd).toBeGreaterThan(0);
    expect(treeBudgetEnd).toBeGreaterThan(treeBudgetStart);
    const harness = `${semantic.slice(0, semanticEnd)}\n${source.slice(0, pureEnd)}\n${source.slice(budgetStart, budgetEnd)}\n${source.slice(treeBudgetStart, treeBudgetEnd)}\n${String.raw`
var checks = 0
func check(_ value: Bool) {
    checks += 1
    guard value else { fatalError("Pure protocol assertion \(checks) failed") }
}
func names(_ values: [Any]) -> CFArray { values as NSArray as CFArray }
do {
let activityCases: [(Int32, Int32, Int32?, Bool, Bool)] = [
    (123, 123, 123, true, true), (123, 123, 456, true, false),
    (123, 123, nil, false, false), (123, 123, 0, false, false), (123, 123, -1, false, false),
    (1, 1, 1, false, false), (0, 0, 123, false, false), (123, 1, 123, false, false),
    (123, 456, 123, false, false)
]
for (parent, confirmedParent, frontmost, known, active) in activityCases {
    let receipt = parentActivityReceipt(parentPID: parent, confirmedParentPID: confirmedParent, frontmostPID: frontmost)
    check(Set(receipt.keys) == ["ok", "known", "active"])
    check(receipt["ok"] as? Bool == true)
    check(receipt["known"] as? Bool == known)
    check(receipt["active"] as? Bool == active)
}
check(candidateAttributeNames(names([])) == [])
check(candidateAttributeNames(nil) == nil)
check(candidateAttributeNames(names([1])) == nil)
check(candidateAttributeNames(names(Array(repeating: "AXRole", count: 129))) == nil)
check(candidateAttributeNames(names((0..<128).map { "AXFixture\($0)" }))?.count == 128)
check(candidateAttributeNames(names([String(repeating: "a", count: 128)])) != nil)
check(candidateAttributeNames(names([String(repeating: "a", count: 129)])) == nil)
check(candidateAttributeNames(names([String(repeating: "中", count: 43)])) == nil)
check(candidateAttributeNames(names([""])) == nil)
check(candidateAttributeNames(names(["AX\nRole"])) == nil)
check(candidateAttributeNames(names(["AX\u{202e}Role"])) == nil)
check(candidateAttributeNames(names(Array(repeating: String(repeating: "a", count: 128), count: 64))) != nil)
check(candidateAttributeNames(names(Array(repeating: String(repeating: "a", count: 128), count: 64) + ["b"])) == nil)
let expiredNames = ScanBudget(deadline: 0)
check(candidateAttributeNames(names(["AXRole"]), budget: expiredNames) == nil)
check(expiredNames.truncated)
let diagnosticBudget = ScanBudget()
for _ in 0..<32 { check(diagnosticBudget.claimCandidateDiagnostic()) }
for _ in 0..<100 { check(!diagnosticBudget.claimCandidateDiagnostic()) }
check(diagnosticBudget.candidateDiagnostics == 32)
check(!diagnosticBudget.truncated && diagnosticBudget.firstAXErrorCode == nil)
check(diagnosticBudget.nodes == 0 && diagnosticBudget.candidates == 0 && diagnosticBudget.textBytes == 0)
check(diagnosticBudget.reserveText(12 * 1024))
let expiredDiagnostics = ScanBudget(deadline: 0)
check(expiredDiagnostics.claimCandidateDiagnostic())
check(!expiredDiagnostics.truncated)
check(!shouldEmitCandidateDiagnostic(roleKind: 0, stage: 0, axError: 0))
check(!shouldEmitCandidateDiagnostic(roleKind: 0, stage: 12, axError: 0))
check(!shouldEmitCandidateDiagnostic(roleKind: 0, stage: 13, axError: 0))
check(!shouldEmitCandidateDiagnostic(roleKind: 0, stage: 0, axError: AXError.attributeUnsupported.rawValue))
for stage in [1, 2, 13, 19, 20, 21, 22, 23] {
    check(shouldEmitCandidateDiagnostic(roleKind: 0, stage: stage, axError: AXError.attributeUnsupported.rawValue))
}
for role in [1, 2, 3] { check(shouldEmitCandidateDiagnostic(roleKind: role, stage: 0, axError: 0)) }

// These are the production role/title/eligibility/geometry policies. An
// unconfirmed overlapping control must not look like an absent child to a
// coordinate hit-test; only confirmed non-actionable nodes may be omitted.
for pid: Int32 in [-1, 0] {
    let pidBudget = ScanBudget()
    check(!candidateProcessMatches(.success, pid, expected: 123, budget: pidBudget))
    check(pidBudget.truncated && pidBudget.firstAXErrorCode == nil)
}
let failedPid = ScanBudget()
check(!candidateProcessMatches(.failure, 123, expected: 123, budget: failedPid))
check(failedPid.truncated && failedPid.firstAXErrorCode == AXError.failure.rawValue)
let scopedPid = ScanBudget()
check(candidateProcessMatches(.success, 123, expected: 123, budget: scopedPid))
check(!candidateProcessMatches(.success, 456, expected: 123, budget: scopedPid))
check(!scopedPid.truncated)
for maximumBytes in [64, 256] {
    for raw: CFTypeRef? in [nil, NSNumber(value: 1), String(repeating: "a", count: maximumBytes + 1) as NSString,
                           "unsafe\ntext" as NSString, "unsafe\u{202e}text" as NSString] {
        let textBudget = ScanBudget()
        check(candidateIdentityText(.success, raw, maximumBytes: maximumBytes, budget: textBudget) == nil)
        check(textBudget.truncated && textBudget.firstAXErrorCode == nil)
    }
    let textBudget = ScanBudget()
    let boundaryText = String(repeating: "a", count: maximumBytes)
    check(candidateIdentityText(.success, boundaryText as NSString, maximumBytes: maximumBytes, budget: textBudget) == boundaryText)
    check(!textBudget.truncated)
}
let unicodeTitle = ScanBudget()
check(candidateIdentityText(.success, String(repeating: "中", count: 85) as NSString, maximumBytes: 256, budget: unicodeTitle) != nil)
check(!unicodeTitle.truncated)
check(candidateIdentityText(.success, String(repeating: "中", count: 86) as NSString, maximumBytes: 256, budget: unicodeTitle) == nil)
check(unicodeTitle.truncated)
let emptyRole = ScanBudget()
check(candidateIdentityText(.success, "" as NSString, maximumBytes: 64, allowEmpty: false, budget: emptyRole) == nil)
check(emptyRole.truncated)
for error in [AXError.failure, .attributeUnsupported, .noValue] {
    let roleBudget = ScanBudget()
    check(candidateIdentityText(error, nil, maximumBytes: 64, allowEmpty: false, budget: roleBudget) == nil)
    check(roleBudget.truncated && roleBudget.firstAXErrorCode == error.rawValue)
}
for error in [AXError.attributeUnsupported, .noValue] {
    let titleBudget = ScanBudget()
    check(candidateIdentityText(error, nil, maximumBytes: 256, allowMissing: true, budget: titleBudget) == "")
    check(!titleBudget.truncated && titleBudget.firstAXErrorCode == nil)
}
let failedTitle = ScanBudget()
check(candidateIdentityText(.failure, nil, maximumBytes: 256, allowMissing: true, budget: failedTitle) == nil)
check(failedTitle.truncated && failedTitle.firstAXErrorCode == AXError.failure.rawValue)

for raw: CFTypeRef? in [nil, NSNumber(value: 1), "true" as NSString] {
    let enabledBudget = ScanBudget()
    check(candidateEnabled(.success, raw, budget: enabledBudget) == nil)
    check(enabledBudget.truncated && enabledBudget.firstAXErrorCode == nil)
}
for expected in [true, false] {
    let enabledBudget = ScanBudget()
    check(candidateEnabled(.success, expected ? kCFBooleanTrue : kCFBooleanFalse, budget: enabledBudget) == expected)
    check(!enabledBudget.truncated)
}
for error in [AXError.failure, .attributeUnsupported, .noValue] {
    let enabledBudget = ScanBudget()
    check(candidateEnabled(error, nil, budget: enabledBudget) == nil)
    check(enabledBudget.truncated && enabledBudget.firstAXErrorCode == error.rawValue)
}

for raw in [names([]), names([kAXRaiseAction])] {
    let actionBudget = ScanBudget()
    check(candidatePressAction(.success, raw, budget: actionBudget) == false)
    check(!actionBudget.truncated && actionBudget.firstAXErrorCode == nil)
}
let unsupportedAction = ScanBudget()
check(candidatePressAction(.actionUnsupported, nil, budget: unsupportedAction) == false)
check(!unsupportedAction.truncated)
let pressAction = ScanBudget()
check(candidatePressAction(.success, names(Array(repeating: kAXPressAction, count: 32)), budget: pressAction) == true)
check(!pressAction.truncated)
for raw in [nil, names([1]), names([""]), names(["AX\nPress"]), names([String(repeating: "a", count: 65)]),
            names(Array(repeating: kAXPressAction, count: 33))] as [CFArray?] {
    let actionBudget = ScanBudget()
    check(candidatePressAction(.success, raw, budget: actionBudget) == nil)
    check(actionBudget.truncated && actionBudget.firstAXErrorCode == nil)
}
for error in [AXError.failure, .attributeUnsupported, .noValue] {
    let actionBudget = ScanBudget()
    check(candidatePressAction(error, nil, budget: actionBudget) == nil)
    check(actionBudget.truncated && actionBudget.firstAXErrorCode == error.rawValue)
}

let validBounds = Rect(x: 10, y: 20, width: 40, height: 30)
let viewportWindow = WindowIdentity(windowId: 84, pid: 123, processStartedAt: 1000, layer: 0,
    bounds: Rect(x: -700, y: 100, width: 673, height: 439), title: nil)
let viewport = Rect(x: -700, y: 200, width: 660, height: 339)
let longDocument = Rect(x: -700, y: -1000, width: 660, height: 2600)
check(!viewportWindow.bounds.contains(longDocument))
check(clippedNativeTextBounds(document: longDocument, window: viewportWindow.bounds, viewport: viewport, profile: .nativeTextIdentifierV1) == viewport)
check(clippedNativeTextBounds(document: longDocument, window: viewportWindow.bounds, viewport: viewport, profile: nil) == nil)
check(clippedNativeTextBounds(document: longDocument, window: viewportWindow.bounds,
    viewport: Rect(x: -700, y: 200, width: 660, height: 340), profile: .nativeTextIdentifierV1) == nil)
check(clippedNativeTextBounds(document: Rect(x: -700, y: 600, width: 660, height: 2600),
    window: viewportWindow.bounds, viewport: viewport, profile: .nativeTextIdentifierV1) == nil)
check(longDocument.intersection(Rect(x: -40, y: 200, width: 10, height: 10)) == nil)
let viewportParent = NativeTextAncestor(element: 1, role: kAXScrollAreaRole, pid: 123, bounds: viewport)
let viewportRoot = NativeTextAncestor(element: 2, role: kAXWindowRole, pid: 123, bounds: viewportWindow.bounds)
func testViewport(_ ancestors: [Int: NativeTextAncestor<Int>], root: Int = 2) -> Rect? {
    nativeTextViewport(0, root: root, window: viewportWindow, equal: { $0 == $1 }, readParent: { ancestors[$0] })
}
check(testViewport([0: viewportParent, 1: viewportRoot]) == viewport)
check(testViewport([0: NativeTextAncestor(element: 1, role: kAXGroupRole, pid: 123, bounds: viewport), 1: viewportRoot]) == nil)
check(testViewport([0: NativeTextAncestor(element: 1, role: kAXScrollAreaRole, pid: 456, bounds: viewport), 1: viewportRoot]) == nil)
check(testViewport([0: viewportParent, 1: NativeTextAncestor(element: 2, role: kAXWindowRole, pid: 456, bounds: viewportWindow.bounds)]) == nil)
check(testViewport([0: viewportParent, 1: NativeTextAncestor(element: 3, role: kAXWindowRole, pid: 123, bounds: viewportWindow.bounds)]) == nil)
check(testViewport([0: viewportParent, 1: NativeTextAncestor(element: 1, role: kAXScrollAreaRole, pid: 123, bounds: viewport)]) == nil)
check(testViewport([0: viewportParent]) == nil)
for role in ["AXWebArea", "AXSecureTextArea", kAXApplicationRole, ""] {
    check(testViewport([0: viewportParent, 1: NativeTextAncestor(element: 3, role: role, pid: 123, bounds: nil), 3: viewportRoot]) == nil)
}
var tooDeep: [Int: NativeTextAncestor<Int>] = [0: viewportParent]
for depth in 1...maximumAXPathDepth { tooDeep[depth] = NativeTextAncestor(element: depth + 1, role: kAXGroupRole, pid: 123, bounds: nil) }
tooDeep[maximumAXPathDepth + 1] = NativeTextAncestor(element: 99, role: kAXWindowRole, pid: 123, bounds: viewportWindow.bounds)
check(testViewport(tooDeep, root: 99) == nil)
let geometryBudget = ScanBudget()
check(candidateGeometry(.success, "position" as NSString, .success, "size" as NSString, budget: geometryBudget,
                        decode: { _, _ in validBounds }) == validBounds)
check(!geometryBudget.truncated)
for raw in [nil, "malformed" as NSString] as [CFTypeRef?] {
    let geometryBudget = ScanBudget()
    check(candidateGeometry(.success, raw, .success, "size" as NSString, budget: geometryBudget, decode: { _, _ in nil }) == nil)
    check(geometryBudget.truncated && geometryBudget.firstAXErrorCode == nil)
}
let missingSize = ScanBudget()
check(candidateGeometry(.success, "position" as NSString, .success, nil, budget: missingSize, decode: { _, _ in validBounds }) == nil)
check(missingSize.truncated)
for invalid in [Rect(x: .nan, y: 0, width: 1, height: 1), Rect(x: 0, y: .infinity, width: 1, height: 1),
                Rect(x: 10_000_001, y: 0, width: 1, height: 1), Rect(x: 0, y: 0, width: 0, height: 1),
                Rect(x: 0, y: 0, width: 1, height: -1), Rect(x: 0, y: 0, width: 100_001, height: 1)] {
    let geometryBudget = ScanBudget()
    check(candidateGeometry(.success, "position" as NSString, .success, "size" as NSString, budget: geometryBudget,
                            decode: { _, _ in invalid }) == nil)
    check(geometryBudget.truncated && geometryBudget.firstAXErrorCode == nil)
}
for error in [AXError.failure, .attributeUnsupported, .noValue] {
    for failPosition in [true, false] {
        let geometryBudget = ScanBudget()
        var decodes = 0
        check(candidateGeometry(failPosition ? error : .success, "position" as NSString,
                                failPosition ? .success : error, "size" as NSString, budget: geometryBudget, decode: { _, _ in
            decodes += 1
            return validBounds
        }) == nil)
        check(geometryBudget.truncated && geometryBudget.firstAXErrorCode == error.rawValue && decodes == 0)
    }
}
let expiredGeometry = ScanBudget(deadline: 0)
check(candidateGeometry(.success, "position" as NSString, .success, "size" as NSString, budget: expiredGeometry,
                        decode: { _, _ in fatalError("Expired geometry must not decode") }) == nil)
check(expiredGeometry.truncated)

var reads: [String] = []
let missing = ScanBudget()
check(candidateSemanticFields([], budget: missing, read: { name in
    reads.append(name)
    return (.attributeUnsupported, nil)
}) == [:])
check(reads == [kAXDescriptionAttribute])
check(missing.semanticMissing == [1, 0, 1])
check(!missing.truncated && missing.firstAXErrorCode == nil)

reads = []
let subset = ScanBudget()
let descriptionOnly = candidateSemanticFields([], budget: subset, read: { name in
    reads.append(name)
    return (.success, "显示边栏" as NSString)
})
check(reads == [kAXDescriptionAttribute])
check(descriptionOnly == [kAXDescriptionAttribute: "显示边栏"])
check(subset.semanticMissing == [0, 0, 1] && !subset.truncated)
reads = []
let advertised = ScanBudget()
let production = candidateSemanticFields(Set(CandidateSemanticField.allCases.map { $0.attribute }), budget: advertised, read: { name in
    reads.append(name)
    check(name != kAXSubroleAttribute)
    return (.success, name == kAXDescriptionAttribute ? "删除最后一位数字" as NSString : "delete-key" as NSString)
})
check(reads == [kAXDescriptionAttribute, kAXIdentifierAttribute])
check(production == [kAXDescriptionAttribute: "删除最后一位数字", kAXIdentifierAttribute: "delete-key"])
check(advertised.semanticMissing[1] == 0 && advertised.semanticReadErrors[1] == 0 && !advertised.truncated)

for field in CandidateSemanticField.allCases {
    let noValue = ScanBudget()
    check(candidateSemanticFields([field.attribute], budget: noValue, fields: [field], read: { _ in (.noValue, nil) }) == [:])
    check(noValue.semanticMissing[field.rawValue] == 1 && !noValue.truncated)
    if field == .description {
        let unsupported = ScanBudget()
        check(candidateSemanticFields([], budget: unsupported, fields: [field], read: { _ in (.attributeUnsupported, nil) }) == [:])
        check(unsupported.semanticMissing[field.rawValue] == 1 && !unsupported.truncated)
    }
    let failures = field == .description ? [AXError.failure, .cannotComplete, .illegalArgument]
                                        : [AXError.failure, .attributeUnsupported, .cannotComplete]
    for error in failures {
        let failed = ScanBudget()
        check(candidateSemanticFields([field.attribute], budget: failed, fields: [field], read: { _ in (error, nil) }) == nil)
        check(failed.truncated && failed.firstAXErrorCode == error.rawValue)
        check(failed.semanticReadErrors[field.rawValue] == 1)
        check(failed.semanticReadErrors.reduce(0, +) == 1)
        check(failed.semanticInvalid == [0, 0, 0])
    }
    for raw: CFTypeRef? in [nil, NSNumber(value: 1), String(repeating: "a", count: field.maximumBytes + 1) as NSString,
                            "line\nfeed" as NSString, "bidirectional\u{2066}" as NSString] {
        let invalid = ScanBudget()
        check(candidateSemanticFields([field.attribute], budget: invalid, fields: [field], read: { _ in (.success, raw) }) == nil)
        check(invalid.truncated && invalid.semanticInvalid[field.rawValue] == 1)
        check(invalid.semanticReadErrors == [0, 0, 0])
    }
    for text in ["", String(repeating: "a", count: field.maximumBytes)] {
        let valid = ScanBudget()
        check(candidateSemanticFields([field.attribute], budget: valid, fields: [field], read: { _ in (.success, text as NSString) })?[field.attribute] == text)
        check(!valid.truncated)
    }
}
let expiredRead = ScanBudget(deadline: 0)
var expiredCalls = 0
check(candidateSemanticFields([kAXDescriptionAttribute], budget: expiredRead, read: { _ in
    expiredCalls += 1
    return (.success, "value" as NSString)
}) == nil)
check(expiredRead.truncated && expiredCalls == 0)

// A successful prefix is checked against the actual copy receipt policy. Type,
// count and API failure are rejected without creating or observing AX elements.
check(copiedPrefixElements(.success, names(["child"]), expectedCount: 1, isValid: { (_: String) in true }) == ["child"])
check(copiedPrefixElements(.failure, names(["child"]), expectedCount: 1, isValid: { (_: String) in true }) == nil)
check(copiedPrefixElements(.success, nil, expectedCount: 1, isValid: { (_: String) in true }) == nil)
check(copiedPrefixElements(.success, names([1]), expectedCount: 1, isValid: { (_: String) in true }) == nil)
check(copiedPrefixElements(.success, names(["child"]), expectedCount: 2, isValid: { (_: String) in true }) == nil)
check(copiedPrefixElements(.success, names(["child", "extra"]), expectedCount: 1, isValid: { (_: String) in true }) == nil)
check(copiedPrefixElements(.success, names(["child"]), expectedCount: 1, isValid: { (_: String) in false }) == nil)
check(copiedPrefixElements(.success, names([]), expectedCount: -1, isValid: { (_: String) in true }) == nil)
check(copiedPrefixElements(.success, names(Array(repeating: "child", count: 65)), expectedCount: 65, isValid: { (_: String) in true }) == nil)
check(copiedPrefixElements(.success, names(Array(repeating: "child", count: 64)), expectedCount: 64, isValid: { (_: String) in true })?.count == 64)
for error in [AXError.failure, .attributeUnsupported, .noValue] {
    let copyBudget = ScanBudget()
    check(copiedPrefixElements(error, names(["child"]), expectedCount: 1, budget: copyBudget, isValid: { (_: String) in true }) == nil)
    check(copyBudget.truncated && copyBudget.firstAXErrorCode == error.rawValue)
}
for raw in [nil, names([1]), names([]), names(["child", "extra"])] as [CFArray?] {
    let copyBudget = ScanBudget()
    check(copiedPrefixElements(.success, raw, expectedCount: 1, budget: copyBudget, isValid: { (_: String) in true }) == nil)
    check(copyBudget.truncated && copyBudget.firstAXErrorCode == nil)
}
let invalidCountBudget = ScanBudget()
check(copiedPrefixElements(.success, names([]), expectedCount: -1, budget: invalidCountBudget, isValid: { (_: String) in true }) == nil)
check(invalidCountBudget.truncated)

for selected in [0, 63] {
    var counts: [Int] = []
    let resolved = resolveCandidatePath(0, path: [selected], readChildren: { _, prefix in
        counts.append(prefix)
        // The fake parent has 1,000 siblings, but only this prefix is copied.
        return Array(0..<min(1000, prefix))
    })
    check(resolved == selected)
    check(counts == [selected + 1])
}
var pathReads = 0
for invalidPath in [[-1], [64], [0, 64], Array(repeating: 0, count: 33)] {
    check(resolveCandidatePath(0, path: invalidPath, readChildren: { _, _ in
        pathReads += 1
        return [0]
    }) == nil)
}
check(pathReads == 0)
check(resolveCandidatePath(7, path: [], readChildren: { _, _ in fatalError("Root path must not copy children") }) == 7)
check(resolveCandidatePath(0, path: [1], readChildren: { _, _ in [0] }) == nil)
check(resolveCandidatePath(0, path: [0], readChildren: { _, _ in [0, 1] }) == nil)
check(resolveCandidatePath(0, path: [0], readChildren: { _, _ in nil }) == nil)
var nestedCounts: [Int] = []
check(resolveCandidatePath(0, path: [0, 63], readChildren: { node, prefix in
    nestedCounts.append(prefix)
    return (0..<prefix).map { node * 100 + $0 + 1 }
}) == 164)
check(nestedCounts == [1, 64])

// Exercise the production encoded-output policy, not just the text/node caps.
// The 30 common ancestors + two groups + 128 leaves need only 161 AX nodes,
// while full paths, semantic capabilities and escaping can exceed 64 KiB.
do {
    func encoded(_ value: Any) -> Data {
        try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
    func records(_ receipt: [String: Any]) -> [[String: Any]] {
        (receipt["target"] as! [String: Any])["candidates"] as! [[String: Any]]
    }
    let outputWindow = WindowIdentity(windowId: 5, pid: 123, processStartedAt: 9_007_199_254_740_991,
        layer: 0, bounds: Rect(x: 0, y: 0, width: 1000, height: 600), title: nil)
    let outputOperations: [SemanticOperation] = [.press, .scrollUpPage, .scrollDownPage,
        .scrollLeftPage, .scrollRightPage, .scrollUpStep, .scrollDownStep,
        .scrollUpFraction, .scrollDownFraction]
    func denseCandidates(_ title: String) -> [Candidate] {
        (0..<128).map { index in
            Candidate(path: Array(repeating: 0, count: 30) + [index / 64, index % 64],
                role: kAXScrollBarRole, title: title, description: nil, subrole: nil, identifier: nil,
                bounds: Rect(x: 100.123456789, y: 100.123456789, width: 10.123456789, height: 400.123456789),
                operations: outputOperations, orientation: .vertical, enabledState: .enabled,
                scrollState: ScrollState(value: 0.5, minValue: 0, maxValue: 1))
        }
    }
    let titles = [String(repeating: "A", count: 85), String(repeating: "\"\\/", count: 28) + "\"",
                  String(repeating: "汉", count: 28) + "A"]
    for title in titles {
        let dense = denseCandidates(title)
        check(dense.allSatisfy { $0.valid && outputWindow.bounds.contains($0.bounds) })
        check(dense.reduce(0, { $0 + $1.textBytes }) == 12 * 1024)
        var fullTarget = outputWindow.json
        fullTarget["candidates"] = dense.map { $0.json }
        check(encoded(["ok": true, "target": fullTarget, "truncated": false]).count > maximumAXObservationOutputBytes)
        for scopePath: [Int]? in [nil, Array(repeating: 0, count: 30)] {
            var receipt = try boundedWindowTargetReceipt(window: outputWindow, candidates: dense,
                truncated: false, scopePath: scopePath)
            let retained = records(receipt)
            check(!retained.isEmpty && retained.count < dense.count && receipt["truncated"] as? Bool == true)
            check(encoded(retained) == encoded(dense.prefix(retained.count).map { $0.json }))
            var identity = receipt["target"] as! [String: Any]
            identity.removeValue(forKey: "candidates")
            check(encoded(identity) == encoded(outputWindow.json))
            if let path = scopePath { check(encoded(receipt["scope"]!) == encoded(["path": path])) }
            else { check(receipt["scope"] == nil) }
            let remaining = maximumAXObservationOutputBytes - 1 - encoded(receipt).count
            check(remaining >= 0)
            let tree = AXTreeBudget(scanDeadline: DispatchTime.now().uptimeNanoseconds + 10_000_000_000,
                                    maximumEncodedBytes: remaining)
            for _ in 0..<128 { tree.append("AXStaticText title=" + tree.quoted(String(repeating: "\"\\汉", count: 40))) }
            receipt["axTree"] = tree.text
            receipt["axTreeTruncated"] = tree.truncated
            check(tree.truncated && encoded(receipt).count < maximumAXObservationOutputBytes)
            check(receipt["truncated"] as? Bool == true && encoded(records(receipt)) == encoded(retained))
        }
    }
    let short = Array(denseCandidates("Short").prefix(3))
    let complete = try boundedWindowTargetReceipt(window: outputWindow, candidates: short, truncated: false)
    check(records(complete).count == 3 && complete["truncated"] as? Bool == false)
    check(records(try boundedWindowTargetReceipt(window: outputWindow, candidates: short, truncated: true)).count == 3)
    check(try boundedWindowTargetReceipt(window: outputWindow, candidates: short, truncated: true)["truncated"] as? Bool == true)
    let exactSize = encoded(complete).count
    let exact = try boundedWindowTargetReceipt(window: outputWindow, candidates: short,
                                               truncated: false, maximumBytes: exactSize + 1)
    check(encoded(exact).count == exactSize && records(exact).count == 3 && exact["truncated"] as? Bool == false)
    let overflow = try boundedWindowTargetReceipt(window: outputWindow, candidates: short,
                                                  truncated: false, maximumBytes: exactSize)
    check(records(overflow).count == 2 && overflow["truncated"] as? Bool == true && encoded(overflow).count < exactSize)

    // A worst-case escaped title and full scope are retained exactly. A limit
    // smaller than the identity fails explicitly, rather than dropping it.
    let escapedWindow = WindowIdentity(windowId: outputWindow.windowId, pid: outputWindow.pid,
        processStartedAt: outputWindow.processStartedAt, layer: 0, bounds: outputWindow.bounds,
        title: String(repeating: "\u{01}", count: 256))
    let deepestScope = Array(repeating: 63, count: maximumAXPathDepth)
    let empty = try boundedWindowTargetReceipt(window: escapedWindow, candidates: [],
                                               truncated: false, scopePath: deepestScope)
    let emptySize = encoded(empty).count
    check(escapedWindow.valid && emptySize < maximumAXObservationOutputBytes)
    let noRoom = try boundedWindowTargetReceipt(window: escapedWindow, candidates: short,
        truncated: false, scopePath: deepestScope, maximumBytes: emptySize + 1)
    check(records(noRoom).isEmpty && noRoom["truncated"] as? Bool == true)
    check(encoded(noRoom).count < emptySize + 1)
    check(encoded(noRoom["scope"]!) == encoded(["path": deepestScope]))
    var noRoomIdentity = noRoom["target"] as! [String: Any]
    noRoomIdentity.removeValue(forKey: "candidates")
    check(encoded(noRoomIdentity) == encoded(escapedWindow.json))
    do {
        _ = try boundedWindowTargetReceipt(window: escapedWindow, candidates: [],
            truncated: false, scopePath: deepestScope, maximumBytes: emptySize)
        check(false)
    } catch let error as HelperError { check(error.code == "output_limit" && !error.unknown) }
    let invalid = Candidate(path: [], role: kAXButtonRole, title: "Invalid", description: nil,
        subrole: nil, identifier: nil, bounds: Rect(x: .nan, y: 0, width: 1, height: 1))
    check((try? boundedWindowTargetReceipt(window: outputWindow, candidates: [invalid], truncated: false)) == nil)
}

// Exercise the production bounded traversal with fake attribute readers. Large
// file trees must not starve independent controls in another shallow branch,
// while action identity paths still resolve using the original child indices.
struct ScanFixtureNode {
    var role: String? = kAXGroupRole
    var title: String? = nil
    var children: [Int]? = []
}
final class ScanFixture {
    let nodes: [Int: ScanFixtureNode]
    var roleReads: [Int] = []
    var candidateReads: [Int] = []
    var childReads: [Int] = []
    var contexts: [Int: Bool] = [:]
    init(_ nodes: [Int: ScanFixtureNode]) { self.nodes = nodes }
    func scan(root: Int = 0, path: [Int] = [], budget: ScanBudget, nativeContext: Bool = true) -> [Candidate] {
        var result: [Candidate] = []
        scanCandidatesBreadthFirst(root, path: path, budget: budget, result: &result, nativeContext: nativeContext,
            readRole: { node in self.roleReads.append(node); return self.nodes[node]?.role },
            readCandidate: { node, path, context, role in
                self.candidateReads.append(node)
                self.contexts[node] = context
                guard let title = self.nodes[node]?.title, let role = role else { return nil }
                return Candidate(path: path, role: role, title: title, description: nil, subrole: nil,
                    identifier: nil, bounds: Rect(x: 0, y: 0, width: 100, height: 100))
            },
            readChildren: { node in self.childReads.append(node); return self.nodes[node]?.children })
        return result
    }
    func depthFirstActionIds(root: Int = 0) -> [Int] {
        let own = nodes[root]?.title == nil ? [] : [root]
        return own + (nodes[root]?.children ?? []).prefix(64).flatMap { depthFirstActionIds(root: $0) }
    }
    func resolve(_ path: [Int]) -> Int? {
        resolveCandidatePath(0, path: path, readChildren: { node, prefix in
            guard let children = self.nodes[node]?.children else { return nil }
            return Array(children.prefix(prefix))
        })
    }
}
func checkScan(_ value: Bool, _ reason: String) {
    guard value else { fatalError(reason) }
    check(value)
}
var branchNodes: [Int: ScanFixtureNode] = [
    0: ScanFixtureNode(role: kAXWindowRole, children: [1, 2]),
    1: ScanFixtureNode(children: [10, 11, 12]),
    2: ScanFixtureNode(role: kAXButtonRole, title: "Independent button")
]
for branch in 0..<3 {
    let ids = Array((100 + branch * 64)..<(164 + branch * 64))
    branchNodes[10 + branch] = ScanFixtureNode(children: ids)
    for id in ids { branchNodes[id] = ScanFixtureNode(role: kAXButtonRole, title: String(id)) }
}
let branches = ScanFixture(branchNodes)
let branchBudget = ScanBudget()
let branchResult = branches.scan(budget: branchBudget)
checkScan(!branches.depthFirstActionIds().prefix(128).contains(2), "Regression fixture must starve the independent button under DFS")
checkScan(branchResult.first?.title == "Independent button" && branchResult.first?.path == [1], "BFS must retain the shallow independent button")
checkScan(branchResult.count == 128 && branchBudget.candidates == 128 && branchBudget.truncated, "BFS must preserve the candidate cap and partial receipt")
checkScan(branchResult.first(where: { $0.title == "100" })?.path == [0, 0, 0], "First branch path must retain original child indices")
checkScan(branchResult.first(where: { $0.title == "163" })?.path == [0, 0, 63], "Last permitted child index must remain resolvable")
checkScan(branchResult.first(where: { $0.title == "164" })?.path == [0, 1, 0], "Sibling branch path must remain stable")
for candidate in branchResult {
    let expected = candidate.title == "Independent button" ? 2 : Int(candidate.title)
    checkScan(candidate.valid && branches.resolve(candidate.path) == expected, "Every BFS action must resolve to its original DFS identity")
}

var completeNodes: [Int: ScanFixtureNode] = [
    0: ScanFixtureNode(role: kAXWindowRole, children: [1, 2]),
    1: ScanFixtureNode(children: Array(100..<164)), 2: ScanFixtureNode(children: Array(164..<228))
]
for id in 100..<228 { completeNodes[id] = ScanFixtureNode(role: kAXButtonRole, title: String(id)) }
let completeBudget = ScanBudget()
checkScan(ScanFixture(completeNodes).scan(budget: completeBudget).count == 128, "Exactly 128 candidates must be retained")
checkScan(!completeBudget.truncated && completeBudget.nodes == 131, "A fully scanned tree at the candidate cap must remain complete")
completeNodes[0]?.children?.append(3)
completeNodes[3] = ScanFixtureNode(children: [228])
completeNodes[228] = ScanFixtureNode(role: kAXButtonRole, title: "Overflow")
let extraBudget = ScanBudget()
checkScan(ScanFixture(completeNodes).scan(budget: extraBudget).count == 128 && extraBudget.truncated, "An additional candidate must mark the capped scan partial")

var textNodes: [Int: ScanFixtureNode] = [0: ScanFixtureNode(role: kAXWindowRole, children: Array(1...48))]
for id in 1...49 { textNodes[id] = ScanFixtureNode(role: kAXButtonRole, title: String(repeating: "a", count: 248)) }
let exactTextBudget = ScanBudget()
checkScan(ScanFixture(textNodes).scan(budget: exactTextBudget).count == 48, "Candidates fitting exactly 12 KiB must be retained")
checkScan(exactTextBudget.textBytes == 12 * 1024 && !exactTextBudget.truncated, "Exact text capacity must remain complete")
textNodes[0]?.children?.append(49)
let extraTextBudget = ScanBudget()
checkScan(ScanFixture(textNodes).scan(budget: extraTextBudget).count == 48, "Text overflow must not add a candidate")
checkScan(extraTextBudget.textBytes == 12 * 1024 && extraTextBudget.truncated, "Text overflow must preserve the byte cap and partial receipt")

var wideNodes: [Int: ScanFixtureNode] = [0: ScanFixtureNode(role: kAXWindowRole, children: Array(1...64))]
for id in 1...64 {
    let children = Array((1000 + id * 64)..<(1064 + id * 64))
    wideNodes[id] = ScanFixtureNode(children: children)
    for child in children { wideNodes[child] = ScanFixtureNode() }
}
let wide = ScanFixture(wideNodes)
let wideBudget = ScanBudget()
checkScan(wide.scan(budget: wideBudget).isEmpty, "Non-actionable wide trees must not fabricate candidates")
checkScan(wideBudget.nodes == 2048 && wide.roleReads.count == 2048 && wide.childReads.count == 2048,
    "Total scheduled and visited nodes must share the 2048-node cap")
checkScan(Set(wide.roleReads).count == 2048 && wideBudget.truncated && !wideBudget.childrenLimit,
    "Queue exhaustion must report partial without duplicating nodes or implying a child-list limit")
let sharedBudget = ScanBudget()
sharedBudget.nodes = 2046
let shared = ScanFixture([0: ScanFixtureNode(role: kAXWindowRole, children: [1, 2, 3]), 1: ScanFixtureNode()])
checkScan(shared.scan(budget: sharedBudget).isEmpty && shared.roleReads == [0, 1], "An existing node budget must reduce queue capacity")
checkScan(sharedBudget.nodes == 2048 && sharedBudget.truncated, "Shared node budget must never exceed 2048")
let exhaustedBudget = ScanBudget()
exhaustedBudget.nodes = 2048
let exhausted = ScanFixture([0: ScanFixtureNode()])
checkScan(exhausted.scan(budget: exhaustedBudget).isEmpty && exhausted.roleReads.isEmpty && exhaustedBudget.truncated,
    "An exhausted scan must not invoke any reader")

var childLimitNodes: [Int: ScanFixtureNode] = [0: ScanFixtureNode(role: kAXWindowRole, children: Array(1...65))]
for id in 1...65 { childLimitNodes[id] = ScanFixtureNode(role: kAXButtonRole, title: String(id)) }
let childLimitBudget = ScanBudget()
let childLimit = ScanFixture(childLimitNodes).scan(budget: childLimitBudget)
checkScan(childLimit.count == 64 && childLimit.last?.path == [63], "Only the first 64 children may be scheduled")
checkScan(childLimitBudget.nodes == 65 && childLimitBudget.childrenLimit && childLimitBudget.truncated,
    "Child-list overflow must retain its specific completeness flag")
var deepNodes: [Int: ScanFixtureNode] = [0: ScanFixtureNode(role: kAXWindowRole, children: [1])]
for id in 1...33 { deepNodes[id] = ScanFixtureNode(children: id == 33 ? [] : [id + 1]) }
let deepBudget = ScanBudget()
let deep = ScanFixture(deepNodes)
checkScan(deep.scan(budget: deepBudget).isEmpty && deep.roleReads == Array(0...32), "Nodes beyond the original path depth may not be read")
checkScan(deepBudget.maxDepth == 32 && deepBudget.depthLimit && deepBudget.truncated, "Depth overflow must retain its specific completeness flag")
let expiredScan = ScanFixture([0: ScanFixtureNode(title: "Expired")])
let expiredScanBudget = ScanBudget(deadline: 0)
checkScan(expiredScan.scan(budget: expiredScanBudget).isEmpty && expiredScanBudget.nodes == 0 && expiredScanBudget.truncated,
    "An expired deadline must report partial without spending the node budget")
checkScan(expiredScan.roleReads.isEmpty && expiredScan.candidateReads.isEmpty && expiredScan.childReads.isEmpty,
    "An expired deadline must not call role, candidate or child readers")

let contextNodes: [Int: ScanFixtureNode] = [
    0: ScanFixtureNode(role: kAXWindowRole, children: [1, 2, 3, 7]),
    1: ScanFixtureNode(role: "AXWebArea", children: [4]),
    2: ScanFixtureNode(role: "AXSecureTextArea", children: [5]),
    3: ScanFixtureNode(children: [6]), 7: ScanFixtureNode(role: nil, children: [8]),
    4: ScanFixtureNode(role: kAXTextAreaRole), 5: ScanFixtureNode(role: kAXTextAreaRole),
    6: ScanFixtureNode(role: kAXTextAreaRole), 8: ScanFixtureNode(role: kAXTextAreaRole)
]
let contexts = ScanFixture(contextNodes)
_ = contexts.scan(budget: ScanBudget())
checkScan(contexts.contexts[0] == true && contexts.contexts[3] == true && contexts.contexts[6] == true,
    "The approved window and native descendants must retain native text context")
for node in [1, 2, 4, 5, 7, 8] { checkScan(contexts.contexts[node] == false, "Web, secure and unknown ancestors must disable descendant native text writes") }
let disabledContexts = ScanFixture(contextNodes)
_ = disabledContexts.scan(budget: ScanBudget(), nativeContext: false)
checkScan(disabledContexts.contexts.values.allSatisfy { !$0 }, "False native context must never be re-enabled")
let nested = ScanFixture([
    0: ScanFixtureNode(role: kAXWindowRole, children: [1, 2, 3]),
    1: ScanFixtureNode(role: kAXWindowRole, title: "Nested window", children: [4]),
    2: ScanFixtureNode(role: kAXApplicationRole, title: "Nested app", children: [5]),
    3: ScanFixtureNode(role: kAXButtonRole, title: "Approved button"),
    4: ScanFixtureNode(title: "Other window child"), 5: ScanFixtureNode(title: "Other app child")
])
let nestedBudget = ScanBudget()
checkScan(nested.scan(budget: nestedBudget).map { $0.title } == ["Approved button"], "Nested windows and applications must never issue candidates")
checkScan(nested.candidateReads == [0, 3] && nested.childReads == [0, 3] && nestedBudget.nodes == 4 && nestedBudget.truncated,
    "Nested window/application descendants must be pruned and mark the scan partial")
for cappedByCandidates in [true, false] {
    let prunedBudget = ScanBudget()
    if cappedByCandidates { prunedBudget.candidates = 128 } else { prunedBudget.textBytes = 12 * 1024 }
    let pruned = ScanFixture([0: ScanFixtureNode(role: kAXButtonRole, title: "Capped", children: [1]), 1: ScanFixtureNode(title: "Descendant")])
    checkScan(pruned.scan(budget: prunedBudget).isEmpty && pruned.childReads.isEmpty && prunedBudget.nodes == 1 && prunedBudget.truncated,
        "Candidate/text overflow must preserve the original descendant-pruning policy")
}

// Production semantic policies: no native AX objects are constructed.
check(SemanticOperation.allCases.count == 15)
check(SemanticOperation.allCases.filter { $0.fractionOrientation == nil }.count == 11)
check(validInputText("", operation: .replaceText))
check(!validInputText("", operation: .insertText))
check(validInputText("中文😀\n\t\r", operation: .insertText))
check(validInputText(String(repeating: "😀", count: 4096), operation: .replaceText))
check(!validInputText(String(repeating: "a", count: 4097), operation: .replaceText))
check(!validInputText(String(repeating: "😀", count: 4097), operation: .insertText))
for scalar in [0, 1, 8, 11, 12, 14, 31, 127, 159, 0x202a, 0x202e, 0x2066, 0x2069] {
    check(!validInputText("a" + String(UnicodeScalar(scalar)!) + "b", operation: .replaceText))
}
check(!validInputText("text", operation: .press))
check(nativeTextContext(true, role: kAXWindowRole, root: true))
for role in [nil, "", "AXWebArea", "AXSecureTextField", kAXApplicationRole, kAXWindowRole] as [String?] {
    check(!nativeTextContext(true, role: role))
}
check(!nativeTextContext(false, role: kAXTextAreaRole))
check(nativeTextContext(true, role: kAXTextAreaRole))
check(nativeTextRole(kAXTextAreaRole, subrole: nil))
check(nativeTextRole(kAXTextFieldRole, subrole: kAXSearchFieldSubrole))
check(nativeTextRole(kAXTextFieldRole, subrole: "AXTextField"))
for subrole in [nil, "", kAXSecureTextFieldSubrole, "AXUnknown"] as [String?] {
    check(!nativeTextRole(kAXTextFieldRole, subrole: subrole))
}
check(!nativeTextRole(kAXTextAreaRole, subrole: kAXSecureTextFieldSubrole))
check(!nativeTextRole("AXWebArea", subrole: "AXTextField"))
check(semanticSubrole(.attributeUnsupported, nil)?.subrole == nil)
check(semanticSubrole(.success, "" as NSString)?.subrole == "")
check(semanticSubrole(.success, nil) == nil)
let subroleBudget = ScanBudget()
check(semanticSubrole(.cannotComplete, nil, budget: subroleBudget) == nil)
check(subroleBudget.truncated)
check(semanticSettable(.success, true))
check(!semanticSettable(.success, false))
check(!semanticSettable(.attributeUnsupported, true))
check(!semanticSettable(.cannotComplete, true))
let selection = TextSelection(location: 3, length: 2) // UTF-16 units, not Unicode scalars.
check(selection.valid)
check(!TextSelection(location: -1, length: 0).valid)
check(!TextSelection(location: 0, length: -1).valid)
check(TextSelection(location: 9_007_199_254_740_991, length: 0).valid)
check(!TextSelection(location: 9_007_199_254_740_991, length: 1).valid)
check(!TextSelection(location: Int.max, length: Int.max).valid)
check(semanticSelection(.success, "fixture" as NSString, decode: { _ in selection }) == selection)
check(semanticSelection(.success, "fixture" as NSString, decode: { _ in nil }) == nil)
check(semanticSelection(.noValue, nil, decode: { _ in fatalError("Unsupported range must not decode") }) == nil)
let rangeBudget = ScanBudget()
check(semanticSelection(.success, nil, budget: rangeBudget, decode: { _ in selection }) == nil)
check(rangeBudget.truncated)
check(semanticOrientation(.success, kAXVerticalOrientationValue as NSString) == .vertical)
check(semanticOrientation(.success, kAXHorizontalOrientationValue as NSString) == .horizontal)
check(semanticOrientation(.success, "unknown" as NSString) == nil)
check(semanticOrientation(.cannotComplete, nil) == nil)
let textState = TextState(subrole: nil, selection: selection)
let textOps = semanticOperations(actions: [], role: kAXTextAreaRole, orientation: nil,
                                 textState: textState, replaceSettable: true, insertSettable: true)
check(textOps == [.replaceText, .insertText])
check(semanticOperations(actions: [], role: kAXTextAreaRole, orientation: nil,
                         textState: nil, replaceSettable: true, insertSettable: true).isEmpty)
check(semanticOperations(actions: [], role: kAXTextAreaRole, orientation: nil,
                         textState: TextState(subrole: nil), replaceSettable: false, insertSettable: true).isEmpty)
check(semanticOperations(actions: ["AXPageDown"], role: kAXScrollAreaRole, orientation: nil,
                         textState: nil, replaceSettable: false, insertSettable: false).isEmpty)
for operation in SemanticOperation.allCases where operation.pageAction != nil {
    check(semanticOperations(actions: [operation.pageAction!], role: kAXScrollAreaRole, orientation: nil,
                             textState: nil, replaceSettable: false, insertSettable: false) == [operation])
}
check(semanticOperations(actions: [kAXIncrementAction, kAXDecrementAction], role: kAXScrollBarRole, orientation: .vertical,
                         textState: nil, replaceSettable: false, insertSettable: false) == [.scrollUpStep, .scrollDownStep])
check(semanticOperations(actions: [kAXIncrementAction], role: kAXScrollBarRole, orientation: .horizontal,
                         textState: nil, replaceSettable: false, insertSettable: false) == [.scrollRightStep])
check(semanticOperations(actions: [kAXIncrementAction], role: kAXSliderRole, orientation: .vertical,
                         textState: nil, replaceSettable: false, insertSettable: false).isEmpty)

var semanticReads: [String] = []
var semanticProbes: [String] = []
let discoveredText = discoverSemanticCapabilities(role: kAXTextAreaRole, nativeContext: true, actions: [],
    read: { attribute in semanticReads.append(attribute); return (.noValue, nil) },
    settable: { attribute in semanticProbes.append(attribute); return true }, selection: { selection })
check(discoveredText.operations == [.replaceText, .insertText])
check(discoveredText.textState == textState)
check(semanticReads == [kAXSubroleAttribute]) // Never reads AXValue or AXSelectedText contents.
check(semanticProbes == [kAXValueAttribute, kAXSelectedTextAttribute])
for nativeContext in [false, true] {
    var probes = 0
    let unsafe = discoverSemanticCapabilities(role: kAXTextFieldRole, nativeContext: nativeContext, actions: [kAXPressAction],
        read: { _ in (.success, kAXSecureTextFieldSubrole as NSString) },
        settable: { _ in probes += 1; return true }, selection: { fatalError("Secure/web selection must not be read") })
    check(unsafe.operations == [.press] && unsafe.textState == nil && probes == 0)
}
let discoveredScroll = discoverSemanticCapabilities(role: kAXScrollBarRole, nativeContext: false, actions: [kAXIncrementAction],
    read: { attribute in check(attribute == kAXOrientationAttribute); return (.success, kAXVerticalOrientationValue as NSString) },
    settable: { _ in fatalError("Scrolling must not inspect text settable attributes") },
    selection: { fatalError("Scrolling must not read selection") })
check(discoveredScroll.operations == [.scrollDownStep] && discoveredScroll.orientation == .vertical)
for nativeContext in [false, true] {
    let scrollArea = discoverSemanticCapabilities(role: kAXScrollAreaRole, nativeContext: nativeContext,
        actions: ["AXScrollDownByPage", kAXPressAction],
        read: { _ in fatalError("Page actions do not inspect field values") }, settable: { _ in false }, selection: { nil })
    check(scrollArea.operations == (nativeContext ? [.press, .scrollDownPage] : [.press]))
}

let semanticBounds = Rect(x: 0, y: 0, width: 100, height: 100)
let textCandidate = Candidate(path: [0], role: kAXTextAreaRole, title: "Test", description: nil,
    subrole: nil, identifier: nil, bounds: semanticBounds, operations: textOps, textState: textState, enabledState: .enabled)
check(textCandidate.valid)

// Real AppKit-compatible AXEnabled absence is not equivalent to true. Only
// already-proven text-area writes / declared scroll-area pages survive it.
let enabledText = candidateEnabledCapabilities(.success, kCFBooleanTrue, role: kAXTextAreaRole, operations: [.press] + textOps)!
check(enabledText.enabledState == .enabled && enabledText.operations == [.press] + textOps)
for error in [AXError.attributeUnsupported, .noValue] {
    let missingBudget = ScanBudget()
    let missingText = candidateEnabledCapabilities(error, nil, role: kAXTextAreaRole, operations: [.press] + textOps, budget: missingBudget)!
    check(missingText.enabledState == .absent && missingText.operations == textOps)
    check(!missingText.operations.contains(.press) && !missingBudget.truncated)
    let missingPages = candidateEnabledCapabilities(error, nil, role: kAXScrollAreaRole,
        operations: [.press, .scrollUpPage, .scrollDownPage, .scrollLeftPage, .scrollRightPage])!
    check(missingPages.enabledState == .absent)
    check(missingPages.operations == [.scrollUpPage, .scrollDownPage, .scrollLeftPage, .scrollRightPage])
    for (role, operations) in [(kAXButtonRole, [SemanticOperation.press]), (kAXTextFieldRole, [.replaceText]),
                               (kAXScrollBarRole, [.scrollDownStep]), (kAXScrollAreaRole, [.scrollDownStep]),
                               (kAXTextAreaRole, [.press]), ("AXWebArea", [.replaceText])] {
        let rejectedBudget = ScanBudget()
        check(candidateEnabledCapabilities(error, nil, role: role, operations: operations, budget: rejectedBudget) == nil)
        check(rejectedBudget.truncated && rejectedBudget.firstAXErrorCode == error.rawValue)
    }
    let invalidAbsence = ScanBudget()
    check(candidateEnabledCapabilities(error, kCFBooleanTrue, role: kAXTextAreaRole, operations: textOps, budget: invalidAbsence) == nil)
    check(invalidAbsence.truncated)
}
let disabledBudget = ScanBudget()
check(candidateEnabledCapabilities(.success, kCFBooleanFalse, role: kAXTextAreaRole, operations: textOps, budget: disabledBudget) == nil)
check(!disabledBudget.truncated)
for error in [AXError.cannotComplete, .failure, .apiDisabled, .invalidUIElement] {
    let failedBudget = ScanBudget()
    check(candidateEnabledCapabilities(error, nil, role: kAXTextAreaRole, operations: textOps, budget: failedBudget) == nil)
    check(failedBudget.truncated && failedBudget.firstAXErrorCode == error.rawValue)
}
for raw in [nil, "true" as NSString, NSNumber(value: 1)] as [CFTypeRef?] {
    let malformedBudget = ScanBudget()
    check(candidateEnabledCapabilities(.success, raw, role: kAXTextAreaRole, operations: textOps, budget: malformedBudget) == nil)
    check(malformedBudget.truncated)
}
var absentTextCandidate = textCandidate
absentTextCandidate.enabledState = .absent
check(absentTextCandidate.valid)
let absentAvailability = CandidateAvailability(enabledState: .absent, operations: textOps)
check(candidateAvailabilityMatches(absentAvailability, observed: absentTextCandidate, operation: .replaceText))
check(!candidateAvailabilityMatches(enabledText, observed: absentTextCandidate, operation: .replaceText))
check(!candidateAvailabilityMatches(absentAvailability, observed: textCandidate, operation: .replaceText))
check(!candidateAvailabilityMatches(absentAvailability, observed: absentTextCandidate, operation: .press))
check(!absentTextCandidate.matchesSemanticFields(of: textCandidate))
check(!textCandidate.matchesSemanticFields(of: absentTextCandidate))
var legacyTextCandidate = textCandidate
legacyTextCandidate.enabledState = nil
check(!legacyTextCandidate.valid)
check(!candidateAvailabilityMatches(enabledText, observed: legacyTextCandidate, operation: .replaceText))
var invalidAbsentPress = absentTextCandidate
invalidAbsentPress.operations = [.press, .replaceText, .insertText]
check(!invalidAbsentPress.valid)

check(!textCandidate.effectiveOperations.contains(.press))
var newDescription = textCandidate
newDescription = Candidate(path: textCandidate.path, role: textCandidate.role, title: textCandidate.title,
    description: "New description", subrole: nil, identifier: nil, bounds: textCandidate.bounds,
    operations: textCandidate.operations, textState: textCandidate.textState, enabledState: textCandidate.enabledState)
check(!newDescription.matchesSemanticFields(of: textCandidate))
check(!textCandidate.matchesSemanticFields(of: newDescription))
let newIdentifier = Candidate(path: textCandidate.path, role: textCandidate.role, title: textCandidate.title,
    description: nil, subrole: nil, identifier: "New identifier", bounds: textCandidate.bounds,
    operations: textCandidate.operations, textState: textCandidate.textState, enabledState: textCandidate.enabledState)
check(!newIdentifier.matchesSemanticFields(of: textCandidate))
check(textCandidate.matchesSemanticFields(of: textCandidate))

let caps = SemanticCapabilities(operations: textOps, textState: textState)
check(semanticCapabilityMatches(caps, observed: textCandidate, operation: .insertText))
check(!semanticCapabilityMatches(SemanticCapabilities(operations: textOps,
    textState: TextState(subrole: nil, selection: TextSelection(location: 4, length: 2))), observed: textCandidate, operation: .insertText))
check(!semanticCapabilityMatches(SemanticCapabilities(operations: textOps,
    textState: TextState(subrole: "", selection: selection)), observed: textCandidate, operation: .replaceText))
check(!semanticCapabilityMatches(SemanticCapabilities(operations: [.replaceText], textState: textState), observed: textCandidate, operation: .insertText))
let scrollCandidate = Candidate(path: [0], role: kAXScrollBarRole, title: "Scroll", description: nil,
    subrole: nil, identifier: nil, bounds: semanticBounds, operations: [.scrollDownStep], orientation: .vertical, enabledState: .enabled)
check(scrollCandidate.valid)
var unboundScrollCandidate = scrollCandidate
unboundScrollCandidate.enabledState = nil
check(!unboundScrollCandidate.valid)
check(semanticCapabilityMatches(SemanticCapabilities(operations: [.scrollDownStep], orientation: .vertical), observed: scrollCandidate, operation: .scrollDownStep))
check(!semanticCapabilityMatches(SemanticCapabilities(operations: [.scrollDownStep], orientation: .horizontal), observed: scrollCandidate, operation: .scrollDownStep))

// Profile selection precedes identity reads and is independent of Description.
let identifierAttributes: Set<String> = [kAXIdentifierAttribute, kAXDescriptionAttribute]
check(selectedCandidateIdentityProfile(role: kAXTextAreaRole, title: "", nativeContext: true,
    operations: textOps, textState: textState, attributes: identifierAttributes) == .nativeTextIdentifierV1)
check(selectedCandidateIdentityProfile(role: kAXTextAreaRole, title: "", nativeContext: true,
    operations: textOps, textState: textState, attributes: [kAXIdentifierAttribute]) == .nativeTextIdentifierV1)
for role in [kAXTextFieldRole, kAXButtonRole, "AXWebArea"] {
    check(selectedCandidateIdentityProfile(role: role, title: "", nativeContext: true,
        operations: textOps, textState: textState, attributes: identifierAttributes) == nil)
}
for title in ["Text fixture", " "] {
    check(selectedCandidateIdentityProfile(role: kAXTextAreaRole, title: title, nativeContext: true,
        operations: textOps, textState: textState, attributes: identifierAttributes) == nil)
}
check(selectedCandidateIdentityProfile(role: kAXTextAreaRole, title: "", nativeContext: false,
    operations: textOps, textState: textState, attributes: identifierAttributes) == nil)
check(selectedCandidateIdentityProfile(role: kAXTextAreaRole, title: "", nativeContext: true,
    operations: textOps, textState: textState, attributes: [kAXDescriptionAttribute]) == nil)
for operations: [SemanticOperation] in [[], [.press], [.press, .replaceText], [.scrollDownPage], [.replaceText, .scrollDownFraction]] {
    check(selectedCandidateIdentityProfile(role: kAXTextAreaRole, title: "", nativeContext: true,
        operations: operations, textState: textState, attributes: identifierAttributes) == nil)
}
for state in [nil, TextState(subrole: kAXSecureTextFieldSubrole), TextState(subrole: nil)] as [TextState?] {
    check(selectedCandidateIdentityProfile(role: kAXTextAreaRole, title: "", nativeContext: true,
        operations: textOps, textState: state, attributes: identifierAttributes) == nil)
}
var identityReads: [String] = []
let identifierIdentity = candidateIdentityFields(profile: .nativeTextIdentifierV1, attributes: identifierAttributes, read: { attribute in
    identityReads.append(attribute)
    return (.success, " text-area-id " as NSString)
})!
check(identityReads == [kAXIdentifierAttribute])
check(identifierIdentity.profile == .nativeTextIdentifierV1 && identifierIdentity.descriptionDeclared == true)
check(identifierIdentity.semantics == [kAXIdentifierAttribute: " text-area-id "])
check(candidateIdentityFields(profile: .nativeTextIdentifierV1, attributes: [kAXIdentifierAttribute],
    read: { _ in (.success, "text-area-id" as NSString) })?.descriptionDeclared == false)
for error in [AXError.failure, .cannotComplete, .attributeUnsupported, .noValue] {
    identityReads = []
    let identityBudget = ScanBudget()
    check(candidateIdentityFields(profile: .nativeTextIdentifierV1, attributes: identifierAttributes, budget: identityBudget, read: { attribute in
        identityReads.append(attribute)
        return (error, nil)
    }) == nil)
    check(identityReads == [kAXIdentifierAttribute]) // No Description fallback.
    check(identityBudget.truncated && identityBudget.firstAXErrorCode == error.rawValue)
}
for raw in [nil, kCFBooleanTrue, NSNumber(value: 1), "" as NSString, "   " as NSString,
            "id\n" as NSString, "id\u{202e}" as NSString, String(repeating: "a", count: 257) as NSString] as [CFTypeRef?] {
    let identityBudget = ScanBudget()
    check(candidateIdentityFields(profile: .nativeTextIdentifierV1, attributes: identifierAttributes, budget: identityBudget,
        read: { _ in (.success, raw) }) == nil)
    check(identityBudget.truncated && identityBudget.semanticInvalid[2] == 1)
}
for attributes: Set<String> in [[], [kAXDescriptionAttribute]] {
    check(candidateIdentityFields(profile: .nativeTextIdentifierV1, attributes: attributes,
        read: { _ in fatalError("Missing declared identifier must not read any identity getter") }) == nil)
}
check(candidateIdentityFields(profile: nil, requiredProfile: .nativeTextIdentifierV1, attributes: identifierAttributes,
    read: { _ in fatalError("A frozen profile cannot fall back during revalidation") }) == nil)
identityReads = []
check(candidateIdentityFields(profile: nil, attributes: identifierAttributes, read: { attribute in
    identityReads.append(attribute)
    return (.failure, nil)
}) == nil)
check(identityReads == [kAXDescriptionAttribute]) // Existing legacy rule still fails closed.
let identifierTextCandidate = Candidate(path: [0], role: kAXTextAreaRole, title: "", description: nil,
    subrole: nil, identifier: " text-area-id ", bounds: semanticBounds, operations: textOps,
    textState: textState, enabledState: .absent, identityProfile: .nativeTextIdentifierV1, descriptionDeclared: true)
check(identifierTextCandidate.valid && !identifierTextCandidate.effectiveOperations.contains(.press))
var clippedTextCandidate = identifierTextCandidate
clippedTextCandidate.documentBounds = Rect(x: semanticBounds.x, y: semanticBounds.y, width: semanticBounds.width, height: semanticBounds.height + 1000)
check(clippedTextCandidate.valid)
check(!clippedTextCandidate.matchesSemanticFields(of: identifierTextCandidate))
var documentDrift = clippedTextCandidate
documentDrift.documentBounds = Rect(x: semanticBounds.x, y: semanticBounds.y, width: semanticBounds.width, height: semanticBounds.height + 2000)
check(documentDrift.valid && !documentDrift.matchesSemanticFields(of: clippedTextCandidate))
documentDrift.documentBounds = semanticBounds
check(!documentDrift.valid)
documentDrift = clippedTextCandidate; documentDrift.identityProfile = nil; documentDrift.descriptionDeclared = nil
check(!documentDrift.valid)
var identifierDrift = identifierTextCandidate
identifierDrift.descriptionDeclared = false
check(identifierDrift.valid && !identifierDrift.matchesSemanticFields(of: identifierTextCandidate))
identifierDrift = identifierTextCandidate; identifierDrift.identityProfile = nil
check(!identifierDrift.valid && !identifierDrift.matchesSemanticFields(of: identifierTextCandidate))
identifierDrift = identifierTextCandidate; identifierDrift.descriptionDeclared = nil
check(!identifierDrift.valid)
identifierDrift = identifierTextCandidate; identifierDrift.operations = [.press, .replaceText]
check(!identifierDrift.valid)

let fractionState = ScrollState(value: 50, minValue: 10, maxValue: 110)
check(fractionState.valid)
check(fractionState.destination(for: .scrollDownFraction) == 60)
check(fractionState.destination(for: .scrollUpFraction) == 40)
check(fractionState.destination(for: .scrollRightFraction) == 60)
check(fractionState.destination(for: .scrollLeftFraction) == 40)
check(fractionState.destination(for: .scrollDownPage) == nil)
check(ScrollState(value: 105, minValue: 10, maxValue: 110).destination(for: .scrollDownFraction) == 110)
check(ScrollState(value: 15, minValue: 10, maxValue: 110).destination(for: .scrollUpFraction) == 10)
for state in [ScrollState(value: 1, minValue: 1, maxValue: 1), ScrollState(value: 0, minValue: 1, maxValue: 0),
              ScrollState(value: -1, minValue: 0, maxValue: 1), ScrollState(value: 2, minValue: 0, maxValue: 1),
              ScrollState(value: .nan, minValue: 0, maxValue: 1), ScrollState(value: 0, minValue: -.infinity, maxValue: 1),
              ScrollState(value: 0, minValue: 0, maxValue: .infinity),
              ScrollState(value: 0, minValue: -Double.greatestFiniteMagnitude, maxValue: Double.greatestFiniteMagnitude),
              ScrollState(value: 0, minValue: 0, maxValue: Double.leastNonzeroMagnitude)] {
    check(!state.valid && state.destination(for: .scrollDownFraction) == nil)
}
for raw in [nil, kCFBooleanTrue, kCFBooleanFalse, "0.1" as NSString, NSNumber(value: Double.nan),
            NSNumber(value: Double.infinity)] as [CFTypeRef?] {
    check(semanticScrollNumber(.success, raw) == nil)
}
check(semanticScrollNumber(.success, NSNumber(value: 0.25)) == 0.25)
for error in [AXError.attributeUnsupported, .noValue, .failure, .cannotComplete] {
    check(semanticScrollNumber(error, nil) == nil)
}
let fractionOps: [SemanticOperation] = [.scrollUpFraction, .scrollDownFraction]
let fractionCandidate = Candidate(path: [0], role: kAXScrollBarRole, title: "Fraction", description: nil,
    subrole: nil, identifier: nil, bounds: semanticBounds, operations: fractionOps, orientation: .vertical,
    enabledState: .enabled, scrollState: fractionState)
check(fractionCandidate.valid)
check(candidateEnabledCapabilities(.attributeUnsupported, nil, role: kAXScrollBarRole, operations: fractionOps) == nil)
let fractionCaps = discoverSemanticCapabilities(role: kAXScrollBarRole, nativeContext: false, actions: [],
    read: { attribute in check(attribute == kAXOrientationAttribute); return (.success, kAXVerticalOrientationValue as NSString) },
    settable: { _ in fatalError("Scrollbar numeric proof is isolated from text settable probes") },
    selection: { fatalError("Scrollbar numeric proof must not read text selection") }, scrollValue: { fractionState })
check(fractionCaps.operations == fractionOps && fractionCaps.scrollState == fractionState)
check(semanticCapabilityMatches(fractionCaps, observed: fractionCandidate, operation: .scrollDownFraction))
var driftedFraction = fractionCaps
driftedFraction.scrollState = ScrollState(value: 51, minValue: 10, maxValue: 110)
check(!semanticCapabilityMatches(driftedFraction, observed: fractionCandidate, operation: .scrollDownFraction))
driftedFraction.scrollState = ScrollState(value: 50, minValue: 0, maxValue: 110)
check(!semanticCapabilityMatches(driftedFraction, observed: fractionCandidate, operation: .scrollDownFraction))
driftedFraction.scrollState = ScrollState(value: 50, minValue: 10, maxValue: 120)
check(!semanticCapabilityMatches(driftedFraction, observed: fractionCandidate, operation: .scrollDownFraction))
var invalidFraction = fractionCandidate
invalidFraction.scrollState = nil
check(!invalidFraction.valid)
invalidFraction = fractionCandidate; invalidFraction.orientation = .horizontal
check(!invalidFraction.valid)
invalidFraction = fractionCandidate; invalidFraction.enabledState = .absent
check(!invalidFraction.valid)
var invalidCapabilities = textCandidate
invalidCapabilities.operations = [.press]
check(!invalidCapabilities.valid)
invalidCapabilities = scrollCandidate
invalidCapabilities.orientation = .horizontal
check(!invalidCapabilities.valid)
try mutationResult(.success)
// Exercise the actual shared post-call policy used by AXPress, writes and
// scrolls. Even a nominal rejection cannot prove the app made no UI change.
for error in [AXError.failure, .illegalArgument, .invalidUIElement, .invalidUIElementObserver, .cannotComplete,
              .attributeUnsupported, .actionUnsupported, .notificationUnsupported, .notImplemented,
              .notificationAlreadyRegistered, .notificationNotRegistered, .apiDisabled, .noValue,
              .parameterizedAttributeUnsupported, .notEnoughPrecision] {
    do { try mutationResult(error); fatalError("Non-success mutation must remain unknown") }
    catch let result as HelperError { check(result.unknown && result.code == "ax_action_unknown") }
}
let semanticWindow = WindowIdentity(windowId: 84, pid: 123, processStartedAt: 1000, layer: 0, bounds: semanticBounds, title: nil)
let textObject: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": textCandidate.json],
                                "operation": "insertText", "text": "中😀\n\t"]
let textData = try JSONSerialization.data(withJSONObject: textObject)
check(try parseSetTextRequest(textData).text == "中😀\n\t")

var absentTextObject = textObject
absentTextObject["target"] = ["window": semanticWindow.json, "candidate": absentTextCandidate.json]
check(try parseSetTextRequest(JSONSerialization.data(withJSONObject: absentTextObject)).target.candidate.enabledState == .absent)
var legacyTextObject = textObject
legacyTextObject["target"] = ["window": semanticWindow.json, "candidate": legacyTextCandidate.json]
do { _ = try parseSetTextRequest(JSONSerialization.data(withJSONObject: legacyTextObject)); fatalError("Unbound enabled state must fail") }
catch let result as HelperError { check(!result.unknown) }

for (key, value) in [("text", "" as Any), ("operation", "press" as Any), ("unknown", 1 as Any)] {
    var object = textObject; object[key] = value
    do { _ = try parseSetTextRequest(JSONSerialization.data(withJSONObject: object)); fatalError("Bad text request must fail") }
    catch let result as HelperError { check(!result.unknown) }
}
var longObject = textObject
longObject["text"] = String(repeating: "😀", count: 4096)
check(try parseSetTextRequest(JSONSerialization.data(withJSONObject: longObject)).text.unicodeScalars.count == 4096)
do { _ = try parseSetTextRequest(Data(("{\"target\":" + String(data: try JSONSerialization.data(withJSONObject: textObject["target"]!), encoding: .utf8)! + ",\"operation\":\"insertText\",\"text\":\"\\ud800\"}").utf8)); fatalError("Lone surrogate must fail") }
catch is HelperError { check(true) }
let escaped = String(repeating: "\\ud83d\\ude00", count: 4096)
let encodedTarget = String(data: try JSONSerialization.data(withJSONObject: textObject["target"]!), encoding: .utf8)!
check(try parseSetTextRequest(Data(("{\"target\":" + encodedTarget + ",\"operation\":\"insertText\",\"text\":\"" + escaped + "\"}").utf8)).text.unicodeScalars.count == 4096)
do { _ = try parseSetTextRequest(Data("{\"target\":{},\"operation\":\"insertText\",\"text\":\"a\",\"text\":\"b\"}".utf8)); fatalError("Duplicate key must fail") }
catch is HelperError { check(true) }
let scrollObject: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": scrollCandidate.json], "operation": "scrollDownStep"]
check(try parseScrollRequest(JSONSerialization.data(withJSONObject: scrollObject)).operation == .scrollDownStep)
var invalidScroll = scrollObject; invalidScroll["operation"] = "scrollDownPage"
do { _ = try parseScrollRequest(JSONSerialization.data(withJSONObject: invalidScroll)); fatalError("Undeclared scroll must fail") }
catch let result as HelperError { check(!result.unknown) }

let fractionObject: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": fractionCandidate.json], "operation": "scrollDownFraction"]
check(try parseScrollRequest(JSONSerialization.data(withJSONObject: fractionObject)).target.candidate.scrollState == fractionState)
for state: Any in [NSNull(), ["value": true, "minValue": 0, "maxValue": 1], ["value": 0, "minValue": false, "maxValue": 1],
                   ["value": 0, "minValue": 0, "maxValue": true], ["value": 0, "maxValue": 1],
                   ["value": 0, "minValue": 0, "maxValue": 1, "extra": 2], ["value": 2, "minValue": 0, "maxValue": 1]] {
    var rawCandidate = fractionCandidate.json; rawCandidate["scrollState"] = state
    let object: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": rawCandidate], "operation": "scrollDownFraction"]
    do { _ = try parseScrollRequest(JSONSerialization.data(withJSONObject: object)); fatalError("Invalid fraction fingerprint must fail before dispatch") }
    catch let result as HelperError { check(!result.unknown) }
}

let identifierTextObject: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": identifierTextCandidate.json],
    "operation": "insertText", "text": "中文😀"]
check(try parseSetTextRequest(JSONSerialization.data(withJSONObject: identifierTextObject)).target.candidate.identityProfile == .nativeTextIdentifierV1)
check(try parseSetTextRequest(JSONSerialization.data(withJSONObject: identifierTextObject)).target.candidate.identifier == " text-area-id ")
let clippedTextObject: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": clippedTextCandidate.json], "operation": "replaceText", "text": ""]
check(try parseSetTextRequest(JSONSerialization.data(withJSONObject: clippedTextObject)).target.candidate.documentBounds == clippedTextCandidate.documentBounds)
for document: Any in [NSNull(), true, "bounds", semanticBounds.json,
    ["x": semanticBounds.x, "y": semanticBounds.y, "width": 0, "height": 2000],
    ["x": semanticBounds.x + 1, "y": semanticBounds.y, "width": semanticBounds.width, "height": 2000],
    ["x": semanticBounds.x, "y": semanticBounds.y, "width": semanticBounds.width, "height": 2000, "extra": 1]] {
    var rawCandidate = clippedTextCandidate.json; rawCandidate["documentBounds"] = document
    let object: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": rawCandidate], "operation": "replaceText", "text": ""]
    do { _ = try parseSetTextRequest(JSONSerialization.data(withJSONObject: object)); fatalError("Invalid document geometry must fail before dispatch") }
    catch let result as HelperError { check(!result.unknown) }
}
for change: [String: Any] in [["identityProfile": "unknown"], ["identityProfile": NSNull()], ["descriptionDeclared": 1],
    ["descriptionDeclared": "true"], ["descriptionDeclared": NSNull()], ["description": "unused"], ["description": NSNull()],
    ["identifier": ""], ["identifier": "   "], ["identifier": NSNull()], ["role": kAXTextFieldRole], ["title": " "],
    ["operations": ["press", "replaceText"]]] {
    var rawCandidate = identifierTextCandidate.json
    for (key, value) in change { rawCandidate[key] = value }
    let object: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": rawCandidate], "operation": "insertText", "text": "qa"]
    do { _ = try parseSetTextRequest(JSONSerialization.data(withJSONObject: object)); fatalError("Invalid identifier profile must fail before dispatch") }
    catch let result as HelperError { check(!result.unknown) }
}
for missing in ["identityProfile", "descriptionDeclared", "identifier", "operations", "textState"] {
    var rawCandidate = identifierTextCandidate.json; rawCandidate.removeValue(forKey: missing)
    let object: [String: Any] = ["target": ["window": semanticWindow.json, "candidate": rawCandidate], "operation": "insertText", "text": "qa"]
    do { _ = try parseSetTextRequest(JSONSerialization.data(withJSONObject: object)); fatalError("Incomplete identifier profile must fail before dispatch") }
    catch let result as HelperError { check(!result.unknown) }
}

let request = try readClickRequest()
check(request.target.candidate.description == "Toggle fixture")
check(request.target.candidate.subrole == "")
check(request.target.candidate.identifier == "toggle-fixture")
let observed = request.target.candidate
let absent = Candidate(path: observed.path, role: observed.role, title: observed.title,
    description: nil, subrole: nil, identifier: nil, bounds: observed.bounds)
check(!absent.matchesSemanticFields(of: observed))
check(observed.matchesSemanticFields(of: absent))
check(observed.matchesSemanticFields(of: observed))
let onlySubroleMissing = Candidate(path: observed.path, role: observed.role, title: observed.title,
    description: observed.description, subrole: nil, identifier: observed.identifier, bounds: observed.bounds)
check(!onlySubroleMissing.matchesSemanticFields(of: observed))
let onlySubroleChanged = Candidate(path: observed.path, role: observed.role, title: observed.title,
    description: observed.description, subrole: "AXOtherSubrole", identifier: observed.identifier, bounds: observed.bounds)
check(!onlySubroleChanged.matchesSemanticFields(of: observed))
for field in ["description", "subrole", "identifier"] {
    var object = observed.json
    object[field] = NSNull()
    let data = try JSONSerialization.data(withJSONObject: object)
    let decoded = try JSONDecoder().decode(Candidate.self, from: data)
    // Codable considers null absent; the wire field validator must reject it.
    check(decoded.valid)
    check(!(object[field] is String))
}
print("pureChecks=\(checks)")
}
`}`;
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-computer-pure-'));
    try {
      const harnessPath = path.join(directory, 'candidate-protocol.swift');
      await writeFile(harnessPath, harness);
      const result = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', 'swift', harnessPath], {
        encoding: 'utf8', timeout: 25_000, maxBuffer: 64 * 1024,
        input: JSON.stringify({
          x: 50, y: 50, button: 'left', clickCount: 1,
          target: {
            window: { windowId: 84, pid: 123, processStartedAt: 1000, layer: 0, bounds: { x: 0, y: 0, width: 100, height: 100 } },
            candidate: { path: [0], role: 'AXButton', title: '', description: 'Toggle fixture', subrole: '',
              identifier: 'toggle-fixture', bounds: { x: 0, y: 0, width: 100, height: 100 } },
          },
        }),
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^pureChecks=\d+\n$/);
      expect(Number(result.stdout.match(/\d+/)?.[0])).toBeGreaterThan(100);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
