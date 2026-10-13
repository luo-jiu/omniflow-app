import AppKit
import CoreGraphics
import Darwin
import Foundation
import os

// Visual feedback only. This helper cannot post input, capture a display,
// activate an application, or put a window at a floating/topmost level.
enum WindowIndicatorOperation: String, Decodable, CaseIterable {
    case click, rightClick, doubleClick, drag
}

let windowIndicatorDefaultAccentColor = "#5a9e7c"
// Shrink only the visual body and paint. Keep the established guarded surface
// and ordering geometry unchanged, with the action tip still at exact (0, 0).
let windowIndicatorArrowScale = 0.75
struct WindowIndicatorRGB: Equatable {
    let red: Double
    let green: Double
    let blue: Double
}

func windowIndicatorAccentRGB(_ value: String?) -> WindowIndicatorRGB? {
    let hex = value ?? windowIndicatorDefaultAccentColor
    let bytes = Array(hex.utf8)
    guard bytes.count == 7, bytes[0] == 35,
          bytes.dropFirst().allSatisfy({ (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0) }),
          let rgb = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return WindowIndicatorRGB(red: Double((rgb >> 16) & 255) / 255,
        green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
}

struct WindowIndicatorRequest: Decodable {
    let window: WindowIdentity
    let operation: WindowIndicatorOperation
    let point: WindowInputPoint
    let endPoint: WindowInputPoint?
    let accentColor: String?
    init(window: WindowIdentity, operation: WindowIndicatorOperation, point: WindowInputPoint,
         endPoint: WindowInputPoint?, accentColor: String? = nil) {
        self.window = window; self.operation = operation; self.point = point
        self.endPoint = endPoint; self.accentColor = accentColor
    }
    var valid: Bool {
        guard window.valid, point.valid, window.bounds.contains(x: point.x, y: point.y),
              windowIndicatorAccentRGB(accentColor) != nil else { return false }
        if operation == .drag {
            return endPoint.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) && $0 != point } == true
        }
        return endPoint == nil
    }
}

