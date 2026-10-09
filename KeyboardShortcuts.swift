import AppKit
import Carbon

struct KeyBinding: Codable, Equatable {
    let modifiers: UInt64
    let keyCode: UInt16?
    let keyName: String

    static let supportedFlags: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand, .maskShift, .maskSecondaryFn]
    static let holdDefault = KeyBinding(modifiers: CGEventFlags.maskSecondaryFn.rawValue, keyCode: nil, keyName: "")
    static let handsFreeDefault = KeyBinding(modifiers: CGEventFlags.maskSecondaryFn.rawValue,
                                           keyCode: UInt16(kVK_Space), keyName: "Space")
    static let legacyHandsFree = KeyBinding(modifiers: CGEventFlags([.maskControl, .maskAlternate]).rawValue,
                                            keyCode: UInt16(kVK_Space), keyName: "Space")
    static func == (lhs: KeyBinding, rhs: KeyBinding) -> Bool {
        lhs.modifiers == rhs.modifiers && lhs.keyCode == rhs.keyCode
    }
    var flags: CGEventFlags { CGEventFlags(rawValue: modifiers) }
    var displayName: String {
        let symbols: [(CGEventFlags, String)] = [(.maskControl, "⌃"), (.maskAlternate, "⌥"),
            (.maskShift, "⇧"), (.maskCommand, "⌘"), (.maskSecondaryFn, "Fn")]
        return symbols.filter { flags.contains($0.0) }.map { $0.1 }.joined() + (flags.contains(.maskSecondaryFn) && !keyName.isEmpty ? "+" : "") + keyName
    }

    func matches(keyCode: UInt16, flags: CGEventFlags) -> Bool {
        self.keyCode == keyCode && flags.intersection(Self.supportedFlags) == self.flags
    }

    var validationError: String? {
        if flags.subtracting(Self.supportedFlags) != [] { return "Use Control, Option, Shift, Command, or Fn." }
        if keyCode == nil && modifiers == 0 { return "Press a modifier such as Fn, or a key combination." }
        if keyCode != nil && modifiers == 0 { return "Include a modifier key to keep normal typing available." }
        if let keyCode = keyCode, [UInt16(kVK_Escape), UInt16(kVK_Tab)].contains(keyCode) {
            return "Escape and Tab must remain available. Choose another key."
        }
        if flags == .maskCommand && keyCode == UInt16(kVK_ANSI_V) {
            return "Command+V is reserved for pasting dictated text. Choose another combination."
        }
        if flags == .maskCommand, let code = keyCode,
           [UInt16(kVK_Space), UInt16(kVK_ANSI_Q), UInt16(kVK_ANSI_W)].contains(code) {
            return "That shortcut belongs to macOS. Choose another combination."
        }
        return nil
    }

    var carbonModifiers: UInt32? {
        guard !flags.contains(.maskSecondaryFn) else { return nil }
        var result: UInt32 = 0
        for (flag, value) in [(CGEventFlags.maskControl, controlKey), (.maskAlternate, optionKey),
                              (.maskShift, shiftKey), (.maskCommand, cmdKey)] {
            if flags.contains(flag) { result |= UInt32(value) }
        }
        return result
    }
}

final class ShortcutSettings {
    private let defaults: UserDefaults
    private(set) var hold: KeyBinding
    private(set) var handsFree: KeyBinding

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        hold = Self.load("hold", from: defaults) ?? .holdDefault
        handsFree = Self.load("handsFree", from: defaults) ?? .handsFreeDefault
        if hold == handsFree || hold == .legacyHandsFree || handsFree.keyCode == nil {
            hold = .holdDefault; handsFree = .handsFreeDefault
        }
    }

    private static func load(_ name: String, from defaults: UserDefaults) -> KeyBinding? {
        guard let data = defaults.data(forKey: "dictationShortcut." + name),
              let binding = try? JSONDecoder().decode(KeyBinding.self, from: data),
              binding.validationError == nil else { return nil }
        return binding
    }

    func save(_ binding: KeyBinding, hold: Bool) -> String? {
        if let error = binding.validationError { return error }
        if !hold && binding.keyCode == nil { return "Include a key such as Space for hands-free." }
        if hold && binding == .legacyHandsFree { return "⌃⌥Space is reserved for hands-free. Choose another shortcut." }
        if binding == (hold ? handsFree : self.hold) { return "Hold-to-talk and hands-free need different shortcuts." }
        guard let data = try? JSONEncoder().encode(binding) else { return "The shortcut could not be saved." }
        defaults.set(data, forKey: "dictationShortcut." + (hold ? "hold" : "handsFree"))
        if hold { self.hold = binding } else { handsFree = binding }
        return nil
    }

    func reset() {
        defaults.removeObject(forKey: "dictationShortcut.hold")
        defaults.removeObject(forKey: "dictationShortcut.handsFree")
        hold = .holdDefault
        handsFree = .handsFreeDefault
    }
}

