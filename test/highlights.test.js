// Neovim reads queries/highlights.scm; every node kind a sheet can show needs a capture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Parser, Language, Query } from 'web-tree-sitter'

test('headers and logs get highlight captures', async () => {
  await Parser.init()
  const lang = await Language.load(new URL('../workline.wasm', import.meta.url).pathname)
  const parser = new Parser()
  parser.setLanguage(lang)
  const query = new Query(
    lang,
    readFileSync(new URL('../queries/highlights.scm', import.meta.url), 'utf8'),
  )
  const tree = parser.parse('# Exercise | Plan | Log\nBench / 3x8 => 8, 8, 6\n')
  assert.ok(tree)
  const got = query.captures(tree.rootNode).map((c) => `${c.name}:${c.node.text.trim()}`)
  assert.ok(got.includes('comment:# Exercise | Plan | Log'))
  assert.ok(got.includes('operator:=>'))
  assert.equal(got.filter((c) => c === 'number:8').length, 3)
  assert.ok(got.includes('number:6'))
})
