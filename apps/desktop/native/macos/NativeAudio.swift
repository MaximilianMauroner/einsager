import AudioToolbox
import CoreAudio
import Foundation

struct AudioFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private func checkAudio(_ status: OSStatus) throws {
    if status != noErr { throw AudioFailure(message: "Microphone or recording file unavailable (\(status)). Check your input device and free disk space.") }
}

struct AudioInput {
    let uid: String
    let name: String

    static func all() -> [AudioInput] {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
        var devices = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices) == noErr else { return [] }
        return devices.compactMap { device in
            var streams = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams,
                mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
            var bytes: UInt32 = 0
            guard AudioObjectGetPropertyDataSize(device, &streams, 0, nil, &bytes) == noErr, bytes > 0,
                  let uid = string(device, kAudioDevicePropertyDeviceUID), let name = string(device, kAudioObjectPropertyName) else { return nil }
            return AudioInput(uid: uid, name: name)
        }
    }

    private static func string(_ device: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }
}

struct RecordingSummary {
    let seconds: Double
    let power: Double
    let heard: Bool
    let error: String?
}

/// Streams PCM straight to disk. Audio duration never determines the size of a retained audio buffer.
/// AudioQueue invokes the writer on its own thread; the lock protects meter snapshots and file closure.
final class PCMRecording {
    static let sampleRate = 16_000.0
    static let maxFrames = 16_000 * 600
    private let lock = NSLock()
    private var file: AudioFileID?
    private var frames = 0
    private var heard = false
    private var power = -80.0
    private var problem: String?
    private var queue: AudioQueueRef?

    static var format: AudioStreamBasicDescription {
        AudioStreamBasicDescription(mSampleRate: sampleRate, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
            mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
    }

    init(url: URL) throws {
        var format = Self.format
        try checkAudio(AudioFileCreateWithURL(url as CFURL, kAudioFileWAVEType, &format, .eraseFile, &file))
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    func start(microphone: String) throws {
        var format = Self.format
        try checkAudio(AudioQueueNewInput(&format, { context, queue, buffer, _, _, _ in
            guard let context else { return }
            let recording = Unmanaged<PCMRecording>.fromOpaque(context).takeUnretainedValue()
            recording.append(buffer.pointee.mAudioData, count: Int(buffer.pointee.mAudioDataByteSize) / 2)
            AudioQueueEnqueueBuffer(queue, buffer, 0, nil)
        }, Unmanaged.passUnretained(self).toOpaque(), nil, nil, 0, &queue))
        guard let queue else { throw AudioFailure(message: "Cannot start microphone.") }
        do {
            // A disconnected selection falls back to the system device, as in the browser host.
            if !microphone.isEmpty && AudioInput.all().contains(where: { $0.uid == microphone }) {
                let device = microphone as CFString
                var reference = Unmanaged.passUnretained(device)
                try withExtendedLifetime(device) {
                    try checkAudio(AudioQueueSetProperty(queue, kAudioQueueProperty_CurrentDevice, &reference, UInt32(MemoryLayout.size(ofValue: reference))))
                }
            }
            for _ in 0..<3 {
                var buffer: AudioQueueBufferRef?
                try checkAudio(AudioQueueAllocateBuffer(queue, 3200, &buffer))
                if let buffer { try checkAudio(AudioQueueEnqueueBuffer(queue, buffer, 0, nil)) }
            }
            try checkAudio(AudioQueueStart(queue, nil))
        } catch {
            AudioQueueDispose(queue, true)
            self.queue = nil
            throw error
        }
    }

    /// Also used by the synthetic input test. No temporary array or Data copy is made here.
    func append(_ samples: UnsafeRawPointer, count: Int) {
        lock.lock()
        defer { lock.unlock() }
        guard let file, problem == nil, frames < Self.maxFrames else { return }
        var packets = UInt32(min(count, Self.maxFrames - frames))
        let result = AudioFileWritePackets(file, false, packets * 2, nil, Int64(frames), &packets, samples)
        guard result == noErr else { problem = "Cannot save recording. Check available disk space."; return }
        let input = samples.assumingMemoryBound(to: Int16.self)
        var square = 0.0
        for index in 0..<Int(packets) {
            let sample = Double(input[index]) / 32768
            let value = sample * sample
            square += value
        }
        frames += Int(packets)
        power = max(-80, 10 * log10(max(1e-8, square / Double(max(1, packets)))))
        if power > -65 { heard = true }
    }

    func snapshot() -> RecordingSummary {
        lock.lock()
        defer { lock.unlock() }
        return RecordingSummary(seconds: Double(frames) / Self.sampleRate, power: power,
            heard: heard, error: problem)
    }

    /// Matches history.ts's 24 equal windows after the file header is finalized. Reads at most 16 KB at once.
    static func voiceprint(at url: URL) throws -> [Double] {
        var opened: AudioFileID?
        try checkAudio(AudioFileOpenURL(url as CFURL, .readPermission, 0, &opened))
        guard let file = opened else { return [] }
        defer { AudioFileClose(file) }
        var total: UInt64 = 0
        var size = UInt32(MemoryLayout<UInt64>.size)
        try checkAudio(AudioFileGetProperty(file, kAudioFilePropertyAudioDataPacketCount, &size, &total))
        let window = Int(total / 24)
        guard window > 0 else { return [] }
        var buffer = [Int16](repeating: 0, count: 8192)
        var decibels: [Double] = []
        for bar in 0..<24 {
            var offset = 0
            var square = 0.0
            while offset < window {
                var packets = UInt32(min(buffer.count, window - offset))
                var bytes = packets * 2
                let result = buffer.withUnsafeMutableBytes {
                    AudioFileReadPacketData(file, false, &bytes, nil, Int64(bar * window + offset), &packets, $0.baseAddress!)
                }
                try checkAudio(result)
                guard packets > 0 else { throw AudioFailure(message: "Recording ended before its audio data.") }
                for sample in buffer.prefix(Int(packets)) { let value = Double(sample) / 32768; square += value * value }
                offset += Int(packets)
            }
            decibels.append(max(-80, 10 * log10(max(1e-8, square / Double(window)))))
        }
        let floor = decibels.min() ?? -80
        let range = max(18, (decibels.max() ?? -80) - floor)
        return decibels.map { (($0 - floor) / range * 100).rounded() / 100 }
    }

    func stop() {
        if let queue {
            // Dispose waits for outstanding callbacks before the file can close or self can deallocate.
            AudioQueueStop(queue, true)
            AudioQueueDispose(queue, true)
            self.queue = nil
        }
        lock.lock()
        if let file { AudioFileClose(file); self.file = nil }
        lock.unlock()
    }

    deinit { stop() }
}
