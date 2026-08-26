import Foundation

struct AppError: Error, Equatable, Sendable {
    let code: String
    let message: String
    let hint: String
    let retriable: Bool

    static let invalidRequest = AppError(
        code: "INVALID_REQUEST",
        message: "The native transcription request is invalid.",
        hint: "Check the video source and transcription settings.",
        retriable: false
    )
    static let protocolMismatch = AppError(
        code: "PROTOCOL_MISMATCH",
        message: "The native messaging protocol version is incompatible.",
        hint: "Update both SparkSub and its native host.",
        retriable: false
    )
    static let protocolMessageTooLarge = AppError(
        code: "PROTOCOL_MESSAGE_TOO_LARGE",
        message: "A native messaging payload exceeds the allowed size.",
        hint: "Retry the job; update SparkSub if the problem continues.",
        retriable: false
    )
    static let ytDLPNotInstalled = AppError(
        code: "YTDLP_NOT_INSTALLED",
        message: "The pinned YouTube downloader is not installed.",
        hint: "Run the SparkSub native host installer.",
        retriable: false
    )
    static let ytDLPChecksumFailed = AppError(
        code: "YTDLP_CHECKSUM_FAILED",
        message: "The YouTube downloader version could not be verified.",
        hint: "Reinstall the SparkSub native host downloader.",
        retriable: false
    )
    static let mediaAuthRequired = AppError(
        code: "MEDIA_AUTH_REQUIRED",
        message: "The media requires authentication or additional access.",
        hint: "This release supports only publicly accessible videos.",
        retriable: false
    )
    static let mediaDownloadFailed = AppError(
        code: "MEDIA_DOWNLOAD_FAILED",
        message: "The media download failed.",
        hint: "Check that the video is public and try again.",
        retriable: true
    )
    static let captionsNotFound = AppError(
        code: "CAPTIONS_NOT_FOUND",
        message: "No public YouTube caption track was found.",
        hint: "Use local transcription when the selected language is supported.",
        retriable: false
    )
    static let modelNotFound = AppError(
        code: "MODEL_NOT_FOUND",
        message: "A required local transcription model was not found.",
        hint: "Install every required model asset and try again.",
        retriable: false
    )
    static let modelLayoutIncompatible = AppError(
        code: "MODEL_LAYOUT_INCOMPATIBLE",
        message: "The local transcription model layout is incompatible.",
        hint: "Install a supported model version with its vocabulary.",
        retriable: false
    )
    static let languageUnsupported = AppError(
        code: "ASR_LANGUAGE_UNSUPPORTED",
        message: "The local models do not support the requested language.",
        hint: "Use a platform caption or select a supported language.",
        retriable: false
    )
    static let asrFailed = AppError(
        code: "ASR_FAILED",
        message: "Local transcription failed.",
        hint: "Check the local models and try again.",
        retriable: true
    )
    static let resultIncomplete = AppError(
        code: "RESULT_INCOMPLETE",
        message: "The transcription result is empty or incomplete.",
        hint: "Retry the transcription job.",
        retriable: true
    )
    static let cancelled = AppError(
        code: "CANCELLED",
        message: "The transcription was cancelled.",
        hint: "Start the job again when ready.",
        retriable: false
    )

    var jsonObject: [String: Any] {
        ["code": code, "message": message, "hint": hint, "retriable": retriable]
    }

    static func normalize(_ error: Error) -> AppError {
        if let appError = error as? AppError { return appError }
        if error is CancellationError { return .cancelled }
        return .asrFailed
    }
}

struct Cue: Codable, Equatable, Sendable {
    let from: Double
    let to: Double
    let content: String

