import type { NFA, MatchResult, MatchStep, ASTNode } from '../types'

/**
 * 统一的正则分析接口层。
 *
 * 结果面板与步骤列表页都通过本模块读取同一份结果（同一缓存对象引用），
 * 保证回溯计数、步骤列表与画布高亮始终同步，且重复读取时性能统计稳定。
 */

// ---------------------------------------------------------------------------
// NFA 构建
// ---------------------------------------------------------------------------

interface StateNode {
  id: number
  isAccept: boolean
  transitions: Map<string, number[]>
  epsilonTransitions: number[]
}

function buildNFA(pattern: string): { states: StateNode[]; startState: number; acceptStates: number[]; classMatchers: Map<string, (ch: string) => boolean> } {
  const states: StateNode[] = []
  // 字符类匹配函数以符号为键存放，保证片段克隆后 __class_* 转移仍能匹配。
  const classMatchers = new Map<string, (ch: string) => boolean>()
  let stateCounter = 0
  let pos = 0
  let groupCount = 0

  function newState(): number {
    const id = stateCounter++
    states.push({ id, isAccept: false, transitions: new Map(), epsilonTransitions: [] })
    return id
  }

  function addTransition(from: number, symbol: string, to: number) {
    if (!states[from].transitions.has(symbol)) {
      states[from].transitions.set(symbol, [])
    }
    states[from].transitions.get(symbol)!.push(to)
  }

  function addEpsilon(from: number, to: number) {
    states[from].epsilonTransitions.push(to)
  }

  function parseCharClass(): (ch: string) => boolean {
    const negative = pattern[pos] === '^'
    if (negative) pos++
    const ranges: [string, string][] = []
    const chars: string[] = []
    while (pos < pattern.length && pattern[pos] !== ']') {
      if (pattern[pos + 1] === '-' && pattern[pos + 2] && pattern[pos + 2] !== ']') {
        ranges.push([pattern[pos], pattern[pos + 2]])
        pos += 3
      } else {
        chars.push(pattern[pos])
        pos++
      }
    }
    pos++ // skip ]
    return (ch: string) => {
      if (negative) {
        return !chars.includes(ch) && !ranges.some(([s, e]) => ch >= s && ch <= e)
      }
      return chars.includes(ch) || ranges.some(([s, e]) => ch >= s && ch <= e)
    }
  }

  function parseConcat(): [number, number] {
    let start = newState()
    let end = start
    while (pos < pattern.length && !['|', ')'].includes(pattern[pos])) {
      let segStart: number, segEnd: number
      const ch = pattern[pos]
      if (ch === '(') {
        pos++
        groupCount++
        if (pattern[pos] === '?') {
          pos++
          if (pattern[pos] === ':') { pos++; }
          const [s, e] = parseOr()
          segStart = s; segEnd = e
        } else {
          const [s, e] = parseOr()
          segStart = s; segEnd = e
        }
        pos++ // skip )
      } else if (ch === '[') {
        pos++
        segStart = newState()
        segEnd = newState()
        const classSymbol = '__class_' + classMatchers.size
        const matcher = parseCharClass()
        classMatchers.set(classSymbol, matcher)
        addTransition(segStart, classSymbol, segEnd)
      } else if (ch === '.') {
        segStart = newState()
        segEnd = newState()
        addTransition(segStart, '__dot', segEnd)
        pos++
      } else if (ch === '\\') {
        pos++
        const escaped = pattern[pos]
        segStart = newState()
        segEnd = newState()
        if (escaped === 'd') addTransition(segStart, '__digit', segEnd)
        else if (escaped === 'w') addTransition(segStart, '__word', segEnd)
        else if (escaped === 's') addTransition(segStart, '__space', segEnd)
        else addTransition(segStart, escaped, segEnd)
        pos++
      } else if (ch === '^' || ch === '$') {
        segStart = newState()
        segEnd = segStart
        pos++
      } else {
        segStart = newState()
        segEnd = newState()
        addTransition(segStart, ch, segEnd)
        pos++
      }

      // Handle quantifiers
      while (pos < pattern.length && ['*', '+', '?', '{'].includes(pattern[pos])) {
        const q = pattern[pos]
        let min = 0
        let max = Infinity
        if (q === '{') {
          const close = pattern.indexOf('}', pos)
          const inner = pattern.slice(pos + 1, close)
          const comma = inner.indexOf(',')
          if (comma === -1) {
            min = max = parseInt(inner, 10)
          } else {
            min = inner.slice(0, comma) === '' ? 0 : parseInt(inner.slice(0, comma), 10)
            max = inner.slice(comma + 1) === '' ? Infinity : parseInt(inner.slice(comma + 1), 10)
          }
          pos = close + 1
        } else {
          pos++
          if (q === '*') { min = 0; max = Infinity }
          else if (q === '+') { min = 1; max = Infinity }
          else { min = 0; max = 1 } // '?'
        }
        const lazy = pattern[pos] === '?'
        if (lazy) pos++

        // {min,max} 通用构造：min 个必选副本 + (max-min) 个可选副本，
        // 每个副本独立克隆状态以精确表达次数（修复 {n,m} 被错误当作 '?' 的问题）。
        const [ns, ne] = wrapRepeat(segStart, segEnd, min, max, lazy)
        segStart = ns; segEnd = ne
      }

      if (end !== segStart) addEpsilon(end, segStart)
      end = segEnd
    }
    return [start, end]
  }

  /**
   * 把已有片段 [start, end] 包裹为 {min,max} 重复。
   * 必选副本逐个串联；可选副本在每个入口处用 ε 分支跳过。
   * 惰性量词把“跳过”分支排在前面（子集匹配下贪婪/惰性结果集合一致）。
   */
  function wrapRepeat(start: number, end: number, min: number, max: number, lazy: boolean): [number, number] {
    const copies: Array<[number, number]> = []
    if (max === Infinity) {
      // 无限重复至少需要一个可复用副本；min 为 0 时额外克隆一个用于回环。
      copies.push([start, end])
      for (let i = 1; i < min; i++) copies.push(cloneSegment(start, end))
    } else {
      for (let i = 0; i < max; i++) {
        copies.push(i === 0 && min > 0 ? [start, end] : cloneSegment(start, end))
      }
    }

    const entry = newState()
    let cursor = entry
    for (let i = 0; i < copies.length; i++) {
      const [cs, ce] = copies[i]
      if (i >= min) {
        const skip = newState()
        if (lazy) { addEpsilon(cursor, skip); addEpsilon(cursor, cs) }
        else { addEpsilon(cursor, cs); addEpsilon(cursor, skip) }
        cursor = skip
        addEpsilon(ce, cursor) // 实际进入该副本后汇合到跳过点
      } else {
        addEpsilon(cursor, cs)
        cursor = ce
      }
    }

    if (max === Infinity) {
      // 在最后一个必选副本之后接回环：可继续进入原片段，也可结束。
      const loop = newState()
      addEpsilon(cursor, loop)
      const tail = newState()
      if (lazy) { addEpsilon(loop, tail); addEpsilon(loop, start) }
      else { addEpsilon(loop, start); addEpsilon(loop, tail) }
      addEpsilon(end, loop)
      return [entry, tail]
    }

    return [entry, cursor]
  }

  /** 深拷贝一段 NFA 片段，返回复制后的 [起点, 终点]。 */
  function cloneSegment(srcStart: number, srcEnd: number): [number, number] {
    const mapping = new Map<number, number>()
    const stack = [srcStart]
    const visited = new Set<number>()
    while (stack.length) {
      const id = stack.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      mapping.set(id, newState())
      const node = states[id]
      node.epsilonTransitions.forEach(t => stack.push(t))
      node.transitions.forEach(targets => targets.forEach(t => stack.push(t)))
    }
    visited.forEach(id => {
      const node = states[id]
      const copyId = mapping.get(id)!
      node.epsilonTransitions.forEach(t => addEpsilon(copyId, mapping.get(t)!))
      node.transitions.forEach((targets, symbol) => {
        targets.forEach(t => addTransition(copyId, symbol, mapping.get(t)!))
      })
    })
    return [mapping.get(srcStart)!, mapping.get(srcEnd)!]
  }

  function parseOr(): [number, number] {
    const [s1, e1] = parseConcat()
    let start = s1, end = e1
    while (pos < pattern.length && pattern[pos] === '|') {
      pos++
      const [s2, e2] = parseConcat()
      const ns = newState(), ne = newState()
      addEpsilon(ns, start); addEpsilon(ns, s2)
      addEpsilon(end, ne); addEpsilon(e2, ne)
      start = ns; end = ne
    }
    return [start, end]
  }

  const [startState, acceptState] = parseOr()
  states[acceptState].isAccept = true
  return { states, startState, acceptStates: [acceptState], classMatchers }
}

