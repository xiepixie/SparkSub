import Foundation
import XCTest
@testable import SparkSubHost

final class CueBuilderTests: XCTestCase {
    func testTokenTimingsBecomeOrderedNonemptyTwoToEightSecondCues() throws {
        let timings = [
            TokenTimingValue(token: " Hello", startTime: 0.0, endTime: 0.8, confidence: 0.9),
            TokenTimingValue(token: " world.", startTime: 0.8, endTime: 2.2, confidence: 0.9),
            TokenTimingValue(token: " This", startTime: 2.2, endTime: 3.5, confidence: 0.9),
            TokenTimingValue(token: " is", startTime: 3.5, endTime: 4.7, confidence: 0.9),
            TokenTimingValue(token: " timed", startTime: 4.7, endTime: 6.2, confidence: 0.9),
            TokenTimingValue(token: " text.", startTime: 6.2, endTime: 8.5, confidence: 0.9),
        ]

        let cues = try CueBuilder.fromTokenTimings(timings, transcript: "ignored fallback", duration: 8.5)
        XCTAssertFalse(cues.isEmpty)
        XCTAssertTrue(cues.allSatisfy { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        XCTAssertTrue(cues.allSatisfy { $0.to > $0.from && $0.to - $0.from >= 2 && $0.to - $0.from <= 8 })
        XCTAssertTrue(zip(cues, cues.dropFirst()).allSatisfy { pair in pair.0.to <= pair.1.from })
        XCTAssertEqual(cues.map(\.content).joined(separator: " "), "Hello world. This is timed text.")
    }

    func testTokenTimingFallbackRequiresValidTextAndDuration() throws {
        XCTAssertThrowsError(try CueBuilder.fromTokenTimings([], transcript: "", duration: 10)) { error in
            XCTAssertEqual((error as? AppError)?.code, "ASR_FAILED")
        }
        XCTAssertThrowsError(try CueBuilder.fromTokenTimings([], transcript: "valid", duration: 0)) { error in
            XCTAssertEqual((error as? AppError)?.code, "ASR_FAILED")
        }
        XCTAssertEqual(
            try CueBuilder.fromTokenTimings([], transcript: " fallback text ", duration: 3),
            [Cue(from: 0, to: 3, content: "fallback text")]
        )
    }

    func testSentencePieceBoundariesBecomeSpaces() throws {
        let cues = try CueBuilder.fromTokenTimings([
            TokenTimingValue(token: "▁Hello", startTime: 0, endTime: 1, confidence: 1),
            TokenTimingValue(token: "▁world.", startTime: 1, endTime: 2.5, confidence: 1),
        ], transcript: nil, duration: 2.5)

        XCTAssertEqual(cues.map(\.content), ["Hello world."])
        XCTAssertFalse(cues[0].content.contains("▁"))
    }

    func testShortTailMergesOrFallsBackSoEveryTimingCueIsAtLeastTwoSeconds() throws {
        let timings = [
            TokenTimingValue(token: " First", startTime: 0, endTime: 2.2, confidence: 1),
            TokenTimingValue(token: " sentence.", startTime: 2.2, endTime: 4.0, confidence: 1),
            TokenTimingValue(token: " Tail.", startTime: 4.0, endTime: 4.7, confidence: 1),
        ]
        let cues = try CueBuilder.fromTokenTimings(timings, transcript: "First sentence. Tail.", duration: 4.7)

        XCTAssertTrue(cues.allSatisfy { $0.to - $0.from >= 2 && $0.to - $0.from <= 8 })
        XCTAssertEqual(cues.map(\.content).joined(separator: " "), "First sentence. Tail.")
    }

    func testShortTailAfterEightSecondCueKeepsItsRealEndInsteadOfCollapsingTimeline() throws {
        let timings = [
            TokenTimingValue(token: " Long", startTime: 0, endTime: 4, confidence: 1),
            TokenTimingValue(token: " section.", startTime: 4, endTime: 8, confidence: 1),
            TokenTimingValue(token: " Tail.", startTime: 8, endTime: 9, confidence: 1),
        ]
        let cues = try CueBuilder.fromTokenTimings(timings, transcript: "Long section. Tail.", duration: 9)

        XCTAssertEqual(cues.count, 2)
        XCTAssertEqual(cues[0], Cue(from: 0, to: 8, content: "Long section."))
        XCTAssertEqual(cues[1], Cue(from: 7, to: 9, content: "Tail."))
        XCTAssertTrue(cues.allSatisfy { $0.to - $0.from >= 2 && $0.to - $0.from <= 8 })
    }

    func testLowEnergyWindowsAreGapFreeNonoverlappingAndAtMostThirtyFiveSeconds() throws {
        let sampleRate = 100
        var samples = [Float](repeating: 0.8, count: 73 * sampleRate)
        for second in [29, 58] {
            let center = second * sampleRate
            for index in max(0, center - 15)..<min(samples.count, center + 15) { samples[index] = 0.001 }
        }

        let windows = try AudioWindowPlanner.makeWindows(samples: samples, sampleRate: sampleRate)
        XCTAssertEqual(windows.first?.startSample, 0)
        XCTAssertEqual(windows.last?.endSample, samples.count)
        XCTAssertTrue(zip(windows, windows.dropFirst()).allSatisfy { pair in pair.0.endSample == pair.1.startSample })
        XCTAssertTrue(windows.allSatisfy { $0.endSample > $0.startSample })
        XCTAssertTrue(windows.allSatisfy { Double($0.sampleCount) / Double(sampleRate) <= 35 })
        XCTAssertEqual(Double(windows[0].endSample), Double(29 * sampleRate), accuracy: 25)
    }

    func testCohereWindowTextUsesRealOffsetRanges() throws {
        let windows = [AudioWindow(startSample: 0, endSample: 300), AudioWindow(startSample: 300, endSample: 620)]
        let cues = try CueBuilder.fromWindowTranscripts(
            ["第一段普通话窗口文字", "第二段普通话窗口文字"],
            windows: windows,
            sampleRate: 10
        )
        XCTAssertTrue(cues.allSatisfy { $0.to - $0.from >= 2 && $0.to - $0.from <= 8 })
        XCTAssertTrue(zip(cues, cues.dropFirst()).allSatisfy { pair in pair.0.to <= pair.1.from })
        XCTAssertTrue(cues.contains { $0.from >= 0 && $0.to <= 30 })
        XCTAssertTrue(cues.contains { $0.from >= 30 && $0.to <= 62 })
        XCTAssertEqual(cues.map(\.content).joined(), "第一段普通话窗口文字第二段普通话窗口文字")
    }

    func testEmptyCohereWindowsAreSkippedWithoutLosingLaterOffsetsAndAllEmptyFails() throws {
        let cues = try CueBuilder.fromWindowTranscripts(
            ["   ", "第二段"],
            windows: [AudioWindow(startSample: 0, endSample: 80), AudioWindow(startSample: 80, endSample: 160)],
            sampleRate: 10
        )
        XCTAssertTrue(cues.allSatisfy { $0.from >= 8 && $0.to <= 16 })
        XCTAssertEqual(cues.map(\.content).joined(), "第二段")

        XCTAssertThrowsError(try CueBuilder.fromWindowTranscripts(
            ["", "   "],
            windows: [AudioWindow(startSample: 0, endSample: 80), AudioWindow(startSample: 80, endSample: 160)],
            sampleRate: 10
        )) { error in
            XCTAssertEqual((error as? AppError)?.code, "ASR_FAILED")
        }
    }

    func testLanguageRoutingRefusesCantoneseAndChoosesMandarinOrParakeet() throws {
        for language in ["yue", "zh-HK", "zh-yue"] {
            XCTAssertThrowsError(try TranscriptionRouter.route(sourceLanguage: language, platformLanguage: nil, sourceKind: .youtube)) { error in
                XCTAssertEqual((error as? AppError)?.code, "ASR_LANGUAGE_UNSUPPORTED")
            }
        }
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "zh", platformLanguage: nil, sourceKind: .youtube), .cohereMandarin)
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "zh-CN", platformLanguage: nil, sourceKind: .remote), .cohereMandarin)
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "zh-TW", platformLanguage: nil, sourceKind: .remote), .cohereMandarin)
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "en", platformLanguage: nil, sourceKind: .youtube), .parakeet(languageCode: "en"))
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "de", platformLanguage: nil, sourceKind: .youtube), .parakeet(languageCode: "de"))
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "auto", platformLanguage: nil, sourceKind: .remote), .cohereMandarin)
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "auto", platformLanguage: nil, sourceKind: .youtube), .parakeet(languageCode: nil))
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "auto", platformLanguage: "zh-Hans", sourceKind: .youtube), .cohereMandarin)
        XCTAssertEqual(try TranscriptionRouter.route(sourceLanguage: "auto", platformLanguage: "fr-FR", sourceKind: .remote), .parakeet(languageCode: "fr"))
        XCTAssertThrowsError(try TranscriptionRouter.route(sourceLanguage: "auto", platformLanguage: "yue-HK", sourceKind: .youtube)) { error in
            XCTAssertEqual((error as? AppError)?.code, "ASR_LANGUAGE_UNSUPPORTED")
        }
        XCTAssertThrowsError(try TranscriptionRouter.route(sourceLanguage: "th", platformLanguage: nil, sourceKind: .youtube)) { error in
            XCTAssertEqual((error as? AppError)?.code, "ASR_LANGUAGE_UNSUPPORTED")
        }
    }
}
