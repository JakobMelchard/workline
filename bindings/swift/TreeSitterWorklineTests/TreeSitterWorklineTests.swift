import XCTest
import SwiftTreeSitter
import TreeSitterWorkline

final class TreeSitterWorklineTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_workline())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading workline grammar")
    }
}
