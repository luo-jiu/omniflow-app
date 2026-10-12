import AppKit
import CoreGraphics
import Darwin
import Foundation

// Visual feedback only. This helper cannot post input, capture a display,
// activate an application, or put a window at a floating/topmost level.
enum WindowIndicatorOperation: String, Decodable, CaseIterable {
    case click, rightClick, doubleClick, drag
    var label: String {
        switch self {
        case .click: return "AI · 点击"
        case .rightClick: return "AI · 右键"
        case .doubleClick: return "AI · 双击"
        case .drag: return "AI · 拖拽计划"
        }
    }
}

struct WindowIndicatorRequest: Decodable {
    let window: WindowIdentity
    let operation: WindowIndicatorOperation
    let point: WindowInputPoint
    let endPoint: WindowInputPoint?
    var valid: Bool {
        guard window.valid, point.valid, window.bounds.contains(x: point.x, y: point.y) else { return false }
        if operation == .drag {
            return endPoint.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) && $0 != point } == true
        }
        return endPoint == nil
    }
}

func parseWindowIndicatorRequest(_ data: Data) throws -> WindowIndicatorRequest {
    let (_, object) = try parseInput(data, maximumBytes: 4096)
    _ = try fields(object, required: ["window", "operation", "point"], optional: ["endPoint"])
    let window = try fields(object["window"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
    try validateRectFields(window["bounds"])
    if let title = window["title"], !(title is String) { throw invalidRequest() }
    _ = try fields(object["point"], required: ["x", "y"])
    if let end = object["endPoint"] { _ = try fields(end, required: ["x", "y"]) }
    guard let request = try? JSONDecoder().decode(WindowIndicatorRequest.self, from: data), request.valid else { throw invalidRequest() }
    return request
}

struct WindowIndicatorGeometry {
    let surface: Rect
    let label: Rect?
    let xDirection: Double
    let yDirection: Double
}

// Native drawing is clipped to a small surface entirely within the approved
// window. Even labels at screen/window edges never spill onto another app.
func windowIndicatorGeometry(_ request: WindowIndicatorRequest, labelWidth: Double) -> WindowIndicatorGeometry? {
    guard request.valid, labelWidth.isFinite, labelWidth > 0, labelWidth <= 160 else { return nil }
    let bounds = request.window.bounds
    let point = request.point
    let sx = point.x + 20 <= bounds.x + bounds.width ? 1.0 : -1.0
    let sy = point.y + 28 <= bounds.y + bounds.height ? 1.0 : -1.0
    var left = point.x - (sx < 0 ? 22 : 3)
    var right = point.x + (sx > 0 ? 22 : 3)
    var top = point.y - (sy < 0 ? 30 : 3)
    var bottom = point.y + (sy > 0 ? 30 : 3)
    var label: Rect?
    if bounds.width >= labelWidth, bounds.height >= 22 {
        let preferredX = sx > 0 ? point.x + 20 : point.x - labelWidth - 20
        let preferredY = sy > 0 ? point.y + 14 : point.y - 36
        let arrowBounds = Rect(x: left, y: top, width: right - left, height: bottom - top)
        // Clamping a badge near an edge must not cover the arrow's hotspot.
        // A very small window can show the arrow without its optional label.
        for yValue in [preferredY, point.y - 54, point.y + 30] {
            for xValue in [preferredX, point.x - labelWidth - 22, point.x + 22] where label == nil {
                let x = min(max(xValue, bounds.x), bounds.x + bounds.width - labelWidth)
                let y = min(max(yValue, bounds.y), bounds.y + bounds.height - 22)
                let candidate = Rect(x: x, y: y, width: labelWidth, height: 22)
                if arrowBounds.intersection(candidate) == nil { label = candidate }
            }
        }
        if let label = label {
            left = min(left, label.x); right = max(right, label.x + label.width)
            top = min(top, label.y); bottom = max(bottom, label.y + label.height)
        }
    }
    if let end = request.endPoint {
        left = min(left, end.x - 7); right = max(right, end.x + 7)
        top = min(top, end.y - 7); bottom = max(bottom, end.y + 7)
    }
    let proposed = Rect(x: floor(left), y: floor(top), width: ceil(right) - floor(left), height: ceil(bottom) - floor(top))
    guard let surface = proposed.intersection(bounds), surface.width <= 8192, surface.height <= 8192,
          surface.width * surface.height <= 8_388_608 else { return nil }
    return WindowIndicatorGeometry(surface: surface, label: label, xDirection: sx, yDirection: sy)
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

func windowIndicatorStackIsSafe(_ entries: [WindowIndicatorStackEntry], target: WindowIdentity,
                                targetStartedAt: Int64?, panelId: UInt32, panelPID: Int32, panelBounds: Rect) -> Bool {
    guard target.valid, targetStartedAt == target.processStartedAt, panelId != target.windowId,
          panelPID > 0, panelPID != target.pid, target.bounds.contains(panelBounds),
          entries.filter({ $0.windowId == target.windowId }).count == 1,
          entries.filter({ $0.windowId == panelId }).count == 1,
          let targetIndex = entries.firstIndex(where: { $0.windowId == target.windowId }),
          let panelIndex = entries.firstIndex(where: { $0.windowId == panelId }), panelIndex + 1 == targetIndex else { return false }
    let actual = entries[targetIndex]
    let panel = entries[panelIndex]
    return actual.onScreen && actual.pid == target.pid && actual.layer == target.layer
        && actual.bounds == target.bounds && actual.title == target.title && actual.alpha.isFinite && actual.alpha > 0
        && panel.onScreen && panel.pid == panelPID && panel.layer == 0 && panel.bounds == panelBounds
        && panel.alpha.isFinite && panel.alpha > 0
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
    let request: WindowIndicatorRequest
    let geometry: WindowIndicatorGeometry
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
        guard drawsPlan else { return }
        let violet = NSColor(srgbRed: 0.43, green: 0.28, blue: 0.88, alpha: 1)
        let point = CGPoint(x: request.point.x - geometry.surface.x, y: request.point.y - geometry.surface.y)
        if let end = request.endPoint {
            let endPoint = CGPoint(x: end.x - geometry.surface.x, y: end.y - geometry.surface.y)
            let line = NSBezierPath()
            line.move(to: point); line.line(to: endPoint)
            line.setLineDash([5, 4], count: 2, phase: 0)
            NSColor.white.setStroke(); line.lineWidth = 4; line.stroke()
            violet.setStroke(); line.lineWidth = 2; line.stroke()
            let endRing = NSBezierPath(ovalIn: CGRect(x: endPoint.x - 5, y: endPoint.y - 5, width: 10, height: 10))
            NSColor.white.setStroke(); endRing.lineWidth = 4; endRing.stroke()
            violet.setStroke(); endRing.lineWidth = 2; endRing.stroke()
        }
        let arrow = NSBezierPath()
        for (index, item) in [(0.0, 0.0), (0, 21), (5, 16), (10, 25), (14, 23), (9, 14), (17, 14)].enumerated() {
            let vertex = CGPoint(x: point.x + item.0 * geometry.xDirection, y: point.y + item.1 * geometry.yDirection)
            if index == 0 { arrow.move(to: vertex) } else { arrow.line(to: vertex) }
        }
        arrow.close(); arrow.lineJoinStyle = .round
        NSColor.white.setStroke(); arrow.lineWidth = 3.5; arrow.stroke()
        violet.setFill(); arrow.fill()
        if let label = geometry.label {
            let box = NSRect(x: label.x - geometry.surface.x, y: label.y - geometry.surface.y, width: label.width, height: label.height)
            let badge = NSBezierPath(roundedRect: box.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
            NSColor.white.setStroke(); badge.lineWidth = 2; badge.stroke()
            violet.setFill(); badge.fill()
            request.operation.label.draw(at: NSPoint(x: box.minX + 6, y: box.minY + 4), withAttributes: [
                .font: NSFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: NSColor.white,
            ])
        }
    }
}

var windowIndicatorCancelled: sig_atomic_t = 0

// One newline-terminated bounded request, then keep-alive only. EOF, unexpected
// extra bytes, cancellation, timeout or a changed parent all close the panel.
func windowIndicatorRead(_ deadline: UInt64, parentPID: Int32, parentStartedAt: Int64) throws -> Data? {
    var data = Data()
    var bytes = [UInt8](repeating: 0, count: 1024)
    while windowIndicatorCancelled == 0 && DispatchTime.now().uptimeNanoseconds < deadline {
        guard getppid() == parentPID, processStart(parentPID) == parentStartedAt else { return nil }
        let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
        if count == 0 { return nil }
        if count > 0 {
            data.append(contentsOf: bytes.prefix(count))
            guard data.count <= 4096 else { throw invalidRequest() }
            if let newline = data.firstIndex(of: 10) {
                guard newline == data.index(before: data.endIndex) else { throw invalidRequest() }
                return Data(data[..<newline])
            }
        } else if errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { return nil }
        usleep(5000)
    }
    return nil
}

func windowIndicator() throws {
    windowIndicatorCancelled = 0
    signal(SIGTERM) { _ in windowIndicatorCancelled = 1 }
    signal(SIGINT) { _ in windowIndicatorCancelled = 1 }
    let parentPID = getppid()
    guard parentPID > 1, let parentStartedAt = processStart(parentPID), getppid() == parentPID else {
        emit(["ok": true, "shown": false]); return
    }
    let originalFlags = fcntl(STDIN_FILENO, F_GETFL)
    guard originalFlags >= 0, fcntl(STDIN_FILENO, F_SETFL, originalFlags | O_NONBLOCK) == 0 else { emit(["ok": true, "shown": false]); return }
    defer { _ = fcntl(STDIN_FILENO, F_SETFL, originalFlags) }
    let began = DispatchTime.now().uptimeNanoseconds
    guard let data = try windowIndicatorRead(began + 1_000_000_000, parentPID: parentPID, parentStartedAt: parentStartedAt) else {
        emit(["ok": true, "shown": false]); return
    }
    let request = try parseWindowIndicatorRequest(data)
    guard (try? revalidateWindow(request.window, requireUniqueAXWindow: false)) != nil,
          let displaySnapshot = windowIndicatorDisplays(),
          let mainDisplay = displaySnapshot.first(where: { $0.id == CGMainDisplayID() }), mainDisplay.bounds.height > 0 else {
        emit(["ok": true, "shown": false]); return
    }
    let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.finishLaunching()
    let font = NSFont.systemFont(ofSize: 11, weight: .semibold)
    let labelWidth = ceil(request.operation.label.size(withAttributes: [.font: font]).width + 12)
    guard let geometry = windowIndicatorGeometry(request, labelWidth: labelWidth) else { emit(["ok": true, "shown": false]); return }
    let surface = geometry.surface
    let frame = NSRect(x: surface.x, y: mainDisplay.bounds.height - surface.y - surface.height, width: surface.width, height: surface.height)
    let panel = WindowIndicatorPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = .normal
    panel.isFloatingPanel = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.worksWhenModal = false
    panel.ignoresMouseEvents = true
    panel.hidesOnDeactivate = false
    panel.hasShadow = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.collectionBehavior = [.transient, .ignoresCycle, .fullScreenNone]
    let view = WindowIndicatorView(request: request, geometry: geometry)
    panel.contentView = view
    defer { view.drawsPlan = false; panel.orderOut(nil); panel.close() }
    panel.order(.above, relativeTo: Int(request.window.windowId))
    func valid() -> Bool {
        guard windowIndicatorCancelled == 0, getppid() == parentPID, processStart(parentPID) == parentStartedAt,
              windowIndicatorDisplays() == displaySnapshot, !panel.isKeyWindow, !panel.isMainWindow,
              NSWorkspace.shared.frontmostApplication?.processIdentifier != getpid(),
              let stack = windowIndicatorStack(targetWindowId: request.window.windowId) else { return false }
        return windowIndicatorStackIsSafe(stack, target: request.window, targetStartedAt: processStart(request.window.pid),
            panelId: UInt32(panel.windowNumber), panelPID: getpid(), panelBounds: surface)
    }
    // Flush server registration while the content is still completely clear.
    let registrationDeadline = min(began + 900_000_000, DispatchTime.now().uptimeNanoseconds + 150_000_000)
    while DispatchTime.now().uptimeNanoseconds < registrationDeadline {
        _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.005))
        if valid() { break }
    }
    guard valid(), NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmostPID else {
        emit(["ok": true, "shown": false]); return
    }
    view.drawsPlan = true
    view.needsDisplay = true
    view.displayIfNeeded()
    emit(["ok": true, "shown": true])
    var byte: UInt8 = 0
    let deadline = began + 3_000_000_000
    while DispatchTime.now().uptimeNanoseconds < deadline && valid() {
        let count = Darwin.read(STDIN_FILENO, &byte, 1)
        if count >= 0 || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) { break }
        _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.025))
    }
}
