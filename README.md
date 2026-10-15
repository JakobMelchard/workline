# workline

Text notation for strength sets, one exercise per line, made to live in a spreadsheet cell. One tree-sitter grammar defines the syntax for every language and editor.

```
Bench Press / 4x5, 1x5+ @8 / 100kg 2m
```

```sh
npm ci
npm run build    # tree-sitter generate + workline.wasm; first run downloads wasi-sdk
npx tsc
npx eslint .
npm test
go vet ./bindings/go/ ./golang/
go test ./bindings/go/ ./golang/    # not ./...: node_modules can hold stray Go packages
```

| Path                        | Contents                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `grammar.js`                | the grammar; `src/` is generated from it                                              |
| `SPEC.md`                   | meaning: value ranges, defaults, canonical form                                       |
| `test/vectors.json`         | conformance cases every implementation must pass                                      |
| `lib/index.js`              | JS reference implementation (web-tree-sitter + `workline.wasm`), not published to npm |
| `golang/`                   | Go package `github.com/JakobMelchard/workline/golang`: `Parse`, `Expand`, `Serialize` |
| `bindings/go`               | raw cgo grammar binding                                                               |
| `queries/highlights.scm`    | editor highlighting (Neovim via nvim-treesitter)                                      |
| `scripts/migrate-legacy.js` | converts old `JakobMelchard/workout` load cells                                       |

## Use

```js
import { init, parse, expand, serialize } from '@jakobmelchard/workline'

await init() // once; loads the wasm parser

const { lines, errors } = parse(cell)
const sets = expand(lines[0]) // one entry per set, defaults applied
const canonical = serialize({ lines, errors })
```

On Cloudflare Workers, import both wasm files as modules and pass them in:

```js
import runtime from '@jakobmelchard/workline/web-tree-sitter.wasm'
import language from '@jakobmelchard/workline/workline.wasm'

await init({ runtime, language })
```

```go
import "github.com/JakobMelchard/workline/golang"

p := workline.Parse(cell)        // p.Lines, p.Errors
sets := workline.Expand(p.Lines[0])
canonical := workline.Serialize(p)
```

## Legacy migration

```sh
node scripts/migrate-legacy.js cells.json          # or cells.csv, or stdin; report only
node scripts/migrate-legacy.js --sheet <id|url>    # read-only; report + proposed values:batchUpdate JSON
node scripts/migrate-legacy.js --sheet <id> --tab <name> --write   # only $GSHEET_TEST_SHEET
```

Needs `GSHEET_SERVICE_PRINCIPAL_JSON`. `--json` prints machine-readable output. See "Legacy input" in `SPEC.md`.
