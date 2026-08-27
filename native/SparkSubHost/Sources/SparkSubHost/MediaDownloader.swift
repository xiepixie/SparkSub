import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum URLPolicy {
    private static let bilibiliSuffixes = [
        "bilivideo.com", "bilivideo.cn", "hdslb.com", "hdslb.net", "biliapi.net",
    ]

    static func canonicalYouTubeURL(_ value: String) throws -> URL {
        guard let components = URLComponents(string: value),
              components.scheme == "https",
              components.host?.lowercased() == "www.youtube.com",
              components.port == nil,
              components.user == nil,
              components.password == nil,
              components.path == "/watch",
              components.fragment == nil,
              let queryItems = components.queryItems,
              queryItems.count == 1,
              queryItems[0].name == "v",
              let videoID = queryItems[0].value,
              videoID.range(of: #"^[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil,
              let url = components.url else {
            throw AppError.invalidRequest
        }
        return url
    }

    static func validatedRemoteSource(_ source: RemoteSource) throws -> (urls: [URL], headers: [String: String]) {
        let allowedHeaderNames = Set(["referer", "user-agent"])
        guard source.headers.keys.allSatisfy({ allowedHeaderNames.contains($0.lowercased()) }) else {
            throw AppError.invalidRequest
        }
        var canonicalHeaders: [String: String] = [:]
        for (name, value) in source.headers {
            guard !value.contains("\r"), !value.contains("\n") else { throw AppError.invalidRequest }
            switch name.lowercased() {
            case "referer": canonicalHeaders["Referer"] = value
            case "user-agent": canonicalHeaders["User-Agent"] = value
            default: throw AppError.invalidRequest
            }
        }
        guard canonicalHeaders["Referer"] == "https://www.bilibili.com/",
              canonicalHeaders["User-Agent"]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            throw AppError.invalidRequest
        }
        let urls = try ([source.url] + source.backupUrls).map(validatedBilibiliURL)
        guard !urls.isEmpty else { throw AppError.invalidRequest }
        return (urls, canonicalHeaders)
    }

    static func validatedBilibiliURL(_ value: String) throws -> URL {
        guard let components = URLComponents(string: value),
              components.scheme == "https",
              components.user == nil,
              components.password == nil,
              let host = components.host?.lowercased(),
              bilibiliSuffixes.contains(where: { host == $0 || host.hasSuffix("." + $0) }),
              let url = components.url else {
            throw AppError.invalidRequest
        }
        return url
    }
}

struct YTDLPConfiguration {
    static let pinnedVersion = "2026.08.19"

    static func isVerifiedInstallation(at executable: URL) -> Bool {
        guard executable.lastPathComponent == "yt-dlp_macos",
              FileManager.default.isExecutableFile(atPath: executable.path) else { return false }
        let versionFile = executable.deletingLastPathComponent().appendingPathComponent("yt-dlp_macos.version")
        guard let version = try? String(contentsOf: versionFile, encoding: .utf8) else { return false }
        return version.trimmingCharacters(in: .whitespacesAndNewlines) == pinnedVersion
    }
}

struct YTDLPInvocation: Sendable {
    let executableURL: URL
    let arguments: [String]
    let workspaceURL: URL
}

protocol RemoteDownloading: Sendable {
    func download(url: URL, headers: [String: String], destination: URL, cancellation: CancellationToken) async throws
}

protocol YTDLPExecuting: Sendable {
    func execute(
        invocation: YTDLPInvocation,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL
}

protocol MediaAcquiring: Sendable {
    func acquire(
        source: SourceDescriptor,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL
}

struct MediaDownloader: MediaAcquiring, Sendable {
    let ytDLPExecutableURL: URL
    let remoteDownloader: RemoteDownloading
    let processExecutor: YTDLPExecuting

    init(
        ytDLPExecutableURL: URL,
        remoteDownloader: RemoteDownloading = URLSessionRemoteDownloader(),
        processExecutor: YTDLPExecuting = YTDLPProcessExecutor()
    ) {
        self.ytDLPExecutableURL = ytDLPExecutableURL
        self.remoteDownloader = remoteDownloader
        self.processExecutor = processExecutor
    }

