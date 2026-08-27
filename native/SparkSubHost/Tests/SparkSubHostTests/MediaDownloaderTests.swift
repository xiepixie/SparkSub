import Foundation
import XCTest
@testable import SparkSubHost

final class MediaDownloaderTests: XCTestCase {
    func testYouTubeValidatorAcceptsOnlyCanonicalWatchURLs() throws {
        XCTAssertEqual(
            try URLPolicy.canonicalYouTubeURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ").absoluteString,
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        )

        for rejected in [
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ#fragment",
            "https://www.youtube.com:443/watch?v=dQw4w9WgXcQ",
            "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=too-short",
        ] {
            XCTAssertThrowsError(try URLPolicy.canonicalYouTubeURL(rejected), "must reject \(rejected)")
        }
    }

    func testRemoteValidatorRestrictsHTTPSHostsHeadersAndBackupOrder() throws {
        let source = RemoteSource(
            url: "https://upos-sz-mirrorcos.bilivideo.com/audio.m4a?sign=one",
            backupUrls: [
                "https://cn-hk-eq-bcache-01.bilivideo.com/audio.m4a?sign=two",
                "https://xycdn-bili-sg2.hdslb.com/audio.m4a?sign=three",
            ],
            headers: ["Referer": "https://www.bilibili.com/", "User-Agent": "SparkSub-Test"]
        )
        let validated = try URLPolicy.validatedRemoteSource(source)
        XCTAssertEqual(validated.urls.map(\.absoluteString), [source.url] + source.backupUrls)
        XCTAssertEqual(validated.headers, source.headers)

        let badSources = [
            RemoteSource(url: "http://upos-sz-mirrorcos.bilivideo.com/a", backupUrls: [], headers: source.headers),
            RemoteSource(url: "https://evilbilivideo.com/a", backupUrls: [], headers: source.headers),
            RemoteSource(url: source.url, backupUrls: ["https://evil.example/a"], headers: source.headers),
            RemoteSource(url: source.url, backupUrls: [], headers: ["Cookie": "secret"]),
            RemoteSource(url: source.url, backupUrls: [], headers: ["Authorization": "secret"]),
        ]
        for badSource in badSources {
            XCTAssertThrowsError(try URLPolicy.validatedRemoteSource(badSource))
        }
    }

    func testYTDLPInvocationUsesPinnedOwnedBinaryArgumentsAndContainedOutput() throws {
        let support = URL(fileURLWithPath: "/Users/test/Library/Application Support/SparkSub", isDirectory: true)
        let executable = support.appendingPathComponent("bin/yt-dlp_macos")
        let workspace = support.appendingPathComponent("Temporary/7A43996E-24CA-4F7B-895B-ED9E733CF68E", isDirectory: true)
        let downloader = MediaDownloader(
            ytDLPExecutableURL: executable,
            remoteDownloader: RejectingRemoteDownloader(),
            processExecutor: RejectingProcessExecutor()
        )
        let invocation = try downloader.makeYouTubeInvocation(
            urlString: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            workspace: workspace
        )

        XCTAssertEqual(invocation.executableURL, executable)
        XCTAssertTrue(invocation.arguments.contains("--no-config"))
        XCTAssertTrue(invocation.arguments.contains("--no-playlist"))
        XCTAssertTrue(invocation.arguments.enumerated().contains { index, value in
            value == "-f" && invocation.arguments.indices.contains(index + 1)
                && invocation.arguments[index + 1] == "bestaudio[ext=m4a]/best[ext=mp4]"
        })
        let outputIndex = try XCTUnwrap(invocation.arguments.firstIndex(of: "--output"))
        let outputTemplate = invocation.arguments[outputIndex + 1]
        XCTAssertTrue(URL(fileURLWithPath: outputTemplate).standardizedFileURL.path.hasPrefix(workspace.standardizedFileURL.path + "/"))
        XCTAssertFalse(invocation.arguments.joined(separator: " ").contains("cookie"))
        XCTAssertEqual(YTDLPConfiguration.pinnedVersion, "2026.08.19")
    }

