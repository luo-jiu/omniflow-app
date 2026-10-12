import AppKit

// Disposable native controls for manual/Agent acceptance. No persistence, file
// access, AX client, Agent connection or synthetic input lives in this process.
final class QAApplicationDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 1000, height: 600))
        let window = NSWindow(contentRect: content.bounds, styleMask: [.titled, .closable, .miniaturizable],
                              backing: .buffered, defer: false)
        window.title = "Omniflow Computer QA"
        window.isReleasedWhenClosed = false
        window.contentView = content
        window.center()
        self.window = window

        addLabel("Omniflow Computer QA", frame: NSRect(x: 24, y: 548, width: 950, height: 28),
                 font: .boldSystemFont(ofSize: 22), to: content)
        addLabel("临时 AppKit 测试内容 · 关闭即丢弃 · 不连接 Agent 或用户文件", frame: NSRect(x: 24, y: 512, width: 950, height: 24),
                 font: .systemFont(ofSize: 14), to: content)

        addLabel("QA 文本输入区（可替换 / 插入）", frame: NSRect(x: 24, y: 468, width: 420, height: 24),
                 font: .boldSystemFont(ofSize: 16), to: content)
        let inputScroll = NSScrollView(frame: NSRect(x: 24, y: 110, width: 420, height: 348))
        inputScroll.borderType = .bezelBorder
        inputScroll.hasVerticalScroller = false
        inputScroll.hasHorizontalScroller = false
        let input = NSTextView(frame: NSRect(x: 0, y: 0, width: 416, height: 344))
        input.isRichText = false
        input.isEditable = true
        input.isSelectable = true
        input.font = .monospacedSystemFont(ofSize: 16, weight: .regular)
        input.textContainerInset = NSSize(width: 12, height: 12)
        input.isHorizontallyResizable = false
        input.isVerticallyResizable = true
        input.autoresizingMask = [.width]
        input.textContainer?.widthTracksTextView = true
        input.setAccessibilityTitle("QA 文本输入区")
        input.setAccessibilityLabel("QA 文本输入区")
        input.setAccessibilityIdentifier("omniflow-qa-editable-text")
        input.string = "QA 初始文本\n中文和 emoji 😀\n这里仅包含可丢弃的测试字符串。"
        input.setSelectedRange(NSRange(location: 0, length: 0))
        inputScroll.documentView = input
        content.addSubview(inputScroll)

        addLabel("QA 长文滚动区域", frame: NSRect(x: 470, y: 468, width: 504, height: 24),
                 font: .boldSystemFont(ofSize: 16), to: content)
        let scroll = NSScrollView(frame: NSRect(x: 470, y: 110, width: 506, height: 348))
        scroll.borderType = .bezelBorder
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = false
        scroll.scrollerStyle = .legacy
        scroll.lineScroll = 24
        scroll.pageScroll = 24
        scroll.setAccessibilityTitle("QA 长文滚动区域")
        scroll.setAccessibilityLabel("QA 长文滚动区域")
        scroll.setAccessibilityIdentifier("omniflow-qa-scroll-area")
        let document = NSTextView(frame: NSRect(x: 0, y: 0, width: 1800, height: 5000))
        document.isEditable = false
        document.isSelectable = true
        document.isRichText = false
        document.font = .monospacedSystemFont(ofSize: 16, weight: .regular)
        document.textContainerInset = NSSize(width: 12, height: 12)
        document.isHorizontallyResizable = true
        document.isVerticallyResizable = true
        document.minSize = NSSize(width: 1800, height: 5000)
        document.maxSize = NSSize(width: 1800, height: 5000)
        document.textContainer?.containerSize = NSSize(width: 1776, height: 5000)
        document.textContainer?.widthTracksTextView = false
        document.setAccessibilityTitle("QA 长文内容")
        document.setAccessibilityLabel("QA 长文内容")
        document.setAccessibilityIdentifier("omniflow-qa-scroll-document")
        document.string = (1...160).map { line in
            let marker = String(format: "QA 行 %03d", line)
            return marker + " | 左端 LEFT | " + String(repeating: "测试列 Column ", count: 13) + " | 右端 RIGHT"
        }.joined(separator: "\n")
        scroll.documentView = document
        scroll.verticalScroller?.setAccessibilityTitle("QA 垂直滚动条")
        scroll.verticalScroller?.setAccessibilityLabel("QA 垂直滚动条")
        scroll.verticalScroller?.setAccessibilityIdentifier("omniflow-qa-scroll-vertical")
        scroll.horizontalScroller?.setAccessibilityTitle("QA 水平滚动条")
        scroll.horizontalScroller?.setAccessibilityLabel("QA 水平滚动条")
        scroll.horizontalScroller?.setAccessibilityIdentifier("omniflow-qa-scroll-horizontal")
        content.addSubview(scroll)
        scroll.contentView.scroll(to: .zero)
        scroll.reflectScrolledClipView(scroll.contentView)

        addLabel("输入结果：核对左侧真实文本；滚动结果：核对右侧行号和 LEFT / RIGHT 位置。", frame: NSRect(x: 24, y: 62, width: 950, height: 24),
                 font: .systemFont(ofSize: 14), to: content)
        addLabel("动作由标准 NSTextView / NSScrollView / NSScroller 处理，未添加虚假的 AX 成功回执。", frame: NSRect(x: 24, y: 30, width: 950, height: 24),
                 font: .systemFont(ofSize: 13), to: content)
        buildMenu()
        window.makeKeyAndOrderFront(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func addLabel(_ text: String, frame: NSRect, font: NSFont, to view: NSView) {
        let label = NSTextField(labelWithString: text)
        label.frame = frame
        label.font = font
        label.lineBreakMode = .byTruncatingTail
        view.addSubview(label)
    }

    private func buildMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Omniflow Computer QA")
        appMenu.addItem(withTitle: "退出 QA", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApplication.shared.mainMenu = menu
    }
}

let app = NSApplication.shared
let delegate = QAApplicationDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
