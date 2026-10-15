import AppKit

/// The same TextKit 1 configuration measures paragraphs and renders selectable transcripts.
final class NativeTextLayout {
    let storage = NSTextStorage()
    let manager = NSLayoutManager()
    let container = NSTextContainer(size: NSSize(width: 252, height: CGFloat.greatestFiniteMagnitude))
    init() { container.lineFragmentPadding = 0; manager.addTextContainer(container); storage.addLayoutManager(manager) }
    func height(_ text: String, width: CGFloat, attributes: [NSAttributedString.Key: Any], line: CGFloat) -> CGFloat {
        container.size.width = max(1, width)
        storage.setAttributedString(NSAttributedString(string: text, attributes: attributes))
        manager.ensureLayout(for: container)
        var lines = 0
        manager.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: manager.numberOfGlyphs)) { _, _, _, _, _ in lines += 1 }
        return CGFloat(lines) * line
    }
}

/// The existing panel.css/style.css design, expressed with AppKit drawing instead of system control chrome.
enum NativeStyle {
    private static let measurement = NativeTextLayout()
    static func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
    }
    static let background = color(0x131312)
    static let raised = color(0x1a1a19)
    static let well = color(0x1e1d1b)
    static let base = color(0x0f0f0e)
    static let line = color(0x2f2d29)
    static let edge = color(0x4d4a42)
    static let ink = color(0xffffeb)
    static let secondary = color(0xffffeb, alpha: 0.66)
    static let muted = color(0xffffeb, alpha: 0.5)
    static let accent = color(0xf29be6)
    static let lilac = color(0xe8e6f5)
    static let alarm = color(0xf0a3a3)

    static func attributes(_ size: CGFloat = 13, weight: NSFont.Weight = .regular, color: NSColor = ink,
                           lineHeight: CGFloat = 1.38, alignment: NSTextAlignment = .left) -> [NSAttributedString.Key: Any] {
        let font = NSFont.systemFont(ofSize: size, weight: weight)
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = size * lineHeight
        paragraph.maximumLineHeight = size * lineHeight
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byWordWrapping
        return [.font: font, .foregroundColor: color, .paragraphStyle: paragraph,
            .baselineOffset: (size * lineHeight - font.ascender + font.descender) / 2]
    }

    static func text(_ text: String, in rect: NSRect, size: CGFloat = 13, weight: NSFont.Weight = .regular,
                     color: NSColor = ink, lineHeight: CGFloat = 1.38, alignment: NSTextAlignment = .left) {
        NSGraphicsContext.current?.cgContext.setShouldSmoothFonts(false)
        (text as NSString).draw(in: rect, withAttributes: attributes(size, weight: weight, color: color, lineHeight: lineHeight, alignment: alignment))
    }

    static func height(_ text: String, width: CGFloat, size: CGFloat = 13.5, lineHeight: CGFloat = 1.42) -> CGFloat {
        measurement.height(text, width: width, attributes: attributes(size, lineHeight: lineHeight), line: size * lineHeight)
    }

    static func rounded(_ rect: NSRect, radius: CGFloat, fill: NSColor, stroke: NSColor? = nil) {
        let path = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: radius, yRadius: radius)
        fill.setFill(); path.fill()
        if let stroke { stroke.setStroke(); path.lineWidth = 1; path.stroke() }
    }

    static func rule(_ y: CGFloat, width: CGFloat) {
        line.setStroke()
        let path = NSBezierPath(); path.move(to: NSPoint(x: 0, y: y - 0.5)); path.line(to: NSPoint(x: width, y: y - 0.5)); path.stroke()
    }

    static func keys(_ shortcut: String) -> [String] {
        var remainder = shortcut
        var result: [String] = []
        while let first = remainder.first, "⌃⌥⇧⌘".contains(first) {
            result.append(String(remainder.removeFirst()))
        }
        if remainder.hasPrefix("Fn") {
            result.append("Fn"); remainder.removeFirst(2)
            if remainder.hasPrefix("+") { remainder.removeFirst() }
        }
        if result.isEmpty { return shortcut.components(separatedBy: "+") }
        if !remainder.isEmpty { result.append(remainder) }
        return result
    }

    static func keyWidth(_ key: String) -> CGFloat {
        ceil((key as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 10.5)]).width) + 12
    }

    static func keysWidth(_ shortcut: String) -> CGFloat { keys(shortcut).reduce(0) { $0 + keyWidth($1) + 3 } - 3 }

    static func drawKeys(_ shortcut: String, at origin: NSPoint) {
        var x = origin.x
        for key in keys(shortcut) {
            let width = keyWidth(key)
            rounded(NSRect(x: x, y: origin.y, width: width, height: 19.5), radius: 4, fill: .clear, stroke: edge)
            edge.setFill(); NSRect(x: x + 2, y: origin.y + 17.5, width: width - 4, height: 1).fill()
            text(key, in: NSRect(x: x + 6, y: origin.y + 3, width: width - 12, height: 15), size: 10.5, color: secondary, lineHeight: 1)
            x += width + 3
        }
    }
}

