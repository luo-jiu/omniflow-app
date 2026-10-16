import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

// These private ABIs are evidenced for the inspected Codex arm64 service. The
// original connection pointer is preserved; no PID/PSN/window conversion or
// similarly named SLPS substitution is permitted.
private typealias WindowInputFocusMainConnection = @convention(c) () -> OpaquePointer?
private typealias WindowInputFocusUpdate = @convention(c) (OpaquePointer?) -> Int32
private typealias WindowInputFocusRelease = @convention(c) (UInt32) -> Int32
private typealias WindowInputFocusGet = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>, UnsafeMutablePointer<DarwinBoolean>) -> Int32
private typealias WindowInputFocusGetPID = @convention(c) (UnsafePointer<ProcessSerialNumber>, UnsafeMutablePointer<Int32>) -> Int32
private typealias WindowInputFocusCreatePIDTap = @convention(c) (Int32, CGEventTapPlacement, CGEventTapOptions, CGEventMask, CGEventTapCallBack, UnsafeMutableRawPointer?) -> Unmanaged<CFMachPort>?

enum WindowInputFocusTapError: Error { case unavailable, invalidRequest, stopped, timeout, cleanupUnconfirmed }

final class WindowInputFocusSPI {
    private let handles: [UnsafeMutableRawPointer]
    private let connectionFunction: WindowInputFocusMainConnection
    private let disableFunction: WindowInputFocusUpdate
    private let reenableFunction: WindowInputFocusUpdate
    private let focusFunction: WindowInputFocusGet
    private let pidFunction: WindowInputFocusGetPID
    private let releaseFunction: WindowInputFocusRelease
    private let createPIDFunction: WindowInputFocusCreatePIDTap

    init() throws {
        let paths = [
            "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
            "/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices",
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
        ]
        var opened: [UnsafeMutableRawPointer] = []
        for path in paths {
            guard let handle = dlopen(path, RTLD_LAZY | RTLD_LOCAL) else {
                for previous in opened { dlclose(previous) }
                throw WindowInputFocusTapError.unavailable
            }
            opened.append(handle)
        }
        func symbol(_ name: String, image: Int) throws -> UnsafeMutableRawPointer {
            guard let value = dlsym(opened[image], name) else { throw WindowInputFocusTapError.unavailable }
            return value
        }
        do {
            connectionFunction = unsafeBitCast(try symbol("CGSMainConnectionID", image: 0), to: WindowInputFocusMainConnection.self)
            disableFunction = unsafeBitCast(try symbol("SLSDisableUpdate", image: 0), to: WindowInputFocusUpdate.self)
            reenableFunction = unsafeBitCast(try symbol("SLSReenableUpdate", image: 0), to: WindowInputFocusUpdate.self)
            focusFunction = unsafeBitCast(try symbol("CPSGetKeyFocusProcess", image: 1), to: WindowInputFocusGet.self)
            pidFunction = unsafeBitCast(try symbol("GetProcessPID", image: 1), to: WindowInputFocusGetPID.self)
            releaseFunction = unsafeBitCast(try symbol("CPSReleaseKeyFocusWithID", image: 1), to: WindowInputFocusRelease.self)
            createPIDFunction = unsafeBitCast(try symbol("CGEventTapCreateForPid", image: 2), to: WindowInputFocusCreatePIDTap.self)
            handles = opened
        } catch {
            for handle in opened { dlclose(handle) }
            throw error
        }
    }

