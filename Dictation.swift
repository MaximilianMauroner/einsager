import AppKit
import AVFoundation
import Carbon

final class DictationApp: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var hotkey: EventHotKeyRef?
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var target: NSRunningApplication?
    private var process: Process?
    private var busy = false
    private var lastText = ""
    private var stopTimer: Timer?
    private var action: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.addItem(withTitle: "einsager · ⌃⌥Space", action: nil, keyEquivalent: "")
        action = menu.addItem(withTitle: "Start dictation", action: #selector(toggle), keyEquivalent: "")
        menu.addItem(withTitle: "Copy last transcript", action: #selector(copyLast), keyEquivalent: "")
        menu.addItem(withTitle: "Allow automatic paste…", action: #selector(requestAccessibility), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quit), keyEquivalent: "q")
        for entry in menu.items { entry.target = self }
        item.menu = menu
        update("Ready")

        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context = context else { return OSStatus(eventNotHandledErr) }
            let app = Unmanaged<DictationApp>.fromOpaque(context).takeUnretainedValue()
            app.toggle()
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), nil)
        let id = EventHotKeyID(signature: 0x43445844, id: 1)
        let result = RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | optionKey), id,
                                        GetApplicationEventTarget(), 0, &hotkey)
        if result != noErr { showError("The hotkey is already in use. Use Start dictation from the menu.") }
    }

    private func update(_ status: String) {
        item.button?.title = recorder != nil ? "● REC" : busy ? "einsager …" : "einsager"
        item.button?.toolTip = "einsager: " + status
        action.title = recorder != nil ? "Stop and transcribe" : busy ? "Transcribing…" : "Start dictation"
        action.isEnabled = !busy
    }

    @objc func toggle() {
        guard !busy else { return }
        if recorder != nil { finishRecording(); return }
        target = NSWorkspace.shared.frontmostApplication
        busy = true
        update("Requesting microphone")
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async {
                self.busy = false
                if granted { self.startRecording() }
                else { self.showError("Allow microphone access for einsager in System Settings → Privacy & Security → Microphone.") }
            }
        }
    }

    private func startRecording() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("codex-dictation-\(UUID().uuidString).wav")
        do {
            let audio = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 16000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false
            ])
            guard audio.record() else { throw NSError(domain: "Recording", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Microphone recording could not start."]) }
            recordingURL = url
            recorder = audio
            update("Recording; press ⌃⌥Space to stop")
            stopTimer = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { _ in self.finishRecording() }
        } catch {
            try? FileManager.default.removeItem(at: url)
            showError(error.localizedDescription)
        }
    }

    private func finishRecording() {
        guard let audio = recorder, let url = recordingURL else { return }
        let duration = audio.currentTime
        audio.stop()
        recorder = nil
        stopTimer?.invalidate()
        stopTimer = nil
        if duration < 0.4 {
            try? FileManager.default.removeItem(at: url)
            recordingURL = nil
            update("Recording too short")
            return
        }
        busy = true
        update("Transcribing")
        let task = Process()
        let output = Pipe()
        guard let script = Bundle.main.url(forResource: "transcribe", withExtension: "py"),
              let python = Bundle.main.object(forInfoDictionaryKey: "DictationPython") as? String else {
            cleanupRecording()
            showError("The app is missing its transcription helper. Rebuild the app.")
            return
        }
        task.executableURL = URL(fileURLWithPath: python)
        task.arguments = [script.path, url.path]
        task.standardOutput = output
        task.standardError = FileHandle.nullDevice
        process = task
        do { try task.run() }
        catch {
            cleanupRecording()
            showError("Could not start the transcription helper: " + error.localizedDescription)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let data = output.fileHandleForReading.readDataToEndOfFile()
            task.waitUntilExit()
            let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
            DispatchQueue.main.async {
                self.process = nil
                self.cleanupRecording()
                if task.terminationStatus == 0, let text = result?["text"] {
                    self.deliver(text)
                } else {
                    self.showError(result?["error"] ?? "The transcription helper failed.")
                }
            }
        }
    }

    private func cleanupRecording() {
        if let url = recordingURL { try? FileManager.default.removeItem(at: url) }
        recordingURL = nil
        busy = false
    }

    private func deliver(_ text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            update("No speech detected")
            return
        }
        lastText = text
        copyLast()
        guard AXIsProcessTrusted(), let app = target, !app.isTerminated,
              app.processIdentifier != ProcessInfo.processInfo.processIdentifier else {
            update("Copied; press Command+V to paste")
            return
        }
        app.activate(options: [])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
                self.update("Copied; target app is not focused")
                return
            }
            let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true)
            let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false)
            down?.flags = .maskCommand
            up?.flags = .maskCommand
            down?.post(tap: .cghidEventTap)
            up?.post(tap: .cghidEventTap)
            self.update("Pasted; last transcript available in menu")
        }
    }

    @objc func copyLast() {
        guard !lastText.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lastText, forType: .string)
    }

    @objc func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    private func showError(_ message: String) {
        busy = false
        update("Error")
        let alert = NSAlert()
        alert.messageText = "einsager"
        alert.informativeText = message
        alert.runModal()
    }

    @objc func quit() { NSApplication.shared.terminate(nil) }

    func applicationWillTerminate(_ notification: Notification) {
        stopTimer?.invalidate()
        recorder?.stop()
        if let task = process, task.isRunning { task.terminate() }
        cleanupRecording()
        if let key = hotkey { UnregisterEventHotKey(key) }
    }
}

let app = NSApplication.shared
let delegate = DictationApp()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
