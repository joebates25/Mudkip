// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "MarkdownViewerMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "MarkdownViewerMac", targets: ["MarkdownViewerMac"])
    ],
    targets: [
        .executableTarget(
            name: "MarkdownViewerMac",
            path: "Sources/MarkdownViewerMac",
            resources: [
                .process("Resources")
            ]
        )
    ]
)
