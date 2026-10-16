import ApplicationServices
import Darwin
import Foundation

// An input session owns one immutable ordinary window and, lazily, its protected
// synthetic focus. Menu and indicator sessions never own this input lifetime.
let windowInputSessionMaximumLineBytes = 72 * 1024
let windowInputSessionMaximumTotalBytes = 20 * 1024 * 1024
let windowInputSessionMaximumInputs = 256
let windowInputSessionMaximumLifetime: UInt64 = 1_800_000_000_000
let windowInputSessionMaximumIdle: UInt64 = 300_000_000_000

enum WindowInputSessionCommandKind: String { case input, close }
struct WindowInputSessionCommand {
    let requestId: String
    let kind: WindowInputSessionCommandKind
    let inputData: Data?
}

func parseWindowInputSessionCommand(_ data: Data) throws -> WindowInputSessionCommand {
    let (_, object) = try parseInput(data, maximumBytes: windowInputSessionMaximumLineBytes)
    guard let requestId = object["requestId"] as? String,
          requestId.range(of: "^[1-9][0-9]{0,8}$", options: .regularExpression) != nil,
          let rawCommand = object["command"] as? String,
          let kind = WindowInputSessionCommandKind(rawValue: rawCommand) else { throw invalidRequest() }
    switch kind {
    case .close:
        _ = try fields(object, required: ["requestId", "command"])
        return WindowInputSessionCommand(requestId: requestId, kind: kind, inputData: nil)
    case .input:
        _ = try fields(object, required: ["requestId", "command", "request"])
        guard let input = object["request"] as? [String: Any] else { throw invalidRequest() }
        return WindowInputSessionCommand(requestId: requestId, kind: kind,
            inputData: try JSONSerialization.data(withJSONObject: input, options: [.sortedKeys]))
    }
}

func windowInputSessionWindowMatches(_ actual: WindowIdentity, _ expected: WindowIdentity) -> Bool {
    actual.windowId == expected.windowId && actual.pid == expected.pid
        && actual.processStartedAt == expected.processStartedAt && actual.layer == expected.layer
        && actual.bounds.x == expected.bounds.x && actual.bounds.y == expected.bounds.y
        && actual.bounds.width == expected.bounds.width && actual.bounds.height == expected.bounds.height
        && actual.title == expected.title
}

// Shared by production and the no-GUI protocol harness. The parser rejects
// duplicate JSON keys before reserializing the nested private input request.
final class WindowInputSessionState {
    let window: WindowIdentity
    let began: UInt64
    private(set) var lastInputAt: UInt64
    private(set) var stopped = false
    private(set) var inputCount = 0
    private var requestIDs = Set<String>()

    init(window: WindowIdentity, now: UInt64) throws {
        guard window.valid else { throw invalidRequest() }
        self.window = window; began = now; lastInputAt = now
    }

    func withinLifetime(now: UInt64) -> Bool {
        !stopped && now >= began && now >= lastInputAt
            && now - began < windowInputSessionMaximumLifetime
            && now - lastInputAt < windowInputSessionMaximumIdle
    }

    func stop() { stopped = true }

