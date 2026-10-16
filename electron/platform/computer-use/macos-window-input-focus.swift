import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

// NSRunningApplication's changing properties persist until the next turn of
// the main run loop in a common mode (NSRunningApplication.h). The input worker
// reads JSON synchronously; the independent tap thread cannot refresh that
// main-thread cache. Default is a real common-mode member; commonModes itself
// is only a registration set and must not be passed to RunInMode.
final class WindowInputMainRunLoopService {
    private let isMainThread: () -> Bool
    private let now: () -> UInt64
    private let runTurn: (TimeInterval) -> Void
    private let sleepMicroseconds: (UInt32) -> Void
    private var servicing = false

    init(isMainThread: @escaping () -> Bool = { Thread.isMainThread },
         now: @escaping () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
         runTurn: @escaping (TimeInterval) -> Void = { _ = CFRunLoopRunInMode(.defaultMode, $0, true) },
         sleepMicroseconds: @escaping (UInt32) -> Void = { usleep($0) }) {
        self.isMainThread = isMainThread; self.now = now
        self.runTurn = runTurn; self.sleepMicroseconds = sleepMicroseconds
    }

    func service(until deadline: UInt64? = nil) {
        // Only the real main caller can touch the reentrancy flag. A tap or
        // other worker never pumps its own loop or synchronously hops to main.
        guard isMainThread(), !servicing else { return }
        let began = now()
        let remaining = deadline.map { $0 > began ? $0 - began : 0 } ?? 1_000_000
        let wait = min(remaining, 1_000_000)
        guard wait > 0 else { return }
        servicing = true
        defer { servicing = false }
        // This bounds run-loop waiting, not the execution time of a callback.
        // All callers remain outside locks and retain their outer deadlines.
        runTurn(Double(wait) / 1_000_000_000)
    }

    func pause(nanoseconds: UInt64, until deadline: UInt64? = nil) {
        if isMainThread(), servicing { return }
        let began = now()
        let remaining = deadline.map { $0 > began ? $0 - began : 0 } ?? 10_000_000
        let wait = min(nanoseconds, min(remaining, 10_000_000))
        let (end, overflow) = began.addingReportingOverflow(wait)
        guard wait > 0, !overflow else { return }
        service(until: end)
        let after = now()
        guard after >= began, after < end else { return }
        // A loop with no ready source can return immediately. Preserve the
        // remainder of the old polling pause rather than busy-spin, and never
        // round a sleep beyond the existing monotonic deadline.
        let microseconds = (end - after) / 1_000
        if microseconds > 0 { sleepMicroseconds(UInt32(microseconds)) }
    }
}

let windowInputMainRunLoopService = WindowInputMainRunLoopService()

enum WindowInputFocusPreparationStage: String {
    case architecture, receiverIdentity, privateSPI, systemFocus, auxiliary, persistentTaps, foregroundSnapshot, temporaryTaps, windowUpdates
}
func windowInputFocusPreparationFailure(_ stage: WindowInputFocusPreparationStage) -> HelperError {
    windowInputLogger.notice("focusPreparation=\(stage.rawValue, privacy: .public)")
    return windowInputError("unsupported_receiver")
}

// Recovered normal-application route from SkyComputerUseService (arm64,
// ac8bfe406d01a7cb43f7550c080587ae3a5f404f82fa6dcc399bf72a85cd765d).
// Private fields: source PID 41, target PID 40, process notification 64,
// AppKit subtype 83, focus token 71, focus-owner PID 73. Special ViewBridge /
// prohibited-process owner normalization is deliberately not synthesized.
enum WindowInputFocusState: String { case inactive, retained, released, unconfirmed }

// Diagnostic state contains fixed classifications and counters only. It never
// stores a PID, focus token, window metadata or application content, and does
// not participate in focus admission or cleanup decisions.
enum WindowInputFocusUnsafeReason: String {
    case tapThread, targetIdentity, protectedIdentity, focusOwnerScope, originalKeyboardIdentity
    case focusPolicy, releaseCall, keyboardPolicy, keyboardReceiverIdentity
    case reenableUpdates, temporaryTapRemoval, syntheticFrontUnrestored, deactivationIdentity
    case settleDeadline, tapJoin
}

struct WindowInputFocusDiagnostics {
    private(set) var firstUnsafe: WindowInputFocusUnsafeReason?
    private(set) var unsafeCount = 0
    var deniedTakenCount = 0
    var auxiliaryChangedCount = 0
    var releaseRequestCount = 0
    var normalRestoreRequests = 0
    var recoveryNeeded = false
    var recoveryAttempted = false

    mutating func recordUnsafe(_ reason: WindowInputFocusUnsafeReason) {
        if firstUnsafe == nil { firstUnsafe = reason }
        if unsafeCount < Int.max { unsafeCount += 1 }
    }
}

enum WindowInputFocusSettleReason: String {
    case confirmed, unsafe, frontUnavailable, focusUnavailable, focusMismatch, frontNonregular
}

func windowInputFocusSettleReason(unsafe: Bool, frontKnown: Bool, frontRegular: Bool,
                                 focusKnown: Bool, focusEqual: Bool) -> WindowInputFocusSettleReason {
    if unsafe { return .unsafe }
    if !frontKnown { return .frontUnavailable }
    if !focusKnown { return .focusUnavailable }
    if !focusEqual { return .focusMismatch }
    if !frontRegular { return .frontNonregular }
    return .confirmed
}

// One bounded diagnostic comparison after taps have stopped. The result is
// never used for cleanup or admission and no identity is written to the log.
func windowInputFocusDiagnosticAXFocusedPID() -> Int32? {
    let system = AXUIElementCreateSystemWide()
    guard AXUIElementSetMessagingTimeout(system, 0.05) == .success,
          let focused = windowInputAXElement(system, attribute: kAXFocusedApplicationAttribute) else { return nil }
    var pid: pid_t = 0
    guard AXUIElementGetPid(focused, &pid) == .success, pid > 0 else { return nil }
    return pid
}

enum WindowInputFocusDeactivationChoice: String {
    case noFocusPosts, actualActive, perceivedInactive, required, posted, targetChanged
}

struct WindowInputFocusSnapshot {
    let postedCount: Int
    let state: WindowInputFocusState
}

func windowInputFocusUnrestoredSyntheticFront(actualPID: Int32?, targetPID: Int32, humanTakeover: Bool) -> Bool {
    actualPID == targetPID && !humanTakeover
}

