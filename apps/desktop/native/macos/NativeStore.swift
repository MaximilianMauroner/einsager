import Foundation

struct NativeHistoryEntry: Codable {
    let id: String
    let text: String
    let at: Double
    let seconds: Double
    let voiceprint: [Double]
}

/// Uses the existing profile and JSON formats. Unknown settings remain intact for other hosts.
final class NativeStore {
    let directory: URL
    private(set) var settings: [String: Any] = [:]
    private(set) var history: [NativeHistoryEntry] = []
    private(set) var historyRevision = 0
    var onError: (String) -> Void = { _ in }

    init(directory: URL) {
        self.directory = directory
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            if let data = try? Data(contentsOf: directory.appendingPathComponent("settings.json")),
               let stored = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { settings = stored }
            let file = directory.appendingPathComponent("history.json")
            if FileManager.default.fileExists(atPath: file.path) {
                do {
                    let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: file))
                    guard let entries = raw as? [Any] else { throw CocoaError(.fileReadCorruptFile) }
                    history = Array(entries.compactMap { value -> NativeHistoryEntry? in
                        guard JSONSerialization.isValidJSONObject(value),
                              let data = try? JSONSerialization.data(withJSONObject: value),
                              let entry = try? JSONDecoder().decode(NativeHistoryEntry.self, from: data),
                              entry.at.isFinite, abs(entry.at) <= 8.64e15, entry.seconds.isFinite,
                              entry.voiceprint.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) else { return nil }
                        return entry
                    }.suffix(500))
                } catch {
                    try FileManager.default.moveItem(at: file, to: file.appendingPathExtension("unreadable-\(Int(Date().timeIntervalSince1970))"))
                }
            }
        } catch { fputs("Cannot load einsager profile: \(error.localizedDescription)\n", stderr) }
    }

    var edge: String { ["bottom", "top", "left", "right"].contains(string("edge")) ? string("edge") : "bottom" }
    var clipboard: String { ["always", "never"].contains(string("clipboard")) ? string("clipboard") : "if-paste-fails" }
    var keepHistory: Bool { settings["keepHistory"] as? Bool ?? true }
    var showPill: Bool { settings["showPill"] as? Bool ?? true }
    // Core Audio UIDs and Chromium device IDs are different namespaces. Keep both selections.
    var microphone: String { string("nativeMicrophone") }
    var shortcut: String {
        let value = string("shortcut")
        return FallbackShortcut(value) != nil ? value : "Ctrl+Alt+Space"
    }
    var codexHome: String {
        let chosen = string("codexHome")
        let inherited = ProcessInfo.processInfo.environment["CODEX_HOME"] ?? ""
        return chosen.isEmpty ? (inherited.isEmpty ? defaultCodexHome : inherited) : chosen
    }
    var defaultCodexHome: String { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex").path }

    private func string(_ key: String) -> String { settings[key] as? String ?? "" }

    func update(_ key: String, _ value: Any?) {
        settings[key] = value
        do { try write(JSONSerialization.data(withJSONObject: settings), name: "settings.json") }
        catch { onError("Could not save settings: \(error.localizedDescription)") }
    }

    func add(_ text: String, seconds: Double, voiceprint: [Double]) {
        guard keepHistory else { return }
        history.append(NativeHistoryEntry(id: UUID().uuidString, text: text,
            at: Date().timeIntervalSince1970 * 1000, seconds: seconds, voiceprint: voiceprint))
        history = Array(history.suffix(500))
        historyRevision += 1
        saveHistory()
    }

    func remove(_ id: String) { history.removeAll { $0.id == id }; historyRevision += 1; saveHistory() }
    func clear() { history = []; historyRevision += 1; saveHistory() }

    private func saveHistory() {
        do { try write(JSONEncoder().encode(history), name: "history.json") }
        catch { onError("Could not save history: \(error.localizedDescription)") }
    }

    private func write(_ data: Data, name: String) throws {
        let file = directory.appendingPathComponent(name)
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}

struct HoldGesture {
    enum Step { case none, beginHold, beginHandsFree, lock, finish, cancel }
    private var firstPress = -Double.infinity
    private var heldSince = 0.0
    private var presses = 0

    mutating func press(_ time: Double, canStart: Bool, holding: Bool?) -> Step {
        guard canStart || holding != nil else { return .none }
        presses = time - firstPress <= 0.5 ? presses + 1 : 1
        if presses == 1 { firstPress = time }
        heldSince = time
        if presses >= 3 { return .cancel }
        if presses == 2 { return holding == nil ? .beginHandsFree : .lock }
        return canStart ? .beginHold : .none
    }

    func release(_ time: Double, holding: Bool?, starting: Bool) -> Step {
        guard holding == true else { return .none }
        return starting || time - heldSince < 0.5 ? .cancel : .finish
    }

    mutating func restart() { firstPress = -Double.infinity; presses = 0 }
}
