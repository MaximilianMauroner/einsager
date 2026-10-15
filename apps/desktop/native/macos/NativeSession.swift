import AppKit
import AVFoundation

enum NativePhase: String { case idle, requesting, recording, processing, message, failure }

/// Owns the visible session. Views send actions and observe state; they never own audio or child processes.
final class NativeSession {
    let store: NativeStore
    let transcription: NativeTranscription
    let delivery: NativeDelivery
    private(set) var phase = NativePhase.idle
    private(set) var message = ""
    private(set) var holding: Bool?
    private(set) var retryable = false
    private var recorder: PCMRecording?
    private var wav: URL?
    private var summary: RecordingSummary?
    private var voiceprint: [Double] = []
    private var revision = 0
    private var meter: Timer?
    private var feedbackTimer: DispatchWorkItem?
    private var gesture = HoldGesture()
    var onChange: () -> Void = {}
    var onLevel: (Double, Double) -> Void = { _, _ in }
    var captureTarget: () -> (() -> Bool)? = { PasteTarget.capture(excludingPID: getpid())?.paste }
    var requestPermission: (@escaping (Bool) -> Void) -> Void = { callback in
        AVCaptureDevice.requestAccess(for: .audio) { allowed in DispatchQueue.main.async { callback(allowed) } }
    }
    var makeRecorder: (URL, String) throws -> PCMRecording = { url, microphone in
        let recording = try PCMRecording(url: url)
        try recording.start(microphone: microphone)
        return recording
    }
    var active: Bool { [.requesting, .recording, .processing].contains(phase) }

    init(store: NativeStore, helper: URL, delivery: NativeDelivery = NativeDelivery()) {
        self.store = store
        self.transcription = NativeTranscription(helper: helper)
        self.delivery = delivery
    }

    func act(_ action: String) {
        switch action {
        case "toggle":
            if holding == true { holding = false; onChange() }
            else if phase == .recording { finish() }
            else if !active { gesture.restart(); start(hold: false) }
        case "finish": finish()
        case "cancel": cancel()
        case "retry": retry()
        case "copy":
            if !active && !delivery.lastText.isEmpty {
                let copied = delivery.copy(delivery.lastText)
                if phase != .failure { feedback(copied ? "Copied. Press ⌘V in your text field." : "Clipboard unavailable.") }
            }
        case "holdPressed":
            perform(gesture.press(ProcessInfo.processInfo.systemUptime, canStart: !active,
                holding: holding))
        case "holdReleased":
            perform(gesture.release(ProcessInfo.processInfo.systemUptime, holding: holding, starting: phase == .requesting))
        case "interrupted": if holding == true { cancel() }
        default: break
        }
    }

    private func perform(_ step: HoldGesture.Step) {
        switch step {
        case .beginHold: start(hold: true)
        case .beginHandsFree: start(hold: false)
        case .lock: holding = false; onChange()
        case .finish: finish()
        case .cancel: cancel()
        case .none: break
        }
    }

    func start(hold: Bool) {
        cancel(notify: false)
        holding = hold
        delivery.restoreNow()
        delivery.target = captureTarget()
        let current = revision
        change(.requesting, "Starting microphone…")
        requestPermission { [weak self] allowed in
            guard let self, current == self.revision else { return }
            guard allowed else { self.fail("Allow microphone access in System Settings → Privacy & Security.", retryable: false); return }
            do {
                let file = try self.transcription.prepare()
                self.wav = file
                self.recorder = try self.makeRecorder(file, self.store.microphone)
                self.change(.recording, "Listening…")
                self.meter = Timer.scheduledTimer(withTimeInterval: 1.0 / 15, repeats: true) { [weak self] _ in self?.tick() }
            } catch {
                self.transcription.cancel()
                self.fail(error.localizedDescription, retryable: false)
            }
        }
    }

    private func tick() {
        guard let snapshot = recorder?.snapshot() else { return }
        onLevel(snapshot.power, snapshot.seconds)
        if let error = snapshot.error {
            cancel(notify: false)
            fail(error, retryable: false)
        } else if snapshot.seconds >= 600 { finish() }
    }

    func finish() {
        guard phase == .recording, let recorder, let wav else { return }
        meter?.invalidate()
        meter = nil
        recorder.stop()
        let recording = recorder.snapshot()
        self.recorder = nil
        holding = nil
        if let error = recording.error { transcription.cancel(); fail(error, retryable: false); return }
        guard recording.heard, recording.seconds >= 0.5 else {
            transcription.cancel()
            feedback("No microphone audio. Check your input device.")
            return
        }
        summary = recording
        do { voiceprint = try PCMRecording.voiceprint(at: wav) }
        catch { transcription.cancel(); fail(error.localizedDescription, retryable: false); return }
        upload()
    }

    private func retry() {
        guard phase == .failure, retryable, transcription.canRetry else { return }
        revision += 1
        upload()
    }

    private func upload() {
        let current = revision
        change(.processing, "Transcribing…")
        transcription.run(codexHome: store.codexHome) { [weak self] result in
            guard let self, self.revision == current else { return }
            switch result {
            case .failure(let error): self.fail(error.localizedDescription, retryable: self.transcription.canRetry)
            case .success(let text):
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self.store.add(text, seconds: ((self.summary?.seconds ?? 0) * 10).rounded() / 10, voiceprint: self.voiceprint)
                }
                self.feedback(self.delivery.deliver(text, mode: self.store.clipboard))
            }
        }
    }

    func cancel(notify: Bool = true) {
        revision += 1
        feedbackTimer?.cancel()
        feedbackTimer = nil
        meter?.invalidate()
        meter = nil
        recorder?.stop()
        recorder = nil
        transcription.cancel()
        wav = nil
        holding = nil
        summary = nil
        voiceprint = []
        retryable = false
        delivery.target = nil
        phase = .idle
        message = ""
        if notify { onChange() }
    }

    func feedback(_ text: String) {
        change(.message, text)
        let current = revision
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.revision == current, self.phase == .message else { return }
            self.change(.idle)
        }
        feedbackTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 6, execute: work)
    }

    private func fail(_ text: String, retryable: Bool) {
        holding = nil
        self.retryable = retryable
        change(.failure, text)
    }

    private func change(_ phase: NativePhase, _ message: String = "") {
        feedbackTimer?.cancel()
        feedbackTimer = nil
        self.phase = phase
        self.message = message
        onChange()
    }

    func shutdown() { cancel(notify: false); delivery.restoreNow() }
}
