import AppKit

@main
struct UIProbe {
    static func main() throws {
        _ = NSApplication.shared
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let iconURL = URL(fileURLWithPath: "assets/icons/einsager-breath.pdf")
        guard let icon = NSImage(contentsOf: iconURL) else { fatalError("Template PDF failed to load") }
        icon.isTemplate = true
        icon.size = NSSize(width: 18, height: 18)
        let suite = "einsager-ui-probe-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let bar = DictationBar(icon: icon, defaults: defaults)
        precondition(!bar.panel.canBecomeKey && !bar.panel.canBecomeMain, "Panel must not take editor focus")
        precondition(bar.panel.styleMask.contains(.nonactivatingPanel), "Panel must not activate the app")
        precondition(bar.panel.collectionBehavior.contains(.canJoinAllSpaces))
        precondition(bar.surface.toolTip?.contains("Enable keyboard access") == true,
                     "An unavailable listener must show keyboard setup instead of advertising Fn")
        bar.surface.keyboardEnabled = true
        precondition(bar.showAtAllTimes, "Existing users keep the visible idle bar until they choose to hide it")
        bar.showAtAllTimes = false
        bar.show()
        precondition(!bar.panel.isVisible, "A hidden idle bar must not appear at launch")
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
        precondition(!bar.panel.isVisible, "Switching Spaces must not reveal a hidden idle bar")
        NotificationCenter.default.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
        precondition(!bar.panel.isVisible, "Changing displays must not reveal a hidden idle bar")
        for state: DictationBar.Display in [.requesting("Starting microphone…"), .recording(handsFree: false),
                                           .processing, .message("Copied. Press ⌘V."), .failure("Retry recording.")] {
            bar.render(state)
            precondition(bar.panel.isVisible, "Active dictation and recovery must appear with the idle bar hidden")
        }
        bar.render(.idle)
        precondition(!bar.panel.isVisible, "The bar must hide again when dictation ends")
        let restored = DictationBar(icon: icon, defaults: defaults)
        precondition(!restored.showAtAllTimes, "The hidden-idle preference must persist across launches")
        restored.close()
        bar.showAtAllTimes = true
        precondition(bar.panel.isVisible, "The menu setting must restore the idle bar immediately")
        let collapsedWidth = bar.panel.frame.width
        let enter = NSEvent.enterExitEvent(with: .mouseEntered, location: .zero, modifierFlags: [], timestamp: 0,
                                           windowNumber: bar.panel.windowNumber, context: nil, eventNumber: 0,
                                           trackingNumber: 0, userData: nil)!
        bar.surface.mouseEntered(with: enter)
        precondition(bar.panel.frame.width > collapsedWidth, "Hover must expand the idle bar")
        bar.showAtAllTimes = false
        bar.showAtAllTimes = true
        precondition(bar.panel.frame.width == collapsedWidth, "A bar hidden under the pointer must reappear collapsed")
        precondition(bar.surface.toolTip?.contains("Hold Fn") == true,
                     "An active listener must advertise the configured hold shortcut")
        bar.surface.keyboardEnabled = false
        precondition(bar.surface.toolTip?.contains("Enable keyboard access") == true,
                     "Losing keyboard access must restore setup guidance")
        bar.surface.keyboardEnabled = true
        let states: [(String, DictationBar.Display)] = [
            ("idle", .idle), ("starting", .requesting("Allow microphone access…")), ("recording", .recording(handsFree: true)),
            ("processing", .processing), ("success", .message("Paste sent. Copy last is available.")),
            ("failure", .failure("Connection timed out. Retry or discard this recording."))
        ]
        for (name, state) in states {
            bar.render(state)
            bar.surface.canRetry = true
            bar.updateLevel(0.7, elapsed: 42, limit: 1200)
            bar.surface.layoutSubtreeIfNeeded()
            guard let bitmap = bar.surface.bitmapImageRepForCachingDisplay(in: bar.surface.bounds) else {
                fatalError("Cannot render native surface")
            }
            bar.surface.cacheDisplay(in: bar.surface.bounds, to: bitmap)
            guard let data = bitmap.representation(using: .png, properties: [:]) else { fatalError("Cannot encode native screenshot") }
            try data.write(to: output.appendingPathComponent(name + ".png"))
            print("Rendered \(name): \(Int(bar.surface.bounds.width)) × \(Int(bar.surface.bounds.height))")
        }
        bar.close()
        bar.render(.recording(handsFree: true))
        precondition(!bar.panel.isVisible, "A late render must not reopen the bar after quit")
        print("Native panel focus and template PDF checks passed")
    }
}
