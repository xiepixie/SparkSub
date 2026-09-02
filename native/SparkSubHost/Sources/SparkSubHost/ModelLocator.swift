import CoreML
import Foundation

struct ComponentCapability: Codable, Equatable, Sendable {
    let available: Bool
    let detail: String

    var jsonObject: [String: Any] { ["available": available, "detail": detail] }
}

struct HostCapabilities: Codable, Equatable, Sendable {
    let protocolVersion: Int
    let ytDLP: ComponentCapability
    let parakeet: ComponentCapability
    let cohere: ComponentCapability

    var jsonObject: [String: Any] {
        [
            "protocolVersion": protocolVersion,
            "hostReady": ytDLP.available && (parakeet.available || cohere.available),
            "ytDLP": ytDLP.jsonObject,
            "models": ["parakeet": parakeet.jsonObject, "cohere": cohere.jsonObject],
        ]
    }
}

protocol CapabilityProviding: Sendable {
    func capabilities() -> HostCapabilities
}

struct ParakeetLayout: Equatable, Sendable {
    let sourceURL: URL
    let compatibilityURL: URL
}

enum CohereDecoderVariant: Equatable, Sendable {
    case v1
    case v2
}

struct CohereLayout: Equatable, Sendable {
    let sourceURL: URL
    let compatibilityURL: URL
    let encoderDirectoryURL: URL
    let decoderDirectoryURL: URL
    let vocabDirectoryURL: URL
    let decoderVariant: CohereDecoderVariant
}

final class ModelLocator: CapabilityProviding, @unchecked Sendable {
    static let parakeetCompatibilityFolder = "parakeet-tdt-0.6b-v3"
    static let parakeetRequiredNames = [
        "Preprocessor.mlmodelc",
        "Encoder.mlmodelc",
        "Decoder.mlmodelc",
        "JointDecisionv3.mlmodelc",
        "parakeet_vocab.json",
    ]

    let userApplicationSupportURL: URL
    let userCachesURL: URL?
    let sparkSubApplicationSupportURL: URL
    let cohereSearchRoots: [URL]
    let decoderInputInspector: @Sendable (URL) throws -> [String]
    let ytDLPExecutableURL: URL?

    init(
        userApplicationSupportURL: URL,
        userCachesURL: URL? = nil,
        sparkSubApplicationSupportURL: URL,
        cohereSearchRoots: [URL]? = nil,
        decoderInputInspector: @escaping @Sendable (URL) throws -> [String] = ModelLocator.inspectDecoderInputs,
        ytDLPExecutableURL: URL? = nil
    ) {
        self.userApplicationSupportURL = userApplicationSupportURL
        self.userCachesURL = userCachesURL
        self.sparkSubApplicationSupportURL = sparkSubApplicationSupportURL
        var defaultRoots = [
            userApplicationSupportURL.appendingPathComponent("FluidAudio/Cohere", isDirectory: true),
            userApplicationSupportURL.appendingPathComponent("FluidAudio/Models/Cohere", isDirectory: true),
            userApplicationSupportURL.appendingPathComponent("Cohere", isDirectory: true),
        ]
        if let userCachesURL {
            defaultRoots.append(userCachesURL.appendingPathComponent("FluidAudio/CompiledCohereModels", isDirectory: true))
            defaultRoots.append(userCachesURL.appendingPathComponent("cohere-transcribe-03-2026-CoreML-6bit", isDirectory: true))
        }
        self.cohereSearchRoots = cohereSearchRoots ?? defaultRoots
        self.decoderInputInspector = decoderInputInspector
        self.ytDLPExecutableURL = ytDLPExecutableURL
    }

