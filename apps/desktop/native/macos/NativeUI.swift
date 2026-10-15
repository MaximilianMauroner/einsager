import AppKit

final class ActionMenuItem: NSMenuItem {
    private let run: () -> Void
    init(_ title: String, action: @escaping () -> Void) {
        run = action; super.init(title: title, action: #selector(invoke), keyEquivalent: ""); target = self
    }
    required init(coder: NSCoder) { fatalError("Use init(title:action:)") }
    @objc private func invoke() { run() }
}

final class SettingsPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

private final class PanelRoot: FlippedView {
    var onLayout: () -> Void = {}
    override func layout() { super.layout(); onLayout() }
    override func draw(_ dirtyRect: NSRect) { NativeStyle.background.setFill(); bounds.fill() }
}

private final class PanelHeader: FlippedView {
    var settings = false
    var phase = NativePhase.idle
    override func draw(_ dirtyRect: NSRect) {
        NativeStyle.rule(bounds.height, width: bounds.width)
        guard !settings else { return }
        NativeIcon.logo.draw(in: NSRect(x: 16, y: 17, width: 18, height: 18), color: NativeStyle.ink)
        NativeStyle.text("einsager", in: NSRect(x: 42, y: 16, width: 85, height: 22), size: 14, weight: .semibold)
        let name: String
        switch phase { case .requesting: name = "Starting"; case .recording: name = "Recording"; case .processing: name = "Transcribing"; case .failure: name = "Failed"; default: return }
        let width = (name as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 12)]).width
        let x = bounds.width - 72 - width - 12
        (phase == .failure ? NativeStyle.alarm : phase == .processing ? NativeStyle.lilac : NativeStyle.accent).setFill()
        NSBezierPath(ovalIn: NSRect(x: x, y: 23, width: 6, height: 6)).fill()
        NativeStyle.text(name, in: NSRect(x: x + 12, y: 17, width: width + 1, height: 18), size: 12, color: NativeStyle.secondary)
    }
}

private final class CircleButton: ActionButton {
    var finish = false
    override func draw(_ dirtyRect: NSRect) {
        (finish ? NativeStyle.color(0xfcfcfb) : NativeStyle.color(0x71716e)).setFill()
        NSBezierPath(ovalIn: bounds).fill()
        (finish ? NativeIcon.check : NativeIcon.cancel).draw(in: bounds.insetBy(dx: 3, dy: 3), color: finish ? NativeStyle.raised : NativeStyle.color(0xfcfcfb))
        if focused { NativeStyle.accent.setStroke(); NSBezierPath(ovalIn: bounds.insetBy(dx: -2, dy: -2)).stroke() }
    }
}

private final class WaveButton: ActionButton {
    var processing = false
    var starting = false
    override func draw(_ dirtyRect: NSRect) {
        NativeStyle.rounded(bounds, radius: 18, fill: NativeStyle.raised, stroke: hovered ? NativeStyle.secondary : NativeStyle.edge)
        NativeStyle.ink.setFill()
        let waveX = bounds.midX - 20.25 + (processing ? -12.5 : starting ? 17 : 0)
        for index in 0..<10 { NSBezierPath(ovalIn: NSRect(x: waveX + CGFloat(index) * 4.25, y: 16.875, width: 2.25, height: 2.25)).fill() }
        if processing {
            NativeStyle.lilac.setFill()
            for index in 0..<3 { NSBezierPath(ovalIn: NSRect(x: bounds.midX + 17.75 + CGFloat(index) * 6, y: 16.5, width: 3, height: 3)).fill() }
        }
        if focused { NativeStyle.accent.setStroke(); let p = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 18, yRadius: 18); p.lineWidth = 2; p.stroke() }
    }
}

private final class PanelFooter: FlippedView {
    var hint = ""
    var shortcut: String?
    override func draw(_ dirtyRect: NSRect) {
        NativeStyle.base.setFill(); bounds.fill(); NativeStyle.rule(1, width: bounds.width)
        let textWidth = (hint as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 11.5)]).width
        let keysWidth = shortcut.map { NativeStyle.keysWidth($0) + 8 } ?? 0
        let x = (bounds.width - textWidth - keysWidth) / 2
        NativeStyle.text(hint, in: NSRect(x: x, y: 60, width: textWidth + 1, height: 19), size: 11.5, color: NativeStyle.muted)
        if let shortcut { NativeStyle.drawKeys(shortcut, at: NSPoint(x: x + textWidth + 8, y: 58)) }
    }
}

private final class SearchBar: FlippedView {
    let field = NSTextField()
    override init(frame: NSRect) {
        super.init(frame: frame)
        field.isBezeled = false; field.drawsBackground = false; field.focusRingType = .none
        field.font = .systemFont(ofSize: 13); field.textColor = NativeStyle.ink
        field.placeholderAttributedString = NSAttributedString(string: "Search transcripts", attributes: [.foregroundColor: NativeStyle.muted, .font: NSFont.systemFont(ofSize: 13)])
        field.setAccessibilityLabel("Search transcripts"); addSubview(field)
    }
    required init?(coder: NSCoder) { nil }
    override func layout() { super.layout(); field.frame = NSRect(x: 40, y: 10, width: bounds.width - 56, height: 20) }
    override func draw(_ dirtyRect: NSRect) {
        NativeIcon.search.draw(in: NSRect(x: 16, y: 12, width: 16, height: 16), color: NativeStyle.muted)
        NativeStyle.rule(bounds.height, width: bounds.width)
    }
}

private enum TapeRow {
    case day(String)
    case entry(NativeHistoryEntry, newest: Bool)
    case pending(String, NativePhase, Bool)
    case note(String, empty: Bool)
}

private final class TranscriptText: NSTextView {
    private let textLayout: NativeTextLayout
    init() {
        textLayout = NativeTextLayout(); textLayout.container.widthTracksTextView = true
        super.init(frame: .zero, textContainer: textLayout.container)
        isEditable = false; isSelectable = true; drawsBackground = false; textContainerInset = .zero
        isVerticallyResizable = false; isHorizontallyResizable = false; isRichText = false
        isContinuousSpellCheckingEnabled = false; isGrammarCheckingEnabled = false
        isAutomaticSpellingCorrectionEnabled = false; isAutomaticLinkDetectionEnabled = false
        isAutomaticDataDetectionEnabled = false; isAutomaticTextCompletionEnabled = false
        if #available(macOS 15.0, *) { writingToolsBehavior = .none }
        selectedTextAttributes = [.backgroundColor: NativeStyle.accent.withAlphaComponent(0.35), .foregroundColor: NativeStyle.ink]
        setAccessibilityRole(.staticText)
    }
    required init?(coder: NSCoder) { nil }
    override var canBecomeKeyView: Bool { false }
    override func draw(_ dirtyRect: NSRect) { NSGraphicsContext.current?.cgContext.setShouldSmoothFonts(false); super.draw(dirtyRect) }
}

