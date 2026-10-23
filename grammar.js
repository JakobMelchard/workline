/**
 * @file workline: text notation for strength sets. See SPEC.md.
 * @license MIT
 */

/// <reference path="node_modules/tree-sitter-cli/dsl.d.ts" />
// @ts-check

const NUM = /\d+(\.\d+)?/

export default grammar({
  name: 'workline',

  // Newlines end a line, so only horizontal whitespace is free.
  extras: (_) => [/[ \t\r]/],

  rules: {
    document: ($) => seq(repeat(seq(optional($._row), '\n')), optional($._row)),

    _row: ($) => choice($.line, $.header),

    line: ($) =>
      seq(
        optional(seq(field('name', $.name), '/')),
        sep1($.group, ','),
        optional(seq('/', field('defaults', $.defaults))),
        optional(seq('=>', field('log', sep1($.number, ',')))),
      ),

    header: ($) => seq('#', field('text', $.header_text)),
    header_text: (_) => /[^\n]+/,

    name: (_) => /[^\d\s/][^/\n]*/,

    // "SETS x" may be left out for one set: "90-150'" is "1x90-150m".
    group: ($) =>
      seq(
        optional(seq(field('sets', $.number), $.times)),
        field('target', $.target),
        optional($.mods),
      ),

    times: (_) => /[xX×]/,

    // One step per week of a block, "|" separated: "8|6|4|2+" is 8 reps in
    // week 1, 6 in week 2 and so on. A single step is the same every week.
    // A trailing "+" marks the whole target, every week.
    target: ($) =>
      seq(
        sep1(field('step', $.step), '|'),
        optional(field('ask', alias(token.immediate('+'), $.ask))),
      ),

    step: ($) =>
      seq(
        field('min', $.number),
        optional(seq('-', field('max', $.number))),
        // r reps, s seconds, m minutes, km distance; min and ' also minutes,
        // '' also seconds
        optional(field('unit', alias(token.immediate(/r|s|m|min|km|'|''/i), $.unit))),
      ),

    // Each mod needs whitespace before it; only "@" forms may touch the previous
    // token ("3x8@8", legacy "3x8@60kg"). _gap_num / _gap_ask carry the gap.
    // The first mod after "/" needs none, since "/" already separates.
    mods: ($) => repeat1($._mod),

    defaults: ($) =>
      seq(
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

    _mod: ($) =>
      choice($.weight, $.ask_weight, $.percent, $.rpe, $.rest, alias($._legacy_weight, $.weight)),

    weight: ($) => weight($, $._gap_num),
    _weight_first: ($) => weight($, $.number),
    // Legacy "@60kg" from the pre-v1 grammar.
    _legacy_weight: ($) => seq('@', field('value', $._num_imm), field('unit', unit($, /kg|lb/i))),

    ask_weight: (_) => token(seq(/[ \t]+/, '?+')),

    percent: ($) => percent($, $._gap_num),
    _percent_first: ($) => percent($, $.number),

    rest: ($) => rest($, $._gap_num),
    _rest_first: ($) => rest($, $.number),

    rpe: ($) => seq('@', field('value', $._num_imm), optional(field('ask', $._ask))),

    _gap_num: ($) => alias(token(seq(/[ \t]+/, NUM)), $.number),

    _ask: ($) => alias(token.immediate('+'), $.ask),

    _num_imm: ($) => alias(token.immediate(NUM), $.number),

    number: (_) => NUM,
  },
})

/** @typedef {GrammarSymbols<string>} S */

/**
 * A unit suffix, glued to the number before it.
 * @param {S} $ grammar symbols
 * @param {RegExp} re accepted unit spellings
 * @returns {AliasRule} unit node
 */
function unit($, re) {
  return alias(token.immediate(re), $.unit)
}

/**
 * A weight, "60kg" or "60kg+".
 * @param {S} $ grammar symbols
 * @param {RuleOrLiteral} num the number rule, with or without its leading gap
 * @returns {SeqRule} weight rule
 */
function weight($, num) {
  return seq(field('value', num), field('unit', unit($, /kg|lb/i)), optional(field('ask', $._ask)))
}

/**
 * A load in percent, "75%" or "75%+".
 * @param {S} $ grammar symbols
 * @param {RuleOrLiteral} num the number rule, with or without its leading gap
 * @returns {SeqRule} percent rule
 */
function percent($, num) {
  return seq(field('value', num), token.immediate('%'), optional(field('ask', $._ask)))
}

/**
 * A rest time, "90s" or "2m".
 * @param {S} $ grammar symbols
 * @param {RuleOrLiteral} num the number rule, with or without its leading gap
 * @returns {SeqRule} rest rule
 */
function rest($, num) {
  return seq(field('value', num), field('unit', unit($, /s|m|min|'|''/i)))
}

/**
 * One or more rules, separated by sep.
 * @param {RuleOrLiteral} rule repeated rule
 * @param {string} sep separator literal
 * @returns {SeqRule} separated list
 */
function sep1(rule, sep) {
  return seq(rule, repeat(seq(sep, rule)))
}