struct ShortcutInput {
    enum Action: Equatable { case holdPressed, holdReleased, toggle, cancel }
    enum Event { case modifiers, down, up }
    struct Result {
        var action: Action?
        var consume = false
    }
    private var holdDown = false
    private var swallowedKeys: Set<UInt16> = []

    mutating func reset() { holdDown = false; swallowedKeys.removeAll() }

    mutating func handle(_ event: Event, keyCode: UInt16, flags: CGEventFlags, repeatKey: Bool,
                         hold: KeyBinding, handsFree: KeyBinding, active: Bool) -> Result {
        let flags = flags.intersection(KeyBinding.supportedFlags)
        if event == .up {
            let consumed = swallowedKeys.remove(keyCode) != nil
            if holdDown && hold.keyCode == keyCode {
                holdDown = false
                return Result(action: .holdReleased, consume: consumed)
            }
            return Result(consume: consumed)
        }
        if event == .down {
            if repeatKey { return Result(consume: swallowedKeys.contains(keyCode)) }
            if active && keyCode == UInt16(kVK_Escape) {
                swallowedKeys.insert(keyCode)
                return Result(action: .cancel, consume: true)
            }
            if handsFree.matches(keyCode: keyCode, flags: flags) || KeyBinding.legacyHandsFree.matches(keyCode: keyCode, flags: flags) {
                swallowedKeys.insert(keyCode)
                return Result(action: .toggle, consume: true)
            }
            if !holdDown && hold.matches(keyCode: keyCode, flags: flags) {
                holdDown = true
                swallowedKeys.insert(keyCode)
                return Result(action: .holdPressed, consume: true)
            }
            return Result()
        }
        if holdDown && !flags.contains(hold.flags) {
            holdDown = false
            return Result(action: .holdReleased, consume: hold.flags.contains(.maskSecondaryFn))
        }
        let modifierKeys: Set<UInt16> = [UInt16(kVK_Function), UInt16(kVK_Control), UInt16(kVK_RightControl),
            UInt16(kVK_Option), UInt16(kVK_RightOption), UInt16(kVK_Shift), UInt16(kVK_RightShift),
            UInt16(kVK_Command), UInt16(kVK_RightCommand)]
        if !holdDown && hold.keyCode == nil && flags == hold.flags && modifierKeys.contains(keyCode) {
            holdDown = true
            return Result(action: .holdPressed, consume: hold.flags.contains(.maskSecondaryFn))
        }
        return Result()
    }
}

final class ShortcutEditor: NSObject, NSWindowDelegate {
    private let settings: ShortcutSettings
    private let panel: NSPanel
    private let holdButton = NSButton()
    private let handsFreeButton = NSButton()
    private let hint = NSTextField(wrappingLabelWithString: "")
    private var captureHold: Bool?
    private var pendingModifiers: CGEventFlags = []
    private var monitor: Any?
    var onChange: (() -> Void)?
    var onClose: (() -> Void)?
    var isVisible: Bool { panel.isVisible }

