/**
 * workline v1: tree-sitter syntax (grammar.js) plus semantics. See SPEC.md.
 * @typedef {'reps'|'s'|'min'|'m'|'km'} TargetUnit
 * @typedef {{min:number, max?:number, unit:TargetUnit, amrap?:true}} Target
 * @typedef {{value?:number, unit?:'kg'|'lb', ask?:true}} Weight
 * @typedef {{value:number, ask?:true}} Scalar
 * @typedef {{weight?:Weight, percent?:Scalar, rpe?:Scalar, rest?:number}} Mods  rest in seconds
 * @typedef {Mods & {sets:number, target:Target}} Group
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
 * Defaults work in Node and browsers. In Workers, import both .wasm files as
 * modules and pass `language` plus `runtime.instantiateWasm`.
 * @param {{language?: string | URL | Uint8Array | WebAssembly.Module, runtime?: object}} [opts]
 */
export async function init(opts = {}) {
  if (parser) return
  await Parser.init(opts.runtime)
  let l = opts.language ?? new URL('../workline.wasm', import.meta.url)
  // Language.load reads paths with fs in Node but fetches URLs, and Node fetch has no file:.
  if (l instanceof URL && l.protocol === 'file:') l = decodeURIComponent(l.pathname)
  const language = l instanceof WebAssembly.Module ? Language.loadSync(l) : await Language.load(l)
  parser = new Parser()
  parser.setLanguage(language)
}

/** @param {string} cell @returns {Parsed} */
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

/** @param {string} raw @param {number} [index] @returns {Line} */
export function parseLine(raw, index = 0) {
  if (!parser) throw new Error('workline: await init() first')
  const tree = parser.parse(raw.replace(/\n/g, ' '))
  if (!tree) throw new Error('workline: parse aborted')
  try {
    const root = tree.rootNode
    if (root.hasError) throw new LineError(syntaxError(root))
    const node = root.namedChildren.find(n => n?.type === 'line')
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

/** @param {Node} root */
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

/** @param {Node} g @returns {Group} */
function parseGroup(g) {
  const sets = num(field(g, 'sets'))
  if (!Number.isInteger(sets) || sets < 1) throw new LineError(`sets must be a whole number >= 1: ${sets}`)
  const t = field(g, 'target')
  /** @type {Target} */
  const target = { min: num(field(t, 'min')), unit: /** @type {TargetUnit} */ (t.childForFieldName('unit')?.text.toLowerCase() ?? 'reps') }
  const max = t.childForFieldName('max')
  if (max) {
    if (num(max) < target.min) throw new LineError(`range ${target.min}-${num(max)} is descending`)
    if (num(max) !== target.min) target.max = num(max)
  }
  if (t.childForFieldName('ask')) target.amrap = true
  const m = kids(g, 'mods')[0]
  return { sets, target, ...(m ? parseMods(m) : {}) }
}

/** @param {Node} node @returns {Mods} */
function parseMods(node) {
  /** @type {Mods} */
  const mods = {}
  /** @param {keyof Mods} k @param {any} v */
  const set = (k, v) => {
    const load = k === 'weight' || k === 'percent'
    if (mods[k] !== undefined || (load && (mods.weight || mods.percent))) throw new LineError(`duplicate ${load ? 'load' : k}`)
    mods[k] = v
  }
  for (const m of node.namedChildren) {
    if (!m) continue
    const value = m.type === 'ask_weight' ? 0 : num(field(m, 'value'))
    const ask = m.childForFieldName('ask') ? { ask: true } : {}
    switch (m.type) {
      case 'ask_weight':
        set('weight', { ask: true })
        break
      case 'weight':
        set('weight', { value, unit: field(m, 'unit').text.toLowerCase(), ...ask })
        break
      case 'percent':
        if (value <= 0 || value > 200) throw new LineError(`percent out of range: ${m.text}`)
        set('percent', { value, ...ask })
        break
      case 'rpe':
        if (value < 1 || value > 10) throw new LineError(`RPE out of range: ${m.text} (weights need a unit, e.g. 60kg)`)
        set('rpe', { value, ...ask })
        break
      case 'rest':
        if (!Number.isInteger(value)) throw new LineError(`rest must be whole: ${m.text}`)
        set('rest', value * (field(m, 'unit').text.toLowerCase() === 'min' ? 60 : 1))
        break
    }
  }
  return mods
}

/** @typedef {import('web-tree-sitter').Node} Node */

/** @param {Node} n @param {string} type @returns {Node[]} */
const kids = (n, type) => /** @type {Node[]} */ (n.namedChildren.filter(c => c?.type === type))

/** @param {Node} n @param {string} name @returns {Node} */
function field(n, name) {
  const f = n.childForFieldName(name)
  if (!f) throw new LineError(`missing ${name}`)
  return f
}

/** @param {Node} n */
const num = n => Number(n.text)

/** @param {Line} line @returns {SetSpec[]} */
export function expand(line) {
  const d = line.defaults
  return line.groups.flatMap(({ sets, ...g }) => {
    /** @type {SetSpec} */
    const s = { target: g.target }
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

/** @param {Parsed} parsed @returns {string} canonical cell; error lines kept verbatim */
export function serialize(parsed) {
  /** @type {[number, string][]} */
  const rows = [
    ...parsed.lines.map(l => /** @type {[number, string]} */ ([l.index, serializeLine(l)])),
    ...parsed.errors.map(e => /** @type {[number, string]} */ ([e.line, e.raw])),
  ]
  return rows.sort((a, b) => a[0] - b[0]).map(r => r[1]).join('\n')
}

/** @param {Line} line @returns {string} */
export function serializeLine(line) {
  const groups = line.groups.map(g => {
    const t = g.target
    const unit = t.unit === 'reps' ? '' : t.unit
    const head = `${g.sets}x${n(t.min)}${t.max !== undefined ? `-${n(t.max)}` : ''}${unit}${t.amrap ? '+' : ''}`
    return [head, ...mods(g)].join(' ')
  })
  const d = mods(line.defaults)
  return `${line.name ? `${line.name} / ` : ''}${groups.join(', ')}${d.length ? ` / ${d.join(' ')}` : ''}`
}

/** @param {Mods} m @returns {string[]} */
function mods(m) {
  const out = []
  const plus = (/** @type {{ask?:true}} */ x) => (x.ask ? '+' : '')
  if (m.weight) out.push(m.weight.value === undefined ? '?+' : `${n(m.weight.value)}${m.weight.unit}${plus(m.weight)}`)
  if (m.percent) out.push(`${n(m.percent.value)}%${plus(m.percent)}`)
  if (m.rpe) out.push(`@${n(m.rpe.value)}${plus(m.rpe)}`)
  if (m.rest !== undefined) out.push(m.rest % 60 === 0 && m.rest > 0 ? `${m.rest / 60}min` : `${m.rest}s`)
  return out
}

/** @param {number} x */
const n = x => String(x)
