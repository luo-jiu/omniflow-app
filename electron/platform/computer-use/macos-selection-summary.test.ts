import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('macOS read-only selection summary', () => {
  it('keeps native scope, UTF-16 selection evidence and output budgets without reading or changing apps', async () => {
    const source = await readFile(fileURLToPath(new URL('./macos-click.swift', import.meta.url)), 'utf8');
    const semantic = await readFile(fileURLToPath(new URL('./macos-semantic.swift', import.meta.url)), 'utf8');
    const pureEnd = source.indexOf('func status()');
    const budgetStart = source.indexOf('final class ScanBudget {');
    const budgetEnd = source.indexOf('func axAttribute(', budgetStart);
    const treeStart = source.indexOf('final class AXTreeBudget {');
    const treeEnd = source.indexOf('func treeAttribute(', treeStart);
    const semanticEnd = semantic.indexOf('func nativeSemanticCapabilities(');
    expect(pureEnd).toBeGreaterThan(0);
    expect(budgetEnd).toBeGreaterThan(budgetStart);
    expect(treeEnd).toBeGreaterThan(treeStart);
    expect(semanticEnd).toBeGreaterThan(0);
    // These are the production summary policies. Fake attribute reads and local
    // AXValue ranges do not access another process or call native UI entrypoints.
    const harness = `${semantic.slice(0, semanticEnd)}\n${source.slice(0, pureEnd)}\n${source.slice(budgetStart, budgetEnd)}\n${source.slice(treeStart, treeEnd)}\n${String.raw`
var checks = 0
func check(_ value: Bool) {
    checks += 1
    guard value else { fatalError("Selection summary assertion \(checks) failed") }
}
func budget(_ maximum: Int = 64 * 1024, expired: Bool = false) -> AXTreeBudget {
    AXTreeBudget(scanDeadline: expired ? 0 : DispatchTime.now().uptimeNanoseconds + 5_000_000_000,
                 maximumEncodedBytes: maximum)
}
func range(_ location: Int, _ length: Int) -> CFTypeRef {
    var value = CFRange(location: location, length: length)
    return AXValueCreate(.cfRange, &value)!
}
func context(_ parent: Bool, _ role: String, subrole: String? = nil, error: AXError = .noValue,
             root: Bool = false, summary: AXTreeBudget? = nil) -> (Bool, Int) {
    var reads = 0
    let allowed = treeSelectionContext(parent, role: role, root: root, budget: summary ?? budget()) {
        reads += 1
        return (error, subrole.map { $0 as NSString })
    }
    return (allowed, reads)
}
for role in ["AXWebArea", "AXSecureTextArea", kAXApplicationRole, ""] {
    let rejected = context(true, role)
    check(!rejected.0 && rejected.1 == 0)
    check(!context(rejected.0, kAXTextAreaRole).0)
}
check(context(true, kAXWindowRole, root: true).0)
check(!context(true, kAXWindowRole).0)
check(context(true, kAXGroupRole).0)
check(context(true, kAXTextAreaRole).0)
check(context(true, kAXTextAreaRole, error: .attributeUnsupported).0)
check(!context(true, kAXTextFieldRole).0)
for role in [kAXTextFieldRole, kAXTextAreaRole] {
    check(!context(false, role, subrole: "AXTextField", error: .success).0)
    let secure = context(true, role, subrole: "AXSecureTextField", error: .success)
    check(!secure.0 && secure.1 == 1)
    check(!context(secure.0, kAXTextAreaRole).0)
    check(!context(true, role, error: .failure).0)
    check(!context(true, role, subrole: "AXTextField", error: .noValue).0)
    let expired = budget(expired: true)
    let unavailable = context(true, role, summary: expired)
    check(!unavailable.0 && unavailable.1 == 0 && expired.truncated)
}
check(context(true, kAXTextFieldRole, subrole: "AXTextField", error: .success).0)
check(context(true, kAXTextFieldRole, subrole: kAXSearchFieldSubrole, error: .success).0)
check(!context(true, kAXTextFieldRole, subrole: "AXUnknown", error: .success).0)

func fields(_ location: Int = 49, _ length: Int = 7, text: CFTypeRef? = "charlie" as NSString,
            textError: AXError = .success, rangeError: AXError = .success, lastRange: CFTypeRef? = nil,
            rawRange: CFTypeRef? = nil, summary: AXTreeBudget? = nil) -> ([String], [String], AXTreeBudget) {
    let summary = summary ?? budget()
    var reads: [String] = [], rangeReads = 0
    let result = treeSelectedTextFields(budget: summary) { attribute in
        reads.append(attribute)
        if attribute == kAXSelectedTextRangeAttribute {
            rangeReads += 1
            return (rangeError, rangeReads > 1 ? (lastRange ?? rawRange ?? range(location, length)) : (rawRange ?? range(location, length)))
        }
        check(attribute == kAXSelectedTextAttribute)
        return (textError, text)
    }
    return (result, reads, summary)
}
let selected = fields()
check(selected.0 == ["selectedRangeUTF16=[49,7]", "selectedText=\"charlie\"", "selectedTextTruncated=false"])
check(selected.1 == [kAXSelectedTextRangeAttribute, kAXSelectedTextAttribute, kAXSelectedTextRangeAttribute])
check(!selected.2.truncated)
let unicode = fields(3, 7, text: " 中😀\n \t" as NSString)
check(unicode.0 == ["selectedRangeUTF16=[3,7]", "selectedText=\" 中😀\\n \\t\"", "selectedTextTruncated=false"])
check(!unicode.2.truncated)
let caret = fields(56, 0)
check(caret.0 == ["selectedRangeUTF16=[56,0]"] && caret.1 == [kAXSelectedTextRangeAttribute])
let changed = fields(lastRange: range(50, 7))
check(changed.0.isEmpty && changed.2.truncated)
let wrongUnits = fields(3, 1, text: "😀" as NSString)
check(wrongUnits.0 == ["selectedRangeUTF16=[3,1]", "selectedTextOmitted=true"] && wrongUnits.2.truncated)
for text: CFTypeRef? in [nil, NSNumber(value: 7), "short" as NSString] {
    let malformed = fields(text: text)
    check(malformed.0 == ["selectedRangeUTF16=[49,7]", "selectedTextOmitted=true"] && malformed.2.truncated)
}
for error in [AXError.attributeUnsupported, .noValue, .failure] {
    let missing = fields(text: nil, textError: error)
    check(missing.0 == ["selectedRangeUTF16=[49,7]", "selectedTextOmitted=true"])
    check(!missing.0.contains("selectedText=\"\""))
}
for invalid in [range(-1, 0), range(0, -1), range(9_007_199_254_740_991, 1), NSNumber(value: 1)] {
    let rejected = fields(rawRange: invalid)
    check(rejected.0.isEmpty && rejected.1.count == 1 && rejected.2.truncated)
}
for error in [AXError.noValue, .attributeUnsupported, .failure] {
    let missing = fields(rangeError: error)
    check(missing.0.isEmpty && missing.1.count == 1)
}
let longSelection = fields(0, 4097)
check(longSelection.0 == ["selectedRangeUTF16=[0,4097]", "selectedTextOmitted=true"])
check(longSelection.1 == [kAXSelectedTextRangeAttribute] && longSelection.2.truncated)
let longText = fields(0, 300, text: String(repeating: "a", count: 300) as NSString)
check(longText.0 == ["selectedRangeUTF16=[0,300]", "selectedText=\"" + String(repeating: "a", count: 200) + "\"", "selectedTextTruncated=true"])
check(longText.2.truncated)
let byteLimited = fields(0, 200, text: String(repeating: "😀", count: 100) as NSString)
check(byteLimited.0[1] == "selectedText=\"" + String(repeating: "😀", count: 64) + "\"")
check(byteLimited.0.last == "selectedTextTruncated=true" && byteLimited.2.truncated)
let escaped = fields(0, 3, text: "\"\\\n" as NSString)
check(escaped.0[1] == "selectedText=\"\\\"\\\\\\n\"")
for text in ["a\u{0000}b", "a\u{0080}b", "a\u{202e}b", "a\u{2066}b"] {
    let unsafe = fields(0, 3, text: text as NSString)
    check(unsafe.0 == ["selectedRangeUTF16=[0,3]", "selectedTextOmitted=true"] && unsafe.2.truncated)
}
let expired = fields(summary: budget(expired: true))
check(expired.0.isEmpty && expired.1.isEmpty && expired.2.truncated)
let unavailable = fields(summary: budget(0))
check(unavailable.0.isEmpty && unavailable.1.isEmpty && unavailable.2.truncated)
let bounded = budget(150)
bounded.append("AXTextArea " + selected.0.joined(separator: " "))
bounded.append("AXTextArea " + unicode.0.joined(separator: " "))
check(bounded.truncated)
let encodedSize = try JSONSerialization.data(withJSONObject: bounded.text, options: [.fragmentsAllowed]).count - 2
check(encodedSize <= 150 && bounded.text.hasSuffix("[AX tree truncated]\n"))
check(!bounded.text.contains("fingerprint") && !bounded.text.contains("textState"))
print("selectionChecks=\(checks)")
`}`;
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-selection-summary-'));
    try {
      const harnessPath = path.join(directory, 'selection-summary.swift');
      await writeFile(harnessPath, harness);
      const result = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', 'swift', harnessPath], {
        encoding: 'utf8', timeout: 25_000, maxBuffer: 64 * 1024,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^selectionChecks=\d+\n$/);
      expect(Number(result.stdout.match(/\d+/)?.[0])).toBeGreaterThan(60);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
