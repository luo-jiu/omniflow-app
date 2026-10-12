import AppKit
import Foundation
import Darwin

var inputFixtureFocusCommand: sig_atomic_t = 0

@objc(InputFixtureApplication)
final class InputFixtureApplication: NSApplication {
    static var approvedWindows: Set<Int> = []
    override func sendEvent(_ event: NSEvent) {
        // Read-only receiver diagnostics: the normal AppKit router still handles
        // the event. Do not repair missing window routing in this fixture.
        let root = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL
        if Self.approvedWindows.contains(event.windowNumber)
            && (root.path.hasPrefix("/tmp/omniflow-input-qa-") || root.path.hasPrefix("/private/tmp/omniflow-input-qa-")) {
            let entry: [String: Any] = ["type": event.type.rawValue, "windowNumber": event.windowNumber,
                "x": event.locationInWindow.x, "y": event.locationInWindow.y,
                "clickCount": [.leftMouseDown, .rightMouseDown, .leftMouseUp, .rightMouseUp, .leftMouseDragged].contains(event.type) ? event.clickCount : 0,
                "windowHint": event.cgEvent?.getIntegerValueField(.mouseEventWindowUnderMousePointer) as Any? ?? NSNull()]
            if let data = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]) {
                let url = root.appendingPathComponent("received-events.jsonl")
                if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
                if let handle = try? FileHandle(forWritingTo: url) {
                    defer { try? handle.close() }
                    _ = try? handle.seekToEnd()
                    try? handle.write(contentsOf: data + Data([10]))
                }
            }
        }
        super.sendEvent(event)
    }
}

// Disposable acceptance receiver. It observes genuine AppKit callbacks; it has
// no AX client, synthetic event poster, custom event rerouter or Agent bridge.
// All state is local to this temporary fixture, not to any user document.
final class InputFixtureView: NSView {
    var singleDowns = 0
    var doubleDowns = 0
    var rightDowns = 0
    var dragMoves = 0
    var leftUps = 0
    var rightUps = 0
    var shortcuts = 0
    var keyDowns = 0
    var keyUps = 0
    var contextVisible = false
    var circle = CGPoint(x: 140, y: 150)
    private var tracking = false
    private var currentEventWindow: Int?
    private var lastEvent = "initial"
    var statusLabel: NSTextField?
    var stateURL: URL?

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func becomeFirstResponder() -> Bool { setAccessibilityFocused(true); return true }
    override func resignFirstResponder() -> Bool { setAccessibilityFocused(false); return true }

    private func record(_ name: String, event: NSEvent? = nil) {
        lastEvent = name
        currentEventWindow = event?.windowNumber
        statusLabel?.stringValue = "右键 \(rightDowns) · 双击 \(doubleDowns) · 拖动 \(dragMoves) · 快捷键 \(shortcuts) · up \(leftUps + rightUps)"
        needsDisplay = true
        let state: [String: Any] = ["profile": "appkit-fixture-v1", "windowNumber": window?.windowNumber ?? -1,
            "eventWindowNumber": currentEventWindow as Any? ?? NSNull(), "lastEvent": lastEvent,
            "singleDowns": singleDowns, "doubleDowns": doubleDowns, "rightDowns": rightDowns,
            "dragMoves": dragMoves, "leftUps": leftUps, "rightUps": rightUps,
            "shortcuts": shortcuts, "keyDowns": keyDowns, "keyUps": keyUps, "tracking": tracking,
            "contextVisible": contextVisible, "circle": ["x": circle.x, "y": circle.y],
            "frontmost": NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier]
        if let stateURL = stateURL, let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]) {
            try? data.write(to: stateURL, options: [.atomic])
        }
    }

    func snapshot() { record("ready") }
    func toggleShortcut() { shortcuts += 1; record("commandB") }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { doubleDowns += 1 } else { singleDowns += 1 }
        let point = convert(event.locationInWindow, from: nil)
        tracking = hypot(point.x - circle.x, point.y - circle.y) <= 36
        contextVisible = false
        record("mouseDown", event: event)
    }

    override func mouseDragged(with event: NSEvent) {
        if tracking {
            let point = convert(event.locationInWindow, from: nil)
            circle = CGPoint(x: max(36, min(bounds.width - 36, point.x)), y: max(36, min(bounds.height - 36, point.y)))
            dragMoves += 1
        }
        record("mouseDragged", event: event)
    }

    override func mouseUp(with event: NSEvent) {
        leftUps += 1
        tracking = false
        record("mouseUp", event: event)
    }

    override func rightMouseDown(with event: NSEvent) {
        rightDowns += 1
        // A local, visible context surface lets the test observe right-click
        // dispatch without granting access to a separate system menu window.
        contextVisible = !contextVisible
        record("rightMouseDown", event: event)
    }

    override func rightMouseUp(with event: NSEvent) { rightUps += 1; record("rightMouseUp", event: event) }
    override func keyDown(with event: NSEvent) { keyDowns += 1; record("keyDown", event: event) }
    override func keyUp(with event: NSEvent) { keyUps += 1; record("keyUp", event: event) }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        dirtyRect.fill()
        NSColor.controlAccentColor.setFill()
        NSBezierPath(ovalIn: CGRect(x: circle.x - 32, y: circle.y - 32, width: 64, height: 64)).fill()
        let text = "拖拽蓝色圆点 · 双击空白区域 · 右键显示本地提示 · ⌘B 翻转计数"
        text.draw(at: CGPoint(x: 24, y: 58), withAttributes: [.font: NSFont.systemFont(ofSize: 15), .foregroundColor: NSColor.labelColor])
        if contextVisible {
            NSColor.controlBackgroundColor.setFill()
            NSBezierPath(roundedRect: CGRect(x: 420, y: 100, width: 260, height: 72), xRadius: 8, yRadius: 8).fill()
            "已接收到真实 rightMouseDown".draw(at: CGPoint(x: 436, y: 128),
                withAttributes: [.font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor.labelColor])
        }
    }
}

