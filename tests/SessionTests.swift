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
        for edge in [DockEdge.bottom, .left, .right] {
            let frame = BarPlacement.frame(size: CGSize(width: 360, height: 88), visible: secondary, edge: edge)
            expect(secondary.contains(frame), "Docked failure panel fits a display with negative origin")
        }
        expect(BarPlacement.nearestEdge(to: CGPoint(x: -1595, y: 500), visible: secondary) == .left, "Drag snaps to left edge")
        expect(BarPlacement.nearestEdge(to: CGPoint(x: -800, y: 95), visible: secondary) == .bottom, "Drag snaps to bottom edge")
        let tiny = CGRect(x: 0, y: 0, width: 200, height: 70)
        expect(tiny.contains(BarPlacement.frame(size: CGSize(width: 360, height: 88), visible: tiny, edge: .right)), "Panel size is clamped on a small display")

        let board = NSPasteboard(name: NSPasteboard.Name("einsager-tests-\(UUID())"))
        board.clearContents()
        board.setString("Original clipboard", forType: .string)
        let lease = ClipboardLease(pasteboard: board)
        lease.write("Transcript")
        expect(board.string(forType: .string) == "Transcript", "Paste owns the new transcript")
        expect(lease.restore() && board.string(forType: .string) == "Original clipboard", "Safe restore preserves original text")
        expect(!lease.restore(), "A lease cannot restore twice")
        let changed = ClipboardLease(pasteboard: board)
        changed.write("Another transcript")
        board.clearContents()
        board.setString("User copied something else", forType: .string)
        expect(!changed.restore() && board.string(forType: .string) == "User copied something else", "Clipboard changes are never overwritten by delayed restore")
        board.clearContents()
        board.setData(Data([1, 2, 3]), forType: .pdf)
        let unsupported = ClipboardLease(pasteboard: board)
        unsupported.write("Manual recovery transcript")
        expect(!unsupported.restore(), "Unsupported clipboard data is not falsely restored")
        board.releaseGlobally()
        print("Passed \(checks) shortcut, session, placement, and clipboard checks")
    }
}