    deinit { for handle in handles { dlclose(handle) } }
    func mainConnection() -> OpaquePointer? { connectionFunction() }
    func disableUpdates(connection: OpaquePointer?) -> Bool { disableFunction(connection) == 0 }
    func reenableUpdates(connection: OpaquePointer?) -> Bool { reenableFunction(connection) == 0 }
    func releaseFocus(_ id: UInt32) -> Bool { releaseFunction(id) == 0 }
    func keyFocusPID() -> Int32? {
        var process = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0)
        var flag = DarwinBoolean(false)
        var pid: pid_t = 0
        guard focusFunction(&process, &flag) == 0, pidFunction(&process, &pid) == 0, pid > 0 else { return nil }
        return pid
    }
    fileprivate func createPIDTap(_ pid: Int32, placement: CGEventTapPlacement, options: CGEventTapOptions,
                                  mask: CGEventMask, callback: CGEventTapCallBack, info: UnsafeMutableRawPointer) -> CFMachPort? {
        createPIDFunction(pid, placement, options, mask, callback, info)?.takeRetainedValue()
    }
}

struct WindowInputFocusTapSpec {
    // nil means the evidenced global annotated-session location, not HID.
    let pid: Int32?
    let placement: CGEventTapPlacement
    let options: CGEventTapOptions
    let types: [UInt32]
    let handler: (CGEventType, CGEvent) -> CGEvent?
}

// Injectable only for no-GUI lifecycle tests. Production always constructs this
// backend from the dynamically resolved PID tap and the public global tap API.
struct WindowInputFocusTapBackend {
    let create: (WindowInputFocusTapSpec, CGEventTapCallBack, UnsafeMutableRawPointer) -> CFMachPort?
    let enable: (CFMachPort, Bool) -> Void
    let enabled: (CFMachPort) -> Bool

    init(spi: WindowInputFocusSPI) {
        create = { spec, callback, info in
            let mask = spec.types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1) }
            if let pid = spec.pid { return spi.createPIDTap(pid, placement: spec.placement, options: spec.options, mask: mask, callback: callback, info: info) }
            return CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap, place: spec.placement,
                options: spec.options, eventsOfInterest: mask, callback: callback, userInfo: info)
        }
        enable = { CGEvent.tapEnable(tap: $0, enable: $1) }
        enabled = { CGEvent.tapIsEnabled(tap: $0) }
    }

    init(create: @escaping (WindowInputFocusTapSpec, CGEventTapCallBack, UnsafeMutableRawPointer) -> CFMachPort?,
         enable: @escaping (CFMachPort, Bool) -> Void, enabled: @escaping (CFMachPort) -> Bool) {
        self.create = create; self.enable = enable; self.enabled = enabled
    }
}

private final class WindowInputFocusTapContext {
    weak var owner: WindowInputFocusTapThread?
    let handler: (CGEventType, CGEvent) -> CGEvent?
    init(owner: WindowInputFocusTapThread, handler: @escaping (CGEventType, CGEvent) -> CGEvent?) {
        self.owner = owner; self.handler = handler
    }
}

private let windowInputFocusTapCallback: CGEventTapCallBack = { _, type, event, raw in
    guard let raw else { return Unmanaged.passUnretained(event) }
    let context = Unmanaged<WindowInputFocusTapContext>.fromOpaque(raw).takeUnretainedValue()
    guard let owner = context.owner else { return Unmanaged.passUnretained(event) }
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        owner.markUnsafe(); return Unmanaged.passUnretained(event)
    }
    guard owner.isHealthy else { return Unmanaged.passUnretained(event) }
    // No runtime lock is held while invoking policy or calling system APIs.
    guard let result = context.handler(type, event) else { return nil }
    return Unmanaged.passUnretained(result)
}

// A timed-out queued task is cancelled before it can execute. If its body has
// already begun, the runtime is poisoned and teardown still waits for the real
// thread acknowledgement; timeout never reports successful cleanup.
private final class WindowInputFocusTapTicket<T> {
    private let lock = NSLock()
    private var cancelled = false
    private var result: Result<T, Error>?
    let completed = DispatchSemaphore(value: 0)
    func run(_ body: () throws -> T) {
        lock.lock()
        guard !cancelled else { lock.unlock(); return }
        lock.unlock()
        let value = Result { try body() }
        lock.lock(); result = value; lock.unlock(); completed.signal()
    }
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    func value() throws -> T {
        lock.lock(); let selected = result; lock.unlock()
        guard let selected else { throw WindowInputFocusTapError.stopped }
        return try selected.get()
    }
}

