import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('bounded macOS observation scope', () => {
  it('validates absolute ancestry, sensitive branches, complete anchors and strict scoped parsing without native UI reads', async () => {
    const source = await readFile(fileURLToPath(new URL('./macos-click.swift', import.meta.url)), 'utf8');
    const semantic = await readFile(fileURLToPath(new URL('./macos-semantic.swift', import.meta.url)), 'utf8');
    const pureEnd = source.indexOf('func status()');
    const budgetStart = source.indexOf('final class ScanBudget {');
    const budgetEnd = source.indexOf('func axAttribute(', budgetStart);
    const semanticEnd = semantic.indexOf('func nativeSemanticCapabilities(');
    expect(pureEnd).toBeGreaterThan(0);
    expect(budgetEnd).toBeGreaterThan(budgetStart);
    expect(semanticEnd).toBeGreaterThan(0);
    // Compile only production pure policies plus budgets/BFS. Every node and
    // reader below is fake; native adapters and helper entrypoint are excluded.
    const harness = `${semantic.slice(0, semanticEnd)}\n${source.slice(0, pureEnd)}\n${source.slice(budgetStart, budgetEnd)}\n${String.raw`
var checks = 0
func check(_ value: Bool) {
    checks += 1
    guard value else { fatalError("Observation scope assertion \(checks) failed") }
}
let anchorPath = [2, 1, 3, 0]
let baseIdentities: [Int: ObservationScopeNodeIdentity] = [
    0: ObservationScopeNodeIdentity(pid: 123, role: kAXWindowRole),
    1: ObservationScopeNodeIdentity(pid: 123, role: kAXGroupRole),
    2: ObservationScopeNodeIdentity(pid: 123, role: "AXWebArea"),
    3: ObservationScopeNodeIdentity(pid: 123, role: kAXGroupRole),
    4: ObservationScopeNodeIdentity(pid: 123, role: kAXButtonRole)
]
let baseParents = [1: 0, 2: 1, 3: 2, 4: 3]
let baseChildren = [0: [90, 91, 1], 1: [92, 2], 2: [93, 94, 95, 3], 3: [4]]
var identities = baseIdentities, parents = baseParents, children = baseChildren
var reads = 0, anchorReads = 0, prefixes: [Int] = []
func reset() {
    identities = baseIdentities; parents = baseParents; children = baseChildren
    reads = 0; anchorReads = 0; prefixes = []
}
func resolve(_ path: [Int] = anchorPath, levels: Int = 0, pid: Int32 = 123,
             budget: ScanBudget? = nil, validAnchor: Bool = true) -> ResolvedObservationScope<Int>? {
    resolveObservationScope(0, path: path, ancestorLevels: levels, pid: pid, budget: budget,
        equal: { $0 == $1 }, readIdentity: { reads += 1; return identities[$0] },
        readParent: { reads += 1; return parents[$0] }, readChildren: { node, count in
            reads += 1; prefixes.append(count)
            return children[node].map { Array($0.prefix(count)) }
        }, validateAnchor: { node, context in
            anchorReads += 1; check(node == 4 && !context)
            return validAnchor
        })
}
for levels in 0...3 {
    reset()
    let scope = resolve(levels: levels)
    check(scope?.element == 4 - levels)
    check(scope?.path == Array(anchorPath.prefix(anchorPath.count - levels)))
    check(scope?.nativeContext == (levels == 3))
    check(anchorReads == 1 && prefixes == [3, 2, 4, 1])
}
reset(); check(resolve(validAnchor: false) == nil && anchorReads == 1)
for (path, level, pid) in [(anchorPath, -1, Int32(123)), (anchorPath, 4, 123), ([2], 2, 123),
                           (Array(repeating: 0, count: 33), 0, 123), ([64], 0, 123), ([-1], 0, 123),
                           (anchorPath, 0, 0), (anchorPath, 0, -1)] {
    reset(); check(resolve(path, levels: level, pid: pid) == nil && reads == 0 && anchorReads == 0)
}
reset()
let expired = ScanBudget(deadline: 0)
check(resolve(budget: expired) == nil && reads == 0 && expired.truncated)
reset()
let sharedBudget = ScanBudget()
sharedBudget.nodes = 2043
check(resolve(budget: sharedBudget) != nil && sharedBudget.nodes == 2048 && sharedBudget.maxDepth == 4)
var afterScope: [Candidate] = [], afterScopeReads = 0
scanCandidatesBreadthFirst(4, path: anchorPath, budget: sharedBudget, result: &afterScope,
    readRole: { _ in afterScopeReads += 1; return kAXButtonRole },
    readCandidate: { _, _, _, _ in afterScopeReads += 1; return nil },
    readChildren: { _ in afterScopeReads += 1; return [] })
check(sharedBudget.nodes == 2048 && sharedBudget.truncated && afterScopeReads == 0)
reset()
let insufficient = ScanBudget()
insufficient.nodes = 2044
check(resolve(budget: insufficient) == nil && insufficient.nodes == 2048 && insufficient.truncated && anchorReads == 0)
reset()
let full = ScanBudget()
full.nodes = 2048
check(resolve(budget: full) == nil && reads == 0 && full.nodes == 2048 && full.truncated)
for root in [ObservationScopeNodeIdentity(pid: 456, role: kAXWindowRole),
             ObservationScopeNodeIdentity(pid: 123, role: kAXGroupRole),
             ObservationScopeNodeIdentity(pid: 123, role: kAXWindowRole, secureTextField: true)] {
    reset(); identities[0] = root
    check(resolve() == nil && reads == 1 && anchorReads == 0)
}
for index in 1...4 {
    for identity in [ObservationScopeNodeIdentity(pid: 456, role: kAXGroupRole),
                     ObservationScopeNodeIdentity(pid: 123, role: kAXWindowRole),
                     ObservationScopeNodeIdentity(pid: 123, role: kAXApplicationRole),
                     ObservationScopeNodeIdentity(pid: 123, role: "AXSecureTextArea"),
                     ObservationScopeNodeIdentity(pid: 123, role: kAXTextFieldRole, secureTextField: true),
                     ObservationScopeNodeIdentity(pid: 123, role: ""),
                     ObservationScopeNodeIdentity(pid: 123, role: "AXGroup\n"),
                     ObservationScopeNodeIdentity(pid: 123, role: String(repeating: "a", count: 65))] {
        reset(); identities[index] = identity
        check(resolve() == nil && anchorReads == 0)
    }
    reset(); identities.removeValue(forKey: index) // Missing/unknown TextField classification.
    check(resolve() == nil && anchorReads == 0)
    reset(); parents[index] = 99
    check(resolve() == nil && anchorReads == 0)
    reset(); parents.removeValue(forKey: index)
    check(resolve() == nil && anchorReads == 0)
}
reset(); children[1] = [92, 0]
check(resolve() == nil && anchorReads == 0)
reset(); children[2] = [93]
check(resolve() == nil && anchorReads == 0)
// A reader consuming the deadline cannot trigger the next reader or anchor check.
var delayedReads: [String] = []
let deadline = ScanBudget(deadline: DispatchTime.now().uptimeNanoseconds + 2_000_000)
let delayed = resolveObservationScope(0, path: [0], ancestorLevels: 0, pid: 123, budget: deadline,
    equal: { $0 == $1 }, readIdentity: { node in
        delayedReads.append("identity")
        return ObservationScopeNodeIdentity(pid: 123, role: node == 0 ? kAXWindowRole : kAXButtonRole)
    }, readParent: { _ in delayedReads.append("parent"); return 0 }, readChildren: { _, _ in
        delayedReads.append("children")
        let until = DispatchTime.now().uptimeNanoseconds + 4_000_000
        while DispatchTime.now().uptimeNanoseconds < until {}
        return [1]
    }, validateAnchor: { _, _ in delayedReads.append("anchor"); return true })
check(delayed == nil && delayedReads == ["identity", "children"] && deadline.truncated)

let bounds = Rect(x: 10, y: 20, width: 30, height: 40)
let anchor = Candidate(path: anchorPath, role: kAXButtonRole, title: "Fixture", description: "Local", subrole: nil,
                       identifier: "fixture", bounds: bounds, operations: [.press], enabledState: .enabled)
check(sameObservationScopeAnchor(anchor, anchor))
func candidate(_ fields: [String: Any], base: Candidate = anchor) -> Candidate {
    var object = base.json
    for (name, value) in fields { object[name] = value }
    return try! JSONDecoder().decode(Candidate.self, from: JSONSerialization.data(withJSONObject: object))
}
for fields: [String: Any] in [["path": [2, 1, 3, 1]], ["role": kAXCheckBoxRole], ["title": "Other"],
                            ["bounds": Rect(x: 11, y: 20, width: 30, height: 40).json],
                            ["description": "Different"], ["description": NSNull()],
                            ["subrole": "AXToggle"], ["identifier": "different"],
                            ["operations": NSNull()], ["enabledState": NSNull()]] {
    check(!sameObservationScopeAnchor(candidate(fields), anchor))
}
// Optional semantic presence is bound even for legacy receipts.
var legacy = anchor.json; legacy.removeValue(forKey: "operations"); legacy.removeValue(forKey: "enabledState")
let legacyAnchor = try! JSONDecoder().decode(Candidate.self, from: JSONSerialization.data(withJSONObject: legacy))
var added = legacy; added["subrole"] = "AXToggle"
check(!sameObservationScopeAnchor(try! JSONDecoder().decode(Candidate.self, from: JSONSerialization.data(withJSONObject: added)), legacyAnchor))
let text = Candidate(path: anchorPath, role: kAXTextAreaRole, title: "", description: nil, subrole: nil,
    identifier: "text-fixture", bounds: bounds, operations: [.replaceText, .insertText],
    textState: TextState(subrole: nil, selection: TextSelection(location: 0, length: 0)), enabledState: .enabled,
    identityProfile: .nativeTextIdentifierV1, descriptionDeclared: true,
    documentBounds: Rect(x: 10, y: 20, width: 30, height: 400))
check(text.valid && sameObservationScopeAnchor(text, text))
for fields: [String: Any] in [["textState": ["subrole": NSNull(), "selection": ["location": 1, "length": 0]]],
    ["textState": ["subrole": "AXTextArea", "selection": ["location": 0, "length": 0]]],
    ["operations": ["replaceText"]], ["enabledState": "absent"], ["descriptionDeclared": false],
    ["documentBounds": Rect(x: 10, y: 20, width: 30, height: 401).json],
    ["identityProfile": NSNull(), "descriptionDeclared": NSNull(), "documentBounds": NSNull()]] {
    let changed = candidate(fields, base: text)
    check(changed.valid && !sameObservationScopeAnchor(changed, text))
}
let scrollbar = Candidate(path: anchorPath, role: kAXScrollBarRole, title: "Fixture", description: nil, subrole: nil,
    identifier: nil, bounds: bounds, operations: [.scrollDownFraction], orientation: .vertical, enabledState: .enabled,
    scrollState: ScrollState(value: 0.5, minValue: 0, maxValue: 1))
check(scrollbar.valid && sameObservationScopeAnchor(scrollbar, scrollbar))
for fields: [String: Any] in [["scrollState": ["value": 0.6, "minValue": 0, "maxValue": 1]],
    ["scrollState": ["value": 0.5, "minValue": -1, "maxValue": 1]],
    ["scrollState": ["value": 0.5, "minValue": 0, "maxValue": 2]],
    ["orientation": "horizontal", "operations": ["scrollRightFraction"]]] {
    let changed = candidate(fields, base: scrollbar)
    check(changed.valid && !sameObservationScopeAnchor(changed, scrollbar))
}
let pageButton = Candidate(path: anchorPath, role: kAXButtonRole, title: "Fixture", description: nil,
    subrole: kAXIncrementPageSubrole, identifier: nil, bounds: bounds, operations: [.scrollDownPage],
    enabledState: .absent, identityProfile: .nativeScrollButtonV1,
    scrollButtonState: ScrollButtonState(parentBounds: Rect(x: 0, y: 0, width: 100, height: 100), orientation: .vertical))
check(pageButton.valid && sameObservationScopeAnchor(pageButton, pageButton))
for fields: [String: Any] in [["scrollButtonState": ["parentBounds": Rect(x: 0, y: 0, width: 101, height: 100).json, "orientation": "vertical"]],
    ["scrollButtonState": ["parentBounds": Rect(x: 0, y: 0, width: 100, height: 100).json, "orientation": "horizontal"], "operations": ["scrollRightPage"]],
    ["subrole": kAXDecrementPageSubrole, "operations": ["scrollUpPage"]]] {
    let changed = candidate(fields, base: pageButton)
    check(changed.valid && !sameObservationScopeAnchor(changed, pageButton))
}

let window = WindowIdentity(windowId: 5, pid: 123, processStartedAt: 1, layer: 0,
                            bounds: Rect(x: 0, y: 0, width: 200, height: 200), title: "Fixture")
func request(_ fields: [String: Any], allow: Bool = true) -> WindowRequest? {
    guard let data = try? JSONSerialization.data(withJSONObject: fields) else { return nil }
    return try? parseWindowRequest(data, allowScope: allow)
}
check(request(["window": window.json])?.scope == nil)
check(request(["window": window.json], allow: false) != nil)
for level in 0...3 {
    let result = request(["window": window.json, "scope": ["anchor": anchor.json, "ancestorLevels": level]])
    check(result?.scope?.ancestorLevels == level && result?.scope?.anchor.path == anchorPath)
}
let scope: [String: Any] = ["anchor": anchor.json, "ancestorLevels": 0]
check(request(["window": window.json, "scope": scope], allow: false) == nil)
for invalid: Any in [NSNull(), [], ["anchor": anchor.json], ["ancestorLevels": 0],
                     ["anchor": anchor.json, "ancestorLevels": 0, "extra": true]] {
    check(request(["window": window.json, "scope": invalid]) == nil)
}
for level: Any in [-1, 4, 1.5, "1", true, NSNull()] {
    check(request(["window": window.json, "scope": ["anchor": anchor.json, "ancestorLevels": level]]) == nil)
}
for fields: [String: Any] in [["source": "omniflow"], ["path": [0]], ["identityProfile": "unknown"],
                            ["textState": ["subrole": NSNull()]], ["bounds": Rect(x: -1, y: 0, width: 1, height: 1).json],
                            ["documentBounds": bounds.json]] {
    var value = anchor.json
    for (key, field) in fields { value[key] = field }
    check(request(["window": window.json, "scope": ["anchor": value, "ancestorLevels": 2]]) == nil)
}
let duplicated = "{\"window\":\(String(data: try! JSONSerialization.data(withJSONObject: window.json), encoding: .utf8)!),\"scope\":{\"anchor\":\(String(data: try! JSONSerialization.data(withJSONObject: anchor.json), encoding: .utf8)!),\"ancestorLevels\":0,\"ancestorLevels\":1}}"
check((try? parseWindowRequest(Data(duplicated.utf8), allowScope: true)) == nil)

for role in ["AXSecureTextArea", "AXSecureGroup", "", "AXGroup\n"] {
    check(!safeScopedObservationRole(role))
}
for subrole: String? in [nil, "AXSecureTextField", "AXUnknown", ""] {
    check(!safeScopedObservationRole(kAXTextFieldRole, textFieldSubrole: subrole))
}
check(safeScopedObservationRole(kAXTextFieldRole, textFieldSubrole: kAXSearchFieldSubrole))
check(safeScopedObservationRole(kAXTextFieldRole, textFieldSubrole: "AXTextField"))
check(safeScopedObservationRole(kAXGroupRole))
// Scoped BFS never enters sensitive descendants or foreign roots, retains
// absolute paths and the inherited non-native context below WebArea.
func scan(_ roles: [Int: String], subroles: [Int: String] = [:], rootPath: [Int] = [2, 1],
          context: Bool = false) -> ([Int], [[Int]], [Bool], ScanBudget) {
    var readCandidates: [Int] = [], paths: [[Int]] = [], contexts: [Bool] = [], output: [Candidate] = []
    let budget = ScanBudget()
    scanCandidatesBreadthFirst(2, path: rootPath, budget: budget, result: &output, nativeContext: context,
        readRole: { roles[$0] }, allowBranch: { node, role in
            role.map { safeScopedObservationRole($0, textFieldSubrole: subroles[node]) } ?? false
        }, readCandidate: { node, path, nativeContext, _ in
            readCandidates.append(node); paths.append(path); contexts.append(nativeContext); return nil
        }, readChildren: { node in
            if node == 2 { return [3] }; if node == 3 { return [4] }; return []
        })
    return (readCandidates, paths, contexts, budget)
}
let normal = scan([2: kAXGroupRole, 3: kAXGroupRole, 4: kAXButtonRole])
check(normal.0 == [2, 3, 4] && normal.1 == [[2, 1], [2, 1, 0], [2, 1, 0, 0]])
check(normal.2 == [false, false, false] && !normal.3.truncated)
for role in ["AXSecureTextArea", kAXTextFieldRole, kAXWindowRole, kAXApplicationRole] {
    let blocked = scan([2: kAXGroupRole, 3: role, 4: kAXTextAreaRole], subroles: [3: "AXSecureTextField"], context: true)
    check(blocked.0 == [2] && blocked.1 == [[2, 1]] && blocked.3.truncated)
}
let maxDepth = scan([2: kAXGroupRole, 3: kAXGroupRole, 4: kAXButtonRole], rootPath: Array(repeating: 0, count: 31))
check(maxDepth.0 == [2, 3] && maxDepth.1.map { $0.count } == [31, 32] && maxDepth.3.depthLimit && maxDepth.3.truncated)
let approvedRoot = scan([2: kAXWindowRole, 3: kAXGroupRole, 4: kAXButtonRole], rootPath: [], context: true)
check(approvedRoot.0 == [2, 3, 4] && approvedRoot.1 == [[], [0], [0, 0]])
print("observationScopePolicies=passed")
`}`;
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-observation-scope-'));
    try {
      const harnessPath = path.join(directory, 'observation-scope.swift');
      await writeFile(harnessPath, harness);
      const result = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', 'swift', harnessPath], {
        encoding: 'utf8', timeout: 25_000, maxBuffer: 64 * 1024,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('observationScopePolicies=passed\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