private final class TapeCell: NSTableCellView {
    static let reuseIdentifier = NSUserInterfaceItemIdentifier("tape-row")
    let text = TranscriptText()
    let first = ActionButton("Copy", icon: .copy, action: {})
    let second = ActionButton("Delete", icon: .trash, action: {})
    private var row: TapeRow = .day("")
    private var bodyHeight: CGFloat = 0
    private var hovered = false
    private var tracking: NSTrackingArea?
    override var isFlipped: Bool { true }
    static let clock: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f }()

    override init(frame: NSRect) {
        super.init(frame: frame); identifier = Self.reuseIdentifier
        first.tint = NativeStyle.accent; first.weight = .semibold; second.tint = NativeStyle.muted; second.weight = .semibold
        addSubview(text); addSubview(first); addSubview(second)
    }
    required init?(coder: NSCoder) { nil }

    func configure(_ row: TapeRow, bodyHeight: CGFloat) {
        self.row = row; self.bodyHeight = bodyHeight; hovered = false
        text.isHidden = true; first.isHidden = true; second.isHidden = true
        first.icon = .copy; second.icon = .trash; first.title = "Copy"; second.title = "Delete"
        switch row {
        case .entry(let entry, let newest):
            text.isHidden = false; first.isHidden = false; second.isHidden = false
            text.textStorage?.setAttributedString(NSAttributedString(string: entry.text, attributes: NativeStyle.attributes(13.5, lineHeight: 1.42)))
            first.concealed = !newest && !hovered; second.concealed = !newest && !hovered
        case .pending(let message, let phase, let retryable):
            text.isHidden = false
            text.textStorage?.setAttributedString(NSAttributedString(string: message, attributes: NativeStyle.attributes(13.5, color: NativeStyle.secondary, lineHeight: 1.42)))
            first.title = "Retry"; first.icon = .retry; second.title = "Discard"
            first.isHidden = !retryable; second.isHidden = phase != .failure
            first.concealed = false; second.concealed = false
        default: break
        }
        needsLayout = true; needsDisplay = true
    }

    override func updateTrackingAreas() {
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        tracking = area; addTrackingArea(area); super.updateTrackingAreas()
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; updateActions() }
    override func mouseExited(with event: NSEvent) { hovered = false; updateActions() }
    private func updateActions() {
        if case .entry(_, let newest) = row { first.concealed = !newest && !hovered; second.concealed = !newest && !hovered }
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        text.frame = NSRect(x: 54, y: 7, width: bounds.width - 54, height: bodyHeight)
        var actionY = 7 + bodyHeight + 6
        switch row {
        case .entry(let entry, let newest):
            if !entry.voiceprint.isEmpty || entry.seconds > 0 { actionY += 21.18 }
            if !newest {
                first.frame = NSRect(x: bounds.width - 138, y: bounds.height - 24, width: 60, height: 19)
                second.frame = NSRect(x: bounds.width - 68, y: bounds.height - 24, width: 65, height: 19)
                return
            }
        default: break
        }
        first.frame = NSRect(x: 54, y: actionY, width: 61, height: 19)
        second.frame = NSRect(x: first.isHidden ? 54 : 129, y: actionY, width: 75, height: 19)
    }

    override func draw(_ dirtyRect: NSRect) {
        switch row {
        case .note(let message, let empty):
            if empty {
                let parts = message.components(separatedBy: "\n")
                NativeStyle.text(parts[0], in: NSRect(x: 8, y: 26, width: bounds.width - 16, height: 20), size: 14, alignment: .center)
                NativeStyle.text(parts.dropFirst().joined(separator: "\n"), in: NSRect(x: 8, y: 49, width: bounds.width - 16, height: 40), size: 12, color: NativeStyle.muted, alignment: .center)
            } else {
                NativeStyle.text(message, in: NSRect(x: 0, y: 8, width: bounds.width, height: bounds.height - 8), size: 11.5, color: NativeStyle.muted)
            }
        default:
            NativeStyle.line.setStroke(); let rail = NSBezierPath(); rail.move(to: NSPoint(x: 45.5, y: 0)); rail.line(to: NSPoint(x: 45.5, y: bounds.height)); rail.stroke()
            switch row {
            case .day(let day): NativeStyle.text(day, in: NSRect(x: 54, y: 10, width: bounds.width - 54, height: 17), size: 11.5, weight: .semibold, color: NativeStyle.muted)
            case .entry(let entry, let newest):
                dot(newest ? NativeStyle.accent : NativeStyle.background, stroke: newest ? NativeStyle.accent : NativeStyle.edge)
                NativeStyle.text(Self.clock.string(from: Date(timeIntervalSince1970: entry.at / 1000)), in: NSRect(x: 0, y: 9, width: 38, height: 17), size: 11.5, color: NativeStyle.muted, alignment: .right)
                let y = 7 + bodyHeight + 6
                var x: CGFloat = 54
                if !entry.voiceprint.isEmpty {
                    (newest ? NativeStyle.accent.withAlphaComponent(0.7) : NativeStyle.ink.withAlphaComponent(0.32)).setFill()
                    for level in entry.voiceprint {
                        let height = 2 + CGFloat(level) * 10
                        NSBezierPath(roundedRect: NSRect(x: x, y: y + (12 - height) / 2, width: 1.5, height: height), xRadius: 1, yRadius: 1).fill(); x += 3
                    }
                    x += 6.5
                }
                if entry.seconds > 0 {
                    let seconds = max(1, Int(entry.seconds.rounded()))
                    let length = seconds < 60 ? "\(seconds) s" : "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
                    NativeStyle.text(length, in: NSRect(x: x, y: y, width: 65, height: 17), size: 11, color: NativeStyle.muted)
                }
                if !newest && (hovered || first.focused || second.focused) {
                    NativeStyle.rounded(NSRect(x: bounds.width - 146, y: bounds.height - 27, width: 146, height: 25), radius: 8, fill: NativeStyle.well, stroke: NativeStyle.line)
                }
            case .pending(_, let phase, _):
                dot(phase == .failure ? NativeStyle.alarm : phase == .processing ? NativeStyle.lilac : NativeStyle.accent)
                NativeStyle.text("now", in: NSRect(x: 0, y: 9, width: 38, height: 17), size: 11.5, color: NativeStyle.muted, alignment: .right)
            default: break
            }
        }
    }
    private func dot(_ fill: NSColor, stroke: NSColor? = nil) { NativeStyle.rounded(NSRect(x: 43, y: 12, width: 5, height: 5), radius: 2.5, fill: fill, stroke: stroke) }
}

