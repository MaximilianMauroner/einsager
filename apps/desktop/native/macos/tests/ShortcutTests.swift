import AppKit
import Carbon

@main
struct ShortcutTests {
    static var checks = 0

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        checks += 1
        if !condition() { fatalError(message) }
    }

    static func main() {
        let suite = "einsager-shortcut-tests-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = ShortcutSettings(defaults: defaults)
        expect(settings.hold == .holdDefault && settings.handsFree == .handsFreeDefault, "Fresh shortcuts default to Fn and Fn+Space")
        let custom = KeyBinding(modifiers: CGEventFlags([.maskControl, .maskAlternate]).rawValue,
                                keyCode: UInt16(kVK_ANSI_K), keyName: "K")
        expect(settings.save(custom, hold: true) == nil, "Custom hold shortcut saves")
        expect(ShortcutSettings(defaults: defaults).hold == custom, "Shortcut persists across launches")
        let sameKeys = KeyBinding(modifiers: custom.modifiers, keyCode: custom.keyCode, keyName: "Different label")
        expect(settings.save(sameKeys, hold: false) != nil, "Physical duplicate shortcuts cannot be assigned")
        expect(settings.save(.legacyHandsFree, hold: true) != nil, "Legacy hands-free cannot shadow hold")
        expect(settings.save(.holdDefault, hold: false) != nil, "Hands-free requires a key with its modifiers")
        expect(KeyBinding(modifiers: 0, keyCode: 0, keyName: "A").validationError != nil, "Normal typing cannot become a global shortcut")
        let paste = KeyBinding(modifiers: CGEventFlags.maskCommand.rawValue,
                               keyCode: UInt16(kVK_ANSI_V), keyName: "V")
        expect(settings.save(paste, hold: true) != nil, "Hold cannot intercept automatic Command+V paste")
        expect(settings.save(paste, hold: false) != nil, "Hands-free cannot intercept automatic Command+V paste")
        expect(settings.hold == custom && settings.handsFree == .handsFreeDefault,
               "Rejected paste bindings leave saved shortcuts unchanged")
        let customHandsFree = KeyBinding(modifiers: CGEventFlags([.maskCommand, .maskShift]).rawValue,
                                        keyCode: UInt16(kVK_ANSI_V), keyName: "V")
        expect(settings.save(customHandsFree, hold: false) == nil, "Modified Command+V remains a valid custom shortcut")
        defaults.set(try! JSONEncoder().encode(paste), forKey: "dictationShortcut.hold")
        let restoredHold = ShortcutSettings(defaults: defaults)
        expect(restoredHold.hold == .holdDefault, "Previously saved Command+V hold restores the Fn default")
        expect(restoredHold.handsFree == customHandsFree, "Replacing an invalid hold preserves valid hands-free")
        defaults.set(try! JSONEncoder().encode(custom), forKey: "dictationShortcut.hold")
        defaults.set(try! JSONEncoder().encode(paste), forKey: "dictationShortcut.handsFree")
        let restoredHandsFree = ShortcutSettings(defaults: defaults)
        expect(restoredHandsFree.handsFree == .handsFreeDefault, "Previously saved Command+V hands-free restores Fn+Space")
        expect(restoredHandsFree.hold == custom, "Replacing invalid hands-free preserves a valid hold")
        settings.reset()
        expect(ShortcutSettings(defaults: defaults).hold == .holdDefault, "Reset persists the Fn default")
        var input = ShortcutInput()
        func key(_ event: ShortcutInput.Event, _ code: Int, _ flags: CGEventFlags,
                 repeatKey: Bool = false, active: Bool = false, hold: KeyBinding = .holdDefault) -> ShortcutInput.Result {
            input.handle(event, keyCode: UInt16(code), flags: flags, repeatKey: repeatKey,
                         hold: hold, handsFree: .handsFreeDefault, active: active)
        }
        expect(key(.modifiers, kVK_Function, .maskSecondaryFn).action == .holdPressed, "Physical Fn press starts hold")
        expect(key(.modifiers, kVK_Function, .maskSecondaryFn).action == nil, "Repeated Fn state cannot duplicate a start")
        expect(key(.down, kVK_Space, .maskSecondaryFn).action == .toggle, "Fn+Space locks the current hold")
        expect(key(.down, kVK_Space, .maskSecondaryFn, repeatKey: true).action == nil, "Space autorepeat cannot toggle repeatedly")
        expect(key(.up, kVK_Space, .maskSecondaryFn).consume, "Handled Space release does not reach the editor")
        expect(key(.modifiers, kVK_Function, []).action == .holdReleased, "Fn release finishes hold")
        expect(key(.down, kVK_LeftArrow, .maskSecondaryFn).action == nil, "Implicit Fn on arrows cannot begin recording")
        expect(key(.down, kVK_Escape, []).action == nil, "Idle Escape remains available")
        expect(key(.down, kVK_Escape, [], active: true).action == .cancel, "Active Escape cancels")
        expect(key(.up, kVK_Escape, []).consume, "Handled Escape release is swallowed")
        expect(key(.down, kVK_Space, [.maskControl, .maskAlternate]).action == .toggle, "Existing hands-free shortcut remains usable")
        input.reset()
        expect(key(.down, kVK_ANSI_K, [.maskControl, .maskAlternate], hold: custom).action == .holdPressed, "Custom keyed hold starts")
        expect(key(.down, kVK_ANSI_K, [.maskControl, .maskAlternate], repeatKey: true, hold: custom).action == nil, "Held key repeats cannot start again")
        expect(key(.modifiers, kVK_Control, .maskAlternate, hold: custom).action == .holdReleased, "Releasing a required custom modifier finishes")
        expect(key(.up, kVK_ANSI_K, [], hold: custom).action == nil, "Final custom key release cannot finish twice")
        input.reset()
        expect(key(.up, kVK_Space, []).consume == false, "Reset clears swallowed-key state")

        input.reset()
        expect(key(.modifiers, kVK_Function, .maskSecondaryFn).action == .holdPressed, "Fn press starts a hold")
        let home = key(.down, kVK_LeftArrow, .maskSecondaryFn)
        expect(home.action == .holdInterrupted && !home.consume, "Fn+Left interrupts the hold and still reaches the editor")
        expect(key(.modifiers, kVK_Function, []).action == nil, "Releasing Fn after Fn+Left cannot transcribe")
        expect(key(.modifiers, kVK_Function, .maskSecondaryFn).action == .holdPressed, "Fn press starts a new hold")
        expect(key(.down, kVK_Space, .maskSecondaryFn).action == .toggle, "Fn+Space still locks hands-free during a hold")
        input.reset()
        expect(key(.modifiers, kVK_Function, .maskSecondaryFn).action == .holdPressed, "Fn press starts a hold before a reset")
        input.reset()
        expect(key(.modifiers, kVK_Function, []).action == nil, "Reset loses the old Fn release, so the app must cancel that hold")
        print("Passed \(checks) shortcut checks")
    }
}