enum NativeIcon: CaseIterable {
    case logo, copy, check, trash, search, sliders, back, right, retry, cancel, down

    private static let paths: [NativeIcon: NSBezierPath] = Dictionary(uniqueKeysWithValues: allCases.map { ($0, $0.makePath()) })

    func draw(in rect: NSRect, color: NSColor = NativeStyle.secondary) {
        guard let path = Self.paths[self] else { return }
        NSGraphicsContext.saveGraphicsState()
        let transform = NSAffineTransform()
        transform.translateX(by: rect.minX, yBy: rect.minY)
        transform.scaleX(by: rect.width / 16, yBy: rect.height / 16)
        transform.concat()
        color.setStroke(); path.stroke()
        NSGraphicsContext.restoreGraphicsState()
    }

    private func makePath() -> NSBezierPath {
        let p = NSBezierPath(); p.lineWidth = self == .logo ? 1.75 : 1.5; p.lineCapStyle = .round; p.lineJoinStyle = .round
        func move(_ x: CGFloat, _ y: CGFloat) { p.move(to: NSPoint(x: x, y: y)) }
        func line(_ x: CGFloat, _ y: CGFloat) { p.line(to: NSPoint(x: x, y: y)) }
        switch self {
        case .logo:
            move(3.33, 8); line(12, 8)
            p.curve(to: NSPoint(x: 7.67, y: 3.33), controlPoint1: NSPoint(x: 12, y: 5.33), controlPoint2: NSPoint(x: 10.2, y: 3.33))
            p.curve(to: NSPoint(x: 3.33, y: 8), controlPoint1: NSPoint(x: 5.13, y: 3.33), controlPoint2: NSPoint(x: 3.33, y: 5.33))
            p.curve(to: NSPoint(x: 7.67, y: 12.67), controlPoint1: NSPoint(x: 3.33, y: 10.67), controlPoint2: NSPoint(x: 5.13, y: 12.67))
            p.curve(to: NSPoint(x: 11.8, y: 11.47), controlPoint1: NSPoint(x: 9.67, y: 12.67), controlPoint2: NSPoint(x: 10.47, y: 11.47))
            p.curve(to: NSPoint(x: 13.67, y: 12.4), controlPoint1: NSPoint(x: 12.53, y: 11.47), controlPoint2: NSPoint(x: 13.13, y: 11.87))
        case .copy:
            p.appendRoundedRect(NSRect(x: 5.25, y: 5.25, width: 7.5, height: 7.5), xRadius: 1.5, yRadius: 1.5)
            move(3.25, 10.25); line(3.25, 4.75)
            p.curve(to: NSPoint(x: 4.75, y: 3.25), controlPoint1: NSPoint(x: 3.25, y: 3.92), controlPoint2: NSPoint(x: 3.92, y: 3.25)); line(10.25, 3.25)
        case .check: move(3.5, 8.5); line(6.5, 11.5); line(12.5, 5)
        case .trash: move(3, 4.5); line(13, 4.5); move(6.5, 4.5); line(6.5, 3); line(9.5, 3); line(9.5, 4.5); move(4.6, 4.5); line(5.2, 13); line(10.8, 13); line(11.4, 4.5)
        case .search: p.appendOval(in: NSRect(x: 2.75, y: 2.75, width: 8.5, height: 8.5)); move(10.2, 10.2); line(13, 13)
        case .sliders:
            move(3, 5); line(8.5, 5); move(11.5, 5); line(13, 5); move(3, 11); line(4.5, 11); move(7.5, 11); line(13, 11)
            p.appendOval(in: NSRect(x: 8.5, y: 3.5, width: 3, height: 3)); p.appendOval(in: NSRect(x: 4.5, y: 9.5, width: 3, height: 3))
        case .back: move(10, 3.5); line(5.5, 8); line(10, 12.5)
        case .right: move(6.5, 4); line(10.5, 8); line(6.5, 12)
        case .retry:
            p.appendArc(withCenter: NSPoint(x: 8, y: 8), radius: 4.5, startAngle: 180, endAngle: 225, clockwise: true)
            move(3.5, 3); line(3.5, 5.5); line(6, 5.5)
        case .cancel: move(5, 5); line(11, 11); move(11, 5); line(5, 11)
        case .down: move(4.5, 6.5); line(8, 10); line(11.5, 6.5)
        }
        return p
    }
}