function epsilonClosure(states: StateNode[], stateId: number): Set<number> {
  const closure = new Set<number>([stateId])
  const stack = [stateId]
  while (stack.length) {
    const s = stack.pop()!
    for (const next of states[s].epsilonTransitions) {
      if (!closure.has(next)) {
        closure.add(next)
        stack.push(next)
      }
    }
  }
  return closure
}

function matchTransition(state: StateNode, symbol: string, classMatchers: Map<string, (ch: string) => boolean>): number[] {
  const results: number[] = []
  for (const [sym, targets] of state.transitions) {
    if (sym === symbol) { results.push(...targets); continue }
    if (sym === '__dot' && symbol !== '\n') { results.push(...targets); continue }
    if (sym === '__digit' && /\d/.test(symbol)) { results.push(...targets); continue }
    if (sym === '__word' && /\w/.test(symbol)) { results.push(...targets); continue }
    if (sym === '__space' && /\s/.test(symbol)) { results.push(...targets); continue }
    if (sym.startsWith('__class_')) {
      const matcher = classMatchers.get(sym)
      if (matcher && matcher(symbol)) results.push(...targets)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// 匹配执行
// ---------------------------------------------------------------------------

interface Attempt {
  steps: MatchStep[]
  matched: boolean
  matchEnd: number
  startPos: number
}

/**
 * 从单个起点执行一次匹配尝试。
 *
 * 不变量：一次尝试中失败最多记录一次 —— 无论是字符耗尽前走入死路，
 * 还是消费完所有字符后仍未到达接受状态，都恰好写入一条 FAIL 步骤，
 * 且 backtracks 与 isBacktrack 步骤严格一一对应。
 */
function runAttempt(states: StateNode[], startState: number, input: string, startPos: number, classMatchers: Map<string, (ch: string) => boolean>): Attempt {
  const steps: MatchStep[] = []
  let currentStates = Array.from(epsilonClosure(states, startState))
  let matched = false
  let matchEnd = startPos
  let failRecorded = false

  const recordFail = (charIndex: number, char: string) => {
    if (failRecorded) return
    failRecorded = true
    steps.push({
      stepIndex: steps.length,
      charIndex,
      char,
      currentState: currentStates[0] ?? -1,
      nextState: -1,
      transition: 'FAIL',
      isBacktrack: true,
      isMatch: false
    })
  }

  for (let i = startPos; i < input.length; i++) {
    const char = input[i]
    const nextStates: number[] = []
    const seen = new Set<number>()

    for (const s of currentStates) {
      const targets = matchTransition(states[s], char, classMatchers)
      for (const t of targets) {
        const closure = epsilonClosure(states, t)
        for (const c of closure) {
          if (!seen.has(c)) {
            seen.add(c)
            nextStates.push(c)
            steps.push({
              stepIndex: steps.length,
              charIndex: i,
              char,
              currentState: s,
              nextState: c,
              transition: char,
              isBacktrack: false,
              isMatch: true
            })
          }
        }
      }
    }

    if (nextStates.length === 0) {
      // 已命中接受状态：当前前缀即匹配结果，不算失败。
      if (currentStates.some(s => states[s].isAccept)) {
        matched = true
        matchEnd = i
        return { steps, matched, matchEnd, startPos }
      }
      // 走入死路：记录一次失败并终止本次尝试。
      recordFail(i, char)
      return { steps, matched: false, matchEnd: startPos, startPos }
    }

    currentStates = nextStates
    if (currentStates.some(s => states[s].isAccept)) {
      matched = true
      matchEnd = i + 1
    }
  }

  // 字符已消费完：到达接受状态则成功，否则在终点补记唯一一次失败
  //（修复“接近失败点但回溯次数不增加”的漏记问题）。
  if (!matched && currentStates.some(s => states[s].isAccept)) {
    matched = true
    matchEnd = input.length
  } else if (!matched) {
    recordFail(input.length, '')
  }

  return { steps, matched, matchEnd, startPos }
}

/**
 * 规范化步骤：连续编号 stepIndex，并以实际步骤为准重算统计值，
 * 从根本上杜绝重复/错位/丢失导致的计数不一致。
 */
function finalizeResult(input: string, attempt: Attempt, startTime: number): MatchResult {
  const steps = attempt.steps.map((step, i) => ({ ...step, stepIndex: i }))
  const backtracks = steps.reduce((n, s) => n + (s.isBacktrack ? 1 : 0), 0)

  if (attempt.matched) {
    const matchText = input.substring(attempt.startPos, attempt.matchEnd)
    return {
      matched: true,
      matchText,
      groups: [matchText],
      steps,
      backtracks,
      totalSteps: steps.length,
      duration: Math.round((performance.now() - startTime) * 100) / 100
    }
  }

  return {
    matched: false,
    matchText: '',
    groups: [],
    steps,
    backtracks,
    totalSteps: steps.length,
    duration: Math.round((performance.now() - startTime) * 100) / 100
  }
}

function runMatch(states: StateNode[], startState: number, input: string, classMatchers: Map<string, (ch: string) => boolean>): MatchResult {
  const startTime = performance.now()
  let lastAttempt: Attempt | null = null

  // 逐个起点尝试；失败尝试的步骤被整体丢弃，绝不混入最终结果
  //（修复多条重复失败记录、步骤总数与画布路径对不上的问题）。
  for (let startPos = 0; startPos <= input.length; startPos++) {
    const attempt = runAttempt(states, startState, input, startPos, classMatchers)
    if (attempt.matched) {
      return finalizeResult(input, attempt, startTime)
    }
    lastAttempt = attempt
  }

  // 全部起点失败：仅保留最后一次尝试的步骤，失败记录只有一条。
  return finalizeResult(input, lastAttempt ?? {
    steps: [], matched: false, matchEnd: 0, startPos: 0
  }, startTime)
}

// ---------------------------------------------------------------------------
// NFA 布局与 AST
// ---------------------------------------------------------------------------

export function computeNFA(nfaResult: ReturnType<typeof buildNFA>): NFA {
  const nodes = nfaResult.states.map((s, i) => ({
    id: s.id,
    isStart: i === nfaResult.startState,
    isAccept: nfaResult.acceptStates.includes(s.id),
    x: 0, y: 0
  }))

  // Layout: circular
  const cx = 400, cy = 300, radius = 200
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    n.x = cx + Math.cos(angle) * radius
    n.y = cy + Math.sin(angle) * radius
  })

  const transitions: any[] = []
  nfaResult.states.forEach(s => {
    s.transitions.forEach((targets, symbol) => {
      targets.forEach(t => {
        transitions.push({ from: s.id, to: t, symbol: symbol.startsWith('__') ? symbol.replace('__', '') : symbol, label: symbol.startsWith('__') ? symbol.replace('__', '') : symbol })
      })
    })
    s.epsilonTransitions.forEach(t => {
      transitions.push({ from: s.id, to: t, symbol: null, label: 'ε' })
    })
  })

  return { states: nodes, transitions, startState: nfaResult.startState, acceptStates: nfaResult.acceptStates }
}

export function parseAST(pattern: string): ASTNode {
  let pos = 0
  let groupIdx = 0

  function parseAtom(): ASTNode {
    const ch = pattern[pos]
    if (ch === '(') {
      pos++
      if (pattern[pos] === '?') { pos++; if (pattern[pos] === ':') pos++ }
      else groupIdx++
      const node = parseOr()
      if (pattern[pos] === ')') pos++
      return { type: 'group', children: [node], groupIndex: groupIdx }
    }
    if (ch === '[') {
      pos++
      let cls = ''
      while (pos < pattern.length && pattern[pos] !== ']') { cls += pattern[pos]; pos++ }
      pos++
      return { type: 'charclass', value: cls }
    }
    if (ch === '.') { pos++; return { type: 'dot' } }
    if (ch === '\\') {
      pos++
      const e = pattern[pos]; pos++
      if (e === 'd') return { type: 'digit' }
      if (e === 'w') return { type: 'word' }
      if (e === 's') return { type: 'space' }
      return { type: 'char', value: e }
    }
    if (ch === '^' || ch === '$') { pos++; return { type: 'anchor', value: ch } }
    pos++
    return { type: 'char', value: ch }
  }

  function parseQuantifier(): ASTNode {
    let node = parseAtom()
    while (pos < pattern.length && ['*', '+', '?', '{'].includes(pattern[pos])) {
      const q = pattern[pos]
      if (q === '{') {
        while (pos < pattern.length && pattern[pos] !== '}') pos++
        pos++
      } else {
        pos++
      }
      const type = q === '*' ? 'star' : q === '+' ? 'plus' : 'question'
      node = { type, children: [node] }
      if (pos < pattern.length && pattern[pos] === '?') pos++
    }
    return node
  }

  function parseConcat(): ASTNode {
    const nodes: ASTNode[] = []
    while (pos < pattern.length && !['|', ')'].includes(pattern[pos])) {
      nodes.push(parseQuantifier())
    }
    if (nodes.length === 1) return nodes[0]
    return { type: 'concat', children: nodes }
  }

  function parseOr(): ASTNode {
    let left = parseConcat()
    while (pos < pattern.length && pattern[pos] === '|') {
      pos++
      const right = parseConcat()
      left = { type: 'or', children: [left, right] }
    }
    return left
  }

  return parseOr()
}

// ---------------------------------------------------------------------------
// 统一分析接口（带缓存，面板与列表页读取同一结果对象）
// ---------------------------------------------------------------------------

export interface RegexAnalysis {
  key: string
  pattern: string
  input: string
  nfa: NFA | null
  result: MatchResult | null
  ast: ASTNode | null
  error: string
}

const CACHE_LIMIT = 50
const cache = new Map<string, RegexAnalysis>()

export function makeAnalysisKey(pattern: string, input: string): string {
  return pattern + '␀' + input
}

/** 执行分析；相同的正则与输入直接返回缓存中的同一结果，性能统计保持稳定。 */
export function analyzeRegex(pattern: string, input: string): RegexAnalysis {
  const key = makeAnalysisKey(pattern, input)
  const hit = cache.get(key)
  if (hit) return hit

  const analysis: RegexAnalysis = { key, pattern, input, nfa: null, result: null, ast: null, error: '' }
  try {
    const built = buildNFA(pattern)
    analysis.nfa = computeNFA(built)
    analysis.result = runMatch(built.states, built.startState, input, built.classMatchers)
    analysis.ast = parseAST(pattern)
  } catch (e: any) {
    analysis.error = e?.message || '正则表达式解析错误'
    analysis.nfa = null
    analysis.result = null
    analysis.ast = null
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, analysis)
  return analysis
}

/** 通过 key 读取同一份分析结果（结果面板与列表页共用此接口）。 */
export function getAnalysis(key: string): RegexAnalysis | null {
  return cache.get(key) ?? null
}

export function getMatchResult(key: string): MatchResult | null {
  return cache.get(key)?.result ?? null
}

export function getSteps(key: string): MatchStep[] {
  return cache.get(key)?.result?.steps ?? []
}

export function clearAnalysisCache() {
  cache.clear()
}
