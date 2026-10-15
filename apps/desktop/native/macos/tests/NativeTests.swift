import AppKit
import AudioToolbox

/// Compiled only into the test executable. It uses private pasteboards, synthetic PCM, and hidden views.
@main
enum NativeTests {
    static func main() throws {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        NSApp.finishLaunching()
        umask(0o077)
        let profile = URL(fileURLWithPath: CommandLine.arguments[1])
        let helper = URL(fileURLWithPath: CommandLine.arguments[2])
        let driver = try NativeTestDriver(profile: profile, helper: helper)
        driver.start()
        withExtendedLifetime(driver) { CFRunLoopRun() }
    }
}

final class NativeTestDriver {
    let session: NativeSession
    private var recording: PCMRecording?
    private var ui: NativeUI?
    private let keyboard = KeyboardMonitor()
    private var buffer = Data()
    private var permission: ((Bool) -> Void)?
    private var deferPermission = false
    private let board: NSPasteboard

    init(profile: URL, helper: URL) throws {
        let board = NSPasteboard(name: NSPasteboard.Name("einsager-native-test-\(UUID())"))
        self.board = board
        session = NativeSession(store: NativeStore(directory: profile), helper: helper, delivery: NativeDelivery(board: board))
        session.captureTarget = { nil }
        session.requestPermission = { [weak self] callback in
            guard let self else { return }
            if self.deferPermission { self.permission = callback } else { callback(true) }
        }
        session.makeRecorder = { [weak self] url, _ in
            let recording = try PCMRecording(url: url)
            self?.recording = recording
            return recording
        }
        session.onChange = { [weak self] in
            guard let self else { return }
            autoreleasepool {
                self.ui?.refresh()
                self.write(["event": "state", "state": self.state()])
            }
        }
    }

