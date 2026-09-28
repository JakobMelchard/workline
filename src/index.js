/**
 * workline v1 reference parser. See SPEC.md.
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

const NUM = String.raw`\d+(?:\.\d+)?`
const HEAD = new RegExp(String.raw`^(\d+)\s*[x×]\s*(${NUM})(?:\s*-\s*(${NUM}))?(min|km|s|m)?(\+)?`, 'i')
const WEIGHT = new RegExp(String.raw`^(${NUM})(kg|lb)(\+)?$`, 'i')
const LEGACY_WEIGHT = new RegExp(String.raw`^@(${NUM})(kg|lb)$`, 'i')
const PERCENT = new RegExp(String.raw`^(${NUM})%(\+)?$`)
const RPE = new RegExp(String.raw`^@(${NUM})(\+)?$`)
const REST = /^(\d+)(s|min)$/i

class LineError extends Error {}

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
  const parts = raw.split('/').map(p => p.trim())
  /** @type {Line} */
  const line = { index, groups: [], defaults: {} }
  if (!/^\d/.test(parts[0])) {
    const name = parts.shift()?.replace(/\s+/g, ' ')
    if (!name) throw new LineError('empty name')
    line.name = name
  }
  if (parts.length === 0 || !parts[0]) throw new LineError('no sets')
  if (parts.length > 2) throw new LineError('too many "/" sections')
  line.groups = parts[0].split(',').map(parseGroup)
  if (parts[1] !== undefined) {
    if (!parts[1]) throw new LineError('empty defaults section')
    line.defaults = parseMods(parts[1])
  }
  return line
}

/** @param {string} s @returns {Group} */
function parseGroup(s) {
  s = s.trim()
  const m = HEAD.exec(s)
  if (!m) throw new LineError(`bad sets x target: "${s}"`)
  const rest = s.slice(m[0].length)
  // Mods must be space separated, except a legacy glued "@60kg".
  if (rest && !/^\s|^@/.test(rest)) throw new LineError(`bad target: "${s}"`)
  const sets = +m[1]
  if (sets < 1) throw new LineError('sets must be >= 1')
  /** @type {Target} */
  const target = { min: +m[2], unit: /** @type {TargetUnit} */ ((m[4] ?? 'reps').toLowerCase()) }
  if (m[3] !== undefined) {
    if (+m[3] < target.min) throw new LineError(`range ${m[2]}-${m[3]} is descending`)
    if (+m[3] !== target.min) target.max = +m[3]
  }
  if (m[5]) target.amrap = true
  return { sets, target, ...parseMods(rest) }
}

/** @param {string} s @returns {Mods} */
function parseMods(s) {
  /** @type {Mods} */
  const mods = {}
  /** @param {keyof Mods} k @param {any} v */
  const set = (k, v) => {
    const load = k === 'weight' || k === 'percent'
    if (mods[k] !== undefined || (load && (mods.weight || mods.percent))) throw new LineError(`duplicate ${load ? 'load' : k}`)
    mods[k] = v
  }
  for (const tok of s.replace(/@/g, ' @').split(/\s+/).filter(Boolean)) {
    let m
    if (tok === '?+') set('weight', { ask: true })
    else if ((m = WEIGHT.exec(tok) ?? LEGACY_WEIGHT.exec(tok))) {
      set('weight', withAsk({ value: +m[1], unit: m[2].toLowerCase() }, m[3]))
    } else if ((m = PERCENT.exec(tok))) {
      if (+m[1] <= 0 || +m[1] > 200) throw new LineError(`percent out of range: ${tok}`)
      set('percent', withAsk({ value: +m[1] }, m[2]))
    } else if ((m = RPE.exec(tok))) {
      if (+m[1] < 1 || +m[1] > 10) throw new LineError(`RPE out of range: ${tok} (weights need a unit, e.g. 60kg)`)
      set('rpe', withAsk({ value: +m[1] }, m[2]))
    } else if ((m = REST.exec(tok))) {
      set('rest', +m[1] * (m[2].toLowerCase() === 'min' ? 60 : 1))
    } else throw new LineError(`unknown token: "${tok}"`)
  }
  return mods
}

/**
 * @template {object} T
 * @param {T} o @param {string|undefined} plus @returns {T & {ask?:true}}
 */
const withAsk = (o, plus) => (plus ? { ...o, ask: true } : o)

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
