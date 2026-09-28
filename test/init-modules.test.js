// Workers path: both wasm files arrive precompiled, nothing is fetched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { init, parse, serialize } from '../lib/index.js'

test('init from precompiled runtime and language modules', async () => {
  const mod = (/** @type {string} */ f) => new WebAssembly.Module(readFileSync(new URL(`../${f}`, import.meta.url)))
  await init({ runtime: mod('web-tree-sitter.wasm'), language: mod('workline.wasm') })
  assert.equal(serialize(parse('3x5 100kg 2min')), '3x5 100kg 2m')
})