final class WindowInputFocusTapThread {
    private struct Tap { let port: CFMachPort; let source: CFRunLoopSource; let context: WindowInputFocusTapContext }
    private let condition = NSCondition()
    private let backend: WindowInputFocusTapBackend
    private let onUnsafe: () -> Void
    private var healthy = true
    private var stopping = false
    private var exited = false
    private var installed = false
    private var runLoop: CFRunLoop?
    // Foundation retains a running Thread. A strong reference here would form
    // a self -> Thread -> entry closure -> self cycle after teardown.
    private weak var thread: Thread?
    private var taps: [UUID: Tap] = [:] // Accessed only by the owned thread.

    convenience init(spi: WindowInputFocusSPI, specs: [WindowInputFocusTapSpec] = [], onUnsafe: @escaping () -> Void) throws {
        try self.init(backend: WindowInputFocusTapBackend(spi: spi), specs: specs, onUnsafe: onUnsafe)
    }

    init(backend: WindowInputFocusTapBackend, specs: [WindowInputFocusTapSpec] = [], onUnsafe: @escaping () -> Void) throws {
        self.backend = backend; self.onUnsafe = onUnsafe
        let worker = Thread { [self] in threadMain(specs) }
        worker.name = "com.omniflow.window-input.focus-taps"; thread = worker; worker.start()
        let deadline = Date().addingTimeInterval(1)
        condition.lock()
        while !installed && !exited && Date() < deadline { _ = condition.wait(until: deadline) }
        let ready = installed && healthy && !stopping && !exited
        condition.unlock()
        if !ready {
            let clean = stop(timeout: 0.75)
            throw clean ? WindowInputFocusTapError.unavailable : WindowInputFocusTapError.cleanupUnconfirmed
        }
    }

    var isHealthy: Bool {
        condition.lock(); defer { condition.unlock() }
        return healthy && installed && !stopping && !exited
    }
    fileprivate func markUnsafe() {
        condition.lock(); let notify = healthy; healthy = false; condition.unlock()
        if notify { onUnsafe() }
    }

    func perform<T>(timeout: Double = 1, _ body: @escaping () throws -> T) throws -> T {
        guard timeout.isFinite, timeout > 0, timeout <= 2 else { throw WindowInputFocusTapError.invalidRequest }
        if Thread.current === thread {
            guard isHealthy else { throw WindowInputFocusTapError.stopped }
            return try body()
        }
        condition.lock()
        guard healthy && installed && !stopping && !exited, let loop = runLoop else {
            condition.unlock(); throw WindowInputFocusTapError.stopped
        }
        let ticket = WindowInputFocusTapTicket<T>()
        CFRunLoopPerformBlock(loop, CFRunLoopMode.defaultMode.rawValue) { [weak self] in
            ticket.run { guard self?.isHealthy == true else { throw WindowInputFocusTapError.stopped }; return try body() }
        }
        condition.unlock(); CFRunLoopWakeUp(loop)
        guard ticket.completed.wait(timeout: .now() + timeout) == .success else {
            ticket.cancel(); markUnsafe(); throw WindowInputFocusTapError.timeout
        }
        return try ticket.value()
    }

    func add(_ spec: WindowInputFocusTapSpec) throws -> UUID { try perform { try self.install(spec) } }
    func remove(_ id: UUID) throws { try perform { self.removeOnThread(id) } }

