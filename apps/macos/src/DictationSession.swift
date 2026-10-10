import Foundation

/// Owns session identity and gesture timing, independently of audio and macOS input.
struct DictationSession {
    enum Mode: Equatable { case hold, handsFree }
    enum State: Equatable {
        case idle
        case requesting(UUID, Mode)
        case recording(UUID, Mode)
        case processing(UUID)
        case delivering(UUID)
        case failed(UUID)
    }
    enum Action: Equatable {
        case none, cancel
        case begin(UUID), finish(UUID), retry(UUID)
    }

    private(set) var state: State = .idle
    private var firstPress: TimeInterval = -.infinity
    private var pressCount = 0
    private var heldSince: TimeInterval = 0

    var id: UUID? {
        switch state {
        case .idle: return nil
        case let .requesting(id, _), let .recording(id, _), let .processing(id),
             let .delivering(id), let .failed(id): return id
        }
    }

    var mode: Mode? {
        switch state {
        case let .requesting(_, mode), let .recording(_, mode): return mode
        default: return nil
        }
    }

    var canStart: Bool {
        switch state { case .idle, .failed: return true; default: return false }
    }

    mutating func holdPressed(at time: TimeInterval) -> Action {
        guard canStart || mode != nil else { return .none }
        if time - firstPress <= 0.5 { pressCount += 1 }
        else { firstPress = time; pressCount = 1 }
        heldSince = time
        if pressCount >= 3 { return cancel() }
        if pressCount == 2 {
            if mode != nil { lockHandsFree(); return .none }
            return begin(.handsFree)
        }
        guard canStart else { return .none }
        return begin(.hold)
    }

    mutating func holdReleased(at time: TimeInterval) -> Action {
        guard mode == .hold else { return .none }
        if case .requesting = state { return cancel() }
        guard time - heldSince >= 0.5 else { return cancel() }
        return finish()
    }

    mutating func toggle() -> Action {
        if mode == .hold { lockHandsFree(); return .none }
        if mode == .handsFree { return finish() }
        guard canStart else { return .none }
        pressCount = 0
        firstPress = -.infinity
        return begin(.handsFree)
    }

    private mutating func begin(_ mode: Mode) -> Action {
        let id = UUID()
        state = .requesting(id, mode)
        return .begin(id)
    }

    private mutating func lockHandsFree() {
        switch state {
        case let .requesting(id, _): state = .requesting(id, .handsFree)
        case let .recording(id, _): state = .recording(id, .handsFree)
        default: break
        }
    }

    mutating func microphoneReady(for id: UUID) -> Bool {
        guard case let .requesting(current, mode) = state, current == id else { return false }
        state = .recording(id, mode)
        return true
    }

    mutating func finish() -> Action {
        guard case let .recording(id, _) = state else {
            if case .requesting = state { return cancel() }
            return .none
        }
        state = .processing(id)
        return .finish(id)
    }

    mutating func shortcutsWillChange() -> Action {
        guard mode == .hold else { return .none }
        return finish()
    }

    mutating func cancel() -> Action {
        guard state != .idle else { return .none }
        state = .idle
        return .cancel
    }

    mutating func fail(_ id: UUID) -> Bool {
        guard self.id == id else { return false }
        state = .failed(id)
        return true
    }

    mutating func retry() -> Action {
        guard case .failed = state else { return .none }
        let id = UUID()
        state = .processing(id)
        return .retry(id)
    }

    mutating func transcriptReady(for id: UUID) -> Bool {
        guard state == .processing(id) else { return false }
        state = .delivering(id)
        return true
    }

    mutating func deliveryFinished(for id: UUID) -> Bool {
        guard state == .delivering(id) else { return false }
        state = .idle
        return true
    }
}

/// Scales microphone power to the recent range of one recording, so quiet speech still moves the waveform.
struct MicrophoneLevel {
    /// Changes smaller than this span read as room noise, not speech.
    private static let minimumRange: Float = 18
    private var floor: Float?
    private var peak: Float = 0

    /// Converts an `averagePower` reading in decibels to a bar height from 0 to 1.
    mutating func level(for decibels: Float) -> CGFloat {
        let power = max(decibels, -80)
        guard let previous = floor else {
            floor = power
            peak = power + Self.minimumRange
            return 0
        }
        // The floor drops at once and rises slowly, so continuous speech does not become the new silence.
        let floor = power < previous ? power : previous + (power - previous) * 0.01
        // The peak rises at once and decays over a few seconds, so the scale follows the speaker's volume.
        peak = power > peak ? power : peak + (power - peak) * 0.03
        self.floor = floor
        let range = max(peak - floor, Self.minimumRange)
        return CGFloat(min(max((power - floor) / range, 0), 1))
    }
}

enum DockEdge: String { case bottom, top, left, right }

enum BarPlacement {
    /// Places the panel against `edge`. On the left and right, the pill (the panel's bottom `pillHeight`)
    /// stays centered so a label appearing above it does not move it.
    static func frame(size: CGSize, visible: CGRect, edge: DockEdge, pillHeight: CGFloat? = nil) -> CGRect {
        let width = min(size.width, visible.width)
        let height = min(size.height, visible.height)
        let gap: CGFloat = 12
        let x: CGFloat
        let y: CGFloat
        switch edge {
        case .bottom: x = visible.midX - width / 2; y = visible.minY + gap
        case .top: x = visible.midX - width / 2; y = visible.maxY - height - gap
        case .left: x = visible.minX + gap; y = visible.midY - (pillHeight ?? height) / 2
        case .right: x = visible.maxX - width - gap; y = visible.midY - (pillHeight ?? height) / 2
        }
        return clamp(CGRect(x: x, y: y, width: width, height: height), to: visible)
    }

    static func clamp(_ frame: CGRect, to visible: CGRect) -> CGRect {
        var result = frame
        result.origin.x = min(max(frame.minX, visible.minX), max(visible.minX, visible.maxX - frame.width))
        result.origin.y = min(max(frame.minY, visible.minY), max(visible.minY, visible.maxY - frame.height))
        return result
    }

    static func nearestEdge(to point: CGPoint, visible: CGRect) -> DockEdge {
        let distances: [(DockEdge, CGFloat)] = [(.bottom, abs(point.y - visible.minY)),
                                               (.top, abs(point.y - visible.maxY)),
                                               (.left, abs(point.x - visible.minX)),
                                               (.right, abs(point.x - visible.maxX))]
        return distances.min { $0.1 < $1.1 }?.0 ?? .bottom
    }
}
