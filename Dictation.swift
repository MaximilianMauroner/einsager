import AppKit
import AVFoundation
import Carbon

final class DictationApp: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var bar: DictationBar!
    private var session = DictationSession()
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var target: PasteTarget?
    private var process: Process?
    private var lastText = ""
    private var failureMessage = ""
    private var meterTimer: Timer?
    private var stopTimer: Timer?
    private var messageTimer: Timer?
    private var pasteWork: DispatchWorkItem?
    private var hotkeys: [EventHotKeyRef] = []
    private var pressedHotkeys: Set<UInt32> = []
    private let shortcuts = ShortcutSettings()
    private var shortcutInput = ShortcutInput()
    private lazy var shortcutEditor: ShortcutEditor = {
        let editor = ShortcutEditor(settings: shortcuts)
        editor.onChange = { [weak self] in self?.configureShortcuts() }
        editor.onClose = { [weak self] in self?.configureShortcuts() }
        return editor
    }()
    private var shortcutLabel: NSMenuItem!
    private var shortcutsItem: NSMenuItem!
    private var hotkeyHandler: EventHandlerRef?
    private var eventTap: CFMachPort?
    private var eventSource: CFRunLoopSource?
    private var keyboardObserver: NSObjectProtocol?
    /// Whether the registered shortcuts rely on the event tap rather than the Carbon fallback.
    private var tapShortcutsActive = false
    private var keyboardReady: Bool { eventTap.map { CGEvent.tapIsEnabled(tap: $0) } ?? false }
    private var isTerminating = false
    private var heardAudio = false
    private var action: NSMenuItem!
    private var retryItem: NSMenuItem!
    private var copyItem: NSMenuItem!
    private var keyboardItem: NSMenuItem!
    private var barVisibilityItem: NSMenuItem!
    private let recordingLimit: TimeInterval = 20 * 60

    func applicationDidFinishLaunching(_ notification: Notification) {
        let icon = Bundle.main.url(forResource: "einsager-breath", withExtension: "pdf")
            .flatMap { NSImage(contentsOf: $0) } ?? NSImage(systemSymbolName: "mic", accessibilityDescription: "einsager")!
        icon.size = NSSize(width: 18, height: 18)
        icon.isTemplate = true
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = icon
        item.button?.setAccessibilityLabel("einsager dictation")
        let menu = NSMenu()
        shortcutLabel = menu.addItem(withTitle: "einsager", action: nil, keyEquivalent: "")
        action = menu.addItem(withTitle: "Start dictation", action: #selector(toggle), keyEquivalent: "")
        menu.addItem(withTitle: "Cancel dictation", action: #selector(cancel), keyEquivalent: "")
        retryItem = menu.addItem(withTitle: "Retry last recording", action: #selector(retry), keyEquivalent: "")
        copyItem = menu.addItem(withTitle: "Copy last transcript", action: #selector(copyLast), keyEquivalent: "")
        menu.addItem(withTitle: "Allow automatic paste…", action: #selector(requestAccessibility), keyEquivalent: "")
        keyboardItem = menu.addItem(withTitle: "Enable hold-to-talk…", action: #selector(enableKeyboard), keyEquivalent: "")
        shortcutsItem = menu.addItem(withTitle: "Customize shortcuts…", action: #selector(editShortcuts), keyEquivalent: "")
        barVisibilityItem = menu.addItem(withTitle: "Show bar at all times", action: #selector(toggleBarVisibility), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quit), keyEquivalent: "q")
        menu.autoenablesItems = false
        for entry in menu.items { entry.target = self }
        item.menu = menu
        bar = DictationBar(icon: icon)
        bar.onStart = { [weak self] in self?.toggle() }
        bar.onStop = { [weak self] in self?.stop() }
        bar.onCancel = { [weak self] in self?.cancel() }
        bar.onRetry = { [weak self] in self?.retry() }
        bar.onCopy = { [weak self] in self?.copyLast() }
        bar.onCustomizeShortcuts = { [weak self] in self?.editShortcuts() }
        bar.onEnableKeyboard = { [weak self] in self?.enableKeyboard() }
        bar.onVisibilityChange = { [weak self] visible in self?.barVisibilityItem.state = visible ? .on : .off }
        barVisibilityItem.state = bar.showAtAllTimes ? .on : .off
        bar.show()
        installHotkeyHandler()
        installKeyboardTap()
        configureShortcuts()
        keyboardObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.reconnectKeyboard() }
        refresh()
    }

    private func installHotkeyHandler() {
        var events = [EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
                      EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))]
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event = event, let context = context else { return OSStatus(eventNotHandledErr) }
            let app = Unmanaged<DictationApp>.fromOpaque(context).takeUnretainedValue()
            var id = EventHotKeyID()
            guard GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                    nil, MemoryLayout<EventHotKeyID>.size, nil, &id) == noErr else { return OSStatus(eventNotHandledErr) }
            if app.shortcutEditor.isVisible { return noErr }
            if GetEventKind(event) == UInt32(kEventHotKeyReleased) {
                app.pressedHotkeys.remove(id.id)
                if id.id == 2 { app.perform(app.session.holdReleased(at: ProcessInfo.processInfo.systemUptime)) }
            } else if app.pressedHotkeys.insert(id.id).inserted {
                if id.id == 2 { app.perform(app.session.holdPressed(at: ProcessInfo.processInfo.systemUptime)) }
                else { app.toggle() }
            }
            return noErr
        }, events.count, &events, Unmanaged.passUnretained(self).toOpaque(), &hotkeyHandler)
    }

    private func configureShortcuts() {
        perform(session.shortcutsWillChange())
        shortcutInput.reset()
        pressedHotkeys.removeAll()
        for hotkey in hotkeys { UnregisterEventHotKey(hotkey) }
        hotkeys.removeAll()
        var registrationFailed = false
        tapShortcutsActive = keyboardReady
        // Carbon keeps existing users' shortcut available when keyboard permission is absent.
        if !tapShortcutsActive {
            let bindings: [(UInt32, KeyBinding)] = [(1, .legacyHandsFree), (2, shortcuts.hold), (3, shortcuts.handsFree)]
            for (id, binding) in bindings {
                if id == 3 && binding == .legacyHandsFree { continue }
                guard let key = binding.keyCode, let modifiers = binding.carbonModifiers else { continue }
                var reference: EventHotKeyRef?
                let result = RegisterEventHotKey(UInt32(key), modifiers, EventHotKeyID(signature: 0x43445844, id: id),
                                                GetApplicationEventTarget(), 0, &reference)
                if result == noErr, let reference = reference { hotkeys.append(reference) }
                else { registrationFailed = true }
            }
        }
        bar.surface.holdHint = shortcuts.hold.displayName
        bar.surface.handsFreeHint = shortcuts.handsFree.displayName
        refresh()
        if registrationFailed { showMessage("Shortcut in use. Enable keyboard access or choose another.") }
    }

    @objc private func editShortcuts() {
        guard session.canStart else { return }
        shortcutInput.reset()
        for hotkey in hotkeys { UnregisterEventHotKey(hotkey) }
        hotkeys.removeAll()
        shortcutEditor.show()
    }

    /// Creates the keyboard listener, or re-enables one the system disabled.
    private func installKeyboardTap() {
        if let eventTap = eventTap {
            CGEvent.tapEnable(tap: eventTap, enable: true)
            return
        }
        let mask = (CGEventMask(1) << CGEventType.flagsChanged.rawValue) | (CGEventMask(1) << CGEventType.keyDown.rawValue) | (CGEventMask(1) << CGEventType.keyUp.rawValue)
        eventTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
            eventsOfInterest: mask, callback: { _, type, event, context in
                guard let context = context else { return Unmanaged.passUnretained(event) }
                let app = Unmanaged<DictationApp>.fromOpaque(context).takeUnretainedValue()
                return app.handleKeyboard(type, event: event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        guard let eventTap = eventTap else { return }
        eventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        if let eventSource = eventSource { CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, .commonModes) }
        CGEvent.tapEnable(tap: eventTap, enable: true)
    }

    /// Follows Accessibility changes made while the app runs, without ending an active dictation.
    private func reconnectKeyboard() {
        guard session.canStart, !shortcutEditor.isVisible else { return }
        if !keyboardReady, AXIsProcessTrusted() { installKeyboardTap() }
        if keyboardReady != tapShortcutsActive { configureShortcuts() }
    }

    private func handleKeyboard(_ type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap = eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            shortcutInput.reset()
            if session.mode == .hold { cancel() }
            return Unmanaged.passUnretained(event)
        }
        guard !shortcutEditor.isVisible else { return Unmanaged.passUnretained(event) }
        let input: ShortcutInput.Event
        switch type {
        case .flagsChanged: input = .modifiers
        case .keyDown: input = .down
        case .keyUp: input = .up
        default: return Unmanaged.passUnretained(event)
        }
        let result = shortcutInput.handle(input, keyCode: UInt16(event.getIntegerValueField(.keyboardEventKeycode)),
            flags: event.flags, repeatKey: event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
            hold: shortcuts.hold, handsFree: shortcuts.handsFree, active: !session.canStart)
        switch result.action {
        case .holdPressed: perform(session.holdPressed(at: ProcessInfo.processInfo.systemUptime))
        case .holdReleased: perform(session.holdReleased(at: ProcessInfo.processInfo.systemUptime))
        case .toggle: toggle()
        case .cancel: cancel()
        case nil: break
        }
        if result.consume { return nil }
        return Unmanaged.passUnretained(event)
    }

    @objc private func toggle() { perform(session.toggle()) }
    private func stop() { perform(session.finish()) }
    @objc private func cancel() { perform(session.cancel()) }
    @objc private func retry() {
        guard recordingURL != nil else { return }
        perform(session.retry())
    }

    private func perform(_ action: DictationSession.Action) {
        switch action {
        case .none:
            if session.mode != nil { refresh() }
        case .cancel:
            discardRecording()
            pasteWork?.cancel()
            pasteWork = nil
            showMessage("Dictation cancelled")
        case .begin(let id):
            discardRecording()
            heardAudio = false
            target = PasteTarget.capture()
            failureMessage = ""
            refresh()
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self = self, !self.isTerminating, self.session.id == id else { return }
                    if granted && self.session.microphoneReady(for: id) { self.startRecording(id) }
                    else { self.fail(id, "Allow microphone access in System Settings → Privacy & Security → Microphone.") }
                }
            }
        case .finish(let id): finishRecording(id)
        case .retry(let id): transcribe(id)
        }
    }

    private func refresh() {
        messageTimer?.invalidate()
        messageTimer = nil
        let display: DictationBar.Display
        let status: String
        switch session.state {
        case .idle: display = .idle; status = "Ready"
        case .requesting:
            status = AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined
                ? "Allow microphone access…" : "Starting microphone…"
            display = .requesting(status)
        case .recording(_, let mode): display = .recording(handsFree: mode == .handsFree); status = "Recording"
        case .processing, .delivering: display = .processing; status = "Transcribing"
        case .failed: display = .failure(failureMessage); status = failureMessage
        }
        bar.render(display)
        bar.surface.keyboardEnabled = keyboardReady
        bar.surface.canRetry = recordingURL != nil
        bar.surface.canCopy = !lastText.isEmpty
        item.button?.toolTip = "einsager: " + status
        action.title = session.mode != nil ? "Stop and transcribe" : "Start dictation"
        action.isEnabled = session.canStart || session.mode != nil
        retryItem.isEnabled = recordingURL != nil && { if case .failed = session.state { return true }; return false }()
        copyItem.isEnabled = !lastText.isEmpty
        shortcutsItem.isEnabled = session.canStart
        shortcutLabel.title = "einsager · hold " + shortcuts.hold.displayName + " / hands-free " + shortcuts.handsFree.displayName
        keyboardItem.isEnabled = !keyboardReady
        keyboardItem.title = keyboardReady ? "Keyboard shortcuts enabled" : "Enable hold-to-talk…"
    }

    private func showMessage(_ text: String) {
        refresh()
        bar.render(.message(text))
        item.button?.toolTip = "einsager: " + text
        messageTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in self?.refresh() }
    }

    private func startRecording(_ id: UUID) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("einsager-\(id).m4a")
        do {
            let audio = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 32000, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ])
            audio.isMeteringEnabled = true
            guard audio.record() else { throw NSError(domain: "Recording", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Microphone recording could not start."]) }
            recordingURL = url
            recorder = audio
            bar.surface.waveform.levels = Array(repeating: 0, count: 9)
            refresh()
            meterTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 15, repeats: true) { [weak self] _ in
                guard let self = self, let recorder = self.recorder else { return }
                recorder.updateMeters()
                if recorder.peakPower(forChannel: 0) > -65 { self.heardAudio = true }
                let level = CGFloat(pow(10, Double(recorder.averagePower(forChannel: 0)) / 30))
                self.bar.updateLevel(level, elapsed: recorder.currentTime, limit: self.recordingLimit)
            }
            stopTimer = Timer.scheduledTimer(withTimeInterval: recordingLimit, repeats: false) { [weak self] _ in self?.stop() }
        } catch {
            try? FileManager.default.removeItem(at: url)
            fail(id, error.localizedDescription)
        }
    }

    private func stopAudio() {
        recorder?.stop()
        recorder = nil
        meterTimer?.invalidate()
        meterTimer = nil
        stopTimer?.invalidate()
        stopTimer = nil
    }

    private func finishRecording(_ id: UUID) {
        let duration = recorder?.currentTime ?? 0
        stopAudio()
        guard duration >= 0.5 else {
            _ = session.cancel()
            discardRecording()
            showMessage("Hold " + shortcuts.hold.displayName + " to talk, or click for hands-free")
            return
        }
        guard heardAudio else {
            _ = session.cancel()
            discardRecording()
            showMessage("No microphone audio. Check your input device.")
            return
        }
        transcribe(id)
    }

    private func transcribe(_ id: UUID) {
        guard let url = recordingURL else { fail(id, "No recording to retry. Start a new dictation."); return }
        refresh()
        let task = Process()
        let output = Pipe()
        guard let helper = Bundle.main.url(forAuxiliaryExecutable: "einsager-transcribe") else {
            fail(id, "The transcription helper is missing. Rebuild einsager.")
            return
        }
        task.executableURL = helper
        task.arguments = [url.path]
        task.standardOutput = output
        task.standardError = FileHandle.nullDevice
        process = task
        do { try task.run() }
        catch { process = nil; fail(id, "Could not start transcription. Rebuild einsager."); return }
        DispatchQueue.global(qos: .userInitiated).async {
            let data = output.fileHandleForReading.readDataToEndOfFile()
            task.waitUntilExit()
            let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
            DispatchQueue.main.async {
                guard !self.isTerminating, self.session.state == .processing(id) else { return }
                self.process = nil
                if task.terminationStatus == 0, let text = result?["text"] {
                    guard self.session.transcriptReady(for: id) else { return }
                    self.deleteAudioFile()
                    self.deliver(text, id: id)
                } else { self.fail(id, result?["error"] ?? "Transcription failed. Retry or discard this recording.") }
            }
        }
    }

    private func fail(_ id: UUID, _ message: String) {
        guard session.fail(id) else { return }
        stopAudio()
        failureMessage = message
        refresh()
    }

    private func deleteAudioFile() {
        if let url = recordingURL { try? FileManager.default.removeItem(at: url) }
        recordingURL = nil
    }

    private func discardRecording() {
        stopAudio()
        if let process = process, process.isRunning { process.terminate() }
        process = nil
        deleteAudioFile()
    }

    private func deliver(_ text: String, id: UUID) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            _ = session.deliveryFinished(for: id)
            showMessage("No speech detected")
            return
        }
        lastText = text
        copyItem.isEnabled = true
        let clipboard = TranscriptClipboard()
        guard clipboard.write(text) else {
            _ = session.deliveryFinished(for: id)
            showMessage("Clipboard unavailable. Use Copy last to retry.")
            return
        }
        guard let target = target, target.isStillFocused else {
            _ = session.deliveryFinished(for: id)
            showMessage("Copied. Press ⌘V in your text field.")
            return
        }
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.session.state == .delivering(id) else { return }
            guard target.isStillFocused, clipboard.stillOwnsClipboard else {
                _ = self.session.deliveryFinished(for: id)
                self.showMessage(clipboard.stillOwnsClipboard ? "Copied. Press ⌘V in your text field." : "Clipboard changed. Use Copy last.")
                return
            }
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false) else {
                _ = self.session.deliveryFinished(for: id)
                self.showMessage("Copied. Press ⌘V to paste.")
                return
            }
            down.flags = .maskCommand
            up.flags = .maskCommand
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            _ = self.session.deliveryFinished(for: id)
            self.showMessage("Paste sent. Text is also on the clipboard.")
        }
        pasteWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    @objc private func copyLast() {
        guard !lastText.isEmpty else { return }
        if !TranscriptClipboard().write(lastText) { showMessage("Clipboard unavailable. Try Copy last again.") }
    }

    @objc private func toggleBarVisibility() { bar.showAtAllTimes.toggle() }

    @objc private func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        installKeyboardTap()
        configureShortcuts()
    }

    @objc private func enableKeyboard() {
        requestAccessibility()
        if !keyboardReady { showMessage("Allow Accessibility, then select Enable hold-to-talk again.") }
    }

    @objc private func quit() { NSApplication.shared.terminate(nil) }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        _ = session.cancel()
        discardRecording()
        messageTimer?.invalidate()
        pasteWork?.cancel()
        bar.close()
        for hotkey in hotkeys { UnregisterEventHotKey(hotkey) }
        if let hotkeyHandler = hotkeyHandler { RemoveEventHandler(hotkeyHandler) }
        if let eventSource = eventSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), eventSource, .commonModes) }
        if let eventTap = eventTap { CFMachPortInvalidate(eventTap) }
        if let keyboardObserver = keyboardObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(keyboardObserver)
        }
    }
}

@main
struct Einsager {
    static func main() {
        let app = NSApplication.shared
        let delegate = DictationApp()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