/// Model accessibility rows prevent AppKit from creating offscreen cells during a full tree query.
private final class TapeTable: NSTableView {
    var elements: [TapeRowElement] = []
    // AppKit otherwise prepares several screens of layer-backed rows while idle.
    override func prepareContent(in rect: NSRect) { super.prepareContent(in: visibleRect) }
    // The panel paints the background; the scrolling document needs no bitmap of its full height.
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() { super.updateLayer(); layer?.backgroundColor = NSColor.clear.cgColor }
    override func accessibilityChildren() -> [Any]? { elements }
    override func accessibilityRows() -> [NSAccessibilityRow]? { elements }
    override func accessibilityVisibleRows() -> [NSAccessibilityRow]? {
        let visible = rows(in: visibleRect)
        return elements.filter { NSLocationInRange($0.index, visible) }
    }
    override func accessibilityColumns() -> [Any]? { [] }
    override func accessibilityVisibleColumns() -> [Any]? { [] }
    override func accessibilitySelectedRows() -> [NSAccessibilityRow]? { [] }
    override func accessibilitySelectedCells() -> [Any]? { [] }
    override func accessibilityVisibleCells() -> [Any]? { [] }
    override func accessibilityColumnHeaderUIElements() -> [Any]? { [] }
    override func accessibilityRowCount() -> Int { elements.count }
    override func accessibilityColumnCount() -> Int { 1 }

    // Full hierarchy clients use these ranged methods instead of the modern getters.
    // AppKit's table implementation returns mock cells that construct offscreen views.
    private func accessibilityArray(_ attribute: NSAccessibility.Attribute) -> [Any]? {
        switch attribute {
        case .children, .rows: return elements
        case .visibleRows, .visibleChildren: return accessibilityVisibleRows() ?? []
        case .selectedRows, .selectedChildren, .selectedCells, .visibleCells,
             .columns, .visibleColumns, .selectedColumns, .columnHeaderUIElements: return []
        default: return nil
        }
    }
    override func accessibilityArrayAttributeCount(_ attribute: NSAccessibility.Attribute) -> Int {
        accessibilityArray(attribute)?.count ?? super.accessibilityArrayAttributeCount(attribute)
    }
    override func accessibilityArrayAttributeValues(_ attribute: NSAccessibility.Attribute, index: Int, maxCount: Int) -> [Any] {
        guard let values = accessibilityArray(attribute) else { return super.accessibilityArrayAttributeValues(attribute, index: index, maxCount: maxCount) }
        guard index >= 0, maxCount > 0 else { return [] }
        return Array(values.dropFirst(index).prefix(maxCount))
    }
    override func accessibilityIndex(ofChild child: Any) -> Int {
        guard let row = child as? TapeRowElement, row.table === self,
              elements.indices.contains(row.index), elements[row.index] === row else { return NSNotFound }
        return row.index
    }
}

private class TapeTextElement: NSAccessibilityElement {
    weak var row: TapeRowElement?
    override func accessibilityFrame() -> NSRect { row?.accessibilityFrame() ?? .zero }
}

private final class TapeActionElement: TapeTextElement {
    var run: () -> Void = {}
    override func accessibilityPerformPress() -> Bool { run(); return true }
}

private final class TapeRowElement: NSAccessibilityElement, NSAccessibilityRow {
    private let identity = UUID().uuidString
    weak var table: TapeTable?
    var index = 0
    let text = TapeTextElement()
    var actions: [TapeActionElement] = []
    override init() {
        super.init(); setAccessibilityRole(.row); setAccessibilityElement(true)
        text.row = self; text.setAccessibilityRole(.staticText); text.setAccessibilityElement(true); text.setAccessibilityParent(self)
        setAccessibilityCustomActions([NSAccessibilityCustomAction(name: "Show transcript", handler: { [weak self] in self?.reveal() ?? false })])
    }
    override func accessibilityIndex() -> Int { index }
    override func accessibilityIdentifier() -> String { "history-row-\(identity)" }
    override func accessibilityFrame() -> NSRect {
        guard let table, let window = table.window, index < table.numberOfRows else { return .zero }
        return window.convertToScreen(table.convert(table.rect(ofRow: index), to: nil))
    }
    override func setAccessibilityFocused(_ focused: Bool) {
        if focused { _ = reveal() }
        super.setAccessibilityFocused(focused)
    }
    @discardableResult func reveal() -> Bool {
        guard let table, index < table.numberOfRows else { return false }
        table.scrollRowToVisible(index); return true
    }
    override func accessibilityChildren() -> [Any]? {
        if let cell = table?.view(atColumn: 0, row: index, makeIfNecessary: false) as? TapeCell,
           !cell.visibleRect.isEmpty {
            let children: [NSView] = [cell.text, cell.first, cell.second].filter { !$0.isHidden }
            for child in children { child.setAccessibilityParent(self) }
            if !children.isEmpty { return children }
        }
        return [text] + actions
    }
    func configure(table: TapeTable, index: Int, label: String, value: String, actions: [(String, () -> Void)]) {
        self.table = table; self.index = index; setAccessibilityParent(table); setAccessibilityLabel(label)
        text.setAccessibilityValue(value)
        self.actions = actions.map { title, run in
            let action = TapeActionElement(); action.row = self; action.run = run
            action.setAccessibilityRole(.button); action.setAccessibilityElement(true); action.setAccessibilityLabel(title); action.setAccessibilityParent(self)
            return action
        }
    }
}

