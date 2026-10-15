import AppKit
import Carbon

/// Parses the stored Electron accelerator without rewriting it. Carbon works without Accessibility access.
struct FallbackShortcut {
    let code: UInt32
    let modifiers: UInt32

    static let keyCodes: [String: Int] = [
        "A": kVK_ANSI_A, "B": kVK_ANSI_B, "C": kVK_ANSI_C, "D": kVK_ANSI_D, "E": kVK_ANSI_E,
        "F": kVK_ANSI_F, "G": kVK_ANSI_G, "H": kVK_ANSI_H, "I": kVK_ANSI_I, "J": kVK_ANSI_J,
        "K": kVK_ANSI_K, "L": kVK_ANSI_L, "M": kVK_ANSI_M, "N": kVK_ANSI_N, "O": kVK_ANSI_O,
        "P": kVK_ANSI_P, "Q": kVK_ANSI_Q, "R": kVK_ANSI_R, "S": kVK_ANSI_S, "T": kVK_ANSI_T,
        "U": kVK_ANSI_U, "V": kVK_ANSI_V, "W": kVK_ANSI_W, "X": kVK_ANSI_X, "Y": kVK_ANSI_Y, "Z": kVK_ANSI_Z,
        "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4,
        "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
        "Space": kVK_Space, "Enter": kVK_Return, "Tab": kVK_Tab, "Backspace": kVK_Delete,
        "Delete": kVK_ForwardDelete, "Insert": kVK_Help, "Home": kVK_Home, "End": kVK_End,
        "PageUp": kVK_PageUp, "PageDown": kVK_PageDown, "Up": kVK_UpArrow, "Down": kVK_DownArrow,
        "Left": kVK_LeftArrow, "Right": kVK_RightArrow, "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal,
        "[": kVK_ANSI_LeftBracket, "]": kVK_ANSI_RightBracket, "\\": kVK_ANSI_Backslash,
        ";": kVK_ANSI_Semicolon, "'": kVK_ANSI_Quote, ",": kVK_ANSI_Comma,
        ".": kVK_ANSI_Period, "/": kVK_ANSI_Slash, "`": kVK_ANSI_Grave,
        "F1": kVK_F1, "F2": kVK_F2, "F3": kVK_F3, "F4": kVK_F4, "F5": kVK_F5,
        "F6": kVK_F6, "F7": kVK_F7, "F8": kVK_F8, "F9": kVK_F9, "F10": kVK_F10,
        "F11": kVK_F11, "F12": kVK_F12, "F13": kVK_F13, "F14": kVK_F14, "F15": kVK_F15,
        "F16": kVK_F16, "F17": kVK_F17, "F18": kVK_F18, "F19": kVK_F19, "F20": kVK_F20,
    ]

    init?(_ value: String) {
        var parts = value.components(separatedBy: "+")
        guard let key = parts.popLast(), let code = Self.keyCodes[key] else { return nil }
        let names = ["Ctrl", "Alt", "Shift", "Cmd", "Super"]
        let flags = [controlKey, optionKey, shiftKey, cmdKey, cmdKey]
        var modifiers: UInt32 = 0
        var previous = -1
        for part in parts {
            guard let index = names.firstIndex(of: part), index > previous else { return nil }
            previous = index
            modifiers |= UInt32(flags[index])
        }
        guard key.hasPrefix("F") && Int(key.dropFirst()) != nil || modifiers & UInt32(controlKey | optionKey | cmdKey) != 0 else { return nil }
        self.code = UInt32(code)
        self.modifiers = modifiers
    }

    static func from(_ event: NSEvent) -> String? {
        guard let name = keyCodes.first(where: { $0.value == Int(event.keyCode) })?.key else { return nil }
        let flags = event.modifierFlags
        let parts = [(flags.contains(.control), "Ctrl"), (flags.contains(.option), "Alt"),
            (flags.contains(.shift), "Shift"), (flags.contains(.command), "Cmd")].filter { $0.0 }.map { $0.1 }
        let value = (parts + [name]).joined(separator: "+")
        return FallbackShortcut(value) == nil ? nil : value
    }
}

final class NativeHotKeys {
    var onAction: (String) -> Void = { _ in }
    private var handler: EventHandlerRef?
    private var fallback: EventHotKeyRef?
    private var escape: EventHotKeyRef?
    private var registered: String?
    private(set) var available = false

    init() {
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var key = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                MemoryLayout<EventHotKeyID>.size, nil, &key)
            let owner = Unmanaged<NativeHotKeys>.fromOpaque(context).takeUnretainedValue()
            owner.onAction(key.id == 2 ? "cancel" : "toggle")
            return noErr
        }, 1, &type, Unmanaged.passUnretained(self).toOpaque(), &handler)
    }

    func update(shortcut: String, native: Bool, active: Bool, capturing: Bool) {
        let wanted = native || capturing ? nil : shortcut
        if wanted != registered {
            if let fallback { UnregisterEventHotKey(fallback) }
            fallback = nil
            registered = wanted
            if let wanted, let binding = FallbackShortcut(wanted) {
                RegisterEventHotKey(binding.code, binding.modifiers, EventHotKeyID(signature: 0x45494E53, id: 1),
                    GetApplicationEventTarget(), 0, &fallback)
            }
        }
        available = native || fallback != nil
        if active && !native && !capturing && escape == nil {
            RegisterEventHotKey(UInt32(kVK_Escape), 0, EventHotKeyID(signature: 0x45494E53, id: 2), GetApplicationEventTarget(), 0, &escape)
        } else if (!active || native || capturing), let escape { UnregisterEventHotKey(escape); self.escape = nil }
    }

    deinit {
        if let fallback { UnregisterEventHotKey(fallback) }
        if let escape { UnregisterEventHotKey(escape) }
        if let handler { RemoveEventHandler(handler) }
    }
}
