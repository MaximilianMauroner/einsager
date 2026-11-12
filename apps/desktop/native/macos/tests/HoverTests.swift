import AppKit

final class CursorProbe: ActionButton {
    var cursors: [NSCursor] = []
    override func addCursorRect(_ rect: NSRect, cursor: NSCursor) { cursors.append(cursor) }
}

@main
enum HoverTests {
    static func main() throws {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        NSApp.finishLaunching()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let session = NativeSession(store: NativeStore(directory: directory), helper: directory.appendingPathComponent("unused"))
        session.store.selectProvider(.codexLogin)
        let ui = NativeUI(session: session, keyboard: KeyboardMonitor())
        ui.showSettings()
        var controls = descendants(ui.panel.contentView!).compactMap { $0 as? ActionButton }
        ui.showHistory()
        controls += descendants(ui.panel.contentView!).compactMap { $0 as? ActionButton }
        var calls = 0
        let action = ActionButton("Text action") { calls += 1 }
        action.frame.size = NSSize(width: 100, height: 26)
        controls.append(action)
        let offSwitch = ToggleSwitch("Off switch", on: false, action: {})
        offSwitch.frame.size = offSwitch.intrinsicContentSize
        controls.append(offSwitch)
        var failures: [String] = []
        let cursor = CursorProbe("Cursor", action: {})
        cursor.frame.size = NSSize(width: 100, height: 26)
        cursor.resetCursorRects()
        if cursor.cursors != [.pointingHand] { failures.append("FAIL enabled button has no pointing hand cursor") }
        cursor.cursors.removeAll()
        cursor.isEnabled = false
        cursor.resetCursorRects()
        if !cursor.cursors.isEmpty { failures.append("FAIL disabled button registers a cursor") }
        var classes = Set<String>()
        for control in controls {
            let name = String(describing: type(of: control)) + " " + control.title
            classes.insert(String(describing: type(of: control)))
            control.isHidden = false
            control.isEnabled = true
            control.concealed = false
            if control.bounds.isEmpty { control.frame.size = NSSize(width: 30, height: 26) }
            let entered = NSEvent.enterExitEvent(with: .mouseEntered, location: .zero, modifierFlags: [], timestamp: 0,
                windowNumber: 0, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil)!
            let down = NSEvent.mouseEvent(with: .leftMouseDown, location: .zero, modifierFlags: [], timestamp: 0,
                windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
            let up = NSEvent.mouseEvent(with: .leftMouseUp, location: .zero, modifierFlags: [], timestamp: 0,
                windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 0)!
            control.mouseExited(with: entered)
            let idle = pixels(control)
            control.mouseEntered(with: entered)
            let hover = pixels(control)
            if idle == hover { failures.append("FAIL hover changes pixels for \(name)") }
            control.mouseDown(with: down)
            if hover == pixels(control) { failures.append("FAIL press changes pixels for \(name)") }
            control.isEnabled = false
            let disabled = pixels(control)
            control.mouseExited(with: entered)
            if disabled != pixels(control) { failures.append("FAIL disabling clears feedback for \(name)") }
            control.mouseEntered(with: entered)
            control.mouseDown(with: down)
            control.mouseDragged(with: down)
            if disabled != pixels(control) { failures.append("FAIL disabled hover/press changes pixels for \(name)") }
            control.run = { calls += 100 }
            control.mouseUp(with: up)
            control.invoke()
            if control.accessibilityPerformPress() { failures.append("FAIL disabled accessibility press for \(name)") }
        }
        action.isEnabled = true
        action.run = { calls += 1 }
        action.invoke()
        if calls != 1 { failures.append("FAIL disabled actions invoked, calls=\(calls)") }
        let required: Set<String> = ["ActionButton", "ToggleSwitch", "RadioOption", "StylePopup", "FolderButton", "CircleButton", "WaveButton"]
        if !required.isSubset(of: classes) { failures.append("FAIL missing classes \(required.subtracting(classes))") }
        if NSApp.windows.contains(where: { $0.isVisible }) { failures.append("FAIL test showed a window") }
        failures.forEach { print($0) }
        guard failures.isEmpty else { exit(1) }
        print("PASS pointing hand cursor registered only when enabled, hover and press pixels differ, disabled feedback stays unchanged, disabled actions do not invoke across \(controls.count) controls and \(classes.count) classes. All windows stayed hidden.")
    }

    static func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap(descendants) }

    static func pixels(_ view: NSView) -> Data {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(ceil(view.bounds.width)),
            pixelsHigh: Int(ceil(view.bounds.height)), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        NativeStyle.background.setFill(); view.bounds.fill()
        view.draw(view.bounds)
        NSGraphicsContext.restoreGraphicsState()
        return Data(bytes: bitmap.bitmapData!, count: bitmap.bytesPerRow * bitmap.pixelsHigh)
    }
}
