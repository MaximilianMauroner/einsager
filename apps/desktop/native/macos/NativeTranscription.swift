import Foundation

/// Owns one private WAV and one upload process. Cancellation invalidates completions before stopping work.
final class NativeTranscription {
    let helper: URL
    private(set) var directory: URL?
    private var process: Process?
    private var generation = 0
    private var timeout: DispatchWorkItem?
    var canRetry: Bool { directory != nil && process == nil }

    init(helper: URL) { self.helper = helper }

    func prepare() throws -> URL {
        cancel()
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("einsager-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        directory = folder
        return folder.appendingPathComponent("recording.wav")
    }

    func cancel() {
        generation += 1
        timeout?.cancel()
        timeout = nil
        let old = process
        process = nil
        let folder = directory
        directory = nil
        // Unlink now, including during quit. An uploader with the file open can still finish reading its descriptor.
        if let folder { try? FileManager.default.removeItem(at: folder) }
        if let old, old.isRunning {
            old.terminate()
            // Escalate a stuck child while the app remains running. Rust also exits on SIGTERM during quit.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                if old.isRunning { kill(old.processIdentifier, SIGKILL) }
            }
        }
    }

    func run(codexHome: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard let folder = directory, process == nil else { return }
        generation += 1
        let revision = generation
        let child = Process()
        child.executableURL = helper
        child.arguments = [folder.appendingPathComponent("recording.wav").path]
        child.environment = ProcessInfo.processInfo.environment.merging(["CODEX_HOME": codexHome]) { _, new in new }
        let resultFile = folder.appendingPathComponent("result.json")
        FileManager.default.createFile(atPath: resultFile.path, contents: nil, attributes: [.posixPermissions: 0o600])
        var output: FileHandle?
        do {
            let handle = try FileHandle(forWritingTo: resultFile)
            output = handle
            child.standardOutput = handle
            child.standardError = FileHandle.nullDevice
            child.standardInput = FileHandle.nullDevice
            child.terminationHandler = { [weak self] stopped in
                try? handle.close()
                DispatchQueue.main.async {
                    guard let self, self.generation == revision else { return }
                    self.timeout?.cancel()
                    self.timeout = nil
                    self.process = nil
                    let result = Self.readResult(resultFile, succeeded: stopped.terminationStatus == 0)
                    if case .success = result { self.cancel() }
                    completion(result)
                }
            }
            process = child
            try child.run()
            let deadline = DispatchWorkItem { [weak self] in
                guard let self, self.generation == revision, child.isRunning else { return }
                child.terminate()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    if child.isRunning { kill(child.processIdentifier, SIGKILL) }
                }
            }
            timeout = deadline
            DispatchQueue.main.asyncAfter(deadline: .now() + 100, execute: deadline)
        } catch {
            try? output?.close()
            process = nil
            completion(.failure(AudioFailure(message: "Transcription helper failed to start. Rebuild einsager, or Retry.")))
        }
    }

    private static func readResult(_ file: URL, succeeded: Bool) -> Result<String, Error> {
        if let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 4 * 1024 * 1024,
           let data = try? Data(contentsOf: file), let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            if succeeded, let text = value["text"] as? String { return .success(text) }
            if let error = value["error"] as? String { return .failure(AudioFailure(message: error)) }
        }
        return .failure(AudioFailure(message: "Transcription helper failed or timed out. Retry, or rebuild einsager."))
    }

    deinit { cancel() }
}