struct WindowInputFocusBelief {
    var perceivedActive: Bool
    var perceivedFocus: Bool
    var actualActive: Bool

    mutating func observe(_ event: WindowInputFocusEvent, suppressed: Bool = false) {
        guard !suppressed else { return }
        if event.type == 20 || event.type == 13 && Int16(exactly: event.subtype) == 1 {
            perceivedActive = true; perceivedFocus = true
        } else if event.type == 19 || event.type == 13 && Int16(exactly: event.subtype) == 2 {
            perceivedActive = false; perceivedFocus = false
        }
    }

    var nextActivation: (type: UInt, subtype: Int16)? {
        if perceivedFocus { return nil }
        return perceivedActive ? (21, -32768) : (13, 1)
    }

    mutating func activated() { perceivedActive = true; perceivedFocus = true }
    mutating func focusReturned() { perceivedFocus = true }
    var needsDeactivation: Bool { perceivedActive && !actualActive }
    mutating func deactivated() { perceivedActive = false; perceivedFocus = false }
}

func windowInputFocusReceipt(_ receipt: [String: Any], previousPostCount: Int,
                             snapshot: WindowInputFocusSnapshot) -> [String: Any] {
    var value = receipt
    value["focusPosted"] = snapshot.postedCount > previousPostCount
    value["focusState"] = snapshot.state.rawValue
    return value
}

let windowInputFocusKeyboardTypes: [UInt32] = [10, 11, 12]
let windowInputFocusApplicationTypes: [UInt32] = [13, 20, 19]
let windowInputFocusProcessTypes: [UInt32] = [21]
func windowInputFocusMask(_ types: [UInt32]) -> CGEventMask {
    types.reduce(0) { $0 | (CGEventMask(1) << $1) }
}

struct WindowInputFocusEvent {
    let type: UInt32
    let sourcePID: Int32
    let targetPID: Int32
    let notification: Int64
    let subtype: Int64
    let focusOwnerPID: Int32
    let focusToken: Int64

    init(type: UInt32, sourcePID: Int32 = 0, targetPID: Int32 = 0, notification: Int64 = 0,
         subtype: Int64 = 0, focusOwnerPID: Int32 = 0, focusToken: Int64 = 0) {
        self.type = type; self.sourcePID = sourcePID; self.targetPID = targetPID
        self.notification = notification; self.subtype = subtype
        self.focusOwnerPID = focusOwnerPID; self.focusToken = focusToken
    }

    init(_ event: CGEvent) {
        func field(_ number: UInt32) -> Int64 { event.getIntegerValueField(CGEventField(rawValue: number)!) }
        type = event.type.rawValue
        sourcePID = Int32(exactly: field(41)) ?? 0
        targetPID = Int32(exactly: field(40)) ?? 0
        notification = field(64); subtype = field(83)
        focusOwnerPID = Int32(exactly: field(73)) ?? 0; focusToken = field(71)
    }
}

struct WindowInputFocusDecision {
    var drop = false
    var repostPID: Int32?
    var releaseFocusID: UInt32?
    var unsafe = false
}

// Injectable state-only filters. No AX or application content is read from an
// event-tap callback, and only keyboard events may be routed to the captured
// foreground application. Pointer events never enter any rerouting mask.
func windowInputFocusTemporaryKeyboard(_ event: WindowInputFocusEvent, servicePID: Int32,
                                       targetPID: Int32, foregroundPID: Int32) -> WindowInputFocusDecision {
    guard windowInputFocusKeyboardTypes.contains(event.type), event.sourcePID != servicePID,
          event.targetPID == targetPID else { return WindowInputFocusDecision() }
    guard foregroundPID > 0, foregroundPID != targetPID else { return WindowInputFocusDecision(drop: true, unsafe: true) }
    return WindowInputFocusDecision(drop: true, repostPID: foregroundPID)
}

func windowInputFocusSuppressForeground(_ event: WindowInputFocusEvent) -> Bool {
    event.type == 20 || event.type == 19 || event.type == 13 && [1, 2, 22, 23].contains(event.subtype)
}

struct WindowInputFocusPending {
    let thiefPID: Int32
    let originalTargetPID: Int32
    var originalTargetStartedAt: Int64?
    var changed = false
    var returnedSuppressed = false
}

struct WindowInputFocusPreventerPolicy {
    let targetPID: Int32
    let servicePID: Int32
    let auxiliaryPID: Int32?
    var currentFocusPID: Int32
    var registered = true
    var pending: WindowInputFocusPending?
    var releaseFailed = false

    mutating func process(_ event: WindowInputFocusEvent) -> WindowInputFocusDecision {
        guard event.type == 21 else { return WindowInputFocusDecision() }
        switch event.notification {
        case 16384: // kCPSNotifyKeyFocusTaken
            guard registered, event.focusOwnerPID == targetPID, currentFocusPID != targetPID else {
                pending = nil; return WindowInputFocusDecision()
            }
            guard event.targetPID > 0 else { return WindowInputFocusDecision(drop: true, unsafe: true) }
            pending = WindowInputFocusPending(thiefPID: event.focusOwnerPID, originalTargetPID: event.targetPID)
            return WindowInputFocusDecision(drop: true)
        case 32768: // kCPSNotifyKeyFocusReturned
            guard var selected = pending, !selected.returnedSuppressed,
                  event.targetPID == selected.originalTargetPID else { return WindowInputFocusDecision() }
            selected.returnedSuppressed = true; pending = selected
            return WindowInputFocusDecision(drop: true)
        case 61698: // kCPSNotifyKeyFocusChanged: only the real auxiliary receiver
            guard let auxiliaryPID, event.targetPID == auxiliaryPID else { return WindowInputFocusDecision() }
            currentFocusPID = event.focusOwnerPID
            guard var selected = pending else { return WindowInputFocusDecision() }
            if event.focusOwnerPID == selected.thiefPID {
                guard !selected.changed else { return WindowInputFocusDecision() }
                selected.changed = true; pending = selected
                guard let token = UInt32(exactly: event.focusToken) else {
                    releaseFailed = true; return WindowInputFocusDecision(unsafe: true)
                }
                return WindowInputFocusDecision(releaseFocusID: token)
            }
            if event.focusOwnerPID != selected.originalTargetPID { pending = nil }
            return WindowInputFocusDecision()
        case 2: // kCPSNotifyNewFrontProcess, same auxiliary receiver gate
            guard let auxiliaryPID, event.targetPID == auxiliaryPID, let selected = pending,
                  event.focusOwnerPID == selected.thiefPID else { return WindowInputFocusDecision() }
            pending = nil
            return WindowInputFocusDecision()
        default: return WindowInputFocusDecision()
        }
    }

