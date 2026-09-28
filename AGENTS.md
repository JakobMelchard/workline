# workline: set notation spec + JS reference parser

`SPEC.md` is the contract, `test/vectors.json` is its executable form, and
`src/index.js` is the reference implementation. JSDoc only, no TypeScript
syntax; `tsc --checkJs` is the type gate.

## Commands

```sh
npm install      # .gitignore ignores package-lock.json, so npm ci fails
npx tsc
npm test         # node:test, test/*.test.js
```

## Rules

- Change the spec, the vectors and the parser in the same commit. A syntax change
  without a vector is not done.
- Ports in other languages (Go, Kotlin, Swift) live in their consumer repos
  and must pass `vectors.json`; the package exports it as
  `@jakobmelchard/workline/vectors.json`.
- Nothing here may be copied from Liftosaur (AGPL-3.0). Borrow notation from
  its public docs only, never its grammar files or source.
- Serialize keeps error lines verbatim so a bad cell survives a round trip
  through an app untouched.
- Consumers pin tags. Bump `version` and tag when `src/`, `SPEC.md` or the
  vectors change.
