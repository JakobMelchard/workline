# loadline spec, v1

A text notation for prescribed and performed strength sets, one exercise per
line. Built to live in a spreadsheet cell and stay readable there.
Syntax is inspired by Liftosaur's Liftoscript exercise lines; nothing here is
derived from its source.

Implementations in any language must pass `test/vectors.json`.

## Examples

```
3x8                         3 sets of 8 reps
3x8-12 60kg                 rep range, fixed weight
Bench Press / 4x5, 1x5+ @8  named, 4x5 then one AMRAP set at RPE 8
Squat / 3x5 80% / 3min      last section applies to every group
1x6 70%+, 5x5 50% 90s       per-group loads and rest
3x30s                       timed sets
1x400m @7+                  distance set, RPE logged
```

## Grammar

```ebnf
cell     = line , { "\n" , line } ;
line     = [ name , "/" ] , groups , [ "/" , mods ] ;
name     = text not starting with a digit and not containing "/" ;
groups   = group , { "," , group } ;
group    = int , "x" , target , mods ;
target   = num , [ "-" , num ] , [ tunit ] , [ "+" ] ;
tunit    = "s" | "min" | "m" | "km" ;
mods     = { ws , mod } ;
mod      = weight | percent | rpe | rest ;
weight   = num , wunit , [ "+" ] | "?+" ;
wunit    = "kg" | "lb" ;
percent  = num , "%" , [ "+" ] ;
rpe      = "@" , num , [ "+" ] ;
rest     = int , ( "s" | "min" ) ;
int      = digit , { digit } ;
num      = int , [ "." , int ] ;
```

Whitespace around `/`, `,` and between mods is free. Blank lines are ignored.
`x` is case-insensitive and `×` is accepted as an alias.

## Semantics

- **target**: the reps (or seconds, minutes, meters, kilometers) per set.
  `8-12` is a range, `min <= max`. A trailing `+` marks it as logged:
  AMRAP for reps, "as long as possible" for time and distance.
- **weight**: absolute load. `+` means the lifter confirms or edits it while
  logging. `?+` means no prescribed weight, ask for it.
- **percent**: percentage of 1RM, `0 < value <= 200`. `+` as for weight.
- **rpe**: target RPE, `1 <= value <= 10`. `+` means the lifter logs actual RPE.
- **rest**: rest after each set, stored in seconds.
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
- rest as `Nmin` when a whole number of minutes, else `Ns`
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
- Legacy target suffixes other than `s`, `min`, `m`, `km` error.

## Not in v1

Program structure (weeks, days, reuse), progression scripts, warmups,
supersets, tags and notes. Tags and notes live in their own spreadsheet
columns until a consumer needs them inline.
