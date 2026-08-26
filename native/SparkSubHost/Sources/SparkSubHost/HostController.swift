import Foundation

protocol HeartbeatLease: Sendable {
    func cancel()
}

protocol HeartbeatScheduling: Sendable {
    func schedule(_ action: @escaping @Sendable () -> Void) -> any HeartbeatLease
}

struct TaskHeartbeatScheduler: HeartbeatScheduling, Sendable {
    private let intervalNanoseconds: UInt64

    init(intervalNanoseconds: UInt64 = 30_000_000_000) {
        self.intervalNanoseconds = intervalNanoseconds
    }

    func schedule(_ action: @escaping @Sendable () -> Void) -> any HeartbeatLease {
        let task = Task<Void, Never> {
            while !Task.isCancelled {
                do {
                    try await Task<Never, Never>.sleep(nanoseconds: intervalNanoseconds)
                } catch {
                    return
                }
                guard !Task.isCancelled else { return }
                action()
            }
        }
        return TaskHeartbeatLease(task: task)
    }
}

private final class TaskHeartbeatLease: HeartbeatLease, @unchecked Sendable {
    private let task: Task<Void, Never>

    init(task: Task<Void, Never>) {
        self.task = task
    }

    func cancel() {
        task.cancel()
    }
}

private final class TranscriptionProgressState: @unchecked Sendable {
    private let lock = NSLock()
    private var percent = 70
    private var hint = "Loading the local transcription model"

    func update(percent: Int, hint: String) {
        lock.lock()
        self.percent = percent
        self.hint = hint
        lock.unlock()
    }

    func snapshot() -> (percent: Int, hint: String) {
        lock.lock()
        defer { lock.unlock() }
        return (percent, hint)
    }
}

actor JobCoordinator {
    private var jobs: [String: CancellationToken] = [:]
    private var pendingCancellations: [String: Date] = [:]
    private var isShuttingDown = false
    private let pendingCancellationLifetime: TimeInterval = 30

    func register(jobId: String) throws -> CancellationToken {
        prunePendingCancellations()
        guard jobs[jobId] == nil else { throw AppError.invalidRequest }
        let token = CancellationToken()
        jobs[jobId] = token
        if isShuttingDown || pendingCancellations.removeValue(forKey: jobId) != nil {
            token.cancel()
        }
        return token
    }

    func cancel(jobId: String) -> Bool {
        prunePendingCancellations()
        if let token = jobs[jobId] {
            token.cancel()
        } else {
            pendingCancellations[jobId] = Date()
        }
        return true
    }

    func mayEmitResults(jobId: String, token: CancellationToken) -> Bool {
        guard let active = jobs[jobId] else { return false }
        return active === token && !token.isCancelled
    }

    func finish(jobId: String, token: CancellationToken) {
        guard jobs[jobId] === token else { return }
        jobs.removeValue(forKey: jobId)
    }

    func cancelAll() {
        isShuttingDown = true
        let tokens = Array(jobs.values)
        tokens.forEach { $0.cancel() }
        pendingCancellations.removeAll()
    }

    private func prunePendingCancellations(now: Date = Date()) {
        pendingCancellations = pendingCancellations.filter {
            now.timeIntervalSince($0.value) <= pendingCancellationLifetime
        }
    }
}

final class HostController: @unchecked Sendable {
    private let writer: HostOutputWriting
    private let mediaDownloader: MediaAcquiring
    private let youtubeCaptionFetcher: YouTubeCaptionFetching
    private let transcriptionEngine: Transcribing
    private let capabilityProvider: CapabilityProviding
    private let workspaceManager: JobWorkspaceManager
    private let coordinator: JobCoordinator
    private let heartbeatScheduler: HeartbeatScheduling
    private let submitted = DispatchGroup()

    init(
        writer: HostOutputWriting,
        mediaDownloader: MediaAcquiring,
        youtubeCaptionFetcher: YouTubeCaptionFetching = UnavailableYouTubeCaptionFetcher(),
        transcriptionEngine: Transcribing,
        capabilityProvider: CapabilityProviding,
        workspaceManager: JobWorkspaceManager,
        coordinator: JobCoordinator = JobCoordinator(),
        heartbeatScheduler: HeartbeatScheduling = TaskHeartbeatScheduler()
    ) {
        self.writer = writer
        self.mediaDownloader = mediaDownloader
        self.youtubeCaptionFetcher = youtubeCaptionFetcher
        self.transcriptionEngine = transcriptionEngine
        self.capabilityProvider = capabilityProvider
        self.workspaceManager = workspaceManager
        self.coordinator = coordinator
        self.heartbeatScheduler = heartbeatScheduler
    }