    var isValid: Bool {
        from.isFinite && to.isFinite && from >= 0 && to > from
            && !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

enum YouTubeCaptionKind: String, Codable, Equatable, Sendable {
    case manual
    case automatic = "auto"
    case translated
}

struct YouTubeCaptionMetadata: Equatable, Sendable {
    let language: String
    let langDoc: String
    let kind: YouTubeCaptionKind
}

struct YouTubeCaptionResult: Equatable, Sendable {
    let metadata: YouTubeCaptionMetadata
    let cues: [Cue]
}

enum SourceKind: String, Codable, Sendable {
    case youtube
    case remote
}

struct RemoteSource: Codable, Equatable, Sendable {
    let url: String
    let backupUrls: [String]
    let headers: [String: String]

    init(url: String, backupUrls: [String] = [], headers: [String: String] = [:]) {
        self.url = url
        self.backupUrls = backupUrls
        self.headers = headers
    }
}

struct SourceDescriptor: Codable, Equatable, Sendable {
    let kind: SourceKind
    let url: String
    let backupUrls: [String]?
    let headers: [String: String]?

    var remoteSource: RemoteSource {
        RemoteSource(url: url, backupUrls: backupUrls ?? [], headers: headers ?? [:])
    }
}

enum NativeRequestType: String, Codable, Sendable {
    case capabilities
    case ping
    case transcribe
    case youtubeCaptions
    case cancel
}

struct NativeRequest: Decodable, Sendable {
    static let protocolVersion = 1

    let type: NativeRequestType
    let requestId: String
    let protocolVersion: Int
    let jobId: String?
    let sourceLanguage: String?
    let title: String?
    let duration: Double?
    let platformLanguage: String?
    let source: SourceDescriptor?

    static func decodeAndValidate(_ data: Data) throws -> NativeRequest {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let typeName = object["type"] as? String,
              let type = NativeRequestType(rawValue: typeName) else {
            throw AppError.invalidRequest
        }
        let baseKeys: Set<String> = ["type", "requestId", "protocolVersion"]
        let allowedKeys: Set<String>
        switch type {
        case .capabilities, .ping:
            allowedKeys = baseKeys
        case .cancel:
            allowedKeys = baseKeys.union(["jobId"])
        case .transcribe:
            allowedKeys = baseKeys.union(["jobId", "sourceLanguage", "title", "duration", "platformLanguage", "source"])
        case .youtubeCaptions:
            allowedKeys = baseKeys.union(["jobId", "sourceLanguage", "source"])
        }
        guard Set(object.keys).isSubset(of: allowedKeys) else { throw AppError.invalidRequest }

        let request: NativeRequest
        do {
            request = try JSONDecoder().decode(NativeRequest.self, from: data)
        } catch {
            throw AppError.invalidRequest
        }
        guard request.protocolVersion == protocolVersion else { throw AppError.protocolMismatch }
        guard !request.requestId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AppError.invalidRequest
        }
        switch request.type {
        case .capabilities, .ping:
            break
        case .cancel:
            guard request.jobId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
                throw AppError.invalidRequest
            }
        case .transcribe, .youtubeCaptions:
            guard request.jobId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
                  request.sourceLanguage?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
                  let source = request.source else {
                throw AppError.invalidRequest
            }
            let sourceObject = object["source"] as? [String: Any]
            let allowedSourceKeys: Set<String> = source.kind == .youtube
                ? ["kind", "url"]
                : ["kind", "url", "backupUrls", "headers"]
            guard let sourceObject, Set(sourceObject.keys).isSubset(of: allowedSourceKeys) else {
                throw AppError.invalidRequest
            }
            if request.type == .youtubeCaptions, source.kind != .youtube { throw AppError.invalidRequest }
            if let duration = request.duration, !duration.isFinite || duration < 0 { throw AppError.invalidRequest }
        }
        return request
    }
}

enum NativeFrameCodec {
    static let maximumInputBytes = 64 * 1024 * 1024
    static let maximumOutputBytes = 900 * 1024

    static func parseLengthPrefix<T: DataProtocol>(_ header: T, maxPayloadBytes: Int = maximumInputBytes) throws -> Int {
        let bytes = Array(header)
        guard bytes.count == 4 else { throw AppError.invalidRequest }
        let value = Int(bytes[0])
            | (Int(bytes[1]) << 8)
            | (Int(bytes[2]) << 16)
            | (Int(bytes[3]) << 24)
        guard value > 0 else { throw AppError.invalidRequest }
        guard value <= maxPayloadBytes else { throw AppError.protocolMessageTooLarge }
        return value
    }