    func handle(_ command: WindowInputSessionCommand, now: UInt64,
                focusSnapshot: () -> WindowInputFocusSnapshot = { WindowInputFocusSnapshot(postedCount: 0, state: .inactive) },
                execute: (WindowInputRequest) throws -> DirectedInputResult) throws -> [String: Any] {
        guard withinLifetime(now: now), requestIDs.count <= windowInputSessionMaximumInputs,
              requestIDs.insert(command.requestId).inserted else { throw invalidRequest() }
        lastInputAt = now
        if command.kind == .close {
            stop()
            return ["requestId": command.requestId, "ok": true, "type": "closed"]
        }
        guard inputCount < windowInputSessionMaximumInputs else { throw invalidRequest() }
        inputCount += 1
        let previousPostCount = focusSnapshot().postedCount
        var receipt: [String: Any]
        do {
            guard let data = command.inputData else { throw invalidRequest() }
            let request = try parseWindowInputRequest(data)
            guard request.profile == "directed-v1" else { throw windowInputError("unsupported_receiver") }
            guard windowInputSessionWindowMatches(request.window, window) else { throw windowInputError("target_changed") }
            receipt = windowInputSuccessReceipt(try execute(request))
        } catch {
            receipt = windowInputFailureReceipt(error)
            // No subsequent request may outlive an unpaired synthetic press.
            if receipt["dispatched"] as? String == "unknown", receipt["releaseSent"] as? Bool != true { stop() }
        }
        let currentFocus = focusSnapshot()
        receipt = windowInputFocusReceipt(receipt, previousPostCount: previousPostCount, snapshot: currentFocus)
        let focusPosted = receipt["focusPosted"] as? Bool == true
        windowInputLogger.notice("focusPosted=\(focusPosted, privacy: .public) focusState=\(currentFocus.state.rawValue, privacy: .public)")
        if currentFocus.state == .unconfirmed { stop() }
        receipt["requestId"] = command.requestId
        return receipt
    }
}

struct WindowInputSessionLineBuffer {
    private var buffer = Data()
    private var totalBytes = 0
    var empty: Bool { buffer.isEmpty }

    mutating func append(_ data: Data) throws -> [Data] {
        guard data.count <= windowInputSessionMaximumTotalBytes - totalBytes else { throw invalidRequest() }
        totalBytes += data.count
        buffer.append(data)
        var lines: [Data] = []
        while let newline = buffer.firstIndex(of: 10) {
            let size = buffer.distance(from: buffer.startIndex, to: newline)
            guard size > 0, size <= windowInputSessionMaximumLineBytes else { throw invalidRequest() }
            lines.append(Data(buffer[..<newline]))
            buffer.removeSubrange(...newline)
        }
        guard buffer.count <= windowInputSessionMaximumLineBytes else { throw invalidRequest() }
        return lines
    }
}

// poll observes disconnection without consuming another command while the
// synchronous worker owns the current action. A signal still owns cancellation;
// its flag is installed once and never reset between requests.
func windowInputSessionPipeOpen(_ descriptor: Int32) -> Bool {
    var selected = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
    let result = Darwin.poll(&selected, 1, 0)
    return result >= 0 && selected.revents & Int16(POLLHUP | POLLERR | POLLNVAL) == 0
}