    func acquire(
        source: SourceDescriptor,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL {
        switch source.kind {
        case .youtube:
            return try await downloadYouTube(
                source.url, workspace: workspace, cancellation: cancellation, onProgress: onProgress
            )
        case .remote:
            return try await downloadRemote(
                source.remoteSource, workspace: workspace, cancellation: cancellation, onProgress: onProgress
            )
        }
    }

    func makeYouTubeInvocation(urlString: String, workspace: URL) throws -> YTDLPInvocation {
        let url = try URLPolicy.canonicalYouTubeURL(urlString)
        guard ytDLPExecutableURL.isFileURL,
              ytDLPExecutableURL.lastPathComponent == "yt-dlp_macos",
              workspace.isFileURL else {
            throw AppError.invalidRequest
        }
        let output = workspace.appendingPathComponent("audio.%(ext)s", isDirectory: false)
        guard isContained(output, in: workspace) else { throw AppError.invalidRequest }
        return YTDLPInvocation(
            executableURL: ytDLPExecutableURL,
            arguments: [
                "--no-config",
                "--no-playlist",
                "--newline",
                "--progress-template", "download:SparkSub:%(progress._percent_str)s",
                "-f", "bestaudio[ext=m4a]/best[ext=mp4]",
                "--output", output.path,
                url.absoluteString,
            ],
            workspaceURL: workspace
        )
    }

    func downloadYouTube(
        _ urlString: String,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL {
        try cancellation.checkCancellation()
        guard FileManager.default.isExecutableFile(atPath: ytDLPExecutableURL.path) else {
            throw AppError.ytDLPNotInstalled
        }
        guard YTDLPConfiguration.isVerifiedInstallation(at: ytDLPExecutableURL) else {
            throw AppError.ytDLPChecksumFailed
        }
        let invocation = try makeYouTubeInvocation(urlString: urlString, workspace: workspace)
        let output = try await processExecutor.execute(
            invocation: invocation, cancellation: cancellation, onProgress: onProgress
        )
        try cancellation.checkCancellation()
        guard isContained(output, in: workspace), FileManager.default.fileExists(atPath: output.path) else {
            throw AppError.mediaDownloadFailed
        }
        return output
    }

    func downloadRemote(
        _ source: RemoteSource,
        workspace: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL {
        let validated = try URLPolicy.validatedRemoteSource(source)
        let destination = workspace.appendingPathComponent("remote-media.m4a")
        guard isContained(destination, in: workspace) else { throw AppError.invalidRequest }
        var lastError: Error = AppError.mediaDownloadFailed
        for (index, url) in validated.urls.enumerated() {
            try cancellation.checkCancellation()
            do {
                try await remoteDownloader.download(
                    url: url, headers: validated.headers, destination: destination, cancellation: cancellation
                )
                onProgress(Double(index + 1) / Double(validated.urls.count))
                let attributes = try? FileManager.default.attributesOfItem(atPath: destination.path)
                let fileSize = (attributes?[.size] as? NSNumber)?.intValue ?? 0
                guard FileManager.default.fileExists(atPath: destination.path), fileSize > 0 else {
                    throw AppError.mediaDownloadFailed
                }
                return destination
            } catch {
                if cancellation.isCancelled { throw AppError.cancelled }
                lastError = error
            }
        }
        let normalized = AppError.normalize(lastError)
        if normalized.code == AppError.cancelled.code { throw AppError.cancelled }
        if normalized.code == AppError.mediaAuthRequired.code { throw AppError.mediaAuthRequired }
        throw AppError.mediaDownloadFailed
    }

    private func isContained(_ child: URL, in parent: URL) -> Bool {
        let parentPath = parent.resolvingSymlinksInPath().standardizedFileURL.path
        let childParent = child.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL
        let childPath = childParent.appendingPathComponent(child.lastPathComponent).path
        return childPath.hasPrefix(parentPath + "/")
    }
}

struct URLSessionRemoteDownloader: RemoteDownloading {
    func download(url: URL, headers: [String: String], destination: URL, cancellation: CancellationToken) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 120
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let delegate = RestrictedRedirectDelegate(headers: headers)
            let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
            let task = session.downloadTask(with: request) { temporaryURL, response, error in
                defer { session.finishTasksAndInvalidate() }
                if cancellation.isCancelled {
                    continuation.resume(throwing: AppError.cancelled)
                    return
                }
                if let httpResponse = response as? HTTPURLResponse,
                   httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
                    continuation.resume(throwing: AppError.mediaAuthRequired)
                    return
                }
                guard error == nil,
                      let httpResponse = response as? HTTPURLResponse,
                      (200..<300).contains(httpResponse.statusCode),
                      let finalURL = httpResponse.url,
                      (try? URLPolicy.validatedBilibiliURL(finalURL.absoluteString)) != nil,
                      let temporaryURL else {
                    continuation.resume(throwing: AppError.mediaDownloadFailed)
                    return
                }
                do {
                    if FileManager.default.fileExists(atPath: destination.path) {
                        try FileManager.default.removeItem(at: destination)
                    }
                    try FileManager.default.moveItem(at: temporaryURL, to: destination)
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: AppError.mediaDownloadFailed)
                }
            }
            cancellation.onCancel { task.cancel() }
            task.resume()
        }
    }
}

private final class RestrictedRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let headers: [String: String]