    func testRequestCannotInjectArgumentsOrOutputPath() throws {
        let workspace = URL(fileURLWithPath: "/tmp/SparkSub-safe-workspace", isDirectory: true)
        let downloader = MediaDownloader(
            ytDLPExecutableURL: URL(fileURLWithPath: "/Applications/SparkSub/yt-dlp_macos"),
            remoteDownloader: RejectingRemoteDownloader(),
            processExecutor: RejectingProcessExecutor()
        )
        XCTAssertThrowsError(try downloader.makeYouTubeInvocation(
            urlString: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&output=/Users/test/stolen;touch /tmp/pwned",
            workspace: workspace
        ))
    }

    func testYTDLPFailureClassificationSeparatesAuthenticationAndDownloadErrors() {
        XCTAssertEqual(
            YTDLPProcessExecutor.classifyFailure(exitCode: 1, output: "ERROR: Sign in to confirm your age"),
            .mediaAuthRequired
        )
        XCTAssertEqual(
            YTDLPProcessExecutor.classifyFailure(exitCode: 2, output: "ERROR: HTTP Error 503: Service Unavailable"),
            .mediaDownloadFailed
        )
        XCTAssertEqual(
            YTDLPProcessExecutor.progressFractions(in: "download:SparkSub: 12.5%\ndownload:SparkSub:100.0%"),
            [0.125, 1.0]
        )
    }

    func testYTDLPOutputSelectionRejectsSymlinksAndFilesOutsideWorkspace() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let workspace = root.appendingPathComponent("workspace", isDirectory: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let outside = root.appendingPathComponent("outside.m4a")
        try Data("outside".utf8).write(to: outside)
        try FileManager.default.createSymbolicLink(
            at: workspace.appendingPathComponent("audio.m4a"),
            withDestinationURL: outside
        )
        XCTAssertThrowsError(try YTDLPProcessExecutor.validatedOutput(in: workspace))

        try FileManager.default.removeItem(at: workspace.appendingPathComponent("audio.m4a"))
        let webM = workspace.appendingPathComponent("audio.webm")
        try Data("unsupported".utf8).write(to: webM)
        XCTAssertThrowsError(try YTDLPProcessExecutor.validatedOutput(in: workspace))

        try FileManager.default.removeItem(at: webM)
        let m4a = workspace.appendingPathComponent("audio.m4a")
        try Data("decodable".utf8).write(to: m4a)
        XCTAssertEqual(try YTDLPProcessExecutor.validatedOutput(in: workspace).resolvingSymlinksInPath(), m4a.resolvingSymlinksInPath())

        try FileManager.default.removeItem(at: m4a)
        let mp4 = workspace.appendingPathComponent("audio.mp4")
        try Data("decodable".utf8).write(to: mp4)
        XCTAssertEqual(try YTDLPProcessExecutor.validatedOutput(in: workspace).resolvingSymlinksInPath(), mp4.resolvingSymlinksInPath())
    }

