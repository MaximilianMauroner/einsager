import AppKit

struct PasteTarget {
    let application: NSRunningApplication
    let element: AXUIElement?

    static func capture() -> PasteTarget? {
        guard let application = NSWorkspace.shared.frontmostApplication,
              application.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return nil }
        return PasteTarget(application: application, element: focusedElement(in: application))
    }

    var isStillFocused: Bool {
        guard AXIsProcessTrusted(), !application.isTerminated,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier,
              let original = element, let current = Self.focusedElement(in: application) else { return false }
        return CFEqual(original, current)
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

/// Keeps the transcript available for manual paste and detects later clipboard changes.
final class TranscriptClipboard {
    private let pasteboard: NSPasteboard
    private var ownedChangeCount: Int?

    init(pasteboard: NSPasteboard = .general) {
        self.pasteboard = pasteboard
    }

    @discardableResult func write(_ text: String) -> Bool {
        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            ownedChangeCount = nil
            return false
        }
        ownedChangeCount = pasteboard.changeCount
        return true
    }

    var stillOwnsClipboard: Bool { ownedChangeCount == pasteboard.changeCount }
}
