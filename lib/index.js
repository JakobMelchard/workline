/**
 * workline v1: tree-sitter syntax (grammar.js) plus semantics. See SPEC.md.
 * @typedef {'reps'|'s'|'min'|'km'} TargetUnit
 * @typedef {{min:number, max?:number, unit:TargetUnit, amrap?:true}} Target
 * @typedef {{value?:number, unit?:'kg'|'lb', ask?:true}} Weight
 * @typedef {{value:number, ask?:true}} Scalar
 * @typedef {{weight?:Weight, percent?:Scalar, rpe?:Scalar, rest?:number}} Mods  rest in seconds
 * @typedef {Mods & {sets:number, target:Target, weeks?:Target[]}} Group  weeks: one target per week of a block ("8|6|4"), target is weeks[0]
 * @typedef {{index:number, name?:string, groups:Group[], defaults:Mods}} Line
 * @typedef {Mods & {target:Target}} SetSpec  one expanded set, defaults applied
 * @typedef {{line:number, raw:string, reason:string}} ParseError
 * @typedef {{lines:Line[], errors:ParseError[]}} Parsed
 */

import { Parser, Language } from 'web-tree-sitter'

class LineError extends Error {}

/** @type {Parser | undefined} */
let parser

/**
 * Load the tree-sitter runtime and grammar once, before any parse.
 *
 * With no options it loads both .wasm files shipped next to this module:
 * from disk in Node, fetched as bytes in browsers and WebViews. Where wasm
 * cannot be fetched or compiled at runtime (Workers), import
 * `@jakobmelchard/workline/web-tree-sitter.wasm` and
 * `@jakobmelchard/workline/workline.wasm` as WebAssembly.Module and pass them
 * as `runtime` and `language`.
 * @param {{language?: string | URL | Uint8Array | WebAssembly.Module, runtime?: WebAssembly.Module | object}} [opts]
 *   `runtime` is a compiled runtime module or raw Emscripten module options.
 * @returns {Promise<void>} resolves once parse can run
 */
export async function init(opts = {}) {
  if (parser) return
  await Parser.init(
    opts.runtime instanceof WebAssembly.Module ? precompiled(opts.runtime) : opts.runtime,
  )
  const l = opts.language ?? new URL('../workline.wasm', import.meta.url)
  const language =
    l instanceof WebAssembly.Module ? Language.loadSync(l) : await Language.load(await source(l))
  parser = new Parser()
  parser.setLanguage(language)
}

/**
 * Emscripten options that instantiate an already compiled runtime.
 * @param {WebAssembly.Module} mod compiled web-tree-sitter runtime
 * @returns {object} Emscripten module options
 */
const precompiled = (mod) => ({
  /**
   * @param {WebAssembly.Imports} imports runtime imports
   * @param {(i: WebAssembly.Instance, m: WebAssembly.Module) => void} done receives the instance
   * @returns {WebAssembly.Exports} instance exports
   */
  instantiateWasm(imports, done) {
    const i = new WebAssembly.Instance(mod, imports)
    done(i, mod)
    return i.exports
  },
})

/**
 * Turn a URL into something Language.load instantiates asynchronously: a path
 * for file: URLs (Node fetch has no file:), bytes otherwise. Given a URL,
 * web-tree-sitter instantiates synchronously, which Android WebView refuses
 * on the main thread for modules over 4 KB.
 * @param {string | URL | Uint8Array} l wasm location or bytes
 * @returns {Promise<string | Uint8Array>} path or bytes
 */