    func submit(_ payload: Data) {
        submitted.enter()
        Task { [self] in
            await handlePayload(payload)
            submitted.leave()
        }
    }

    func handlePayload(_ payload: Data) async {
        let request: NativeRequest
        do {
            request = try NativeRequest.decodeAndValidate(payload)
        } catch {
            let correlation = correlationFields(from: payload)
            let appError = AppError.normalize(error)
            if let requestId = correlation.requestId {
                if let encoded = try? NativeEnvelope.failureResponse(requestId: requestId, error: appError) {
                    try? writer.writeEncodedPayload(encoded)
                }
            }
            return
        }

        switch request.type {
        case .capabilities:
            writeResponse(requestId: request.requestId, result: capabilityProvider.capabilities().jsonObject)
        case .ping:
            writeResponse(requestId: request.requestId, result: [
                "alive": true,
                "protocolVersion": NativeRequest.protocolVersion,
            ])
        case .cancel:
            let cancelled = await coordinator.cancel(jobId: request.jobId ?? "")
            writeResponse(requestId: request.requestId, result: ["cancelled": cancelled])
        case .transcribe:
            await handleTranscription(request)
        case .youtubeCaptions:
            await handleYouTubeCaptions(request)
        }
    }

    func shutdown() async {
        await coordinator.cancelAll()
    }

    func waitForSubmittedWork() {
        submitted.wait()
    }

    func waitForSubmittedWorkAsync() async {
        await withCheckedContinuation { continuation in
            submitted.notify(queue: DispatchQueue.global()) { continuation.resume() }
        }
    }

    private func handleTranscription(_ request: NativeRequest) async {
        guard let jobId = request.jobId,
              let sourceLanguage = request.sourceLanguage,
              let source = request.source else {
            writeTopLevelError(requestId: request.requestId, jobId: request.jobId, error: .invalidRequest)
            return
        }
        let token: CancellationToken
        do {
            token = try await coordinator.register(jobId: jobId)
        } catch {
            writeTopLevelError(requestId: request.requestId, jobId: jobId, error: AppError.normalize(error))
            return
        }

        do {
            let output = try await workspaceManager.withWorkspace { [self] workspace in
                try token.checkCancellation()
                writeProgress(
                    requestId: request.requestId,
                    jobId: jobId,
                    stage: "fetching_audio",
                    percent: 50,
                    hint: "Preparing media download"
                )
                let mediaURL = try await mediaDownloader.acquire(
                    source: source,
                    workspace: workspace,
                    cancellation: token,
                    onProgress: { [weak self] fraction in
                        guard !token.isCancelled else { return }
                        self?.writeProgress(
                            requestId: request.requestId,
                            jobId: jobId,
                            stage: "fetching_audio",
                            percent: 50 + Int(min(1, max(0, fraction)) * 20),
                            hint: "Downloading media"
                        )
                    }
                )
                try token.checkCancellation()
                writeProgress(
                    requestId: request.requestId,
                    jobId: jobId,
                    stage: "transcribing",
                    percent: 70,
                    hint: "Loading the local transcription model"
                )
                let progressState = TranscriptionProgressState()
                let heartbeat = heartbeatScheduler.schedule { [weak self] in
                    guard !token.isCancelled else { return }
                    let progress = progressState.snapshot()
                    self?.writeProgress(
                        requestId: request.requestId,
                        jobId: jobId,
                        stage: "transcribing",
                        percent: progress.percent,
                        hint: progress.hint
                    )
                }
                defer { heartbeat.cancel() }
                return try await transcriptionEngine.transcribe(
                    mediaURL: mediaURL,
                    sourceLanguage: sourceLanguage,
                    platformLanguage: request.platformLanguage,
                    sourceKind: source.kind,
                    cancellation: token,
                    onProgress: { [weak self] fraction in
                        guard !token.isCancelled else { return }
                        let percent = 70 + Int(min(1, max(0, fraction)) * 25)
                        let hint = "Recognizing audio"
                        progressState.update(percent: percent, hint: hint)
                        self?.writeProgress(
                            requestId: request.requestId,
                            jobId: jobId,
                            stage: "transcribing",
                            percent: percent,
                            hint: hint
                        )
                    }
                )
            }
            try token.checkCancellation()
            guard await coordinator.mayEmitResults(jobId: jobId, token: token) else {
                throw AppError.cancelled
            }
            let plan = try ResultChunker().makePlan(
                cues: output.cues,
                requestId: request.requestId,
                jobId: jobId,
                engine: output.engine
            )
            for payload in [plan.begin] + plan.chunks + [plan.end] {
                try token.checkCancellation()
                guard await coordinator.mayEmitResults(jobId: jobId, token: token) else {
                    throw AppError.cancelled
                }
                try writer.writeEncodedPayload(payload)
            }
        } catch {
            writeTopLevelError(
                requestId: request.requestId,
                jobId: jobId,
                error: token.isCancelled ? .cancelled : AppError.normalize(error)
            )
        }
        await coordinator.finish(jobId: jobId, token: token)
    }

