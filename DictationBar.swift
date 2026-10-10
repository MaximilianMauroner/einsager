import AppKit

final class DictationPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(srgbRed: CGFloat(hex >> 16 & 0xFF) / 255, green: CGFloat(hex >> 8 & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}

/// The Wispr Flow bar's look. Pill geometry and colors follow Wispr's published Flow bar SVG;
/// the rest handle, label, and processing dots follow the saved screenshot references.
enum BarStyle {
    static let pillHeight: CGFloat = 28
    static let pillFill = NSColor(hex: 0x1A1A1A)
    static let pillBorder = NSColor(hex: 0x4D4A42)
    static let handleSize = CGSize(width: 40, height: 8)
    static let handleFill = NSColor(hex: 0x1A1A1A, alpha: 0.6)
    static let handleBorder = NSColor(white: 1, alpha: 0.55)
    static let inset: CGFloat = 6
    static let circle: CGFloat = 18
    static let cancelFill = NSColor(hex: 0x71716E)
    static let finishFill = NSColor(hex: 0xFCFCFB)
    static let glyph = NSColor(hex: 0xFCFCFB)
    static let ink = NSColor(hex: 0xFFFFEB)
    static let waveBars = 10
    static let waveBarWidth: CGFloat = 2.25
    static let wavePitch: CGFloat = 4.25
    static let waveMaxHeight: CGFloat = 16
    static let wavePadding: CGFloat = 15
    static let processingDot: CGFloat = 3
    static let processingGap: CGFloat = 10
    static let processingPitch: CGFloat = 6
    static let processingFill = NSColor(hex: 0xE8E6F5)
    static let labelHeight: CGFloat = 34
    static let labelPadding: CGFloat = 16
    static let labelGap: CGFloat = 6
    static let labelFill = NSColor.black
    static let labelText = NSColor.white
    static let labelFont = NSFont.systemFont(ofSize: 14)
    static let accent = NSColor(hex: 0xF29BE6)
    static let maxLabelWidth: CGFloat = 360

    static var waveWidth: CGFloat { CGFloat(waveBars - 1) * wavePitch + waveBarWidth }
}

/// Recent microphone levels, newest on the right. Silence draws a row of dots.
final class WaveformView: NSView {
    var levels: [CGFloat] = Array(repeating: 0, count: BarStyle.waveBars) { didSet { needsDisplay = true } }

    func reset() { levels = Array(repeating: 0, count: BarStyle.waveBars) }

    override func draw(_ dirtyRect: NSRect) {
        BarStyle.ink.setFill()
        let width = BarStyle.waveBarWidth
        for (index, level) in levels.enumerated() {
            let height = width + min(max(level, 0), 1) * (BarStyle.waveMaxHeight - width)
            NSBezierPath(roundedRect: NSRect(x: CGFloat(index) * BarStyle.wavePitch, y: bounds.midY - height / 2,
                                             width: width, height: height), xRadius: width / 2, yRadius: width / 2).fill()
        }
    }
}

/// An 18 pt circle with a stroked cancel or finish glyph.
final class CircleButton: NSButton {
    enum Glyph { case cancel, finish }
    private let glyph: Glyph

    init(_ glyph: Glyph, label: String) {
        self.glyph = glyph
        super.init(frame: .zero)
        isBordered = false
        title = ""
        setAccessibilityLabel(label)
    }

    required init?(coder: NSCoder) { nil }

    override func draw(_ dirtyRect: NSRect) {
        let fill = glyph == .cancel ? BarStyle.cancelFill : BarStyle.finishFill
        (isHighlighted ? fill.blended(withFraction: 0.2, of: .black) ?? fill : fill).setFill()
        NSBezierPath(ovalIn: bounds).fill()
        // Glyph points come from Wispr's 18 pt SVG circles; buttons are flipped, so y grows downward as in SVG.
        let path = NSBezierPath()
        let point = { (x: CGFloat, y: CGFloat) in CGPoint(x: self.bounds.minX + x, y: self.bounds.minY + y) }
        switch glyph {
        case .cancel:
            path.move(to: point(12, 6))
            path.line(to: point(6, 12))
            path.move(to: point(6, 6))
            path.line(to: point(12, 12))
            BarStyle.glyph.setStroke()
        case .finish:
            path.move(to: point(13, 6))
            path.line(to: point(7.5, 11.5))
            path.line(to: point(5, 9))
            BarStyle.pillFill.setStroke()
        }
        path.lineWidth = 1.5
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.stroke()
    }
}

/// A text action inside the label capsule, such as Copy last or Retry.
final class LabelButton: NSButton {
    init(_ title: String) {
        super.init(frame: .zero)
        isBordered = false
        attributedTitle = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: BarStyle.accent])
    }

    required init?(coder: NSCoder) { nil }

    var width: CGFloat { attributedTitle.size().width.rounded(.up) + 4 }
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

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        showAtAllTimes = defaults.object(forKey: "dictationBarShowAtAllTimes") as? Bool ?? true
        edge = DockEdge(rawValue: defaults.string(forKey: "dictationBarEdge") ?? "") ?? .bottom
        panel = DictationPanel(contentRect: NSRect(origin: .zero, size: BarStyle.handleSize),
                               styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        surface = BarSurface()
        super.init()
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = surface
        panel.title = "einsager dictation"
        surface.edge = edge
        surface.onStart = { [weak self] in self?.onStart?() }
        surface.onStop = { [weak self] in self?.onStop?() }
        surface.onCancel = { [weak self] in self?.onCancel?() }
        surface.onRetry = { [weak self] in self?.onRetry?() }
        surface.onCopy = { [weak self] in self?.onCopy?() }
        surface.onResize = { [weak self] in self?.resize() }
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
        let remaining = Int((limit - elapsed).rounded(.up))
        surface.secondsLeft = remaining <= 60 ? max(remaining, 0) : nil
    }

    private func resize() {
        let size = surface.preferredSize
        let visible = (screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1024, height: 768)
        panel.setFrame(BarPlacement.frame(size: size, visible: visible, edge: edge, pillHeight: surface.pillHeight), display: true)
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
            setEdge(BarPlacement.nearestEdge(to: CGPoint(x: panel.frame.midX, y: panel.frame.midY), visible: visible))
        }
    }

    private func setEdge(_ edge: DockEdge) {
        self.edge = edge
        defaults.set(edge.rawValue, forKey: "dictationBarEdge")
        surface.edge = edge
        resize()
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        for (title, edge) in [("Dock at bottom", DockEdge.bottom), ("Dock at top", .top), ("Dock at left", .left), ("Dock at right", .right)] {
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
        setEdge(edge)
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

/// Draws the pill and, when there is something to say, a label capsule beside it toward the screen center.
final class BarSurface: NSView {
    private enum Pill { case handle, dots, waveform, handsFree, processing, cancellable }

    var display: DictationBar.Display = .idle { didSet { configure() } }
    var edge: DockEdge = .bottom { didSet { needsLayout = true; needsDisplay = true } }
    private var labelBelow: Bool { edge == .top }
    /// Seconds before the recording limit, shown in the last minute only.
    var secondsLeft: Int? { didSet { if oldValue != secondsLeft { configure(); onResize?() } } }
    private(set) var hovered = false
    private(set) var isDragging = false
    let waveform = WaveformView()
    private let label = NSTextField(wrappingLabelWithString: "")
    private let cancelButton = CircleButton(.cancel, label: "Cancel dictation")
    private let finishButton = CircleButton(.finish, label: "Finish and insert text")
    private let retryButton = LabelButton("Retry")
    private let copyButton = LabelButton("Copy last")
    private var pill = Pill.handle
    private var action: LabelButton?
    private var tracking: NSTrackingArea?
    private var dragStart: CGPoint?
    private var originalOrigin = CGPoint.zero
    var onStart: (() -> Void)?
    var onStop: (() -> Void)?
    var onCancel: (() -> Void)?
    var onRetry: (() -> Void)?
    var onCopy: (() -> Void)?
    var onResize: (() -> Void)?
    var onDrag: ((CGPoint, Bool) -> Void)?
    var contextMenu: (() -> NSMenu?)?
    var holdHint = "Fn" { didSet { configure() } }
    var handsFreeHint = "Fn+Space" { didSet { configure() } }
    var keyboardEnabled = false { didSet { if oldValue != keyboardEnabled { configure() } } }
    var canRetry = false { didSet { retryButton.isEnabled = canRetry; retryButton.alphaValue = canRetry ? 1 : 0.4 } }
    var canCopy = false { didSet { if oldValue != canCopy { configure() } } }

    private var pillSize: CGSize {
        let height = BarStyle.pillHeight
        let wave = BarStyle.wavePadding * 2 + BarStyle.waveWidth
        let circleSlot = BarStyle.inset + BarStyle.circle + 4
        switch pill {
        case .handle: return BarStyle.handleSize
        case .dots, .waveform: return CGSize(width: wave, height: height)
        case .processing:
            return CGSize(width: wave + BarStyle.processingGap + BarStyle.processingPitch * 2 + BarStyle.processingDot,
                          height: height)
        case .cancellable: return CGSize(width: circleSlot + BarStyle.waveWidth + BarStyle.wavePadding, height: height)
        case .handsFree: return CGSize(width: circleSlot * 2 + BarStyle.waveWidth, height: height)
        }
    }

    private var hasLabel: Bool { !label.isHidden }
    var pillHeight: CGFloat { pillSize.height }

    private var labelSize: CGSize {
        guard hasLabel else { return .zero }
        let actionWidth = action.map { $0.width + 10 } ?? 0
        // The cell's own size includes its text padding, so one-line labels do not wrap.
        let natural = label.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: 10_000, height: 200)).width ?? 0
        let textWidth = min(natural.rounded(.up), BarStyle.maxLabelWidth - BarStyle.labelPadding * 2 - actionWidth)
        let textHeight = label.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: textWidth, height: 200)).height ?? 18
        return CGSize(width: BarStyle.labelPadding * 2 + textWidth + actionWidth,
                      height: max(BarStyle.labelHeight, textHeight.rounded(.up) + 16))
    }

    var preferredSize: CGSize {
        let label = labelSize
        let pill = pillSize
        guard hasLabel else { return pill }
        return CGSize(width: max(pill.width, label.width), height: pill.height + BarStyle.labelGap + label.height)
    }

    private var pillRect: NSRect {
        let size = pillSize
        let y = labelBelow ? bounds.maxY - size.height : 0
        return NSRect(x: horizontalOrigin(for: size.width), y: y, width: size.width, height: size.height)
    }

    private var labelRect: NSRect {
        let size = labelSize
        let y = labelBelow ? 0 : bounds.maxY - size.height
        return NSRect(x: horizontalOrigin(for: size.width), y: y, width: size.width, height: size.height)
    }

    private func horizontalOrigin(for width: CGFloat) -> CGFloat {
        switch edge {
        case .left: return bounds.minX
        case .right: return bounds.maxX - width
        case .bottom, .top: return bounds.midX - width / 2
        }
    }

    init() {
        super.init(frame: NSRect(origin: .zero, size: BarStyle.handleSize))
        appearance = NSAppearance(named: .darkAqua)
        label.maximumNumberOfLines = 3
        for button in [cancelButton, finishButton, retryButton, copyButton] {
            button.target = self
        }
        cancelButton.toolTip = "Cancel · Esc"
        cancelButton.action = #selector(cancel)
        finishButton.action = #selector(stop)
        retryButton.action = #selector(retry)
        copyButton.action = #selector(copyTranscript)
        for view in [waveform, label, cancelButton, finishButton, retryButton, copyButton] { addSubview(view) }
        configure()
    }

    required init?(coder: NSCoder) { nil }
    override var acceptsFirstResponder: Bool { false }

    private func setLabel(_ text: String, accent: String? = nil, action: LabelButton? = nil) {
        let centered = NSMutableParagraphStyle()
        centered.alignment = .center
        let body: [NSAttributedString.Key: Any] = [.font: BarStyle.labelFont, .foregroundColor: BarStyle.labelText,
                                                   .paragraphStyle: centered]
        let string = NSMutableAttributedString(string: text, attributes: body)
        if let accent = accent, let range = text.range(of: accent) {
            string.addAttributes([.foregroundColor: BarStyle.accent,
                                  .font: NSFont.systemFont(ofSize: 14, weight: .semibold)], range: NSRange(range, in: text))
        }
        label.attributedStringValue = string
        label.isHidden = false
        self.action = action
        action?.isHidden = false
    }

    private func configure() {
        for view in subviews { view.isHidden = true }
        action = nil
        toolTip = nil
        finishButton.toolTip = "Finish and insert text · " + handsFreeHint
        switch display {
        case .idle:
            pill = hovered ? .dots : .handle
            if hovered {
                waveform.reset()
                waveform.isHidden = false
                if keyboardEnabled { setLabel("Click or hold " + holdHint + " to start dictating", accent: holdHint) }
                else { setLabel("Click to start dictating") }
            }
            toolTip = keyboardEnabled
                ? "Hold " + holdHint + " to talk. Click or press " + handsFreeHint + " for hands-free. Drag to dock."
                : "Click for hands-free. Enable keyboard access from the right-click menu for hold-to-talk. Drag to dock."
            setAccessibilityRole(.button)
            setAccessibilityLabel("Start hands-free dictation")
        case .requesting(let text):
            pill = .cancellable
            waveform.reset()
            waveform.isHidden = false
            cancelButton.isHidden = false
            setLabel(text)
        case .recording(let handsFree):
            pill = handsFree ? .handsFree : .waveform
            waveform.isHidden = false
            cancelButton.isHidden = !handsFree
            finishButton.isHidden = !handsFree
            if let seconds = secondsLeft { setLabel(String(format: "Recording stops in %d:%02d", seconds / 60, seconds % 60)) }
            toolTip = handsFree ? "Hands-free recording. Finish to insert text; Escape cancels." : "Recording while " + holdHint + " is held. Release to insert text."
        case .processing:
            pill = .processing
            waveform.reset()
            waveform.isHidden = false
            toolTip = "Transcribing. Escape cancels."
        case .message(let text):
            pill = .handle
            setLabel(text, action: canCopy ? copyButton : nil)
        case .failure(let text):
            pill = .cancellable
            waveform.reset()
            waveform.isHidden = false
            cancelButton.isHidden = false
            setLabel(text, action: retryButton)
        }
        if display != .idle {
            setAccessibilityRole(.group)
            setAccessibilityLabel(hasLabel ? label.stringValue : (toolTip ?? "Recording"))
        }
        setAccessibilityElement(true)
        needsLayout = true
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        let pill = pillRect
        let midY = pill.midY
        let circle = BarStyle.circle
        cancelButton.frame = NSRect(x: pill.minX + BarStyle.inset, y: midY - circle / 2, width: circle, height: circle)
        finishButton.frame = NSRect(x: pill.maxX - BarStyle.inset - circle, y: midY - circle / 2, width: circle, height: circle)
        let waveX: CGFloat
        switch self.pill {
        case .handsFree, .cancellable: waveX = cancelButton.frame.maxX + 4
        default: waveX = pill.minX + BarStyle.wavePadding
        }
        waveform.frame = NSRect(x: waveX, y: midY - BarStyle.waveMaxHeight / 2, width: BarStyle.waveWidth,
                                height: BarStyle.waveMaxHeight)
        guard hasLabel else { return }
        let box = labelRect
        var textRect = box.insetBy(dx: BarStyle.labelPadding, dy: 0)
        if let action = action {
            action.frame = NSRect(x: textRect.maxX - action.width, y: box.midY - 10, width: action.width, height: 20)
            textRect.size.width -= action.width + 10
        }
        let textHeight = label.cell?.cellSize(forBounds: NSRect(origin: .zero, size: CGSize(width: textRect.width, height: 200))).height ?? 18
        label.frame = NSRect(x: textRect.minX, y: box.midY - textHeight / 2, width: textRect.width, height: textHeight)
    }

    override func draw(_ dirtyRect: NSRect) {
        let pill = pillRect
        let radius = pill.height / 2
        let shape = NSBezierPath(roundedRect: pill.insetBy(dx: 0.5, dy: 0.5), xRadius: radius - 0.5, yRadius: radius - 0.5)
        (self.pill == .handle ? BarStyle.handleFill : BarStyle.pillFill).setFill()
        shape.fill()
        (self.pill == .handle ? BarStyle.handleBorder : BarStyle.pillBorder).setStroke()
        shape.lineWidth = 1
        shape.stroke()
        if self.pill == .processing {
            BarStyle.processingFill.setFill()
            let size = BarStyle.processingDot
            for index in 0..<3 {
                let x = waveform.frame.maxX + BarStyle.processingGap + CGFloat(index) * BarStyle.processingPitch
                NSBezierPath(ovalIn: NSRect(x: x, y: pill.midY - size / 2, width: size, height: size)).fill()
            }
        }
        if hasLabel {
            let box = labelRect
            let corner = min(box.height / 2, 17)
            BarStyle.labelFill.setFill()
            NSBezierPath(roundedRect: box, xRadius: corner, yRadius: corner).fill()
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking = tracking { removeTrackingArea(tracking) }
        tracking = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        if let tracking = tracking { addTrackingArea(tracking) }
    }

    override func mouseEntered(with event: NSEvent) { hovered = true; configure(); onResize?() }
    override func mouseExited(with event: NSEvent) { endHover() }

    func endHover() {
        guard hovered else { return }
        hovered = false
        configure()
        onResize?()
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
        else if display == .idle, pillRect.contains(convert(event.locationInWindow, from: nil)) { onStart?() }
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
