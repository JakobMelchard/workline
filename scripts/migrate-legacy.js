#!/usr/bin/env node
/**
 * Convert load cells from the legacy workout grammar (JakobMelchard/workout
 * public/grammar.js) to workline. Dry run by default; see README "Legacy migration".
 *
 * Legacy line: SETSxVALUE[TYPE][@WEIGHT[UNIT]], `@` = weight, default unit kg.
 *
 * @typedef {{sets:number, value:number, type:string, weight?:number, weightUnit?:string}} LegacyEntry
 * @typedef {{line:number, from:string, to:string}} Change
 * @typedef {{line:number, raw:string, reason:string}} Manual
 * @typedef {{cell:string, changes:Change[], manual:Manual[]}} Migrated
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { init, parse, parseLine, serializeLine } from '../lib/index.js'

// Rules copied from the legacy grammar.js.
const LEFT = /^(\d+)x(\d+(?:\.\d+)?)([a-zA-Z]*)$/
const RIGHT = /^(\d+(?:\.\d+)?)([a-zA-Z]*)$/
const DEFAULT_UNIT = 'kg'

/** legacy TYPE (lowercased) -> workline target suffix */
const TYPES = /** @type {Record<string,string>} */ ({ '': '', s: 's', min: 'min', m: 'm', km: 'km' })
/** legacy weight unit (lowercased) -> workline weight unit */
const UNITS = /** @type {Record<string,string>} */ ({ '': DEFAULT_UNIT, kg: 'kg', kgs: 'kg', lb: 'lb', lbs: 'lb' })

/**
 * Parse one line with the legacy rules.
 * @param {string} raw @returns {{entry:LegacyEntry} | {error:string}}
 */
export function parseLegacyLine(raw) {
  const s = raw.trim()
  const at = s.indexOf('@')
  const l = LEFT.exec(at < 0 ? s : s.slice(0, at))
  if (!l) return { error: 'bad sets×value' }
  /** @type {LegacyEntry} */
  const entry = { sets: +l[1], value: +l[2], type: l[3] }
  if (at >= 0) {
    const r = RIGHT.exec(s.slice(at + 1))
    if (!r) return { error: 'bad weight' }
    entry.weight = +r[1]
    entry.weightUnit = r[2] || DEFAULT_UNIT
  }
  return { entry }
}

/**
 * Legacy entry -> workline line text, or the reason it cannot be converted.
 * @param {LegacyEntry} e @returns {{text:string} | {error:string}}
 */
export function convertEntry(e) {
  const type = TYPES[e.type.toLowerCase()]
  if (type === undefined) return { error: `unknown type suffix "${e.type}"` }
  let text = `${e.sets}x${e.value}${type}`
  if (e.weight !== undefined) {
    const unit = UNITS[(e.weightUnit ?? '').toLowerCase()]
    if (unit === undefined) return { error: `unknown weight unit "${e.weightUnit}"` }
    text += ` ${e.weight}${unit}`
  }
  return { text }
}

/**
 * Check a workline line means exactly the legacy entry.
 * @param {import('../lib/index.js').Line} l @param {LegacyEntry} e @returns {string | undefined} mismatch
 */
function mismatch(l, e) {
  const g = l.groups[0]
  if (l.name || l.groups.length !== 1 || Object.keys(l.defaults).length) return 'not a single group'
  const unit = TYPES[e.type.toLowerCase()] || 'reps'
  if (g.sets !== e.sets || g.target.min !== e.value || g.target.max !== undefined || g.target.unit !== unit) return 'target changed'
  if (g.percent || g.rpe || g.rest !== undefined) return 'unexpected mods'
  const w = e.weight === undefined ? undefined : { value: e.weight, unit: UNITS[(e.weightUnit ?? '').toLowerCase()] }
  if (w?.value !== g.weight?.value || w?.unit !== g.weight?.unit || g.weight?.ask) return 'weight changed'
}