    private func handleYouTubeCaptions(_ request: NativeRequest) async {
        guard let jobId = request.jobId,
              let sourceLanguage = request.sourceLanguage,
              let source = request.source,
              source.kind == .youtube else {
            writeTopLevelError(requestId: request.requestId, jobId: request.jobId, error: .invalidRequest)
            return
        }
        let token: CancellationToken
        do {
            token = try await coordinator.register(jobId: jobId)
        } catch {
            writeTopLevelError(requestId: request.requestId, jobId: jobId, error: AppError.normalize(error))
            return
        }

        do {
            let result = try await workspaceManager.withWorkspace { [self] workspace in
                try token.checkCancellation()
                writeProgress(
                    requestId: request.requestId,
                    jobId: jobId,
                    stage: "fetching_caption",
                    percent: 45,
                    hint: "Inspecting public YouTube caption tracks"
                )
                return try await youtubeCaptionFetcher.fetch(
                    source: source,
                    sourceLanguage: sourceLanguage,
                    workspace: workspace,
                    cancellation: token,
                    onProgress: { [weak self] fraction in
                        guard !token.isCancelled else { return }
                        self?.writeProgress(
                            requestId: request.requestId,
                            jobId: jobId,
                            stage: "fetching_caption",
                            percent: 45 + Int(min(1, max(0, fraction)) * 25),
                            hint: "Fetching the selected YouTube caption"
                        )
                    }
                )
            }
            try token.checkCancellation()
            guard await coordinator.mayEmitResults(jobId: jobId, token: token) else {
                throw AppError.cancelled
            }
            let plan = try ResultChunker().makePlan(
                cues: result.cues,
                requestId: request.requestId,
                jobId: jobId,
                engine: "youtube",
                captionMetadata: result.metadata
            )
            for payload in [plan.begin] + plan.chunks + [plan.end] {
                try token.checkCancellation()
                guard await coordinator.mayEmitResults(jobId: jobId, token: token) else {
                    throw AppError.cancelled
                }
                try writer.writeEncodedPayload(payload)
            }
        } catch {
            writeTopLevelError(
                requestId: request.requestId,
                jobId: jobId,
                error: token.isCancelled ? .cancelled : AppError.normalize(error)
            )
        }
        await coordinator.finish(jobId: jobId, token: token)
    }

    private func writeResponse(requestId: String, result: [String: Any]) {
        guard let payload = try? NativeEnvelope.response(requestId: requestId, result: result) else { return }
        try? writer.writeEncodedPayload(payload)
    }

    private func writeProgress(requestId: String, jobId: String, stage: String, percent: Int, hint: String) {
        guard let payload = try? NativeEnvelope.progress(
            requestId: requestId,
            jobId: jobId,
            stage: stage,
            percent: min(100, max(0, percent)),
            hint: hint
        ) else { return }
        try? writer.writeEncodedPayload(payload)
    }

    private func writeTopLevelError(requestId: String, jobId: String?, error: AppError) {
        guard let payload = try? NativeEnvelope.topLevelError(
            requestId: requestId, jobId: jobId, error: error
        ) else { return }
        try? writer.writeEncodedPayload(payload)
    }

    private func correlationFields(from payload: Data) -> (requestId: String?, jobId: String?) {
        guard let object = try? JSONSerialization.jsonObject(with: payload) as? [String: Any] else {
            return (nil, nil)
        }
        return (object["requestId"] as? String, object["jobId"] as? String)
    }
}