private final class FormRow: FlippedView {
    let label: String
    var control: NSView?
    var labelSize: CGFloat = 13
    var group = false
    init(_ label: String, control: NSView? = nil, group: Bool = false) {
        self.label = label; self.control = control; self.group = group; super.init(frame: .zero)
        if let control { addSubview(control) }
    }
    required init?(coder: NSCoder) { nil }
    override func layout() {
        super.layout()
        if let control {
            let size = control.intrinsicContentSize
            control.frame = NSRect(x: bounds.width - 16 - min(size.width, 210), y: group ? 10 : (bounds.height - size.height) / 2,
                width: min(size.width, 210), height: size.height)
        }
    }
    override func draw(_ dirtyRect: NSRect) {
        let right = control.map { $0.frame.minX - 12 } ?? bounds.width - 16
        let height = NativeStyle.height(label, width: right - 16, size: labelSize, lineHeight: 1.38)
        NativeStyle.text(label, in: NSRect(x: 16, y: group ? 12 : (bounds.height - height) / 2, width: right - 16, height: height + 1), size: labelSize)
        if !group { NativeStyle.rule(bounds.height, width: bounds.width) }
    }
}

private final class FormText: FlippedView {
    let text: String
    let size: CGFloat
    let color: NSColor
    init(_ text: String, size: CGFloat = 11.5, color: NSColor = NativeStyle.muted) {
        self.text = text; self.size = size; self.color = color; super.init(frame: .zero)
        setAccessibilityElement(true); setAccessibilityRole(.staticText); setAccessibilityLabel(text)
    }
    required init?(coder: NSCoder) { nil }
    override func draw(_ dirtyRect: NSRect) { NativeStyle.text(text, in: bounds.insetBy(dx: 16, dy: 8), size: size, color: color, lineHeight: 1.45) }
}

private final class FolderButton: ActionButton {
    override var intrinsicContentSize: NSSize { NSSize(width: 338, height: 42) }
    override func draw(_ dirtyRect: NSRect) {
        NSGraphicsContext.current?.cgContext.setShouldSmoothFonts(false)
        if hovered { NativeStyle.well.setFill(); bounds.fill() }
        let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
        (title as NSString).draw(in: NSRect(x: 16, y: 13, width: bounds.width - 60, height: 18), withAttributes: [
            .font: NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular), .foregroundColor: NativeStyle.secondary, .paragraphStyle: paragraph])
        NativeIcon.right.draw(in: NSRect(x: bounds.width - 32, y: 13, width: 16, height: 16))
        NativeStyle.rule(bounds.height, width: bounds.width)
        if focused { NativeStyle.accent.setStroke(); let p = NSBezierPath(rect: bounds.insetBy(dx: 1, dy: 1)); p.lineWidth = 2; p.stroke() }
    }
}

