// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "SparkSubHost",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "sparksub-native-host", targets: ["SparkSubHost"]),
    ],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.15.6"),
    ],
    targets: [
        .executableTarget(
            name: "SparkSubHost",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio"),
            ]
        ),
        .testTarget(name: "SparkSubHostTests", dependencies: ["SparkSubHost"]),
    ],
    swiftLanguageVersions: [.v5]
)
