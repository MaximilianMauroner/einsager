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
    enum Action: Equatable { case holdPressed, holdReleased, holdInterrupted, toggle, cancel }
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
            // Fn+Left, Fn+Delete, and similar keys use a held modifier for typing, not for dictation.
            if holdDown && hold.keyCode == nil {
                holdDown = false
                return Result(action: .holdInterrupted)
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