    func testYouTubeDownloadRefusesExecutableWithoutPinnedVerificationSidecar() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("yt-dlp_macos")
        try Data("unverified".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let workspace = root.appendingPathComponent("workspace", isDirectory: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        let downloader = MediaDownloader(
            ytDLPExecutableURL: executable,
            remoteDownloader: RejectingRemoteDownloader(),
            processExecutor: RejectingProcessExecutor()
        )

        do {
            _ = try await downloader.downloadYouTube(
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                workspace: workspace,
                cancellation: CancellationToken(),
                onProgress: { _ in }
            )
            XCTFail("unverified yt-dlp must not execute")
        } catch {
            XCTAssertEqual((error as? AppError)?.code, "YTDLP_CHECKSUM_FAILED")
        }
    }

    func testRemoteDownloadTriesValidatedBackupsInOrder() async throws {
        let transport = RecordingRemoteDownloader(failuresBeforeSuccess: 2)
        let downloader = MediaDownloader(
            ytDLPExecutableURL: URL(fileURLWithPath: "/owned/yt-dlp_macos"),
            remoteDownloader: transport,
            processExecutor: RejectingProcessExecutor()
        )
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = RemoteSource(
            url: "https://a.bilivideo.com/1.m4a",
            backupUrls: ["https://b.bilivideo.com/2.m4a", "https://c.hdslb.com/3.m4a"],
            headers: ["Referer": "https://www.bilibili.com/", "User-Agent": "test"]
        )

        let output = try await downloader.downloadRemote(source, workspace: root, cancellation: CancellationToken()) { _ in }
        XCTAssertTrue(FileManager.default.fileExists(atPath: output.path))
        let requestedURLs = await transport.requestedURLs
        let requestedHeaders = await transport.requestedHeaders
        XCTAssertEqual(requestedURLs.map(\.absoluteString), [source.url] + source.backupUrls)
        XCTAssertTrue(requestedHeaders.allSatisfy { $0 == source.headers })
    }

    func testCancellationTerminatesActiveProcessAndCleansOnlyTaskDirectory() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let sibling = root.appendingPathComponent("keep-me")
        try Data("safe".utf8).write(to: sibling)
        let manager = JobWorkspaceManager(rootURL: root)
        let executor = BlockingProcessExecutor()
        let cancellation = CancellationToken()
        let executableRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: executableRoot, withIntermediateDirectories: true)
        let executable = executableRoot.appendingPathComponent("yt-dlp_macos")
        try Data("fake executable".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        try Data("2026.08.19\n".utf8).write(to: executableRoot.appendingPathComponent("yt-dlp_macos.version"))
        defer { try? FileManager.default.removeItem(at: executableRoot) }
        let downloader = MediaDownloader(
            ytDLPExecutableURL: executable,
            remoteDownloader: RejectingRemoteDownloader(),
            processExecutor: executor
        )

        let task = Task {
            try await manager.withWorkspace { workspace in
                try await downloader.downloadYouTube(
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    workspace: workspace,
                    cancellation: cancellation,
                    onProgress: { _ in }
                )
            }
        }
        await executor.waitUntilStarted()
        let taskDirectories = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.resolvingSymlinksInPath() != sibling.resolvingSymlinksInPath() }
        XCTAssertEqual(taskDirectories.count, 1)
        cancellation.cancel()
        do {
            _ = try await task.value
            XCTFail("cancelled process must throw")
        } catch {
            XCTAssertEqual((error as? AppError)?.code, "CANCELLED")
        }

        let wasTerminated = await executor.wasTerminated
        XCTAssertTrue(wasTerminated)
        XCTAssertFalse(FileManager.default.fileExists(atPath: taskDirectories[0].path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: sibling.path))
    }
}

private struct RejectingRemoteDownloader: RemoteDownloading {
    func download(url: URL, headers: [String: String], destination: URL, cancellation: CancellationToken) async throws {
        throw AppError.mediaDownloadFailed
    }
}

private struct RejectingProcessExecutor: YTDLPExecuting {
    func execute(invocation: YTDLPInvocation, cancellation: CancellationToken, onProgress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        throw AppError.mediaDownloadFailed
    }
}

private actor RecordingRemoteDownloader: RemoteDownloading {
    private var failuresRemaining: Int
    private(set) var requestedURLs: [URL] = []
    private(set) var requestedHeaders: [[String: String]] = []

    init(failuresBeforeSuccess: Int) {
        failuresRemaining = failuresBeforeSuccess
    }

    func download(url: URL, headers: [String: String], destination: URL, cancellation: CancellationToken) async throws {
        requestedURLs.append(url)
        requestedHeaders.append(headers)
        let shouldFail = failuresRemaining > 0
        failuresRemaining -= 1
        if shouldFail { throw AppError.mediaDownloadFailed }
        try Data("audio".utf8).write(to: destination)
    }
}

private actor BlockingProcessExecutor: YTDLPExecuting {
    private var started = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private(set) var wasTerminated = false

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }

    func execute(invocation: YTDLPInvocation, cancellation: CancellationToken, onProgress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        started = true
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        return try await withCheckedThrowingContinuation { continuation in
            cancellation.onCancel { [weak self] in
                Task { await self?.markTerminated() }
                continuation.resume(throwing: AppError.cancelled)
            }
        }
    }

    private func markTerminated() {
        wasTerminated = true
    }
}
