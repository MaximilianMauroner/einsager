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
        let defaults = UserDefaults(suiteName: "einsager-ui-probe")!
        let bar = DictationBar(icon: icon, defaults: defaults)
        precondition(!bar.panel.canBecomeKey && !bar.panel.canBecomeMain, "Panel must not take editor focus")
        precondition(bar.panel.styleMask.contains(.nonactivatingPanel), "Panel must not activate the app")
        precondition(bar.panel.collectionBehavior.contains(.canJoinAllSpaces))
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
        print("Native panel focus and template PDF checks passed")
    }
}