func parseWindowIndicatorRequest(_ data: Data) throws -> WindowIndicatorRequest {
    let (_, object) = try parseInput(data, maximumBytes: 4096)
    _ = try fields(object, required: ["window", "operation", "point"], optional: ["endPoint", "accentColor"])
    let window = try fields(object["window"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
    try validateRectFields(window["bounds"])
    if let title = window["title"], !(title is String) { throw invalidRequest() }
    if let color = object["accentColor"], !(color is String) { throw invalidRequest() }
    _ = try fields(object["point"], required: ["x", "y"])
    if let end = object["endPoint"] { _ = try fields(end, required: ["x", "y"]) }
    guard let request = try? JSONDecoder().decode(WindowIndicatorRequest.self, from: data), request.valid else { throw invalidRequest() }
    return request
}

struct WindowIndicatorGeometry {
    let surface: Rect
    let displayPoint: WindowInputPoint
    let xDirection: Double
    let yDirection: Double
}

// Mirror the body when needed, keeping its tip at the exact action point. Its
// complete bounded glow surface must fit inside the frozen target; otherwise
// decline the visual instead of clipping it or shifting the intended point.
func windowIndicatorGeometry(_ request: WindowIndicatorRequest) -> WindowIndicatorGeometry? {
    guard request.valid else { return nil }
    let bounds = request.window.bounds
    let point = request.point
    let preferredX = point.x + 28 <= bounds.x + bounds.width ? 1.0 : -1.0
    let preferredY = point.y + 28 <= bounds.y + bounds.height ? 1.0 : -1.0
    for (sx, sy) in [(preferredX, preferredY), (-preferredX, preferredY),
                     (preferredX, -preferredY), (-preferredX, -preferredY)] {
        let left = point.x - (sx < 0 ? 28 : 7)
        let right = point.x + (sx > 0 ? 28 : 7)
        let top = point.y - (sy < 0 ? 28 : 7)
        let bottom = point.y + (sy > 0 ? 28 : 7)
        let surface = Rect(x: floor(left), y: floor(top), width: ceil(right) - floor(left), height: ceil(bottom) - floor(top))
        guard surface.valid, surface.width <= 36, surface.height <= 36, bounds.contains(surface) else { continue }
        return WindowIndicatorGeometry(surface: surface, displayPoint: point, xDirection: sx, yDirection: sy)
    }
    return nil
}

// Same rounded kite used by the renderer. All coordinates originate at the
// exact hotspot; only the body is mirrored. Constructing this path is pure.
func windowIndicatorArrowPath(_ geometry: WindowIndicatorGeometry) -> NSBezierPath {
    let origin = CGPoint(x: geometry.displayPoint.x - geometry.surface.x,
        y: geometry.displayPoint.y - geometry.surface.y)
    func vertex(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: origin.x + x * windowIndicatorArrowScale * geometry.xDirection,
            y: origin.y + y * windowIndicatorArrowScale * geometry.yDirection)
    }
    let arrow = NSBezierPath()
    arrow.move(to: vertex(0, 0))
    arrow.curve(to: vertex(2.4, -0.2), controlPoint1: vertex(0.8, -0.8), controlPoint2: vertex(1.6, -0.5))
    arrow.line(to: vertex(19, 6))
    arrow.curve(to: vertex(19, 8.6), controlPoint1: vertex(22, 7.2), controlPoint2: vertex(22, 7.4))
    arrow.line(to: vertex(11, 10.8))
    arrow.line(to: vertex(8.6, 19))
    arrow.curve(to: vertex(6, 19), controlPoint1: vertex(7.4, 22), controlPoint2: vertex(7.2, 22))
    arrow.line(to: vertex(-0.2, 2.4))
    arrow.curve(to: vertex(0, 0), controlPoint1: vertex(-0.5, 1.6), controlPoint2: vertex(-0.8, 0.8))
    arrow.close(); arrow.lineJoinStyle = .round; arrow.lineCapStyle = .round
    return arrow
}

func windowIndicatorSameWindow(_ lhs: WindowIdentity, _ rhs: WindowIdentity) -> Bool {
    lhs.valid && rhs.valid && lhs.windowId == rhs.windowId && lhs.pid == rhs.pid
        && lhs.processStartedAt == rhs.processStartedAt && lhs.layer == rhs.layer
        && lhs.bounds == rhs.bounds && lhs.title == rhs.title
}

// No unbounded stream accumulation: one read is at most 1024 bytes, a partial
// line is at most 4096 bytes, and a read yields at most 64 bounded frames.
struct WindowIndicatorLineBuffer {
    private var partial = Data()
    mutating func append(_ chunk: Data) throws -> [Data] {
        guard chunk.count <= 1024 else { throw invalidRequest() }
        var lines: [Data] = []
        for byte in chunk {
            if byte == 10 {
                guard lines.count < 64 else { throw invalidRequest() }
                lines.append(partial)
                partial = Data()
            } else {
                guard partial.count < 4096 else { throw invalidRequest() }
                partial.append(byte)
            }
        }
        return lines
    }
}

// An empty line is only a liveness heartbeat. Updates cannot retarget the
// visual, even to another window of the same process or changed geometry.
func windowIndicatorUpdate(_ line: Data, frozenWindow: WindowIdentity) throws -> WindowIndicatorRequest? {
    if line.isEmpty { return nil }
    let request = try parseWindowIndicatorRequest(line)
    guard windowIndicatorSameWindow(request.window, frozenWindow) else { throw invalidRequest() }
    return request
}

struct WindowIndicatorStackEntry {
    let windowId: UInt32
    let pid: Int32
    let layer: Int32
    let bounds: Rect
    let title: String?
    let alpha: Double
    let onScreen: Bool
}

// Diagnostic values are fixed codes only: no window/process identity, title,
// coordinates, AX content or protocol bytes are logged.
enum WindowIndicatorReason: String {
    case safe, orderChanged = "order_changed", identityInvalid = "identity_invalid"
    case metadataInvalid = "metadata_invalid", targetUnavailable = "target_unavailable"
    case targetChanged = "target_changed", panelUnavailable = "panel_unavailable", panelChanged = "panel_changed"
    case cancelled, parentChanged = "parent_changed", displayChanged = "display_changed"
    case panelFocused = "panel_focused", helperFrontmost = "helper_frontmost"
    case foregroundUnknown = "foreground_unknown", foregroundChanged = "foreground_changed"
    case repairBudgetExceeded = "repair_budget_exceeded", repairTimedOut = "repair_timed_out"
    case heartbeatExpired = "heartbeat_expired", inputEOF = "input_eof", inputReadFailed = "input_read_failed"
    case protocolInvalid = "protocol_invalid", geometryUnavailable = "geometry_unavailable"
    case initialReadTimedOut = "initial_read_timed_out", initialTargetInvalid = "initial_target_invalid"
}

enum WindowIndicatorDiagnostic: String {
    case exit, repairBegin = "repair_begin", repairSucceeded = "repair_succeeded", repairFailed = "repair_failed"
}

let windowIndicatorLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "window-indicator")
func windowIndicatorLog(_ event: WindowIndicatorDiagnostic, _ reason: WindowIndicatorReason) {
    windowIndicatorLogger.notice("event=\(event.rawValue, privacy: .public) reason=\(reason.rawValue, privacy: .public)")
}

