import Foundation

struct TokenTimingValue: Equatable, Sendable {
    let token: String
    let startTime: TimeInterval
    let endTime: TimeInterval
    let confidence: Float
}

struct AudioWindow: Equatable, Sendable {
    let startSample: Int
    let endSample: Int

    var sampleCount: Int { endSample - startSample }
}

enum AudioWindowPlanner {
    static func makeWindows(
        samples: [Float],
        sampleRate: Int,
        targetSeconds: Double = 30,
        maximumSeconds: Double = 35,
        searchRadiusSeconds: Double = 5
    ) throws -> [AudioWindow] {
        guard !samples.isEmpty, sampleRate > 0, targetSeconds > 0,
              maximumSeconds >= targetSeconds, searchRadiusSeconds >= 0 else {
            throw AppError.asrFailed
        }
        let target = max(1, Int(targetSeconds * Double(sampleRate)))
        let maximum = max(target, Int(maximumSeconds * Double(sampleRate)))
        let radius = Int(searchRadiusSeconds * Double(sampleRate))
        let energyRadius = max(1, sampleRate / 20)
        let stride = max(1, sampleRate / 100)
        var result: [AudioWindow] = []
        var start = 0

        while samples.count - start > maximum {
            let ideal = min(samples.count, start + target)
            let lower = max(start + 1, ideal - radius)
            let upper = min(start + maximum, ideal + radius)
            var best = ideal
            var bestEnergy = Float.greatestFiniteMagnitude
            if lower <= upper {
                var candidate = lower
                while candidate <= upper {
                    let energyStart = max(start, candidate - energyRadius)
                    let energyEnd = min(samples.count, candidate + energyRadius)
                    let count = max(1, energyEnd - energyStart)
                    let energy = samples[energyStart..<energyEnd].reduce(Float.zero) { $0 + abs($1) } / Float(count)
                    if energy < bestEnergy || (energy == bestEnergy && abs(candidate - ideal) < abs(best - ideal)) {
                        best = candidate
                        bestEnergy = energy
                    }
                    candidate += stride
                }
            }
            result.append(AudioWindow(startSample: start, endSample: best))
            start = best
        }
        if start < samples.count {
            result.append(AudioWindow(startSample: start, endSample: samples.count))
        }
        let minimum = 2 * sampleRate
        if result.count > 1, let last = result.last, last.sampleCount < minimum {
            let previous = result[result.count - 2]
            if last.endSample - previous.startSample <= maximum {
                result.removeLast(2)
                result.append(AudioWindow(startSample: previous.startSample, endSample: last.endSample))
            } else {
                let adjustedBoundary = last.endSample - minimum
                result[result.count - 2] = AudioWindow(startSample: previous.startSample, endSample: adjustedBoundary)
                result[result.count - 1] = AudioWindow(startSample: adjustedBoundary, endSample: last.endSample)
            }
        }
        guard !result.isEmpty,
              result.first?.startSample == 0,
              result.last?.endSample == samples.count,
              result.allSatisfy({ $0.sampleCount > 0 && $0.sampleCount <= maximum }),
              zip(result, result.dropFirst()).allSatisfy({ pair in pair.0.endSample == pair.1.startSample }) else {
            throw AppError.asrFailed
        }
        return result
    }
}

