import AppKit

/// Borrows every clipboard type for a checked paste, then restores it only if nothing replaced our text.
/// All operations run on the main thread, so copies, pastes, and restores cannot interleave.
final class NativeDelivery {
    private let board: NSPasteboard
    private var pending: DispatchWorkItem?
    private var restore: (() -> Void)?
    private(set) var lastText = ""
    var target: (() -> Bool)?

    init(board: NSPasteboard = .general) { self.board = board }

    @discardableResult func copy(_ text: String) -> Bool {
        pending?.cancel()
        pending = nil
        restore = nil
        board.clearContents()
        return board.setString(text, forType: .string)
    }

    func forget(_ text: String? = nil) {
        if text == nil || text == lastText { lastText = "" }
    }

    func restoreNow() {
        pending?.cancel()
        pending = nil
        let action = restore
        restore = nil
        action?()
    }

    func deliver(_ text: String, mode: String) -> String {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "No speech found. Start again." }
        lastText = text
        restoreNow()
        let saved = mode != "always" && target != nil ? snapshot() : nil
        if mode == "never" && saved == nil { return "Not copied, as set in Settings. Use Copy last." }
        guard copy(text) else { return "Clipboard unavailable. Use Copy last to retry." }
        let revision = board.changeCount
        let giveBack = { [board] in
            guard board.changeCount == revision, board.string(forType: .string) == text, let saved else { return }
            board.clearContents()
            board.writeObjects(saved)
        }
        let pasted = board.string(forType: .string) == text && (target?() ?? false)
        if pasted, saved != nil {
            restore = giveBack
            let task = DispatchWorkItem { [weak self] in self?.restoreNow() }
            pending = task
            DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: task)
            return "Paste shortcut sent."
        }
        if pasted { return "Paste shortcut sent. Text is also copied." }
        if mode == "never" { giveBack(); return "Not copied, as set in Settings. Use Copy last." }
        return "Copied. Press ⌘V in your text field."
    }

    private func snapshot() -> [NSPasteboardItem]? {
        guard let items = board.pasteboardItems else { return [] }
        var result: [NSPasteboardItem] = []
        for item in items {
            let copy = NSPasteboardItem()
            for type in item.types {
                guard let data = item.data(forType: type), copy.setData(data, forType: type) else { return nil }
            }
            result.append(copy)
        }
        return result
    }
}
