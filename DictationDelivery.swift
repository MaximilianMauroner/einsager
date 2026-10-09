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

/// Restores supported clipboard data only while this paste still owns the clipboard.
final class ClipboardLease {
    private let pasteboard: NSPasteboard
    private let original: [[NSPasteboard.PasteboardType: Data]]?
    private var ownedChangeCount: Int?

    init(pasteboard: NSPasteboard = .general) {
        self.pasteboard = pasteboard
        let supported: Set<NSPasteboard.PasteboardType> = [.string, .html, .rtf]
        let items = pasteboard.pasteboardItems ?? []
        if items.allSatisfy({ Set($0.types).isSubset(of: supported) }) {
            original = items.map { item in
                Dictionary(uniqueKeysWithValues: item.types.compactMap { type in
                    item.data(forType: type).map { (type, $0) }
                })
            }
        } else { original = nil }
    }

    func write(_ text: String) {
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        ownedChangeCount = pasteboard.changeCount
    }

    var stillOwnsClipboard: Bool { ownedChangeCount == pasteboard.changeCount }

    @discardableResult func restore() -> Bool {
        guard stillOwnsClipboard, let original = original else { return false }
        pasteboard.clearContents()
        let items = original.map { data in
            let item = NSPasteboardItem()
            for (type, value) in data { item.setData(value, forType: type) }
            return item
        }
        if !items.isEmpty { pasteboard.writeObjects(items) }
        ownedChangeCount = nil
        return true
    }
}
