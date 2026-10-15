// Conformance: every port runs test/vectors.json the same way.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { init, parse, serialize, expand } from '../lib/index.js'

/** @typedef {{in:string, week?:number, canonical?:string, errors?:number[], lines?:{name?:string, sets:object[]}[], comment?:string}} Vector */
await init()
/** @type {Vector[]} */
const vectors = JSON.parse(readFileSync(new URL('vectors.json', import.meta.url), 'utf8'))

/**
 * The vector's view of a parse: error line numbers and expanded sets per line.
 * @param {import('../lib/index.js').Parsed} p parsed cell
 * @param {number} [week] week of the block
 * @returns {{errors: number[], lines: {name?: string, sets: import('../lib/index.js').SetSpec[]}[]}} comparable view
 */
const view = (p, week) => ({
  errors: p.errors.map(e => e.line),
  lines: p.lines.map(l => ({ ...(l.name ? { name: l.name } : {}), sets: expand(l, week) })),
})

for (const v of vectors) {
  test(v.comment ?? JSON.stringify(v.in), () => {
    const p = parse(v.in)
    assert.deepEqual(view(p, v.week), { errors: v.errors ?? [], lines: v.lines ?? [] })
    const out = serialize(p)
    assert.equal(out, v.canonical ?? v.in)
    const again = parse(out)
    // Blank lines drop, so compare errors by text, not index.
    assert.deepEqual(again.errors.map(e => e.raw), p.errors.map(e => e.raw))
    assert.deepEqual(view(again, v.week).lines, view(p, v.week).lines, 'parse(serialize(x)) changed meaning')
    assert.equal(serialize(again), out, 'canonical form is not a fixed point')
  })
}

test('expand truncates fractional weeks and treats NaN as week 1', () => {
  const line = parse('3x8|6|4').lines[0]
  const mins = (/** @type {number} */ w) => expand(line, w).map(s => s.target.min)
  assert.deepEqual(mins(2.7), [6, 6, 6])
  assert.deepEqual(mins(NaN), [8, 8, 8])
})
