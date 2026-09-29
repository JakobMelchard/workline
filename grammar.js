/**
 * @file workline: text notation for strength sets. See SPEC.md.
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const NUM = /\d+(\.\d+)?/

export default grammar({
  name: 'workline',

  // Newlines end a line, so only horizontal whitespace is free.
  extras: _ => [/[ \t\r]/],

  rules: {
    document: $ => seq(repeat(seq(optional($.line), '\n')), optional($.line)),

    line: $ => seq(
      optional(seq(field('name', $.name), '/')),
      sep1($.group, ','),
      optional(seq('/', field('defaults', $.defaults))),
    ),

    name: _ => /[^\d\s/][^/\n]*/,

    // "SETS x" may be left out for one set: "90-150'" is "1x90-150m".
    group: $ => seq(
      optional(seq(field('sets', $.number), $.times)),
      field('target', $.target),
      optional($.mods),
    ),

    times: _ => /[xX×]/,

    // One step per week of a block, "|" separated: "8|6|4|2+" is 8 reps in
    // week 1, 6 in week 2 and so on. A single step is the same every week.
    // A trailing "+" marks the whole target, every week.
    target: $ => seq(
      sep1(field('step', $.step), '|'),
      optional(field('ask', alias(token.immediate('+'), $.ask))),
    ),

    step: $ => seq(
      field('min', $.number),
      optional(seq('-', field('max', $.number))),
      // r reps, s seconds, m minutes, km distance; min and ' also minutes,
      // '' also seconds
      optional(field('unit', alias(token.immediate(/r|s|m|min|km|'|''/i), $.unit))),
    ),

    // Each mod needs whitespace before it; only "@" forms may touch the previous
    // token ("3x8@8", legacy "3x8@60kg"). _gap_num / _gap_ask carry the gap.
    // The first mod after "/" needs none, since "/" already separates.
    mods: $ => repeat1($._mod),

    defaults: $ => seq(
      choice(
        alias($._weight_first, $.weight),
        alias('?+', $.ask_weight),
        alias($._percent_first, $.percent),
        $.rpe,
        alias($._rest_first, $.rest),
        alias($._legacy_weight, $.weight),
      ),
      repeat($._mod),
    ),

    _mod: $ => choice($.weight, $.ask_weight, $.percent, $.rpe, $.rest, alias($._legacy_weight, $.weight)),

    weight: $ => weight($, $._gap_num),
    _weight_first: $ => weight($, $.number),
    // Legacy "@60kg" from the pre-v1 grammar.
    _legacy_weight: $ => seq('@', field('value', $._num_imm), field('unit', unit($, /kg|lb/i))),

    ask_weight: _ => token(seq(/[ \t]+/, '?+')),

    percent: $ => percent($, $._gap_num),
    _percent_first: $ => percent($, $.number),

    rest: $ => rest($, $._gap_num),
    _rest_first: $ => rest($, $.number),

    rpe: $ => seq('@', field('value', $._num_imm), optional(field('ask', $._ask))),

    _gap_num: $ => alias(token(seq(/[ \t]+/, NUM)), $.number),

    _ask: $ => alias(token.immediate('+'), $.ask),

    _num_imm: $ => alias(token.immediate(NUM), $.number),

    number: _ => NUM,
  },
})

/** @typedef {GrammarSymbols<string>} S */

/** @param {S} $ @param {RegExp} re */
function unit($, re) {
  return alias(token.immediate(re), $.unit)
}

/** @param {S} $ @param {RuleOrLiteral} num */
function weight($, num) {
  return seq(field('value', num), field('unit', unit($, /kg|lb/i)), optional(field('ask', $._ask)))
}

/** @param {S} $ @param {RuleOrLiteral} num */
function percent($, num) {
  return seq(field('value', num), token.immediate('%'), optional(field('ask', $._ask)))
}

/** @param {S} $ @param {RuleOrLiteral} num */
function rest($, num) {
  return seq(field('value', num), field('unit', unit($, /s|m|min|'|''/i)))
}

/** @param {RuleOrLiteral} rule @param {string} sep */
function sep1(rule, sep) {
  return seq(rule, repeat(seq(sep, rule)))
}