func windowIndicatorStackState(_ entries: [WindowIndicatorStackEntry], target: WindowIdentity,
                               targetStartedAt: Int64?, panelId: UInt32, panelPID: Int32, panelBounds: Rect) -> WindowIndicatorReason {
    guard target.valid, targetStartedAt == target.processStartedAt, panelId > 0, panelId != target.windowId,
          panelPID > 0, panelPID != target.pid, panelBounds.valid, target.bounds.contains(panelBounds) else { return .identityInvalid }
    guard entries.count <= 4096 else { return .metadataInvalid }
    let targets = entries.indices.filter { entries[$0].windowId == target.windowId }
    let panels = entries.indices.filter { entries[$0].windowId == panelId }
    guard targets.count <= 1, panels.count <= 1 else { return .metadataInvalid }
    guard let targetIndex = targets.first else { return .targetUnavailable }
    let actual = entries[targetIndex]
    guard actual.onScreen && actual.pid == target.pid && actual.layer == target.layer
        && actual.bounds == target.bounds && actual.title == target.title
        && actual.alpha.isFinite && actual.alpha > 0 && actual.alpha <= 1 else { return .targetChanged }
    guard let panelIndex = panels.first else { return .panelUnavailable }
    let panel = entries[panelIndex]
    guard panel.onScreen && panel.pid == panelPID && panel.layer == 0 && panel.bounds == panelBounds
        && panel.alpha.isFinite && panel.alpha > 0 && panel.alpha <= 1 else { return .panelChanged }
    // AppKit may place a title-bar accessory between an ordered panel and its
    // target. The entire panel surface must remain below every surface that
    // could cover that part of the target; same-PID windows get no exemption.
    // A known order change can be repaired while clear. Unknown metadata or
    // non-normal crossed windows cannot authorize another ordering attempt.
    var interveningIds = Set<UInt32>()
    var overlaps = false
    for entry in entries[(min(panelIndex, targetIndex) + 1)..<max(panelIndex, targetIndex)] {
        guard entry.windowId > 0, interveningIds.insert(entry.windowId).inserted,
              entry.pid > 0, entry.layer == 0, entry.onScreen, entry.bounds.valid,
              entry.alpha.isFinite, entry.alpha > 0, entry.alpha <= 1 else { return .metadataInvalid }
        if entry.bounds.intersection(panelBounds) != nil { overlaps = true }
    }
    return panelIndex < targetIndex && !overlaps ? .safe : .orderChanged
}

func windowIndicatorStackIsSafe(_ entries: [WindowIndicatorStackEntry], target: WindowIdentity,
                                targetStartedAt: Int64?, panelId: UInt32, panelPID: Int32, panelBounds: Rect) -> Bool {
    windowIndicatorStackState(entries, target: target, targetStartedAt: targetStartedAt,
        panelId: panelId, panelPID: panelPID, panelBounds: panelBounds) == .safe
}

// A target that continually changes order must not make the accessory fight
// for its position. Retain at most four attempts in a rolling monotonic second.
struct WindowIndicatorRepairBudget {
    private var attempts: [UInt64] = []
    mutating func reserve(now: UInt64) -> Bool {
        guard attempts.allSatisfy({ $0 <= now }) else { return false }
        attempts.removeAll { now - $0 >= 1_000_000_000 }
        guard attempts.count < 4 else { return false }
        attempts.append(now)
        return true
    }
}

