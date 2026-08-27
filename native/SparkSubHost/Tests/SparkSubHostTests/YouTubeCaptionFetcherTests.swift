import Foundation
import XCTest
@testable import SparkSubHost

final class YouTubeCaptionFetcherTests: XCTestCase {
    func testCatalogRanksManualThenOriginalAutomaticThenTranslated() throws {
        let data = Data(#"""
        {
          "subtitles": {
            "en": [{"ext":"json3","name":"English","url":"https://www.youtube.com/api/timedtext?lang=en"}]
          },
          "automatic_captions": {
            "yue": [{"ext":"json3","name":"粵語（自動產生）","url":"https://www.youtube.com/api/timedtext?kind=asr&lang=yue"}],
            "zh-HK": [{"ext":"json3","name":"中文（香港）","url":"https://www.youtube.com/api/timedtext?kind=asr&lang=en&tlang=zh-HK"}]
          }
        }
        """#.utf8)

        let ranked = try YouTubeCaptionCatalog.decode(data).rankedCandidates(sourceLanguage: "yue")
        XCTAssertEqual(ranked.map(\.language), ["en", "yue", "zh-HK"])
        XCTAssertEqual(ranked.map(\.kind), [.manual, .automatic, .translated])
    }

    func testCatalogUsesCantoneseAliasesWithinTheSameCaptionClass() throws {
        let data = Data(#"""
        {
          "subtitles": {
            "en": [{"ext":"json3","name":"English","url":"https://www.youtube.com/api/timedtext?lang=en"}],
            "zh-HK": [{"ext":"json3","name":"粵語","url":"https://www.youtube.com/api/timedtext?lang=zh-HK"}]
          },
          "automatic_captions": {}
        }
        """#.utf8)

        let ranked = try YouTubeCaptionCatalog.decode(data).rankedCandidates(sourceLanguage: "yue")
        XCTAssertEqual(ranked.first?.language, "zh-HK")
        XCTAssertEqual(ranked.first?.kind, .manual)
    }

    func testCatalogIgnoresLiveChatAndFormatsTheHostCannotParse() throws {
        let data = Data(#"""
        {
          "subtitles": {
            "live_chat": [{"ext":"json","name":"Live chat","url":"https://www.youtube.com/live_chat_replay"}],
            "fr": [{"ext":"srv3","name":"French","url":"https://www.youtube.com/api/timedtext?lang=fr"}]
          },
          "automatic_captions": {
            "yue": [{"ext":"json3","name":"粵語（自動產生）","url":"https://www.youtube.com/api/timedtext?kind=asr&lang=yue"}]
          }
        }
        """#.utf8)

        let ranked = try YouTubeCaptionCatalog.decode(data).rankedCandidates(sourceLanguage: "yue")
        XCTAssertEqual(ranked, [
            YouTubeCaptionCandidate(language: "yue", label: "粵語（自動產生）", kind: .automatic),
        ])
    }

    func testInvocationsAreArgumentArraysPublicOnlyAndWorkspaceContained() throws {
        let executable = URL(fileURLWithPath: "/Applications/SparkSub/yt-dlp_macos")
        let workspace = URL(fileURLWithPath: "/tmp/SparkSub-caption-workspace", isDirectory: true)
        let fetcher = YouTubeCaptionFetcher(
            ytDLPExecutableURL: executable,
            commandExecutor: RejectingCaptionCommandExecutor()
        )
        let metadata = try fetcher.makeMetadataInvocation(
            urlString: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            workspace: workspace
        )
        XCTAssertTrue(metadata.arguments.contains("--dump-single-json"))
        XCTAssertTrue(metadata.arguments.contains("--skip-download"))
        XCTAssertTrue(metadata.arguments.contains("--ignore-no-formats-error"))
        XCTAssertFalse(metadata.arguments.joined(separator: " ").lowercased().contains("cookie"))

        let candidate = YouTubeCaptionCandidate(
            language: "zh-HK",
            label: "粵語",
            kind: .manual
        )
        let download = try fetcher.makeDownloadInvocation(
            urlString: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            candidate: candidate,
            workspace: workspace
        )
        XCTAssertTrue(download.arguments.contains("--write-subs"))
        XCTAssertFalse(download.arguments.contains("--write-auto-subs"))
        XCTAssertTrue(download.arguments.contains("--ignore-no-formats-error"))
        let languageIndex = try XCTUnwrap(download.arguments.firstIndex(of: "--sub-langs"))
        XCTAssertEqual(download.arguments[languageIndex + 1], "^zh\\-HK$")
        let outputIndex = try XCTUnwrap(download.arguments.firstIndex(of: "--output"))
        XCTAssertTrue(download.arguments[outputIndex + 1].hasPrefix(workspace.path + "/"))
        XCTAssertFalse(download.arguments.joined(separator: " ").lowercased().contains("cookie"))
    }

    func testJSON3AndWebVTTParsersReturnCompleteCues() throws {
        let json = Data(#"""
        {"events":[
          {"tStartMs":0,"dDurationMs":1200,"segs":[{"utf8":"第一句"}]},
          {"tStartMs":1500,"dDurationMs":1000,"segs":[{"utf8":"第二句"}]}
        ]}
        """#.utf8)
        XCTAssertEqual(try YouTubeCaptionTextParser.parse(json, fileExtension: "json3"), [
            Cue(from: 0, to: 1.2, content: "第一句"),
            Cue(from: 1.5, to: 2.5, content: "第二句"),
        ])

        let vtt = Data("WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nHello &amp; welcome\n\n00:01.500 --> 00:02.500 align:start\nSecond line\n".utf8)
        XCTAssertEqual(try YouTubeCaptionTextParser.parse(vtt, fileExtension: "vtt"), [
            Cue(from: 0, to: 1.25, content: "Hello & welcome"),
            Cue(from: 1.5, to: 2.5, content: "Second line"),
        ])
    }

    func testFetcherInspectsCatalogThenDownloadsOnlySelectedCaption() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let bin = root.appendingPathComponent("bin", isDirectory: true)
        let workspace = root.appendingPathComponent("workspace", isDirectory: true)
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = bin.appendingPathComponent("yt-dlp_macos")
        try Data("test executable".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        try Data("2026.08.19\n".utf8).write(to: bin.appendingPathComponent("yt-dlp_macos.version"))
        let executor = SuccessfulCaptionCommandExecutor()
        let fetcher = YouTubeCaptionFetcher(ytDLPExecutableURL: executable, commandExecutor: executor)
        let progress = ProgressRecorder()

        let result = try await fetcher.fetch(
            source: SourceDescriptor(
                kind: .youtube,
                url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                backupUrls: nil,
                headers: nil
            ),
            sourceLanguage: "yue",
            workspace: workspace,
            cancellation: CancellationToken(),
            onProgress: { progress.append($0) }
        )

        XCTAssertEqual(result.metadata, YouTubeCaptionMetadata(language: "yue", langDoc: "粵語（自動產生）", kind: .automatic))
        XCTAssertEqual(result.cues, [Cue(from: 0, to: 1.5, content: "完整粵語字幕")])
        let invocations = await executor.arguments
        XCTAssertEqual(invocations.count, 2)
        XCTAssertTrue(invocations[0].contains("--dump-single-json"))
        XCTAssertTrue(invocations[1].contains("--write-auto-subs"))
        XCTAssertFalse(invocations[1].contains("--write-subs"))
        XCTAssertEqual(progress.values.last, 1)
    }

    func testFetcherContinuesFromBrokenManualTrackToAutomaticCantoneseAndRemovesStaleOutput() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let bin = root.appendingPathComponent("bin", isDirectory: true)
        let workspace = root.appendingPathComponent("workspace", isDirectory: true)
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = bin.appendingPathComponent("yt-dlp_macos")
        try Data("test executable".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        try Data("2026.08.19\n".utf8).write(to: bin.appendingPathComponent("yt-dlp_macos.version"))
        let executor = BrokenManualThenAutomaticCaptionExecutor()
        let fetcher = YouTubeCaptionFetcher(ytDLPExecutableURL: executable, commandExecutor: executor)

        let result = try await fetcher.fetch(
            source: SourceDescriptor(
                kind: .youtube,
                url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                backupUrls: nil,
                headers: nil
            ),
            sourceLanguage: "yue",
            workspace: workspace,
            cancellation: CancellationToken(),
            onProgress: { _ in }
        )

        XCTAssertEqual(result.metadata.kind, .automatic)
        XCTAssertEqual(result.metadata.language, "yue")
        XCTAssertEqual(result.cues, [Cue(from: 1, to: 2.5, content: "後續粵語自動字幕")])
        let invocations = await executor.arguments
        XCTAssertEqual(invocations.count, 3)
        XCTAssertTrue(invocations[1].contains("--write-subs"))
        XCTAssertTrue(invocations[2].contains("--write-auto-subs"))
        let staleOutputWasRemoved = await executor.staleOutputWasRemoved
        XCTAssertTrue(staleOutputWasRemoved, "a malformed earlier caption must not be selected during the next candidate attempt")
    }
}

private struct RejectingCaptionCommandExecutor: YTDLPCommandExecuting {
    func execute(invocation: YTDLPCommandInvocation, cancellation: CancellationToken) async throws -> YTDLPCommandOutput {
        throw AppError.mediaDownloadFailed
    }
}

private actor SuccessfulCaptionCommandExecutor: YTDLPCommandExecuting {
    private(set) var arguments: [[String]] = []

    func execute(invocation: YTDLPCommandInvocation, cancellation: CancellationToken) async throws -> YTDLPCommandOutput {
        arguments.append(invocation.arguments)
        if invocation.arguments.contains("--dump-single-json") {
            return YTDLPCommandOutput(stdout: Data(#"""
            {
              "subtitles": {},
              "automatic_captions": {
                "yue": [{"ext":"json3","name":"粵語（自動產生）","url":"https://www.youtube.com/api/timedtext?kind=asr&lang=yue"}]
              }
            }
            """#.utf8))
        }
        try Data(#"{"events":[{"tStartMs":0,"dDurationMs":1500,"segs":[{"utf8":"完整粵語字幕"}]}]}"#.utf8)
            .write(to: invocation.workspaceURL.appendingPathComponent("caption.yue.json3"))
        return YTDLPCommandOutput()
    }
}

private actor BrokenManualThenAutomaticCaptionExecutor: YTDLPCommandExecuting {
    private(set) var arguments: [[String]] = []
    private(set) var staleOutputWasRemoved = false
    private var downloadAttempt = 0

    func execute(invocation: YTDLPCommandInvocation, cancellation: CancellationToken) async throws -> YTDLPCommandOutput {
        arguments.append(invocation.arguments)
        if invocation.arguments.contains("--dump-single-json") {
            return YTDLPCommandOutput(stdout: Data(#"""
            {
              "subtitles": {
                "en": [{"ext":"json3","name":"Manual English","url":"https://www.youtube.com/api/timedtext?lang=en"}]
              },
              "automatic_captions": {
                "yue": [{"ext":"json3","name":"粵語（自動產生）","url":"https://www.youtube.com/api/timedtext?kind=asr&lang=yue"}]
              }
            }
            """#.utf8))
        }

        downloadAttempt += 1
        if downloadAttempt == 1 {
            try Data(#"{"events":[]}"#.utf8)
                .write(to: invocation.workspaceURL.appendingPathComponent("caption.en.json3"))
            return YTDLPCommandOutput()
        }

        let names = try FileManager.default.contentsOfDirectory(atPath: invocation.workspaceURL.path)
        staleOutputWasRemoved = !names.contains(where: { $0.hasPrefix("caption.") })
        try Data(#"""
        {"events":[{"tStartMs":1000,"dDurationMs":1500,"segs":[{"utf8":"後續粵語自動字幕"}]}]}
        """#.utf8)
            .write(to: invocation.workspaceURL.appendingPathComponent("caption.yue.json3"))
        return YTDLPCommandOutput()
    }
}

private final class ProgressRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [Double] = []

    var values: [Double] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func append(_ value: Double) {
        lock.lock()
        storage.append(value)
        lock.unlock()
    }
}