    init(headers: [String: String]) {
        self.headers = headers
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let url = request.url,
              (try? URLPolicy.validatedBilibiliURL(url.absoluteString)) != nil else {
            completionHandler(nil)
            return
        }
        var restricted = URLRequest(url: url)
        restricted.httpMethod = "GET"
        restricted.timeoutInterval = 120
        for (name, value) in headers { restricted.setValue(value, forHTTPHeaderField: name) }
        completionHandler(restricted)
    }
}

final class YTDLPProcessExecutor: YTDLPExecuting, @unchecked Sendable {
    static func classifyFailure(exitCode: Int32, output: String) -> AppError {
        _ = exitCode
        let normalized = output.lowercased()
        let authMarkers = ["sign in", "login", "private video", "age-restricted", "confirm your age", "cookies"]
        if authMarkers.contains(where: normalized.contains) { return .mediaAuthRequired }
        return .mediaDownloadFailed
    }

    static func progressFractions(in output: String) -> [Double] {
        guard let expression = try? NSRegularExpression(
            pattern: #"SparkSub:\s*([0-9]+(?:\.[0-9]+)?)%"#
        ) else { return [] }
        let range = NSRange(output.startIndex..<output.endIndex, in: output)
        return expression.matches(in: output, range: range).compactMap { match in
            guard let capture = Range(match.range(at: 1), in: output),
                  let percent = Double(String(output[capture])) else { return nil }
            return min(1, max(0, percent / 100))
        }
    }

    static func validatedOutput(in workspace: URL) throws -> URL {
        let files = try FileManager.default.contentsOfDirectory(
            at: workspace,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        )
        let workspacePath = workspace.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        let media = try files.first { candidate in
            let values = try candidate.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            let fileExtension = candidate.pathExtension.lowercased()
            return values.isRegularFile == true
                && values.isSymbolicLink != true
                && (values.fileSize ?? 0) > 0
                && candidate.lastPathComponent.hasPrefix("audio.")
                && !candidate.lastPathComponent.hasSuffix(".part")
                && ["m4a", "mp4"].contains(fileExtension)
                && candidate.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(workspacePath)
        }
        guard let media else { throw AppError.mediaDownloadFailed }
        return media
    }

    func execute(
        invocation: YTDLPInvocation,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL {
        try cancellation.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let pipe = Pipe()
            let outputLock = NSLock()
            var outputData = Data()
            process.executableURL = invocation.executableURL
            process.arguments = invocation.arguments
            process.standardOutput = pipe
            process.standardError = pipe
            pipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    handle.readabilityHandler = nil
                    return
                }
                outputLock.lock()
                outputData.append(data)
                let snapshot = String(data: outputData, encoding: .utf8) ?? ""
                outputLock.unlock()
                if let latest = Self.progressFractions(in: snapshot).last { onProgress(latest) }
            }
            process.terminationHandler = { terminated in
                pipe.fileHandleForReading.readabilityHandler = nil
                let trailingData = pipe.fileHandleForReading.readDataToEndOfFile()
                outputLock.lock()
                outputData.append(trailingData)
                let output = String(data: outputData, encoding: .utf8) ?? ""
                outputLock.unlock()
                if cancellation.isCancelled {
                    continuation.resume(throwing: AppError.cancelled)
                    return
                }
                guard terminated.terminationStatus == 0 else {
                    continuation.resume(throwing: Self.classifyFailure(
                        exitCode: terminated.terminationStatus, output: output
                    ))
                    return
                }
                do {
                    continuation.resume(returning: try Self.validatedOutput(in: invocation.workspaceURL))
                } catch {
                    continuation.resume(throwing: AppError.mediaDownloadFailed)
                }
            }
            cancellation.onCancel {
                if process.isRunning { process.terminate() }
            }
            do {
                try process.run()
                if cancellation.isCancelled, process.isRunning { process.terminate() }
            } catch {
                pipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(throwing: AppError.ytDLPNotInstalled)
            }
        }
    }
}

struct JobWorkspaceManager: Sendable {
    let rootURL: URL

    func withWorkspace<T>(_ operation: (URL) async throws -> T) async throws -> T {
        let workspace = rootURL.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: false)
        do {
            let value = try await operation(workspace)
            try? FileManager.default.removeItem(at: workspace)
            return value
        } catch {
            try? FileManager.default.removeItem(at: workspace)
            throw error
        }
    }
}
