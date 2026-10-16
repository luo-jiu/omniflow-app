import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import os

// Visual feedback only. This helper cannot post input, capture a display, or
// activate an application. Its temporary level is an internal visual policy.
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
    let menuSurface: WindowIdentity?
    let operation: WindowIndicatorOperation
    let point: WindowInputPoint
    let endPoint: WindowInputPoint?
    let accentColor: String?
    init(window: WindowIdentity, operation: WindowIndicatorOperation, point: WindowInputPoint,
         endPoint: WindowInputPoint?, accentColor: String? = nil, menuSurface: WindowIdentity? = nil) {
        self.window = window; self.operation = operation; self.point = point
        self.endPoint = endPoint; self.accentColor = accentColor; self.menuSurface = menuSurface
    }
    var valid: Bool {
        guard window.valid, point.valid,
              windowIndicatorAccentRGB(accentColor) != nil else { return false }
        if let menu = menuSurface {
            return operation == .click && endPoint == nil && windowIndicatorMenuIdentityValid(menu, anchor: window)
                && menu.bounds.contains(x: point.x, y: point.y)
        }
        guard window.bounds.contains(x: point.x, y: point.y) else { return false }
        if operation == .drag {
            return endPoint.map { $0.valid && window.bounds.contains(x: $0.x, y: $0.y) && $0 != point } == true
        }
        return endPoint == nil
    }
}

