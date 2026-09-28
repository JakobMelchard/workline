# workline

Text notation for strength sets, one exercise per line, made to live in a
spreadsheet cell. Syntax inspired by Liftoscript exercise lines.

```
Bench Press / 4x5, 1x5+ @8 / 100kg 2m
```

One tree-sitter grammar ([`grammar.js`](grammar.js)) defines the syntax for
every language and editor. Meaning: [`SPEC.md`](SPEC.md). Conformance cases:
[`test/vectors.json`](test/vectors.json).

| Use | How |
|---|---|
| JS (Node, browser, Workers, Capacitor) | `@jakobmelchard/workline`, web-tree-sitter + `workline.wasm` |
| Go | `github.com/JakobMelchard/workline/bindings/go` (cgo) |
| Swift | this repo as a Swift package, `TreeSitterWorkline` |
| Kotlin / Android | KTreeSitter with this grammar |
| Neovim | nvim-treesitter parser config pointing at this repo, `queries/` for highlights |

```js
import { init, parse, expand, serialize } from '@jakobmelchard/workline'

await init()                    // once; loads the wasm parser

const { lines, errors } = parse(cell)
const sets = expand(lines[0])   // one entry per set, defaults applied
const canonical = serialize({ lines, errors })
```

Browsers and Android WebView need no options: `init()` fetches the wasm next
to the module and instantiates it asynchronously. On Cloudflare Workers, wasm
can't be fetched or compiled at runtime, so import both files as modules
(wrangler's default rule) and hand them over:

```js
import runtime from '@jakobmelchard/workline/web-tree-sitter.wasm'
import language from '@jakobmelchard/workline/workline.wasm'

await init({ runtime, language })
```

```sh
npm install && npm run build && npx tsc && npm test
```

## Legacy migration

`scripts/migrate-legacy.js` converts load cells written in the old
`JakobMelchard/workout` grammar (`3x8@60`, `@` = weight, default kg) to
workline (`3x8 60kg`). Lines it cannot convert safely are kept verbatim and
listed for manual fixing, including every legacy `m` target (meters or
minutes; workline `m` is minutes). See SPEC.md "Legacy input".

```sh
node scripts/migrate-legacy.js cells.json          # or cells.csv, or stdin; report only
node scripts/migrate-legacy.js --sheet <id|url>    # read-only: every tab's `load` column,
                                                   # report + proposed values:batchUpdate JSON
node scripts/migrate-legacy.js --sheet <id> --tab <name> --write   # test sheet only
```

`--sheet` authenticates with the service-account JSON in
`GSHEET_SERVICE_PRINCIPAL_JSON` and a read-only scope. `--write` is refused
unless the sheet is `$GSHEET_TEST_SHEET`; migrate real sheets by reviewing the
proposed batch and applying it yourself. `--json` prints machine-readable output.
