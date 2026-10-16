import AppKit
import Foundation
import Darwin

// Disposable, independently supervised AppKit receiver. It has no AX client,
// synthetic event sender, activation call, event rerouter or user data access.
// Only genuine AXPress/AXShowMenu or an incoming right-click opens the NSMenu.
final class MenuFixturePanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class MenuFixtureButton: NSButton {
    var requestMenu: ((String) -> Void)?
    override func accessibilityPerformShowMenu() -> Bool {
        requestMenu?("AXShowMenu")
        return requestMenu != nil
    }
    override func accessibilityPerformPress() -> Bool {
        requestMenu?("AXPress")
        return requestMenu != nil
    }
    override func rightMouseDown(with event: NSEvent) { requestMenu?("rightMouseDown") }
}

final class MenuFixtureDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let root: URL
    private let originalParent = getppid()
    private let clock = DispatchTime.now().uptimeNanoseconds
    private var panel: MenuFixturePanel?
    private var button: MenuFixtureButton?
    private var contextMenu: NSMenu?
    private var status: NSTextField?
    private var lifecycleTimer: DispatchSourceTimer?
    private var signalSources: [DispatchSourceSignal] = []
    private var stdinSource: DispatchSourceRead?
    private var shutdownStarted = false
    private var menuPending = false
    private var visibleMenus: Set<String> = []
    private var selectionCount = 0
    private var cancelCount = 0
    private var openedCount = 0
    private var lastAction = "none"
    private var lastTrigger = "none"
    private var lastLifecycle = "launching"
    private var wasFrontmost = false
    private var wasKeyOrMain = false

    init(root: URL) { self.root = root; super.init() }

    private func snapshot() {
        precondition(Thread.isMainThread)
        wasFrontmost = wasFrontmost || NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid()
        wasKeyOrMain = wasKeyOrMain || panel?.isKeyWindow == true || panel?.isMainWindow == true
        status?.stringValue = "选择次数 \(selectionCount)；最后动作 \(lastAction)；菜单 \(visibleMenus.isEmpty ? "关闭" : "展开")"
        let state: [String: Any] = [
            "fixture": "appkit-native-menu-v1", "pid": getpid(), "parentPid": originalParent,
            "windowNumber": panel?.windowNumber ?? -1, "windowTitle": panel?.title ?? "",
            "selectionCount": selectionCount, "cancelCount": cancelCount, "openedCount": openedCount,
            "lastAction": lastAction, "lastTrigger": lastTrigger, "lastLifecycle": lastLifecycle,
            "menuVisible": !visibleMenus.isEmpty, "visibleMenus": visibleMenus.sorted(),
            "frontmost": NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
            "wasFrontmost": wasFrontmost, "wasKeyOrMain": wasKeyOrMain,
            "elapsedMs": (DispatchTime.now().uptimeNanoseconds - clock) / 1_000_000,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]) {
            try? data.write(to: root.appendingPathComponent("state.json"), options: [.atomic])
        }
    }

    private func shutdown(_ reason: String) {
        precondition(Thread.isMainThread)
        guard !shutdownStarted else { return }
        shutdownStarted = true
        lastLifecycle = reason
        contextMenu?.cancelTracking()
        panel?.orderOut(nil)
        snapshot()
        lifecycleTimer?.cancel()
        stdinSource?.cancel()
        signalSources.forEach { $0.cancel() }
        NSApplication.shared.terminate(nil)
    }

    // The global timer remains effective if AppKit enters menu tracking or its
    // main thread stops servicing normal run-loop modes. The outer supervisor
    // independently owns the process group; this is an additional local limit.
    private func requestShutdown(_ reason: String) {
        DispatchQueue.main.async { [weak self] in self?.shutdown(reason) }
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(500)) { _exit(0) }
    }

    private func installLifetime() {
        signal(SIGPIPE, SIG_IGN)
        for number in [SIGTERM, SIGINT, SIGHUP] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
            source.setEventHandler { [weak self] in self?.requestShutdown("signal-\(number)") }
            source.resume()
            signalSources.append(source)
        }
        let input = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .global())
        input.setEventHandler { [weak self] in
            var bytes = [UInt8](repeating: 0, count: 64)
            let count = read(STDIN_FILENO, &bytes, bytes.count)
            if count == 0 {
                self?.stdinSource?.cancel()
                self?.requestShutdown("parent-pipe-eof")
            } else if count < 0 && errno != EINTR && errno != EAGAIN {
                self?.stdinSource?.cancel()
                self?.requestShutdown("parent-pipe-error")
            }
        }
        stdinSource = input
        input.resume()
        let timer = DispatchSource.makeTimerSource(queue: .global())
        timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            if getppid() != self.originalParent {
                self.lifecycleTimer?.cancel()
                self.requestShutdown("parent-lost")
            } else if DispatchTime.now().uptimeNanoseconds - self.clock >= 45_000_000_000 {
                self.lifecycleTimer?.cancel()
                self.requestShutdown("duration-limit")
            }
            else { DispatchQueue.main.async { [weak self] in self?.snapshot() } }
        }
        lifecycleTimer = timer
        timer.resume()
    }

    private func action(_ title: String, id: String, enabled: Bool = true) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(selectAction(_:)), keyEquivalent: "")
        item.target = self
        item.identifier = NSUserInterfaceItemIdentifier(id)
        item.isEnabled = enabled
        return item
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu(title: "QA 右键菜单")
        menu.autoenablesItems = false
        menu.delegate = self
        menu.addItem(action("执行一级动作", id: "primary-action"))
        menu.addItem(action("不可用一级动作", id: "disabled-primary", enabled: false))
        let more = NSMenuItem(title: "更多操作", action: nil, keyEquivalent: "")
        more.identifier = NSUserInterfaceItemIdentifier("secondary-menu")
        let secondary = NSMenu(title: "QA 二级菜单")
        secondary.autoenablesItems = false
        secondary.delegate = self
        secondary.addItem(action("执行二级动作", id: "secondary-action"))
        secondary.addItem(action("不可用二级动作", id: "disabled-secondary", enabled: false))
        let deeper = NSMenuItem(title: "深入操作", action: nil, keyEquivalent: "")
        deeper.identifier = NSUserInterfaceItemIdentifier("tertiary-menu")
        let tertiary = NSMenu(title: "QA 三级菜单")
        tertiary.autoenablesItems = false
        tertiary.delegate = self
        tertiary.addItem(action("执行三级动作", id: "tertiary-action"))
        deeper.submenu = tertiary
        secondary.addItem(deeper)
        more.submenu = secondary
        menu.addItem(more)
        menu.addItem(.separator())
        menu.addItem(action("取消菜单", id: "cancel"))
        return menu
    }

    private func requestMenu(_ trigger: String) {
        precondition(Thread.isMainThread)
        guard !menuPending, visibleMenus.isEmpty, !shutdownStarted else { return }
        menuPending = true
        lastTrigger = trigger
        snapshot()
        // AX invocation returns before native menu tracking begins. No direct
        // invocation of any leaf action is used to manufacture a test result.
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.shutdownStarted,
                  let menu = self.contextMenu, let button = self.button else { return }
            self.menuPending = false
            _ = menu.popUp(positioning: nil, at: NSPoint(x: 0, y: 0), in: button)
            self.visibleMenus.removeAll()
            self.lastLifecycle = "menu-returned"
            self.snapshot()
        }
    }

    @objc private func openFromButton(_ sender: NSButton) { requestMenu("buttonAction") }

    @objc private func selectAction(_ sender: NSMenuItem) {
        guard sender.isEnabled, let id = sender.identifier?.rawValue else { return }
        if id == "cancel" { cancelCount += 1 }
        else { selectionCount += 1 }
        lastAction = id
        snapshot()
    }

    func menuWillOpen(_ menu: NSMenu) {
        visibleMenus.insert(menu.title)
        if menu === contextMenu { openedCount += 1 }
        lastLifecycle = "menu-open"
        snapshot()
    }

    func menuDidClose(_ menu: NSMenu) {
        visibleMenus.remove(menu.title)
        lastLifecycle = "menu-close"
        snapshot()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installLifetime()
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 820, height: 410))
        let window = MenuFixturePanel(contentRect: content.bounds,
            styleMask: [.titled, .nonactivatingPanel], backing: .buffered, defer: false)
        window.title = "Omniflow Native Menu QA"
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.becomesKeyOnlyIfNeeded = false
        window.isFloatingPanel = false
        window.level = .normal
        window.contentView = content
        panel = window
        let heading = NSTextField(labelWithString: "OmniFlow 原生多级菜单验收")
        heading.font = .boldSystemFont(ofSize: 22)
        heading.frame = NSRect(x: 24, y: 338, width: 770, height: 30)
        content.addSubview(heading)
        let control = MenuFixtureButton(title: "打开 QA 右键菜单", target: self, action: #selector(openFromButton(_:)))
        // Leave room on the display while letting nested menus extend beyond
        // the approved main window, exercising the exact capture union.
        control.frame = NSRect(x: 600, y: 276, width: 210, height: 36)
        control.setAccessibilityLabel("打开 QA 右键菜单")
        control.setAccessibilityIdentifier("omniflow-native-menu-trigger")
        control.requestMenu = { [weak self] trigger in self?.requestMenu(trigger) }
        content.addSubview(control)
        button = control
        let label = NSTextField(labelWithString: "等待菜单操作")
        label.frame = NSRect(x: 24, y: 220, width: 770, height: 30)
        label.setAccessibilityLabel("菜单结果计数")
        label.setAccessibilityIdentifier("omniflow-native-menu-result")
        content.addSubview(label)
        status = label
        let detail = NSTextField(wrappingLabelWithString: "仅含临时测试状态。菜单由真实控件操作打开；一级、二级和三级动作分别计数，禁用动作不可执行。")
        detail.frame = NSRect(x: 24, y: 142, width: 770, height: 54)
        content.addSubview(detail)
        contextMenu = makeMenu()
        window.center()
        window.orderBack(nil)
        lastLifecycle = "ready"
        snapshot()
    }
}

let root = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL
let environment = ProcessInfo.processInfo.environment
guard environment["OMNIFLOW_GUI_FIXTURE_CHILD"] == "1",
      environment["OMNIFLOW_GUI_FIXTURE_TOKEN"]?.isEmpty == false,
      Bundle.main.bundleIdentifier == "com.omniflow.menu-qa",
      root.path.hasPrefix("/tmp/omniflow-menu-qa-") || root.path.hasPrefix("/private/tmp/omniflow-menu-qa-"),
      getppid() > 1, isatty(STDIN_FILENO) == 0 else {
    fputs("Native menu fixture requires its temporary bundle and the safe GUI supervisor.\n", stderr)
    exit(1)
}
let application = NSApplication.shared
let delegate = MenuFixtureDelegate(root: root)
application.delegate = delegate
application.setActivationPolicy(.accessory)
withExtendedLifetime(delegate) { application.run() }
