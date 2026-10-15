import AppKit
import CoreAudio

/// Composes the native macOS services. Tests use the same services with an isolated profile and input source.
final class NativeApplication: NSObject, NSApplicationDelegate {
    let session: NativeSession
    let keyboard = KeyboardMonitor()
    let hotKeys = NativeHotKeys()
    let ui: NativeUI
    private var devicesAddress = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    private var devicesListener: AudioObjectPropertyListenerBlock?
    private let isolated: Bool
    private var profileLock: Int32 = -1

    init(profile: URL, helper: URL, isolated: Bool = false) throws {
        self.isolated = isolated
        umask(0o077)
        try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let lock = open(profile.appendingPathComponent(".instance.lock").path, O_CREAT | O_RDWR, 0o600)
        guard lock >= 0 else { throw AudioFailure(message: "Cannot lock the einsager profile.") }
        guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { close(lock); throw AudioFailure(message: "einsager is already using this profile.") }
        profileLock = lock
        let store = NativeStore(directory: profile)
        session = NativeSession(store: store, helper: helper)
        ui = NativeUI(session: session, keyboard: keyboard)
        super.init()
        session.onChange = { [weak self] in self?.ui.refresh(); self?.updateShortcuts() }
        session.onLevel = { [weak self] power, seconds in self?.ui.pill.level(power, seconds: seconds) }
        store.onError = { message in fputs(message + "\n", stderr) }
        ui.onQuit = { NSApp.terminate(nil) }
        ui.onShortcutChange = { [weak self] in self?.updateShortcuts() }
        hotKeys.onAction = { [weak self] action in self?.session.act(action) }
        keyboard.output = { [weak self] object in
            guard let self else { return }
            if object["event"] as? String == "state" {
                self.ui.keyboardState = object
                self.updateShortcuts()
                self.ui.refresh()
            } else if let action = object["action"] as? String { self.session.act(action) }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard !isolated else { return }
        let menu = NSMenu()
        let application = NSMenuItem()
        application.submenu = NSMenu()
        application.submenu?.addItem(withTitle: "Quit einsager", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(application)
        let edit = NSMenuItem()
        edit.submenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Cut", #selector(NSText.cut(_:)), "x"), ("Copy", #selector(NSText.copy(_:)), "c"),
            ("Paste", #selector(NSText.paste(_:)), "v"), ("Select All", #selector(NSText.selectAll(_:)), "a")] {
            edit.submenu?.addItem(withTitle: title, action: action, keyEquivalent: key)
        }
        menu.addItem(edit)
        NSApp.mainMenu = menu
        keyboard.start()
        ui.start()
        let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.ui.microphonesChanged() }
        devicesListener = listener
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &devicesAddress, .main, listener)
    }

    private func updateShortcuts() {
        guard !isolated else { return }
        let native = ui.keyboardState["trusted"] as? Bool == true
        let capturing = ui.isCapturingFallback || ui.keyboardState["capturing"] is String
        let active = session.active && !ui.panel.isKeyWindow
        keyboard.active = active
        hotKeys.update(shortcut: session.store.shortcut, native: native, active: active, capturing: capturing)
        ui.shortcutAvailable = hotKeys.available
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        session.shutdown()
        return .terminateNow
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !isolated { ui.show() }
        return false
    }

    deinit {
        session.shutdown()
        if let devicesListener { AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &devicesAddress, .main, devicesListener) }
        if profileLock >= 0 { close(profileLock) }
    }
}

#if !NATIVE_TESTS
@main
enum NativeApp {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let arguments = CommandLine.arguments
        func argument(_ name: String) -> String? {
            guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
            return arguments[index + 1]
        }
        let profileOverride = argument("--profile")
        let helperOverride = argument("--helper")
        let isolated = profileOverride != nil && helperOverride != nil
        guard (profileOverride == nil) == (helperOverride == nil) else {
            fputs("--profile and --helper must be supplied together for isolated verification.\n", stderr)
            exit(1)
        }
        let profile = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/einsager")
        let chosenProfile = profileOverride.map { URL(fileURLWithPath: $0).resolvingSymlinksInPath() } ?? profile
        guard !isolated || chosenProfile != profile.resolvingSymlinksInPath() else {
            fputs("Verification must use a separate profile.\n", stderr)
            exit(1)
        }
        if !isolated, let existing = NSRunningApplication.runningApplications(withBundleIdentifier: "local.max.einsager.desktop")
            .first(where: { $0.processIdentifier != getpid() }) {
            existing.activate(options: [])
            return
        }
        let bundledHelper = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/einsager-transcribe")
        let sourceHelper = URL(fileURLWithPath: "target/release/einsager-transcribe")
        let helper = helperOverride.map { URL(fileURLWithPath: $0) }
            ?? (FileManager.default.isExecutableFile(atPath: bundledHelper.path) ? bundledHelper : sourceHelper)
        do {
            let delegate = try autoreleasepool { try NativeApplication(profile: chosenProfile, helper: helper, isolated: isolated) }
            app.delegate = delegate
            withExtendedLifetime(delegate) { app.run() }
        } catch { fputs(error.localizedDescription + "\n", stderr); exit(1) }
    }
}
#endif
