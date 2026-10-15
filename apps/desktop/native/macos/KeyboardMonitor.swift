import AppKit
import Carbon

/// Global shortcuts and paste for the app on macOS. Electron cannot see Fn or key releases, so this
/// helper runs the shortcut logic in `KeyboardShortcuts.swift` in an event tap and reports to the main process.
/// It also sends the paste keys, because the same Accessibility access lets it check the focused text field.
///
/// Runs in the native app or the Electron keyboard helper. All callbacks use the main thread.
final class KeyboardMonitor {
    var output: ([String: Any]) -> Void = { _ in }
    var excludedPID = getpid()

    /// Shortcuts persist in the helper's own domain; the app's settings.json does not hold them.
    private let settings = ShortcutSettings(defaults: UserDefaults(suiteName: "local.max.einsager.keys") ?? .standard)
    var active = false
    private var input = ShortcutInput()
    private var tap: CFMachPort?
    /// The binding being recorded: true for hold-to-talk, false for hands-free.
    private var capturing: Bool?
    private var pendingModifiers: CGEventFlags = []
    private var problem: String?
    private var trustTimer: Timer?
    /// The app and text field that had focus when the latest recording began, so a paste never lands elsewhere.
    private var pasteTarget: (id: String, target: PasteTarget)?

    func start() {
        installTap()
        if tap == nil { waitForTrust() }
        _ = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification,
            object: nil, queue: .main) { [weak self] _ in self?.checkTrust() }
        report()
    }

    func perform(_ message: [String: String]) {
        switch message["command"] {
        case "capture":
            guard tap != nil, let target = message["target"], ["hold", "handsFree"].contains(target) else { return }
            capturing = target == "hold"
            pendingModifiers = []
            problem = nil
            // Capture keeps every key from the input, including the release of a key held now.
            discardInput()
        case "stopCapture":
            capturing = nil
            problem = nil
        case "reset":
            capturing = nil
            problem = nil
            settings.reset()
            discardInput()
        case "target":
            guard let id = message["id"] else { return }
            pasteTarget = PasteTarget.capture(excludingPID: excludedPID).map { (id: id, target: $0) }
            write(["event": "reply", "id": id, "ok": pasteTarget != nil])
            return
        case "paste":
            guard let id = message["id"] else { return }
            write(["event": "reply", "id": id, "ok": paste(into: id)])
            return
        case "prompt":
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            // macOS shows that prompt only once per app, so also open the list where access is turned on.
            if let pane = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                NSWorkspace.shared.open(pane)
            }
        default:
            return
        }
        report()
    }

    /// Creates the listener once Accessibility allows it. Until then the app uses its Electron fallback shortcut.
    private func installTap() {
        guard tap == nil, AXIsProcessTrusted() else { return }
        let mask = (CGEventMask(1) << CGEventType.flagsChanged.rawValue) | (CGEventMask(1) << CGEventType.keyDown.rawValue)
            | (CGEventMask(1) << CGEventType.keyUp.rawValue)
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
            eventsOfInterest: mask, callback: { _, type, event, context in
                guard let context = context else { return Unmanaged.passUnretained(event) }
                return Unmanaged<KeyboardMonitor>.fromOpaque(context).takeUnretainedValue().handle(type, event: event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        guard let tap = tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else { return }
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    /// Checks every two seconds, only while access is missing, so a grant takes effect without a restart.
    private func waitForTrust() {
        guard tap == nil, trustTimer == nil else { return }
        trustTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
            guard let self = self else { return }
            self.installTap()
            guard self.tap != nil else { return }
            timer.invalidate()
            self.trustTimer = nil
            self.report()
        }
    }

    /// Accessibility can be revoked while the tap runs. An app switch is a cheap moment to notice,
    /// so the app's fallback shortcut takes over again until access returns.
    private func checkTrust() {
        guard let tap = tap, !AXIsProcessTrusted() else { return }
        // Invalidating the port also invalidates its run-loop source.
        CFMachPortInvalidate(tap)
        self.tap = nil
        capturing = nil
        problem = nil
        discardInput()
        report()
        waitForTrust()
    }

    /// Forgets held keys. A held key's release can no longer end its hold, so the app cancels the hold.
    private func discardInput() {
        input.reset()
        emit(action: "interrupted")
    }

    private func handle(_ type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap = tap { CGEvent.tapEnable(tap: tap, enable: true) }
            discardInput()
            return Unmanaged.passUnretained(event)
        }
        let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
        if let hold = capturing { return capture(type, event: event, keyCode: keyCode, hold: hold) }
        let kind: ShortcutInput.Event
        switch type {
        case .flagsChanged: kind = .modifiers
        case .keyDown: kind = .down
        case .keyUp: kind = .up
        default: return Unmanaged.passUnretained(event)
        }
        // Escape stays with the app's own shortcut, so `active` is false here.
        let result = input.handle(kind, keyCode: keyCode, flags: event.flags,
            repeatKey: event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
            hold: settings.hold, handsFree: settings.handsFree, active: active)
        switch result.action {
        case .holdPressed: emit(action: "holdPressed")
        case .holdReleased: emit(action: "holdReleased")
        case .holdInterrupted: emit(action: "interrupted")
        case .toggle: emit(action: "toggle")
        case .cancel: emit(action: "cancel")
        case nil: break
        }
        return result.consume ? nil : Unmanaged.passUnretained(event)
    }

    /// Records the next shortcut. Keys pressed meanwhile reach no app.
    private func capture(_ type: CGEventType, event: CGEvent, keyCode: UInt16, hold: Bool) -> Unmanaged<CGEvent>? {
        if type == .keyUp { return nil }
        if type == .keyDown && keyCode == UInt16(kVK_Escape) {
            capturing = nil
            report()
            return nil
        }
        let flags = event.flags.intersection(KeyBinding.supportedFlags)
        if type == .flagsChanged {
            pendingModifiers.formUnion(flags)
            if flags == [] && pendingModifiers != [] {
                commit(KeyBinding(modifiers: pendingModifiers.rawValue, keyCode: nil, keyName: ""), hold: hold)
            }
            return nil
        }
        guard type == .keyDown, event.getIntegerValueField(.keyboardEventAutorepeat) == 0 else { return nil }
        let name = keyCode == UInt16(kVK_Space) ? "Space"
            : NSEvent(cgEvent: event)?.charactersIgnoringModifiers?.uppercased() ?? "Key \(keyCode)"
        commit(KeyBinding(modifiers: flags.rawValue, keyCode: keyCode, keyName: name), hold: hold)
        return nil
    }

    private func commit(_ binding: KeyBinding, hold: Bool) {
        pendingModifiers = []
        if let error = settings.save(binding, hold: hold) {
            problem = error
        } else {
            capturing = nil
            problem = nil
        }
        report()
    }

    private func report() {
        let target: Any = capturing.map { $0 ? "hold" : "handsFree" } ?? NSNull()
        write(["event": "state", "trusted": tap != nil, "hold": settings.hold.displayName,
               "handsFree": settings.handsFree.displayName, "capturing": target, "error": problem ?? NSNull()])
    }

    private func emit(action: String) { write(["event": "action", "action": action]) }

    /// Sends Command+V only while the recording's app and text field still have focus.
    private func paste(into id: String) -> Bool {
        guard let current = pasteTarget, current.id == id else { return false }
        return current.target.paste()
    }

    private func write(_ object: [String: Any]) {
        output(object)
    }
}

/// The focused app and accessibility element. Comparing them later shows whether the user moved elsewhere.
struct PasteTarget {
    let application: NSRunningApplication
    let element: AXUIElement

    /// Returns nothing without Accessibility access, for einsager itself, or when no element has focus.
    static func capture(excludingPID: pid_t) -> PasteTarget? {
        // The helper's parent is the einsager app, whose own windows are never a paste target.
        guard AXIsProcessTrusted(), let application = NSWorkspace.shared.frontmostApplication,
              application.processIdentifier != excludingPID,
              let element = focusedElement(in: application) else { return nil }
        return PasteTarget(application: application, element: element)
    }

    var isStillFocused: Bool {
        guard AXIsProcessTrusted(), !application.isTerminated,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier,
              let current = Self.focusedElement(in: application) else { return false }
        return CFEqual(element, current)
    }

    func paste() -> Bool {
        guard isStillFocused,
              let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: false) else { return false }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return true
    }

    private static func focusedElement(in application: NSRunningApplication) -> AXUIElement? {
        let app = AXUIElementCreateApplication(application.processIdentifier)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &value) == .success,
              let value = value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        // AX guarantees this type after the type-ID check.
        return unsafeBitCast(value, to: AXUIElement.self)
    }
}
