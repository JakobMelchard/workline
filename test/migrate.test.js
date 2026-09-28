import { test } from 'node:test'
import assert from 'node:assert/strict'
import { init, parse } from '../lib/index.js'
import { migrateCell, parseLegacyLine, readCells, parseCsv, colName, sheetIdOf } from '../scripts/migrate-legacy.js'

await init()

/** @param {string} cell */
const lines = cell => migrateCell(cell).cell.split('\n')

test('legacy grammar rules', () => {
  assert.deepEqual(parseLegacyLine('3x8@60'), { entry: { sets: 3, value: 8, type: '', weight: 60, weightUnit: 'kg' } })
  assert.deepEqual(parseLegacyLine(' 2x30s '), { entry: { sets: 2, value: 30, type: 's' } })
  assert.deepEqual(parseLegacyLine('3x8 @60'), { error: 'bad sets×value' })
  assert.deepEqual(parseLegacyLine('3x8@'), { error: 'bad weight' })
  assert.deepEqual(parseLegacyLine('3X8'), { error: 'bad sets×value' })
})

test('unitless weight becomes kg', () => {
  const r = migrateCell('3x8@60')
  assert.equal(r.cell, '3x8 60kg')
  assert.deepEqual(r.changes, [{ line: 0, from: '3x8@60', to: '3x8 60kg' }])
  assert.deepEqual(r.manual, [])
})

test('explicit units keep their unit, lowercased, aliases folded', () => {
  assert.deepEqual(lines('3x8@60lb\n1x5@100KG\n3x8@7.5lbs\n2x5@20kgs'), ['3x8 60lb', '1x5 100kg', '3x8 7.5lb', '2x5 20kg'])
})

test('small unitless weights are still weights, not RPE', () => {
  assert.equal(migrateCell('3x8@8').cell, '3x8 8kg')
})

test('numbers are canonicalized', () => {
  assert.equal(migrateCell('1x5@62.50').cell, '1x5 62.5kg')
})

test('time and distance types carry over', () => {
  const r = migrateCell('2x30s\n1x2min\n1x400m\n1x1.5km@10')
  assert.equal(r.cell, '2x30s\n1x2min\n1x400m\n1x1.5km 10kg')
  assert.equal(r.changes.length, 1)
})

test('valid cells are unchanged', () => {
  assert.deepEqual(migrateCell('3x8\n2x30s'), { cell: '3x8\n2x30s', changes: [], manual: [] })
  assert.deepEqual(migrateCell(''), { cell: '', changes: [], manual: [] })
})

test('blank lines and line indexes are preserved', () => {
  const r = migrateCell('3x8@60\n\n3x5@70')
  assert.equal(r.cell, '3x8 60kg\n\n3x5 70kg')
  assert.deepEqual(r.changes.map(c => c.line), [0, 2])
})

test('unknown type suffix goes to manual and stays verbatim', () => {
  const r = migrateCell('3x10r@20\n3x8@60')
  assert.equal(r.cell, '3x10r@20\n3x8 60kg')
  assert.deepEqual(r.manual, [{ line: 0, raw: '3x10r@20', reason: 'unknown type suffix "r"' }])
})

test('unknown weight unit goes to manual', () => {
  const r = migrateCell('3x8@0bw')
  assert.equal(r.cell, '3x8@0bw')
  assert.equal(r.manual[0].reason, 'unknown weight unit "bw"')
})

test('lines invalid in both grammars go to manual with both reasons', () => {
  const r = migrateCell('squats\n3x8 @60')
  assert.equal(r.cell, 'squats\n3x8 @60')
  assert.equal(r.manual.length, 2)
  assert.match(r.manual[0].reason, /^legacy: bad sets×value; workline: /)
  assert.match(r.manual[1].reason, /RPE out of range/)
})

test('lines already in workline form are kept, so migration is idempotent', () => {
  const once = migrateCell('3x8@60\n2x30s\n3x60s@12')
  const twice = migrateCell(once.cell)
  assert.equal(twice.cell, once.cell)
  assert.deepEqual(twice.changes, [])
  assert.deepEqual(twice.manual, [])
  assert.deepEqual(migrateCell('Bench / 3x8 @8').changes, [])
})

test('every converted cell parses cleanly in workline', () => {
  const { cell } = migrateCell('3x8@60\n3x8@60lb\n2x30s\n5x5@102.5\n1x1km@0')
  assert.deepEqual(parse(cell).errors, [])
})

test('readCells: json shapes and csv', () => {
  assert.deepEqual(readCells('["a","b"]'), [{ id: '#0', cell: 'a' }, { id: '#1', cell: 'b' }])
  assert.deepEqual(readCells('[{"id":"x","load":"3x8"}]'), [{ id: 'x', cell: '3x8' }])
  assert.deepEqual(readCells('{"k":"3x8"}'), [{ id: 'k', cell: '3x8' }])
  assert.deepEqual(readCells('workout,load\nbench,"3x8@60\n3x5@70"\nrow,2x30s\n'), [
    { id: 'row 2', cell: '3x8@60\n3x5@70' },
    { id: 'row 3', cell: '2x30s' },
  ])
  assert.deepEqual(parseCsv('a,"b ""q"""\r\n'), [['a', 'b "q"']])
})

test('colName', () => {
  assert.deepEqual([0, 1, 25, 26, 27].map(colName), ['A', 'B', 'Z', 'AA', 'AB'])
})

test('sheetIdOf accepts ids and URLs', () => {
  assert.equal(sheetIdOf('abc_D-1'), 'abc_D-1')
  assert.equal(sheetIdOf(' https://docs.google.com/spreadsheets/d/abc_D-1/edit#gid=0 '), 'abc_D-1')
})
