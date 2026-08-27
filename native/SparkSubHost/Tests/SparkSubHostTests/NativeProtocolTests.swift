import Foundation
import XCTest
@testable import SparkSubHost

final class NativeProtocolTests: XCTestCase {
    func testIncomingLengthAcceptsExactlySixtyFourMiB() throws {
        let length = NativeFrameCodec.maximumInputBytes
        let header = Data([
            UInt8(length & 0xff),
            UInt8((length >> 8) & 0xff),
            UInt8((length >> 16) & 0xff),
            UInt8((length >> 24) & 0xff),
        ])

        XCTAssertEqual(try NativeFrameCodec.parseLengthPrefix(header), length)
    }

    func testIncomingLengthRejectsAboveSixtyFourMiBBeforePayloadRead() {
        let length = NativeFrameCodec.maximumInputBytes + 1
        let header = Data([
            UInt8(length & 0xff),
            UInt8((length >> 8) & 0xff),
            UInt8((length >> 16) & 0xff),
            UInt8((length >> 24) & 0xff),
        ])

        XCTAssertThrowsError(try NativeFrameCodec.parseLengthPrefix(header)) { error in
            XCTAssertEqual((error as? AppError)?.code, "PROTOCOL_MESSAGE_TOO_LARGE")
        }
    }

    func testFrameReaderRejectsOversizedPrefixBeforePayloadRead() {
        let oversized = NativeFrameCodec.maximumInputBytes + 1
        let reader = RecordingByteReader(chunks: [Data([
            UInt8(oversized & 0xff),
            UInt8((oversized >> 8) & 0xff),
            UInt8((oversized >> 16) & 0xff),
            UInt8((oversized >> 24) & 0xff),
        ]), Data(repeating: 0x61, count: 32)])

        XCTAssertThrowsError(try NativeFrameCodec.readFrame(from: reader)) { error in
            XCTAssertEqual((error as? AppError)?.code, "PROTOCOL_MESSAGE_TOO_LARGE")
        }
        XCTAssertEqual(reader.readCounts, [4], "oversized prefix must fail before any payload read")
    }

    func testLengthPrefixIsLittleEndianAndRoundTrips() throws {
        let payload = Data("{\"type\":\"ping\"}".utf8)
        let frame = try NativeFrameCodec.makeFrame(payload: payload)

        XCTAssertEqual(Array(frame.prefix(4)), [UInt8(payload.count), 0, 0, 0])
        XCTAssertEqual(try NativeFrameCodec.parseLengthPrefix(frame.prefix(4)), payload.count)
        XCTAssertEqual(Data(frame.dropFirst(4)), payload)
    }

    func testMalformedAndEmptyFramesAreRejected() {
        XCTAssertThrowsError(try NativeFrameCodec.parseLengthPrefix(Data([1, 2, 3]))) { error in
            XCTAssertEqual((error as? AppError)?.code, "INVALID_REQUEST")
        }
        XCTAssertThrowsError(try NativeFrameCodec.parseLengthPrefix(Data([0, 0, 0, 0]))) { error in
            XCTAssertEqual((error as? AppError)?.code, "INVALID_REQUEST")
        }
    }

    func testOutgoingPayloadMustBeStrictlyBelowNineHundredKiB() throws {
        let accepted = Data(repeating: 0x61, count: NativeFrameCodec.maximumOutputBytes - 1)
        XCTAssertEqual(try NativeFrameCodec.makeFrame(payload: accepted).count, accepted.count + 4)

        let rejected = Data(repeating: 0x61, count: NativeFrameCodec.maximumOutputBytes)
        XCTAssertThrowsError(try NativeFrameCodec.makeFrame(payload: rejected)) { error in
            XCTAssertEqual((error as? AppError)?.code, "PROTOCOL_MESSAGE_TOO_LARGE")
        }
    }