/// Small semantic controls avoid the system's SwiftUI-backed button renderer and keep the existing design.
class ActionButton: NSControl {
    var title: String { didSet { setAccessibilityLabel(title); invalidateIntrinsicContentSize(); needsDisplay = true } }
    var run: () -> Void
    var icon: NativeIcon?
    var tint = NativeStyle.secondary
    var weight = NSFont.Weight.regular
    var textSize: CGFloat = 12.5
    var keyCaps = false
    var iconOnly = false
    var concealed = false { didSet { needsDisplay = true } }
    var hovered = false
    private var pressed = false
    private var tracking: NSTrackingArea?
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { isEnabled }
    override var canBecomeKeyView: Bool { isEnabled && !isHidden }
    override var isEnabled: Bool { didSet { needsDisplay = true; setAccessibilityEnabled(isEnabled) } }
    var focused: Bool { window?.firstResponder === self }
    var contentWidth: CGFloat { keyCaps ? NativeStyle.keysWidth(title) + 8 : (icon == nil ? 0 : 21) + ceil((title as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: textSize, weight: weight)]).width) }
    override var intrinsicContentSize: NSSize { NSSize(width: iconOnly ? 28 : contentWidth, height: keyCaps ? 24 : iconOnly ? 28 : 19) }

    init(_ title: String, icon: NativeIcon? = nil, action: @escaping () -> Void) {
        self.title = title; self.icon = icon; run = action
        super.init(frame: .zero)
        focusRingType = .none
        setAccessibilityElement(true); setAccessibilityRole(.button); setAccessibilityLabel(title)
    }
    required init?(coder: NSCoder) { nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func becomeFirstResponder() -> Bool { needsDisplay = true; superview?.needsDisplay = true; return true }
    override func resignFirstResponder() -> Bool { needsDisplay = true; superview?.needsDisplay = true; return true }
    override func updateTrackingAreas() {
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        tracking = area; addTrackingArea(area); super.updateTrackingAreas()
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true }
    override func mouseDown(with event: NSEvent) { guard isEnabled else { return }; pressed = true; needsDisplay = true }
    override func mouseDragged(with event: NSEvent) { pressed = bounds.contains(convert(event.locationInWindow, from: nil)); needsDisplay = true }
    override func mouseUp(with event: NSEvent) {
        let activate = pressed && bounds.contains(convert(event.locationInWindow, from: nil))
        pressed = false; needsDisplay = true
        if activate { invoke() }
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 49 || event.keyCode == 36 { invoke() } else { super.keyDown(with: event) }
    }
    func invoke() { guard isEnabled else { return }; run(); if let action { _ = sendAction(action, to: target) } }
    override func accessibilityPerformPress() -> Bool { guard isEnabled else { return false }; invoke(); return true }
    override func draw(_ dirtyRect: NSRect) {
        guard !concealed || focused else { return }
        NSGraphicsContext.saveGraphicsState()
        if !isEnabled { NSGraphicsContext.current?.cgContext.setAlpha(0.4) }
        if (hovered || pressed) && (iconOnly || keyCaps) { NativeStyle.rounded(bounds, radius: 7, fill: NativeStyle.well) }
        if keyCaps { NativeStyle.drawKeys(title, at: NSPoint(x: 4, y: (bounds.height - 19) / 2)) }
        else if iconOnly { icon?.draw(in: bounds.insetBy(dx: 6, dy: 6), color: hovered ? NativeStyle.ink : tint) }
        else {
            let y = (bounds.height - 18) / 2
            if let icon { icon.draw(in: NSRect(x: 0, y: y + 1, width: 16, height: 16), color: tint) }
            NativeStyle.text(title, in: NSRect(x: icon == nil ? 0 : 21, y: y, width: bounds.width - (icon == nil ? 0 : 21), height: 20), size: textSize, weight: weight, color: tint)
        }
        if focused { NativeStyle.accent.setStroke(); let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 6, yRadius: 6); path.lineWidth = 2; path.stroke() }
        NSGraphicsContext.restoreGraphicsState()
    }
}

final class ToggleSwitch: ActionButton {
    var on: Bool { didSet { setAccessibilityValue(on ? 1 : 0); needsDisplay = true } }
    init(_ title: String, on: Bool, action: @escaping () -> Void) {
        self.on = on; super.init(title, action: action)
        setAccessibilityRole(.checkBox); setAccessibilitySubrole(NSAccessibility.Subrole(rawValue: "AXSwitch")); setAccessibilityValue(on ? 1 : 0)
    }
    required init?(coder: NSCoder) { nil }
    override var intrinsicContentSize: NSSize { NSSize(width: 30, height: 18) }
    override func draw(_ dirtyRect: NSRect) {
        NativeStyle.rounded(bounds, radius: 9, fill: on ? NativeStyle.accent : NativeStyle.color(0x3a3833))
        (on ? NativeStyle.color(0x141414) : NativeStyle.secondary).setFill()
        NSBezierPath(ovalIn: NSRect(x: on ? 14 : 2, y: 2, width: 14, height: 14)).fill()
        if focused { NativeStyle.accent.setStroke(); let p = NSBezierPath(roundedRect: bounds.insetBy(dx: -2, dy: -2), xRadius: 10, yRadius: 10); p.lineWidth = 2; p.stroke() }
    }
}