    static func makeFrame(payload: Data, maxPayloadBytes: Int = maximumOutputBytes) throws -> Data {
        guard !payload.isEmpty else { throw AppError.invalidRequest }
        guard payload.count < maxPayloadBytes else { throw AppError.protocolMessageTooLarge }
        guard payload.count <= Int(UInt32.max) else { throw AppError.protocolMessageTooLarge }
        var length = UInt32(payload.count).littleEndian
        var frame = withUnsafeBytes(of: &length) { Data($0) }
        frame.append(payload)
        return frame
    }

    static func readFrame(from input: NativeByteReading) throws -> Data? {
        guard let first = try input.read(upToCount: 4), !first.isEmpty else { return nil }
        var header = first
        while header.count < 4 {
            guard let next = try input.read(upToCount: 4 - header.count), !next.isEmpty else {
                throw AppError.invalidRequest
            }
            header.append(next)
        }
        let length = try parseLengthPrefix(header)
        var payload = Data()
        payload.reserveCapacity(length)
        while payload.count < length {
            guard let next = try input.read(upToCount: min(64 * 1024, length - payload.count)), !next.isEmpty else {
                throw AppError.invalidRequest
            }
            payload.append(next)
        }
        return payload
    }
}

protocol NativeByteReading: AnyObject {
    func read(upToCount count: Int) throws -> Data?
}

extension FileHandle: NativeByteReading {}

protocol HostOutputWriting: Sendable {
    func writeEncodedPayload(_ payload: Data) throws
}

enum NativeEnvelope {
    static func response(requestId: String, result: [String: Any]) throws -> Data {
        try encode(["type": "response", "requestId": requestId, "ok": true, "result": result])
    }

    static func failureResponse(requestId: String, error: AppError) throws -> Data {
        try encode(["type": "response", "requestId": requestId, "ok": false, "error": error.jsonObject])
    }

    static func progress(requestId: String, jobId: String, stage: String, percent: Int, hint: String) throws -> Data {
        try encode([
            "type": "progress", "requestId": requestId, "jobId": jobId,
            "stage": stage, "percent": percent, "hint": hint,
        ])
    }

    static func topLevelError(requestId: String, jobId: String?, error: AppError) throws -> Data {
        var object = error.jsonObject
        object["type"] = "error"
        object["requestId"] = requestId
        if let jobId { object["jobId"] = jobId }
        return try encode(object)
    }

    private static func encode(_ object: [String: Any]) throws -> Data {
        do {
            let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            guard data.count < NativeFrameCodec.maximumOutputBytes else {
                throw AppError.protocolMessageTooLarge
            }
            return data
        } catch let error as AppError {
            throw error
        } catch {
            throw AppError.invalidRequest
        }
    }
}

final class NativeMessageWriter: HostOutputWriting, @unchecked Sendable {
    private let output: FileHandle
    private let lock = NSLock()

    init(output: FileHandle) {
        self.output = output
    }

    func writeJSONObject(_ object: [String: Any]) throws {
        let payload: Data
        do {
            payload = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        } catch {
            throw AppError.invalidRequest
        }
        let frame = try NativeFrameCodec.makeFrame(payload: payload)
        lock.lock()
        defer { lock.unlock() }
        try output.write(contentsOf: frame)
    }

    func writeEncodedPayload(_ payload: Data) throws {
        let frame = try NativeFrameCodec.makeFrame(payload: payload)
        lock.lock()
        defer { lock.unlock() }
        try output.write(contentsOf: frame)
    }
}

struct ResultEnvelopePlan: Sendable {
    let begin: Data
    let chunks: [Data]
    let end: Data
}

struct ResultChunker: Sendable {
    let maxMessageBytes: Int

    init(maxMessageBytes: Int = NativeFrameCodec.maximumOutputBytes) {
        self.maxMessageBytes = maxMessageBytes
    }