    func keyboard(_ event: WindowInputFocusEvent) -> WindowInputFocusDecision {
        guard windowInputFocusKeyboardTypes.contains(event.type), event.sourcePID != servicePID,
              let selected = pending, event.targetPID == selected.thiefPID else { return WindowInputFocusDecision() }
        guard selected.originalTargetPID > 0, selected.originalTargetPID != selected.thiefPID else {
            return WindowInputFocusDecision(drop: true, unsafe: true)
        }
        return WindowInputFocusDecision(drop: true, repostPID: selected.originalTargetPID)
    }
}

enum WindowInputFocusActivationRoute: String { case nilWindow, windowNotificationOnly }

struct WindowInputFocusActivationConfiguration {
    let windowID: UInt32
    var route: WindowInputFocusActivationRoute { windowID == 0 ? .nilWindow : .windowNotificationOnly }
}

func windowInputFocusActivationPoint(_ error: AXError, _ raw: CFTypeRef?) -> CGPoint? {
    guard error == .success, let raw, CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    let value = raw as! AXValue
    var point = CGPoint.zero
    guard AXValueGetType(value) == .cgPoint, AXValueGetValue(value, .cgPoint, &point),
          point.x.isFinite, point.y.isFinite else { return nil }
    return point
}

func windowInputFocusActivationConfiguration(window: WindowIdentity, activationPoint: CGPoint?,
    nativeIdentity: AXWindowNumberIdentity?, bindingMatches: Bool) -> WindowInputFocusActivationConfiguration {
    guard window.valid, bindingMatches, let activationPoint, activationPoint.x.isFinite, activationPoint.y.isFinite,
          nativeIdentity == AXWindowNumberIdentity(pid: window.pid, windowId: window.windowId) else {
        return WindowInputFocusActivationConfiguration(windowID: 0)
    }
    // The point gates Codex's window notification, but is never a destination
    // here. Its additional activation-point mouse pair can fall outside this
    // one-window grant and is deliberately not constructed or sent.
    return WindowInputFocusActivationConfiguration(windowID: window.windowId)
}

func prepareWindowInputFocusActivationConfiguration(_ window: WindowIdentity) throws -> WindowInputFocusActivationConfiguration {
    try revalidateWindow(window, requireUniqueAXWindow: false)
    let budget = ScanBudget(deadline: DispatchTime.now().uptimeNanoseconds + 150_000_000)
    var configuration = WindowInputFocusActivationConfiguration(windowID: 0)
    if let root = axWindow(window, budget: budget) {
        let (error, raw) = axAttribute(root, "AXActivationPoint", budget: budget)
        let point = windowInputFocusActivationPoint(error, raw)
        let identity = axWindowNumberIdentity(root, budget: budget)
        configuration = windowInputFocusActivationConfiguration(window: window, activationPoint: point,
            nativeIdentity: identity, bindingMatches: axWindowBindingMatches(root, expected: window, budget: budget))
    }
    // Optional AX reads may fall back to nil-window activation, but a changed
    // original process/window/geometry cannot inherit either notification.
    try revalidateWindow(window, requireUniqueAXWindow: false)
    return configuration
}

func windowInputFocusNotification(type: UInt, subtype: Int16, windowID: UInt32 = 0) throws -> CGEvent {
    guard windowID == 0 || type == 13 && subtype == 1 else { throw windowInputError("unsupported_receiver") }
    // Codex notifyAppActivated at 0x10072e1d4...0x10072e224 supplies the
    // nonzero window number and raw 0xc0000 flags to this one notification.
    let flags = NSEvent.ModifierFlags(rawValue: windowID == 0 ? 0 : 0xc0000)
    guard let nativeType = NSEvent.EventType(rawValue: type),
        let native = NSEvent.otherEvent(with: nativeType, location: .zero, modifierFlags: flags,
        timestamp: 0, windowNumber: Int(windowID), context: nil, subtype: subtype, data1: 0, data2: 0),
        let event = native.cgEvent?.copy() else { throw windowInputError("unsupported_receiver") }
    event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
    return event
}

struct WindowInputFocusTemporaryState {
    var lastEventAt: UInt64
    var sawEvent = false
    var targetSawInactive = false
    var foregroundSawActivation = false

    mutating func suppressTarget(_ event: WindowInputFocusEvent, now: UInt64) -> Bool {
        lastEventAt = now
        if event.type == 20 { sawEvent = true; return false }
        if event.type == 19 || event.type == 13 && Int16(exactly: event.subtype) == 2 {
            sawEvent = true; targetSawInactive = true; return true
        }
        return event.type == 13 && [22, 23].contains(event.subtype)
    }

    mutating func suppressForeground(_ event: WindowInputFocusEvent, now: UInt64) -> Bool {
        lastEventAt = now
        if event.type == 20 || event.type == 13 && Int16(exactly: event.subtype) == 1 {
            sawEvent = true; foregroundSawActivation = true; return true
        }
        if event.type == 19 || event.type == 13 && Int16(exactly: event.subtype) == 2 {
            sawEvent = true; return true
        }
        return event.type == 13 && [22, 23].contains(event.subtype)
    }
}

struct WindowInputFocusForegroundWindow {
    let pid: Int32
    let processStartedAt: Int64
    let windowID: UInt32
    let element: AXUIElement
}

// Content-free window metadata is sufficient for both the human-click owner
// check and the exact old-front ordering check. No AX work runs in a tap.
func windowInputFocusWindowOwner(_ windowID: UInt32) -> Int32? {
    guard windowID > 0,
          let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID) as? [[String: Any]],
          let window = windows.first(where: { ($0[kCGWindowNumber as String] as? UInt32) == windowID }) else { return nil }
    return window[kCGWindowOwnerPID as String] as? Int32
}

func windowInputFocusForegroundWindow(_ pid: Int32) throws -> WindowInputFocusForegroundWindow {
    guard let started = processStart(pid), NSRunningApplication(processIdentifier: pid)?.activationPolicy == .regular else {
        throw windowInputError("unsupported_receiver")
    }
    let application = AXUIElementCreateApplication(pid)
    guard AXUIElementSetMessagingTimeout(application, 0.15) == .success,
          let focused = windowInputAXElement(application, attribute: kAXFocusedWindowAttribute),
          AXUIElementSetMessagingTimeout(focused, 0.15) == .success,
          let identity = axWindowNumberIdentity(focused), identity.pid == pid,
          windowInputFocusWindowOwner(identity.windowId) == pid else { throw windowInputError("unsupported_receiver") }
    return WindowInputFocusForegroundWindow(pid: pid, processStartedAt: started, windowID: identity.windowId, element: focused)
}