enum CueBuilder {
    static func fromTokenTimings(
        _ timings: [TokenTimingValue],
        transcript: String?,
        duration: TimeInterval
    ) throws -> [Cue] {
        let valid = timings
            .filter { $0.startTime.isFinite && $0.endTime.isFinite && $0.startTime >= 0 && $0.endTime > $0.startTime }
            .sorted { left, right in
                left.startTime == right.startTime ? left.endTime < right.endTime : left.startTime < right.startTime
            }
        guard !valid.isEmpty else { return try fallback(text: transcript, duration: duration) }

        var groups: [[TokenTimingValue]] = []
        var current: [TokenTimingValue] = []
        for timing in valid {
            if let last = current.last, timing.startTime < last.endTime { continue }
            if let first = current.first,
               timing.endTime - first.startTime > 8,
               (current.last?.endTime ?? first.startTime) - first.startTime >= 2 {
                groups.append(current)
                current = []
            }
            current.append(timing)
            let elapsed = (current.last?.endTime ?? 0) - (current.first?.startTime ?? 0)
            let punctuation = timing.token.trimmingCharacters(in: .whitespacesAndNewlines).last.map { ".!?。！？；;".contains($0) } ?? false
            if elapsed >= 8 || (elapsed >= 2 && punctuation) {
                groups.append(current)
                current = []
            }
        }
        if !current.isEmpty {
            if let last = groups.last,
               let firstTiming = last.first,
               let finalTiming = current.last,
               finalTiming.endTime - firstTiming.startTime <= 8 {
                groups[groups.count - 1].append(contentsOf: current)
            } else {
                groups.append(current)
            }
        }

        var cues: [Cue] = []
        for (index, group) in groups.enumerated() {
            guard let first = group.first, let last = group.last else { continue }
            let content = normalizedTokenText(group.map(\.token).joined())
            guard !content.isEmpty else { continue }
            let isShortTail = index == groups.count - 1 && last.endTime - first.startTime < 2
            let cueStart = isShortTail ? max(0, last.endTime - 2) : first.startTime
            let nextStart = index + 1 < groups.count ? groups[index + 1].first?.startTime : nil
            let maximumEnd = min(duration, nextStart ?? duration)
            let desiredEnd = max(last.endTime, cueStart + 2)
            let end = min(maximumEnd, min(cueStart + 8, desiredEnd))
            guard end > cueStart else { continue }
            cues.append(Cue(from: cueStart, to: end, content: content))
        }
        guard !cues.isEmpty,
              cues.allSatisfy({ $0.isValid && $0.to - $0.from >= 2 && $0.to - $0.from <= 8 }) else {
            return try fallback(text: transcript, duration: duration)
        }
        return cues
    }

    static func fromWindowTranscripts(
        _ transcripts: [String],
        windows: [AudioWindow],
        sampleRate: Int
    ) throws -> [Cue] {
        guard transcripts.count == windows.count, sampleRate > 0 else {
            throw AppError.asrFailed
        }
        var cues: [Cue] = []
        for (text, window) in zip(transcripts, windows) {
            let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !content.isEmpty, window.endSample > window.startSample else { continue }
            let windowStart = Double(window.startSample) / Double(sampleRate)
            let windowEnd = Double(window.endSample) / Double(sampleRate)
            let duration = windowEnd - windowStart
            guard duration >= 2 else { continue }
            let characters = Array(content)
            let desiredCount = max(1, Int(ceil(duration / 8)))
            let segmentCount = min(desiredCount, characters.count)
            let stride = duration / Double(segmentCount)
            var characterIndex = 0
            for index in 0..<segmentCount {
                let remainingCharacters = characters.count - characterIndex
                let remainingSegments = segmentCount - index
                let length = Int(ceil(Double(remainingCharacters) / Double(remainingSegments)))
                let segmentText = String(characters[characterIndex..<min(characters.count, characterIndex + length)])
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                characterIndex += length
                guard !segmentText.isEmpty else { continue }
                let start = windowStart + Double(index) * stride
                let end = min(windowEnd, start + min(8, max(2, stride)))
                let cue = Cue(from: start, to: end, content: segmentText)
                if cue.isValid { cues.append(cue) }
            }
        }
        guard !cues.isEmpty,
              cues.allSatisfy({ $0.isValid && $0.to - $0.from >= 2 && $0.to - $0.from <= 8 }),
              zip(cues, cues.dropFirst()).allSatisfy({ pair in pair.0.to <= pair.1.from }) else {
            throw AppError.asrFailed
        }
        return cues
    }

    private static func fallback(text: String?, duration: TimeInterval) throws -> [Cue] {
        let content = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !content.isEmpty, duration.isFinite, duration >= 2 else { throw AppError.asrFailed }
        return [Cue(from: 0, to: min(8, duration), content: content)]
    }

    private static func normalizedTokenText(_ value: String) -> String {
        value
            .replacingOccurrences(of: "▁", with: " ")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
