import CoreML
import Foundation
@preconcurrency import FluidAudio

enum FluidAudioRuntime {
    static var offlineModeEnabled: Bool {
        get { ModelHub.offlineMode }
        set { ModelHub.offlineMode = newValue }
    }

    static func prepareForOfflineInference() {
        offlineModeEnabled = true
    }
}

enum FluidModelLoadingError {
    static func normalize(_ error: Error) -> AppError {
        if let appError = error as? AppError { return appError }
        return .modelLayoutIncompatible
    }
}

enum EngineRoute: Equatable, Sendable {
    case parakeet(languageCode: String?)
    case cohereMandarin
}

enum TranscriptionRouter {
    private static let mandarinAliases = Set(["zh", "zh-cn", "zh-hans", "zh-tw", "zh-hant", "cmn", "cmn-hans", "cmn-hant"])
    private static let cantoneseAliases = Set(["yue", "zh-hk", "zh-yue"])
    private static let europeanAliases: [String: String] = [
        "en": "en", "english": "en",
        "es": "es", "fr": "fr", "de": "de", "it": "it", "pt": "pt",
        "ro": "ro", "nl": "nl", "da": "da", "sv": "sv", "fi": "fi",
        "hu": "hu", "et": "et", "lv": "lv", "lt": "lt", "mt": "mt",
        "pl": "pl", "cs": "cs", "sk": "sk", "sl": "sl", "hr": "hr",
        "bs": "bs", "ru": "ru", "uk": "uk", "be": "be", "bg": "bg",
        "sr": "sr", "el": "el",
    ]

    static func route(
        sourceLanguage: String,
        platformLanguage: String?,
        sourceKind: SourceKind,
        cohereAvailable: Bool = true
    ) throws -> EngineRoute {
        let requested = normalized(sourceLanguage)
        if isCantonese(requested) { throw AppError.languageUnsupported }
        if let language = europeanLanguage(requested) { return .parakeet(languageCode: language) }
        if mandarinAliases.contains(requested) {
            guard cohereAvailable else { throw AppError.modelNotFound }
            return .cohereMandarin
        }
        guard requested == "auto" else { throw AppError.languageUnsupported }

        if let hint = platformLanguage.map(normalized) {
            if isCantonese(hint) { throw AppError.languageUnsupported }
            if let language = europeanLanguage(hint) { return .parakeet(languageCode: language) }
            if mandarinAliases.contains(hint) {
                guard cohereAvailable else { throw AppError.modelNotFound }
                return .cohereMandarin
            }
        }
        if sourceKind == .remote {
            guard cohereAvailable else { throw AppError.modelNotFound }
            return .cohereMandarin
        }
        return .parakeet(languageCode: nil)
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: "-")
            .lowercased()
    }

    private static func europeanLanguage(_ value: String) -> String? {
        if let exact = europeanAliases[value] { return exact }
        let base = value.split(separator: "-").first.map(String.init) ?? value
        return europeanAliases[base]
    }

    private static func isCantonese(_ value: String) -> Bool {
        cantoneseAliases.contains(value)
            || value.hasPrefix("yue-")
            || value == "zh-hant-hk"
    }
}

struct TranscriptionOutput: Sendable {
    let engine: String
    let cues: [Cue]
}

