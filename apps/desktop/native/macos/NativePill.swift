import AppKit

final class PillPanel: NSPanel {
    override var canBecomeKey: Bool { false }
}

private final class PillCircle: ActionButton {
    var finish = false
    override func draw(_ dirtyRect: NSRect) {
        (finish ? NativeStyle.color(0xfcfcfb) : NativeStyle.color(0x71716e)).setFill()
        NSBezierPath(ovalIn: bounds).fill()
        let path = NSBezierPath(); path.lineWidth = 1.5; path.lineCapStyle = .round; path.lineJoinStyle = .round
        if finish {
            path.move(to: NSPoint(x: 13, y: 6)); path.line(to: NSPoint(x: 7.5, y: 11.5)); path.line(to: NSPoint(x: 5, y: 9))
        } else {
            path.move(to: NSPoint(x: 12, y: 6)); path.line(to: NSPoint(x: 6, y: 12))
            path.move(to: NSPoint(x: 6, y: 6)); path.line(to: NSPoint(x: 12, y: 12))
        }
        (finish ? NativeStyle.color(0x1a1a1a) : NativeStyle.color(0xfcfcfb)).setStroke(); path.stroke()
    }
}

/// The style.css surface. Draws only for state, pointer, or audio changes, with no idle timer.
final class NativePill: FlippedView {
    let session: NativeSession
    var onDock: (String) -> Void = { _ in }
    var onMenu: (NSEvent) -> Void = { _ in }
    var idleHint = "Click or hold Fn to dictate"
    private let cancel = PillCircle("Cancel dictation", action: {})
    private let finish = PillCircle("Finish dictation", action: {})
    private let messageAction = ActionButton("Retry", action: {})
    private var hovered = false
    private var dragStart: NSPoint?
    private var dragOrigin = NSPoint.zero
    private var moved = false
    private var floor = -80.0
    private var peak = -62.0
    private var levels = [Double](repeating: 0, count: 10)
    private var tracking: NSTrackingArea?
    private var seconds = 0.0
    private var pill = NSRect.zero
    private var bubble = NSRect.zero
    private var label = ""
    private var labelHeight: CGFloat = 18
    private var labelWidth: CGFloat = 0
    private var collapsed: Bool { [.idle, .message].contains(session.phase) && !hovered }
    private var circles: Bool { [.requesting, .recording, .failure].contains(session.phase) && !(session.phase == .recording && session.holding == true) }
    private var pillWidth: CGFloat { collapsed ? 40 : circles ? (session.phase == .recording ? 96.5 : 84.5) : 72.5 }

    init(session: NativeSession) {
        self.session = session
        super.init(frame: .zero)
        setAccessibilityElement(true); setAccessibilityRole(.button)
        cancel.run = { [weak session] in session?.act("cancel") }
        finish.finish = true; finish.run = { [weak session] in session?.act("finish") }
        messageAction.tint = NativeStyle.accent; messageAction.weight = .semibold; messageAction.textSize = 14
        messageAction.run = { [weak session] in session?.act(session?.phase == .failure ? "retry" : "copy") }
        addSubview(cancel); addSubview(finish); addSubview(messageAction)
    }
    required init?(coder: NSCoder) { nil }