    func testRequestDecoderRequiresProtocolV1AndExactCorrelationFields() throws {
        let data = Data(#"{"type":"transcribe","requestId":"request-7","protocolVersion":1,"jobId":"job-9","sourceLanguage":"en","source":{"kind":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}"#.utf8)
        let request = try NativeRequest.decodeAndValidate(data)

        XCTAssertEqual(request.requestId, "request-7")
        XCTAssertEqual(request.jobId, "job-9")
        XCTAssertEqual(request.type, .transcribe)
        XCTAssertEqual(request.source?.kind, .youtube)
    }

    func testYouTubeCaptionRequestAllowsOnlyCanonicalCaptionFields() throws {
        let data = Data(#"{"type":"youtubeCaptions","requestId":"caption-7","protocolVersion":1,"jobId":"job-9","sourceLanguage":"yue","source":{"kind":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}"#.utf8)
        let request = try NativeRequest.decodeAndValidate(data)

        XCTAssertEqual(request.type, .youtubeCaptions)
        XCTAssertEqual(request.sourceLanguage, "yue")
        XCTAssertEqual(request.source?.kind, .youtube)

        let injected = Data(#"{"type":"youtubeCaptions","requestId":"caption-7","protocolVersion":1,"jobId":"job-9","sourceLanguage":"yue","title":"not-allowed","source":{"kind":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}"#.utf8)
        XCTAssertThrowsError(try NativeRequest.decodeAndValidate(injected)) { error in
            XCTAssertEqual((error as? AppError)?.code, "INVALID_REQUEST")
        }
    }

    func testRequestDecoderRejectsMismatchedProtocolVersion() {
        let data = Data(#"{"type":"ping","requestId":"request-7","protocolVersion":2}"#.utf8)
        XCTAssertThrowsError(try NativeRequest.decodeAndValidate(data)) { error in
            XCTAssertEqual((error as? AppError)?.code, "PROTOCOL_MISMATCH")
        }
    }

    func testResponseProgressAndTopLevelErrorEnvelopeShapes() throws {
        let response = try decodeObject(NativeEnvelope.response(requestId: "r1", result: ["alive": true]))
        XCTAssertEqual(response["type"] as? String, "response")
        XCTAssertEqual(response["requestId"] as? String, "r1")
        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual((response["result"] as? [String: Any])?["alive"] as? Bool, true)

        let progress = try decodeObject(NativeEnvelope.progress(
            requestId: "r2", jobId: "j2", stage: "transcribing", percent: 81, hint: "Recognizing audio"
        ))
        XCTAssertEqual(progress["requestId"] as? String, "r2")
        XCTAssertEqual(progress["jobId"] as? String, "j2")
        XCTAssertEqual(progress["type"] as? String, "progress")

        let failure = try decodeObject(NativeEnvelope.topLevelError(
            requestId: "r3", jobId: "j3", error: .mediaDownloadFailed
        ))
        XCTAssertEqual(failure["type"] as? String, "error")
        XCTAssertEqual(failure["requestId"] as? String, "r3")
        XCTAssertEqual(failure["jobId"] as? String, "j3")
        XCTAssertEqual(failure["code"] as? String, "MEDIA_DOWNLOAD_FAILED")
        XCTAssertNotNil(failure["message"] as? String)
        XCTAssertNotNil(failure["hint"] as? String)
        XCTAssertEqual(failure["retriable"] as? Bool, true)
    }

    func testJobCoordinatorCancelsOnlyMatchingJobAndSuppressesItsResults() async throws {
        let coordinator = JobCoordinator()
        let first = try await coordinator.register(jobId: "job-first")
        let second = try await coordinator.register(jobId: "job-second")

        let cancelled = await coordinator.cancel(jobId: "job-first")
        let firstMayEmit = await coordinator.mayEmitResults(jobId: "job-first", token: first)
        let secondMayEmit = await coordinator.mayEmitResults(jobId: "job-second", token: second)
        XCTAssertTrue(cancelled)
        XCTAssertTrue(first.isCancelled)
        XCTAssertFalse(second.isCancelled)
        XCTAssertFalse(firstMayEmit)
        XCTAssertTrue(secondMayEmit)

        let ingressRaceCoordinator = JobCoordinator()
        let acceptedPendingCancel = await ingressRaceCoordinator.cancel(jobId: "job-before-register")
        XCTAssertTrue(acceptedPendingCancel)
        let cancelledOnRegistration = try await ingressRaceCoordinator.register(jobId: "job-before-register")
        XCTAssertTrue(cancelledOnRegistration.isCancelled, "a sequential cancel must survive task scheduling ahead of registration")

        let shutdownRaceCoordinator = JobCoordinator()
        await shutdownRaceCoordinator.cancelAll()
        let cancelledAfterShutdown = try await shutdownRaceCoordinator.register(jobId: "job-after-eof")
        XCTAssertTrue(cancelledAfterShutdown.isCancelled, "shutdown must cancel transcriptions whose submit task registers late")
    }

    func testCapabilitiesRequestDoesNotAcquireMediaOrInvokeTranscriptionEngine() async throws {
        let writer = RecordingOutputWriter()
        let media = CountingMediaAcquirer()
        let engine = CountingTranscriber()
        let controller = HostController(
            writer: writer,
            mediaDownloader: media,
            transcriptionEngine: engine,
            capabilityProvider: StaticCapabilityProvider(),
            workspaceManager: JobWorkspaceManager(rootURL: FileManager.default.temporaryDirectory)
        )
        let request = Data(#"{"type":"capabilities","requestId":"cap-1","protocolVersion":1}"#.utf8)

        await controller.handlePayload(request)

        let mediaDownloads = await media.downloadCount
        let transcriptions = await engine.transcriptionCount
        XCTAssertEqual(mediaDownloads, 0)
        XCTAssertEqual(transcriptions, 0)
        let messages = writer.messages
        XCTAssertEqual(messages.count, 1)
        let response = try decodeObject(messages[0])
        XCTAssertEqual(response["type"] as? String, "response")
        XCTAssertEqual(response["requestId"] as? String, "cap-1")
        XCTAssertEqual(response["ok"] as? Bool, true)
    }

    func testControllerCancelIsJobScopedSuppressesResultsAndCleansWorkspace() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let sibling = root.appendingPathComponent("keep")
        try Data("safe".utf8).write(to: sibling)
        let writer = RecordingOutputWriter()
        let media = BlockingMediaAcquirer()
        let engine = CountingTranscriber()
        let controller = HostController(
            writer: writer,
            mediaDownloader: media,
            transcriptionEngine: engine,
            capabilityProvider: StaticCapabilityProvider(),
            workspaceManager: JobWorkspaceManager(rootURL: root)
        )
        controller.submit(Data(#"{"type":"transcribe","requestId":"transcribe-1","protocolVersion":1,"jobId":"job-1","sourceLanguage":"zh","source":{"kind":"remote","url":"https://a.bilivideo.com/audio.m4a","headers":{"Referer":"https://www.bilibili.com/","User-Agent":"test"}}}"#.utf8))
        controller.submit(Data(#"{"type":"cancel","requestId":"cancel-1","protocolVersion":1,"jobId":"job-1"}"#.utf8))
        await controller.waitForSubmittedWorkAsync()

        let messages = try writer.messages.map(decodeObject)
        let cancelResponse = try XCTUnwrap(messages.first { $0["type"] as? String == "response" && $0["requestId"] as? String == "cancel-1" })
        XCTAssertEqual((cancelResponse["result"] as? [String: Any])?["cancelled"] as? Bool, true)
        let transcriptionMessages = messages.filter { $0["requestId"] as? String == "transcribe-1" }
        XCTAssertTrue(transcriptionMessages.contains { $0["type"] as? String == "error" && $0["code"] as? String == "CANCELLED" })
        XCTAssertFalse(transcriptionMessages.contains { ["resultBegin", "resultChunk", "resultEnd"].contains($0["type"] as? String ?? "") })
        let transcriptionCount = await engine.transcriptionCount
        XCTAssertEqual(transcriptionCount, 0)
        let remainingFiles = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        XCTAssertEqual(remainingFiles.map { $0.resolvingSymlinksInPath().standardizedFileURL }, [sibling.resolvingSymlinksInPath().standardizedFileURL])
        XCTAssertTrue(FileManager.default.fileExists(atPath: sibling.path))
    }

    func testControllerEmitsHeartbeatWhileTranscriptionEngineIsBlocked() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let writer = RecordingOutputWriter()
        let engine = BlockingSuccessfulTranscriber()
        let heartbeatScheduler = ManualHeartbeatScheduler()
        let controller = HostController(
            writer: writer,
            mediaDownloader: ImmediateMediaAcquirer(),
            transcriptionEngine: engine,
            capabilityProvider: StaticCapabilityProvider(),
            workspaceManager: JobWorkspaceManager(rootURL: root),
            heartbeatScheduler: heartbeatScheduler
        )
        controller.submit(Data(#"{"type":"transcribe","requestId":"heartbeat-1","protocolVersion":1,"jobId":"heartbeat-job","sourceLanguage":"en","source":{"kind":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}"#.utf8))
        await engine.waitUntilStarted()

        heartbeatScheduler.fire()
        let messagesDuringInference = try writer.messages.map(decodeObject)
        let transcribingProgress = messagesDuringInference.filter {
            $0["type"] as? String == "progress"
                && $0["stage"] as? String == "transcribing"
                && $0["requestId"] as? String == "heartbeat-1"
                && $0["jobId"] as? String == "heartbeat-job"
        }
        XCTAssertGreaterThanOrEqual(transcribingProgress.count, 2, "initial progress plus heartbeat must cover long model load/inference")

        await engine.finish()
        await controller.waitForSubmittedWorkAsync()
        let settledMessageCount = writer.messages.count
        heartbeatScheduler.fire()
        XCTAssertEqual(writer.messages.count, settledMessageCount, "settlement must cancel the heartbeat lease")
    }

    func testResultChunkerRemeasuresCompleteEnvelopes() throws {
        let cues = (0..<80).map { index in
            Cue(from: Double(index) * 2, to: Double(index) * 2 + 2, content: String(repeating: "字", count: 1_000))
        }
        let limit = 12 * 1024
        let plan = try ResultChunker(maxMessageBytes: limit).makePlan(
            cues: cues,
            requestId: "request-with-a-deliberately-long-identifier",
            jobId: "job-with-a-deliberately-long-identifier",
            engine: "parakeet"
        )

        XCTAssertGreaterThan(plan.chunks.count, 1)
        XCTAssertTrue(([plan.begin] + plan.chunks + [plan.end]).allSatisfy { $0.count < limit })
        for (sequence, messageData) in plan.chunks.enumerated() {
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: messageData) as? [String: Any])
            XCTAssertEqual(object["sequence"] as? Int, sequence)
            XCTAssertEqual(object["totalChunks"] as? Int, plan.chunks.count)
            XCTAssertEqual(object["requestId"] as? String, "request-with-a-deliberately-long-identifier")
            XCTAssertEqual(object["jobId"] as? String, "job-with-a-deliberately-long-identifier")
        }
    }

    func testResultChunkerRejectsEmptyAndIndividuallyUnchunkableResults() {
        XCTAssertThrowsError(try ResultChunker().makePlan(cues: [], requestId: "r", jobId: "j", engine: "cohere")) { error in
            XCTAssertEqual((error as? AppError)?.code, "RESULT_INCOMPLETE")
        }

        let hugeCue = Cue(from: 0, to: 2, content: String(repeating: "x", count: NativeFrameCodec.maximumOutputBytes))
        XCTAssertThrowsError(try ResultChunker().makePlan(cues: [hugeCue], requestId: "r", jobId: "j", engine: "cohere")) { error in
            XCTAssertEqual((error as? AppError)?.code, "ASR_FAILED")
        }
    }

    func testYouTubeCaptionResultCarriesValidatedTrackMetadataInBeginEnvelope() throws {
        let plan = try ResultChunker().makePlan(
            cues: [Cue(from: 0, to: 1, content: "粵語字幕")],
            requestId: "caption-request",
            jobId: "caption-job",
            engine: "youtube",
            captionMetadata: YouTubeCaptionMetadata(
                language: "yue",
                langDoc: "粵語（自動產生）",
                kind: .automatic
            )
        )
        let begin = try decodeObject(plan.begin)
        XCTAssertEqual(begin["engine"] as? String, "youtube")
        XCTAssertEqual(begin["language"] as? String, "yue")
        XCTAssertEqual(begin["langDoc"] as? String, "粵語（自動產生）")
        XCTAssertEqual(begin["captionKind"] as? String, "auto")
    }

    func testYouTubeCaptionResultRejectsMetadataOutsideTheExtensionContract() {
        XCTAssertThrowsError(try ResultChunker().makePlan(
            cues: [Cue(from: 0, to: 1, content: "caption")],
            requestId: "caption-request",
            jobId: "caption-job",
            engine: "youtube",
            captionMetadata: YouTubeCaptionMetadata(
                language: "not a language code",
                langDoc: "Caption",
                kind: .manual
            )
        )) { error in
            XCTAssertEqual((error as? AppError)?.code, "RESULT_INCOMPLETE")
        }

        XCTAssertThrowsError(try ResultChunker().makePlan(
            cues: [Cue(from: 0, to: 1, content: "caption")],
            requestId: "caption-request",
            jobId: "caption-job",
            engine: "youtube",
            captionMetadata: YouTubeCaptionMetadata(
                language: "en",
                langDoc: String(repeating: "\u{1F642}", count: 81),
                kind: .manual
            )
        )) { error in
            XCTAssertEqual((error as? AppError)?.code, "RESULT_INCOMPLETE")
        }
    }

    func testControllerFetchesYouTubeCaptionsWithoutDownloadingAudioOrRunningASR() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let writer = RecordingOutputWriter()
        let media = CountingMediaAcquirer()
        let engine = CountingTranscriber()
        let captions = SuccessfulYouTubeCaptionFetcher()
        let controller = HostController(
            writer: writer,
            mediaDownloader: media,
            youtubeCaptionFetcher: captions,
            transcriptionEngine: engine,
            capabilityProvider: StaticCapabilityProvider(),
            workspaceManager: JobWorkspaceManager(rootURL: root)
        )

        await controller.handlePayload(Data(#"{"type":"youtubeCaptions","requestId":"caption-1","protocolVersion":1,"jobId":"caption-job","sourceLanguage":"yue","source":{"kind":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}"#.utf8))

        let mediaDownloads = await media.downloadCount
        let transcriptions = await engine.transcriptionCount
        let captionFetches = await captions.fetchCount
        XCTAssertEqual(mediaDownloads, 0)
        XCTAssertEqual(transcriptions, 0)
        XCTAssertEqual(captionFetches, 1)
        let messages = try writer.messages.map(decodeObject)
        let begin = try XCTUnwrap(messages.first { $0["type"] as? String == "resultBegin" })
        XCTAssertEqual(begin["engine"] as? String, "youtube")
        XCTAssertEqual(begin["language"] as? String, "yue")
        XCTAssertEqual(begin["captionKind"] as? String, "auto")
        XCTAssertTrue(messages.contains { $0["type"] as? String == "resultEnd" && $0["cueCount"] as? Int == 1 })
    }

    private func decodeObject(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

private final class RecordingByteReader: NativeByteReading {
    private var chunks: [Data]
    private(set) var readCounts: [Int] = []

    init(chunks: [Data]) {
        self.chunks = chunks
    }

    func read(upToCount count: Int) throws -> Data? {
        readCounts.append(count)
        return chunks.isEmpty ? nil : chunks.removeFirst()
    }
}

private final class RecordingOutputWriter: HostOutputWriting, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [Data] = []
    var messages: [Data] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func writeEncodedPayload(_ payload: Data) throws {
        lock.lock()
        storage.append(payload)
        lock.unlock()
    }
}

private actor CountingMediaAcquirer: MediaAcquiring {
    private(set) var downloadCount = 0

    func acquire(
        source: SourceDescriptor,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL {
        downloadCount += 1
        throw AppError.mediaDownloadFailed
    }
}

private actor CountingTranscriber: Transcribing {
    private(set) var transcriptionCount = 0

    func transcribe(
        mediaURL: URL,
        sourceLanguage: String,
        platformLanguage: String?,
        sourceKind: SourceKind,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> TranscriptionOutput {
        transcriptionCount += 1
        throw AppError.asrFailed
    }
}

private actor SuccessfulYouTubeCaptionFetcher: YouTubeCaptionFetching {
    private(set) var fetchCount = 0

    func fetch(
        source: SourceDescriptor,
        sourceLanguage: String,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> YouTubeCaptionResult {
        fetchCount += 1
        onProgress(1)
        return YouTubeCaptionResult(
            metadata: YouTubeCaptionMetadata(language: "yue", langDoc: "粵語（自動產生）", kind: .automatic),
            cues: [Cue(from: 0, to: 1, content: "原生粵語字幕")]
        )
    }
}

private actor ImmediateMediaAcquirer: MediaAcquiring {
    func acquire(
        source: SourceDescriptor,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL {
        let media = workspace.appendingPathComponent("audio.m4a")
        try Data("audio".utf8).write(to: media)
        return media
    }
}

private actor BlockingSuccessfulTranscriber: Transcribing {
    private var started = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var finishContinuation: CheckedContinuation<Void, Never>?

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }

    func finish() {
        finishContinuation?.resume()
        finishContinuation = nil
    }

    func transcribe(
        mediaURL: URL,
        sourceLanguage: String,
        platformLanguage: String?,
        sourceKind: SourceKind,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> TranscriptionOutput {
        started = true
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        await withCheckedContinuation { finishContinuation = $0 }
        try cancellation.checkCancellation()
        return TranscriptionOutput(engine: "parakeet", cues: [Cue(from: 0, to: 2, content: "heartbeat")])
    }
}

private final class ManualHeartbeatScheduler: HeartbeatScheduling, @unchecked Sendable {
    private let lock = NSLock()
    private var action: (@Sendable () -> Void)?

    func schedule(_ action: @escaping @Sendable () -> Void) -> any HeartbeatLease {
        lock.lock()
        self.action = action
        lock.unlock()
        return ManualHeartbeatLease { [weak self] in self?.clear() }
    }

    func fire() {
        lock.lock()
        let current = action
        lock.unlock()
        current?()
    }

    private func clear() {
        lock.lock()
        action = nil
        lock.unlock()
    }
}

private final class ManualHeartbeatLease: HeartbeatLease, @unchecked Sendable {
    private let cancelAction: @Sendable () -> Void

    init(cancelAction: @escaping @Sendable () -> Void) {
        self.cancelAction = cancelAction
    }

    func cancel() {
        cancelAction()
    }
}

private actor BlockingMediaAcquirer: MediaAcquiring {
    private var started = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }

    func acquire(
        source: SourceDescriptor,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL {
        started = true
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        return try await withCheckedThrowingContinuation { continuation in
            cancellation.onCancel { continuation.resume(throwing: AppError.cancelled) }
        }
    }
}

private struct StaticCapabilityProvider: CapabilityProviding {
    func capabilities() -> HostCapabilities {
        HostCapabilities(
            protocolVersion: 1,
            ytDLP: ComponentCapability(available: false, detail: "not installed"),
            parakeet: ComponentCapability(available: false, detail: "not found"),
            cohere: ComponentCapability(available: false, detail: "not found")
        )
    }
}