/**
 * Migrate one legacy load cell. Requires `await init()` from lib/index.js first.
 * Line count and blank lines are preserved so `time` cells stay index-aligned.
 * Lines that cannot be converted are kept verbatim and listed in `manual`.
 * Lines the legacy grammar rejects but workline already reads are kept as is.
 * @param {string} oldCell @returns {Migrated}
 */
export function migrateCell(oldCell) {
  /** @type {Change[]} */
  const changes = []
  /** @type {Manual[]} */
  const manual = []
  const out = (oldCell ?? '').split('\n').map((raw, line) => {
    if (!raw.trim()) return raw
    const legacy = parseLegacyLine(raw)
    if ('error' in legacy) {
      // Not legacy; fine if it is already valid workline (e.g. migrated before).
      if (!parse(raw).errors.length) return raw
      manual.push({ line, raw, reason: `legacy: ${legacy.error}; workline: ${parse(raw).errors[0].reason}` })
      return raw
    }
    const conv = convertEntry(legacy.entry)
    if ('error' in conv) {
      manual.push({ line, raw, reason: conv.error })
      return raw
    }
    const p = parse(conv.text)
    if (p.errors.length || p.lines.length !== 1) {
      manual.push({ line, raw, reason: `workline rejects "${conv.text}": ${p.errors[0]?.reason ?? 'no line'}` })
      return raw
    }
    const to = serializeLine(p.lines[0])
    const bad = mismatch(p.lines[0], legacy.entry) ?? (serializeLine(parseLine(to)) === to ? undefined : 'canonical form unstable')
    if (bad) {
      manual.push({ line, raw, reason: `does not round-trip: ${bad}` })
      return raw
    }
    if (to !== raw) changes.push({ line, from: raw, to })
    return to
  })
  return { cell: out.join('\n'), changes, manual }
}

// ---------------------------------------------------------------- input files

/**
 * Minimal RFC 4180 CSV parser.
 * @param {string} text @returns {string[][]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = []
  /** @type {string[]} */
  let row = []
  let f = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') (f += '"'), i++
      else if (c === '"') q = false
      else f += c
    } else if (c === '"') q = true
    else if (c === ',') row.push(f), (f = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(f), rows.push(row), (row = []), (f = '')
    } else f += c
  }
  if (f || row.length) row.push(f), rows.push(row)
  return rows
}

/**
 * Cells from JSON (array of strings, array of {id?, cell|load}, or {id: cell})
 * or CSV (column `load` if the header has one, else the first column).
 * @param {string} text @returns {{id:string, cell:string}[]}
 */
export function readCells(text) {
  const t = text.trim()
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = JSON.parse(t)
    if (!Array.isArray(j)) return Object.entries(j).map(([id, cell]) => ({ id, cell: String(cell) }))
    return j.map((x, i) =>
      typeof x === 'string' ? { id: `#${i}`, cell: x } : { id: String(x.id ?? `#${i}`), cell: String(x.cell ?? x.load ?? '') })
  }
  const rows = parseCsv(text)
  const col = rows[0]?.findIndex(h => h.trim().toLowerCase() === 'load') ?? -1
  const body = col < 0 ? rows : rows.slice(1)
  const c = Math.max(col, 0)
  return body.map((r, i) => ({ id: `row ${i + (col < 0 ? 1 : 2)}`, cell: r[c] ?? '' }))
}

// ---------------------------------------------------------------- report

/**
 * @typedef {{id:string, cell:string, tab?:string, row?:number, range?:string}} Source
 * @typedef {Source & Migrated & {from:string}} Result
 */