    func locateParakeet() throws -> ParakeetLayout {
        let source = userApplicationSupportURL.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true)
        let assets = try validatedParakeetAssets(at: source)
        let compatibility = sparkSubApplicationSupportURL
            .appendingPathComponent("Models", isDirectory: true)
            .appendingPathComponent(Self.parakeetCompatibilityFolder, isDirectory: true)
        try stageAliases(assets, in: compatibility)
        return ParakeetLayout(sourceURL: source, compatibilityURL: compatibility)
    }

    func locateCohere() throws -> CohereLayout {
        let candidate = try validatedCohereCandidate()
        let compatibility = sparkSubApplicationSupportURL
            .appendingPathComponent("Models/cohere-compatible", isDirectory: true)
        let decoderName = candidate.variant == .v2
            ? "cohere_decoder_cache_external_v2.mlmodelc"
            : "cohere_decoder_cache_external.mlmodelc"
        var assets = [
            "cohere_encoder.mlmodelc": candidate.encoder,
            decoderName: candidate.decoder,
        ]
        if candidate.vocab.lastPathComponent == "vocab.json" {
            assets["vocab.json"] = candidate.vocab
            try stageAliases(assets, in: compatibility)
        } else {
            try stageAliases(assets, in: compatibility)
            if let data = try? Data(contentsOf: candidate.vocab),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let tokens = json["id_to_token"] as? [String] {
                var dict: [String: String] = [:]
                dict.reserveCapacity(tokens.count)
                for (idx, tok) in tokens.enumerated() {
                    dict[String(idx)] = tok
                }
                if let outData = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted]) {
                    try outData.write(to: compatibility.appendingPathComponent("vocab.json"))
                }
            }
        }
        return CohereLayout(
            sourceURL: candidate.root,
            compatibilityURL: compatibility,
            encoderDirectoryURL: compatibility,
            decoderDirectoryURL: compatibility,
            vocabDirectoryURL: compatibility,
            decoderVariant: candidate.variant
        )
    }

    func capabilities() -> HostCapabilities {
        let parakeetAvailable = (try? validatedParakeetAssets(
            at: userApplicationSupportURL.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true)
        )) != nil
        let cohereAvailable = (try? validatedCohereCandidate()) != nil
        let ytDLPAvailable = ytDLPExecutableURL.map(YTDLPConfiguration.isVerifiedInstallation) ?? false
        let ytDLPPresent = ytDLPExecutableURL.map {
            FileManager.default.isExecutableFile(atPath: $0.path) && $0.lastPathComponent == "yt-dlp_macos"
        } ?? false
        return HostCapabilities(
            protocolVersion: NativeRequest.protocolVersion,
            ytDLP: ComponentCapability(
                available: ytDLPAvailable,
                detail: ytDLPAvailable
                    ? "yt-dlp_macos \(YTDLPConfiguration.pinnedVersion) is verified"
                    : (ytDLPPresent ? "yt-dlp_macos is present but its pinned version is unverified" : "yt-dlp_macos is not installed")
            ),
            parakeet: ComponentCapability(
                available: parakeetAvailable,
                detail: parakeetAvailable ? "all local Parakeet v3 assets are present" : "required local Parakeet v3 assets are missing"
            ),
            cohere: ComponentCapability(
                available: cohereAvailable,
                detail: cohereAvailable ? "compatible local Cohere assets are present" : "Cohere vocabulary or k_cache_0 decoder input is missing"
            )
        )
    }

    private func validatedParakeetAssets(at source: URL) throws -> [String: URL] {
        var assets: [String: URL] = [:]
        for name in Self.parakeetRequiredNames where name != "parakeet_vocab.json" {
            let url = source.appendingPathComponent(name)
            guard existsWithoutFollowingUserMutation(url) else { throw AppError.modelNotFound }
            guard isCompleteCompiledModel(at: url) else { throw AppError.modelLayoutIncompatible }
            assets[name] = url
        }
        let standardVocab = source.appendingPathComponent("parakeet_vocab.json")
        let alternateVocab = source.appendingPathComponent("parakeet_v3_vocab.json")
        let vocabCandidates = [standardVocab, alternateVocab].filter { existsWithoutFollowingUserMutation($0) }
        guard !vocabCandidates.isEmpty else { throw AppError.modelNotFound }
        guard let vocabulary = vocabCandidates.first(where: { isNonemptyJSONVocabulary(at: $0) }) else {
            throw AppError.modelLayoutIncompatible
        }
        assets["parakeet_vocab.json"] = vocabulary
        return assets
    }

    private struct CohereCandidate {
        let root: URL
        let encoder: URL
        let decoder: URL
        let vocab: URL
        let variant: CohereDecoderVariant
    }

    private func validatedCohereCandidate() throws -> CohereCandidate {
        var sawAssetsWithoutVocabulary = false
        var sawIncompatibleDecoder = false
        for root in expandedCohereRoots() {
            guard let encoder = cohereEncoderCandidate(in: root) else { continue }
            let decoderCandidates = cohereDecoderCandidates(in: root)
            guard !decoderCandidates.isEmpty else { continue }
            let vocabCandidates = [
                root.appendingPathComponent("vocab.json"),
                root.appendingPathComponent("coreml_manifest.json"),
                root.deletingLastPathComponent().appendingPathComponent("vocab.json"),
                root.deletingLastPathComponent().appendingPathComponent("coreml_manifest.json"),
                userApplicationSupportURL.appendingPathComponent("FluidAudio/Cohere/vocab.json")
            ]
            guard let vocab = vocabCandidates.first(where: { existsWithoutFollowingUserMutation($0) && isNonemptyJSONVocabulary(at: $0) }) else {
                sawAssetsWithoutVocabulary = true
                continue
            }
            guard isCompleteCompiledModel(at: encoder) else {
                sawIncompatibleDecoder = true
                continue
            }
            for (decoder, variant) in decoderCandidates {
                guard isCompleteCompiledModel(at: decoder) else {
                    sawIncompatibleDecoder = true
                    continue
                }
                let inputs = (try? decoderInputInspector(decoder)) ?? []
                guard inputs.contains("k_cache_0") else {
                    sawIncompatibleDecoder = true
                    continue
                }
                return CohereCandidate(root: root, encoder: encoder, decoder: decoder, vocab: vocab, variant: variant)
            }
        }
        if sawAssetsWithoutVocabulary || sawIncompatibleDecoder { throw AppError.modelLayoutIncompatible }
        throw AppError.modelNotFound
    }

    private func expandedCohereRoots() -> [URL] {
        var roots: [URL] = []
        for root in cohereSearchRoots {
            roots.append(root)
            if let children = try? FileManager.default.contentsOfDirectory(
                at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]
            ) {
                roots.append(contentsOf: children.filter { url in
                    (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                }.sorted { $0.lastPathComponent < $1.lastPathComponent })
            }
        }
        return roots
    }

    private func cohereDecoderCandidates(in root: URL) -> [(URL, CohereDecoderVariant)] {
        let preferred = [
            ("cohere_decoder_cache_external_v2.mlmodelc", CohereDecoderVariant.v2),
            ("cohere_decoder_cache_external.mlmodelc", CohereDecoderVariant.v1),
        ]
        var candidates = preferred.compactMap { name, variant -> (URL, CohereDecoderVariant)? in
            let url = root.appendingPathComponent(name)
            return existsWithoutFollowingUserMutation(url) ? (url, variant) : nil
        }
        if let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) {
            for name in names.sorted() where name.hasSuffix(".mlmodelc") {
                let variant: CohereDecoderVariant?
                if name.hasPrefix("cohere_decoder_cache_external_v2_") { variant = .v2 }
                else if name.hasPrefix("cohere_decoder_cache_external_") { variant = .v1 }
                else if name.hasPrefix("cohere_decoder_cached_ane_") { variant = .v2 }
                else if name.hasPrefix("cohere_decoder_fullseq_masked_") { variant = .v2 }
                else { variant = nil }
                if let variant {
                    let url = root.appendingPathComponent(name)
                    if !candidates.contains(where: { $0.0 == url }) { candidates.append((url, variant)) }
                }
            }
        }
        return candidates
    }

    private func cohereEncoderCandidate(in root: URL) -> URL? {
        let standard = root.appendingPathComponent("cohere_encoder.mlmodelc")
        if existsWithoutFollowingUserMutation(standard) { return standard }
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return nil }
        return names.sorted()
            .first(where: { $0.hasPrefix("cohere_encoder_gpu_") && $0.hasSuffix(".mlmodelc") })
            .map { root.appendingPathComponent($0) }
    }

    private func stageAliases(_ assets: [String: URL], in destination: URL) throws {
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        for (name, source) in assets {
            let alias = destination.appendingPathComponent(name)
            let isDeadSymlink = (try? alias.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink == true
            if FileManager.default.fileExists(atPath: alias.path) || isDeadSymlink {
                if let existing = try? FileManager.default.destinationOfSymbolicLink(atPath: alias.path), existing == source.path {
                    continue
                }
                try? FileManager.default.removeItem(at: alias)
            }
            try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: source)
        }
    }

    private func existsWithoutFollowingUserMutation(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    private func isCompleteCompiledModel(at url: URL) -> Bool {
        let resolved = url.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return false
        }
        let modelData = resolved.appendingPathComponent("coremldata.bin")
        guard FileManager.default.fileExists(atPath: modelData.path) else {
            return false
        }
        let resolvedModelData = modelData.resolvingSymlinksInPath()
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: resolvedModelData.path),
              let size = attributes[.size] as? NSNumber else {
            return false
        }
        return size.intValue > 0
    }

    private func isNonemptyJSONVocabulary(at url: URL) -> Bool {
        let resolved = url.resolvingSymlinksInPath()
        guard let data = try? Data(contentsOf: resolved), !data.isEmpty,
              let object = try? JSONSerialization.jsonObject(with: data) else {
            return false
        }
        if let array = object as? [Any] { return !array.isEmpty }
        if let dictionary = object as? [String: Any] {
            if let idToToken = dictionary["id_to_token"] as? [Any] { return !idToToken.isEmpty }
            return !dictionary.isEmpty
        }
        return false
    }

    @Sendable private static func inspectDecoderInputs(_ compiledDecoder: URL) throws -> [String] {
        let model = try MLModel(contentsOf: compiledDecoder)
        return Array(model.modelDescription.inputDescriptionsByName.keys).sorted()
    }
}
