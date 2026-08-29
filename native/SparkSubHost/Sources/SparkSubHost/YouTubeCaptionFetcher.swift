import Foundation

struct YouTubeCaptionCandidate: Equatable, Sendable {
    let language: String
    let label: String
    let kind: YouTubeCaptionKind
}

struct YouTubeCaptionCatalog: Sendable {
    private struct MetadataDocument: Decodable {
        let subtitles: [String: [SubtitleFormat]]?
        let automaticCaptions: [String: [SubtitleFormat]]?

        enum CodingKeys: String, CodingKey {
            case subtitles
            case automaticCaptions = "automatic_captions"
        }
    }

    private struct SubtitleFormat: Decodable, Sendable {
        let ext: String?
        let name: String?
        let url: String?
    }

    private let candidates: [YouTubeCaptionCandidate]

    static func decode(_ data: Data) throws -> YouTubeCaptionCatalog {
        let document: MetadataDocument
        do {
            document = try JSONDecoder().decode(MetadataDocument.self, from: data)
        } catch {
            throw AppError.mediaDownloadFailed
        }

        var candidates: [YouTubeCaptionCandidate] = []
        for (language, formats) in document.subtitles ?? [:] {
            let supportedFormats = formats.filter { isSupportedFormat($0) }
            if let candidate = makeCandidate(language: language, formats: supportedFormats, kind: .manual) {
                candidates.append(candidate)
            }
        }
        for (language, formats) in document.automaticCaptions ?? [:] {
            let supportedFormats = formats.filter { isSupportedFormat($0) }
            let hasOriginal = supportedFormats.contains { format in
                guard let value = format.url else { return false }
                return !containsTranslationParameter(value)
            }
            let kind: YouTubeCaptionKind = hasOriginal ? .automatic : .translated
            if let candidate = makeCandidate(language: language, formats: supportedFormats, kind: kind) {
                candidates.append(candidate)
            }
        }
        return YouTubeCaptionCatalog(candidates: candidates)
    }

    func rankedCandidates(sourceLanguage: String) -> [YouTubeCaptionCandidate] {
        candidates.sorted { left, right in
            let leftKind = Self.kindRank(left.kind)
            let rightKind = Self.kindRank(right.kind)
            if leftKind != rightKind { return leftKind < rightKind }
            let leftLanguage = Self.languageRank(left.language, requested: sourceLanguage)
            let rightLanguage = Self.languageRank(right.language, requested: sourceLanguage)
            if leftLanguage != rightLanguage { return leftLanguage < rightLanguage }
            let normalizedLeft = left.language.lowercased()
            let normalizedRight = right.language.lowercased()
            return normalizedLeft == normalizedRight
                ? left.language < right.language
                : normalizedLeft < normalizedRight
        }
    }

