import Foundation

@main
enum FixtureTranscribe {
    static func main() throws {
        let folder = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        let data = try Data(contentsOf: folder.appendingPathComponent("response.json"))
        let fixture = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let args = CommandLine.arguments
        let key = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let provider = fixture["provider"] as? String ?? "api-key"
        let valid = args.count == 4 && args[1] == "--provider" && args[2] == provider
            && !args.joined(separator: " ").contains("sk-fixture-only-key")
            && (provider != "api-key" || key == "sk-fixture-only-key")
        guard valid else {
            FileHandle.standardOutput.write(Data("{\"error\":\"Credential boundary failed\"}".utf8))
            exit(1)
        }
        Thread.sleep(forTimeInterval: fixture["delay"] as? Double ?? 0)
        let reply = fixture["reply"] as? [String: String] ?? ["text": "Fixture transcript"]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: reply))
        exit(reply["error"] == nil ? 0 : 1)
    }
}