func windowInputFocusNeedsOldFrontRestore(_ windows: [[String: Any]], targetPID: Int32,
                                          oldWindow: WindowInputFocusForegroundWindow) -> Bool {
    guard let index = windows.firstIndex(where: { ($0[kCGWindowNumber as String] as? UInt32) == oldWindow.windowID }),
          index > 0, windows[index][kCGWindowOwnerPID as String] as? Int32 == oldWindow.pid,
          let layer = windows[index][kCGWindowLayer as String] as? Int32 else { return false }
    return windows[..<index].contains { $0[kCGWindowOwnerPID as String] as? Int32 == targetPID
        && $0[kCGWindowLayer as String] as? Int32 == layer }
}

final class WindowInputFocusOwner {
    private let window: WindowIdentity
    private let servicePID = getpid()
    private let spi: WindowInputFocusSPI
    private let auxiliaryPID: Int32
    private let auxiliaryStartedAt: Int64
    private let lock = NSLock()
    private var belief: WindowInputFocusBelief
    private var policy: WindowInputFocusPreventerPolicy
    private var temporary: WindowInputFocusTemporaryState?
    private var postCount = 0
    private var unsafe = false
    private var diagnostics = WindowInputFocusDiagnostics()
    private var stopped = false
    private var cleanStop = false
    private var closing = false
    private var humanTakeover = false
    private var syntheticFrontUnrestored = false
    private var tapThread: WindowInputFocusTapThread?
    private var frontObserver: NSObjectProtocol?
    private let activation: CGEvent
    private let focusReturn: CGEvent
    private let deactivation: CGEvent