/// The same panel hierarchy and visual tokens as Panel.tsx. Session and service ownership remain outside the view.
final class NativeUI: NSObject, NSWindowDelegate, NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate {
    let session: NativeSession
    let keyboard: KeyboardMonitor
    let panel: SettingsPanel
    let pillPanel: PillPanel
    let pill: NativePill
    private var statusItem: NSStatusItem?
    private var root: PanelRoot?
    private var header: PanelHeader?
    private var footer: PanelFooter?
    private var startButton: WaveButton?
    private var cancelButton: CircleButton?
    private var finishButton: CircleButton?
    private var scroll: NSScrollView?
    private var table: NSTableView?
    private var search: SearchBar?
    private var settingsVisible = false
    private var searchVisible = false
    private var query = ""
    private var rows: [TapeRow] = []
    private var heights: [CGFloat] = []
    private var bodyHeights: [CGFloat] = []
    private var textHeightCache: [String: CGFloat] = [:]
    private var measuredWidth: CGFloat = 0
    private var accessibleRows: [String: TapeRowElement] = [:]
    private var displayedSignature = ""
    private var fallbackMonitor: Any?
    private var localKeys: Any?
    private var hiddenAt = -Double.infinity
    private var holdingOpen = false
    private var confirmClear = false
    private var contentHeight: CGFloat = 0
    private var copiedEntry: String?
    private var copiedFeedback: DispatchWorkItem?
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter(); formatter.dateFormat = "EEE, d MMM"; return formatter
    }()
    var keyboardState: [String: Any] = [:]
    var shortcutAvailable = false
    var onQuit: () -> Void = {}
    var onShortcutChange: () -> Void = {}
    var isCapturingFallback: Bool { fallbackMonitor != nil }
    private var trusted: Bool { keyboardState["trusted"] as? Bool == true }
    private var footerHeight: CGFloat { footer?.shortcut == nil ? 90.87 : 94.5 }

    init(session: NativeSession, keyboard: KeyboardMonitor) {
        self.session = session; self.keyboard = keyboard
        panel = SettingsPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 420), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        pillPanel = PillPanel(contentRect: NSRect(x: 0, y: 0, width: 40, height: 8), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        pill = NativePill(session: session)
        super.init()
        panel.delegate = self; panel.backgroundColor = .clear; panel.isOpaque = false; panel.appearance = NSAppearance(named: .darkAqua)
        panel.hasShadow = true; panel.isReleasedWhenClosed = false; panel.level = .floating; panel.title = "einsager history and settings"
        panel.contentMinSize = NSSize(width: 340, height: 120); panel.contentMaxSize = NSSize(width: 340, height: 600)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; panel.autorecalculatesKeyViewLoop = true
        pillPanel.backgroundColor = .clear; pillPanel.isOpaque = false; pillPanel.hasShadow = false; pillPanel.level = .statusBar
        pillPanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; pillPanel.contentView = pill
        pill.onDock = { [weak self] edge in self?.update("edge", edge) }
        pill.onMenu = { [weak self] event in guard let self else { return }; NSMenu.popUpContextMenu(self.menu(), with: event, for: self.pill) }
        localKeys = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.panel.isKeyWindow, event.keyCode == 53 else { return event }
            if self.isCapturingFallback { return event }
            if self.searchVisible { self.searchVisible = false; self.query = ""; self.showHistory() }
            else if self.settingsVisible { self.showHistory() }
            else { self.hide() }
            return nil
        }
    }

    func start() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength); statusItem = item
        if let button = item.button {
            let image = Bundle.main.url(forResource: "tray", withExtension: "png").flatMap { NSImage(contentsOf: $0) }
            image?.size = NSSize(width: 22, height: 22); image?.isTemplate = true; button.image = image
            button.toolTip = "einsager"; button.target = self; button.action = #selector(trayClick); button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        refresh()
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }
    @objc private func trayClick() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            if let button = statusItem?.button { menu().popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button) }
        } else if panel.isVisible { hide() }
        else if ProcessInfo.processInfo.systemUptime - hiddenAt > 0.25 { show() }
    }
    @objc private func screensChanged() { pill.place(); if panel.isVisible { placePanel() } }
    func show() {
        if root == nil { if settingsVisible { showSettings() } else { showHistory() } }
        placePanel(); panel.makeKeyAndOrderFront(nil); onShortcutChange()
    }
    func hide() {
        panel.orderOut(nil); hiddenAt = ProcessInfo.processInfo.systemUptime
        keyboard.perform(["command": "stopCapture"]); stopFallbackCapture()
        searchVisible = false; query = ""; confirmClear = false; onShortcutChange()
        root = nil; panel.contentView = nil; header = nil; footer = nil; scroll = nil; table = nil; search = nil
        startButton = nil; cancelButton = nil; finishButton = nil
        accessibleRows.removeAll(); rows = []; heights = []; bodyHeights = []
    }
    func windowDidResignKey(_ notification: Notification) { if !holdingOpen { hide() } }
    func windowDidBecomeKey(_ notification: Notification) { onShortcutChange() }
    func microphonesChanged() { if settingsVisible && root != nil { showSettings() } }

    private func placePanel() {
        let anchor = statusItem?.button?.window?.frame ?? NSScreen.main?.visibleFrame ?? .zero
        guard let area = (NSScreen.screens.first { $0.frame.intersects(anchor) } ?? NSScreen.main)?.visibleFrame else { return }
        var frame = panel.frame; frame.size.height = min(frame.height, area.height - 12)
        frame.origin = NSPoint(x: max(area.minX, min(anchor.midX - 170, area.maxX - 340)), y: area.maxY - frame.height - 6)
        panel.setFrame(frame, display: false)
    }
    private func resizePanel(_ height: CGFloat) {
        let maximum = min(600, (panel.screen ?? NSScreen.main)?.visibleFrame.height ?? 600)
        panel.setContentSize(NSSize(width: 340, height: min(maximum, max(120, ceil(height)))))
        root?.needsLayout = true; root?.layoutSubtreeIfNeeded(); panel.invalidateShadow()
        if panel.isVisible { placePanel() }
    }

    func refresh() {
        pill.idleHint = trusted ? "Click or hold \(keyboardState["hold"] as? String ?? "Fn") to dictate" : "Click or press \(session.store.shortcut) to dictate"
        pill.refresh()
        guard root != nil else { return }
        if settingsVisible { showSettings(); return }
        header?.phase = session.phase; header?.needsDisplay = true
        let recording = session.phase == .recording || session.phase == .requesting
        startButton?.processing = session.phase == .processing; startButton?.starting = session.phase == .requesting; startButton?.isEnabled = !session.active
        startButton?.setAccessibilityLabel(session.phase == .processing ? "Transcribing" : session.phase == .recording ? "Recording" : session.phase == .requesting ? "Starting microphone" : "Start dictation")
        startButton?.needsDisplay = true
        cancelButton?.isHidden = !recording; finishButton?.isHidden = session.phase != .recording
        footer?.shortcut = nil
        if session.phase == .requesting { footer?.hint = "Starting microphone…" }
        else if session.phase == .recording { footer?.hint = "Finish to transcribe, or cancel" }
        else if session.phase == .processing { footer?.hint = "Transcribing…" }
        else { footer?.hint = trusted ? "Click or hold" : shortcutAvailable ? "Click or press" : "Click to start. Another app uses the shortcut."; footer?.shortcut = trusted ? keyboardState["hold"] as? String ?? "Fn" : shortcutAvailable ? session.store.shortcut : nil }
        footer?.needsDisplay = true
        reloadHistory()
    }

    private func makeRoot(settings: Bool) -> PanelRoot {
        let root = PanelRoot(frame: NSRect(x: 0, y: 0, width: 340, height: panel.frame.height))
        root.autoresizingMask = [.width, .height]; root.wantsLayer = true
        root.layer?.backgroundColor = NativeStyle.background.cgColor; root.layer?.cornerRadius = 14
        root.layer?.borderColor = NativeStyle.edge.cgColor; root.layer?.borderWidth = 1; root.layer?.masksToBounds = true
        root.layerContentsRedrawPolicy = .onSetNeedsDisplay
        let header = PanelHeader(); header.settings = settings; header.phase = session.phase
        root.addSubview(header); self.header = header; self.root = root
        scroll = nil; table = nil; search = nil; footer = nil; startButton = nil; cancelButton = nil; finishButton = nil
        panel.contentView = root
        root.onLayout = { [weak self] in self?.layoutPanel() }
        if settings {
            let back = ActionButton("Settings", icon: .back) { [weak self] in self?.stopFallbackCapture(); self?.showHistory() }
            back.tint = NativeStyle.ink; back.textSize = 14; back.weight = .semibold; back.frame = NSRect(x: 16, y: 14, width: 112, height: 25)
            header.addSubview(back)
        } else {
            let search = ActionButton("Search transcripts", icon: .search) { [weak self] in
                guard let self else { return }; self.searchVisible.toggle(); if !self.searchVisible { self.query = "" }; self.showHistory()
                if self.searchVisible { self.panel.makeFirstResponder(self.search?.field) }
            }
            search.iconOnly = true; search.frame = NSRect(x: 270, y: 12, width: 28, height: 28); header.addSubview(search)
            search.setAccessibilityValue(searchVisible ? 1 : 0)
            let settings = ActionButton("Settings", icon: .sliders) { [weak self] in self?.showSettings() }
            settings.iconOnly = true; settings.frame = NSRect(x: 300, y: 12, width: 28, height: 28); header.addSubview(settings)
        }
        return root
    }

    func showHistory() {
        settingsVisible = false
        let root = makeRoot(settings: false)
        if searchVisible { let search = SearchBar(); search.field.stringValue = query; search.field.delegate = self; self.search = search; root.addSubview(search) }
        let table = TapeTable()
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("transcript")); column.width = 306; table.addTableColumn(column)
        table.frame = NSRect(x: 0, y: 0, width: 306, height: 0); table.headerView = nil; table.backgroundColor = .clear
        table.selectionHighlightStyle = .none; table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle; table.intercellSpacing = .zero
        table.style = .plain; table.usesAutomaticRowHeights = false; table.floatsGroupRows = false; table.delegate = self; table.dataSource = self
        table.refusesFirstResponder = true
        let scroll = makeScroll(document: table); root.addSubview(scroll); self.scroll = scroll; self.table = table
        let footer = PanelFooter(); root.addSubview(footer); self.footer = footer
        let start = WaveButton("Start dictation") { [weak self] in self?.actFromPanel("toggle") }; footer.addSubview(start); startButton = start
        let cancel = CircleButton("Cancel dictation") { [weak self] in self?.actFromPanel("cancel") }; footer.addSubview(cancel); cancelButton = cancel
        let finish = CircleButton("Finish dictation") { [weak self] in self?.actFromPanel("finish") }; finish.finish = true; footer.addSubview(finish); finishButton = finish
        layoutPanel(); displayedSignature = ""; refresh()
    }

    private func layoutPanel() {
        guard let root else { return }
        header?.frame = NSRect(x: 1, y: 1, width: 338, height: 52)
        if settingsVisible { scroll?.frame = NSRect(x: 1, y: 53, width: 338, height: max(0, root.bounds.height - 54)); return }
        let extra: CGFloat = searchVisible ? 40 : 0
        search?.frame = NSRect(x: 1, y: 53, width: 338, height: 40)
        footer?.frame = NSRect(x: 1, y: root.bounds.height - footerHeight - 1, width: 338, height: footerHeight)
        scroll?.frame = NSRect(x: 17, y: 59 + extra, width: 306, height: max(0, root.bounds.height - 74 - footerHeight - extra))
        let width: CGFloat = session.phase == .recording ? 122.5 : 120
        let x = (338 - width) / 2
        startButton?.frame = NSRect(x: x, y: 15, width: width, height: 36)
        cancelButton?.frame = NSRect(x: x + (session.phase == .requesting ? 22.75 : 7), y: 21, width: 24, height: 24)
        finishButton?.frame = NSRect(x: x + width - 31, y: 21, width: 24, height: 24)
    }

    private func makeScroll(document: NSView) -> NSScrollView {
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: document.frame.width, height: max(1, panel.frame.height - 165)))
        scroll.documentView = document; scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true; scroll.scrollerStyle = .overlay; scroll.drawsBackground = false; scroll.contentView.drawsBackground = false
        return scroll
    }

    private func reloadHistory() {
        guard let table else { return }
        let phase = session.phase == .message ? NativePhase.idle : session.phase
        let textWidth = max(1, (table.tableColumns.first?.width ?? 306) - 54)
        let signature = "\(session.store.historyRevision)|\(query)|\(phase.rawValue)|\(phase == .failure ? session.message : "")|\(session.store.keepHistory)|\(textWidth)"
        guard signature != displayedSignature else { return }; displayedSignature = signature
        let filter = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let visible = session.store.history.filter { filter.isEmpty || $0.text.localizedCaseInsensitiveContains(filter) }
        if textWidth != measuredWidth { measuredWidth = textWidth; textHeightCache.removeAll() }
        rows = []
        if !session.store.keepHistory { rows.append(.note("History is off. New transcripts are not saved.", empty: false)) }
        if session.store.keepHistory && filter.isEmpty && visible.isEmpty && phase == .idle { rows.append(.note("What you say appears here.\nStart below. The newest 500\ntranscripts stay until you delete them.", empty: true)) }
        if !filter.isEmpty && visible.isEmpty { rows.append(.note("No transcript contains “\(filter)”.", empty: false)) }
        var previousDay = ""
        for entry in visible {
            let day = dayLabel(entry.at)
            if day != previousDay { rows.append(.day(day)); previousDay = day }
            rows.append(.entry(entry, newest: filter.isEmpty && entry.id == session.store.history.last?.id))
        }
        if phase != .idle && filter.isEmpty {
            rows.append(.pending(phase == .failure ? session.message : phase == .processing ? "Transcribing…" : phase == .requesting ? "Starting microphone…" : "Listening…", phase, phase == .failure && session.retryable))
        }
        heights = []; bodyHeights = []
        for row in rows {
            var body: CGFloat = 0; let height: CGFloat
            switch row {
            case .day: height = 30
            case .entry(let entry, let newest):
                body = textHeightCache[entry.id] ?? NativeStyle.height(entry.text, width: textWidth)
                textHeightCache[entry.id] = body
                height = body + 14 + ((!entry.voiceprint.isEmpty || entry.seconds > 0) ? 21.18 : 0) + (newest ? 23.25 : 0)
            case .pending(let message, let phase, _): body = NativeStyle.height(message, width: textWidth); height = body + 14 + (phase == .failure ? 23.25 : 0)
            case .note(_, let empty): height = empty ? 100.42 : 38
            }
            bodyHeights.append(body); heights.append(height)
        }
        if textHeightCache.count > 600 { let ids = Set(session.store.history.map(\.id)); textHeightCache = textHeightCache.filter { ids.contains($0.key) } }
        contentHeight = heights.reduce(0, +)
        updateAccessibility()
        table.reloadData(); resizePanel(74 + footerHeight + (searchVisible ? 40 : 0) + contentHeight)
        table.scrollRowToVisible(max(0, rows.count - 1))
    }

    private func dayLabel(_ milliseconds: Double) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1000)
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return Self.dayFormatter.string(from: date)
    }

    private func updateAccessibility() {
        guard let table = table as? TapeTable else { return }
        var retained: [String: TapeRowElement] = [:]
        table.elements = rows.enumerated().map { index, row in
            let key: String, label: String, value: String
            var actions: [(String, () -> Void)] = []
            switch row {
            case .entry(let entry, _):
                key = entry.id; label = TapeCell.clock.string(from: Date(timeIntervalSince1970: entry.at / 1000)); value = entry.text
                actions = [("Copy", { [weak self] in self?.copyEntry(entry.id) }), ("Delete", { [weak self] in self?.deleteEntry(entry.id) })]
            case .pending(let message, let phase, let retryable):
                key = "pending"; label = "now"; value = message
                if phase == .failure {
                    if retryable { actions.append(("Retry", { [weak self] in self?.actFromPanel("retry") })) }
                    actions.append(("Discard", { [weak self] in self?.actFromPanel("cancel") }))
                }
            case .day(let day): key = "day-\(day)-\(index)"; label = ""; value = day
            case .note(let message, _): key = "note-\(index)"; label = ""; value = message
            }
            let element = accessibleRows[key] ?? TapeRowElement()
            element.configure(table: table, index: index, label: label, value: value, actions: actions)
            retained[key] = element
            return element
        }
        accessibleRows = retained
    }
    func controlTextDidChange(_ obj: Notification) { query = search?.field.stringValue ?? ""; reloadHistory() }
    func tableViewColumnDidResize(_ notification: Notification) { reloadHistory() }
    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }
    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool { false }
    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat { heights[row] }
    func tableView(_ tableView: NSTableView, isGroupRow row: Int) -> Bool { if case .day = rows[row] { return true }; return false }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row index: Int) -> NSView? {
        let cell = tableView.makeView(withIdentifier: TapeCell.reuseIdentifier, owner: nil) as? TapeCell ?? TapeCell()
        cell.configure(rows[index], bodyHeight: bodyHeights[index])
        cell.first.target = self; cell.first.action = #selector(firstRowAction)
        cell.second.target = self; cell.second.action = #selector(secondRowAction)
        if let tape = tableView as? TapeTable, tape.elements.indices.contains(index) {
            let element = tape.elements[index]
            for child in [cell.text, cell.first, cell.second] { child.setAccessibilityParent(element) }
        }
        if case .entry(let entry, _) = rows[index], entry.id == copiedEntry { cell.first.title = "Copied"; cell.first.icon = .check }
        return cell
    }
    @objc private func firstRowAction(_ sender: ActionButton) {
        guard let table else { return }; let index = table.row(for: sender); guard rows.indices.contains(index) else { return }
        switch rows[index] {
        case .entry(let entry, _): copyEntry(entry.id)
        case .pending: actFromPanel("retry")
        default: break
        }
    }
    @objc private func secondRowAction(_ sender: ActionButton) {
        guard let table else { return }; let index = table.row(for: sender); guard rows.indices.contains(index) else { return }
        switch rows[index] {
        case .entry(let entry, _): deleteEntry(entry.id)
        case .pending: actFromPanel("cancel")
        default: break
        }
    }

    private func copyEntry(_ id: String) {
        guard let entry = session.store.history.first(where: { $0.id == id }), session.delivery.copy(entry.text) else { return }
        copiedEntry = id; copiedFeedback?.cancel(); copyFeedback(id, copied: true)
        let work = DispatchWorkItem { [weak self] in self?.copiedEntry = nil; self?.copyFeedback(id, copied: false) }
        copiedFeedback = work; DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
    }
    private func copyFeedback(_ id: String, copied: Bool) {
        guard let index = rows.firstIndex(where: { if case .entry(let entry, _) = $0 { return entry.id == id }; return false }),
              let cell = table?.view(atColumn: 0, row: index, makeIfNecessary: false) as? TapeCell else { return }
        cell.first.title = copied ? "Copied" : "Copy"; cell.first.icon = copied ? .check : .copy; cell.first.needsDisplay = true
    }
    private func deleteEntry(_ id: String) {
        guard let entry = session.store.history.first(where: { $0.id == id }) else { return }
        session.delivery.forget(entry.text); session.store.remove(id); reloadHistory()
    }

    func showSettings() {
        let oldOrigin = settingsVisible ? scroll?.contentView.bounds.origin ?? .zero : .zero
        let focusedLabel = settingsVisible ? (panel.firstResponder as? NSView)?.accessibilityLabel() : nil
        settingsVisible = true
        let root = makeRoot(settings: true)
        let form = FlippedView(frame: NSRect(x: 0, y: 0, width: 338, height: 0))
        var y: CGFloat = 0
        func add(_ view: NSView, height: CGFloat) { view.frame = NSRect(x: 0, y: y, width: 338, height: height); form.addSubview(view); y += height }
        func row(_ title: String, _ control: NSView, height: CGFloat = 42) { add(FormRow(title, control: control), height: height) }
        func button(_ title: String, tint: NSColor = NativeStyle.secondary, action: @escaping () -> Void) -> ActionButton {
            let button = ActionButton(title, action: action); button.tint = tint; return button
        }
        let microphone = StylePopup("Microphone", options: [("", "System default")] + AudioInput.all().map { ($0.uid, $0.name) }, selected: session.store.microphone) { [weak self] in self?.update("nativeMicrophone", $0) }
        row("Microphone", microphone)
        let choices = FlippedView(); let legend = FormText("Clipboard after dictation", size: 13, color: NativeStyle.ink)
        legend.frame = NSRect(x: 0, y: 4, width: 338, height: 32); choices.addSubview(legend)
        var choiceY: CGFloat = 34
        for (mode, title, detail) in [("always", "Always", "The transcript stays on the clipboard."),
            ("if-paste-fails", "If paste fails", "After a paste, your previous clipboard comes back."),
            ("never", "Never", "When einsager cannot paste, copy the text from history.")] {
            let option = RadioOption(title, detail: detail, selected: session.store.clipboard == mode) { [weak self] in self?.update("clipboard", mode) }
            let height = 33.94 + NativeStyle.height(detail, width: 280, size: 11.5, lineHeight: 1.38)
            option.frame = NSRect(x: 16, y: choiceY, width: 306, height: height); choices.addSubview(option); choiceY += height
        }
        if !trusted {
            let note = FormText("einsager cannot paste by itself right now, so “If paste fails” keeps the text copied.")
            let height = NativeStyle.height(note.text, width: 306, size: 11.5, lineHeight: 1.45) + 16
            note.frame = NSRect(x: 0, y: choiceY, width: 338, height: height); choices.addSubview(note); choiceY += height
        }
        add(choices, height: choiceY + 10)
        let keep = ToggleSwitch("Keep transcript history", on: session.store.keepHistory) { [weak self] in guard let self else { return }; self.update("keepHistory", !self.session.store.keepHistory) }
        row("Keep transcript history", keep)
        let show = ToggleSwitch("Show pill when idle", on: session.store.showPill) { [weak self] in guard let self else { return }; self.update("showPill", !self.session.store.showPill) }
        row("Show pill when idle", show)
        let edge = StylePopup("Dock the pill", options: [("bottom", "Bottom"), ("top", "Top"), ("left", "Left"), ("right", "Right")], selected: session.store.edge) { [weak self] in self?.update("edge", $0) }
        row("Dock the pill", edge)
        let resetHome = button("Reset to default") { [weak self] in guard let self else { return }; self.session.cancel(); self.update("codexHome", self.session.store.defaultCodexHome) }
        resetHome.isEnabled = session.store.codexHome != session.store.defaultCodexHome
        add(FormRow("Codex login folder", control: resetHome, group: true), height: 32)
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let path = session.store.codexHome.replacingOccurrences(of: home, with: "~", options: .anchored)
        let folder = FolderButton(path) { [weak self] in self?.chooseFolder() }
        folder.setAccessibilityLabel("Change the Codex login folder, now \(path)")
        add(folder, height: 42)
        let resetKeys = button("Reset to Fn") { [weak self] in self?.keyboard.perform(["command": "reset"]) }; resetKeys.isEnabled = trusted
        add(FormRow("Shortcuts", control: resetKeys, group: true), height: 32)
        if !trusted {
            let allow = button("Allow…", tint: NativeStyle.accent) { [weak self] in self?.keyboard.perform(["command": "prompt"]) }; allow.weight = .semibold
            let permission = FormRow("Allow Accessibility so einsager can see Fn and paste for you. Until then, use the fallback and paste by hand.", control: allow); permission.labelSize = 12
            add(permission, height: 88)
            let capturing = isCapturingFallback
            let fallback = button(capturing ? "Press keys…" : session.store.shortcut, tint: capturing ? NativeStyle.accent : NativeStyle.secondary) { [weak self] in self?.captureFallback() }
            fallback.keyCaps = !capturing; row("Fallback", fallback)
            if capturing { add(FormText("Press a key with Ctrl, Alt, or Cmd, or a function key. Esc cancels."), height: 52) }
        }
        for (name, title, fallback) in [("hold", "Hold to talk", "Fn"), ("handsFree", "Hands-free", "Fn+Space")] {
            let capturing = keyboardState["capturing"] as? String == name
            let shortcut = button(capturing ? "Press keys…" : keyboardState[name] as? String ?? fallback, tint: capturing ? NativeStyle.accent : NativeStyle.secondary) { [weak self] in
                self?.keyboard.perform(capturing ? ["command": "stopCapture"] : ["command": "capture", "target": name])
            }
            shortcut.isEnabled = trusted; shortcut.keyCaps = !capturing; shortcut.setAccessibilityLabel("Change the \(title.lowercased()) shortcut")
            row(title, shortcut)
        }
        if keyboardState["capturing"] is String { add(FormText("Press the new keys, then release them. Esc cancels."), height: 35) }
        if let error = keyboardState["error"] as? String { add(FormText(error, color: NativeStyle.alarm), height: 52) }
        let clear = button(confirmClear ? "Delete all" : "Clear history…", tint: NativeStyle.alarm) { [weak self] in
            guard let self else { return }
            if self.confirmClear { self.session.store.clear(); self.session.delivery.forget(); self.confirmClear = false }
            else { self.confirmClear = true }
            self.showSettings()
        }
        clear.isEnabled = !session.store.history.isEmpty
        let lastRow = FormRow(confirmClear ? "Delete all \(session.store.history.count) transcripts?" : "", control: clear)
        let quit = button(confirmClear ? "Keep" : "Quit einsager") { [weak self] in
            guard let self else { return }; if self.confirmClear { self.confirmClear = false; self.showSettings() } else { self.onQuit() }
        }
        if !confirmClear {
            clear.frame = NSRect(x: 16, y: 11, width: 100, height: 20); lastRow.control = quit; lastRow.addSubview(quit); lastRow.addSubview(clear)
        } else { quit.frame = NSRect(x: 210, y: 11, width: 30, height: 20); lastRow.addSubview(quit) }
        add(lastRow, height: 42)
        add(FormText("Audio goes to ChatGPT to transcribe. History stays on this computer."), height: 65)
        form.frame.size.height = y
        let scroll = makeScroll(document: form); root.addSubview(scroll); self.scroll = scroll
        resizePanel(y + 54); layoutPanel()
        scroll.contentView.scroll(to: oldOrigin); scroll.reflectScrolledClipView(scroll.contentView)
        if let focusedLabel {
            func match(_ view: NSView) -> NSView? {
                if view.accessibilityLabel() == focusedLabel && view.acceptsFirstResponder { return view }
                return view.subviews.lazy.compactMap(match).first
            }
            if let focus = match(root) { panel.makeFirstResponder(focus) }
        }
    }

    private func update(_ key: String, _ value: Any) { session.store.update(key, value); refresh(); onShortcutChange() }
    private func actFromPanel(_ action: String) {
        hide(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in self?.session.act(action) }
    }
    private func chooseFolder() {
        holdingOpen = true
        let chooser = NSOpenPanel(); chooser.canChooseDirectories = true; chooser.canChooseFiles = false; chooser.showsHiddenFiles = true; chooser.allowsMultipleSelection = false; chooser.title = "Select your Codex folder"
        chooser.beginSheetModal(for: panel) { [weak self] result in
            guard let self else { return }; self.holdingOpen = false
            if result == .OK, let path = chooser.url?.path { self.session.cancel(); self.update("codexHome", path) }
        }
    }
    private func captureFallback() {
        if isCapturingFallback { stopFallbackCapture(); showSettings(); return }
        keyboard.perform(["command": "stopCapture"])
        fallbackMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if event.keyCode == 53 { self.stopFallbackCapture(); self.showSettings(); return nil }
            if let shortcut = FallbackShortcut.from(event) { self.session.store.update("shortcut", shortcut); self.stopFallbackCapture(); self.showSettings() }
            return nil
        }
        onShortcutChange(); showSettings()
    }
    private func stopFallbackCapture() { if let fallbackMonitor { NSEvent.removeMonitor(fallbackMonitor); self.fallbackMonitor = nil }; onShortcutChange() }
    func menu() -> NSMenu {
        let menu = NSMenu(); menu.autoenablesItems = false
        for (title, action, enabled) in [("Start / finish dictation", "toggle", true), ("Cancel dictation", "cancel", session.phase != .idle),
            ("Retry transcription", "retry", session.retryable), ("Copy last transcript", "copy", !session.delivery.lastText.isEmpty)] {
            let item = ActionMenuItem(title) { [weak self] in self?.session.act(action) }; item.isEnabled = enabled; menu.addItem(item)
        }
        menu.addItem(.separator()); menu.addItem(ActionMenuItem("History and settings…") { [weak self] in self?.show() }); menu.addItem(ActionMenuItem("Quit einsager") { [weak self] in self?.onQuit() })
        return menu
    }
    deinit {
        if let localKeys { NSEvent.removeMonitor(localKeys) }; if let fallbackMonitor { NSEvent.removeMonitor(fallbackMonitor) }
        if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }; NotificationCenter.default.removeObserver(self)
    }
}
