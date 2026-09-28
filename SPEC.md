# workline spec, v1

A text notation for prescribed and performed strength sets, one exercise per
line. Built to live in a spreadsheet cell and stay readable there.
Syntax is inspired by Liftosaur's Liftoscript exercise lines; nothing here is
derived from its source.

Implementations in any language must pass `test/vectors.json`. Syntax comes
from the shared tree-sitter grammar; each language adds only the semantics below.

## Examples

```
3x8                         3 sets of 8 reps
3x8-12 60kg                 rep range, fixed weight
Bench Press / 4x5, 1x5+ @8  named, 4x5 then one AMRAP set at RPE 8
Squat / 3x5 80% / 3m        last section applies to every group
1x6 70%+, 5x5 50% 90s       per-group loads and rest
3x30s                       timed sets
1x20m @7+                   20 minutes, RPE logged
1x2km                       distance set
```

## Syntax

[`grammar.js`](grammar.js) (tree-sitter) is the only definition of the syntax.
Every implementation parses with the parser generated from it, so this spec
only covers what the syntax cannot express. In short:

- `line = [name "/"] group {"," group} ["/" mods]`, one per text line
- `name` is any text before the first `/` that does not start with a digit
- `group = SETS x TARGET [mods]`, `x` also `X` or `×`
- `TARGET = N[-N][r|s|m|km][+]`: `r` reps (the default when omitted), `s`
  seconds, `m` minutes, `km` kilometers. `min` is accepted for `m`.
  Suffixes are written with no space before them
- `mods` in any order: weight `60kg` / `135lb` / `?+`, percent `80%`,
  rpe `@8`, rest `90s` / `2m` (`min` accepted), each optionally followed by `+` where the
  semantics below allow it

Mods are separated by spaces or tabs: `60kg 50%`, never `60kg50%`. Only an
`@` form may touch the token before it (`3x8@8`, legacy `3x8@60kg`), and the
first mod after `/` needs no space. Elsewhere whitespace is free, except
before a suffix.

## Semantics

- **sets**: a whole number >= 1.
- **target**: the reps (or seconds, minutes, kilometers) per set.
  `8-12` is a range, `min <= max`. A trailing `+` marks it as logged:
  AMRAP for reps, "as long as possible" for time and distance.
- **weight**: absolute load. `+` means the lifter confirms or edits it while
  logging. `?+` means no prescribed weight, ask for it.
- **percent**: percentage of 1RM, `0 < value <= 200`. `+` as for weight.
- **rpe**: target RPE, `1 <= value <= 10`. `+` means the lifter logs actual RPE.
- **rest**: rest after each set, a whole number, stored in seconds.
- A group holds at most one of each mod kind, and not both weight and percent.
- The trailing `/ mods` section is the line's defaults. A group's own mod wins
  over the default of the same kind; weight and percent count as one kind.

Expanding a line yields one entry per set with defaults applied, in order.

## Errors

A line that fails to parse is reported with its 0-based line index, raw text
and a reason, and is kept verbatim on serialize. Other lines still parse.
Reasons are free text; conformance only checks that a line errors.

## Canonical form

Serializing produces:

- `name / ` prefix when named, name trimmed, inner whitespace collapsed
- groups joined by `, `
- inside a group: `SETSxTARGET`, then weight or percent, then rpe, then rest,
  separated by one space
- targets in reps without `r`, minutes as `m`
- rest as `Nm` when a whole number of minutes, else `Ns`
- numbers without trailing zeros (`62.5`, `60`)
- defaults as ` / mods` in the same mod order, omitted when empty

`parse(serialize(parse(x)))` must equal `parse(x)`.

## Legacy input

The previous grammar (`JakobMelchard/workout` `public/grammar.js`) used
`SETSxVALUE@WEIGHT[UNIT]` with `@` meaning weight and a default unit of kg.
v1 reads `@` as RPE. For migration:

- `@<num>kg` / `@<num>lb` is accepted as weight and serializes in canonical
  form (`3x8@60kg` becomes `3x8 60kg`).
- `@<num>` without a unit is RPE. Values above 10 error, which flags old
  unitless weights for manual fixing.
- Legacy target suffixes other than `r`, `s`, `m`, `min`, `km` error. Note
  that a legacy `m` meant meters and now means minutes.

## Not in v1

Program structure (weeks, days, reuse), progression scripts, warmups,
supersets, tags and notes. Tags and notes live in their own spreadsheet
columns until a consumer needs them inline.