func parseWindowIndicatorRequest(_ data: Data) throws -> WindowIndicatorRequest {
    let (_, object) = try parseInput(data, maximumBytes: 4096)
    _ = try fields(object, required: ["window", "operation", "point"], optional: ["endPoint", "accentColor", "menuSurface"])
    let window = try fields(object["window"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
    try validateRectFields(window["bounds"])
    if let title = window["title"], !(title is String) { throw invalidRequest() }
    if let menu = object["menuSurface"] {
        let value = try fields(menu, required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
        try validateRectFields(value["bounds"])
        if let title = value["title"], !(title is String) { throw invalidRequest() }
    }
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

// A repeated intent can repaint its existing terminal surface, including its
// established mirror, without briefly withdrawing the owned window.
func windowIndicatorPlanCanDrawInPlace(point: WindowInputPoint, geometry: WindowIndicatorGeometry,
                                       layer: Int32, wantedLayer: Int32) -> Bool {
    point == geometry.displayPoint && layer == wantedLayer
        && geometry.surface == windowIndicatorSurface(point, xDirection: geometry.xDirection, yDirection: geometry.yDirection)
}

let windowIndicatorFadeDuration: UInt64 = 440_000_000
let windowIndicatorStartupBudget: UInt64 = 1_400_000_000
let windowIndicatorRegistrationBudget: UInt64 = 800_000_000
let windowIndicatorPlacementBudget: UInt64 = 150_000_000
let windowIndicatorAnimationTick: UInt64 = 16_000_000
let windowIndicatorMaximumRouteSegments = 8
let windowIndicatorMaximumMotionDuration: UInt64 = 650_000_000
let windowIndicatorRouteBudget: UInt64 = 2_800_000_000

func windowIndicatorSegmentPlacementAllowance(segments: Int) -> UInt64? {
    guard (1...windowIndicatorMaximumRouteSegments).contains(segments) else { return nil }
    // Conservative allowance for segment-boundary placements and endpoint
    // quantization. Small-panel samples also revalidate: the live driver uses
    // one absolute route deadline, never this allowance as a completion claim.
    return UInt64(segments + 1) * windowIndicatorPlacementBudget + windowIndicatorMaximumMotionDuration
        + UInt64(segments) * windowIndicatorAnimationTick
}

// CAMediaTimingFunction.easeInEaseOut: cubic Bezier (.42, 0), (.58, 1).
// Solve its monotonic x coordinate before sampling y; using time directly as
// the curve parameter changes the visible acceleration.
func windowIndicatorFadeProgress(elapsed: UInt64) -> Double {
    guard elapsed > 0 else { return 0 }
    guard elapsed < windowIndicatorFadeDuration else { return 1 }
    let progress = Double(elapsed) / Double(windowIndicatorFadeDuration)
    var lower = 0.0, upper = 1.0
    for _ in 0..<30 {
        let t = (lower + upper) / 2, inverse = 1 - t
        let x = 3 * inverse * inverse * t * 0.42 + 3 * inverse * t * t * 0.58 + t * t * t
        if x < progress { lower = t } else { upper = t }
    }
    let t = (lower + upper) / 2
    return 3 * (1 - t) * t * t + t * t * t
}

struct WindowIndicatorFadeOut {
    let began: UInt64
    let initialOpacity: Double
    func opacity(at now: UInt64) -> Double {
        guard now > began else { return initialOpacity }
        return initialOpacity * (1 - windowIndicatorFadeProgress(elapsed: now - began))
    }
}

let windowIndicatorElevatedLayer: Int32 = 102
let windowIndicatorMaximumEnvelopeExtent = 1024.0

// Only this fixed paint overhang is allowed outside a proved menu. A narrow
// native menu is not required to contain the entire 35/36pt arrow window.
let windowIndicatorMenuPaintOverhang = 29.0
func windowIndicatorMenuIdentityValid(_ menu: WindowIdentity, anchor: WindowIdentity) -> Bool {
    windowIndicatorVisualIdentityValid(menu) && menu.layer == 101 && menu.windowId != anchor.windowId
        && menu.pid == anchor.pid && menu.processStartedAt == anchor.processStartedAt
}
func windowIndicatorMenuDrawingBounds(_ menu: WindowIdentity) -> Rect {
    Rect(x: menu.bounds.x - windowIndicatorMenuPaintOverhang, y: menu.bounds.y - windowIndicatorMenuPaintOverhang,
        width: menu.bounds.width + 2 * windowIndicatorMenuPaintOverhang,
        height: menu.bounds.height + 2 * windowIndicatorMenuPaintOverhang)
}
func windowIndicatorSameMenu(_ lhs: WindowIdentity, _ rhs: WindowIdentity) -> Bool {
    lhs.windowId == rhs.windowId && lhs.pid == rhs.pid && lhs.processStartedAt == rhs.processStartedAt
        && lhs.layer == rhs.layer && lhs.bounds == rhs.bounds && lhs.title == rhs.title
}
func windowIndicatorRegions(anchor: WindowIdentity, menus: [WindowIdentity]) -> [Rect]? {
    guard windowIndicatorVisualIdentityValid(anchor), menus.count <= 2,
          Set(menus.map(\.windowId)).count == menus.count,
          menus.allSatisfy({ windowIndicatorMenuIdentityValid($0, anchor: anchor) }) else { return nil }
    let regions = [anchor.bounds] + menus.map(windowIndicatorMenuDrawingBounds)
    return regions.allSatisfy(\.valid) ? regions : nil
}
func windowIndicatorRegionBounds(_ regions: [Rect]) -> Rect? {
    guard !regions.isEmpty, regions.count <= 3, regions.allSatisfy(\.valid) else { return nil }
    let x = regions.map(\.x).min()!, y = regions.map(\.y).min()!
    let bounds = Rect(x: x, y: y, width: regions.map { $0.x + $0.width }.max()! - x,
        height: regions.map { $0.y + $0.height }.max()! - y)
    return bounds.valid ? bounds : nil
}
// Exact rectangle-union coverage, including holes. The enclosing box alone
// never permits a curve to cross unrelated screen regions between menus.
func windowIndicatorRegionsContain(_ surface: Rect, regions: [Rect]) -> Bool {
    guard surface.valid, !regions.isEmpty, regions.count <= 3, regions.allSatisfy(\.valid) else { return false }
    let cuts = Set([surface.x, surface.x + surface.width] + regions.flatMap { [$0.x, $0.x + $0.width] }
        .filter { $0 > surface.x && $0 < surface.x + surface.width }).sorted()
    for index in 0..<(cuts.count - 1) {
        let left = cuts[index], right = cuts[index + 1]
        let intervals = regions.filter { $0.x <= left && $0.x + $0.width >= right }
            .map { ($0.y, $0.y + $0.height) }.sorted { $0.0 < $1.0 }
        var covered = surface.y
        for (top, bottom) in intervals where bottom > covered {
            if top > covered { return false }
            covered = bottom
            if covered >= surface.y + surface.height { break }
        }
        if covered < surface.y + surface.height { return false }
    }
    return true
}

func windowIndicatorSurface(_ point: WindowInputPoint, xDirection: Double, yDirection: Double) -> Rect {
    let left = point.x - (xDirection < 0 ? 28 : 7)
    let right = point.x + (xDirection > 0 ? 28 : 7)
    let top = point.y - (yDirection < 0 ? 28 : 7)
    let bottom = point.y + (yDirection > 0 ? 28 : 7)
    return Rect(x: floor(left), y: floor(top), width: ceil(right) - floor(left), height: ceil(bottom) - floor(top))
}

// One fixed, bounded backing surface contains every interpolated sample. The
// same mirror is used throughout, so the arrow cannot flip during a move.
func windowIndicatorEnvelope(_ points: [WindowInputPoint], bounds: Rect) -> WindowIndicatorGeometry? {
    guard bounds.valid, !points.isEmpty, points.count <= 3,
          points.allSatisfy({ $0.valid && bounds.contains(x: $0.x, y: $0.y) }) else { return nil }
    let first = points[0]
    let preferredX = first.x + 28 <= bounds.x + bounds.width ? 1.0 : -1.0
    let preferredY = first.y + 28 <= bounds.y + bounds.height ? 1.0 : -1.0
    for (sx, sy) in [(preferredX, preferredY), (-preferredX, preferredY),
                     (preferredX, -preferredY), (-preferredX, -preferredY)] {
        let surfaces = points.map { windowIndicatorSurface($0, xDirection: sx, yDirection: sy) }
        guard surfaces.allSatisfy({ $0.valid && bounds.contains($0) }) else { continue }
        let left = surfaces.map(\.x).min()!, top = surfaces.map(\.y).min()!
        let right = surfaces.map { $0.x + $0.width }.max()!, bottom = surfaces.map { $0.y + $0.height }.max()!
        let surface = Rect(x: left, y: top, width: right - left, height: bottom - top)
        guard surface.valid, bounds.contains(surface), surface.width <= windowIndicatorMaximumEnvelopeExtent,
              surface.height <= windowIndicatorMaximumEnvelopeExtent,
              surface.width * surface.height <= 1_048_576 else { continue }
        return WindowIndicatorGeometry(surface: surface, displayPoint: first, xDirection: sx, yDirection: sy)
    }
    return nil
}

func windowIndicatorGeometry(at point: WindowInputPoint, in geometry: WindowIndicatorGeometry) -> WindowIndicatorGeometry? {
    let paintedSurface = windowIndicatorSurface(point, xDirection: geometry.xDirection, yDirection: geometry.yDirection)
    guard point.valid, paintedSurface.valid, geometry.surface.contains(paintedSurface) else { return nil }
    return WindowIndicatorGeometry(surface: geometry.surface, displayPoint: point,
        xDirection: geometry.xDirection, yDirection: geometry.yDirection)
}

struct WindowIndicatorCubic {
    let start: WindowInputPoint
    let first: WindowInputPoint
    let second: WindowInputPoint
    let end: WindowInputPoint
    var controls: [WindowInputPoint] { [start, first, second, end] }
    func point(_ progress: Double) -> WindowInputPoint {
        if progress <= 0 { return start }
        if progress >= 1 { return end }
        let t = progress, inverse = 1 - t
        return WindowInputPoint(
            x: inverse * inverse * inverse * start.x + 3 * inverse * inverse * t * first.x
                + 3 * inverse * t * t * second.x + t * t * t * end.x,
            y: inverse * inverse * inverse * start.y + 3 * inverse * inverse * t * first.y
                + 3 * inverse * t * t * second.y + t * t * t * end.y)
    }
    func tangent(_ progress: Double) -> WindowInputPoint {
        let t = min(1, max(0, progress)), inverse = 1 - t
        return WindowInputPoint(
            x: 3 * inverse * inverse * (first.x - start.x) + 6 * inverse * t * (second.x - first.x) + 3 * t * t * (end.x - second.x),
            y: 3 * inverse * inverse * (first.y - start.y) + 6 * inverse * t * (second.y - first.y) + 3 * t * t * (end.y - second.y))
    }
    func split() -> (WindowIndicatorCubic, WindowIndicatorCubic) {
        func midpoint(_ a: WindowInputPoint, _ b: WindowInputPoint) -> WindowInputPoint {
            WindowInputPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
        }
        let a = midpoint(start, first), b = midpoint(first, second), c = midpoint(second, end)
        let d = midpoint(a, b), e = midpoint(b, c), middle = midpoint(d, e)
        return (WindowIndicatorCubic(start: start, first: a, second: d, end: middle),
            WindowIndicatorCubic(start: middle, first: e, second: c, end: end))
    }
}

struct WindowIndicatorRouteSegment {
    let curve: WindowIndicatorCubic
    let lower: Double
    let upper: Double
    let geometry: WindowIndicatorGeometry
}

struct WindowIndicatorRoute {
    let curves: [WindowIndicatorCubic]
    let segments: [WindowIndicatorRouteSegment]
    var start: WindowInputPoint { curves[0].start }
    var end: WindowInputPoint { curves[curves.count - 1].end }
}

// Convex-hull containment certifies the entire curve, not just sampled points.
// Subdivision keeps every backing surface under the original resource caps.
func windowIndicatorCurveEnvelope(_ curve: WindowIndicatorCubic, bounds: Rect,
                                  directions: (Double, Double)? = nil, regions: [Rect]? = nil) -> WindowIndicatorGeometry? {
    let preferredX = curve.start.x + 28 <= bounds.x + bounds.width ? 1.0 : -1.0
    let preferredY = curve.start.y + 28 <= bounds.y + bounds.height ? 1.0 : -1.0
    let mirrors = directions.map { [$0] } ?? [(preferredX, preferredY), (-preferredX, preferredY),
        (preferredX, -preferredY), (-preferredX, -preferredY)]
    for (sx, sy) in mirrors {
        let surfaces = curve.controls.map { windowIndicatorSurface($0, xDirection: sx, yDirection: sy) }
        guard surfaces.allSatisfy({ $0.valid && bounds.contains($0) }) else { continue }
        let left = surfaces.map(\.x).min()!, top = surfaces.map(\.y).min()!
        let right = surfaces.map { $0.x + $0.width }.max()!, bottom = surfaces.map { $0.y + $0.height }.max()!
        let surface = Rect(x: left, y: top, width: right - left, height: bottom - top)
        guard surface.valid, bounds.contains(surface), surface.width <= windowIndicatorMaximumEnvelopeExtent,
              surface.height <= windowIndicatorMaximumEnvelopeExtent, surface.width * surface.height <= 1_048_576,
              regions.map({ windowIndicatorRegionsContain(surface, regions: $0) }) ?? true else { continue }
        return WindowIndicatorGeometry(surface: surface, displayPoint: curve.start, xDirection: sx, yDirection: sy)
    }
    return nil
}

func windowIndicatorSubdividedRoute(_ curves: [WindowIndicatorCubic], bounds: Rect, regions: [Rect]? = nil) -> WindowIndicatorRoute? {
    guard bounds.valid, !curves.isEmpty, curves.count <= 2,
          curves.flatMap(\.controls).allSatisfy({ $0.valid && bounds.contains(x: $0.x, y: $0.y) }),
          curves.count == 1 || curves[0].end == curves[1].start else { return nil }
    // Preserve one mirror across the path whenever its endpoints allow it.
    let common = [(1.0, 1.0), (-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)].first { sx, sy in
        curves.flatMap(\.controls).allSatisfy { bounds.contains(windowIndicatorSurface($0, xDirection: sx, yDirection: sy)) }
    }
    var pieces = curves.enumerated().map { index, curve in
        (curve, Double(index) / Double(curves.count), Double(index + 1) / Double(curves.count))
    }
    var segments: [WindowIndicatorRouteSegment] = []
    var index = 0
    while index < pieces.count {
        let (curve, lower, upper) = pieces[index]
        if let geometry = windowIndicatorCurveEnvelope(curve, bounds: bounds, directions: common, regions: regions) {
            segments.append(WindowIndicatorRouteSegment(curve: curve, lower: lower, upper: upper, geometry: geometry))
            index += 1
        } else {
            guard pieces.count < windowIndicatorMaximumRouteSegments else { return nil }
            let (first, second) = curve.split(), middle = (lower + upper) / 2
            pieces.replaceSubrange(index...index, with: [(first, lower, middle), (second, middle, upper)])
        }
    }
    return WindowIndicatorRoute(curves: curves, segments: segments)
}

// A compact independent planner: confirmed cubic families inform the visual
// shape, while every candidate must satisfy our stricter frozen-window proof.
func windowIndicatorRoute(from start: WindowInputPoint, to end: WindowInputPoint, bounds: Rect, regions: [Rect]? = nil) -> WindowIndicatorRoute? {
    guard start.valid, end.valid, start != end else { return nil }
    let dx = end.x - start.x, dy = end.y - start.y, distance = hypot(dx, dy)
    let ux = dx / distance, uy = dy / distance
    func shifted(_ point: WindowInputPoint, along: Double, normal: Double = 0) -> WindowInputPoint {
        WindowInputPoint(x: point.x + ux * along - uy * normal, y: point.y + uy * along + ux * normal)
    }
    let straight = WindowIndicatorCubic(start: start, first: shifted(start, along: distance / 3),
        second: shifted(start, along: distance * 2 / 3), end: end)
    if distance <= 196 { return windowIndicatorSubdividedRoute([straight], bounds: bounds, regions: regions) }
    var candidates: [[WindowIndicatorCubic]] = []
    let angle = -44.0 * Double.pi / 180, vx = sin(angle), vy = cos(angle)
    for gain in [1.0, 0.65] {
        let first = max(48, min(distance * 0.41960295, 640, distance * 0.9)) * gain
        let second = max(48, min(distance * 0.15, 640, distance * 0.9)) * gain
        candidates.append([WindowIndicatorCubic(start: start,
            first: WindowInputPoint(x: start.x + vx * first, y: start.y + vy * first),
            second: WindowInputPoint(x: end.x - vx * second, y: end.y - vy * second), end: end)])
    }
    let middle = WindowInputPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
    let offset = min(520, max(50, distance * 0.27655))
    let middleHandle = min(220, max(24, distance * 0.26)), endpointHandle = min(240, distance * 0.2)
    for gain in [0.55, 0.8, 1.05, 0.25] {
        for sign in [1.0, -1.0] {
            let join = shifted(middle, along: 0, normal: offset * gain * sign)
            candidates.append([
                WindowIndicatorCubic(start: start, first: shifted(start, along: endpointHandle),
                    second: shifted(join, along: -middleHandle), end: join),
                WindowIndicatorCubic(start: join, first: shifted(join, along: middleHandle),
                    second: shifted(end, along: -endpointHandle), end: end),
            ])
        }
    }
    func score(_ curves: [WindowIndicatorCubic]) -> Double {
        var length = 0.0, totalTurn = 0.0, energy = 0.0, maximumTurn = 0.0
        var previous = start, heading: Double?
        for curve in curves {
            for step in 1...32 {
                let point = curve.point(Double(step) / 32)
                let x = point.x - previous.x, y = point.y - previous.y
                length += hypot(x, y)
                if hypot(x, y) > 0.000001 {
                    let angle = atan2(y, x)
                    if let old = heading {
                        let turn = abs(atan2(sin(angle - old), cos(angle - old)))
                        totalTurn += turn; energy += turn * turn; maximumTurn = max(maximumTurn, turn)
                    }
                    heading = angle
                }
                previous = point
            }
        }
        return length + max(0, length / distance - 1) * 320 + energy * 140
            + maximumTurn * 180 + totalTurn * 18 + (curves.count == 2 ? 45 : 0)
    }
    let routes = candidates.compactMap { curves -> (WindowIndicatorRoute, Double)? in
        guard let route = windowIndicatorSubdividedRoute(curves, bounds: bounds, regions: regions) else { return nil }
        return (route, score(curves))
    }
    if let selected = routes.min(by: { $0.1 < $1.1 }) { return selected.0 }
    // A near-edge target can disallow every bowed curve. A fully certified
    // segmented line still moves continuously; an unprovable route is refused.
    return windowIndicatorSubdividedRoute([straight], bounds: bounds, regions: regions)
}

struct WindowIndicatorMotion {
    let from: WindowInputPoint
    let to: WindowInputPoint
    let began: UInt64
    let duration: UInt64
    let route: WindowIndicatorRoute?
    private(set) var segmentIndex = 0
    private var segmentBegan: UInt64
    private var elapsedBeforeSegment: UInt64 = 0
    init?(from: WindowInputPoint, to: WindowInputPoint, began: UInt64) {
        guard from.valid, to.valid, from != to else { return nil }
        self.from = from; self.to = to; self.began = began; self.segmentBegan = began; self.route = nil
        let distance = hypot(to.x - from.x, to.y - from.y)
        self.duration = UInt64(min(Double(windowIndicatorMaximumMotionDuration), max(120_000_000, distance * 450_000)))
    }
    init(route: WindowIndicatorRoute, began: UInt64) {
        self.from = route.start; self.to = route.end; self.began = began; self.segmentBegan = began; self.route = route
        self.duration = UInt64(min(Double(windowIndicatorMaximumMotionDuration), max(120_000_000, hypot(to.x - from.x, to.y - from.y) * 450_000)))
    }
    func elapsed(at now: UInt64) -> UInt64 {
        min(duration, elapsedBeforeSegment + (now > segmentBegan ? min(duration, now - segmentBegan) : 0))
    }
    func eased(_ elapsed: UInt64) -> Double {
        if elapsed >= duration { return 1 }
        let progress = Double(elapsed) / Double(duration)
        // Critically damped spring response, normalized at the bounded end.
        // It approaches the target monotonically, so every sample remains in
        // the proven envelope rather than springing outside its safe bounds.
        let decay = 8.0
        return min(1, max(0, (1 - (1 + decay * progress) * exp(-decay * progress))
            / (1 - (1 + decay) * exp(-decay))))
    }
    func finished(at now: UInt64) -> Bool {
        (route == nil || segmentIndex == route!.segments.count - 1) && elapsed(at: now) >= duration
    }
    func segmentFinished(at now: UInt64) -> Bool {
        route.map { eased(elapsed(at: now)) >= $0.segments[segmentIndex].upper } ?? finished(at: now)
    }
    var nextSegment: WindowIndicatorRouteSegment? {
        guard let route = route, segmentIndex + 1 < route.segments.count else { return nil }
        return route.segments[segmentIndex + 1]
    }
    mutating func advanceSegment(at now: UInt64) {
        guard let next = nextSegment else { return }
        var lower: UInt64 = 0, upper = duration
        while lower < upper {
            let middle = lower + (upper - lower) / 2
            if eased(middle) < next.lower { lower = middle + 1 } else { upper = middle }
        }
        elapsedBeforeSegment = lower; segmentBegan = now; segmentIndex += 1
    }
    func point(at now: UInt64) -> WindowInputPoint {
        if finished(at: now) { return to }
        let progress = eased(elapsed(at: now))
        if let route = route {
            let segment = route.segments[segmentIndex]
            if now <= segmentBegan || progress <= segment.lower { return segment.curve.start }
            return segment.curve.point(min(1, (progress - segment.lower) / (segment.upper - segment.lower)))
        }
        return WindowInputPoint(x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress)
    }
}

struct WindowIndicatorSpringSample {
    let scale: Double
    let velocity: Double
    let settled: Bool
}

// A bounded damped spring. Its target is .7 on a real posted down
// and 1 on up. Clamp the paint, not the hotspot, to the already guarded surface.
struct WindowIndicatorPressSpring {
    private var target = 1.0
    private var initial = 1.0
    private var velocity = 0.0
    private var began: UInt64 = 0
    func sample(at now: UInt64) -> WindowIndicatorSpringSample {
        guard now > began else { return WindowIndicatorSpringSample(scale: initial, velocity: velocity, settled: initial == target && velocity == 0) }
        let elapsed = Double(now - began) / 1_000_000_000
        if elapsed >= 0.6 { return WindowIndicatorSpringSample(scale: target, velocity: 0, settled: true) }
        let decay = 16.5, frequency = sqrt(400 - decay * decay)
        let displacement = initial - target
        let coefficient = (velocity + decay * displacement) / frequency
        let cosine = cos(frequency * elapsed), sine = sin(frequency * elapsed)
        let exponential = exp(-decay * elapsed)
        let offset = exponential * (displacement * cosine + coefficient * sine)
        let speed = exponential * ((coefficient * frequency - decay * displacement) * cosine
            - (displacement * frequency + decay * coefficient) * sine)
        let settled = abs(offset) < 0.0002 && abs(speed) < 0.002
        return WindowIndicatorSpringSample(scale: settled ? target : min(1, max(0.7, target + offset)),
            velocity: settled ? 0 : speed, settled: settled)
    }
    mutating func setPressed(_ pressed: Bool, at now: UInt64) {
        let next = pressed ? 0.7 : 1.0
        guard next != target else { return }
        let current = sample(at: now)
        initial = current.scale; velocity = current.velocity; target = next; began = now
    }
}

enum WindowIndicatorPointerPhase: String, Decodable { case down, move, up }
struct WindowIndicatorPointerEvent: Decodable {
    let sequence: Int64
    let phase: WindowIndicatorPointerPhase
    let point: WindowInputPoint
}
enum WindowIndicatorCommand {
    case heartbeat
    case plan(WindowIndicatorRequest)
    case pointer(WindowIndicatorPointerEvent)
    case snapshot
    case target(WindowIdentity)
    case inputSettled
    case hide
}

func windowIndicatorCommandCanRunWhileHiding(_ command: WindowIndicatorCommand) -> Bool {
    if case .heartbeat = command { return true }
    return false
}

func windowIndicatorCommand(_ line: Data, frozenWindow: WindowIdentity) throws -> WindowIndicatorCommand {
    if line.isEmpty { return .heartbeat }
    let (_, object) = try parseInput(line, maximumBytes: 4096)
    if object["target"] != nil {
        _ = try fields(object, required: ["target"])
        let value = try fields(object["target"], required: ["windowId", "pid", "processStartedAt", "layer", "bounds"], optional: ["title"])
        try validateRectFields(value["bounds"])
        if let title = value["title"], !(title is String) { throw invalidRequest() }
        guard let bytes = try? JSONSerialization.data(withJSONObject: value),
              let target = try? JSONDecoder().decode(WindowIdentity.self, from: bytes), target.valid,
              windowIndicatorSameAttachment(target, frozenWindow) else { throw invalidRequest() }
        return .target(target)
    }
    if object["hide"] != nil {
        _ = try fields(object, required: ["hide"])
        guard let value = object["hide"] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID(), value.boolValue else { throw invalidRequest() }
        return .hide
    }
    if object["pointer"] != nil {
        _ = try fields(object, required: ["pointer"])
        let pointer = try fields(object["pointer"], required: ["sequence", "phase", "point"])
        _ = try fields(pointer["point"], required: ["x", "y"])
        guard let payload = try? JSONSerialization.data(withJSONObject: pointer),
              let event = try? JSONDecoder().decode(WindowIndicatorPointerEvent.self, from: payload),
              event.sequence > 0, event.sequence <= 9_007_199_254_740_991,
              event.point.valid, frozenWindow.bounds.contains(x: event.point.x, y: event.point.y) else { throw invalidRequest() }
        return .pointer(event)
    }
    if object["snapshot"] != nil {
        _ = try fields(object, required: ["snapshot"])
        guard let value = object["snapshot"] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID(), value.boolValue else { throw invalidRequest() }
        return .snapshot
    }
    if object["inputSettled"] != nil {
        _ = try fields(object, required: ["inputSettled"])
        guard let value = object["inputSettled"] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID(), value.boolValue else { throw invalidRequest() }
        return .inputSettled
    }
    guard let request = try windowIndicatorUpdate(line, frozenWindow: frozenWindow) else { return .heartbeat }
    return .plan(request)
}

struct WindowIndicatorPointerState {
    private(set) var sequence: Int64 = 0
    private(set) var pressed = false
    mutating func accept(_ event: WindowIndicatorPointerEvent) throws {
        guard event.sequence > sequence, event.sequence <= 9_007_199_254_740_991,
              event.point.valid, event.phase != .move || pressed else { throw invalidRequest() }
        sequence = event.sequence
        if event.phase == .down { pressed = true }
        if event.phase == .up { pressed = false }
    }
    mutating func discardStaleGeometry(_ event: WindowIndicatorPointerEvent) throws {
        guard event.sequence > sequence, event.sequence <= 9_007_199_254_740_991, event.point.valid else { throw invalidRequest() }
        sequence = event.sequence; pressed = false
    }
    mutating func inputSettled() { pressed = false }
}

// Mirror the body when needed, keeping its tip at the exact action point. Its
// complete bounded glow surface must fit inside the frozen target; otherwise
// decline the visual instead of clipping it or shifting the intended point.
func windowIndicatorGeometry(_ request: WindowIndicatorRequest) -> WindowIndicatorGeometry? {
    guard request.valid else { return nil }
    let bounds = request.menuSurface.map(windowIndicatorMenuDrawingBounds) ?? request.window.bounds
    let point = request.point
    let preferredX = point.x + 28 <= bounds.x + bounds.width ? 1.0 : -1.0
    let preferredY = point.y + 28 <= bounds.y + bounds.height ? 1.0 : -1.0
    for (sx, sy) in [(preferredX, preferredY), (-preferredX, preferredY),
                     (preferredX, -preferredY), (-preferredX, -preferredY)] {
        let surface = windowIndicatorSurface(point, xDirection: sx, yDirection: sy)
        guard surface.valid, surface.width <= 36, surface.height <= 36, bounds.contains(surface) else { continue }
        return WindowIndicatorGeometry(surface: surface, displayPoint: point, xDirection: sx, yDirection: sy)
    }
    return nil
}

// Same rounded kite used by the renderer. All coordinates originate at the
// exact hotspot; only the body is mirrored. Constructing this path is pure.
func windowIndicatorArrowPath(_ geometry: WindowIndicatorGeometry, pressScale: Double = 1) -> NSBezierPath {
    let origin = CGPoint(x: geometry.displayPoint.x - geometry.surface.x,
        y: geometry.displayPoint.y - geometry.surface.y)
    func vertex(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: origin.x + x * windowIndicatorArrowScale * pressScale * geometry.xDirection,
            y: origin.y + y * windowIndicatorArrowScale * pressScale * geometry.yDirection)
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

// Visual attachment is distinct from the exact observation used for input.
// Only a main-owned target command may replace that exact approved snapshot.
func windowIndicatorSameAttachment(_ lhs: WindowIdentity, _ rhs: WindowIdentity) -> Bool {
    lhs.windowId > 0 && lhs.windowId == rhs.windowId && lhs.pid > 0 && lhs.pid == rhs.pid
        && lhs.processStartedAt != nil && lhs.processStartedAt == rhs.processStartedAt
}

func windowIndicatorVisualIdentityValid(_ window: WindowIdentity) -> Bool {
    (0...windowIndicatorElevatedLayer).contains(window.layer)
        && WindowIdentity(windowId: window.windowId, pid: window.pid, processStartedAt: window.processStartedAt,
            layer: 0, bounds: window.bounds, title: window.title).valid
        && (window.title == nil || validSemanticText(window.title!, maximumBytes: 256))
}

// Window-local coordinates follow translation without becoming a new action
// point. Resize never clamps an out-of-bounds hotspot into another control.
func windowIndicatorAttachedPoint(local: WindowInputPoint, window: WindowIdentity) -> WindowInputPoint? {
    let point = WindowInputPoint(x: window.bounds.x + local.x, y: window.bounds.y + local.y)
    guard windowIndicatorVisualIdentityValid(window), point.valid,
          window.bounds.contains(x: point.x, y: point.y) else { return nil }
    return point
}

func windowIndicatorSmallGeometry(point: WindowInputPoint, bounds: Rect,
                                  directions: (Double, Double)? = nil, regions: [Rect]? = nil) -> WindowIndicatorGeometry? {
    let preferredX = point.x + 28 <= bounds.x + bounds.width ? 1.0 : -1.0
    let preferredY = point.y + 28 <= bounds.y + bounds.height ? 1.0 : -1.0
    let mirrors = directions.map { [$0] } ?? [(preferredX, preferredY), (-preferredX, preferredY),
        (preferredX, -preferredY), (-preferredX, -preferredY)]
    for (sx, sy) in mirrors {
        let surface = windowIndicatorSurface(point, xDirection: sx, yDirection: sy)
        if surface.valid && surface.width <= 36 && surface.height <= 36 && bounds.contains(surface)
            && (regions.map { windowIndicatorRegionsContain(surface, regions: $0) } ?? true) {
            return WindowIndicatorGeometry(surface: surface, displayPoint: point, xDirection: sx, yDirection: sy)
        }
    }
    return nil
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
    case cancelled, hidden, parentChanged = "parent_changed", displayChanged = "display_changed"
    case panelFocused = "panel_focused", helperFrontmost = "helper_frontmost"
    case foregroundUnknown = "foreground_unknown", foregroundChanged = "foreground_changed"
    case repairBudgetExceeded = "repair_budget_exceeded", repairTimedOut = "repair_timed_out"
    case heartbeatExpired = "heartbeat_expired", inputEOF = "input_eof", inputReadFailed = "input_read_failed"
    case protocolInvalid = "protocol_invalid", geometryUnavailable = "geometry_unavailable"
    case initialReadTimedOut = "initial_read_timed_out", initialTargetInvalid = "initial_target_invalid"
    case menuUnavailable = "menu_unavailable"
}

enum WindowIndicatorDiagnostic: String {
    case exit, repairBegin = "repair_begin", repairSucceeded = "repair_succeeded", repairFailed = "repair_failed"
}

let windowIndicatorLogger = Logger(subsystem: "com.omniflow.agent.computer-use", category: "window-indicator")
func windowIndicatorLog(_ event: WindowIndicatorDiagnostic, _ reason: WindowIndicatorReason) {
    windowIndicatorLogger.notice("event=\(event.rawValue, privacy: .public) reason=\(reason.rawValue, privacy: .public)")
}

func windowIndicatorStackState(_ entries: [WindowIndicatorStackEntry], target: WindowIdentity,
                               targetStartedAt: Int64?, panelId: UInt32, panelPID: Int32, panelBounds: Rect,
                               expectedLayer: Int32 = 0, elevated: Bool? = nil,
                               menuSurfaces: [WindowIdentity] = []) -> WindowIndicatorReason {
    guard windowIndicatorVisualIdentityValid(target), targetStartedAt == target.processStartedAt, panelId > 0, panelId != target.windowId,
          panelPID > 0, panelPID != target.pid, panelBounds.valid,
          let regions = windowIndicatorRegions(anchor: target, menus: menuSurfaces),
          windowIndicatorRegionsContain(panelBounds, regions: regions),
          expectedLayer == (menuSurfaces.isEmpty ? target.layer : windowIndicatorElevatedLayer),
          elevated == nil || elevated == !menuSurfaces.isEmpty else { return .identityInvalid }
    guard entries.count <= 4096 else { return .metadataInvalid }
    let targets = entries.indices.filter { entries[$0].windowId == target.windowId }
    let panels = entries.indices.filter { entries[$0].windowId == panelId }
    guard targets.count <= 1, panels.count <= 1 else { return .metadataInvalid }
    guard let targetIndex = targets.first else { return .targetUnavailable }
    let actual = entries[targetIndex]
    guard actual.onScreen && actual.pid == target.pid && actual.layer == target.layer
        && actual.bounds == target.bounds && actual.title == target.title
        && actual.alpha.isFinite && actual.alpha > 0 && actual.alpha <= 1 else { return .targetChanged }
    for menu in menuSurfaces {
        let matches = entries.indices.filter { entries[$0].windowId == menu.windowId }
        guard matches.count == 1, let index = matches.first else { return .menuUnavailable }
        let entry = entries[index]
        guard entry.onScreen && entry.pid == menu.pid && entry.layer == menu.layer && entry.bounds == menu.bounds
            && entry.title == menu.title && entry.alpha.isFinite && entry.alpha > 0 && entry.alpha <= 1 else { return .menuUnavailable }
    }
    guard let panelIndex = panels.first else { return .panelUnavailable }
    let panel = entries[panelIndex]
    guard panel.onScreen && panel.pid == panelPID && panel.layer == expectedLayer && panel.bounds == panelBounds
        && panel.alpha.isFinite && panel.alpha > 0 && panel.alpha <= 1 else { return .panelChanged }
    if !menuSurfaces.isEmpty {
        guard panelBounds.width <= 36, panelBounds.height <= 36, expectedLayer == windowIndicatorElevatedLayer,
              menuSurfaces.allSatisfy({ menu in entries.firstIndex(where: { $0.windowId == menu.windowId }).map { panelIndex < $0 } == true })
            else { return .orderChanged }
    }
    // Only a bound menu owns an overlay. Ordinary motion, pressed state and
    // application activation cannot lift feedback through a covering window.
    if !menuSurfaces.isEmpty {
        return panelIndex < targetIndex ? .safe : .orderChanged
    }
    // AppKit may place a title-bar accessory between an ordered panel and its
    // target. The entire panel surface must remain below every surface that
    // could cover that part of the target; same-PID windows get no exemption.
    // A known order change can be repaired while clear. Unknown metadata or
    // non-normal crossed windows cannot authorize another ordering attempt.
    var interveningIds = Set<UInt32>()
    var overlaps = false
    for entry in entries[(min(panelIndex, targetIndex) + 1)..<max(panelIndex, targetIndex)] {
        guard entry.windowId > 0, interveningIds.insert(entry.windowId).inserted,
              entry.pid > 0, entry.layer == target.layer, entry.onScreen, entry.bounds.valid,
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

func windowIndicatorKnownPlacementTransition(_ entries: [WindowIndicatorStackEntry], target: WindowIdentity,
                                             targetStartedAt: Int64?, panelId: UInt32, panelPID: Int32,
                                             previousBounds: Rect, previousLayer: Int32,
                                             bounds: Rect, layer: Int32) -> Bool {
    guard previousLayer == target.layer, layer == target.layer else { return false }
    // WindowServer can acknowledge setLevel and setFrame in either order. A
    // finite known old/new combination is pending, never an actual ready ACK.
    for (candidateBounds, candidateLayer) in [(previousBounds, previousLayer), (previousBounds, layer), (bounds, previousLayer)] {
        let status = windowIndicatorStackState(entries, target: target, targetStartedAt: targetStartedAt,
            panelId: panelId, panelPID: panelPID, panelBounds: candidateBounds, expectedLayer: candidateLayer)
        if status == .safe || status == .orderChanged { return true }
    }
    return false
}

// Project only an actually reported, safe owned window. Nil and an empty CG
// title are different identities for the capture revalidation contract.
func windowIndicatorSnapshotProjection(_ entries: [WindowIndicatorStackEntry], target: WindowIdentity,
                                      targetStartedAt: Int64?, panelId: UInt32, panelPID: Int32,
                                      panelStartedAt: Int64?, panelBounds: Rect, expectedLayer: Int32,
                                      menuSurface: WindowIdentity? = nil, point: WindowInputPoint? = nil) -> [String: Any]? {
    if let menu = menuSurface {
        guard let point = point, point.valid, menu.bounds.contains(x: point.x, y: point.y),
              [(1.0, 1.0), (-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)]
                .contains(where: { windowIndicatorSurface(point, xDirection: $0.0, yDirection: $0.1) == panelBounds }) else { return nil }
    }
    guard let startedAt = panelStartedAt, startedAt > 0, startedAt <= 9_007_199_254_740_991,
          panelBounds.width <= 128, panelBounds.height <= 128,
          windowIndicatorStackState(entries, target: target, targetStartedAt: targetStartedAt,
            panelId: panelId, panelPID: panelPID, panelBounds: panelBounds, expectedLayer: expectedLayer,
            menuSurfaces: menuSurface.map { [$0] } ?? []) == .safe,
          let own = entries.first(where: { $0.windowId == panelId }) else { return nil }
    var window: [String: Any] = ["windowId": own.windowId, "pid": own.pid, "processStartedAt": startedAt,
        "layer": own.layer, "bounds": own.bounds.json]
    if let title = own.title {
        guard validSemanticText(title, maximumBytes: 256) else { return nil }
        window["title"] = title
    }
    let receipt: [String: Any] = ["ok": true, "shown": true, "window": window]
    guard let serialized = try? JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]), serialized.count < 512 else { return nil }
    return receipt
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
                                  repairOrder: () -> WindowIndicatorReason? = { nil },
                                  pump: (UInt64) -> Void) -> WindowIndicatorReason {
    guard let expectedForeground = expectedForeground, expectedForeground > 0 else { return .foregroundUnknown }
    var flushed = false
    while now() < deadline {
        let status = state()
        // A simultaneous foreground change must not hide a fatal identity,
        // cancellation or accidental helper-focus failure behind recovery.
        guard status == .safe || status == .orderChanged || status == .panelUnavailable else { return status }
        guard foreground() == expectedForeground else { return .foregroundChanged }
        guard now() < deadline else { return .repairTimedOut }
        // Observation stays side-effect free: only reorder after this sample's
        // fatal guards, foreground identity and original deadline all pass.
        if status == .orderChanged, let failure = repairOrder() { return failure }
        if status == .safe && flushed { return .safe }
        let current = now()
        guard current < deadline else { return .repairTimedOut }
        pump(current + min(5_000_000, deadline - current))
        flushed = true
    }
    return .repairTimedOut
}

// Foreground application changes affect visual ordering, not the attachment or
// any input grant. Clear the old pixels before a fresh placement attempt. The
// caller revalidates the same target and recomputes the current layer; retries
// share one absolute placement deadline and never restart a route or heartbeat.
func windowIndicatorAwaitStablePlacement(deadline: UInt64, now: () -> UInt64,
                                         attempt: (Bool) -> WindowIndicatorReason,
                                         suspend: () -> Void, pump: (UInt64) -> Void) -> WindowIndicatorReason {
    var recovering = false
    while now() < deadline {
        let status = attempt(recovering)
        guard status == .foregroundChanged || status == .foregroundUnknown else {
            return status == .safe && now() >= deadline ? .repairTimedOut : status
        }
        suspend()
        recovering = true
        let current = now()
        guard current < deadline else { return .repairTimedOut }
        pump(current + min(5_000_000, deadline - current))
    }
    return .repairTimedOut
}

func windowIndicatorStack(targetWindowId: UInt32, ownedPanelId: UInt32? = nil,
                          menuWindowIds: [UInt32] = []) -> [WindowIndicatorStackEntry]? {
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
        // Other windows contribute ordering metadata only. An explicit snapshot
        // also needs this helper's actual CG title for exact capture identity.
        let title = id == targetWindowId || id == ownedPanelId || menuWindowIds.contains(id) ? item[kCGWindowName as String] as? String : nil
        if let title = title, title.utf8.count > 256 { return nil }
        result.append(WindowIndicatorStackEntry(windowId: id, pid: pid, layer: layer,
            bounds: Rect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height),
            title: title, alpha: alpha, onScreen: onScreen))
    }
    return result
}

// Only the attached window's metadata is inspected outside the current Space.
// Off-Space/minimized is a temporary visual suspension. A briefly missing
// metadata row is hidden under a fixed recovery deadline, never permission to
// capture or send input without an exact target.
struct WindowIndicatorAttachmentSample {
    let window: WindowIdentity
    let visible: Bool
}
func windowIndicatorAttachmentSample(_ entries: [WindowIndicatorStackEntry], anchor: WindowIdentity,
                                     processStartedAt: Int64?, applicationHidden: Bool) -> WindowIndicatorAttachmentSample? {
    guard processStartedAt == anchor.processStartedAt, entries.count == 1, let actual = entries.first,
          actual.windowId == anchor.windowId, actual.pid == anchor.pid,
          actual.alpha.isFinite, actual.alpha >= 0, actual.alpha <= 1 else { return nil }
    let window = WindowIdentity(windowId: actual.windowId, pid: actual.pid, processStartedAt: processStartedAt,
        layer: actual.layer, bounds: actual.bounds, title: actual.title)
    guard windowIndicatorVisualIdentityValid(window) else { return nil }
    return WindowIndicatorAttachmentSample(window: window,
        visible: actual.onScreen && actual.alpha > 0 && !applicationHidden)
}
enum WindowIndicatorAttachmentRead {
    case sample(WindowIndicatorAttachmentSample)
    case missing
    case invalid
}
let windowIndicatorAttachmentRecoveryBudget: UInt64 = 250_000_000
struct WindowIndicatorAttachmentRecovery {
    private(set) var missingSince: UInt64?
    mutating func missing(at now: UInt64) -> Bool {
        if missingSince == nil { missingSince = now }
        guard let began = missingSince, now >= began else { return false }
        return now - began < windowIndicatorAttachmentRecoveryBudget
    }
    mutating func confirmed() { missingSince = nil }
}
func windowIndicatorAttachmentRead(_ raw: [[String: Any]]?, anchor: WindowIdentity,
                                  processStartedAt: Int64?, applicationHidden: Bool) -> WindowIndicatorAttachmentRead {
    guard processStartedAt == anchor.processStartedAt, let raw = raw else { return .invalid }
    if raw.isEmpty { return .missing }
    guard raw.count == 1, let item = raw.first,
          let id = item[kCGWindowNumber as String] as? UInt32,
          let pid = item[kCGWindowOwnerPID as String] as? Int32,
          let layer = item[kCGWindowLayer as String] as? Int32,
          let alpha = item[kCGWindowAlpha as String] as? Double,
          let dictionary = item[kCGWindowBounds as String] as? [String: Any],
          let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary) else { return .invalid }
    // CGWindow.h specifies that an absent kCGWindowIsOnscreen means the window
    // is not ordered on screen. Absence suspends pixels; it is neither invalid
    // identity metadata nor proof that the window has been destroyed.
    let visibility = item[kCGWindowIsOnscreen as String]
    guard visibility == nil || visibility is Bool else { return .invalid }
    let title = item[kCGWindowName as String]
    guard title == nil || title is String else { return .invalid }
    let entry = WindowIndicatorStackEntry(windowId: id, pid: pid, layer: layer,
        bounds: Rect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height),
        title: title as? String, alpha: alpha, onScreen: visibility as? Bool ?? false)
    guard let sample = windowIndicatorAttachmentSample([entry], anchor: anchor, processStartedAt: processStartedAt,
        applicationHidden: applicationHidden) else { return .invalid }
    return .sample(sample)
}
func windowIndicatorReadAttachmentResult(_ anchor: WindowIdentity) -> WindowIndicatorAttachmentRead {
    guard let application = NSRunningApplication(processIdentifier: anchor.pid), !application.isTerminated else { return .invalid }
    let startedAt = processStart(anchor.pid)
    guard startedAt == anchor.processStartedAt else { return .invalid }
    let raw = CGWindowListCopyWindowInfo(.optionIncludingWindow, anchor.windowId) as? [[String: Any]]
    return windowIndicatorAttachmentRead(raw, anchor: anchor, processStartedAt: startedAt, applicationHidden: application.isHidden)
}
func windowIndicatorReadAttachment(_ anchor: WindowIdentity) -> WindowIndicatorAttachmentSample? {
    if case .sample(let sample) = windowIndicatorReadAttachmentResult(anchor) { return sample }
    return nil
}
func windowIndicatorMenuIsCurrent(_ menu: WindowIdentity, anchor: WindowIdentity) -> Bool {
    guard windowIndicatorMenuIdentityValid(menu, anchor: anchor),
          let actual = windowIndicatorReadAttachment(menu), actual.visible else { return false }
    return windowIndicatorSameMenu(actual.window, menu)
}

// A visible small panel may retain its already-painted old placement while
// WindowServer acknowledges the exact new placement. No other frame, owner or
// level is accepted; callers keep one absolute deadline and stop on failure.
func windowIndicatorPlacementState(_ entries: [WindowIndicatorStackEntry], target: WindowIdentity,
                                   targetStartedAt: Int64?, panelId: UInt32, panelPID: Int32,
                                   previousBounds: Rect, previousLayer: Int32, bounds: Rect, layer: Int32,
                                   elevated: Bool? = nil, previousVisible: Bool = true,
                                   previousElevated: Bool? = nil, menuSurfaces: [WindowIdentity] = []) -> WindowIndicatorReason {
    let exact = windowIndicatorStackState(entries, target: target, targetStartedAt: targetStartedAt,
        panelId: panelId, panelPID: panelPID, panelBounds: bounds, expectedLayer: layer, elevated: elevated, menuSurfaces: menuSurfaces)
    guard exact == .panelChanged else { return exact }
    guard previousBounds.valid, previousBounds.width <= 36, previousBounds.height <= 36,
          (0...windowIndicatorElevatedLayer).contains(previousLayer),
          let own = entries.first(where: { $0.windowId == panelId }), own.pid == panelPID,
          own.onScreen, own.alpha.isFinite, own.alpha > 0, own.alpha <= 1,
          [(previousBounds, previousLayer), (previousBounds, layer), (bounds, previousLayer)]
            .contains(where: { $0.0 == own.bounds && $0.1 == own.layer }) else { return exact }
    // StackState already checked the exact current target before panelChanged.
    // Retaining pixels also requires the actual old surface to be safe in the
    // current target and stack. A previously hidden/cleared surface can await
    // its exact new placement without drawing stale pixels outside the target.
    if previousVisible {
        let actualElevated = (own.layer == layer ? elevated : previousElevated) ?? !menuSurfaces.isEmpty
        let previous = windowIndicatorStackState(entries, target: target, targetStartedAt: targetStartedAt,
            panelId: panelId, panelPID: panelPID, panelBounds: own.bounds, expectedLayer: own.layer,
            elevated: actualElevated, menuSurfaces: own.layer == windowIndicatorElevatedLayer ? menuSurfaces : [])
        guard previous == .safe else { return previous == .identityInvalid ? .panelChanged : previous }
    }
    return .panelUnavailable
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
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

// A popup plan needs a real paired subscription and a captured generation.
// A focused-window-only monitor cannot prove that a menu has not closed and
// reopened. Ordinary root plans still work without any menu observer.
func windowIndicatorMenuLifecycleIsCurrent(hasMenus: Bool, supported: Bool?,
                                          captured: UInt64?, current: UInt64?) -> Bool {
    guard hasMenus else { return true }
    guard supported == true, let captured = captured, let current = current else { return false }
    return captured == current
}

// Passive, target-PID-only menu notifications. No observer callback activates
// an app or chooses another focused window. Unsupported notifications leave
// the root isActive/movement policy available, but cannot authorize menu paint.
final class WindowIndicatorMenuMonitor {
    private var observer: AXObserver?
    private let application: AXUIElement
    private var notifications: [CFString] = []
    private(set) var openMenus = 0
    private(set) var closedGeneration: UInt64 = 0
    private(set) var supportsMenuLifecycle = false
    private(set) var needsWindowRevalidation = false
    init?(pid: Int32) {
        application = AXUIElementCreateApplication(pid)
        var created: AXObserver?
        let result = AXObserverCreate(pid, { _, _, notification, context in
            guard let context = context else { return }
            let monitor = Unmanaged<WindowIndicatorMenuMonitor>.fromOpaque(context).takeUnretainedValue()
            if notification as String == kAXMenuOpenedNotification { monitor.openMenus = min(16, monitor.openMenus + 1) }
            if notification as String == kAXMenuClosedNotification {
                monitor.openMenus = max(0, monitor.openMenus - 1)
                monitor.closedGeneration &+= 1
            }
            if notification as String == kAXFocusedWindowChangedNotification { monitor.needsWindowRevalidation = true }
        }, &created)
        guard result == .success, let created = created else { return nil }
        observer = created
        let context = Unmanaged.passUnretained(self).toOpaque()
        let opened = kAXMenuOpenedNotification as CFString, closed = kAXMenuClosedNotification as CFString
        let canOpen = AXObserverAddNotification(created, application, opened, context) == .success
        let canClose = AXObserverAddNotification(created, application, closed, context) == .success
        if canOpen && canClose {
            notifications += [opened, closed]
            supportsMenuLifecycle = true
        }
        else {
            if canOpen { AXObserverRemoveNotification(created, application, opened) }
            if canClose { AXObserverRemoveNotification(created, application, closed) }
        }
        let focused = kAXFocusedWindowChangedNotification as CFString
        if AXObserverAddNotification(created, application, focused, context) == .success { notifications.append(focused) }
        guard !notifications.isEmpty else { return nil }
        CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(created), .defaultMode)
    }
    func takeWindowRevalidation() -> Bool {
        let result = needsWindowRevalidation
        needsWindowRevalidation = false
        return result
    }
    deinit {
        if let observer = observer {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
            for notification in notifications { AXObserverRemoveNotification(observer, application, notification) }
        }
    }
}

final class WindowIndicatorView: NSView {
    var request: WindowIndicatorRequest
    var geometry: WindowIndicatorGeometry
    var drawsPlan = false
    var pressScale = 1.0
    var opacity = 1.0
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
        context.setAlpha(CGFloat(min(1, max(0, opacity))))
        // The complete padding is part of the guarded surface. Limit the
        // shadow's raster tail to that surface; NSPanel itself has no shadow.
        context.clip(to: bounds)
        let accent = NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        let highlight = NSColor(srgbRed: rgb.red * 0.55 + 0.45,
            green: rgb.green * 0.55 + 0.45, blue: rgb.blue * 0.55 + 0.45, alpha: 1)
        let arrow = windowIndicatorArrowPath(geometry, pressScale: pressScale)
        accent.withAlphaComponent(0.18).setFill(); arrow.fill()
        context.setShadow(offset: .zero, blur: CGFloat(4 * windowIndicatorArrowScale * pressScale),
            color: accent.withAlphaComponent(0.5).cgColor)
        accent.setStroke(); arrow.lineWidth = CGFloat(2.6 * windowIndicatorArrowScale * pressScale); arrow.stroke()
        context.setShadow(offset: .zero, blur: 0, color: nil)
        highlight.setStroke(); arrow.lineWidth = CGFloat(1.3 * windowIndicatorArrowScale * pressScale); arrow.stroke()
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
    let attachment = request.window
    var approvedWindow = request.window
    var visualWindow = request.window
    guard (try? revalidateWindow(approvedWindow, requireUniqueAXWindow: false)) != nil,
          request.menuSurface.map({ windowIndicatorMenuIsCurrent($0, anchor: approvedWindow) }) ?? true else {
        exitReason = .initialTargetInvalid; emit(["ok": true, "shown": false]); return
    }
    guard let displaySnapshot = windowIndicatorDisplays(),
          let mainDisplay = displaySnapshot.first(where: { $0.id == CGMainDisplayID() }), mainDisplay.bounds.height > 0 else {
        exitReason = .displayChanged; emit(["ok": true, "shown": false]); return
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    guard var geometry = windowIndicatorGeometry(request) else {
        exitReason = .geometryUnavailable; emit(["ok": true, "shown": false]); return
    }
    var localPoint = WindowInputPoint(x: geometry.displayPoint.x - visualWindow.bounds.x,
        y: geometry.displayPoint.y - visualWindow.bounds.y)
    var surface = geometry.surface
    var expectedLayer: Int32 = 0
    var orderedElevated = false
    func appKitFrame(_ rect: Rect) -> NSRect {
        NSRect(x: rect.x, y: mainDisplay.bounds.height - rect.y - rect.height, width: rect.width, height: rect.height)
    }
    let panel = WindowIndicatorPanel(contentRect: appKitFrame(surface), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.becomesKeyOnlyIfNeeded = true
    panel.level = .normal
    panel.ignoresMouseEvents = true
    panel.hidesOnDeactivate = false
    panel.hasShadow = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.animationBehavior = .none
    panel.isReleasedWhenClosed = false
    panel.collectionBehavior = [.transient, .ignoresCycle]
    if #available(macOS 13.0, *) { panel.collectionBehavior.insert(.canJoinAllApplications) }
    let view = WindowIndicatorView(request: request, geometry: geometry)
    view.opacity = 0
    panel.contentView = view
    defer { view.drawsPlan = false; panel.orderOut(nil); panel.close() }
    let menuMonitor = WindowIndicatorMenuMonitor(pid: attachment.pid)
    guard windowIndicatorMenuLifecycleIsCurrent(hasMenus: request.menuSurface != nil,
        supported: menuMonitor?.supportsMenuLifecycle, captured: menuMonitor?.closedGeneration,
        current: menuMonitor?.closedGeneration) else {
        exitReason = .menuUnavailable; emit(["ok": true, "shown": false]); return
    }
    var spaceChanged = false
    let spaceObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification,
        object: nil, queue: .main) { _ in spaceChanged = true }
    defer { NSWorkspace.shared.notificationCenter.removeObserver(spaceObserver) }
    var pointer = WindowIndicatorPointerState()
    var spring = WindowIndicatorPressSpring()
    var motion: WindowIndicatorMotion?
    var fadeOut: WindowIndicatorFadeOut?
    var pendingPlanACK = false
    var pendingPlanDeadline: UInt64?
    var pendingSnapshotDeadline: UInt64?
    var ready = false
    var suspended = true
    var fadeBegan = DispatchTime.now().uptimeNanoseconds
    var repairBudget = WindowIndicatorRepairBudget()
    var motionMenuSurfaces: [WindowIdentity] = []
    var menuClosureGeneration = menuMonitor?.closedGeneration
    // A menu is a frozen visual proof. Once lost, reappearance at the same
    // coordinates cannot revive this plan; a newly validated plan is needed.
    var visualPlanInvalidated = false
    func boundMenus() -> [WindowIdentity] {
        var values = request.menuSurface.map { [$0] } ?? []
        for menu in motionMenuSurfaces where !values.contains(where: { $0.windowId == menu.windowId }) { values.append(menu) }
        return values
    }
    // Keep an ordinary cursor in its target's z-order for its whole lifetime,
    // including approach animation and posted drag feedback. A separately
    // validated menu is the only reason to use the overlay level.
    func usesMenuOverlay() -> Bool { !visualPlanInvalidated && !boundMenus().isEmpty }
    func presentationLayer() -> Int32 { usesMenuOverlay() ? windowIndicatorElevatedLayer : visualWindow.layer }
    func menuBindingsCurrent() -> Bool {
        let menus = boundMenus()
        return !visualPlanInvalidated && windowIndicatorMenuLifecycleIsCurrent(hasMenus: !menus.isEmpty,
            supported: menuMonitor?.supportsMenuLifecycle, captured: menuClosureGeneration,
            current: menuMonitor?.closedGeneration)
            && menus.allSatisfy { windowIndicatorMenuIsCurrent($0, anchor: visualWindow) }
    }
    func visualRegions() -> [Rect]? {
        guard !visualPlanInvalidated else { return nil }
        return windowIndicatorRegions(anchor: visualWindow, menus: boundMenus())
    }
    func draw() {
        view.geometry = geometry; view.request = request
        view.needsDisplay = true; view.displayIfNeeded()
    }
    func suspend() {
        view.drawsPlan = false; draw(); panel.orderOut(nil); suspended = true
    }
    func invalidateMenuPlan() {
        visualPlanInvalidated = true; motion = nil; motionMenuSurfaces = []
        pointer.inputSettled(); spring.setPressed(false, at: DispatchTime.now().uptimeNanoseconds)
        suspend()
        if pendingPlanACK { emit(["ok": true, "shown": false]); pendingPlanACK = false; pendingPlanDeadline = nil }
        if pendingSnapshotDeadline != nil { emit(["ok": true, "shown": false]); pendingSnapshotDeadline = nil }
    }
    func recoverMenuFailure() -> Bool {
        guard exitReason == .menuUnavailable else { return false }
        invalidateMenuPlan(); return true
    }
    func baseState() -> WindowIndicatorReason? {
        if windowIndicatorCancelled != 0 { return .cancelled }
        if getppid() != parentPID || processStart(parentPID) != parentStartedAt { return .parentChanged }
        if windowIndicatorDisplays() != displaySnapshot { return .displayChanged }
        if panel.isKeyWindow || panel.isMainWindow { return .panelFocused }
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid() { return .helperFrontmost }
        return nil
    }
    func state() -> WindowIndicatorReason {
        if let invalid = baseState() { return invalid }
        guard menuBindingsCurrent() else { return .menuUnavailable }
        guard let stack = windowIndicatorStack(targetWindowId: attachment.windowId,
            menuWindowIds: boundMenus().map(\.windowId)) else { return .metadataInvalid }
        return windowIndicatorStackState(stack, target: visualWindow, targetStartedAt: processStart(attachment.pid),
            panelId: UInt32(panel.windowNumber), panelPID: getpid(), panelBounds: surface, expectedLayer: expectedLayer,
            elevated: usesMenuOverlay(), menuSurfaces: boundMenus())
    }
    func orderPanel() {
        if usesMenuOverlay() { panel.orderFront(nil) }
        else { panel.order(.above, relativeTo: Int(attachment.windowId)) }
        orderedElevated = usesMenuOverlay()
    }
    // The panel always remains a 35/36pt surface. Exact old/new placements may
    // be visible while WindowServer catches up; unknown metadata is hidden.
    func placeOnce(_ next: WindowIndicatorGeometry, layer: Int32, deadline: UInt64,
                   recoveringForeground: Bool) -> Bool {
        guard menuBindingsCurrent() else { exitReason = .menuUnavailable; suspend(); return false }
        guard next.surface.valid, next.surface.width <= 36, next.surface.height <= 36,
              let regions = visualRegions(), windowIndicatorRegionsContain(next.surface, regions: regions),
              layer == visualWindow.layer || layer == windowIndicatorElevatedLayer,
              let actual = windowIndicatorReadAttachment(attachment), actual.visible,
              actual.window.bounds == visualWindow.bounds, actual.window.layer == visualWindow.layer,
              actual.window.title == visualWindow.title else { exitReason = .targetChanged; suspend(); return false }
        if let invalid = baseState() { exitReason = invalid; suspend(); return false }
        let previousSurface = surface, previousLayer = expectedLayer
        let previousElevation = orderedElevated
        if !suspended {
            guard let before = windowIndicatorStack(targetWindowId: attachment.windowId, menuWindowIds: boundMenus().map(\.windowId)),
                  let own = before.first(where: { $0.windowId == UInt32(panel.windowNumber) }),
                  own.pid == getpid(), own.bounds == surface, own.layer == expectedLayer else {
                exitReason = .panelChanged; suspend(); return false
            }
            let oldStatus = windowIndicatorStackState(before, target: visualWindow,
                targetStartedAt: processStart(attachment.pid), panelId: UInt32(panel.windowNumber), panelPID: getpid(),
                panelBounds: surface, expectedLayer: expectedLayer, elevated: orderedElevated,
                menuSurfaces: expectedLayer == windowIndicatorElevatedLayer ? boundMenus() : [])
            if oldStatus == .orderChanged || oldStatus == .identityInvalid {
                suspend()
            } else if oldStatus != .safe { exitReason = oldStatus; suspend(); return false }
        }
        let wasSuspended = suspended
        let foreground = NSWorkspace.shared.frontmostApplication?.processIdentifier
        guard foreground != nil else { exitReason = .foregroundUnknown; suspend(); return false }
        // Synchronous attachment/stack reads above can consume the entire
        // placement budget or observe cancellation. Recheck before touching
        // the panel's geometry, level or ordering.
        if let invalid = baseState() { exitReason = invalid; suspend(); return false }
        guard DispatchTime.now().uptimeNanoseconds < deadline else {
            exitReason = .repairTimedOut; suspend(); return false
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == foreground else {
            exitReason = .foregroundChanged; suspend(); return false
        }
        // Nil foreground samples do not reorder anything. Once it is known,
        // recovering shares the same anti-thrashing budget as layer repairs.
        if recoveringForeground && !repairBudget.reserve(now: DispatchTime.now().uptimeNanoseconds) {
            exitReason = .repairBudgetExceeded; suspend(); return false
        }
        geometry = next; surface = next.surface; expectedLayer = layer
        view.geometry = geometry
        view.frame = NSRect(x: 0, y: 0, width: surface.width, height: surface.height)
        if previousLayer != layer { panel.level = NSWindow.Level(rawValue: Int(layer)) }
        let frame = appKitFrame(surface)
        if previousSurface.width == surface.width && previousSurface.height == surface.height { panel.setFrameOrigin(frame.origin) }
        else { panel.setFrame(frame, display: false) }
        // AppKit may reuse the old backing when registering the relocated
        // window. Flush clear content at its new size before ordering it in.
        if wasSuspended { view.drawsPlan = false; draw() }
        let orderingChanged = orderedElevated != usesMenuOverlay()
        if wasSuspended || previousLayer != layer || orderingChanged { orderPanel() }
        let placementDeadline = min(deadline, DispatchTime.now().uptimeNanoseconds + windowIndicatorPlacementBudget)
        var ordered = wasSuspended || previousLayer != layer || orderingChanged
        var transitionVisible = !wasSuspended
        let result = windowIndicatorAwaitSafeOrder(deadline: placementDeadline, expectedForeground: foreground,
            now: { DispatchTime.now().uptimeNanoseconds }, foreground: { NSWorkspace.shared.frontmostApplication?.processIdentifier },
            state: {
                if let invalid = baseState() { return invalid }
                guard menuBindingsCurrent() else { return .menuUnavailable }
                guard let stack = windowIndicatorStack(targetWindowId: attachment.windowId, menuWindowIds: boundMenus().map(\.windowId)) else { return .metadataInvalid }
                let status = windowIndicatorPlacementState(stack, target: visualWindow,
                    targetStartedAt: processStart(attachment.pid), panelId: UInt32(panel.windowNumber), panelPID: getpid(),
                    previousBounds: previousSurface, previousLayer: previousLayer, bounds: surface, layer: expectedLayer,
                    elevated: usesMenuOverlay(), previousVisible: transitionVisible, previousElevated: previousElevation,
                    menuSurfaces: boundMenus())
                return status
            }, repairOrder: {
                let mustOrder = !ordered || transitionVisible
                if transitionVisible { suspend(); transitionVisible = false }
                if mustOrder {
                    guard repairBudget.reserve(now: DispatchTime.now().uptimeNanoseconds) else { return .repairBudgetExceeded }
                    ordered = true; orderPanel()
                }
                return nil
            }, pump: { windowIndicatorPumpEvents(app, deadline: $0) })
        guard result == .safe else {
            exitReason = result
            suspend()
            return false
        }
        suspended = false; view.drawsPlan = true; draw()
        return true
    }
    func place(_ next: WindowIndicatorGeometry, layer: Int32, deadline: UInt64) -> Bool {
        let placementDeadline = min(deadline, DispatchTime.now().uptimeNanoseconds + windowIndicatorPlacementBudget)
        let result = windowIndicatorAwaitStablePlacement(deadline: placementDeadline,
            now: { DispatchTime.now().uptimeNanoseconds }, attempt: { recovering in
                let currentLayer = recovering ? presentationLayer() : layer
                return placeOnce(next, layer: currentLayer, deadline: placementDeadline,
                    recoveringForeground: recovering) ? .safe : exitReason
            }, suspend: { suspend() },
            pump: { windowIndicatorPumpEvents(app, deadline: $0) })
        guard result == .safe else { exitReason = result; suspend(); return false }
        return true
    }
    func smallGeometry(at point: WindowInputPoint, preserveMirror: Bool = true) -> WindowIndicatorGeometry? {
        guard let regions = visualRegions(), let bounds = windowIndicatorRegionBounds(regions) else { return nil }
        if motion == nil && motionMenuSurfaces.isEmpty {
            let targetBounds = request.menuSurface?.bounds ?? visualWindow.bounds
            guard targetBounds.contains(x: point.x, y: point.y) else { return nil }
        }
        return windowIndicatorSmallGeometry(point: point, bounds: bounds,
            directions: preserveMirror ? (geometry.xDirection, geometry.yDirection) : nil, regions: regions)
    }
    func movePanel(to point: WindowInputPoint, deadline: UInt64, preserveMirror: Bool = true) -> Bool {
        guard let next = smallGeometry(at: point, preserveMirror: preserveMirror) else { exitReason = .geometryUnavailable; suspend(); return false }
        localPoint = WindowInputPoint(x: point.x - visualWindow.bounds.x, y: point.y - visualWindow.bounds.y)
        let layer = presentationLayer()
        if !suspended && surface == next.surface && expectedLayer == layer && orderedElevated == usesMenuOverlay() {
            geometry = next
            let status = state()
            if status == .safe { draw(); return true }
            if status != .orderChanged { exitReason = status; suspend(); return false }
        }
        return place(next, layer: layer, deadline: deadline)
    }
    expectedLayer = presentationLayer()
    panel.level = NSWindow.Level(rawValue: Int(expectedLayer))
    guard place(geometry, layer: expectedLayer, deadline: min(began + windowIndicatorRegistrationBudget,
        DispatchTime.now().uptimeNanoseconds + windowIndicatorPlacementBudget)) else { emit(["ok": true, "shown": false]); return }
    fadeBegan = DispatchTime.now().uptimeNanoseconds
    var bytes = [UInt8](repeating: 0, count: 1024)
    var lastInputAt = DispatchTime.now().uptimeNanoseconds
    let idleTimeout: UInt64 = 2_500_000_000
    var attachmentRecovery = WindowIndicatorAttachmentRecovery()
    while true {
        let current = DispatchTime.now().uptimeNanoseconds
        guard current - lastInputAt < idleTimeout else { exitReason = .heartbeatExpired; return }
        if let invalid = baseState() { exitReason = invalid; suspend(); return }
        if !ready && current >= began + windowIndicatorStartupBudget {
            exitReason = .initialReadTimedOut; emit(["ok": true, "shown": false]); return
        }
        if let deadline = pendingPlanDeadline, current >= deadline { exitReason = .repairTimedOut; return }
        var attachmentVisible = false
        var changed = false
        switch windowIndicatorReadAttachmentResult(attachment) {
        case .sample(let live):
            attachmentRecovery.confirmed()
            attachmentVisible = live.visible
            changed = live.window.bounds != visualWindow.bounds || live.window.layer != visualWindow.layer || live.window.title != visualWindow.title
            visualWindow = live.window
        case .missing:
            suspend()
            guard attachmentRecovery.missing(at: current) else { exitReason = .targetUnavailable; return }
        case .invalid:
            exitReason = .targetChanged; suspend(); return
        }
        _ = menuMonitor?.takeWindowRevalidation()
        if spaceChanged { suspend(); spaceChanged = false }
        if changed {
            motion = nil; pointer.inputSettled(); spring.setPressed(false, at: current)
            if pendingPlanACK { emit(["ok": true, "shown": false]); pendingPlanACK = false; pendingPlanDeadline = nil }
            if request.menuSurface != nil || !motionMenuSurfaces.isEmpty { invalidateMenuPlan() }
        }
        if !visualPlanInvalidated && !menuBindingsCurrent() { invalidateMenuPlan() }
        let attached = !boundMenus().isEmpty ? geometry.displayPoint
            : windowIndicatorAttachedPoint(local: localPoint, window: visualWindow)
        if visualPlanInvalidated || !attachmentVisible || attached == nil || attached.flatMap({ smallGeometry(at: $0) }) == nil {
            suspend()
            if motion != nil || pendingPlanACK {
                motion = nil; pendingPlanACK = false; pendingPlanDeadline = nil
                emit(["ok": true, "shown": false])
            }
        } else if changed || suspended {
            if let point = attached, !movePanel(to: point, deadline: lastInputAt + idleTimeout) {
                if !recoverMenuFailure() && exitReason != .targetChanged && exitReason != .targetUnavailable { return }
            }
        }
        for line in pendingLines {
            guard DispatchTime.now().uptimeNanoseconds - lastInputAt < idleTimeout else { exitReason = .heartbeatExpired; return }
            let command = try windowIndicatorCommand(line, frozenWindow: approvedWindow)
            if fadeOut != nil {
                guard windowIndicatorCommandCanRunWhileHiding(command) else { exitReason = .protocolInvalid; return }
                continue
            }
            switch command {
            case .heartbeat: break
            case .target(let target):
                guard ready, !pendingPlanACK, !pointer.pressed, pendingSnapshotDeadline == nil,
                      let latest = windowIndicatorReadAttachment(attachment), latest.visible,
                      windowIndicatorSameWindow(latest.window, target) else {
                    emit(["ok": true, "shown": false]); continue
                }
                // Commit the approved snapshot only after its visual geometry
                // has caught up. A resize may legitimately leave no drawable
                // hotspot; that is a suspended lease, never a remapped click.
                visualWindow = latest.window
                let point = request.menuSurface != nil ? geometry.displayPoint
                    : windowIndicatorAttachedPoint(local: localPoint, window: visualWindow)
                if !visualPlanInvalidated, let point = point,
                   smallGeometry(at: point) != nil {
                    guard movePanel(to: point, deadline: lastInputAt + idleTimeout) else {
                        if recoverMenuFailure() { emit(["ok": true, "shown": false]); continue }
                        emit(["ok": true, "shown": false]); return
                    }
                } else { suspend() }
                guard (try? revalidateWindow(target, requireUniqueAXWindow: false)) != nil else {
                    emit(["ok": true, "shown": false]); return
                }
                approvedWindow = target
                emit(["ok": true, "shown": true])
            case .hide:
                guard ready else { throw invalidRequest() }
                if suspended { exitReason = .hidden; return }
                fadeOut = WindowIndicatorFadeOut(began: DispatchTime.now().uptimeNanoseconds, initialOpacity: view.opacity)
                motion = nil
                pendingPlanACK = false; pendingPlanDeadline = nil; pendingSnapshotDeadline = nil
            case .inputSettled:
                guard ready, !pendingPlanACK else { throw invalidRequest() }
                pointer.inputSettled()
                spring.setPressed(false, at: DispatchTime.now().uptimeNanoseconds)
            case .snapshot:
                guard ready, pendingSnapshotDeadline == nil, !pendingPlanACK else { throw invalidRequest() }
                if suspended || !windowIndicatorSameWindow(visualWindow, approvedWindow) {
                    emit(["ok": true, "shown": false])
                } else { pendingSnapshotDeadline = DispatchTime.now().uptimeNanoseconds + 900_000_000 }
            case .pointer(let event):
                guard ready, !pendingPlanACK else { throw invalidRequest() }
                guard !suspended, request.menuSurface == nil, windowIndicatorSameWindow(visualWindow, approvedWindow) else {
                    try pointer.discardStaleGeometry(event)
                    spring.setPressed(false, at: current); continue
                }
                try pointer.accept(event)
                spring.setPressed(pointer.pressed, at: DispatchTime.now().uptimeNanoseconds)
                guard movePanel(to: event.point, deadline: lastInputAt + idleTimeout, preserveMirror: false) else { return }
            case .plan(let update):
                // Consume queued AX close notifications before admitting a
                // newly observed menu. Capturing the generation afterward
                // also makes close-during-place invalidate synchronous waits.
                windowIndicatorPumpEvents(app, deadline: min(lastInputAt + idleTimeout,
                    DispatchTime.now().uptimeNanoseconds + 5_000_000))
                if !boundMenus().isEmpty && !menuBindingsCurrent() { invalidateMenuPlan() }
                guard ready, !pendingPlanACK, !pointer.pressed, pendingSnapshotDeadline == nil,
                      windowIndicatorSameWindow(visualWindow, approvedWindow), attachmentVisible,
                      (try? revalidateWindow(approvedWindow, requireUniqueAXWindow: false)) != nil,
                      windowIndicatorGeometry(update) != nil else { throw invalidRequest() }
                guard windowIndicatorMenuLifecycleIsCurrent(hasMenus: update.menuSurface != nil,
                    supported: menuMonitor?.supportsMenuLifecycle, captured: menuMonitor?.closedGeneration,
                    current: menuMonitor?.closedGeneration),
                    update.menuSurface.map({ windowIndicatorMenuIsCurrent($0, anchor: approvedWindow) }) ?? true else {
                    emit(["ok": true, "shown": false]); continue
                }
                let updateDeadline = DispatchTime.now().uptimeNanoseconds + windowIndicatorRouteBudget
                let previous = geometry.displayPoint
                let previousMenu = request.menuSurface
                let wasSuspended = suspended || visualPlanInvalidated
                motionMenuSurfaces = []
                if !wasSuspended, let menu = previousMenu, update.menuSurface?.windowId != menu.windowId {
                    motionMenuSurfaces = [menu]
                }
                request = update
                menuClosureGeneration = menuMonitor?.closedGeneration
                visualPlanInvalidated = false
                if wasSuspended || previous == update.point {
                    motionMenuSurfaces = []
                    guard movePanel(to: update.point, deadline: updateDeadline, preserveMirror: !wasSuspended) else {
                        if recoverMenuFailure() { emit(["ok": true, "shown": false]); continue }
                        return
                    }
                    emit(["ok": true, "shown": true])
                } else {
                    guard menuBindingsCurrent(), let regions = visualRegions(), let bounds = windowIndicatorRegionBounds(regions),
                          let route = windowIndicatorRoute(from: previous, to: update.point, bounds: bounds, regions: regions),
                          let first = route.segments.first else {
                        if update.menuSurface != nil || previousMenu != nil {
                            invalidateMenuPlan(); emit(["ok": true, "shown": false]); continue
                        }
                        exitReason = .geometryUnavailable; return
                    }
                    guard let initial = windowIndicatorSmallGeometry(point: previous, bounds: bounds,
                        directions: (first.geometry.xDirection, first.geometry.yDirection), regions: regions),
                        place(initial, layer: presentationLayer(), deadline: updateDeadline) else {
                        if recoverMenuFailure() { emit(["ok": true, "shown": false]); continue }
                        return
                    }
                    motion = WindowIndicatorMotion(route: route, began: DispatchTime.now().uptimeNanoseconds)
                    pendingPlanACK = true; pendingPlanDeadline = updateDeadline
                }
            }
        }
        pendingLines.removeAll(keepingCapacity: true)
        let tick = DispatchTime.now().uptimeNanoseconds
        if let closing = fadeOut {
            if suspended { exitReason = .hidden; return }
            // Menu teardown also applies during fade; ordinary feedback stays
            // in the target's z-order throughout the 440ms animation.
            let layer = presentationLayer()
            if expectedLayer != layer || orderedElevated != usesMenuOverlay() {
                guard movePanel(to: geometry.displayPoint, deadline: min(lastInputAt + idleTimeout,
                    closing.began + windowIndicatorFadeDuration)) else { _ = recoverMenuFailure(); return }
            }
            let status = state()
            guard status == .safe else { exitReason = status; suspend(); return }
            view.opacity = closing.opacity(at: DispatchTime.now().uptimeNanoseconds)
            guard view.opacity > 0 else { exitReason = .hidden; return }
            draw()
        } else {
            let planDeadline = min(lastInputAt + idleTimeout, pendingPlanDeadline ?? UInt64.max)
            guard tick < planDeadline else { exitReason = .repairTimedOut; return }
            if var activeMotion = motion {
                guard movePanel(to: activeMotion.point(at: tick), deadline: planDeadline) else {
                    if recoverMenuFailure() { continue }
                    return
                }
                if activeMotion.segmentFinished(at: tick) {
                    if let next = activeMotion.nextSegment {
                        guard let regions = visualRegions(), let bounds = windowIndicatorRegionBounds(regions),
                            let small = windowIndicatorSmallGeometry(point: next.curve.start, bounds: bounds,
                            directions: (next.geometry.xDirection, next.geometry.yDirection), regions: regions),
                            place(small, layer: presentationLayer(), deadline: planDeadline) else {
                            if recoverMenuFailure() { continue }
                            return
                        }
                        activeMotion.advanceSegment(at: DispatchTime.now().uptimeNanoseconds); motion = activeMotion
                    } else {
                        motion = nil; motionMenuSurfaces = []
                        guard movePanel(to: geometry.displayPoint, deadline: planDeadline) else {
                            if recoverMenuFailure() { continue }
                            return
                        }
                        pendingPlanACK = false; pendingPlanDeadline = nil
                        emit(["ok": true, "shown": true])
                    }
                }
            }
            if !suspended {
                let layer = presentationLayer()
                if expectedLayer != layer || orderedElevated != usesMenuOverlay() || state() != .safe {
                    if !movePanel(to: geometry.displayPoint, deadline: planDeadline),
                       !recoverMenuFailure() && exitReason != .targetChanged && exitReason != .targetUnavailable { return }
                }
            }
            let sample = spring.sample(at: tick)
            view.pressScale = sample.scale
            view.opacity = windowIndicatorFadeProgress(elapsed: tick - fadeBegan)
            if !suspended { draw() }
            if !ready && view.opacity == 1 {
                guard !suspended, state() == .safe else { emit(["ok": true, "shown": false]); return }
                ready = true; emit(["ok": true, "shown": true])
            }
            if let snapshotDeadline = pendingSnapshotDeadline {
                if suspended || !windowIndicatorSameWindow(visualWindow, approvedWindow) || tick >= snapshotDeadline {
                    emit(["ok": true, "shown": false]); pendingSnapshotDeadline = nil
                } else if motion == nil && !pointer.pressed && sample.settled && view.opacity == 1 {
                    let status = state()
                    if status != .safe {
                        emit(["ok": true, "shown": false]); pendingSnapshotDeadline = nil
                        exitReason = status; suspend()
                        if status == .menuUnavailable { invalidateMenuPlan() }
                        else if status != .targetChanged && status != .targetUnavailable { return }
                    } else {
                        guard let stack = windowIndicatorStack(targetWindowId: attachment.windowId, ownedPanelId: UInt32(panel.windowNumber),
                                menuWindowIds: boundMenus().map(\.windowId)),
                              let receipt = windowIndicatorSnapshotProjection(stack, target: approvedWindow,
                                targetStartedAt: processStart(attachment.pid), panelId: UInt32(panel.windowNumber), panelPID: getpid(),
                                panelStartedAt: processStart(getpid()), panelBounds: surface, expectedLayer: expectedLayer,
                                menuSurface: request.menuSurface, point: geometry.displayPoint) else {
                            emit(["ok": true, "shown": false]); pendingSnapshotDeadline = nil
                            if request.menuSurface != nil { invalidateMenuPlan(); continue }
                            exitReason = .metadataInvalid; suspend(); return
                        }
                        draw(); emit(receipt, maximumBytes: 512); pendingSnapshotDeadline = nil
                    }
                }
            }
        }
        let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
        if count == 0 { exitReason = .inputEOF; return }
        if count > 0 { lastInputAt = DispatchTime.now().uptimeNanoseconds; pendingLines = try buffer.append(Data(bytes.prefix(count))) }
        else if errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { exitReason = .inputReadFailed; return }
        let animating = fadeOut != nil || motion != nil || !spring.sample(at: tick).settled || view.opacity < 1
        windowIndicatorPumpEvents(app, deadline: min(lastInputAt + idleTimeout,
            DispatchTime.now().uptimeNanoseconds + (animating ? windowIndicatorAnimationTick : 25_000_000)))
    }
}
