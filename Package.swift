// swift-tools-version:5.6

import Foundation
import PackageDescription

let dir = Context.packageDirectory
var sources = ["src/parser.c"]
if FileManager.default.fileExists(atPath: "\(dir)/src/scanner.c") {
    sources.append("src/scanner.c")
}

let package = Package(
    name: "TreeSitterWorkline",
    products: [
        .library(name: "TreeSitterWorkline", targets: ["TreeSitterWorkline"]),
    ],
    dependencies: [
        .package(url: "https://github.com/tree-sitter/swift-tree-sitter", from: "0.9.0"),
    ],
    targets: [
        .target(
            name: "TreeSitterWorkline",
            dependencies: [],
            path: ".",
            sources: sources,
            resources: [
                .copy("queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("src")]
        ),
        .testTarget(
            name: "TreeSitterWorklineTests",
            dependencies: [
                .product(name: "SwiftTreeSitter", package: "swift-tree-sitter"),
                "TreeSitterWorkline",
            ],
            path: "bindings/swift/TreeSitterWorklineTests"
        )
    ],
    cLanguageStandard: .c11
)