    init(window: WindowIdentity, foregroundPID: Int32) throws {
        windowInputMainRunLoopService.service()
        guard window.pid != foregroundPID, processStart(window.pid) == window.processStartedAt,
              NSRunningApplication(processIdentifier: window.pid)?.activationPolicy == .regular,
              NSRunningApplication(processIdentifier: foregroundPID)?.activationPolicy == .regular else {
            throw windowInputFocusPreparationFailure(.receiverIdentity)
        }
        #if !arch(arm64)
        throw windowInputFocusPreparationFailure(.architecture)
        #endif
        self.window = window
        do { spi = try WindowInputFocusSPI() }
        catch { throw windowInputFocusPreparationFailure(.privateSPI) }
        guard let focusPID = spi.keyFocusPID(), focusPID == foregroundPID else { throw windowInputFocusPreparationFailure(.systemFocus) }
        let auxiliary = NSWorkspace.shared.runningApplications.first {
            $0.executableURL?.lastPathComponent == "ViewBridgeAuxiliary"
        }?.processIdentifier
        // The observed state updater receives Changed only at this auxiliary
        // PID. An absent receiver has no evidenced refresh path; fail before
        // installing protection rather than retain a stale system identity.
        guard let auxiliary, let auxiliaryStarted = processStart(auxiliary) else { throw windowInputFocusPreparationFailure(.auxiliary) }
        auxiliaryPID = auxiliary; auxiliaryStartedAt = auxiliaryStarted
        belief = WindowInputFocusBelief(perceivedActive: false, perceivedFocus: focusPID == window.pid, actualActive: false)
        policy = WindowInputFocusPreventerPolicy(targetPID: window.pid, servicePID: getpid(), auxiliaryPID: auxiliary, currentFocusPID: focusPID)
        policy.registered = false
        // All focus notifications, including cleanup, exist before any post.
        let activationConfiguration = try prepareWindowInputFocusActivationConfiguration(window)
        activation = try windowInputFocusNotification(type: 13, subtype: 1, windowID: activationConfiguration.windowID)
        focusReturn = try windowInputFocusNotification(type: 21, subtype: -32768)
        deactivation = try windowInputFocusNotification(type: 13, subtype: 2)
        windowInputLogger.notice("activationRoute=\(activationConfiguration.route.rawValue, privacy: .public)")
        var preparationStage = WindowInputFocusPreparationStage.persistentTaps
        do {
            let runtime = try WindowInputFocusTapThread(spi: spi, onUnsafe: { [weak self] in self?.markUnsafe(.tapThread) })
            tapThread = runtime
            _ = try runtime.add(WindowInputFocusTapSpec(pid: window.pid, placement: .tailAppendEventTap,
                options: .defaultTap, types: windowInputFocusApplicationTypes, handler: { [weak self] _, event in
                    guard let self else { return event }; return self.observeTarget(event)
                }))
            _ = try runtime.add(WindowInputFocusTapSpec(pid: nil, placement: .tailAppendEventTap,
                options: .defaultTap, types: windowInputFocusProcessTypes, handler: { [weak self] _, event in
                    guard let self else { return event }; return self.observeProcess(event)
                }))
            for pid in [window.pid, auxiliary].compactMap({ $0 }) {
                _ = try runtime.add(WindowInputFocusTapSpec(pid: pid, placement: .tailAppendEventTap,
                    options: .defaultTap, types: windowInputFocusKeyboardTypes, handler: { [weak self] _, event in
                        guard let self else { return event }; return self.preserveKeyboard(event)
                    }))
            }
            _ = try runtime.add(WindowInputFocusTapSpec(pid: nil, placement: .headInsertEventTap,
                options: .listenOnly, types: [1], handler: { [weak self] _, event in
                    self?.observeHumanClick(event); return event
                }))
            frontObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification,
                object: nil, queue: nil) { [weak self] notification in
                    guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
                    self?.observeRealFront(app.processIdentifier)
                }
            preparationStage = .systemFocus
            guard runtime.isHealthy, NSWorkspace.shared.frontmostApplication?.processIdentifier == foregroundPID,
                  spi.keyFocusPID() == foregroundPID, processStart(window.pid) == window.processStartedAt else {
                throw windowInputError("target_changed")
            }
        } catch {
            windowInputLogger.notice("focusPreparation=\(preparationStage.rawValue, privacy: .public)")
            if let observer = frontObserver { NSWorkspace.shared.notificationCenter.removeObserver(observer); frontObserver = nil }
            if tapThread?.stop(timeout: 0.75) == false { throw WindowInputFocusTapError.cleanupUnconfirmed }
            throw error
        }
    }

    deinit {
        if let observer = frontObserver { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        // The session explicitly owns bounded shutdown; deinit never joins.
    }

    private func recordUnsafeLocked(_ reason: WindowInputFocusUnsafeReason) {
        unsafe = true; diagnostics.recordUnsafe(reason)
    }
    private func markUnsafe(_ reason: WindowInputFocusUnsafeReason) { lock.lock(); recordUnsafeLocked(reason); lock.unlock() }
    private func observeRealFront(_ pid: Int32) {
        lock.lock(); belief.actualActive = pid == window.pid; lock.unlock()
    }
    private func observeTarget(_ event: CGEvent) -> CGEvent? {
        guard processStart(window.pid) == window.processStartedAt else { markUnsafe(.targetIdentity); return event }
        let value = WindowInputFocusEvent(event)
        lock.lock()
        let suppress = temporary != nil && temporary!.suppressTarget(value, now: DispatchTime.now().uptimeNanoseconds)
        belief.observe(value, suppressed: suppress)
        lock.unlock()
        return suppress ? nil : event
    }
    private func ordinaryIdentity(_ pid: Int32) -> Bool {
        pid > 0 && NSRunningApplication(processIdentifier: pid)?.activationPolicy == .regular
    }
    private func observeProcess(_ event: CGEvent) -> CGEvent? {
        guard processStart(auxiliaryPID) == auxiliaryStartedAt,
              processStart(window.pid) == window.processStartedAt else { markUnsafe(.protectedIdentity); return event }
        let value = WindowInputFocusEvent(event)
        let originalStarted = value.notification == 16384 ? processStart(value.targetPID) : nil
        let originalOrdinary = value.notification == 16384 && ordinaryIdentity(value.targetPID)
        lock.lock(); let auxiliary = policy.auxiliaryPID; lock.unlock()
        if (value.notification == 16384 || value.notification == 61698 && value.targetPID == auxiliary),
           !ordinaryIdentity(value.focusOwnerPID) { markUnsafe(.focusOwnerScope); return event }
        lock.lock()
        let oldFocus = policy.currentFocusPID
        let decision = policy.process(value)
        if value.notification == 16384, decision.drop { diagnostics.deniedTakenCount += 1 }
        if value.notification == 61698, value.targetPID == auxiliary { diagnostics.auxiliaryChangedCount += 1 }
        if decision.releaseFocusID != nil { diagnostics.releaseRequestCount += 1 }
        if value.notification == 16384, decision.drop, policy.pending != nil {
            policy.pending?.originalTargetStartedAt = originalStarted
            if originalStarted == nil || !originalOrdinary { recordUnsafeLocked(.originalKeyboardIdentity) }
        }
        if oldFocus != policy.currentFocusPID {
            if oldFocus == window.pid { belief.perceivedFocus = false }
            if policy.currentFocusPID == window.pid { belief.perceivedFocus = true }
        }
        if decision.unsafe { recordUnsafeLocked(.focusPolicy) }
        lock.unlock()
        if let token = decision.releaseFocusID, !spi.releaseFocus(token) { markUnsafe(.releaseCall) }
        return decision.drop ? nil : event
    }
    private func preserveKeyboard(_ event: CGEvent) -> CGEvent? {
        guard processStart(auxiliaryPID) == auxiliaryStartedAt,
              processStart(window.pid) == window.processStartedAt else { markUnsafe(.protectedIdentity); return event }
        let value = WindowInputFocusEvent(event)
        lock.lock(); let decision = policy.keyboard(value); let expectedStart = policy.pending?.originalTargetStartedAt
        if decision.unsafe { recordUnsafeLocked(.keyboardPolicy) }; lock.unlock()
        if let pid = decision.repostPID {
            guard let expectedStart, processStart(pid) == expectedStart, ordinaryIdentity(pid) else { markUnsafe(.keyboardReceiverIdentity); return nil }
            event.postToPid(pid)
        }
        return decision.drop ? nil : event
    }
    private func observeHumanClick(_ event: CGEvent) {
        let value = WindowInputFocusEvent(event)
        // Notification delivery can lag while the command worker is sleeping.
        // Sample actual activation synchronously for every decision that could
        // repair a human click; the observer is only an additional hint.
        guard let actualPID = NSWorkspace.shared.frontmostApplication?.processIdentifier else { return }
        lock.lock(); belief.actualActive = actualPID == window.pid
        let eligible = belief.perceivedActive && !belief.actualActive && !closing && !stopped; lock.unlock()
        guard eligible, value.sourcePID != servicePID, value.targetPID != window.pid,
              let id = UInt32(exactly: event.getIntegerValueField(CGEventField(rawValue: 51)!)),
              windowInputFocusWindowOwner(id) == window.pid, processStart(window.pid) == window.processStartedAt,
              let application = NSRunningApplication(processIdentifier: window.pid), !application.isTerminated else { return }
        // This is Codex's exact repair for a human clicking an app whose
        // synthetic perceived activation would otherwise absorb that click.
        // It is never a fallback for an Agent event or failed input action.
        lock.lock(); if temporary != nil { humanTakeover = true }; lock.unlock()
        _ = application.activate(options: [])
    }

    var hasPerceivedFocus: Bool {
        lock.lock(); defer { lock.unlock() }
        return !unsafe && !stopped && !closing && belief.perceivedFocus && tapThread?.isHealthy == true
    }
    var snapshot: WindowInputFocusSnapshot {
        lock.lock(); defer { lock.unlock() }
        let state: WindowInputFocusState
        if unsafe { state = .unconfirmed }
        else if stopped { state = cleanStop && postCount > 0 ? .released : postCount == 0 ? .inactive : .unconfirmed }
        else { state = postCount > 0 ? .retained : .inactive }
        return WindowInputFocusSnapshot(postedCount: postCount, state: state)
    }
    func requireHealthy() throws {
        lock.lock(); let allowed = !unsafe && !stopped && !closing; lock.unlock()
        guard allowed, tapThread?.isHealthy == true else { throw windowInputError("unsupported_receiver") }
        guard processStart(auxiliaryPID) == auxiliaryStartedAt,
              processStart(window.pid) == window.processStartedAt else { markUnsafe(.protectedIdentity); throw windowInputError("unsupported_receiver") }
    }

    func enforce(foregroundPID: Int32, lifetimeGuard: () throws -> Void) throws {
        windowInputMainRunLoopService.service()
        try requireHealthy(); try lifetimeGuard()
        guard processStart(window.pid) == window.processStartedAt,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == foregroundPID,
              foregroundPID != window.pid else { throw windowInputError("target_changed") }
        lock.lock(); let alreadyFocused = belief.perceivedFocus; lock.unlock()
        if alreadyFocused { return }
        let oldWindow: WindowInputFocusForegroundWindow
        do { oldWindow = try windowInputFocusForegroundWindow(foregroundPID) }
        catch { throw windowInputFocusPreparationFailure(.foregroundSnapshot) }
        guard let runtime = tapThread, runtime.isHealthy else { throw windowInputError("unsupported_receiver") }
        let oldTap: UUID
        do { oldTap = try runtime.add(WindowInputFocusTapSpec(pid: foregroundPID, placement: .headInsertEventTap,
            options: .defaultTap, types: windowInputFocusApplicationTypes, handler: { [weak self] _, event in
                let value = WindowInputFocusEvent(event)
                guard let self else { return event }
                self.lock.lock()
                let suppress = self.temporary?.suppressForeground(value, now: DispatchTime.now().uptimeNanoseconds) ?? false
                self.lock.unlock()
                return suppress ? nil : event
            })) } catch { throw windowInputFocusPreparationFailure(.temporaryTaps) }
        var keyboardTap: UUID?
        var disabled = false
        var postedThisEnforcement = false
        let connection = spi.mainConnection()
        defer {
            if disabled && postedThisEnforcement { recoverOriginalFrontBeforeReenabling(oldWindow) }
            // Restore display updates before any wait/join, including cancellation.
            if disabled && !spi.reenableUpdates(connection: connection) { markUnsafe(.reenableUpdates) }
            lock.lock(); temporary = nil; lock.unlock()
            do {
                try runtime.perform(timeout: 0.25) {
                    if let keyboardTap { try runtime.remove(keyboardTap) }
                    try runtime.remove(oldTap)
                }
            } catch { markUnsafe(.temporaryTapRemoval) }
        }
        do { keyboardTap = try runtime.add(WindowInputFocusTapSpec(pid: window.pid, placement: .headInsertEventTap,
            options: .defaultTap, types: windowInputFocusKeyboardTypes, handler: { [weak self] _, event in
                guard let self else { return event }
                let decision = windowInputFocusTemporaryKeyboard(WindowInputFocusEvent(event), servicePID: self.servicePID,
                    targetPID: self.window.pid, foregroundPID: foregroundPID)
                if decision.unsafe { self.markUnsafe(.keyboardPolicy) }
                if let pid = decision.repostPID {
                    guard processStart(pid) == oldWindow.processStartedAt, self.ordinaryIdentity(pid) else { self.markUnsafe(.keyboardReceiverIdentity); return nil }
                    event.postToPid(pid)
                }
                return decision.drop ? nil : event
            })) } catch { throw windowInputFocusPreparationFailure(.temporaryTaps) }
        windowInputMainRunLoopService.service()
        try lifetimeGuard(); try requireHealthy()
        guard connection != nil, processStart(foregroundPID) == oldWindow.processStartedAt,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == foregroundPID,
              !windowInputPhysicalInputActive() else { throw windowInputError("target_changed") }
        lock.lock(); humanTakeover = false; temporary = WindowInputFocusTemporaryState(lastEventAt: DispatchTime.now().uptimeNanoseconds); lock.unlock()
        guard spi.disableUpdates(connection: connection) else { throw windowInputFocusPreparationFailure(.windowUpdates) }
        disabled = true
        // Recheck the frozen WindowServer identity immediately before posting.
        // AX binding was proved before updates were disabled; do not block
        // display updates on another round of application AX messaging.
        try revalidateWindow(window, requireUniqueAXWindow: false)
        windowInputMainRunLoopService.service()
        try lifetimeGuard(); try requireHealthy()
        guard processStart(window.pid) == window.processStartedAt,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == foregroundPID else { throw windowInputError("target_changed") }
        lock.lock(); let next = belief.nextActivation; lock.unlock()
        if let next {
            let event = next.type == 13 ? activation : focusReturn
            event.timestamp = DispatchTime.now().uptimeNanoseconds
            event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(window.pid))
            // Commit accounting precedes the void system call: cancellation or
            // failure after this point cannot pretend focus was never posted.
            lock.lock(); postCount += 1; policy.registered = true
            if next.type == 13 { belief.activated() } else { belief.focusReturned() }
            lock.unlock()
            postedThisEnforcement = true
            event.postToPid(window.pid)
        }
        // The recovered safe wrapper bounds its settling period at two seconds.
        // Exact ordering/settling policy below is shared with its state-only tests.
        try waitForSafeActivation(oldWindow: oldWindow, lifetimeGuard: lifetimeGuard)
    }

    private func oldFrontWindowStillMatches(_ oldWindow: WindowInputFocusForegroundWindow) -> Bool {
        guard processStart(oldWindow.pid) == oldWindow.processStartedAt else { return false }
        let application = AXUIElementCreateApplication(oldWindow.pid)
        _ = AXUIElementSetMessagingTimeout(application, 0.15)
        guard let current = windowInputAXElement(application, attribute: kAXFocusedWindowAttribute),
              CFEqual(current, oldWindow.element), axWindowNumberIdentity(current)?.windowId == oldWindow.windowID else { return false }
        return true
    }

    private func recoverOriginalFrontBeforeReenabling(_ oldWindow: WindowInputFocusForegroundWindow) {
        windowInputMainRunLoopService.service()
        lock.lock(); let takenOver = humanTakeover; lock.unlock()
        guard windowInputFocusUnrestoredSyntheticFront(actualPID: NSWorkspace.shared.frontmostApplication?.processIdentifier,
            targetPID: window.pid, humanTakeover: takenOver) else { return }
        lock.lock(); diagnostics.recoveryNeeded = true; lock.unlock()
        // Cancellation can occur between synthetic activation and its normal
        // restoration. Keep updates suspended while making one bounded repair
        // of that captured context; no pointer/key event is replayed here.
        if oldFrontWindowStillMatches(oldWindow), windowInputFocusWindowOwner(oldWindow.windowID) == oldWindow.pid,
           let oldApp = NSRunningApplication(processIdentifier: oldWindow.pid) {
            // The AX read above can outlast a human switch. Refresh after it,
            // then recheck both actual foreground and evidenced takeover.
            windowInputMainRunLoopService.service()
            lock.lock(); let freshTakeover = humanTakeover; lock.unlock()
            if windowInputFocusUnrestoredSyntheticFront(actualPID: NSWorkspace.shared.frontmostApplication?.processIdentifier,
                targetPID: window.pid, humanTakeover: freshTakeover),
               processStart(oldWindow.pid) == oldWindow.processStartedAt,
               processStart(window.pid) == window.processStartedAt {
                lock.lock(); diagnostics.recoveryAttempted = true; lock.unlock()
                if oldApp.activate(options: []) {
                    let deadline = DispatchTime.now().uptimeNanoseconds + 100_000_000
                    while DispatchTime.now().uptimeNanoseconds < deadline {
                        windowInputMainRunLoopService.service(until: deadline)
                        guard DispatchTime.now().uptimeNanoseconds < deadline else { break }
                        let current = NSWorkspace.shared.frontmostApplication?.processIdentifier
                        if current != window.pid { break }
                        windowInputMainRunLoopService.pause(nanoseconds: 5_000_000, until: deadline)
                    }
                }
            }
        }
        windowInputMainRunLoopService.service()
        lock.lock(); let human = humanTakeover; lock.unlock()
        if windowInputFocusUnrestoredSyntheticFront(actualPID: NSWorkspace.shared.frontmostApplication?.processIdentifier,
            targetPID: window.pid, humanTakeover: human) {
            lock.lock(); syntheticFrontUnrestored = true; recordUnsafeLocked(.syntheticFrontUnrestored); lock.unlock()
        }
    }

    private func waitForSafeActivation(oldWindow: WindowInputFocusForegroundWindow, lifetimeGuard: () throws -> Void) throws {
        let began = DispatchTime.now().uptimeNanoseconds
        let deadline = began + 2_000_000_000
        var lastRestoreRequest: UInt64?
        while true {
            windowInputMainRunLoopService.service(until: deadline)
            try lifetimeGuard(); try requireHealthy()
            let now = DispatchTime.now().uptimeNanoseconds
            guard now >= began, now - began < 2_000_000_000,
                  processStart(oldWindow.pid) == oldWindow.processStartedAt,
                  processStart(window.pid) == window.processStartedAt else { throw windowInputError("target_changed") }
            lock.lock(); let takenOver = humanTakeover; lock.unlock()
            guard !takenOver else { throw windowInputError("user_input_active") }
            let realFront = NSWorkspace.shared.frontmostApplication?.processIdentifier
            if realFront == window.pid {
                if lastRestoreRequest == nil || now - lastRestoreRequest! >= 50_000_000 {
                    guard oldFrontWindowStillMatches(oldWindow),
                          let oldApp = NSRunningApplication(processIdentifier: oldWindow.pid), !oldApp.isTerminated else { throw windowInputError("target_changed") }
                    windowInputMainRunLoopService.service(until: deadline)
                    try lifetimeGuard(); try requireHealthy()
                    let restoreNow = DispatchTime.now().uptimeNanoseconds
                    guard restoreNow >= began, restoreNow < deadline,
                          processStart(oldWindow.pid) == oldWindow.processStartedAt,
                          processStart(window.pid) == window.processStartedAt else { throw windowInputError("target_changed") }
                    lock.lock(); let freshTakeover = humanTakeover; lock.unlock()
                    guard !freshTakeover else { throw windowInputError("user_input_active") }
                    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == window.pid else { throw windowInputError("target_changed") }
                    lock.lock()
                    temporary?.foregroundSawActivation = false; temporary?.targetSawInactive = false; temporary?.lastEventAt = restoreNow
                    diagnostics.normalRestoreRequests += 1
                    lock.unlock()
                    // Only this bounded, immediately post-enforce restoration
                    // may activate the captured original app. Idle state never
                    // pulls focus back and another app/user takeover cancels.
                    guard oldApp.activate(options: []) else { throw windowInputError("target_changed") }
                    lastRestoreRequest = restoreNow
                }
                windowInputMainRunLoopService.pause(nanoseconds: 10_000_000, until: deadline); continue
            }
            guard realFront == oldWindow.pid else { throw windowInputError("target_changed") }
            guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
                throw windowInputError("target_changed")
            }
            if windowInputFocusNeedsOldFrontRestore(windows, targetPID: window.pid, oldWindow: oldWindow) {
                guard oldFrontWindowStillMatches(oldWindow) else { throw windowInputError("target_changed") }
                windowInputMainRunLoopService.service(until: deadline)
                try lifetimeGuard(); try requireHealthy()
                let restoreNow = DispatchTime.now().uptimeNanoseconds
                guard restoreNow >= began, restoreNow < deadline,
                      processStart(oldWindow.pid) == oldWindow.processStartedAt,
                      processStart(window.pid) == window.processStartedAt else { throw windowInputError("target_changed") }
                lock.lock(); let freshTakeover = humanTakeover; lock.unlock()
                guard !freshTakeover else { throw windowInputError("user_input_active") }
                guard NSWorkspace.shared.frontmostApplication?.processIdentifier == oldWindow.pid,
                      AXUIElementPerformAction(oldWindow.element, kAXRaiseAction as CFString) == .success else { throw windowInputError("target_changed") }
                lock.lock(); temporary?.lastEventAt = restoreNow; lock.unlock()
                if restoreNow - began < 1_000_000_000 { windowInputMainRunLoopService.pause(nanoseconds: 10_000_000, until: deadline); continue }
            }
            lock.lock(); let current = temporary; lock.unlock()
            guard let current else { throw windowInputError("unsupported_receiver") }
            if lastRestoreRequest != nil && (!current.foregroundSawActivation || !current.targetSawInactive) {
                windowInputMainRunLoopService.pause(nanoseconds: 10_000_000, until: deadline); continue
            }
            if lastRestoreRequest == nil && !current.sawEvent { return }
            if now >= current.lastEventAt && now - current.lastEventAt >= 100_000_000 { return }
            windowInputMainRunLoopService.pause(nanoseconds: 10_000_000, until: deadline)
        }
    }

    @discardableResult func shutdown() -> WindowInputFocusSnapshot {
        windowInputMainRunLoopService.service()
        let realFront = NSWorkspace.shared.frontmostApplication?.processIdentifier
        lock.lock()
        if stopped { lock.unlock(); return snapshot }
        let unsafeBeforeCleanup = self.unsafe
        closing = true
        belief.actualActive = realFront == window.pid
        if syntheticFrontUnrestored && !humanTakeover { recordUnsafeLocked(.syntheticFrontUnrestored) }
        let needsDeactivation = postCount > 0 && belief.needsDeactivation
        var deactivationChoice: WindowInputFocusDeactivationChoice = postCount == 0 ? .noFocusPosts
            : belief.actualActive ? .actualActive : belief.perceivedActive ? .required : .perceivedInactive
        lock.unlock()
        if let observer = frontObserver { NSWorkspace.shared.notificationCenter.removeObserver(observer); frontObserver = nil }
        if needsDeactivation {
            if processStart(window.pid) == window.processStartedAt {
                deactivation.timestamp = DispatchTime.now().uptimeNanoseconds
                deactivation.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(window.pid))
                lock.lock(); postCount += 1; belief.deactivated(); lock.unlock()
                deactivation.postToPid(window.pid)
                deactivationChoice = .posted
            } else { deactivationChoice = .targetChanged; markUnsafe(.deactivationIdentity) }
        }
        // Leave the preventer serviced while any queued Changed/Returned work
        // drains. A posted deactivation and a dead helper alone do not confirm
        // the real user's keyboard focus was preserved.
        let settleDeadline = DispatchTime.now().uptimeNanoseconds + 200_000_000
        var focusReleased = false
        var lastRealFront: Int32?
        var lastCurrentFocus: Int32?
        var lastFrontRegular: Bool?
        var settleSamples = 0
        while DispatchTime.now().uptimeNanoseconds < settleDeadline {
            windowInputMainRunLoopService.service(until: settleDeadline)
            guard DispatchTime.now().uptimeNanoseconds < settleDeadline else { break }
            let realFront = NSWorkspace.shared.frontmostApplication?.processIdentifier
            let currentFocus = spi.keyFocusPID()
            lastRealFront = realFront; lastCurrentFocus = currentFocus; lastFrontRegular = nil; settleSamples += 1
            if let realFront, currentFocus == realFront {
                let regular = ordinaryIdentity(realFront); lastFrontRegular = regular
                if regular {
                    lock.lock(); let healthy = !unsafe; lock.unlock()
                    if healthy { focusReleased = true; break }
                }
            }
            windowInputMainRunLoopService.pause(nanoseconds: 5_000_000, until: settleDeadline)
        }
        // Classify the same sampled identities without recording them. This
        // diagnostic read never changes the existing cleanup guard or timeout.
        let frontKnown = lastRealFront != nil
        let frontRegular = lastFrontRegular ?? (lastRealFront.map { ordinaryIdentity($0) } ?? false)
        let focusKnown = lastCurrentFocus != nil
        let focusEqual = frontKnown && lastCurrentFocus == lastRealFront
        lock.lock(); let unsafeAtSettle = self.unsafe; lock.unlock()
        let settleReason = windowInputFocusSettleReason(unsafe: unsafeAtSettle,
            frontKnown: frontKnown, frontRegular: frontRegular, focusKnown: focusKnown, focusEqual: focusEqual)
        if !focusReleased { markUnsafe(.settleDeadline) }
        lock.lock(); policy.registered = false; policy.pending = nil; temporary = nil; lock.unlock()
        let joined = tapThread?.stop(timeout: 0.75) ?? true
        lock.lock(); stopped = true; cleanStop = joined; if !joined { recordUnsafeLocked(.tapJoin) }
        let detail = diagnostics; let unrestored = syntheticFrontUnrestored; let takeover = humanTakeover
        lock.unlock()
        let diagnosticAXFocus = windowInputFocusDiagnosticAXFocusedPID()
        let axKnown = diagnosticAXFocus != nil
        let fixedDetail = "firstUnsafe=\(detail.firstUnsafe?.rawValue ?? "none") unsafeCount=\(detail.unsafeCount) unsafeBeforeCleanup=\(unsafeBeforeCleanup) deactivation=\(deactivationChoice.rawValue) settle=\(settleReason.rawValue) settleReleased=\(focusReleased) settleSamples=\(settleSamples) frontKnown=\(frontKnown) frontRegular=\(frontRegular) frontIsTarget=\(lastRealFront == window.pid) focusKnown=\(focusKnown) focusEqual=\(focusEqual) focusIsTarget=\(lastCurrentFocus == window.pid) tapJoined=\(joined) normalRestoreRequests=\(detail.normalRestoreRequests) recoveryNeeded=\(detail.recoveryNeeded) recoveryAttempted=\(detail.recoveryAttempted) unrestored=\(unrestored) humanTakeover=\(takeover) deniedTaken=\(detail.deniedTakenCount) auxiliaryChanged=\(detail.auxiliaryChangedCount) releaseRequests=\(detail.releaseRequestCount) axKnown=\(axKnown) axMatchesSampledFront=\(axKnown && diagnosticAXFocus == lastRealFront) axMatchesSampledFocus=\(axKnown && diagnosticAXFocus == lastCurrentFocus) axIsTarget=\(diagnosticAXFocus == window.pid)"
        windowInputLogger.notice("focusCleanupDetails=\(fixedDetail, privacy: .public)")
        return snapshot
    }
}

