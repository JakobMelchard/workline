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
      optional(seq('/', field('defaults', $.mods))),
    ),

    name: _ => /[^\d\s/][^/\n]*/,

    group: $ => seq(field('sets', $.number), /[xX×]/, field('target', $.target), optional($.mods)),

    target: $ => seq(
      field('min', $.number),
      optional(seq('-', field('max', $.number))),
      optional(field('unit', alias(token.immediate(/min|km|s|m/i), $.unit))),
      optional(field('ask', alias(token.immediate('+'), $.ask))),
    ),

    mods: $ => repeat1(choice($.weight, $.ask_weight, $.percent, $.rpe, $.rest)),

    weight: $ => choice(
      seq(field('value', $.number), field('unit', alias(token.immediate(/kg|lb/i), $.unit)), optional(field('ask', $._ask))),
      // Legacy "@60kg" from the pre-v1 grammar.
      seq('@', field('value', $._num_imm), field('unit', alias(token.immediate(/kg|lb/i), $.unit))),
    ),

    ask_weight: _ => '?+',

    percent: $ => seq(field('value', $.number), token.immediate('%'), optional(field('ask', $._ask))),

    rpe: $ => seq('@', field('value', $._num_imm), optional(field('ask', $._ask))),

    rest: $ => seq(field('value', $.number), field('unit', alias(token.immediate(/s|min/i), $.unit))),

    _ask: $ => alias(token.immediate('+'), $.ask),

    _num_imm: $ => alias(token.immediate(NUM), $.number),

    number: _ => NUM,
  },
})

/** @param {RuleOrLiteral} rule @param {string} sep */
function sep1(rule, sep) {
  return seq(rule, repeat(seq(sep, rule)))
}
