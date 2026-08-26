import Foundation

private func applicationSupportURLs() -> (user: URL, caches: URL, sparkSub: URL) {
    let fileManager = FileManager.default
    let userSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
    let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
        ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches", isDirectory: true)
    return (userSupport, caches, userSupport.appendingPathComponent("SparkSub", isDirectory: true))
}

private func writeDiagnostic(_ object: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    var output = data
    output.append(0x0a)
    try FileHandle.standardOutput.write(contentsOf: output)
}

private func logError(_ message: String) {
    guard let data = (message + "\n").data(using: .utf8) else { return }
    try? FileHandle.standardError.write(contentsOf: data)
}

FluidAudioRuntime.prepareForOfflineInference()

let support = applicationSupportURLs()
let ytDLPURL = support.sparkSub.appendingPathComponent("bin/yt-dlp_macos")
let modelLocator = ModelLocator(
    userApplicationSupportURL: support.user,
    userCachesURL: support.caches,
    sparkSubApplicationSupportURL: support.sparkSub,
    ytDLPExecutableURL: ytDLPURL
)

if Array(CommandLine.arguments.dropFirst()) == ["--diagnose"] {
    do {
        try writeDiagnostic(modelLocator.capabilities().jsonObject)
    } catch {
        logError("SparkSub diagnose failed: \(AppError.normalize(error).code)")
        exit(1)
    }
    exit(0)
}

guard CommandLine.arguments.count == 1 else {
    logError("SparkSub native host accepts only --diagnose outside Native Messaging mode")
    exit(2)
}

let writer = NativeMessageWriter(output: .standardOutput)
let downloader = MediaDownloader(ytDLPExecutableURL: ytDLPURL)
let youtubeCaptionFetcher = YouTubeCaptionFetcher(ytDLPExecutableURL: ytDLPURL)
let engine = TranscriptionEngine(modelLocator: modelLocator)
let controller = HostController(
    writer: writer,
    mediaDownloader: downloader,
    youtubeCaptionFetcher: youtubeCaptionFetcher,
    transcriptionEngine: engine,
    capabilityProvider: modelLocator,
    workspaceManager: JobWorkspaceManager(
        rootURL: support.sparkSub.appendingPathComponent("Temporary", isDirectory: true)
    )
)

do {
    while let payload = try NativeFrameCodec.readFrame(from: FileHandle.standardInput) {
        controller.submit(payload)
    }
} catch {
    logError("SparkSub Native Messaging input stopped: \(AppError.normalize(error).code)")
}

let shutdown = DispatchSemaphore(value: 0)
Task {
    await controller.shutdown()
    shutdown.signal()
}
shutdown.wait()
controller.waitForSubmittedWork()
