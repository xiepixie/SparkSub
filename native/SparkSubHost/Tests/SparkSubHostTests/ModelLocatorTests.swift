import Foundation
import XCTest
@testable import SparkSubHost

final class ModelLocatorTests: XCTestCase {
    func testParakeetStagesExactCompatibilityFolderWithoutMutatingSource() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        let source = fixture.userSupport.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        for name in ["Preprocessor.mlmodelc", "Encoder.mlmodelc", "Decoder.mlmodelc", "JointDecisionv3.mlmodelc"] {
            try fixture.createCompiledModel(at: source.appendingPathComponent(name))
        }
        try fixture.writeVocabulary(["token", "▁word"], to: source.appendingPathComponent("parakeet_v3_vocab.json"))
        let before = try Set(FileManager.default.contentsOfDirectory(atPath: source.path))
        let locator = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            decoderInputInspector: { _ in [] }
        )

        let layout = try locator.locateParakeet()
        XCTAssertTrue(locator.capabilities().parakeet.available)
        XCTAssertEqual(layout.compatibilityURL.lastPathComponent, "parakeet-tdt-0.6b-v3-coreml")
        XCTAssertEqual(try Set(FileManager.default.contentsOfDirectory(atPath: source.path)), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: source.appendingPathComponent("parakeet_vocab.json").path))
        for name in ModelLocator.parakeetRequiredNames {
            let staged = layout.compatibilityURL.appendingPathComponent(name)
            XCTAssertTrue(FileManager.default.fileExists(atPath: staged.path))
            XCTAssertNotNil(try FileManager.default.destinationOfSymbolicLink(atPath: staged.path))
        }
        let vocabDestination = try FileManager.default.destinationOfSymbolicLink(
            atPath: layout.compatibilityURL.appendingPathComponent("parakeet_vocab.json").path
        )
        XCTAssertTrue(vocabDestination.hasSuffix("parakeet_v3_vocab.json"))
    }

    func testParakeetRejectsEmptyCompiledBundlesAndBadVocabularyBeforeStaging() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        let source = fixture.userSupport.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        for name in ["Preprocessor.mlmodelc", "Encoder.mlmodelc", "Decoder.mlmodelc", "JointDecisionv3.mlmodelc"] {
            try FileManager.default.createDirectory(at: source.appendingPathComponent(name), withIntermediateDirectories: true)
        }
        try fixture.writeVocabulary(["token"], to: source.appendingPathComponent("parakeet_vocab.json"))
        let locator = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            decoderInputInspector: { _ in [] }
        )

        XCTAssertFalse(locator.capabilities().parakeet.available)
        XCTAssertThrowsError(try locator.locateParakeet()) { error in
            XCTAssertEqual((error as? AppError)?.code, "MODEL_LAYOUT_INCOMPATIBLE")
        }

        for name in ["Preprocessor.mlmodelc", "Encoder.mlmodelc", "Decoder.mlmodelc", "JointDecisionv3.mlmodelc"] {
            try Data("compiled".utf8).write(to: source.appendingPathComponent(name).appendingPathComponent("coremldata.bin"))
        }
        try Data("not-json".utf8).write(to: source.appendingPathComponent("parakeet_vocab.json"))
        XCTAssertFalse(locator.capabilities().parakeet.available)
        XCTAssertThrowsError(try locator.locateParakeet()) { error in
            XCTAssertEqual((error as? AppError)?.code, "MODEL_LAYOUT_INCOMPATIBLE")
        }
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: fixture.sparkSupport.appendingPathComponent("Models/parakeet-tdt-0.6b-v3-coreml").path
        ))
    }

    func testParakeetRefusesIncompleteLocalAssetsBeforeStaging() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        let source = fixture.userSupport.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Encoder.mlmodelc"), withIntermediateDirectories: true)
        let locator = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            decoderInputInspector: { _ in [] }
        )

        XCTAssertThrowsError(try locator.locateParakeet()) { error in
            XCTAssertEqual((error as? AppError)?.code, "MODEL_NOT_FOUND")
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.sparkSupport.appendingPathComponent("Models/parakeet-tdt-0.6b-v3-coreml").path))
    }

    func testCohereRequiresKCacheZeroAndVocabulary() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        let candidate = fixture.userSupport.appendingPathComponent("FluidAudio/Cohere/2026-08-19T120000", isDirectory: true)
        try FileManager.default.createDirectory(at: candidate, withIntermediateDirectories: true)
        try fixture.createCompiledModel(at: candidate.appendingPathComponent("cohere_encoder.mlmodelc"))
        let decoder = candidate.appendingPathComponent("cohere_decoder_cache_external_v2_20260819.mlmodelc")
        try fixture.createCompiledModel(at: decoder)
        try fixture.writeVocabulary(["token": 0], to: candidate.appendingPathComponent("vocab.json"))

        let incompatible = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            cohereSearchRoots: [candidate],
            decoderInputInspector: { _ in ["input_ids", "k_cache_1"] }
        )
        XCTAssertThrowsError(try incompatible.locateCohere()) { error in
            XCTAssertEqual((error as? AppError)?.code, "MODEL_LAYOUT_INCOMPATIBLE")
        }

        let compatible = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            cohereSearchRoots: [candidate],
            decoderInputInspector: { _ in ["input_ids", "k_cache_0", "v_cache_0"] }
        )
        let layout = try compatible.locateCohere()
        XCTAssertTrue(compatible.capabilities().cohere.available)
        XCTAssertEqual(layout.decoderVariant, .v2)
        XCTAssertTrue(layout.encoderDirectoryURL.hasDirectoryPath)
        XCTAssertTrue(layout.decoderDirectoryURL.hasDirectoryPath)
        XCTAssertTrue(layout.vocabDirectoryURL.hasDirectoryPath)
        XCTAssertEqual(layout.encoderDirectoryURL, layout.compatibilityURL)
        XCTAssertEqual(layout.decoderDirectoryURL, layout.compatibilityURL)
        XCTAssertEqual(layout.vocabDirectoryURL, layout.compatibilityURL)
        let stagedDecoder = layout.compatibilityURL.appendingPathComponent("cohere_decoder_cache_external_v2.mlmodelc")
        XCTAssertTrue((try FileManager.default.destinationOfSymbolicLink(atPath: stagedDecoder.path)).hasSuffix(decoder.lastPathComponent))
        XCTAssertTrue(FileManager.default.fileExists(atPath: decoder.path), "source decoder must remain untouched")
    }

    func testCohereFindsKnownCacheRootsAndTimestampedGPUANENames() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        let candidate = fixture.userCaches
            .appendingPathComponent("FluidAudio/CompiledCohereModels/2026-08-19", isDirectory: true)
        try FileManager.default.createDirectory(at: candidate, withIntermediateDirectories: true)
        try fixture.createCompiledModel(at: candidate.appendingPathComponent("cohere_encoder_gpu_20260819.mlmodelc"))
        let compatibleDecoder = candidate.appendingPathComponent("cohere_decoder_cached_ane_20260819.mlmodelc")
        try fixture.createCompiledModel(at: compatibleDecoder)
        try fixture.createCompiledModel(at: candidate.appendingPathComponent("cohere_decoder_fullseq_masked_20260819.mlmodelc"))
        try fixture.writeVocabulary(["token": 0], to: candidate.appendingPathComponent("vocab.json"))
        let locator = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            userCachesURL: fixture.userCaches,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            decoderInputInspector: { url in
                url == compatibleDecoder ? ["input_ids", "k_cache_0"] : ["input_ids"]
            }
        )

        let layout = try locator.locateCohere()
        XCTAssertEqual(layout.decoderVariant, .v2)
        XCTAssertEqual(layout.sourceURL, candidate)
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: layout.compatibilityURL.appendingPathComponent("cohere_encoder.mlmodelc").path
        ))
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: layout.compatibilityURL.appendingPathComponent("cohere_decoder_cache_external_v2.mlmodelc").path
        ))
    }

    func testCohereRejectsEmptyCompiledBundlesAndEmptyVocabulary() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        let candidate = fixture.userSupport.appendingPathComponent("cohere", isDirectory: true)
        let encoder = candidate.appendingPathComponent("cohere_encoder.mlmodelc")
        let decoder = candidate.appendingPathComponent("cohere_decoder_cache_external_v2.mlmodelc")
        try FileManager.default.createDirectory(at: encoder, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: decoder, withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: candidate.appendingPathComponent("vocab.json"))
        let locator = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            cohereSearchRoots: [candidate],
            decoderInputInspector: { _ in ["input_ids", "k_cache_0"] }
        )

        XCTAssertFalse(locator.capabilities().cohere.available)
        XCTAssertThrowsError(try locator.locateCohere()) { error in
            XCTAssertEqual((error as? AppError)?.code, "MODEL_LAYOUT_INCOMPATIBLE")
        }

        try Data("compiled".utf8).write(to: encoder.appendingPathComponent("coremldata.bin"))
        try Data("compiled".utf8).write(to: decoder.appendingPathComponent("coremldata.bin"))
        XCTAssertFalse(locator.capabilities().cohere.available, "an empty JSON vocabulary must stay unavailable")
    }

    func testCohereMissingVocabularyIsNeverReportedReady() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        let candidate = fixture.userSupport.appendingPathComponent("cohere", isDirectory: true)
        try fixture.createCompiledModel(at: candidate.appendingPathComponent("cohere_encoder.mlmodelc"))
        try fixture.createCompiledModel(at: candidate.appendingPathComponent("cohere_decoder_cache_external_v2.mlmodelc"))
        let locator = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            cohereSearchRoots: [candidate],
            decoderInputInspector: { _ in ["k_cache_0"] }
        )

        XCTAssertThrowsError(try locator.locateCohere()) { error in
            XCTAssertEqual((error as? AppError)?.code, "MODEL_LAYOUT_INCOMPATIBLE")
        }
        XCTAssertFalse(locator.capabilities().cohere.available)
    }

    func testEngineInitializationForcesFluidAudioOfflineModeBeforeLoading() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        FluidAudioRuntime.offlineModeEnabled = false
        let locator = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            decoderInputInspector: { _ in [] }
        )

        _ = TranscriptionEngine(modelLocator: locator)

        XCTAssertTrue(FluidAudioRuntime.offlineModeEnabled)
    }

    func testUnexpectedFluidLoaderFailuresMapToModelLayoutError() {
        struct LoaderFailure: Error {}

        XCTAssertEqual(FluidModelLoadingError.normalize(LoaderFailure()), .modelLayoutIncompatible)
        XCTAssertEqual(FluidModelLoadingError.normalize(AppError.modelNotFound), .modelNotFound)
    }

    func testCapabilitiesRequirePinnedYTDLPVersionEvidence() throws {
        let fixture = try ModelFixture()
        defer { fixture.remove() }
        let binaryDirectory = fixture.sparkSupport.appendingPathComponent("bin", isDirectory: true)
        try FileManager.default.createDirectory(at: binaryDirectory, withIntermediateDirectories: true)
        let executable = binaryDirectory.appendingPathComponent("yt-dlp_macos")
        try Data("binary".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let locator = ModelLocator(
            userApplicationSupportURL: fixture.userSupport,
            sparkSubApplicationSupportURL: fixture.sparkSupport,
            decoderInputInspector: { _ in [] },
            ytDLPExecutableURL: executable
        )

        XCTAssertFalse(locator.capabilities().ytDLP.available, "an executable alone must not claim the pinned version")
        try Data("2026.08.19\n".utf8).write(to: binaryDirectory.appendingPathComponent("yt-dlp_macos.version"))
        XCTAssertTrue(locator.capabilities().ytDLP.available)
    }
}

private final class ModelFixture {
    let root: URL
    let userSupport: URL
    let userCaches: URL
    let sparkSupport: URL

    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        userSupport = root.appendingPathComponent("UserApplicationSupport", isDirectory: true)
        userCaches = root.appendingPathComponent("UserCaches", isDirectory: true)
        sparkSupport = root.appendingPathComponent("SparkSubApplicationSupport", isDirectory: true)
        try FileManager.default.createDirectory(at: userSupport, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: userCaches, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: sparkSupport, withIntermediateDirectories: true)
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    func createCompiledModel(at url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try Data("compiled".utf8).write(to: url.appendingPathComponent("coremldata.bin"))
    }

    func writeVocabulary(_ object: Any, to url: URL) throws {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]).write(to: url)
    }
}