// The caller has already cleared and relatively ordered this same panel.
// Registration can briefly omit it; all immutable guards and the target are
// still checked every slice. No recursive repair or deadline extension.
func windowIndicatorAwaitSafeOrder(deadline: UInt64, expectedForeground: Int32?, now: () -> UInt64,
                                  foreground: () -> Int32?, state: () -> WindowIndicatorReason,
                                  pump: (UInt64) -> Void) -> WindowIndicatorReason {
    guard let expectedForeground = expectedForeground, expectedForeground > 0 else { return .foregroundUnknown }
    var flushed = false
    while now() < deadline {
        let status = state()
        guard foreground() == expectedForeground else { return .foregroundChanged }
        guard now() < deadline else { return .repairTimedOut }
        if status == .safe && flushed { return .safe }
        guard status == .safe || status == .orderChanged || status == .panelUnavailable else { return status }
        let current = now()
        guard current < deadline else { return .repairTimedOut }
        pump(current + min(5_000_000, deadline - current))
        flushed = true
    }
    return .repairTimedOut
}

func windowIndicatorStack(targetWindowId: UInt32) -> [WindowIndicatorStackEntry]? {
    guard let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
          raw.count <= 4096 else { return nil }
    var result: [WindowIndicatorStackEntry] = []
    for item in raw {
        guard let id = item[kCGWindowNumber as String] as? UInt32,
              let pid = item[kCGWindowOwnerPID as String] as? Int32,
              let layer = item[kCGWindowLayer as String] as? Int32,
              let alpha = item[kCGWindowAlpha as String] as? Double,
              let onScreen = item[kCGWindowIsOnscreen as String] as? Bool,
              let dictionary = item[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary) else { return nil }
        // Other windows contribute ordering metadata only. Their titles are
        // neither needed for this visual nor retained as identity evidence.
        let title = id == targetWindowId ? item[kCGWindowName as String] as? String : nil
        if let title = title, title.utf8.count > 256 { return nil }
        result.append(WindowIndicatorStackEntry(windowId: id, pid: pid, layer: layer,
            bounds: Rect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height),
            title: title, alpha: alpha, onScreen: onScreen))
    }
    return result
}

struct WindowIndicatorDisplay: Equatable {
    let id: CGDirectDisplayID
    let bounds: CGRect
    let pixelWidth: Int
    let pixelHeight: Int
}

func windowIndicatorDisplays() -> [WindowIndicatorDisplay]? {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0, count <= 16 else { return nil }
    var identifiers = [CGDirectDisplayID](repeating: 0, count: Int(count))
    var actualCount = count
    guard CGGetActiveDisplayList(count, &identifiers, &actualCount) == .success, count == actualCount else { return nil }
    return identifiers.sorted().map { WindowIndicatorDisplay(id: $0, bounds: CGDisplayBounds($0),
        pixelWidth: CGDisplayPixelsWide($0), pixelHeight: CGDisplayPixelsHigh($0)) }
}

final class WindowIndicatorPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class WindowIndicatorView: NSView {
    var request: WindowIndicatorRequest
    var geometry: WindowIndicatorGeometry
    var drawsPlan = false
    override var isFlipped: Bool { true }
    init(request: WindowIndicatorRequest, geometry: WindowIndicatorGeometry) {
        self.request = request
        self.geometry = geometry
        super.init(frame: NSRect(x: 0, y: 0, width: geometry.surface.width, height: geometry.surface.height))
    }
    required init?(coder: NSCoder) { nil }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.clear(bounds)
        guard drawsPlan, let rgb = windowIndicatorAccentRGB(request.accentColor) else { return }
        context.saveGState()
        defer { context.restoreGState() }
        // The complete padding is part of the guarded surface. Limit the
        // shadow's raster tail to that surface; NSPanel itself has no shadow.
        context.clip(to: bounds)
        let accent = NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        let highlight = NSColor(srgbRed: rgb.red * 0.55 + 0.45,
            green: rgb.green * 0.55 + 0.45, blue: rgb.blue * 0.55 + 0.45, alpha: 1)
        let arrow = windowIndicatorArrowPath(geometry)
        accent.withAlphaComponent(0.18).setFill(); arrow.fill()
        context.setShadow(offset: .zero, blur: CGFloat(4 * windowIndicatorArrowScale),
            color: accent.withAlphaComponent(0.5).cgColor)
        accent.setStroke(); arrow.lineWidth = CGFloat(2.6 * windowIndicatorArrowScale); arrow.stroke()
        context.setShadow(offset: .zero, blur: 0, color: nil)
        highlight.setStroke(); arrow.lineWidth = CGFloat(1.3 * windowIndicatorArrowScale); arrow.stroke()
    }
}