    private static func makeCandidate(
        language: String,
        formats: [SubtitleFormat],
        kind: YouTubeCaptionKind
    ) -> YouTubeCaptionCandidate? {
        let normalizedLanguage = language.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedLanguage.range(of: #"^[A-Za-z0-9._-]{1,64}$"#, options: .regularExpression) != nil,
              normalizedLanguage.lowercased() != "live_chat",
              !formats.isEmpty else { return nil }
        let label = formats.compactMap(\.name).first {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }?.trimmingCharacters(in: .whitespacesAndNewlines) ?? normalizedLanguage
        return YouTubeCaptionCandidate(
            language: normalizedLanguage,
            label: prefixUTF16(label, maximumCodeUnits: 160),
            kind: kind
        )
    }

    private static func prefixUTF16(_ value: String, maximumCodeUnits: Int) -> String {
        var result = ""
        var usedCodeUnits = 0
        for character in value {
            let fragment = String(character)
            let codeUnits = fragment.utf16.count
            guard usedCodeUnits + codeUnits <= maximumCodeUnits else { break }
            result.append(character)
            usedCodeUnits += codeUnits
        }
        return result
    }

    private static func containsTranslationParameter(_ value: String) -> Bool {
        if let components = URLComponents(string: value),
           components.queryItems?.contains(where: { $0.name.lowercased() == "tlang" }) == true {
            return true
        }
        return value.range(of: #"(?:[?&]|%26)tlang(?:=|%3[dD])"#, options: .regularExpression) != nil
    }

    private static func isSupportedFormat(_ format: SubtitleFormat) -> Bool {
        guard let ext = format.ext?.lowercased() else { return false }
        return ext == "json3" || ext == "vtt"
    }

    private static func kindRank(_ kind: YouTubeCaptionKind) -> Int {
        switch kind {
        case .manual: return 0
        case .automatic: return 1
        case .translated: return 2
        }
    }

    private static func languageRank(_ language: String, requested: String) -> Int {
        let normalized = normalizeLanguage(language)
        let normalizedRequested = normalizeLanguage(requested)
        if normalizedRequested != "auto", languageMatches(normalized, requested: normalizedRequested) { return 0 }
        if normalized == "zh" || normalized.hasPrefix("zh-") || normalized == "yue" || normalized.hasPrefix("yue-") { return 1 }
        if normalized == "en" || normalized.hasPrefix("en-") { return 2 }
        return 3
    }

    private static func languageMatches(_ language: String, requested: String) -> Bool {
        let cantonese = Set(["yue", "zh-hk", "zh-yue", "zh-hant-hk"])
        if cantonese.contains(requested) || requested.hasPrefix("yue-") {
            return cantonese.contains(language) || language.hasPrefix("yue-")
        }
        if requested == "zh" { return language == "zh" || language.hasPrefix("zh-") }
        return language == requested || language.hasPrefix(requested + "-")
    }

    private static func normalizeLanguage(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: "_", with: "-")
    }
}

struct YTDLPCommandInvocation: Sendable {
    let executableURL: URL
    let arguments: [String]
    let workspaceURL: URL
}

struct YTDLPCommandOutput: Sendable {
    let stdout: Data
    let stderr: Data

    init(stdout: Data = Data(), stderr: Data = Data()) {
        self.stdout = stdout
        self.stderr = stderr
    }
}

protocol YTDLPCommandExecuting: Sendable {
    func execute(invocation: YTDLPCommandInvocation, cancellation: CancellationToken) async throws -> YTDLPCommandOutput
}

protocol YouTubeCaptionFetching: Sendable {
    func fetch(
        source: SourceDescriptor,
        sourceLanguage: String,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> YouTubeCaptionResult
}

struct UnavailableYouTubeCaptionFetcher: YouTubeCaptionFetching {
    func fetch(
        source: SourceDescriptor,
        sourceLanguage: String,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> YouTubeCaptionResult {
        throw AppError.captionsNotFound
    }
}

struct YouTubeCaptionFetcher: YouTubeCaptionFetching, Sendable {
    let ytDLPExecutableURL: URL
    let commandExecutor: YTDLPCommandExecuting

    init(
        ytDLPExecutableURL: URL,
        commandExecutor: YTDLPCommandExecuting = YTDLPCommandProcessExecutor()
    ) {
        self.ytDLPExecutableURL = ytDLPExecutableURL
        self.commandExecutor = commandExecutor
    }

    func makeMetadataInvocation(urlString: String, workspace: URL) throws -> YTDLPCommandInvocation {
        let url = try validatedInvocationInputs(urlString: urlString, workspace: workspace)
        return YTDLPCommandInvocation(
            executableURL: ytDLPExecutableURL,
            arguments: [
                "--no-config",
                "--no-playlist",
                "--skip-download",
                "--ignore-no-formats-error",
                "--dump-single-json",
                "--quiet",
                url.absoluteString,
            ],
            workspaceURL: workspace
        )
    }

    func makeDownloadInvocation(
        urlString: String,
        candidate: YouTubeCaptionCandidate,
        workspace: URL
    ) throws -> YTDLPCommandInvocation {
        let url = try validatedInvocationInputs(urlString: urlString, workspace: workspace)
        guard candidate.language.range(of: #"^[A-Za-z0-9._-]{1,64}$"#, options: .regularExpression) != nil else {
            throw AppError.invalidRequest
        }
        let output = workspace.appendingPathComponent("caption.%(ext)s", isDirectory: false)
        guard isContained(output, in: workspace) else { throw AppError.invalidRequest }
        let writeFlag = candidate.kind == .manual ? "--write-subs" : "--write-auto-subs"
        return YTDLPCommandInvocation(
            executableURL: ytDLPExecutableURL,
            arguments: [
                "--no-config",
                "--no-playlist",
                "--skip-download",
                "--ignore-no-formats-error",
                writeFlag,
                "--sub-langs", "^\(escapedLanguagePattern(candidate.language))$",
                "--sub-format", "json3/vtt/best",
                "--output", output.path,
                "--quiet",
                url.absoluteString,
            ],
            workspaceURL: workspace
        )
    }

