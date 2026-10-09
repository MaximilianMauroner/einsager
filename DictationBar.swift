import AppKit

final class DictationPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class WaveformView: NSView {
    var levels: [CGFloat] = Array(repeating: 0, count: 9) { didSet { needsDisplay = true } }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill()
        for (index, level) in levels.enumerated() {
            let height = max(3, min(24, level * 24))
            let x = bounds.midX + CGFloat(index - 4) * 6 - 1.5
            NSBezierPath(roundedRect: NSRect(x: x, y: bounds.midY - height / 2,
                                            width: 3, height: height), xRadius: 1.5, yRadius: 1.5).fill()
        }
    }
}

final class BarIconView: NSImageView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// A nonactivating native surface. Only recording levels cause repeated redraws.
final class DictationBar: NSObject {
    enum Display: Equatable {
        case idle
        case requesting(String)
        case recording(handsFree: Bool)
        case processing
        case message(String)
        case failure(String)
    }

    let panel: DictationPanel
    let surface: BarSurface
    private let defaults: UserDefaults
    private var edge: DockEdge
    private var screen: NSScreen?
    private var mouseMonitor: Any?
    private var observers: [NSObjectProtocol] = []
    private var isRunning = false

    var showAtAllTimes: Bool {
        didSet {
            defaults.set(showAtAllTimes, forKey: "dictationBarShowAtAllTimes")
            updateVisibility()
            onVisibilityChange?(showAtAllTimes)
        }
    }

    var onStart: (() -> Void)?
    var onStop: (() -> Void)?
    var onCancel: (() -> Void)?
    var onRetry: (() -> Void)?
    var onCopy: (() -> Void)?
    var onCustomizeShortcuts: (() -> Void)?
    var onEnableKeyboard: (() -> Void)?
    var onVisibilityChange: ((Bool) -> Void)?