var windowIndicatorCancelled: sig_atomic_t = 0

let windowIndicatorMaximumEventsPerPump = 64

// Keep servicing a busy application's queue from starving the protocol,
// cancellation and identity checks. This driver is also testable without
// creating NSApplication or a window, or sending a real event.
func windowIndicatorDrainEvents<Event>(deadline: UInt64, now: () -> UInt64,
                                      cancelled: () -> Bool, next: (UInt64) -> Event?,
                                      send: (Event) -> Void, update: () -> Void) {
    var processed = 0
    while processed < windowIndicatorMaximumEventsPerPump && !cancelled() {
        let current = now()
        guard current < deadline, let event = next(deadline - current) else { break }
        send(event)
        processed += 1
    }
    update()
}

func windowIndicatorPumpEvents(_ app: NSApplication, deadline: UInt64) {
    autoreleasepool {
        windowIndicatorDrainEvents(deadline: deadline, now: { DispatchTime.now().uptimeNanoseconds },
            cancelled: { windowIndicatorCancelled != 0 }, next: { remaining in
                // Only this accessory application's own event queue. Running
                // RunLoop alone does not dequeue/send AppKit system events.
                app.nextEvent(matching: .any, until: Date(timeIntervalSinceNow: Double(remaining) / 1_000_000_000),
                    inMode: .default, dequeue: true)
            }, send: { app.sendEvent($0) }, update: { app.updateWindows() })
    }
}

// The first line retains the original request format. Any complete following
// frames or partial update are kept in the same bounded parser.
func windowIndicatorRead(_ deadline: UInt64, parentPID: Int32, parentStartedAt: Int64,
                         buffer: inout WindowIndicatorLineBuffer, pendingLines: inout [Data],
                         exitReason: inout WindowIndicatorReason) throws -> Data? {
    var bytes = [UInt8](repeating: 0, count: 1024)
    while windowIndicatorCancelled == 0 && DispatchTime.now().uptimeNanoseconds < deadline {
        guard getppid() == parentPID, processStart(parentPID) == parentStartedAt else { exitReason = .parentChanged; return nil }
        let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
        if count == 0 { exitReason = .inputEOF; return nil }
        if count > 0 {
            let lines = try buffer.append(Data(bytes.prefix(count)))
            if let first = lines.first {
                pendingLines = Array(lines.dropFirst())
                return first
            }
        } else if errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { exitReason = .inputReadFailed; return nil }
        usleep(5000)
    }
    exitReason = windowIndicatorCancelled != 0 ? .cancelled : .initialReadTimedOut
    return nil
}