    func refresh() {
        if session.phase != .recording { levels = [Double](repeating: 0, count: 10); floor = -80; peak = -62; seconds = 0 }
        switch session.phase {
        case .message, .failure, .requesting: label = session.message
        case .idle: label = hovered ? idleHint : ""
        case .recording: label = seconds >= 540 ? "Recording stops in \(max(0, Int(ceil(600 - seconds))))s" : ""
        default: label = ""
        }
        messageAction.isHidden = !(session.phase == .failure || (session.phase == .message && !session.delivery.lastText.isEmpty))
        messageAction.title = session.phase == .failure ? "Retry" : "Copy last"
        messageAction.isEnabled = session.phase != .failure || session.retryable
        let actionWidth = messageAction.isHidden ? 0 : messageAction.contentWidth + 10
        let textWidth = ceil((label as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 14)]).width)
        labelWidth = min(360, textWidth + 32 + actionWidth)
        labelHeight = NativeStyle.height(label, width: max(1, labelWidth - 32 - actionWidth), size: 14, lineHeight: 18 / 14)
        let bubbleHeight = label.isEmpty ? 0 : max(34, labelHeight + 16)
        let pillHeight: CGFloat = collapsed ? 8 : 28
        let size = NSSize(width: ceil(max(pillWidth, label.isEmpty ? 0 : labelWidth)), height: ceil(pillHeight + (bubbleHeight > 0 ? bubbleHeight + 6 : 0)))
        window?.setContentSize(size)
        let edge = session.store.edge
        let x: CGFloat = edge == "left" ? 0 : edge == "right" ? size.width - pillWidth : (size.width - pillWidth) / 2
        pill = NSRect(x: x, y: edge == "top" ? 0 : size.height - pillHeight, width: pillWidth, height: pillHeight)
        let bubbleX: CGFloat = edge == "left" ? 0 : edge == "right" ? size.width - labelWidth : (size.width - labelWidth) / 2
        bubble = NSRect(x: bubbleX, y: edge == "top" ? pillHeight + 6 : 0, width: labelWidth, height: bubbleHeight)
        cancel.isHidden = !circles; finish.isHidden = !(circles && session.phase == .recording)
        cancel.frame = NSRect(x: pill.minX + 6, y: pill.minY + 5, width: 18, height: 18)
        finish.frame = NSRect(x: pill.maxX - 24, y: pill.minY + 5, width: 18, height: 18)
        messageAction.frame = NSRect(x: bubble.maxX - 16 - max(0, actionWidth - 10), y: bubble.midY - 10, width: max(0, actionWidth - 10), height: 20)
        place()
        #if !NATIVE_TESTS
        if session.store.showPill || session.phase != .idle { window?.orderFrontRegardless() }
        else { window?.orderOut(nil) }
        #endif
        setAccessibilityRole([.idle, .message].contains(session.phase) ? .button : .group)
        setAccessibilityLabel(session.phase == .idle ? "Start hands-free dictation" : label.isEmpty ? session.phase.rawValue : label)
        toolTip = "Click to dictate. Drag to dock. Right-click for options."
        needsDisplay = true
    }

    func place() {
        guard let window, let screen = window.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        var frame = window.frame
        switch session.store.edge {
        case "top": frame.origin = NSPoint(x: area.midX - frame.width / 2, y: area.maxY - frame.height - 12)
        case "left": frame.origin = NSPoint(x: area.minX + 12, y: area.midY - 14)
        case "right": frame.origin = NSPoint(x: area.maxX - frame.width - 12, y: area.midY - 14)
        default: frame.origin = NSPoint(x: area.midX - frame.width / 2, y: area.minY + 12)
        }
        frame.origin.x = max(area.minX, min(frame.origin.x, area.maxX - frame.width))
        frame.origin.y = max(area.minY, min(frame.origin.y, area.maxY - frame.height))
        window.setFrame(frame, display: false)
    }

    func level(_ power: Double, seconds: Double) {
        let hadCountdown = self.seconds >= 540
        self.seconds = seconds
        floor = power < floor ? power : floor + (power - floor) * 0.01
        peak = power > peak ? power : peak + (power - peak) * 0.03
        let value = min(1, max(0, (power - floor) / max(18, peak - floor)))
        levels.removeFirst(); levels.append(value)
        if hadCountdown || seconds >= 540 { refresh() } else { needsDisplay = true }
    }

    override func updateTrackingAreas() {
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: pill, options: [.mouseEnteredAndExited, .activeAlways], owner: self)
        tracking = area; addTrackingArea(area); super.updateTrackingAreas()
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; refresh() }
    override func mouseExited(with event: NSEvent) { hovered = false; refresh() }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func rightMouseDown(with event: NSEvent) { onMenu(event) }
    override func mouseDown(with event: NSEvent) {
        guard pill.contains(convert(event.locationInWindow, from: nil)), let window else { return }
        dragStart = window.convertPoint(toScreen: event.locationInWindow); dragOrigin = window.frame.origin; moved = false
    }
    override func mouseDragged(with event: NSEvent) {
        guard let start = dragStart, let window else { return }
        let point = window.convertPoint(toScreen: event.locationInWindow)
        let dx = point.x - start.x, dy = point.y - start.y
        if hypot(dx, dy) > 4 { moved = true }
        if moved { window.setFrameOrigin(NSPoint(x: dragOrigin.x + dx, y: dragOrigin.y + dy)) }
    }
    override func mouseUp(with event: NSEvent) {
        guard dragStart != nil else { return }; dragStart = nil
        if moved {
            guard let window, let screen = window.screen else { return }
            let point = NSPoint(x: window.frame.midX, y: window.frame.midY), area = screen.visibleFrame
            let distances: [(String, CGFloat)] = [("left", abs(point.x - area.minX)), ("right", abs(point.x - area.maxX)), ("bottom", abs(point.y - area.minY)), ("top", abs(point.y - area.maxY))]
            onDock(distances.min { $0.1 < $1.1 }?.0 ?? "bottom")
        } else if pill.contains(convert(event.locationInWindow, from: nil)), [.idle, .message].contains(session.phase) { session.act("toggle") }
    }
    override func accessibilityPerformPress() -> Bool {
        guard [.idle, .message].contains(session.phase) else { return false }; session.act("toggle"); return true
    }

    override func draw(_ dirtyRect: NSRect) {
        NativeStyle.rounded(pill, radius: pill.height / 2, fill: NativeStyle.color(0x1a1a1a, alpha: collapsed ? 0.6 : 1),
            stroke: collapsed ? NSColor.white.withAlphaComponent(0.55) : NativeStyle.edge)
        if !collapsed {
            let start = circles ? pill.minX + 28 : pill.midX - 20.25
            if session.phase == .processing {
                NativeStyle.lilac.setFill()
                for index in 0..<3 { NSBezierPath(ovalIn: NSRect(x: pill.midX - 7.5 + CGFloat(index) * 6, y: pill.midY - 1.5, width: 3, height: 3)).fill() }
            } else {
                NativeStyle.ink.setFill()
                for (index, value) in levels.enumerated() {
                    let height = 2.25 + (session.phase == .recording ? value : 0) * 13.75
                    NSBezierPath(roundedRect: NSRect(x: start + CGFloat(index) * 4.25, y: pill.midY - height / 2, width: 2.25, height: height), xRadius: 2, yRadius: 2).fill()
                }
            }
        }
        guard !label.isEmpty else { return }
        NativeStyle.rounded(bubble, radius: 20, fill: .black)
        let right = messageAction.isHidden ? bubble.maxX - 16 : messageAction.frame.minX - 10
        let attributes = NativeStyle.attributes(14, color: .white, lineHeight: 18 / 14, alignment: .center)
        (label as NSString).draw(in: NSRect(x: bubble.minX + 16, y: bubble.midY - labelHeight / 2, width: right - bubble.minX - 16, height: labelHeight), withAttributes: attributes)
    }
}
