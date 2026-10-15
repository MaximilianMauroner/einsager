import Foundation

@main
enum FixtureTranscribe {
    static func main() throws {
        let folder = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        let data = try Data(contentsOf: folder.appendingPathComponent("response.json"))
        let fixture = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        Thread.sleep(forTimeInterval: fixture["delay"] as? Double ?? 0)
        let reply = fixture["reply"] as? [String: String] ?? ["text": "Fixture transcript"]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: reply))
        exit(reply["error"] == nil ? 0 : 1)
    }
}