    func start() {
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            DispatchQueue.main.async {
                guard let self else { return }
                guard !data.isEmpty else { self.session.shutdown(); exit(0) }
                self.buffer.append(data)
                while let end = self.buffer.firstIndex(of: 10) {
                    let line = self.buffer[self.buffer.startIndex..<end]
                    self.buffer.removeSubrange(self.buffer.startIndex...end)
                    do {
                        guard let command = try JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
                        autoreleasepool { self.receive(command) }
                    } catch { self.write(["error": error.localizedDescription]) }
                }
            }
        }
        write(["event": "ready", "driver": "EINSAGER_NATIVE_TEST_DRIVER", "state": state()])
    }

    private func state() -> [String: Any] {
        ["phase": session.phase.rawValue, "message": session.message, "retryable": session.retryable,
         "history": session.store.history.map { ["id": $0.id, "text": $0.text, "seconds": $0.seconds, "voiceprint": $0.voiceprint] as [String: Any] },
         "settings": session.store.settings, "lastText": session.delivery.lastText,
         "recordingSeconds": recording?.snapshot().seconds ?? 0,
         "recordingFolder": session.transcription.directory?.path ?? ""]
    }

    private func receive(_ command: [String: Any]) {
        let name = command["command"] as? String ?? ""
        var result: [String: Any] = [:]
        do {
            switch name {
            case "start": session.start(hold: command["hold"] as? Bool ?? false)
            case "append": append(seconds: min(601, max(0, command["seconds"] as? Double ?? 1)))
            case "toggle", "finish", "cancel", "retry", "copy", "holdPressed", "holdReleased", "interrupted": session.act(name)
            case "settings":
                if let values = command["values"] as? [String: Any] { for (key, value) in values { session.store.update(key, value) } }
            case "addHistory":
                for index in 0..<min(500, max(1, command["count"] as? Int ?? 1)) {
                    session.store.add((command["text"] as? String ?? "Fixture") + " \(index)", seconds: 1, voiceprint: [0, 0.5, 1])
                }
            case "removeHistory":
                if let id = command["entry"] as? String { session.store.remove(id) }
            case "clearHistory": session.store.clear(); session.delivery.forget()
            case "permissionWait": deferPermission = true
            case "permissionReply": permission?(command["allowed"] as? Bool ?? true); permission = nil; deferPermission = false
            case "uiPress":
                let label = command["label"] as? String ?? ""
                let control = ui?.panel.contentView.flatMap { descendants($0).first { !$0.isHiddenOrHasHiddenAncestor && $0.accessibilityLabel() == label } } as? ActionButton
                guard let control, control.accessibilityPerformPress() else { throw AudioFailure(message: "UI control unavailable: \(label)") }
                ui?.panel.contentView?.layoutSubtreeIfNeeded()
            case "uiSearch":
                let field = ui?.panel.contentView.flatMap { descendants($0).compactMap { $0 as? NSTextField }.first { $0.accessibilityLabel() == "Search transcripts" } }
                guard let field else { throw AudioFailure(message: "Search is not open") }
                field.stringValue = command["query"] as? String ?? ""
                ui?.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: field))
                ui?.panel.contentView?.layoutSubtreeIfNeeded()
            case "uiInspect":
                let views = ui?.panel.contentView.map(descendants) ?? []
                result["rows"] = views.compactMap { $0 as? NSTableView }.first?.numberOfRows ?? 0
                result["transcripts"] = views.compactMap { $0 as? NSTextView }.filter { !$0.isHidden }.map(\.string)
                result["controls"] = views.compactMap { $0 as? ActionButton }.filter { !$0.isHidden }.map(\.title)
            case "uiAccessibility":
                guard let table = ui?.panel.contentView.map(descendants).flatMap({ $0.compactMap { $0 as? NSTableView }.first }) else { throw AudioFailure(message: "History is not open") }
                func materialized() -> Int { (0..<table.numberOfRows).filter { table.view(atColumn: 0, row: $0, makeIfNecessary: false) != nil }.count }
                result["before"] = materialized()
                let rows = table.accessibilityRows() ?? []
                var texts: [String] = []
                for row in rows.compactMap({ $0 as? NSAccessibilityElement }) {
                    for child in row.accessibilityChildren() ?? [] {
                        if let view = child as? NSTextView { texts.append(view.string) }
                        else if let element = child as? NSAccessibilityElement, element.accessibilityRole() == .staticText,
                                let text = element.accessibilityValue() as? String { texts.append(text) }
                    }
                }
                _ = table.accessibilityColumns(); _ = table.accessibilityVisibleCells(); _ = table.accessibilityChildren()
                // Full hierarchy clients use AppKit's older ranged API, even with modern overrides.
                let legacy = table.accessibilityArrayAttributeValues(.rows, index: 0, maxCount: Int.max)
                let children = table.accessibilityArrayAttributeValues(.children, index: 0, maxCount: Int.max)
                result["legacyModels"] = legacy.count == rows.count && children.count == rows.count &&
                    zip(legacy, rows).allSatisfy { ($0 as AnyObject) === ($1 as AnyObject) } &&
                    zip(children, rows).allSatisfy { ($0 as AnyObject) === ($1 as AnyObject) }
                result["legacyCount"] = table.accessibilityArrayAttributeCount(.rows)
                result["legacyBounds"] = table.accessibilityArrayAttributeValues(.rows, index: rows.count, maxCount: Int.max).isEmpty &&
                    table.accessibilityArrayAttributeValues(.rows, index: 0, maxCount: 0).isEmpty
                var noMockCells = true
                func walk(_ objects: [Any], depth: Int) {
                    for value in objects {
                        let name = String(describing: type(of: value))
                        if name.contains("NSTableRow") || name.contains("MockElement") { noMockCells = false }
                        if depth > 0, let object = value as? NSObject {
                            let count = object.accessibilityArrayAttributeCount(.children)
                            walk(object.accessibilityArrayAttributeValues(.children, index: 0, maxCount: count), depth: depth - 1)
                        }
                    }
                }
                let attributes: [NSAccessibility.Attribute] = [.children, .rows, .visibleRows, .visibleChildren,
                    .selectedRows, .selectedChildren, .selectedCells, .visibleCells, .columns, .visibleColumns,
                    .selectedColumns, .columnHeaderUIElements]
                for attribute in attributes {
                    let count = table.accessibilityArrayAttributeCount(attribute)
                    walk(table.accessibilityArrayAttributeValues(attribute, index: 0, maxCount: count), depth: 2)
                }
                result["legacyNoMockCells"] = noMockCells
                result["texts"] = texts; result["after"] = materialized()
                if command["deleteOffscreen"] as? Bool == true, let row = rows.dropFirst().first as? NSAccessibilityElement {
                    let button = row.accessibilityChildren()?.compactMap { $0 as? NSAccessibilityElement }.first { $0.accessibilityLabel() == "Delete" }
                    result["deletedOffscreen"] = button?.accessibilityPerformPress() ?? false
                }
            case "render":
                if ui == nil { ui = NativeUI(session: session, keyboard: keyboard) }
                ui?.keyboardState = ["trusted": true, "hold": "Fn", "handsFree": "Fn+Space"]
                if command["view"] as? String == "settings" { ui?.showSettings() } else { ui?.showHistory() }
                ui?.panel.contentView?.layoutSubtreeIfNeeded()
                func frames(_ view: NSView) -> [[String: String]] {
                    [["type": String(describing: type(of: view)), "frame": NSStringFromRect(view.frame)]] + view.subviews.flatMap(frames)
                }
                result["views"] = ui?.panel.contentView.map(frames)
                result["visibleWindows"] = NSApp.windows.filter { $0.isVisible }.count
                if let path = command["file"] as? String, let view = ui?.panel.contentView,
                   let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                    view.effectiveAppearance.performAsCurrentDrawingAppearance {
                        view.cacheDisplay(in: view.bounds, to: bitmap)
                    }
                    try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
                }
            case "voiceprint":
                let file = URL(fileURLWithPath: command["file"] as? String ?? "")
                result["voiceprint"] = try PCMRecording.voiceprint(at: file)
            case "clipboard":
                switch command["operation"] as? String {
                case "seed":
                    session.delivery.restoreNow()
                    let item = NSPasteboardItem()
                    item.setString("Original clipboard", forType: .string)
                    let rich = command["unreadable"] as? Bool == true ? Data([1, 2, 3, 4]) : Data("{\\rtf1\\ansi Original clipboard}".utf8)
                    item.setData(rich, forType: .rtf)
                    board.clearContents()
                    board.writeObjects([item])
                case "external":
                    board.clearContents()
                    board.setString(command["text"] as? String ?? "External copy", forType: .string)
                case "deliver":
                    session.delivery.target = command["noTarget"] as? Bool == true ? nil : { command["pasted"] as? Bool ?? true }
                    result["message"] = session.delivery.deliver("Private fixture transcript", mode: command["mode"] as? String ?? "if-paste-fails")
                case "restore": session.delivery.restoreNow()
                default: break
                }
                result["clipboardText"] = board.string(forType: .string) ?? ""
                result["rtf"] = board.data(forType: .rtf).map { Array($0) } ?? []
            case "units": result["checks"] = try units()
            case "state": break
            case "quit": session.shutdown(); write(["id": command["id"] ?? 0, "ok": true]); exit(0)
            default: throw AudioFailure(message: "Unknown test command: \(name)")
            }
            result["id"] = command["id"] ?? 0
            result["state"] = state()
            write(result)
        } catch { write(["id": command["id"] ?? 0, "error": error.localizedDescription]) }
    }

    private func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap(descendants) }

    private func append(seconds: Double) {
        guard let recording else { return }
        let start = Int(recording.snapshot().seconds * 16000)
        var samples = [Int16](repeating: 0, count: 1600)
        let count = Int(seconds * 16000)
        var offset = 0
        while offset < count {
            let size = min(samples.count, count - offset)
            for index in 0..<size {
                let frame = start + offset + index
                let amplitude = (frame / 16_000 % 24 + 1) * 400
                samples[index] = Int16(frame % 32 < 16 ? amplitude : -amplitude)
            }
            samples.withUnsafeBytes { recording.append($0.baseAddress!, count: size) }
            offset += size
        }
    }

    private func units() throws -> Int {
        var checks = 0
        func expect(_ value: Bool, _ message: String) throws {
            checks += 1
            if !value { throw AudioFailure(message: message) }
        }
        try expect(FallbackShortcut("Ctrl+Alt+Space") != nil, "Default fallback parses")
        try expect(FallbackShortcut("Cmd+Shift+Space") == nil, "Modifier order matches the existing accelerator validator")
        try expect(FallbackShortcut("Shift+Cmd+K") != nil, "Custom fallback parses")
        try expect(FallbackShortcut("A") == nil && FallbackShortcut("Shift+A") == nil, "Typing remains available")
        try expect(FallbackShortcut("F12") != nil, "Standalone function keys remain available")
        try expect(FallbackShortcut("Ctrl+Ctrl+A") == nil, "Duplicate modifiers rejected")
        var gesture = HoldGesture()
        try expect(gesture.press(0, canStart: true, holding: nil) == .beginHold, "Fn begins hold")
        try expect(gesture.release(0.1, holding: true, starting: false) == .cancel, "Short tap cancels")
        try expect(gesture.press(0.2, canStart: true, holding: nil) == .beginHandsFree, "Double tap starts hands-free")
        try expect(gesture.press(0.3, canStart: false, holding: false) == .cancel, "Third tap cancels")
        gesture.restart()
        _ = gesture.press(2, canStart: true, holding: nil)
        try expect(gesture.release(3, holding: true, starting: false) == .finish, "Release transcribes a hold")
        try expect(gesture.release(3, holding: false, starting: false) == .none, "Release keeps hands-free recording")
        try expect(gesture.release(3, holding: true, starting: true) == .cancel, "Release during permission request cancels")
        let folder = session.store.directory.appendingPathComponent("unit-profile")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let valid: [String: Any] = ["id": "existing", "text": "Keep this", "at": 1000, "seconds": 2, "voiceprint": [0, 0.5, 1]]
        let invalid: [String: Any] = ["id": "bad", "text": "Reject", "at": 1000, "seconds": 2, "voiceprint": [2]]
        try JSONSerialization.data(withJSONObject: [valid, invalid, ["broken": true]]).write(to: folder.appendingPathComponent("history.json"))
        let store = NativeStore(directory: folder)
        try expect(store.history.count == 1 && store.history[0].text == "Keep this", "Invalid entries cannot erase valid history")
        store.update("microphone", "existing-chromium-device")
        store.update("nativeMicrophone", "core-audio-uid")
        store.update("futureSetting", "preserve")
        let loaded = NativeStore(directory: folder)
        try expect(loaded.microphone == "core-audio-uid" && loaded.settings["microphone"] as? String == "existing-chromium-device", "Microphone namespaces stay independent")
        try expect(loaded.settings["futureSetting"] as? String == "preserve", "Unknown settings survive writes")
        let mode = try FileManager.default.attributesOfItem(atPath: folder.appendingPathComponent("settings.json").path)[.posixPermissions] as? Int
        try expect(mode == 0o600, "Settings remain owner-only")
        for index in 0..<505 { store.add("Transcript \(index)", seconds: 1, voiceprint: [0, 1]) }
        try expect(store.history.count == 500 && store.history.last?.text == "Transcript 504", "History remains bounded")
        return checks
    }

    private func write(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }
}