    func fetch(
        source: SourceDescriptor,
        sourceLanguage: String,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> YouTubeCaptionResult {
        guard source.kind == .youtube else { throw AppError.invalidRequest }
        try cancellation.checkCancellation()
        guard FileManager.default.isExecutableFile(atPath: ytDLPExecutableURL.path) else {
            throw AppError.ytDLPNotInstalled
        }
        guard YTDLPConfiguration.isVerifiedInstallation(at: ytDLPExecutableURL) else {
            throw AppError.ytDLPChecksumFailed
        }

        onProgress(0.05)
        let metadataOutput = try await commandExecutor.execute(
            invocation: makeMetadataInvocation(urlString: source.url, workspace: workspace),
            cancellation: cancellation
        )
        try cancellation.checkCancellation()
        let candidates = try YouTubeCaptionCatalog.decode(metadataOutput.stdout)
            .rankedCandidates(sourceLanguage: sourceLanguage)
        guard !candidates.isEmpty else { throw AppError.captionsNotFound }

        var successfulDownloadCount = 0
        var lastDownloadError: AppError?
        for (index, candidate) in candidates.enumerated() {
            try cancellation.checkCancellation()
            try Self.removeCaptionOutputs(in: workspace)
            let fraction = Double(index) / Double(max(1, candidates.count))
            onProgress(0.35 + fraction * 0.45)
            do {
                _ = try await commandExecutor.execute(
                    invocation: makeDownloadInvocation(urlString: source.url, candidate: candidate, workspace: workspace),
                    cancellation: cancellation
                )
                successfulDownloadCount += 1
            } catch {
                if cancellation.isCancelled { throw AppError.cancelled }
                let appError = error as? AppError ?? AppError.mediaDownloadFailed
                if appError.code == AppError.mediaDownloadFailed.code {
                    lastDownloadError = appError
                    continue
                }
                throw appError
            }

            try cancellation.checkCancellation()
            do {
                let subtitleURL = try Self.validatedSubtitleOutput(in: workspace)
                let data = try Data(contentsOf: subtitleURL, options: [.mappedIfSafe])
                let cues = try YouTubeCaptionTextParser.parse(data, fileExtension: subtitleURL.pathExtension)
                guard !cues.isEmpty, cues.allSatisfy(\.isValid) else { throw AppError.resultIncomplete }
                onProgress(1)
                return YouTubeCaptionResult(
                    metadata: YouTubeCaptionMetadata(
                        language: candidate.language,
                        langDoc: candidate.label,
                        kind: candidate.kind
                    ),
                    cues: cues
                )
            } catch let appError as AppError {
                let isCandidateFailure = [AppError.captionsNotFound.code, AppError.resultIncomplete.code]
                    .contains(appError.code)
                if isCandidateFailure {
                    continue
                }
                throw appError
            } catch {
                // A candidate whose output cannot be read must not block a
                // later automatic or translated track from completing.
                continue
            }
        }

        try Self.removeCaptionOutputs(in: workspace)
        if successfulDownloadCount == 0, let lastDownloadError { throw lastDownloadError }
        throw AppError.captionsNotFound
    }

    static func removeCaptionOutputs(in workspace: URL) throws {
        let canonicalWorkspace = workspace.resolvingSymlinksInPath().standardizedFileURL
        let files = try FileManager.default.contentsOfDirectory(
            at: workspace,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        for file in files where file.lastPathComponent.hasPrefix("caption.") {
            let canonicalParent = file.deletingLastPathComponent()
                .resolvingSymlinksInPath()
                .standardizedFileURL
            guard canonicalParent.path == canonicalWorkspace.path else { throw AppError.invalidRequest }
            try FileManager.default.removeItem(at: file)
        }
    }

    static func validatedSubtitleOutput(in workspace: URL) throws -> URL {
        let workspacePath = workspace.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        let files = try FileManager.default.contentsOfDirectory(
            at: workspace,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        )
        let candidates = try files.filter { candidate in
            let values = try candidate.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            return values.isRegularFile == true
                && values.isSymbolicLink != true
                && (1...(32 * 1024 * 1024)).contains(values.fileSize ?? 0)
                && candidate.lastPathComponent.hasPrefix("caption.")
                && !candidate.lastPathComponent.hasSuffix(".part")
                && ["json3", "vtt"].contains(candidate.pathExtension.lowercased())
                && candidate.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(workspacePath)
        }
        let sorted = candidates.sorted { left, right in
            if left.pathExtension.lowercased() != right.pathExtension.lowercased() {
                return left.pathExtension.lowercased() == "json3"
            }
            return left.lastPathComponent < right.lastPathComponent
        }
        guard let output = sorted.first else { throw AppError.captionsNotFound }
        return output
    }

    private func validatedInvocationInputs(urlString: String, workspace: URL) throws -> URL {
        let url = try URLPolicy.canonicalYouTubeURL(urlString)
        guard ytDLPExecutableURL.isFileURL,
              ytDLPExecutableURL.lastPathComponent == "yt-dlp_macos",
              workspace.isFileURL else {
            throw AppError.invalidRequest
        }
        return url
    }

    private func escapedLanguagePattern(_ language: String) -> String {
        language.map { character in
            character.isLetter || character.isNumber ? String(character) : "\\\(character)"
        }.joined()
    }

    private func isContained(_ child: URL, in parent: URL) -> Bool {
        let parentPath = parent.resolvingSymlinksInPath().standardizedFileURL.path
        let childParent = child.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL
        return childParent.appendingPathComponent(child.lastPathComponent).path.hasPrefix(parentPath + "/")
    }
}

enum YouTubeCaptionTextParser {
    static func parse(_ data: Data, fileExtension: String) throws -> [Cue] {
        switch fileExtension.lowercased() {
        case "json3": return try parseJSON3(data)
        case "vtt": return try parseWebVTT(data)
        default: throw AppError.resultIncomplete
        }
    }

    private static func parseJSON3(_ data: Data) throws -> [Cue] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let events = root["events"] as? [[String: Any]] else {
            throw AppError.resultIncomplete
        }
        let cues = events.compactMap { event -> Cue? in
            guard let startMilliseconds = number(event["tStartMs"]), startMilliseconds >= 0,
                  let segments = event["segs"] as? [[String: Any]] else { return nil }
            let text = segments.compactMap { $0["utf8"] as? String }.joined()
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            let durationMilliseconds = max(1, number(event["dDurationMs"]) ?? 2_000)
            return Cue(
                from: startMilliseconds / 1_000,
                to: (startMilliseconds + durationMilliseconds) / 1_000,
                content: text
            )
        }
        guard !cues.isEmpty, cues.allSatisfy(\.isValid) else { throw AppError.resultIncomplete }
        return cues
    }

    private static func parseWebVTT(_ data: Data) throws -> [Cue] {
        guard let source = String(data: data, encoding: .utf8) else { throw AppError.resultIncomplete }
        let blocks = source.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n\n")
        let cues = blocks.compactMap { block -> Cue? in
            let lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            guard let timingIndex = lines.firstIndex(where: { $0.contains("-->") }) else { return nil }
            let parts = lines[timingIndex].components(separatedBy: "-->")
            guard parts.count == 2,
                  let from = parseTimestamp(parts[0].trimmingCharacters(in: .whitespaces)),
                  let toToken = parts[1].split(whereSeparator: { $0.isWhitespace }).first,
                  let to = parseTimestamp(String(toToken)), to > from else { return nil }
            let text = decodeEntities(stripTags(lines.dropFirst(timingIndex + 1).joined(separator: "\n")))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return Cue(from: from, to: to, content: text)
        }
        guard !cues.isEmpty, cues.allSatisfy(\.isValid) else { throw AppError.resultIncomplete }
        return cues
    }

    private static func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private static func parseTimestamp(_ value: String) -> Double? {
        let parts = value.split(separator: ":").compactMap { Double($0.replacingOccurrences(of: ",", with: ".")) }
        guard parts.count == 2 || parts.count == 3 else { return nil }
        if parts.count == 2 { return parts[0] * 60 + parts[1] }
        return parts[0] * 3_600 + parts[1] * 60 + parts[2]
    }

    private static func stripTags(_ value: String) -> String {
        value.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
    }

    private static func decodeEntities(_ value: String) -> String {
        value.replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
    }
}

final class YTDLPCommandProcessExecutor: YTDLPCommandExecuting, @unchecked Sendable {
    private static let maximumCapturedBytes = 32 * 1024 * 1024