protocol Transcribing: Sendable {
    func transcribe(
        mediaURL: URL,
        sourceLanguage: String,
        platformLanguage: String?,
        sourceKind: SourceKind,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> TranscriptionOutput
}

actor TranscriptionEngine: Transcribing {
    private let modelLocator: ModelLocator
    private var parakeetManager: AsrManager?
    private var coherePipeline: CoherePipeline?
    private var cohereModels: CoherePipeline.LoadedModels?

    init(modelLocator: ModelLocator) {
        FluidAudioRuntime.prepareForOfflineInference()
        self.modelLocator = modelLocator
    }

    func transcribe(
        mediaURL: URL,
        sourceLanguage: String,
        platformLanguage: String?,
        sourceKind: SourceKind,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> TranscriptionOutput {
        let cohereReady = modelLocator.capabilities().cohere.available
        let route = try TranscriptionRouter.route(
            sourceLanguage: sourceLanguage,
            platformLanguage: platformLanguage,
            sourceKind: sourceKind,
            cohereAvailable: cohereReady
        )
        try cancellation.checkCancellation()
        switch route {
        case .parakeet(let languageCode):
            return try await transcribeParakeet(
                mediaURL: mediaURL,
                languageCode: languageCode,
                cancellation: cancellation,
                onProgress: onProgress
            )
        case .cohereMandarin:
            return try await transcribeCohere(
                mediaURL: mediaURL,
                cancellation: cancellation,
                onProgress: onProgress
            )
        }
    }

    private func transcribeParakeet(
        mediaURL: URL,
        languageCode: String?,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> TranscriptionOutput {
        let manager: AsrManager
        if let cached = parakeetManager {
            manager = cached
        } else {
            let layout = try modelLocator.locateParakeet()
            try cancellation.checkCancellation()
            let models: AsrModels
            do {
                models = try await AsrModels.load(
                    from: layout.compatibilityURL,
                    configuration: AsrModels.defaultConfiguration(),
                    version: .v3,
                    encoderPrecision: .int8,
                    encoderComputeUnits: .cpuAndGPU
                )
            } catch {
                throw FluidModelLoadingError.normalize(error)
            }
            try cancellation.checkCancellation()
            let loadedManager = AsrManager()
            do {
                try await loadedManager.loadModels(models)
            } catch {
                throw FluidModelLoadingError.normalize(error)
            }
            parakeetManager = loadedManager
            manager = loadedManager
        }

        try cancellation.checkCancellation()
        let progressStream = await manager.transcriptionProgressStream
        let progressTask = Task {
            do {
                for try await progress in progressStream {
                    if Task.isCancelled { break }
                    onProgress(progress)
                }
            } catch {
                // Ignore stream cancellation / completion
            }
        }
        defer { progressTask.cancel() }

        let layerCount = await manager.decoderLayerCount
        var decoderState = TdtDecoderState.make(decoderLayers: layerCount)
        let result = try await manager.transcribe(
            mediaURL,
            decoderState: &decoderState,
            language: parakeetLanguage(languageCode)
        )
        try cancellation.checkCancellation()
        let timings = (result.tokenTimings ?? []).map {
            TokenTimingValue(
                token: $0.token,
                startTime: $0.startTime,
                endTime: $0.endTime,
                confidence: $0.confidence
            )
        }
        let cues = try CueBuilder.fromTokenTimings(
            timings,
            transcript: result.text,
            duration: result.duration
        )
        onProgress(1)
        return TranscriptionOutput(engine: "parakeet", cues: cues)
    }

    private func transcribeCohere(
        mediaURL: URL,
        cancellation: CancellationToken,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> TranscriptionOutput {
        let pipeline: CoherePipeline
        let models: CoherePipeline.LoadedModels
        if let cachedPipeline = coherePipeline, let cachedModels = cohereModels {
            pipeline = cachedPipeline
            models = cachedModels
        } else {
            let layout = try modelLocator.locateCohere()
            try cancellation.checkCancellation()
            let loaded: CoherePipeline.LoadedModels
            do {
                switch layout.decoderVariant {
                case .v1:
                    loaded = try await CoherePipeline.loadModels(
                        encoderDir: layout.encoderDirectoryURL,
                        decoderDir: layout.decoderDirectoryURL,
                        vocabDir: layout.vocabDirectoryURL,
                        decoderVariant: .v1,
                        computeUnits: .cpuAndGPU
                    )
                case .v2:
                    loaded = try await CoherePipeline.loadModels(
                        encoderDir: layout.encoderDirectoryURL,
                        decoderDir: layout.decoderDirectoryURL,
                        vocabDir: layout.vocabDirectoryURL,
                        decoderVariant: .v2,
                        computeUnits: .cpuAndGPU
                    )
                }
            } catch {
                throw FluidModelLoadingError.normalize(error)
            }
            let loadedPipeline = CoherePipeline()
            coherePipeline = loadedPipeline
            cohereModels = loaded
            pipeline = loadedPipeline
            models = loaded
        }

        try cancellation.checkCancellation()
        let samples = try AudioConverter().resampleAudioFile(mediaURL)
        let sampleRate = 16_000
        let windows = try AudioWindowPlanner.makeWindows(samples: samples, sampleRate: sampleRate)
        var transcripts: [String] = []
        transcripts.reserveCapacity(windows.count)
        for (index, window) in windows.enumerated() {
            try cancellation.checkCancellation()
            let audio = Array(samples[window.startSample..<window.endSample])
            let result = try await pipeline.transcribe(audio: audio, models: models, language: .chinese)
            try cancellation.checkCancellation()
            transcripts.append(result.text)
            onProgress(Double(index + 1) / Double(windows.count))
        }
        let cues = try CueBuilder.fromWindowTranscripts(transcripts, windows: windows, sampleRate: sampleRate)
        return TranscriptionOutput(engine: "cohere", cues: cues)
    }

    private func parakeetLanguage(_ code: String?) -> Language? {
        switch code {
        case "en": return .english
        case "es": return .spanish
        case "fr": return .french
        case "de": return .german
        case "it": return .italian
        case "pt": return .portuguese
        case "ro": return .romanian
        case "nl": return .dutch
        case "da": return .danish
        case "sv": return .swedish
        case "fi": return .finnish
        case "hu": return .hungarian
        case "et": return .estonian
        case "lv": return .latvian
        case "lt": return .lithuanian
        case "mt": return .maltese
        case "pl": return .polish
        case "cs": return .czech
        case "sk": return .slovak
        case "sl": return .slovenian
        case "hr": return .croatian
        case "bs": return .bosnian
        case "ru": return .russian
        case "uk": return .ukrainian
        case "be": return .belarusian
        case "bg": return .bulgarian
        case "sr": return .serbian
        case "el": return .greek
        default: return nil
        }
    }
}
