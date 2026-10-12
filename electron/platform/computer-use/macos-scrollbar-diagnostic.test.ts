import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('read-only macOS scrollbar diagnostic', () => {
  it('restricts probes to debug approved-window scans and confirms bounded native ancestry', async () => {
    const source = await readFile(fileURLToPath(new URL('./macos-click.swift', import.meta.url)), 'utf8');
    const semantic = await readFile(fileURLToPath(new URL('./macos-semantic.swift', import.meta.url)), 'utf8');
    const pureEnd = source.indexOf('func status()');
    const budgetStart = source.indexOf('final class ScanBudget {');
    const budgetEnd = source.indexOf('func axAttribute(', budgetStart);
    const semanticEnd = semantic.indexOf('func nativeSemanticCapabilities(');
    expect(pureEnd).toBeGreaterThan(0);
    expect(budgetEnd).toBeGreaterThan(budgetStart);
    expect(semanticEnd).toBeGreaterThan(0);
    // All native adapters and the helper entrypoint are excluded. The production
    // policies below run only against fake nodes/readers; they send no input.
    const harness = `${semantic.slice(0, semanticEnd)}\n${source.slice(0, pureEnd)}\n${source.slice(budgetStart, budgetEnd)}\n${String.raw`
func check(_ value: Bool) { guard value else { fatalError("Scrollbar diagnostic policy failed") } }
for error in [AXError.attributeUnsupported, .noValue] {
    for mask in 0..<128 {
        check(shouldProbeScrollbarChild(debug: mask & 1 != 0, windowTargetsScan: mask & 2 != 0,
            role: mask & 4 != 0 ? kAXButtonRole : kAXTextAreaRole, nativeContext: mask & 8 != 0,
            enabledError: error, enabledRawPresent: mask & 16 == 0, hasRoot: mask & 32 != 0,
            hasBudget: mask & 64 != 0) == (mask == 127))
    }
}
for error in [AXError.success, .failure, .cannotComplete] {
    check(!shouldProbeScrollbarChild(debug: true, windowTargetsScan: true, role: kAXButtonRole,
        nativeContext: true, enabledError: error, enabledRawPresent: false, hasRoot: true, hasBudget: true))
}
for (subrole, kind) in [(kAXIncrementArrowSubrole, 1), (kAXDecrementArrowSubrole, 2),
                       (kAXIncrementPageSubrole, 3), (kAXDecrementPageSubrole, 4)] {
    check(scrollbarChildDiagnosticKind(.success, subrole as NSString)?.rawValue == kind)
    check(scrollbarChildDiagnosticKind(.noValue, subrole as NSString) == nil)
}
for raw: CFTypeRef? in [nil, NSNumber(value: 1), "AXUntrustedTitle" as NSString, "AXIncrementArrow\n" as NSString] {
    check(scrollbarChildDiagnosticKind(.success, raw) == nil)
}
let budget = ScanBudget(deadline: 0)
for _ in 0..<8 { check(budget.claimScrollbarChildDiagnostic()) }
for _ in 0..<100 { check(!budget.claimScrollbarChildDiagnostic()) }
check(budget.scrollbarChildDiagnostics == 8 && budget.candidateDiagnostics == 0)
check(!budget.truncated && budget.firstAXErrorCode == nil && budget.nodes == 0 && budget.candidates == 0 && budget.textBytes == 0)

func parent(_ element: Int, _ role: String, _ pid: Int32 = 123) -> NativeTextAncestor<Int> {
    NativeTextAncestor(element: element, role: role, pid: pid, bounds: nil)
}
func relation(_ nodes: [Int: NativeTextAncestor<Int>], root: Int = 3) -> ScrollbarChildRelation {
    scrollbarChildRelation(0, root: root, pid: 123, equal: { $0 == $1 }, readParent: { node, _ in nodes[node] })
}
let valid = [0: parent(1, kAXScrollBarRole), 1: parent(2, kAXScrollAreaRole), 2: parent(3, kAXWindowRole)]
let approved = relation(valid)
check(approved.parentRole == .scrollbar && approved.parentPIDConfirmed && approved.windowConfirmed && approved.depth == 3 && approved.failure == .none)
check(!relation([:]).windowConfirmed && relation([:]).failure == .parentUnreadable)
check(relation([0: parent(1, kAXGroupRole)]).failure == .parentNotScrollbar)
check(relation([0: parent(1, kAXScrollBarRole, 456)]).failure == .processMismatch)
for pid: Int32 in [0, -1, 456] {
    var changed = valid; changed[1] = parent(2, kAXScrollAreaRole, pid)
    check(!relation(changed).windowConfirmed && relation(changed).failure == .processMismatch)
}
for role in ["AXWebArea", "AXSecureTextArea", kAXApplicationRole, ""] {
    var changed = valid; changed[1] = parent(2, role)
    check(!relation(changed).windowConfirmed && relation(changed).failure == .nonNative)
}
var foreign = valid; foreign[2] = parent(4, kAXWindowRole)
check(!relation(foreign).windowConfirmed && relation(foreign).failure == .foreignWindow)
check(!relation(valid, root: 2).windowConfirmed && relation(valid, root: 2).failure == .nonNative)
check(relation([0: parent(0, kAXScrollBarRole)]).failure == .cycle)
var cycle = valid; cycle[1] = parent(1, kAXScrollAreaRole)
check(!relation(cycle).windowConfirmed && relation(cycle).failure == .cycle)
var tooDeep = [0: parent(1, kAXScrollBarRole)]
for depth in 1..<maximumAXPathDepth { tooDeep[depth] = parent(depth + 1, kAXGroupRole) }
tooDeep[maximumAXPathDepth] = parent(99, kAXWindowRole)
check(relation(tooDeep, root: 99).failure == .depthLimit)
var reads = 0
let bounded = scrollbarChildRelation(0, root: 99, pid: 123, equal: { $0 == $1 }, readParent: { node, immediate in
    check(immediate == (reads == 0)); reads += 1
    return tooDeep[node]
})
check(!bounded.windowConfirmed && reads == maximumAXPathDepth)
print("scrollbarDiagnosticPolicies=passed")
`}`;
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-scrollbar-diagnostic-'));
    try {
      const harnessPath = path.join(directory, 'scrollbar-diagnostic.swift');
      await writeFile(harnessPath, harness);
      const result = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', 'swift', harnessPath], {
        encoding: 'utf8', timeout: 25_000, maxBuffer: 64 * 1024,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('scrollbarDiagnosticPolicies=passed\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