// There is one lazy native focus owner for this immutable input session. Its
// lifetime survives mouse actions; menu and indicator sessions never own it.
final class WindowInputFocusSession {
    let window: WindowIdentity
    private var owner: WindowInputFocusOwner?
    private var initializationUnconfirmed = false
    init(window: WindowIdentity) { self.window = window }
    var snapshot: WindowInputFocusSnapshot { owner?.snapshot ?? WindowInputFocusSnapshot(postedCount: 0, state: initializationUnconfirmed ? .unconfirmed : .inactive) }
    var hasPerceivedFocus: Bool { owner?.hasPerceivedFocus == true }
    func requireHealthy() throws {
        guard !initializationUnconfirmed else { throw windowInputError("unsupported_receiver") }; try owner?.requireHealthy()
    }
    func enforce(foregroundPID: Int32, lifetimeGuard: () throws -> Void) throws {
        try requireHealthy()
        do {
            if owner == nil { owner = try WindowInputFocusOwner(window: window, foregroundPID: foregroundPID) }
            try owner!.enforce(foregroundPID: foregroundPID, lifetimeGuard: lifetimeGuard)
        } catch WindowInputFocusTapError.cleanupUnconfirmed {
            initializationUnconfirmed = true; throw windowInputError("unsupported_receiver")
        } catch is WindowInputFocusTapError { throw windowInputError("unsupported_receiver") }
    }
    func shutdown() -> WindowInputFocusSnapshot { owner?.shutdown() ?? snapshot }
}