/** @param {Result[]} results @returns {string} diff-style report */
export function report(results) {
  const out = []
  for (const r of results) {
    if (!r.changes.length && !r.manual.length) continue
    out.push(`@@ ${r.id}`)
    for (const c of r.changes) out.push(`- ${c.from}`, `+ ${c.to}`)
    for (const m of r.manual) out.push(`! L${m.line + 1} ${JSON.stringify(m.raw)}  ${m.reason}`)
  }
  const lines = results.flatMap(r => r.from.split('\n').filter(s => s.trim()))
  out.push(
    '',
    `cells ${results.length}, non-empty ${results.filter(r => r.from.trim()).length}, lines ${lines.length}`,
    `cells changed ${results.filter(r => r.changes.length).length}, lines converted ${results.reduce((a, r) => a + r.changes.length, 0)}`,
    `cells needing manual fix ${results.filter(r => r.manual.length).length}, lines ${results.reduce((a, r) => a + r.manual.length, 0)}`,
  )
  return out.join('\n')
}

// ---------------------------------------------------------------- Google Sheets

const API = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPE_RO = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const SCOPE_RW = 'https://www.googleapis.com/auth/spreadsheets'

/** @param {ArrayBuffer | Uint8Array} buf */
const b64url = buf => Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64url')

/**
 * Service-account JWT -> access token (RS256 via WebCrypto).
 * @param {string} saJson @param {string} scope @returns {Promise<string>}
 */
export async function accessToken(saJson, scope) {
  const sa = JSON.parse(saJson)
  const now = Math.floor(Date.now() / 1e3)
  const enc = (/** @type {object} */ o) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
  const der = Buffer.from(sa.private_key.replace(/-----[^-]+-----|\s/g, ''), 'base64')
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  })
  if (!res.ok) throw new Error(`token: HTTP ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

/**
 * Tiny Sheets v4 client. `write` must be true for any non-GET call.
 * @param {string} sheetId @param {string} token @param {boolean} [write]
 */
export function sheetsClient(sheetId, token, write = false) {
  /** @param {string} path @param {RequestInit} [init] */
  const call = async (path, init = {}) => {
    if ((init.method ?? 'GET') !== 'GET' && !write) throw new Error('refusing to write: client is read-only')
    const res = await fetch(`${API}/${sheetId}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    if (!res.ok) throw Object.assign(new Error(`sheets ${path.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`), { status: res.status })
    return res.json()
  }
  return {
    call,
    /** @returns {Promise<string[]>} */
    tabs: async () => (await call('?fields=sheets.properties.title')).sheets.map((/** @type {any} */ s) => s.properties.title),
    /** @param {string} tab @returns {Promise<string[][]>} */
    values: async tab => (await call(`/values/${encodeURIComponent(quote(tab))}`)).values ?? [],
  }
}

/**
 * Spreadsheet id from a bare id or a docs.google.com URL.
 * @param {string} s @returns {string}
 */
export function sheetIdOf(s) {
  const t = (s ?? '').trim()
  return /\/d\/([A-Za-z0-9_-]+)/.exec(t)?.[1] ?? t
}

/** @param {string} tab */
const quote = tab => `'${tab.replace(/'/g, "''")}'`

