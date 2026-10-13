# workline

- `grammar.js` is the only definition of the syntax. JSDoc only, no TypeScript syntax; `tsc --checkJs` is the type gate.
- Grammar, spec, vectors, `lib/` and `golang/` change in the same commit. A syntax change without a vector is not done.
- Never edit `src/` by hand. After a grammar change run `npm run build` and commit `src/`, `workline.wasm` and `bindings/go/parser_sum.go`; CI fails when `src/` is stale.
- Other languages reuse the grammar and reimplement only the semantics, checked against `test/vectors.json`.
- Nothing may be copied from Liftosaur (AGPL-3.0). Borrow notation from its public docs only.
- Serialize keeps error lines verbatim.
- Keep go-tree-sitter >= v0.25.0 in `go.mod` (grammar is ABI 15), also after `tree-sitter init -u`. That command also recreates `Makefile`, `CMakeLists.txt` and the `.pc` template; delete them.
- Keep `web-tree-sitter` pinned exactly.
- The grammar version in `tree-sitter.json` is separate from the package version. Bump it in the same PR as a `grammar.js` change, only then, and rebuild.
- Releases: release-please only. Never hand-bump or tag.
