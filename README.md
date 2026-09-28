# loadline

Text notation for strength sets, one exercise per line, made to live in a
spreadsheet cell. Syntax inspired by Liftoscript exercise lines.

```
Bench Press / 4x5, 1x5+ @8 / 100kg 2min
```

Spec: [`SPEC.md`](SPEC.md). Conformance cases: [`test/vectors.json`](test/vectors.json).
This repo holds the JS reference implementation.

```js
import { parse, expand, serialize } from '@jakobmelchard/loadline'

const { lines, errors } = parse(cell)
const sets = expand(lines[0])   // one entry per set, defaults applied
const canonical = serialize({ lines, errors })
```

```sh
npm install && npx tsc && npm test
```