    func execute(invocation: YTDLPCommandInvocation, cancellation: CancellationToken) async throws -> YTDLPCommandOutput {
        try cancellation.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            let completion = YTDLPCommandCompletion(continuation)
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            let stdout = BoundedProcessBuffer(limit: Self.maximumCapturedBytes)
            let stderr = BoundedProcessBuffer(limit: Self.maximumCapturedBytes)
            var environment = ProcessInfo.processInfo.environment
            let homebrewPaths = "/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin:/usr/local/sbin"
            let existingPath = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
            environment["PATH"] = "\(homebrewPaths):\(existingPath)"
            process.environment = environment
            process.executableURL = invocation.executableURL
            process.arguments = invocation.arguments
            process.currentDirectoryURL = invocation.workspaceURL
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    handle.readabilityHandler = nil
                    return
                }
                if !stdout.append(data), process.isRunning { process.terminate() }
            }
            stderrPipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    handle.readabilityHandler = nil
                    return
                }
                if !stderr.append(data), process.isRunning { process.terminate() }
            }
            process.terminationHandler = { terminated in
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                _ = stdout.append(stdoutPipe.fileHandleForReading.readDataToEndOfFile())
                _ = stderr.append(stderrPipe.fileHandleForReading.readDataToEndOfFile())
                if cancellation.isCancelled {
                    completion.resume(throwing: AppError.cancelled)
                    return
                }
                guard !stdout.didOverflow, !stderr.didOverflow else {
                    completion.resume(throwing: AppError.mediaDownloadFailed)
                    return
                }
                guard terminated.terminationStatus == 0 else {
                    var diagnosticData = stdout.data
                    diagnosticData.append(stderr.data)
                    let diagnostics = String(data: diagnosticData, encoding: .utf8) ?? ""
                    completion.resume(throwing: YTDLPProcessExecutor.classifyFailure(
                        exitCode: terminated.terminationStatus,
                        output: diagnostics
                    ))
                    return
                }
                completion.resume(returning: YTDLPCommandOutput(stdout: stdout.data, stderr: stderr.data))
            }
            cancellation.onCancel {
                if process.isRunning { process.terminate() }
            }
            do {
                try process.run()
                if cancellation.isCancelled, process.isRunning { process.terminate() }
            } catch {
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                completion.resume(throwing: AppError.ytDLPNotInstalled)
            }
        }
    }
}

private final class YTDLPCommandCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<YTDLPCommandOutput, Error>?

    init(_ continuation: CheckedContinuation<YTDLPCommandOutput, Error>) {
        self.continuation = continuation
    }

    func resume(returning output: YTDLPCommandOutput) {
        takeContinuation()?.resume(returning: output)
    }

    func resume(throwing error: Error) {
        takeContinuation()?.resume(throwing: error)
    }

    private func takeContinuation() -> CheckedContinuation<YTDLPCommandOutput, Error>? {
        lock.lock()
        defer { lock.unlock() }
        let pending = continuation
        continuation = nil
        return pending
    }
}

private final class BoundedProcessBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private let limit: Int
    private var storage = Data()
    private var overflow = false

    init(limit: Int) {
        self.limit = limit
    }

    var data: Data {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    var didOverflow: Bool {
        lock.lock()
        defer { lock.unlock() }
        return overflow
    }

    func append(_ data: Data) -> Bool {
        guard !data.isEmpty else { return true }
        lock.lock()
        defer { lock.unlock() }
        guard !overflow, storage.count + data.count <= limit else {
            overflow = true
            return false
        }
        storage.append(data)
        return true
    }
}