async function source(l) {
  if (!(l instanceof URL)) return l
  if (l.protocol === 'file:') return decodeURIComponent(l.pathname)
  const res = await fetch(l)
  if (!res.ok) throw new Error(`workline: fetching ${l} failed: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Parse a cell, one line per set line; blank lines are skipped.
 * @param {string} cell cell text
 * @returns {Parsed} lines and per-line errors
 */
export function parse(cell) {
  /** @type {Parsed} */
  const out = { lines: [], errors: [] }
  ;(cell ?? '').split('\n').forEach((raw, index) => {
    if (!raw.trim()) return
    try {
      out.lines.push(parseLine(raw, index))
    } catch (e) {
      if (!(e instanceof LineError)) throw e
      out.errors.push({ line: index, raw, reason: e.message })
    }
  })
  return out
}

/**
 * Parse one line; throws on a syntax or range error.
 * @param {string} raw line text
 * @param {number} [index] line number within its cell
 * @returns {Line} parsed line
 */
export function parseLine(raw, index = 0) {
  if (!parser) throw new Error('workline: await init() first')
  // The generated lexer rejects a space or tab after the last token; trailing whitespace is free.
  const tree = parser.parse(raw.replace(/\n/g, ' ').replace(/[ \t\r]+$/, ''))
  if (!tree) throw new Error('workline: parse aborted')
  try {
    const root = tree.rootNode
    if (root.hasError) throw new LineError(syntaxError(root))
    const node = root.namedChildren.find((n) => n?.type === 'line')
    if (!node) throw new LineError('no sets')
    /** @type {Line} */
    const line = { index, groups: [], defaults: {} }
    const name = node.childForFieldName('name')
    if (name) line.name = name.text.trim().replace(/\s+/g, ' ')
    line.groups = kids(node, 'group').map(parseGroup)
    const d = node.childForFieldName('defaults')
    if (d) line.defaults = parseMods(d)
    return line
  } finally {
    tree.delete()
  }
}

/**
 * Describe the first error or missing node under root.
 * @param {Node} root tree root with hasError
 * @returns {string} error reason
 */
function syntaxError(root) {
  const cursor = root.walk()
  try {
    for (;;) {
      const n = cursor.currentNode
      if (n.isMissing) return `missing ${n.type} at column ${n.startIndex}`
      if (n.isError) return `unexpected "${n.text}" at column ${n.startIndex}`
      if (cursor.gotoFirstChild() || cursor.gotoNextSibling()) continue
      while (cursor.gotoParent()) if (cursor.gotoNextSibling()) break
      if (cursor.currentNode.equals(root)) return 'syntax error'
    }
  } finally {
    cursor.delete()
  }
}

const MAX_SETS = 1000
const MAX_REST = 86400 // seconds

/**
 * @param {Node} g group node
 * @returns {Group} parsed group
 */
function parseGroup(g) {
  const s = g.childForFieldName('sets')
  const sets = s ? num(s) : 1
  if (!Number.isInteger(sets) || sets < 1 || sets > MAX_SETS)
    throw new LineError(`sets must be a whole number from 1 to ${MAX_SETS}: ${sets}`)
  const t = field(g, 'target')
  const amrap = !!t.childForFieldName('ask')
  const steps = t.childrenForFieldName('step').filter((n) => n !== null)
  // A step without a unit takes the unit the other steps name; they must agree.
  const named = new Set(
    steps.flatMap((st) => {
      const u = st.childForFieldName('unit')
      return u ? [TARGET_UNITS[u.text.toLowerCase()]] : []
    }),
  )
  if (named.size > 1) throw new LineError(`week steps mix units: ${[...named].join(', ')}`)
  const unit = named.size ? [...named][0] : 'reps'
  const weeks = steps.map((st) => parseStep(st, unit, amrap))
  const m = kids(g, 'mods')[0]
  return {
    sets,
    target: weeks[0],
    ...(weeks.length > 1 ? { weeks } : {}),
    ...(m ? parseMods(m) : {}),
  }
}

/**
 * @param {Node} t step node
 * @param {TargetUnit} unit unit of the step's group
 * @param {boolean} amrap the target ends in "+"
 * @returns {Target} parsed step
 */
function parseStep(t, unit, amrap) {
  /** @type {Target} */
  const target = { min: num(field(t, 'min')), unit }
  const max = t.childForFieldName('max')
  if (max) {
    if (num(max) < target.min) throw new LineError(`range ${target.min}-${num(max)} is descending`)
    if (num(max) !== target.min) target.max = num(max)
  }
  if (amrap) target.amrap = true
  return target
}

/**
 * @param {Node} node mods or defaults node
 * @returns {Mods} parsed mods
 */
function parseMods(node) {
  /** @type {Mods} */
  const mods = {}
  /**
   * @template {keyof Mods} K
   * @param {K} k mod name
   * @param {Mods[K]} v mod value
   */
  const set = (k, v) => {
    const load = k === 'weight' || k === 'percent'
    if (mods[k] !== undefined || (load && (mods.weight || mods.percent)))
      throw new LineError(`duplicate ${load ? 'load' : k}`)
    mods[k] = v
  }
  for (const m of node.namedChildren) {
    if (!m) continue
    const value = m.type === 'ask_weight' ? 0 : num(field(m, 'value'))
    const ask = m.childForFieldName('ask') ? { ask: /** @type {const} */ (true) } : {}
    switch (m.type) {
      case 'ask_weight':
        set('weight', { ask: true })
        break
      case 'weight':
        // The grammar only accepts kg and lb, in any case.
        set('weight', {
          value,
          unit: /** @type {'kg'|'lb'} */ (field(m, 'unit').text.toLowerCase()),
          ...ask,
        })
        break
      case 'percent':
        if (value <= 0 || value > 200) throw new LineError(`percent out of range: ${m.text}`)
        set('percent', { value, ...ask })
        break
      case 'rpe':
        if (value < 1 || value > 10)
          throw new LineError(`RPE out of range: ${m.text} (weights need a unit, e.g. 60kg)`)
        set('rpe', { value, ...ask })
        break
      case 'rest': {
        if (!Number.isInteger(value)) throw new LineError(`rest must be whole: ${m.text}`)
        const secs = value * (TARGET_UNITS[field(m, 'unit').text.toLowerCase()] === 's' ? 1 : 60)
        if (secs > MAX_REST) throw new LineError(`rest must be at most ${MAX_REST}s: ${m.text}`)
        set('rest', secs)
        break
      }
    }
  }
  return mods
}

/** @typedef {import('web-tree-sitter').Node} Node */

/** @type {Record<string, TargetUnit>} */
const TARGET_UNITS = { r: 'reps', s: 's', m: 'min', min: 'min', km: 'km', "'": 'min', "''": 's' }

/**
 * @param {Node} n parent node
 * @param {string} type child type
 * @returns {Node[]} named children of that type
 */
const kids = (n, type) => /** @type {Node[]} */ (n.namedChildren.filter((c) => c?.type === type))

/**
 * @param {Node} n parent node
 * @param {string} name field name
 * @returns {Node} the field's node; throws when missing
 */
function field(n, name) {
  const f = n.childForFieldName(name)
  if (!f) throw new LineError(`missing ${name}`)
  return f
}

/**
 * @param {Node} n number node
 * @returns {number} its value
 */
const num = (n) => Number(n.text)

/**
 * One SetSpec per set, defaults applied. week (1-based) picks each group's
 * target from its week steps; past the last step the last one repeats.
 * @param {Line} line parsed line
 * @param {number} [week] week of the block, 1-based
 * @returns {SetSpec[]} one spec per set
 */
export function expand(line, week = 1) {
  const d = line.defaults
  return line.groups.flatMap(({ sets, weeks, ...g }) => {
    /** @type {SetSpec} */
    const s = {
      target: weeks
        ? weeks[Math.min(Math.max(Math.trunc(week) || 1, 1), weeks.length) - 1]
        : g.target,
    }
    const weight = g.weight ?? (g.percent ? undefined : d.weight)
    const percent = g.percent ?? (g.weight ? undefined : d.percent)
    if (weight) s.weight = weight
    if (percent) s.percent = percent
    const rpe = g.rpe ?? d.rpe
    if (rpe) s.rpe = rpe
    const rest = g.rest ?? d.rest
    if (rest !== undefined) s.rest = rest
    return Array.from({ length: sets }, () => structuredClone(s))
  })
}

/**
 * @param {Parsed} parsed parsed cell
 * @returns {string} canonical cell; error lines kept verbatim
 */
export function serialize(parsed) {
  /** @type {[number, string][]} */
  const rows = [
    ...parsed.lines.map((l) => /** @type {[number, string]} */ ([l.index, serializeLine(l)])),
    ...parsed.errors.map((e) => /** @type {[number, string]} */ ([e.line, e.raw])),
  ]
  return rows
    .sort((a, b) => a[0] - b[0])
    .map((r) => r[1])
    .join('\n')
}

/**
 * @param {Line} line parsed line
 * @returns {string} canonical line
 */
export function serializeLine(line) {
  const groups = line.groups.map((g) => {
    const head = `${g.sets}x${(g.weeks ?? [g.target]).map(step).join('|')}${g.target.amrap ? '+' : ''}`
    return [head, ...mods(g)].join(' ')
  })
  const d = mods(line.defaults)
  return `${line.name ? `${line.name} / ` : ''}${groups.join(', ')}${d.length ? ` / ${d.join(' ')}` : ''}`
}

/**
 * @param {Target} t target step
 * @returns {string} canonical step without its "+", e.g. "8-12", "30s", "20m"
 */
function step(t) {
  const unit = { reps: '', s: 's', min: 'm', km: 'km' }[t.unit]
  return `${t.min}${t.max !== undefined ? `-${t.max}` : ''}${unit}`
}

/**
 * @param {Mods} m mods
 * @returns {string[]} canonical mod tokens
 */
function mods(m) {
  const out = []
  const plus = (/** @type {{ask?:true}} */ x) => (x.ask ? '+' : '')
  if (m.weight)
    out.push(
      m.weight.value === undefined ? '?+' : `${m.weight.value}${m.weight.unit}${plus(m.weight)}`,
    )
  if (m.percent) out.push(`${m.percent.value}%${plus(m.percent)}`)
  if (m.rpe) out.push(`@${m.rpe.value}${plus(m.rpe)}`)
  if (m.rest !== undefined)
    out.push(m.rest % 60 === 0 && m.rest > 0 ? `${m.rest / 60}m` : `${m.rest}s`)
  return out
}