final class InputFixtureDelegate: NSObject, NSApplicationDelegate {
    private var primary: NSWindow?
    private var secondary: NSWindow?
    private var receiver: InputFixtureView?
    private var focusTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let view = InputFixtureView(frame: CGRect(x: 0, y: 0, width: 760, height: 430))
        view.setAccessibilityElement(true)
        view.setAccessibilityRole(.group)
        view.setAccessibilityLabel("后台输入 QA 画布")
        view.setAccessibilityIdentifier("omniflow-window-input-canvas")
        let window = NSWindow(contentRect: view.bounds, styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Omniflow Window Input QA"
        window.isReleasedWhenClosed = false
        window.contentView = view
        window.center()
        primary = window
        receiver = view

        let heading = NSTextField(labelWithString: "OmniFlow 后台定向输入实验")
        heading.frame = CGRect(x: 24, y: 366, width: 700, height: 30)
        heading.font = .boldSystemFont(ofSize: 22)
        view.addSubview(heading)
        let status = NSTextField(labelWithString: "等待真实输入")
        status.frame = CGRect(x: 24, y: 328, width: 700, height: 26)
        status.setAccessibilityLabel("输入结果计数")
        view.statusLabel = status
        view.addSubview(status)
        let second = NSButton(title: "打开第二个 QA 窗口（多窗拒绝测试）", target: self, action: #selector(openSecondWindow))
        second.frame = CGRect(x: 390, y: 224, width: 340, height: 32)
        view.addSubview(second)

        let root = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL
        // Build script owns this temporary root. Never take a user path argument.
        if root.path.hasPrefix("/tmp/omniflow-input-qa-") || root.path.hasPrefix("/private/tmp/omniflow-input-qa-") {
            view.stateURL = root.appendingPathComponent("state.json")
        }
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Omniflow Window Input QA")
        appMenu.addItem(withTitle: "退出 QA", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let testItem = NSMenuItem()
        let testMenu = NSMenu(title: "测试")
        let shortcut = NSMenuItem(title: "计数 Command B", action: #selector(toggleShortcut), keyEquivalent: "b")
        shortcut.target = self
        testMenu.addItem(shortcut)
        testItem.submenu = testMenu
        menu.addItem(testItem)
        NSApplication.shared.mainMenu = menu
        // Mark a key receiver inside this app while keeping its surface behind
        // existing user windows. Never activate or order-front a window to pass.
        window.orderBack(nil)
        window.makeKey()
        InputFixtureApplication.approvedWindows.insert(window.windowNumber)
        window.makeFirstResponder(view)
        view.snapshot()
        signal(SIGUSR1) { _ in inputFixtureFocusCommand = 1 }
        signal(SIGUSR2) { _ in inputFixtureFocusCommand = 2 }
        focusTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            let command = inputFixtureFocusCommand
            inputFixtureFocusCommand = 0
            if command == 1 { self?.openSecondWindow() }
            if command == 2 { self?.primary?.makeKey() }
        }
    }

    @objc private func toggleShortcut() { receiver?.toggleShortcut() }
    @objc private func openSecondWindow() {
        if let secondary = secondary { secondary.makeKey(); return }
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 420, height: 180), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Omniflow Window Input QA Other"
        window.isReleasedWhenClosed = false
        secondary = window
        window.center()
        window.orderBack(nil)
        window.makeKey()
        InputFixtureApplication.approvedWindows.insert(window.windowNumber)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = InputFixtureApplication.shared
let delegate = InputFixtureDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
withExtendedLifetime(delegate) { app.run() }