func windowInputSession() throws {
    installWindowInputCancellation()
    signal(SIGPIPE, SIG_IGN)
    let parentPID = getppid()
    guard parentPID > 1, let parentStartedAt = processStart(parentPID) else { throw windowInputError("cancelled") }
    let inputFlags = fcntl(STDIN_FILENO, F_GETFL), outputFlags = fcntl(STDOUT_FILENO, F_GETFL)
    guard inputFlags >= 0, outputFlags >= 0,
          fcntl(STDIN_FILENO, F_SETFL, inputFlags | O_NONBLOCK) == 0,
          fcntl(STDOUT_FILENO, F_SETFL, outputFlags | O_NONBLOCK) == 0 else { throw invalidRequest() }
    defer { _ = fcntl(STDIN_FILENO, F_SETFL, inputFlags); _ = fcntl(STDOUT_FILENO, F_SETFL, outputFlags) }
    func parentAlive() -> Bool {
        getppid() == parentPID && processStart(parentPID) == parentStartedAt
    }
    // Cancellation, EOF and the normal session deadline stop new input, but do
    // not suppress the current action's final paired-release receipt. Output
    // has its own bounded grace and still requires the original living parent.
    func send(_ receipt: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
        guard data.count <= 4096 else { throw invalidRequest() }
        data.append(10)
        let deadline = DispatchTime.now().uptimeNanoseconds + 1_000_000_000
        try data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                guard parentAlive(), DispatchTime.now().uptimeNanoseconds < deadline else { throw windowInputError("cancelled") }
                let written = Darwin.write(STDOUT_FILENO, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if written > 0 { offset += written }
                else if written < 0 && [EAGAIN, EWOULDBLOCK, EINTR].contains(errno) {
                    windowInputMainRunLoopService.pause(nanoseconds: 1_000_000, until: deadline)
                }
                else { throw windowInputError("cancelled") }
            }
        }
    }
    let began = DispatchTime.now().uptimeNanoseconds
    var state: WindowInputSessionState?
    var focus: WindowInputFocusSession?
    var ready = false
    var buffer = WindowInputSessionLineBuffer()
    var bytes = [UInt8](repeating: 0, count: 4096)
    defer {
        state?.stop()
        let finalFocus = focus?.shutdown() ?? WindowInputFocusSnapshot(postedCount: 0, state: .inactive)
        if ready {
            try? send(["ok": true, "type": "stopped", "focusState": finalFocus.state.rawValue])
            windowInputLogger.notice("focusCleanup=\(finalFocus.state.rawValue, privacy: .public)")
        }
    }
    func requireLifetime() throws {
        guard windowInputCancelled == 0, parentAlive(), windowInputSessionPipeOpen(STDIN_FILENO),
              state?.withinLifetime(now: DispatchTime.now().uptimeNanoseconds) == true else { throw windowInputError("cancelled") }
    }
    do {
        while windowInputCancelled == 0 && parentAlive() {
            let now = DispatchTime.now().uptimeNanoseconds
            let waitDeadline: UInt64
            if let state {
                guard state.withinLifetime(now: now) else { return }
                try focus?.requireHealthy()
                waitDeadline = min(state.began + windowInputSessionMaximumLifetime,
                                   state.lastInputAt + windowInputSessionMaximumIdle)
            } else {
                guard now - began < 1_500_000_000 else { throw windowInputError("cancelled") }
                waitDeadline = began + 1_500_000_000
            }
            let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
            if count == 0 { return }
            if count < 0 {
                guard [EAGAIN, EWOULDBLOCK, EINTR].contains(errno) else { return }
                windowInputMainRunLoopService.pause(nanoseconds: 5_000_000, until: waitDeadline); continue
            }
            for line in try buffer.append(Data(bytes.prefix(count))) {
                // Notifications may update NSWorkspace, but only this outer
                // synchronous loop parses/executes commands. Servicing one
                // main turn cannot consume a second input during an action.
                windowInputMainRunLoopService.service()
                guard windowInputCancelled == 0, parentAlive() else { return }
                if state == nil {
                    let request = try parseWindowRequest(line)
                    let receiver = try requireWindowInputReceiver(request.window)
                    guard receiver.profile == "directed-v1" else { throw windowInputError("unsupported_receiver") }
                    state = try WindowInputSessionState(window: request.window, now: DispatchTime.now().uptimeNanoseconds)
                    focus = WindowInputFocusSession(window: request.window)
                    try requireLifetime()
                    try send(["ok": true, "type": "ready", "protocol": 2])
                    ready = true
                    continue
                }
                guard let state else { return }
                let command = try parseWindowInputSessionCommand(line)
                let receipt = try state.handle(command, now: DispatchTime.now().uptimeNanoseconds, focusSnapshot: {
                    focus?.snapshot ?? WindowInputFocusSnapshot(postedCount: 0, state: .inactive)
                }) { request in
                    try executeWindowInput(request, pointerFeedback: WindowInputPointerFeedback(requestID: command.requestId), focusSession: focus, lifetimeGuard: requireLifetime)
                }
                try send(receipt)
                if state.stopped || windowInputCancelled != 0 { return }
            }
        }
    } catch {
        // Only startup may use the CLI's uncorrelated failure shape. After ready
        // a malformed/unmatched frame ends the session; it never invents an ID.
        if !ready { throw error }
    }
}