    init(settings: ShortcutSettings) {
        self.settings = settings
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 420, height: 236),
                        styleMask: [.titled, .closable], backing: .buffered, defer: false)
        super.init()
        panel.appearance = NSAppearance(named: .darkAqua)
        panel.title = "Dictation shortcuts"
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        guard let view = panel.contentView else { return }
        let intro = NSTextField(labelWithString: "Choose a shortcut, then press and release the keys.")
        intro.font = .systemFont(ofSize: 13)
        intro.frame = NSRect(x: 20, y: 188, width: 380, height: 24)
        view.addSubview(intro)
        for (title, y) in [("Hold to talk", CGFloat(144)), ("Hands-free", CGFloat(100))] {
            let label = NSTextField(labelWithString: title)
            label.frame = NSRect(x: 20, y: y + 7, width: 110, height: 20)
            view.addSubview(label)
        }
        holdButton.frame = NSRect(x: 138, y: 144, width: 258, height: 32)
        handsFreeButton.frame = NSRect(x: 138, y: 100, width: 258, height: 32)
        for button in [holdButton, handsFreeButton] {
            button.bezelStyle = .rounded
            button.target = self
            view.addSubview(button)
        }
        holdButton.action = #selector(captureHoldShortcut)
        holdButton.setAccessibilityLabel("Change hold-to-talk shortcut")
        handsFreeButton.action = #selector(captureHandsFreeShortcut)
        handsFreeButton.setAccessibilityLabel("Change hands-free shortcut")
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = .secondaryLabelColor
        hint.maximumNumberOfLines = 2
        hint.frame = NSRect(x: 20, y: 58, width: 380, height: 34)
        view.addSubview(hint)
        let reset = NSButton(title: "Reset to Fn", target: self, action: #selector(resetDefaults))
        reset.bezelStyle = .rounded
        reset.frame = NSRect(x: 16, y: 14, width: 120, height: 32)
        view.addSubview(reset)
        let done = NSButton(title: "Done", target: self, action: #selector(doneEditing))
        done.bezelStyle = .rounded
        done.frame = NSRect(x: 310, y: 14, width: 90, height: 32)
        view.addSubview(done)
        updateButtons()
    }

    func show() {
        updateButtons()
        panel.center()
        NSApp.activate()
        panel.makeKeyAndOrderFront(nil)
        if monitor == nil {
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged, .keyDown, .keyUp]) { [weak self] event in
                guard let self = self else { return event }
                return self.capture(event)
            }
        }
    }

    private func updateButtons() {
        holdButton.title = captureHold == true ? "Press keys…" : settings.hold.displayName
        handsFreeButton.title = captureHold == false ? "Press keys…" : settings.handsFree.displayName
        if captureHold == nil { hint.stringValue = "Fn needs keyboard permission. ⌃⌥Space also starts hands-free." }
    }

    @objc private func captureHoldShortcut() { beginCapture(hold: true) }
    @objc private func captureHandsFreeShortcut() { beginCapture(hold: false) }
    private func beginCapture(hold: Bool) {
        captureHold = hold
        pendingModifiers = []
        updateButtons()
        hint.stringValue = "Press your shortcut. Escape cancels without changes."
    }

    private func capture(_ event: NSEvent) -> NSEvent? {
        guard let hold = captureHold else { return event }
        if event.type == .keyUp { return nil }
        if event.type == .keyDown && event.keyCode == UInt16(kVK_Escape) {
            captureHold = nil
            updateButtons()
            return nil
        }
        let flags = CGEventFlags(rawValue: UInt64(event.modifierFlags.rawValue)).intersection(KeyBinding.supportedFlags)
        if event.type == .flagsChanged {
            pendingModifiers.formUnion(flags)
            if flags == [] && pendingModifiers != [] {
                commit(KeyBinding(modifiers: pendingModifiers.rawValue, keyCode: nil, keyName: ""), hold: hold)
            }
            return nil
        }
        guard event.type == .keyDown, !event.isARepeat else { return nil }
        let name = event.keyCode == UInt16(kVK_Space) ? "Space" : (event.charactersIgnoringModifiers?.uppercased() ?? "Key \(event.keyCode)")
        commit(KeyBinding(modifiers: flags.rawValue, keyCode: event.keyCode, keyName: name), hold: hold)
        return nil
    }

    private func commit(_ binding: KeyBinding, hold: Bool) {
        if let error = settings.save(binding, hold: hold) { hint.stringValue = error; pendingModifiers = []; return }
        captureHold = nil
        updateButtons()
        hint.stringValue = "Shortcut saved: " + binding.displayName
        onChange?()
    }

    @objc private func resetDefaults() {
        captureHold = nil
        settings.reset()
        updateButtons()
        onChange?()
    }

    @objc private func doneEditing() { panel.close() }
    func windowWillClose(_ notification: Notification) {
        captureHold = nil
        if let monitor = monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        onClose?()
    }
}