    func makePlan(
        cues: [Cue],
        requestId: String,
        jobId: String,
        engine: String,
        captionMetadata: YouTubeCaptionMetadata? = nil
    ) throws -> ResultEnvelopePlan {
        guard !cues.isEmpty, cues.allSatisfy(\.isValid) else { throw AppError.resultIncomplete }
        guard maxMessageBytes > 256 else { throw AppError.protocolMessageTooLarge }

        var groups: [[Cue]] = []
        var current: [Cue] = []
        let targetBytes = min(800 * 1024, maxMessageBytes - max(64, maxMessageBytes / 10))
        for cue in cues {
            let candidate = current + [cue]
            let candidateData = try chunkData(
                candidate,
                requestId: requestId,
                jobId: jobId,
                sequence: cues.count,
                totalChunks: cues.count
            )
            if candidateData.count < targetBytes {
                current = candidate
            } else {
                if current.isEmpty { throw AppError.asrFailed }
                groups.append(current)
                current = [cue]
            }
        }
        if !current.isEmpty { groups.append(current) }

        var changed = true
        while changed {
            changed = false
            var revised: [[Cue]] = []
            for (sequence, group) in groups.enumerated() {
                let data = try chunkData(group, requestId: requestId, jobId: jobId, sequence: sequence, totalChunks: groups.count)
                if data.count < maxMessageBytes {
                    revised.append(group)
                } else if group.count > 1 {
                    let midpoint = group.count / 2
                    revised.append(Array(group[..<midpoint]))
                    revised.append(Array(group[midpoint...]))
                    changed = true
                } else {
                    throw AppError.asrFailed
                }
            }
            groups = revised
        }

        var beginObject: [String: Any] = [
            "type": "resultBegin", "requestId": requestId, "jobId": jobId,
            "totalChunks": groups.count, "engine": engine,
        ]
        if let captionMetadata {
            let language = captionMetadata.language.trimmingCharacters(in: .whitespacesAndNewlines)
            let langDoc = captionMetadata.langDoc.trimmingCharacters(in: .whitespacesAndNewlines)
            guard language.range(of: #"^[A-Za-z0-9._-]{1,64}$"#, options: .regularExpression) != nil,
                  !langDoc.isEmpty,
                  langDoc.utf16.count <= 160,
                  engine == "youtube" else {
                throw AppError.resultIncomplete
            }
            beginObject["language"] = language
            beginObject["langDoc"] = langDoc
            beginObject["captionKind"] = captionMetadata.kind.rawValue
        }
        let begin = try encode(beginObject)
        let chunks = try groups.enumerated().map { sequence, group in
            try chunkData(group, requestId: requestId, jobId: jobId, sequence: sequence, totalChunks: groups.count)
        }
        let end = try encode([
            "type": "resultEnd", "requestId": requestId, "jobId": jobId,
            "totalChunks": groups.count, "cueCount": cues.count,
        ])
        guard ([begin] + chunks + [end]).allSatisfy({ $0.count < maxMessageBytes }) else {
            throw AppError.protocolMessageTooLarge
        }
        return ResultEnvelopePlan(begin: begin, chunks: chunks, end: end)
    }

    private func chunkData(
        _ cues: [Cue],
        requestId: String,
        jobId: String,
        sequence: Int,
        totalChunks: Int
    ) throws -> Data {
        try encode([
            "type": "resultChunk", "requestId": requestId, "jobId": jobId,
            "sequence": sequence, "totalChunks": totalChunks,
            "cues": cues.map { ["from": $0.from, "to": $0.to, "content": $0.content] },
        ])
    }

    private func encode(_ object: [String: Any]) throws -> Data {
        do {
            return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        } catch {
            throw AppError.asrFailed
        }
    }
}

final class CancellationToken: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var handlers: [@Sendable () -> Void] = []

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func checkCancellation() throws {
        if isCancelled { throw AppError.cancelled }
    }

    func onCancel(_ handler: @escaping @Sendable () -> Void) {
        lock.lock()
        if cancelled {
            lock.unlock()
            handler()
        } else {
            handlers.append(handler)
            lock.unlock()
        }
    }

    func cancel() {
        let pending: [@Sendable () -> Void]
        lock.lock()
        guard !cancelled else {
            lock.unlock()
            return
        }
        cancelled = true
        pending = handlers
        handlers.removeAll()
        lock.unlock()
        pending.forEach { $0() }
    }
}