/** @param {number} i 0-based column @returns {string} A1 letters */
export function colName(i) {
  let s = ''
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

/**
 * Every tab's `load` column (header row 1) as sources. Tabs without one are skipped.
 * @param {ReturnType<typeof sheetsClient>} client @param {string[]} [only] tab filter
 * @returns {Promise<{sources:Source[], scanned:string[], skipped:string[]}>}
 */
export async function readSheet(client, only = []) {
  /** @type {Source[]} */
  const sources = []
  const scanned = [], skipped = []
  for (const tab of await client.tabs()) {
    if (only.length && !only.includes(tab)) continue
    const values = await client.values(tab)
    const col = (values[0] ?? []).findIndex(h => h.trim().toLowerCase() === 'load')
    if (col < 0) {
      skipped.push(tab)
      continue
    }
    scanned.push(tab)
    values.slice(1).forEach((r, i) => {
      const row = i + 2
      sources.push({ id: `${tab}!${colName(col)}${row}`, tab, row, range: `${quote(tab)}!${colName(col)}${row}`, cell: r[col] ?? '' })
    })
  }
  return { sources, scanned, skipped }
}

// ---------------------------------------------------------------- CLI

/** @param {Source[]} sources @returns {Result[]} */
const migrateAll = sources => sources.map(s => ({ ...s, from: s.cell, ...migrateCell(s.cell) }))

const USAGE = `usage: migrate-legacy.js [file.json|file.csv|-] [--sheet ID [--tab NAME]... [--write]] [--json]
  default: read cells from a file or stdin, print a diff-style report (never writes)
  --sheet  spreadsheet id or URL; read every tab's load column (read-only scope) and print report + proposed batchUpdate
  --write  apply the batch; only allowed when ID equals $GSHEET_TEST_SHEET
  --json   print one JSON object {results, updates} instead of the text report`

/** @param {string[]} argv */
async function main(argv) {
  /** @type {{sheet?:string, tabs:string[], write:boolean, json:boolean, file?:string}} */
  const o = { tabs: [], write: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sheet') o.sheet = argv[++i]
    else if (a === '--tab') o.tabs.push(argv[++i])
    else if (a === '--write') o.write = true
    else if (a === '--json') o.json = true
    else if (a === '-h' || a === '--help') return void console.log(USAGE)
    else if (!a.startsWith('--') && !o.file) o.file = a
    else throw new Error(`unknown argument ${a}\n${USAGE}`)
  }
  await init()

  if (!o.sheet) {
    if (o.write) throw new Error('--write needs --sheet')
    const text = readFileSync(o.file && o.file !== '-' ? o.file : 0, 'utf8')
    const results = migrateAll(readCells(text))
    console.log(o.json ? JSON.stringify({ results }, null, 2) : report(results))
    return
  }

  // Hard guard: the only sheet this tool may ever write is the test sheet.
  o.sheet = sheetIdOf(o.sheet)
  const test = sheetIdOf(process.env.GSHEET_TEST_SHEET ?? '')
  if (o.write && (!test || o.sheet !== test)) throw new Error('refusing --write: sheet is not $GSHEET_TEST_SHEET')
  const sa = process.env.GSHEET_SERVICE_PRINCIPAL_JSON
  if (!sa) throw new Error('GSHEET_SERVICE_PRINCIPAL_JSON is not set')

  const ro = sheetsClient(o.sheet, await accessToken(sa, SCOPE_RO))
  const { sources, scanned, skipped } = await readSheet(ro, o.tabs)
  const results = migrateAll(sources)
  const updates = {
    valueInputOption: 'RAW',
    data: results.filter(r => r.changes.length).map(r => ({ range: r.range, values: [[r.cell]] })),
  }
  if (o.json) console.log(JSON.stringify({ scanned, skipped, results, updates }, null, 2))
  else {
    console.log(`tabs scanned ${scanned.length}: ${scanned.join(', ')}`)
    if (skipped.length) console.log(`tabs skipped (no load header) ${skipped.length}: ${skipped.join(', ')}`)
    console.log(report(results))
    console.log('\nproposed values:batchUpdate body:')
    console.log(JSON.stringify(updates, null, 2))
  }
  if (!o.write) return console.error('dry run: nothing written')
  if (!updates.data.length) return console.error('nothing to write')

  const rw = sheetsClient(o.sheet, await accessToken(sa, SCOPE_RW), true)
  const res = await rw.call('/values:batchUpdate', { method: 'POST', body: JSON.stringify(updates) })
  console.error(`wrote ${res.totalUpdatedCells} cells`)
  const again = migrateAll((await readSheet(ro, o.tabs)).sources)
  const left = again.filter(r => r.changes.length).length
  console.error(left ? `verify FAILED: ${left} cells still convert` : 'verify ok: re-read converts nothing further')
  if (left) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => {
    console.error(String(e.message ?? e))
    process.exit(1)
  })
}
