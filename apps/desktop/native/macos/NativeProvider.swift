import Foundation
import Security
import LocalAuthentication

enum TranscriptionProvider: String { case apiKey = "api-key", codexLogin = "codex-login" }

enum TranscriptionCredentials {
    case apiKey(String)
    case codexLogin(String)
    var provider: TranscriptionProvider {
        switch self { case .apiKey: return .apiKey; case .codexLogin: return .codexLogin }
    }
}

let apiKeysURL = URL(string: "https://platform.openai.com/api-keys")!
let apiCreditsURL = URL(string: "https://developers.openai.com/api/docs/guides/chatgpt-api-credits")!
let codexWarning = "This uses an unofficial ChatGPT transcription endpoint with your Codex login. It may violate OpenAI's Terms of Service and put your account at risk. Use an OpenAI API key for the official API. Continue only if you accept this risk."
let creditNotice = "API use is billed separately. Eligible ChatGPT Pro and Business owners may claim monthly API credits. Eligibility, limits, and expiry apply. Plus, Go, and Free are excluded."

func validatedApiKey(_ value: String) throws -> String {
    let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.utf8.count <= 4096, key.hasPrefix("sk-"), key.utf8.count >= 10,
          key.utf8.allSatisfy({ $0 >= 33 && $0 <= 126 }) else {
        throw AudioFailure(message: "Enter a valid OpenAI API key.")
    }
    return key
}

protocol ApiKeyStorage {
    var hasKey: Bool { get }
    func read() throws -> String
    func save(_ value: String) throws
    func remove() throws
}

final class KeychainApiKey: ApiKeyStorage {
    private let account: String
    init(profile: URL) { account = profile.standardizedFileURL.resolvingSymlinksInPath().path }
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "local.max.einsager.openai-api-key",
         kSecAttrAccount as String: account]
    }

    var hasKey: Bool {
        var request = query
        request[kSecReturnAttributes as String] = true
        let context = LAContext()
        context.interactionNotAllowed = true
        request[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(request as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    func read() throws -> String {
        var request = query
        request[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw AudioFailure(message: "Cannot read the API key. Add it again in Settings or unlock Keychain.")
        }
        return try validatedApiKey(value)
    }

    func save(_ value: String) throws {
        let data = Data(try validatedApiKey(value).utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw AudioFailure(message: "Cannot save the API key in Keychain.") }
        var item = query
        item[kSecValueData as String] = data
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw AudioFailure(message: "Cannot save the API key in Keychain.")
        }
    }

    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw AudioFailure(message: "Cannot remove the API key from Keychain.")
        }
    }
}