func windowIndicator() throws {
    var exitReason = WindowIndicatorReason.protocolInvalid
    defer { windowIndicatorLog(.exit, exitReason) }
    windowIndicatorCancelled = 0
    signal(SIGTERM) { _ in windowIndicatorCancelled = 1 }
    signal(SIGINT) { _ in windowIndicatorCancelled = 1 }
    let parentPID = getppid()
    guard parentPID > 1, let parentStartedAt = processStart(parentPID), getppid() == parentPID else {
        exitReason = .parentChanged
        emit(["ok": true, "shown": false]); return
    }
    let originalFlags = fcntl(STDIN_FILENO, F_GETFL)
    guard originalFlags >= 0, fcntl(STDIN_FILENO, F_SETFL, originalFlags | O_NONBLOCK) == 0 else {
        exitReason = .inputReadFailed; emit(["ok": true, "shown": false]); return
    }
    defer { _ = fcntl(STDIN_FILENO, F_SETFL, originalFlags) }
    let began = DispatchTime.now().uptimeNanoseconds
    var buffer = WindowIndicatorLineBuffer()
    var pendingLines: [Data] = []
    guard let data = try windowIndicatorRead(began + 1_000_000_000, parentPID: parentPID,
        parentStartedAt: parentStartedAt, buffer: &buffer, pendingLines: &pendingLines, exitReason: &exitReason) else {
        emit(["ok": true, "shown": false]); return
    }
    var request = try parseWindowIndicatorRequest(data)
    let frozenWindow = request.window
    guard (try? revalidateWindow(request.window, requireUniqueAXWindow: false)) != nil else {
        exitReason = .initialTargetInvalid; emit(["ok": true, "shown": false]); return
    }
    guard let displaySnapshot = windowIndicatorDisplays(),
          let mainDisplay = displaySnapshot.first(where: { $0.id == CGMainDisplayID() }), mainDisplay.bounds.height > 0 else {
        exitReason = .displayChanged
        emit(["ok": true, "shown": false]); return
    }
    let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    guard var geometry = windowIndicatorGeometry(request) else {
        exitReason = .geometryUnavailable; emit(["ok": true, "shown": false]); return
    }
    var surface = geometry.surface
    let frame = NSRect(x: surface.x, y: mainDisplay.bounds.height - surface.y - surface.height, width: surface.width, height: surface.height)
    let panel = WindowIndicatorPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.becomesKeyOnlyIfNeeded = true
    panel.level = .normal
    panel.ignoresMouseEvents = true
    panel.hidesOnDeactivate = false
    panel.hasShadow = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.animationBehavior = .none
    panel.isReleasedWhenClosed = false
    panel.collectionBehavior = [.transient, .ignoresCycle, .fullScreenNone]
    let view = WindowIndicatorView(request: request, geometry: geometry)
    panel.contentView = view
    defer { view.drawsPlan = false; panel.orderOut(nil); panel.close() }
    panel.order(.above, relativeTo: Int(request.window.windowId))
    func state() -> WindowIndicatorReason {
        guard windowIndicatorCancelled == 0 else { return .cancelled }
        guard getppid() == parentPID, processStart(parentPID) == parentStartedAt else { return .parentChanged }
        guard windowIndicatorDisplays() == displaySnapshot else { return .displayChanged }
        guard !panel.isKeyWindow, !panel.isMainWindow else { return .panelFocused }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier != getpid() else { return .helperFrontmost }
        guard let stack = windowIndicatorStack(targetWindowId: request.window.windowId) else { return .metadataInvalid }
        return windowIndicatorStackState(stack, target: request.window, targetStartedAt: processStart(request.window.pid),
            panelId: UInt32(panel.windowNumber), panelPID: getpid(), panelBounds: surface)
    }
    var repairBudget = WindowIndicatorRepairBudget()
    func ensureSameWindowSafeOrder(deadline: UInt64) -> Bool {
        let status = state()
        if status == .safe { return true }
        guard status == .orderChanged else { exitReason = status; return false }
        let repairFrontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        guard let knownFrontmost = repairFrontmost, knownFrontmost > 0 else {
            exitReason = .foregroundUnknown; return false
        }
        let current = DispatchTime.now().uptimeNanoseconds
        guard current < deadline else { exitReason = .heartbeatExpired; return false }
        guard repairBudget.reserve(now: current) else { exitReason = .repairBudgetExceeded; return false }
        windowIndicatorLog(.repairBegin, .orderChanged)
        view.drawsPlan = false
        view.needsDisplay = true
        view.displayIfNeeded()
        panel.orderOut(nil)
        // Do not order again after an identity/display/parent/focus failure.
        // An absent owned panel is expected only while it is explicitly hidden.
        let hiddenState = state()
        guard hiddenState == .safe || hiddenState == .orderChanged || hiddenState == .panelUnavailable else {
            exitReason = hiddenState; windowIndicatorLog(.repairFailed, exitReason); return false
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == repairFrontmost else {
            exitReason = .foregroundChanged; windowIndicatorLog(.repairFailed, exitReason); return false
        }
        let repairDeadline = min(deadline, current + 150_000_000)
        guard DispatchTime.now().uptimeNanoseconds < repairDeadline else {
            exitReason = .repairTimedOut; windowIndicatorLog(.repairFailed, exitReason); return false
        }
        panel.order(.above, relativeTo: Int(frozenWindow.windowId))
        let restored = windowIndicatorAwaitSafeOrder(deadline: repairDeadline, expectedForeground: repairFrontmost,
            now: { DispatchTime.now().uptimeNanoseconds },
            foreground: { NSWorkspace.shared.frontmostApplication?.processIdentifier }, state: state,
            pump: { windowIndicatorPumpEvents(app, deadline: $0) })
        guard restored == .safe else {
            exitReason = restored; windowIndicatorLog(.repairFailed, exitReason); return false
        }
        view.drawsPlan = true
        view.needsDisplay = true
        view.displayIfNeeded()
        windowIndicatorLog(.repairSucceeded, .orderChanged)
        return true
    }
    // Flush server registration while the content is still completely clear.
    let registrationDeadline = min(began + 900_000_000, DispatchTime.now().uptimeNanoseconds + 150_000_000)
    while DispatchTime.now().uptimeNanoseconds < registrationDeadline {
        windowIndicatorPumpEvents(app, deadline: min(registrationDeadline, DispatchTime.now().uptimeNanoseconds + 5_000_000))
        if state() == .safe { break }
    }
    let registered = state()
    guard registered == .safe else {
        exitReason = registered; emit(["ok": true, "shown": false]); return
    }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmostPID else {
        exitReason = .foregroundChanged
        emit(["ok": true, "shown": false]); return
    }
    view.drawsPlan = true
    view.needsDisplay = true
    view.displayIfNeeded()
    emit(["ok": true, "shown": true])
    var bytes = [UInt8](repeating: 0, count: 1024)
    var lastInputAt = DispatchTime.now().uptimeNanoseconds
    let idleTimeout: UInt64 = 2_500_000_000
    while true {
        guard DispatchTime.now().uptimeNanoseconds - lastInputAt < idleTimeout else { exitReason = .heartbeatExpired; return }
        guard ensureSameWindowSafeOrder(deadline: lastInputAt + idleTimeout) else { return }
        // Clear and hide the old backing surface before any move. Re-register
        // this same window transparently and prove its new order before color.
        for line in pendingLines {
            guard DispatchTime.now().uptimeNanoseconds - lastInputAt < idleTimeout else { exitReason = .heartbeatExpired; return }
            guard ensureSameWindowSafeOrder(deadline: lastInputAt + idleTimeout) else { return }
            guard let update = try windowIndicatorUpdate(line, frozenWindow: frozenWindow) else { continue }
            guard let updatedGeometry = windowIndicatorGeometry(update) else { exitReason = .geometryUnavailable; return }
            guard (try? revalidateWindow(frozenWindow, requireUniqueAXWindow: false)) != nil else {
                exitReason = .targetChanged; return
            }
            let updateFrontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
            view.drawsPlan = false
            view.needsDisplay = true
            view.displayIfNeeded()
            panel.orderOut(nil)
            request = update
            geometry = updatedGeometry
            surface = geometry.surface
            panel.setFrame(NSRect(x: surface.x, y: mainDisplay.bounds.height - surface.y - surface.height,
                width: surface.width, height: surface.height), display: false)
            view.request = request
            view.geometry = geometry
            view.frame = NSRect(x: 0, y: 0, width: surface.width, height: surface.height)
            panel.order(.above, relativeTo: Int(frozenWindow.windowId))
            let updateDeadline = min(lastInputAt + idleTimeout, DispatchTime.now().uptimeNanoseconds + 150_000_000)
            while DispatchTime.now().uptimeNanoseconds < updateDeadline {
                windowIndicatorPumpEvents(app, deadline: min(updateDeadline, DispatchTime.now().uptimeNanoseconds + 5_000_000))
                if state() == .safe { break }
            }
            guard DispatchTime.now().uptimeNanoseconds < updateDeadline else { exitReason = .repairTimedOut; return }
            let updated = state()
            guard updated == .safe else { exitReason = updated; return }
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == updateFrontmost else {
                exitReason = .foregroundChanged; return
            }
            view.drawsPlan = true
            view.needsDisplay = true
            view.displayIfNeeded()
            emit(["ok": true, "shown": true])
        }
        pendingLines.removeAll(keepingCapacity: true)
        let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
        if count == 0 { exitReason = .inputEOF; return }
        if count > 0 {
            lastInputAt = DispatchTime.now().uptimeNanoseconds
            pendingLines = try buffer.append(Data(bytes.prefix(count)))
        } else if errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { exitReason = .inputReadFailed; return }
        windowIndicatorPumpEvents(app, deadline: min(lastInputAt + idleTimeout, DispatchTime.now().uptimeNanoseconds + 25_000_000))
    }
}
