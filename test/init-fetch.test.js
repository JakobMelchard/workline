// Browser path: a non-file URL is fetched and loaded from bytes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { init, parse, serialize } from '../lib/index.js'

test('init fetches an http language URL as bytes', async t => {
  const wasm = readFileSync(new URL('../workline.wasm', import.meta.url))
  let hits = 0
  const server = createServer((_, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'application/wasm' }).end(wasm)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(undefined)))
  t.after(() => server.close())
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  await init({ language: new URL(`http://127.0.0.1:${port}/workline.wasm`) })
  assert.equal(hits, 1)
  assert.equal(serialize(parse('1x20m @7')), '1x20m @7')
})
