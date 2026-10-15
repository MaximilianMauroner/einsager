import AppKit

/// JSON-lines adapter for the Electron host. The native host uses KeyboardMonitor directly.
@main
enum KeyboardHelper {
    static func main() {
        if CommandLine.arguments.dropFirst().first == "--profile-lock" {
            holdProfileLock()
            return
        }
        let monitor = KeyboardMonitor()
        monitor.excludedPID = getppid()
        monitor.output = { object in
            guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
            FileHandle.standardOutput.write(data + Data([0x0A]))
        }
        var buffer = Data()
        FileHandle.standardInput.readabilityHandler = { handle in
            let data = handle.availableData
            DispatchQueue.main.async {
                guard !data.isEmpty else { exit(0) }
                buffer.append(data)
                while let end = buffer.firstIndex(of: 0x0A) {
                    let line = buffer[buffer.startIndex..<end]
                    buffer.removeSubrange(buffer.startIndex...end)
                    guard let message = (try? JSONSerialization.jsonObject(with: line)) as? [String: String] else { continue }
                    monitor.perform(message)
                }
            }
        }
        monitor.start()
        CFRunLoopRun()
    }

    /// The Electron fallback shares the native host's flock without starting keyboard monitoring.
    private static func holdProfileLock() {
        func reply(_ status: String) {
            FileHandle.standardOutput.write(Data("{\"profile\":\"\(status)\"}\n".utf8))
        }
        guard CommandLine.arguments.count == 3 else { reply("failed"); return }
        let directory = URL(fileURLWithPath: CommandLine.arguments[2])
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
        } catch { reply("failed"); return }
        let descriptor = open(directory.appendingPathComponent(".instance.lock").path, O_CREAT | O_RDWR, 0o600)
        guard descriptor >= 0 else { reply("failed"); return }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            reply(errno == EWOULDBLOCK ? "busy" : "failed")
            return
        }
        reply("locked")
        // EOF also releases the lock when Electron exits or is killed. The lock file stays in place.
        while !FileHandle.standardInput.availableData.isEmpty {}
    }
}