    init(icon: NSImage, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        showAtAllTimes = defaults.object(forKey: "dictationBarShowAtAllTimes") as? Bool ?? true
        edge = DockEdge(rawValue: defaults.string(forKey: "dictationBarEdge") ?? "") ?? .bottom
        panel = DictationPanel(contentRect: NSRect(x: 0, y: 0, width: 72, height: 30),
                               styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        surface = BarSurface(icon: icon)
        super.init()
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = surface
        panel.title = "einsager dictation"
        surface.onStart = { [weak self] in self?.onStart?() }
        surface.onStop = { [weak self] in self?.onStop?() }
        surface.onCancel = { [weak self] in self?.onCancel?() }
        surface.onRetry = { [weak self] in self?.onRetry?() }
        surface.onCopy = { [weak self] in self?.onCopy?() }
        surface.onHover = { [weak self] in self?.resize() }
        surface.onDrag = { [weak self] point, finished in self?.drag(to: point, finished: finished) }
        surface.contextMenu = { [weak self] in self?.makeMenu() }
    }

    func show() {
        guard !isRunning else { return }
        isRunning = true
        screen = cursorScreen()
        resize()
        updateVisibility()
        mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved) { [weak self] _ in
            guard let self = self, !self.surface.isDragging else { return }
            let current = self.cursorScreen()
            if current != self.screen { self.screen = current; self.resize() }
        }
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in
                self?.screen = self?.cursorScreen()
                self?.resize()
            })
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil, queue: .main) { [weak self] _ in self?.resize(); self?.updateVisibility() })
    }

    func render(_ display: Display) {
        surface.display = display
        resize()
        updateVisibility()
    }

    private func updateVisibility() {
        guard isRunning else { return }
        if showAtAllTimes || surface.display != .idle { panel.orderFrontRegardless() }
        else {
            // A hidden panel never receives mouseExited, so drop the hover state here.
            surface.endHover()
            panel.orderOut(nil)
        }
    }

    func updateLevel(_ level: CGFloat, elapsed: TimeInterval, limit: TimeInterval) {
        surface.waveform.levels.removeFirst()
        surface.waveform.levels.append(level)
        surface.timer.stringValue = String(format: "%d:%02d", Int(elapsed) / 60, Int(elapsed) % 60)
        surface.timer.textColor = elapsed >= limit - 60 ? .systemOrange : .white
        surface.timer.toolTip = "Recording ends at \(Int(limit) / 60) minutes"
    }

    private func resize() {
        let size = surface.preferredSize
        let visible = (screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1024, height: 768)
        panel.setFrame(BarPlacement.frame(size: size, visible: visible, edge: edge), display: true)
        surface.frame = NSRect(origin: .zero, size: panel.frame.size)
        surface.needsLayout = true
    }

    private func cursorScreen() -> NSScreen? {
        NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
    }

    private func drag(to origin: CGPoint, finished: Bool) {
        screen = cursorScreen()
        guard let visible = screen?.visibleFrame else { return }
        let frame = NSRect(origin: origin, size: panel.frame.size)
        panel.setFrame(BarPlacement.clamp(frame, to: visible), display: true)
        if finished {
            edge = BarPlacement.nearestEdge(to: CGPoint(x: panel.frame.midX, y: panel.frame.midY), visible: visible)
            defaults.set(edge.rawValue, forKey: "dictationBarEdge")
            resize()
        }
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        for (title, edge) in [("Dock at bottom", DockEdge.bottom), ("Dock at left", .left), ("Dock at right", .right)] {
            let item = menu.addItem(withTitle: title, action: #selector(dock(_:)), keyEquivalent: "")
            item.representedObject = edge.rawValue
            item.target = self
            item.state = self.edge == edge ? .on : .off
        }
        menu.addItem(.separator())
        let visibility = menu.addItem(withTitle: "Show bar at all times", action: #selector(toggleVisibility), keyEquivalent: "")
        visibility.target = self
        visibility.state = showAtAllTimes ? .on : .off
        let customize = menu.addItem(withTitle: "Customize shortcuts…", action: #selector(customizeShortcuts), keyEquivalent: "")
        customize.target = self
        let keyboard = menu.addItem(withTitle: surface.keyboardEnabled ? "Keyboard shortcuts enabled" : "Enable hold-to-talk…",
                                    action: #selector(enableKeyboard), keyEquivalent: "")
        keyboard.target = self
        keyboard.isEnabled = !surface.keyboardEnabled
        menu.autoenablesItems = false
        return menu
    }

    @objc private func dock(_ item: NSMenuItem) {
        guard let value = item.representedObject as? String, let edge = DockEdge(rawValue: value) else { return }
        self.edge = edge
        defaults.set(edge.rawValue, forKey: "dictationBarEdge")
        resize()
    }

    @objc private func customizeShortcuts() { onCustomizeShortcuts?() }
    @objc private func enableKeyboard() { onEnableKeyboard?() }
    @objc private func toggleVisibility() { showAtAllTimes.toggle() }

    func close() {
        isRunning = false
        if let mouseMonitor = mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
        mouseMonitor = nil
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observers.removeAll()
        panel.orderOut(nil)
    }
}

final class BarSurface: NSView {
    var display: DictationBar.Display = .idle { didSet { configure() } }
    private(set) var hovered = false
    private(set) var isDragging = false
    let waveform = WaveformView()
    let timer = NSTextField(labelWithString: "0:00")
    private let iconView = BarIconView()
    private let label = NSTextField(wrappingLabelWithString: "")
    private let cancelButton = NSButton()
    private let stopButton = NSButton()
    private let retryButton = NSButton(title: "Retry", target: nil, action: nil)
    private let copyButton = NSButton(title: "Copy last", target: nil, action: nil)
    private var tracking: NSTrackingArea?
    private var dragStart: CGPoint?
    private var originalOrigin = CGPoint.zero
    var onStart: (() -> Void)?
    var onStop: (() -> Void)?
    var onCancel: (() -> Void)?
    var onRetry: (() -> Void)?
    var onCopy: (() -> Void)?
    var onHover: (() -> Void)?
    var onDrag: ((CGPoint, Bool) -> Void)?
    var contextMenu: (() -> NSMenu?)?
    var holdHint = "Fn" { didSet { configure() } }
    var handsFreeHint = "Fn+Space" { didSet { configure() } }
    var keyboardEnabled = false { didSet { if oldValue != keyboardEnabled { configure() } } }
    var canRetry = false { didSet { retryButton.isEnabled = canRetry } }
    var canCopy = false { didSet { copyButton.isEnabled = canCopy } }

    var preferredSize: CGSize {
        switch display {
        case .idle: return CGSize(width: hovered ? 136 : 72, height: hovered ? 38 : 30)
        case .requesting: return CGSize(width: 216, height: 44)
        case .recording: return CGSize(width: 216, height: 44)
        case .processing: return CGSize(width: 180, height: 44)
        case .message: return CGSize(width: 300, height: 64)
        case .failure: return CGSize(width: 360, height: 88)
        }
    }

    init(icon: NSImage) {
        super.init(frame: NSRect(x: 0, y: 0, width: 72, height: 30))
        appearance = NSAppearance(named: .darkAqua)
        iconView.image = icon
        iconView.contentTintColor = .white
        addSubview(iconView)
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = .white
        label.alignment = .center
        label.maximumNumberOfLines = 2
        timer.font = .monospacedDigitSystemFont(ofSize: 11, weight: .medium)
        timer.textColor = .white
        timer.alignment = .center
        for button in [cancelButton, stopButton, retryButton, copyButton] {
            button.target = self
            button.isBordered = false
            button.font = .systemFont(ofSize: 12, weight: .semibold)
            button.contentTintColor = .white
            addSubview(button)
        }
        cancelButton.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Cancel dictation")
        cancelButton.toolTip = "Cancel · Esc"
        cancelButton.setAccessibilityLabel("Cancel dictation")
        cancelButton.action = #selector(cancel)
        stopButton.image = NSImage(systemSymbolName: "stop.fill", accessibilityDescription: "Stop and transcribe")
        stopButton.toolTip = "Stop and transcribe · ⌃⌥Space"
        stopButton.setAccessibilityLabel("Stop and transcribe")
        stopButton.action = #selector(stop)
        retryButton.action = #selector(retry)
        copyButton.action = #selector(copyTranscript)
        for view in [label, timer, waveform] { addSubview(view) }
        configure()
    }

    required init?(coder: NSCoder) { nil }
    override var acceptsFirstResponder: Bool { false }

    private func configure() {
        for view in subviews { view.isHidden = true }
        toolTip = nil
        stopButton.toolTip = "Stop and transcribe · " + handsFreeHint
        switch display {
        case .idle:
            iconView.isHidden = false
            label.stringValue = keyboardEnabled ? holdHint + " to talk" : "Click to talk"
            label.isHidden = !hovered
            toolTip = keyboardEnabled
                ? "Hold " + holdHint + " to talk. Click or press " + handsFreeHint + " for hands-free. Drag to dock."
                : "Click for hands-free. Enable keyboard access from the right-click menu for hold-to-talk. Drag to dock."
            setAccessibilityRole(.button)
            setAccessibilityLabel("Start hands-free dictation")
        case .requesting(let text):
            label.stringValue = text
            label.isHidden = false
            cancelButton.isHidden = false
        case .recording(let handsFree):
            waveform.isHidden = false
            timer.isHidden = false
            cancelButton.isHidden = false
            stopButton.isHidden = false
            toolTip = handsFree ? "Hands-free recording. Stop to insert text; Escape cancels." : "Recording while " + holdHint + " is held. Release to insert text."
        case .processing:
            label.stringValue = "Transcribing…"
            label.isHidden = false
            cancelButton.isHidden = false
        case .message(let text):
            label.stringValue = text
            label.isHidden = false
            copyButton.isHidden = false
        case .failure(let text):
            label.stringValue = text
            label.isHidden = false
            cancelButton.isHidden = false
            retryButton.isHidden = false
        }
        if display != .idle {
            setAccessibilityRole(.group)
            setAccessibilityLabel(label.isHidden ? (toolTip ?? "Recording") : label.stringValue)
        }
        setAccessibilityElement(true)
        if !label.isHidden { label.toolTip = label.stringValue }
        needsLayout = true
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        let midY = bounds.midY
        iconView.frame = NSRect(x: hovered ? 13 : (bounds.width - 18) / 2, y: midY - 9, width: 18, height: 18)
        cancelButton.frame = NSRect(x: 8, y: midY - 14, width: 28, height: 28)
        stopButton.frame = NSRect(x: bounds.width - 36, y: midY - 14, width: 28, height: 28)
        waveform.frame = NSRect(x: 38, y: midY - 14, width: 82, height: 28)
        timer.frame = NSRect(x: 126, y: midY - 8, width: 44, height: 16)
        switch display {
        case .idle: label.frame = NSRect(x: 38, y: midY - 9, width: bounds.width - 48, height: 18)
        case .failure:
            label.frame = NSRect(x: 38, y: 40, width: bounds.width - 54, height: 36)
            cancelButton.frame.origin.y = 44
            retryButton.frame = NSRect(x: bounds.midX - 35, y: 8, width: 70, height: 26)
        case .message:
            label.frame = NSRect(x: 16, y: 30, width: bounds.width - 32, height: 28)
            copyButton.frame = NSRect(x: bounds.midX - 45, y: 4, width: 90, height: 22)
        default: label.frame = NSRect(x: 40, y: midY - 10, width: bounds.width - 50, height: 20)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let radius: CGFloat = bounds.height > 50 ? 18 : bounds.height / 2
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: radius, yRadius: radius)
        NSColor(calibratedWhite: hovered ? 0.13 : 0.09, alpha: 1).setFill()
        shape.fill()
        NSColor(calibratedWhite: 0.27, alpha: 1).setStroke()
        shape.lineWidth = 1
        shape.stroke()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking = tracking { removeTrackingArea(tracking) }
        tracking = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        if let tracking = tracking { addTrackingArea(tracking) }
    }

    override func mouseEntered(with event: NSEvent) { hovered = true; configure(); onHover?() }
    override func mouseExited(with event: NSEvent) { endHover() }

    func endHover() {
        guard hovered else { return }
        hovered = false
        configure()
        onHover?()
    }
    override func mouseDown(with event: NSEvent) {
        dragStart = NSEvent.mouseLocation
        originalOrigin = window?.frame.origin ?? .zero
        isDragging = false
    }
    override func mouseDragged(with event: NSEvent) {
        guard let start = dragStart else { return }
        let point = NSEvent.mouseLocation
        let delta = CGPoint(x: point.x - start.x, y: point.y - start.y)
        if hypot(delta.x, delta.y) > 4 { isDragging = true }
        if isDragging { onDrag?(CGPoint(x: originalOrigin.x + delta.x, y: originalOrigin.y + delta.y), false) }
    }
    override func mouseUp(with event: NSEvent) {
        if isDragging { onDrag?(window?.frame.origin ?? originalOrigin, true) }
        else if display == .idle { onStart?() }
        dragStart = nil
        isDragging = false
    }
    override func rightMouseDown(with event: NSEvent) {
        guard let menu = contextMenu?() else { return }
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }
    override func accessibilityPerformPress() -> Bool {
        guard display == .idle else { return false }
        onStart?()
        return true
    }
    @objc private func cancel() { onCancel?() }
    @objc private func stop() { onStop?() }
    @objc private func retry() { onRetry?() }
    @objc private func copyTranscript() { onCopy?() }
}