    @discardableResult func stop(timeout: Double = 1) -> Bool {
        guard timeout.isFinite, timeout >= 0, timeout <= 2 else { return false }
        condition.lock(); stopping = true; let loop = runLoop; let worker = thread
        if Thread.current === worker { condition.unlock(); if let loop { CFRunLoopStop(loop) }; return false }
        condition.unlock()
        if let loop { CFRunLoopWakeUp(loop) }
        let deadline = Date().addingTimeInterval(timeout)
        condition.lock(); defer { condition.unlock() }
        while (!exited || worker?.isFinished == false) && Date() < deadline {
            _ = condition.wait(until: min(deadline, Date().addingTimeInterval(0.005)))
        }
        return exited && worker?.isFinished != false
    }

    private func install(_ spec: WindowInputFocusTapSpec) throws -> UUID {
        guard Thread.current === thread, spec.pid == nil || spec.pid! > 0,
              !spec.types.isEmpty, spec.types.count <= 8, Set(spec.types).count == spec.types.count,
              spec.types.allSatisfy({ (spec.pid == nil ? [1, 21] : [10, 11, 12, 13, 19, 20]).contains($0) }),
              taps.count < 12 else { throw WindowInputFocusTapError.invalidRequest }
        condition.lock(); let allowed = healthy && !stopping && !exited; condition.unlock()
        guard allowed else { throw WindowInputFocusTapError.stopped }
        let context = WindowInputFocusTapContext(owner: self, handler: spec.handler)
        guard let port = backend.create(spec, windowInputFocusTapCallback, Unmanaged.passUnretained(context).toOpaque()) else {
            markUnsafe(); throw WindowInputFocusTapError.unavailable
        }
        condition.lock(); let stillAllowed = healthy && !stopping && !exited; condition.unlock()
        guard stillAllowed else { CFMachPortInvalidate(port); throw WindowInputFocusTapError.stopped }
        guard CFMachPortIsValid(port), let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0) else {
            CFMachPortInvalidate(port); markUnsafe(); throw WindowInputFocusTapError.unavailable
        }
        let id = UUID(); taps[id] = Tap(port: port, source: source, context: context)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .defaultMode)
        backend.enable(port, true)
        guard backend.enabled(port), CFMachPortIsValid(port) else {
            removeOnThread(id); markUnsafe(); throw WindowInputFocusTapError.unavailable
        }
        return id
    }

    private func removeOnThread(_ id: UUID) {
        guard let tap = taps.removeValue(forKey: id) else { return }
        backend.enable(tap.port, false); CFMachPortInvalidate(tap.port)
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), tap.source, .defaultMode)
        CFRunLoopSourceInvalidate(tap.source)
    }

    private func threadMain(_ specs: [WindowInputFocusTapSpec]) {
        let loop = CFRunLoopGetCurrent()
        var context = CFRunLoopSourceContext(version: 0, info: nil, retain: nil, release: nil,
            copyDescription: nil, equal: nil, hash: nil, schedule: nil, cancel: nil, perform: { _ in })
        guard let keepAlive = CFRunLoopSourceCreate(kCFAllocatorDefault, 0, &context) else {
            markUnsafe(); condition.lock(); exited = true; condition.broadcast(); condition.unlock(); return
        }
        CFRunLoopAddSource(loop, keepAlive, .defaultMode)
        condition.lock(); runLoop = loop; condition.unlock()
        defer {
            for id in Array(taps.keys) { removeOnThread(id) }
            CFRunLoopRemoveSource(loop, keepAlive, .defaultMode); CFRunLoopSourceInvalidate(keepAlive)
            condition.lock(); runLoop = nil; exited = true; condition.broadcast(); condition.unlock()
        }
        do { for spec in specs { _ = try install(spec) } }
        catch { markUnsafe(); return }
        condition.lock(); installed = true; condition.broadcast(); condition.unlock()
        while true {
            condition.lock(); let done = stopping; condition.unlock()
            if done { break }
            CFRunLoopRunInMode(.defaultMode, 0.05, true)
            if taps.values.contains(where: { !CFMachPortIsValid($0.port) || !backend.enabled($0.port) }) { markUnsafe() }
        }
    }
}
