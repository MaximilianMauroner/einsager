import AppKit
import Carbon

@main
struct SessionTests {
    static var checks = 0

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        checks += 1
        if !condition() { fatalError(message) }
    }

    static func begun(_ action: DictationSession.Action) -> UUID {
        guard case let .begin(id) = action else { fatalError("Expected a new session, got \(action)") }
        return id
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

        var held = DictationSession()
        let first = begun(held.holdPressed(at: 10))
        expect(held.microphoneReady(for: first), "Current permission starts recording")
        expect(held.holdReleased(at: 11) == .finish(first), "Release transcribes a real hold")
        expect(held.finish() == .none, "Duplicate stop cannot transcribe twice")
        expect(held.toggle() == .none, "Processing blocks new recording")
        expect(held.transcriptReady(for: first), "Current result is accepted")
        expect(!held.transcriptReady(for: first), "Duplicate result cannot schedule another paste")
        expect(held.deliveryFinished(for: first), "Delivery returns to idle")

        var reconfiguredHold = DictationSession()
        input.reset()
        expect(key(.modifiers, kVK_Function, .maskSecondaryFn).action == .holdPressed, "Reconfiguration test presses the real Fn binding")
        let reconfiguredID = begun(reconfiguredHold.holdPressed(at: 15))
        expect(reconfiguredHold.microphoneReady(for: reconfiguredID), "Reconfiguration test records a hold")
        expect(reconfiguredHold.shortcutsWillChange() == .finish(reconfiguredID), "Changing shortcuts finishes an active hold and preserves its audio")
        input.reset()
        expect(key(.modifiers, kVK_Function, []).action == nil, "Reset loses the old Fn release")
        expect(reconfiguredHold.state == .processing(reconfiguredID), "A lost Fn release cannot leave the microphone recording after reconfiguration")
        expect(reconfiguredHold.shortcutsWillChange() == .none, "Repeated configuration cannot transcribe the hold twice")

        var reconfiguredPermission = DictationSession()
        let pendingHold = begun(reconfiguredPermission.holdPressed(at: 16))
        expect(reconfiguredPermission.shortcutsWillChange() == .cancel, "Changing shortcuts cancels a hold waiting for microphone permission")
        expect(!reconfiguredPermission.microphoneReady(for: pendingHold), "Permission arriving after reconfiguration cannot start the old hold")

        var reconfiguredHandsFree = DictationSession()
        let handsFreeID = begun(reconfiguredHandsFree.toggle())
        expect(reconfiguredHandsFree.shortcutsWillChange() == .none && reconfiguredHandsFree.state == .requesting(handsFreeID, .handsFree), "Changing shortcuts preserves hands-free authorization")
        expect(reconfiguredHandsFree.microphoneReady(for: handsFreeID), "Hands-free authorization remains valid after reconfiguration")
        expect(reconfiguredHandsFree.shortcutsWillChange() == .none && reconfiguredHandsFree.state == .recording(handsFreeID, .handsFree), "Changing shortcuts preserves hands-free recording")
        expect(reconfiguredHandsFree.finish() == .finish(handsFreeID), "Preserved hands-free recording still stops normally")

        var taps = DictationSession()
        let tap = begun(taps.holdPressed(at: 20))
        expect(taps.microphoneReady(for: tap), "Tap can receive permission")
        expect(taps.holdReleased(at: 20.1) == .cancel, "Short tap discards captured audio")
        let locked = begun(taps.holdPressed(at: 20.2))
        expect(taps.mode == .handsFree, "Double tap locks hands-free even after first tap was discarded")
        expect(taps.holdReleased(at: 20.25) == .none, "Releasing a lock cannot stop it")
        expect(taps.holdPressed(at: 20.3) == .cancel, "Third quick press cancels")
        expect(!taps.microphoneReady(for: locked), "Triple-tap cancellation rejects delayed permission")

        var permission = DictationSession()
        let waiting = begun(permission.holdPressed(at: 30))
        expect(permission.holdReleased(at: 31) == .cancel, "Release during authorization must cancel even after a long hold")
        expect(!permission.microphoneReady(for: waiting), "Old permission cannot turn on the microphone later")
        let new = begun(permission.toggle())
        expect(!permission.fail(waiting), "An old denial cannot fail a newer session")
        expect(permission.microphoneReady(for: new), "New permission remains usable")

        var toggle = DictationSession()
        let prioritized = begun(toggle.holdPressed(at: 40))
        expect(toggle.toggle() == .none && toggle.mode == .handsFree, "Space locks the modifier hold instead of stopping it")
        expect(toggle.holdReleased(at: 40.1) == .none, "Modifier release cannot cancel the explicit hands-free shortcut")
        expect(toggle.microphoneReady(for: prioritized), "Locked authorization still starts")
        expect(toggle.toggle() == .finish(prioritized), "Next hands-free shortcut stops")
        expect(toggle.cancel() == .cancel, "Processing can be cancelled")
        expect(!toggle.transcriptReady(for: prioritized), "Cancelled helper cannot paste")

        var delivery = DictationSession()
        let pasted = begun(delivery.toggle())
        expect(delivery.microphoneReady(for: pasted), "Delivery test starts")
        expect(delivery.finish() == .finish(pasted), "Delivery test stops")
        expect(delivery.transcriptReady(for: pasted), "Delivery is pending")
        expect(delivery.cancel() == .cancel, "Pending paste can be cancelled")
        expect(!delivery.deliveryFinished(for: pasted), "Cancelled paste callback is rejected")
        expect(delivery.state != .delivering(pasted), "The callback's insertion guard fails after cancellation")

        var failed = DictationSession()
        let original = begun(failed.toggle())
        expect(failed.microphoneReady(for: original), "Retry test starts")
        expect(failed.finish() == .finish(original), "Retry test processes")
        expect(failed.fail(original), "Failure is recoverable")
        guard case let .retry(attempt) = failed.retry() else { fatalError("Retry not offered") }
        expect(attempt != original, "Retry gets a new identity")
        expect(!failed.transcriptReady(for: original), "Previous attempt cannot complete the retry")
        expect(failed.transcriptReady(for: attempt), "Retry result is accepted")

        let secondary = CGRect(x: -1600, y: 90, width: 1600, height: 850)
        for edge in [DockEdge.bottom, .top, .left, .right] {
            let frame = BarPlacement.frame(size: CGSize(width: 360, height: 88), visible: secondary, edge: edge)
            expect(secondary.contains(frame), "Docked failure panel fits a display with negative origin")
        }
        expect(BarPlacement.nearestEdge(to: CGPoint(x: -1595, y: 500), visible: secondary) == .left, "Drag snaps to left edge")
        expect(BarPlacement.nearestEdge(to: CGPoint(x: -800, y: 95), visible: secondary) == .bottom, "Drag snaps to bottom edge")
        expect(BarPlacement.nearestEdge(to: CGPoint(x: -800, y: 930), visible: secondary) == .top, "Drag snaps to top edge")
        let top = BarPlacement.frame(size: CGSize(width: 200, height: 36), visible: secondary, edge: .top)
        let expanded = BarPlacement.frame(size: CGSize(width: 200, height: 64), visible: secondary, edge: .top)
        expect(top.midX == secondary.midX && top.maxY == secondary.maxY - 12, "Top dock centers the bar below the menu bar")
        expect(expanded.maxY == top.maxY, "A bar docked at the top grows downward")
        let tiny = CGRect(x: 0, y: 0, width: 200, height: 70)
        expect(tiny.contains(BarPlacement.frame(size: CGSize(width: 360, height: 88), visible: tiny, edge: .right)), "Panel size is clamped on a small display")

        var quiet = MicrophoneLevel()
        for _ in 0..<15 { _ = quiet.level(for: -62) }
        expect(quiet.level(for: -48) > 0.6, "Quiet speech 14 dB above the room fills most of the waveform")
        expect(quiet.level(for: -61) < 0.1, "A pause after quiet speech returns the waveform to rest")
        var room = MicrophoneLevel()
        let noise = (0..<45).map { room.level(for: -55 + Float($0 % 3) * 1.5) }
        expect(noise.allSatisfy { $0 < 0.25 }, "Room noise alone stays low instead of being amplified to full height")
        var loud = MicrophoneLevel()
        for _ in 0..<15 { _ = loud.level(for: -50) }
        expect(loud.level(for: -20) > 0.95, "Loud speech reaches full height")
        let softer = loud.level(for: -35)
        expect(softer > 0.3 && softer < 0.7, "Softer syllables after loud speech stay distinguishable")

        let board = NSPasteboard(name: NSPasteboard.Name("einsager-tests-\(UUID())"))
        board.clearContents()
        board.setString("Original clipboard", forType: .string)
        let clipboard = TranscriptClipboard(pasteboard: board)
        expect(!clipboard.stillOwnsClipboard, "A clipboard writer cannot claim content it has not written")
        expect(clipboard.write("Transcript"), "The transcript can be copied for insertion or fallback")
        expect(clipboard.stillOwnsClipboard && board.string(forType: .string) == "Transcript", "Paste owns the new transcript")
        _ = TranscriptClipboard(pasteboard: board).write("Another transcript")
        expect(board.string(forType: .string) == "Another transcript", "The transcript remains after delivery releases its clipboard writer")
        expect(!clipboard.stillOwnsClipboard, "An earlier paste cannot insert a newer transcript")
        let changed = TranscriptClipboard(pasteboard: board)
        expect(changed.write("Pending transcript"), "Pending paste copies its transcript")
        board.clearContents()
        board.setString("User copied something else", forType: .string)
        expect(!changed.stillOwnsClipboard && board.string(forType: .string) == "User copied something else", "Pending paste detects user clipboard changes")
        board.clearContents()
        board.setData(Data([1, 2, 3]), forType: .pdf)
        _ = TranscriptClipboard(pasteboard: board).write("Manual recovery transcript")
        expect(board.string(forType: .string) == "Manual recovery transcript", "Fallback retains the transcript even when the old clipboard contained a PDF")
        board.releaseGlobally()
        print("Passed \(checks) shortcut, session, placement, and clipboard checks")
    }
}
