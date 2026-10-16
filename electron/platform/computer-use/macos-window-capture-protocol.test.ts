import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('native cursor capture pure protocol and pixels', () => {
  it('checks exact window plans, canonical receipts, transparency and scaled composition without capture or windows', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-capture-policy-'));
    try {
      const harness = path.join(directory, 'main.swift');
      await writeFile(harness, String.raw`
import Foundation
import CoreGraphics
import ScreenCaptureKit

var checks = 0
func check(_ value: Bool) {
    checks += 1
    guard value else { fatalError("Capture assertion \(checks) failed") }
}
let target = WindowIdentity(windowId: 10, pid: 20, processStartedAt: 30, layer: 0,
    bounds: Rect(x: -100, y: 20, width: 1000, height: 700), title: "Target")
func pointer(_ layer: Int32 = 0, bounds: Rect = Rect(x: -80, y: 40, width: 36, height: 36),
             pid: Int32 = 40, windowId: UInt32 = 50) -> WindowIdentity {
    WindowIdentity(windowId: windowId, pid: pid, processStartedAt: 60, layer: layer, bounds: bounds, title: "Pointer")
}
check(validCapturePointer(pointer(), target: target))
check(validCapturePointer(pointer(102), target: target))
for layer: Int32 in [-1, 1, 101, 103] { check(!validCapturePointer(pointer(layer), target: target)) }
check(!validCapturePointer(pointer(pid: target.pid), target: target))
check(!validCapturePointer(pointer(windowId: target.windowId), target: target))
check(!validCapturePointer(pointer(bounds: Rect(x: -80, y: 40, width: 129, height: 36)), target: target))
check(!validCapturePointer(pointer(bounds: Rect(x: -80, y: 40, width: 36, height: 129)), target: target))
check(!validCapturePointer(pointer(bounds: Rect(x: -101, y: 40, width: 36, height: 36)), target: target))
check(!validCapturePointer(pointer(bounds: Rect(x: 865, y: 40, width: 36, height: 36)), target: target))
let encoded = try JSONSerialization.data(withJSONObject: ["window": target.json, "pointerWindow": pointer(102).json])
check((try? parseWindowRequest(encoded)) == nil)
check((try? parseWindowRequest(encoded, allowScope: true)) == nil)
check(try parseWindowRequest(encoded, allowPointer: true).pointerWindow?.layer == 102)
let extra = try JSONSerialization.data(withJSONObject: ["window": target.json, "pointerWindow": pointer().json, "windows": []])
check((try? parseWindowRequest(extra, allowPointer: true)) == nil)
let invalidTarget = WindowIdentity(windowId: 10, pid: 20, processStartedAt: 30, layer: 102, bounds: target.bounds, title: "Target")
check((try? parseWindowRequest(JSONSerialization.data(withJSONObject: ["window": invalidTarget.json]), allowPointer: true)) == nil)

// Typed callers share the CLI's scope and pointer restrictions. In particular,
// the reusable capture entry rejects a valid observation scope before touching
// permissions, ScreenCaptureKit or another application's windows.
let scopeAnchor = Candidate(path: [], role: "AXButton", title: "Anchor", description: nil,
    subrole: nil, identifier: nil, bounds: target.bounds)
let scopedRequest = WindowRequest(window: target, scope: ObservationScope(anchor: scopeAnchor, ancestorLevels: 0))
check((try? validateWindowRequest(scopedRequest, allowScope: true)) != nil)
check((try? validateWindowRequest(scopedRequest, allowPointer: true)) == nil)
check((try? validateWindowRequest(WindowRequest(window: target, pointerWindow: pointer()))) == nil)
check((try? validateWindowRequest(WindowRequest(window: target, pointerWindow: pointer(102)), allowPointer: true)) != nil)
check((try? validateWindowRequest(WindowRequest(window: invalidTarget), allowPointer: true)) == nil)
check((try? validateWindowRequest(WindowRequest(window: target,
    pointerWindow: pointer(bounds: Rect(x: -101, y: 40, width: 36, height: 36))), allowPointer: true)) == nil)
do { _ = try windowCaptureResult(scopedRequest); check(false) }
catch let error as HelperError { check(error.code == "invalid_request") }
catch { check(false) }

let display = WindowCaptureDisplay(displayId: 70, bounds: Rect(x: -300, y: -200, width: 1920, height: 1080))
let otherDisplay = WindowCaptureDisplay(displayId: 71, bounds: Rect(x: 1620, y: -200, width: 1920, height: 1080))
let plan = windowCaptureIncludedPlan(target: target, pointer: pointer(102), displays: [display, otherDisplay], pointPixelScale: 2)!
check(plan.display == display)
check(plan.windowIDs == [target.windowId, pointer().windowId])
check(plan.sourceRect == CGRect(x: 200, y: 220, width: 1000, height: 700))
check(plan.width == 2000 && plan.height == 1400)
let limited = windowCaptureIncludedPlan(target: target, pointer: pointer(), displays: [display], pointPixelScale: 4)!
check(limited.width == 2048 && limited.height == 1434)
for scale in [0, -1, Double.nan, Double.infinity] {
    check(windowCaptureIncludedPlan(target: target, pointer: pointer(), displays: [display], pointPixelScale: scale) == nil)
}
check(windowCaptureIncludedPlan(target: target, pointer: pointer(), displays: [], pointPixelScale: 2) == nil)
let mirrored = WindowCaptureDisplay(displayId: 72, bounds: display.bounds)
check(windowCaptureIncludedPlan(target: target, pointer: pointer(), displays: [display, mirrored], pointPixelScale: 2) == nil)
check(windowCaptureIncludedPlan(target: target, pointer: pointer(), displays: [display, display], pointPixelScale: 2) == nil)
let duplicateID = WindowCaptureDisplay(displayId: display.displayId, bounds: otherDisplay.bounds)
check(windowCaptureIncludedPlan(target: target, pointer: pointer(), displays: [display, duplicateID], pointPixelScale: 2) == nil)
let clippedDisplay = WindowCaptureDisplay(displayId: 73, bounds: Rect(x: -100, y: 20, width: 999, height: 700))
check(windowCaptureIncludedPlan(target: target, pointer: pointer(), displays: [clippedDisplay], pointPixelScale: 2) == nil)
let leftHalf = WindowCaptureDisplay(displayId: 74, bounds: Rect(x: -100, y: 20, width: 500, height: 700))
let rightHalf = WindowCaptureDisplay(displayId: 75, bounds: Rect(x: 400, y: 20, width: 500, height: 700))
check(windowCaptureIncludedPlan(target: target, pointer: pointer(), displays: [leftHalf, rightHalf], pointPixelScale: 2) == nil)
check(windowCaptureIncludedPlan(target: invalidTarget, pointer: pointer(), displays: [display], pointPixelScale: 2) == nil)
check(windowCaptureIncludedPlan(target: target, pointer: pointer(pid: target.pid), displays: [display], pointPixelScale: 2) == nil)
check(windowCaptureIncludedPlan(target: target, pointer: pointer(bounds: Rect(x: -101, y: 40, width: 36, height: 36)), displays: [display], pointPixelScale: 2) == nil)
if #available(macOS 14.2, *) {
    let configuration = includedWindowCaptureConfiguration(plan)
    check(configuration.sourceRect == plan.sourceRect)
    check(configuration.width == plan.width && configuration.height == plan.height)
    check(configuration.scalesToFit && !configuration.includeChildWindows)
    check(configuration.ignoreShadowsDisplay && configuration.ignoreGlobalClipDisplay)
    check(!configuration.showsCursor && !configuration.capturesAudio && !configuration.shouldBeOpaque)
    if #available(macOS 15.0, *) { check(!configuration.captureMicrophone && !configuration.showMouseClicks) }
}
let canonicalPNG = Data([1, 2, 3])
for code in ["window_capture_failed", "window_capture_timeout"] {
    check(windowCaptureAllowsIndependentRetry(HelperError(code: code, message: "Capture failed")))
    check(!windowCaptureAllowsIndependentRetry(HelperError(code: code, message: "Unknown capture", unknown: true)))
}
for code in ["target_changed", "invalid_request", "screen_permission_denied", "unexpected_error"] {
    check(!windowCaptureAllowsIndependentRetry(HelperError(code: code, message: "Must not mask identity or permission failure")))
}
let legacy = try windowCaptureReceipt(window: target, png: canonicalPNG, width: 2000, height: 1400,
    pointerRequested: false, method: .independentWindow)
check(Set(legacy.keys) == Set(["ok", "window", "pngBase64", "width", "height"]))
check((try? windowCaptureReceipt(window: target, png: canonicalPNG, width: 2000, height: 1400,
    pointerRequested: false, method: .includedWindows)) == nil)
for method: WindowCaptureMethod in [.includedWindows, .compositedWindows, .independentWindow] {
    let receipt = try windowCaptureReceipt(window: target, png: canonicalPNG, width: 2000, height: 1400,
        pointerRequested: true, method: method)
    check(Set(receipt.keys) == Set(["ok", "window", "pngBase64", "width", "height", "cursorIncluded", "captureMethod"]))
    check(receipt["pngBase64"] as? String == canonicalPNG.base64EncodedString())
    check(receipt["cursorIncluded"] as? Bool == (method != .independentWindow))
    check(receipt["captureMethod"] as? String == method.rawValue)
}

let retina = windowCapturePointerPlacement(target: target.bounds, pointer: pointer().bounds, width: 2000, height: 1400)!
check(retina == CGRect(x: 40, y: 1288, width: 72, height: 72))
let downscaled = windowCapturePointerPlacement(target: target.bounds, pointer: pointer().bounds, width: 800, height: 560)!
check(abs(downscaled.width - 28.8) < 0.00001 && abs(downscaled.height - 28.8) < 0.00001)
check(windowCapturePointerPlacement(target: target.bounds, pointer: pointer().bounds, width: 2049, height: 560) == nil)
check(windowCapturePointerPlacement(target: target.bounds, pointer: pointer().bounds, width: 0, height: 560) == nil)
check(windowCapturePointerPlacement(target: target.bounds, pointer: Rect(x: -101, y: 40, width: 36, height: 36), width: 1000, height: 700) == nil)

func image(_ width: Int, _ height: Int, _ rgba: [UInt8], alpha: CGImageAlphaInfo = .premultipliedLast) -> CGImage {
    let provider = CGDataProvider(data: Data(rgba) as CFData)!
    return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: alpha.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
}
let cursor = image(2, 2, [0,0,0,0, 255,0,0,255, 0,255,0,255, 0,0,255,255])
let emptyCursor = image(2, 2, Array(repeating: 0, count: 16))
let opaqueCursor = image(2, 2, Array(repeating: 255, count: 16))
let noAlphaCursor = image(2, 2, Array(repeating: 255, count: 16), alpha: .noneSkipLast)
let softGlowCursor = image(1, 1, [64,0,0,64])
check(windowCapturePointerHasTransparency(cursor))
check(windowCapturePointerHasTransparency(softGlowCursor))
check(!windowCapturePointerHasTransparency(emptyCursor))
check(!windowCapturePointerHasTransparency(opaqueCursor))
check(!windowCapturePointerHasTransparency(noAlphaCursor))
let base = image(4, 4, Array(repeating: 255, count: 64))
let baseBounds = Rect(x: -10, y: 20, width: 4, height: 4)
let cursorBounds = Rect(x: -9, y: 21, width: 2, height: 2)
let combined = windowCaptureComposite(base, targetBounds: baseBounds, pointer: cursor, pointerBounds: cursorBounds)!
check(combined.width == base.width && combined.height == base.height)
let bytes = combined.dataProvider!.data! as Data
func pixel(_ x: Int, _ y: Int) -> [UInt8] { Array(bytes[(y * combined.bytesPerRow + x * 4)..<(y * combined.bytesPerRow + x * 4 + 4)]) }
check(pixel(0, 0) == [255,255,255,255])
check(pixel(1, 1) == [255,255,255,255])
check(pixel(2, 1) == [255,0,0,255])
check(pixel(1, 2) == [0,255,0,255])
check(pixel(2, 2) == [0,0,255,255])
check(pixel(3, 3) == [255,255,255,255])
check(windowCaptureComposite(base, targetBounds: baseBounds, pointer: opaqueCursor, pointerBounds: cursorBounds) == nil)
check(windowCaptureComposite(base, targetBounds: baseBounds, pointer: cursor, pointerBounds: Rect(x: -11, y: 21, width: 2, height: 2)) == nil)
check(Array(base.dataProvider!.data! as Data) == Array(repeating: UInt8(255), count: 64))
print("capturePolicyChecks=\(checks)")
`);
      const sources = ['macos-click.swift', 'macos-semantic.swift']
        .map(name => fileURLToPath(new URL(`./${name}`, import.meta.url)));
      const binary = path.join(directory, 'capture-policy');
      const compiled = spawnSync('/usr/bin/xcrun', ['swiftc', ...sources, harness, '-o', binary], { encoding: 'utf8', timeout: 30_000 });
      expect(compiled.status, compiled.stderr).toBe(0);
      const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/capturePolicyChecks=\d+/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 45_000);
});