final class RadioOption: ActionButton {
    let detail: String
    var selected: Bool { didSet { setAccessibilityValue(selected ? 1 : 0); needsDisplay = true } }
    init(_ title: String, detail: String, selected: Bool, action: @escaping () -> Void) {
        self.detail = detail; self.selected = selected; super.init(title, action: action)
        setAccessibilityRole(.radioButton); setAccessibilityValue(selected ? 1 : 0)
    }
    required init?(coder: NSCoder) { nil }
    override var canBecomeKeyView: Bool { isEnabled && selected }
    override func keyDown(with event: NSEvent) {
        guard [123, 124, 125, 126].contains(event.keyCode), let parent = superview else { super.keyDown(with: event); return }
        let radios = parent.subviews.compactMap { $0 as? RadioOption }
        guard let index = radios.firstIndex(where: { $0 === self }), !radios.isEmpty else { return }
        let delta = [123, 126].contains(event.keyCode) ? -1 : 1
        let next = radios[(index + delta + radios.count) % radios.count]
        window?.makeFirstResponder(next); next.invoke()
    }
    override func draw(_ dirtyRect: NSRect) {
        let inset: CGFloat = selected ? 2 : 0.75
        let radio = NSBezierPath(ovalIn: NSRect(x: inset, y: 8 + inset, width: 14 - 2 * inset, height: 14 - 2 * inset))
        (selected ? NativeStyle.accent : NativeStyle.edge).setStroke(); radio.lineWidth = selected ? 4 : 1.5; radio.stroke()
        NativeStyle.text(title, in: NSRect(x: 26, y: 7, width: bounds.width - 26, height: 18), weight: .semibold)
        NativeStyle.text(detail, in: NSRect(x: 26, y: 27, width: bounds.width - 26, height: bounds.height - 27), size: 11.5, color: NativeStyle.muted)
        if focused { NativeStyle.accent.setStroke(); NSBezierPath(roundedRect: bounds.insetBy(dx: -2, dy: 0), xRadius: 6, yRadius: 6).stroke() }
    }
}

final class StylePopup: ActionButton {
    var options: [(String, String)]
    var selected: String
    var onSelect: (String) -> Void
    init(_ title: String, options: [(String, String)], selected: String, onSelect: @escaping (String) -> Void) {
        self.options = options; self.selected = selected; self.onSelect = onSelect
        super.init(title, action: {})
        setAccessibilityRole(.popUpButton); setAccessibilityValue(selectedTitle)
    }
    required init?(coder: NSCoder) { nil }
    var selectedTitle: String { options.first { $0.0 == selected }?.1 ?? "Not connected, uses default" }
    override var intrinsicContentSize: NSSize { NSSize(width: min(200, ceil((selectedTitle as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 12.5)]).width) + 26), height: 26) }
    override func invoke() {
        guard isEnabled else { return }
        let menu = NSMenu(); menu.autoenablesItems = false
        for (value, name) in options {
            let item = ActionMenuItem(name) { [weak self] in
                guard let self else { return }; self.selected = value; self.setAccessibilityValue(self.selectedTitle)
                self.onSelect(value); self.needsDisplay = true
            }
            item.state = value == selected ? .on : .off; menu.addItem(item)
        }
        menu.popUp(positioning: menu.items.first { $0.state == .on }, at: NSPoint(x: 0, y: bounds.maxY), in: self)
    }
    override func draw(_ dirtyRect: NSRect) {
        NSGraphicsContext.current?.cgContext.setShouldSmoothFonts(false)
        if hovered { NativeStyle.rounded(bounds, radius: 6, fill: NativeStyle.well) }
        let string = NSMutableAttributedString(string: selectedTitle, attributes: NativeStyle.attributes(12.5, color: NativeStyle.secondary))
        let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
        string.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: string.length))
        string.draw(in: NSRect(x: 6, y: 4, width: bounds.width - 26, height: 18))
        NativeIcon.down.draw(in: NSRect(x: bounds.width - 18, y: 5, width: 16, height: 16))
        if focused { NativeStyle.accent.setStroke(); NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 6, yRadius: 6).stroke() }
    }
}

class FlippedView: NSView { override var isFlipped: Bool { true } }
