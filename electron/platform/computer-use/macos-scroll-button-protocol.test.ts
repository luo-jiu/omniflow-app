import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('native scrollbar page-button protocol', () => {
  it('binds one exact page action without granting generic press or admitting malformed profiles', async () => {
    const source = await readFile(fileURLToPath(new URL('./macos-click.swift', import.meta.url)), 'utf8');
    const semantic = await readFile(fileURLToPath(new URL('./macos-semantic.swift', import.meta.url)), 'utf8');
    const pureEnd = source.indexOf('func status()');
    const budgetStart = source.indexOf('final class ScanBudget {');
    const budgetEnd = source.indexOf('func axAttribute(', budgetStart);
    const semanticEnd = semantic.indexOf('func nativeSemanticCapabilities(');
    expect(pureEnd).toBeGreaterThan(0);
    expect(budgetEnd).toBeGreaterThan(budgetStart);
    expect(semanticEnd).toBeGreaterThan(0);
    // Execute the real pure protocol with fake values only. All native adapters
    // and helper entrypoints are excluded, so no UI or input API is invoked.
    const harness = `${semantic.slice(0, semanticEnd)}\n${source.slice(0, pureEnd)}\n${source.slice(budgetStart, budgetEnd)}\n${String.raw`
var checks = 0
func check(_ value: Bool) { checks += 1; guard value else { fatalError("Page-button assertion \(checks) failed") } }
let window = WindowIdentity(windowId: 84, pid: 123, processStartedAt: 1000, layer: 0,
    bounds: Rect(x: 0, y: 0, width: 1000, height: 1000), title: nil)
let childBounds = Rect(x: 900, y: 20, width: 20, height: 50)
let parentBounds = Rect(x: 900, y: 10, width: 30, height: 2000)
func pageCandidate(subrole: String = kAXIncrementPageSubrole, orientation: ScrollOrientation = .vertical,
                   parent: Rect = parentBounds) -> Candidate {
    Candidate(path: [0, 1], role: kAXButtonRole, title: "", description: nil, subrole: subrole, identifier: nil,
        bounds: childBounds, operations: nativeScrollButtonOperation(subrole: subrole, orientation: orientation).map { [$0] },
        enabledState: .absent, identityProfile: .nativeScrollButtonV1,
        scrollButtonState: ScrollButtonState(parentBounds: parent, orientation: orientation))
}
func request(_ candidate: [String: Any], operation: SemanticOperation = .scrollDownPage) -> [String: Any] {
    ["operation": operation.rawValue, "target": ["window": window.json, "candidate": candidate]]
}
func rejects(_ candidate: [String: Any], operation: SemanticOperation = .scrollDownPage) -> Bool {
    guard let data = try? JSONSerialization.data(withJSONObject: request(candidate, operation: operation)) else { return true }
    return (try? parseScrollRequest(data)) == nil
}
for error in [AXError.attributeUnsupported, .noValue] {
    for mask in 0..<16 {
        check(nativeScrollButtonEligible(role: mask & 1 != 0 ? kAXButtonRole : kAXScrollAreaRole,
            nativeContext: mask & 2 != 0, actions: mask & 4 != 0 ? [kAXPressAction] : [],
            enabledError: error, enabledRaw: nil, hasRoot: mask & 8 != 0) == (mask == 15))
    }
    check(!nativeScrollButtonEligible(role: kAXButtonRole, nativeContext: true, actions: [kAXPressAction],
        enabledError: error, enabledRaw: kCFBooleanTrue, hasRoot: true))
    let ordinary = ScanBudget()
    check(candidateEnabledCapabilities(error, nil, role: kAXButtonRole, operations: [.press], budget: ordinary) == nil)
    check(ordinary.truncated && ordinary.firstAXErrorCode == error.rawValue)
}
for error in [AXError.success, .failure, .cannotComplete, .apiDisabled] {
    for raw: CFTypeRef? in [nil, kCFBooleanTrue, kCFBooleanFalse, NSNumber(value: 1)] {
        check(!nativeScrollButtonEligible(role: kAXButtonRole, nativeContext: true, actions: [kAXPressAction],
            enabledError: error, enabledRaw: raw, hasRoot: true))
    }
}
for (subrole, orientation, operation) in [
    (kAXIncrementPageSubrole, ScrollOrientation.vertical, SemanticOperation.scrollDownPage),
    (kAXDecrementPageSubrole, .vertical, .scrollUpPage),
    (kAXIncrementPageSubrole, .horizontal, .scrollRightPage),
    (kAXDecrementPageSubrole, .horizontal, .scrollLeftPage)
] {
    let candidate = pageCandidate(subrole: subrole, orientation: orientation)
    check(candidate.valid && candidate.effectiveOperations == [operation])
    check(!candidate.effectiveOperations.contains(.press))
    check(semanticScrollAction(candidate: candidate, operation: operation) == kAXPressAction)
    for wrong in SemanticOperation.allCases where wrong != operation {
        check(semanticScrollAction(candidate: candidate, operation: wrong) == nil)
        check(rejects(candidate.json, operation: wrong))
    }
    check(validSemanticTarget(SemanticTarget(window: window, candidate: candidate), operation: operation))
    let data = try JSONSerialization.data(withJSONObject: request(candidate.json, operation: operation))
    let parsed = try parseScrollRequest(data)
    check(parsed.target.candidate.matchesSemanticFields(of: candidate))
    check(parsed.target.candidate.scrollButtonState == candidate.scrollButtonState)
    check(parsed.target.candidate.json["descriptionDeclared"] == nil)
}
for subrole in [nil, kAXIncrementArrowSubrole, kAXDecrementArrowSubrole, "AXIncrementPage\n", "AXUnknown"] as [String?] {
    check(nativeScrollButtonOperation(subrole: subrole, orientation: .vertical) == nil)
    check(nativeScrollButtonOperation(subrole: subrole, orientation: .horizontal) == nil)
}
let candidate = pageCandidate()
check(!window.bounds.contains(parentBounds) && parentBounds.contains(childBounds) && candidate.valid)
for (field, value) in [
    ("path", [] as Any), ("role", kAXScrollBarRole), ("title", "unsafe\nname"), ("title", "unsafe\u{202e}name"),
    ("subrole", kAXIncrementArrowSubrole), ("subrole", kAXDecrementPageSubrole), ("subrole", NSNull()),
    ("operations", ["press"]), ("operations", ["scrollDownPage", "press"]), ("operations", ["scrollUpPage"]),
    ("enabledState", "enabled"), ("enabledState", NSNull()), ("description", "identity"), ("identifier", "identity"),
    ("descriptionDeclared", false), ("documentBounds", parentBounds.json), ("orientation", "vertical"),
    ("textState", ["subrole": NSNull()]), ("scrollState", ["value": 0, "minValue": 0, "maxValue": 1]),
    ("identityProfile", "native-text-identifier-v1"), ("scrollButtonState", NSNull())
] as [(String, Any)] {
    var malformed = candidate.json; malformed[field] = value
    check(rejects(malformed))
}
for field in ["operations", "enabledState", "subrole", "identityProfile", "scrollButtonState"] {
    var malformed = candidate.json; malformed.removeValue(forKey: field)
    check(rejects(malformed))
}
for state in [
    ["parentBounds": parentBounds.json], ["orientation": "vertical"],
    ["parentBounds": parentBounds.json, "orientation": "horizontal"],
    ["parentBounds": parentBounds.json, "orientation": "unknown"],
    ["parentBounds": parentBounds.json, "orientation": NSNull()],
    ["parentBounds": parentBounds.json, "orientation": "vertical", "extra": true],
    ["parentBounds": Rect(x: 900, y: 10, width: 0, height: 2000).json, "orientation": "vertical"],
    ["parentBounds": Rect(x: 900, y: 10, width: 10, height: 2000).json, "orientation": "vertical"],
    ["parentBounds": ["x": 900, "y": 10, "width": true, "height": 2000], "orientation": "vertical"]
] as [[String: Any]] {
    var malformed = candidate.json; malformed["scrollButtonState"] = state
    check(rejects(malformed))
}
for rectangle in [Rect(x: .nan, y: 10, width: 30, height: 2000), Rect(x: 900, y: 10, width: 30, height: .infinity)] {
    check(!pageCandidate(parent: rectangle).valid)
}
let changedParent = pageCandidate(parent: Rect(x: 900, y: 10, width: 30, height: 1999))
let changedAxis = pageCandidate(orientation: .horizontal)
let changedSubrole = pageCandidate(subrole: kAXDecrementPageSubrole)
for changed in [changedParent, changedAxis, changedSubrole] {
    check(changed.valid && !changed.matchesSemanticFields(of: candidate) && !candidate.matchesSemanticFields(of: changed))
}
var ordinary = Candidate(path: [0], role: kAXScrollAreaRole, title: "", description: nil, subrole: nil,
    identifier: nil, bounds: childBounds, operations: [.scrollDownPage], enabledState: .enabled)
check(ordinary.valid && semanticScrollAction(candidate: ordinary, operation: .scrollDownPage) == "AXScrollDownByPage")
ordinary.scrollButtonState = candidate.scrollButtonState
check(!ordinary.valid)
check(candidateIdentityFields(profile: .nativeScrollButtonV1, attributes: [], read: { _ in
    fatalError("Scroll button must not use ordinary identity getters")
}) == nil)
for result in [AXError.attributeUnsupported, .actionUnsupported, .cannotComplete, .failure, .apiDisabled] {
    do { try mutationResult(result); fatalError("Failed mutation must be unknown") }
    catch let error as HelperError { check(error.unknown && error.code == "ax_action_unknown") }
}
try mutationResult(.success)
print("pageButtonChecks=\(checks)")
`}`;
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-scroll-button-protocol-'));
    try {
      const harnessPath = path.join(directory, 'scroll-button-protocol.swift');
      await writeFile(harnessPath, harness);
      const result = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', 'swift', harnessPath], {
        encoding: 'utf8', timeout: 25_000, maxBuffer: 64 * 1024,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^pageButtonChecks=\d+\n$/);
      expect(Number(result.stdout.match(/\d+/)?.[0])).toBeGreaterThan(200);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
