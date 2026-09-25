import type { ASTNode, MatchResult, MatchStep, NFA } from '../types'

export interface StateNode {
  id: number
  isAccept: boolean
  transitions: Map<string, number[]>
  epsilonTransitions: number[]
  // 字符类判定器挂在“出边所在状态”上，键为该边上的符号
  matchers: Map<string, (ch: string) => boolean>
}

export interface BuiltNFA {
  states: StateNode[]
  startState: number
  acceptStates: number[]
  anchorStart: boolean
  anchorEnd: boolean
}

export interface AnalyzeResult {
  nfa: NFA
  matchResult: MatchResult
  ast: ASTNode
}

export function buildNFA(pattern: string): BuiltNFA {
  const states: StateNode[] = []
  let stateCounter = 0
  let pos = 0
  let groupCount = 0

  function newState(): number {
    const id = stateCounter++
    states.push({ id, isAccept: false, transitions: new Map(), epsilonTransitions: [], matchers: new Map() })
    return id
  }

  function addTransition(from: number, symbol: string, to: number, matcher?: (ch: string) => boolean) {
    if (!states[from].transitions.has(symbol)) {
      states[from].transitions.set(symbol, [])
    }
    states[from].transitions.get(symbol)!.push(to)
    if (matcher) states[from].matchers.set(symbol, matcher)
  }

  function addEpsilon(from: number, to: number) {
    states[from].epsilonTransitions.push(to)
  }

  // 深拷贝一段子 NFA（状态连续、边均为内部边），返回拷贝段的 [start, end]
  function cloneSegment(segStart: number, segEnd: number): [number, number] {
    const offset = states.length - segStart
    const map: number[] = []
    for (let i = segStart; i <= segEnd; i++) {
      const src = states[i]
      const id = newState()
      map[i - segStart] = id
      const dst = states[id]
      src.transitions.forEach((targets, symbol) => {
        dst.transitions.set(symbol, targets.map(t => t + offset))
      })
      src.matchers.forEach((matcher, symbol) => dst.matchers.set(symbol, matcher))
      dst.epsilonTransitions = src.epsilonTransitions.map(t => t + offset)
    }
    return [map[0], map[segEnd - segStart]]
  }

  // 解析 {n} / {n,} / {n,m}，失败时回退 pos 并返回 null；同时消费惰性标记 ?
  function parseBrace(): { min: number; max: number; lazy: boolean } | null {
    const saved = pos
    pos++ // 跳过 '{'
    let minStr = ''
    while (pos < pattern.length && /\d/.test(pattern[pos])) { minStr += pattern[pos]; pos++ }
    let min = 0
    let max = Infinity
    if (minStr === '') { pos = saved; return null }
    min = parseInt(minStr, 10)
    if (pattern[pos] === '}') {
      pos++
      max = min
    } else if (pattern[pos] === ',') {
      pos++
      let maxStr = ''
      while (pos < pattern.length && /\d/.test(pattern[pos])) { maxStr += pattern[pos]; pos++ }
      if (pattern[pos] !== '}') { pos = saved; return null }
      pos++
      if (maxStr !== '') max = parseInt(maxStr, 10)
    } else {
      pos = saved
      return null
    }
    const lazy = pattern[pos] === '?'
    if (lazy) pos++
    return { min, max, lazy }
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
          if (pattern[pos] === ':') pos++
        }
        const [s, e] = parseOr()
        segStart = s; segEnd = e
        pos++ // skip )
      } else if (ch === '[') {
        pos++
        segStart = newState()
        segEnd = newState()
        const matcher = parseCharClass()
        const symbol = '__class_' + segStart
        addTransition(segStart, symbol, segEnd, matcher)
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
        else addTransition(segStart, escaped ?? '', segEnd) // \. \( 等均为字面量
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

      // 处理量词
      while (pos < pattern.length && ['*', '+', '?', '{'].includes(pattern[pos])) {
        const q = pattern[pos]
        if (q === '{') {
          const brace = parseBrace()
          if (!brace || brace.max < brace.min) break // 非法 { 或区间倒置，作为普通字符原子处理
          if (brace.max === 0) {
            segStart = segEnd = newState()
            continue
          }

          const qStart = newState()
          const qEnd = newState()

          // 副本总数（原件即第 1 个）：
          //   有界 {min,max}：max 个副本，按需旁路
          //   无界 {min,}   ：min 个强制副本 + 1 个自循环副本
          // 关键：先基于“尚未接线”的纯净原件克隆，再统一加 ε 边，
          // 否则串联边会污染后续克隆（产生悬空边、错误闭包）
          const totalCopies = brace.max === Infinity ? brace.min + 1 : brace.max
          const copies: Array<[number, number]> = [[segStart, segEnd]]
          for (let k = 1; k < totalCopies; k++) {
            copies.push(cloneSegment(segStart, segEnd))
          }

          addEpsilon(qStart, segStart)

          if (brace.max === Infinity && brace.min === 0) {
            // {0,} 星型：可零次，也可循环任意次（副本自身回环）
            addEpsilon(qStart, qEnd)
            addEpsilon(segEnd, qEnd)
            addEpsilon(segEnd, segStart)
          } else {
            if (brace.min === 0) addEpsilon(qStart, qEnd) // 可一个副本都不取
            for (let k = 1; k < copies.length; k++) {
              const prevEnd = copies[k - 1][1]
              if (k < brace.min) {
                addEpsilon(prevEnd, copies[k][0]) // 强制副本
              } else {
                addEpsilon(prevEnd, qEnd)        // 在此可结束
                addEpsilon(prevEnd, copies[k][0]) // 或进入下一副本
              }
            }
            const lastEnd = copies[copies.length - 1][1]
            addEpsilon(lastEnd, qEnd)
            if (brace.max === Infinity) {
              // 最后一个（额外）副本自循环，实现“任意多次”
              addEpsilon(lastEnd, copies[copies.length - 1][0])
            }
          }

          segStart = qStart
          segEnd = qEnd
          continue
        }

        pos++
        const lazy = pattern[pos] === '?'
        if (lazy) pos++ // 惰性只改变回溯顺序，语言结构相同
        const qStart = newState()
        const qEnd = newState()
        addEpsilon(qStart, segStart)
        if (q === '*') { addEpsilon(qStart, qEnd); addEpsilon(segEnd, qEnd); addEpsilon(segEnd, segStart) }
        else if (q === '+') { addEpsilon(segEnd, qEnd); addEpsilon(segEnd, segStart) }
        else { addEpsilon(qStart, qEnd); addEpsilon(segEnd, qEnd) }
        segStart = qStart; segEnd = qEnd
      }

      if (end !== segStart) addEpsilon(end, segStart)
      end = segEnd
    }
    return [start, end]
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

  // 顶层锚点检测：忽略转义的 \^ \$ 与字符类中的锚点
  function detectAnchors(): { anchorStart: boolean; anchorEnd: boolean } {
    let anchorStart = false
    let anchorEnd = false
    let depth = 0
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]
      if (c === '\\') { i++; continue }
      if (c === '[') {
        i++
        while (i < pattern.length && pattern[i] !== ']') {
          if (pattern[i] === '\\') i++
          i++
        }
        continue
      }
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === '^' && depth === 0 && i === 0) anchorStart = true
      else if (c === '$' && depth === 0 && i === pattern.length - 1) anchorEnd = true
    }
    return { anchorStart, anchorEnd }
  }

  const { anchorStart, anchorEnd } = detectAnchors()
  const [startState, acceptState] = parseOr()
  states[acceptState].isAccept = true
  return { states, startState, acceptStates: [acceptState], anchorStart, anchorEnd }
}

export function epsilonClosure(states: StateNode[], stateId: number): Set<number> {
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

function matchTransition(state: StateNode, symbol: string): number[] {
  const results: number[] = []
  for (const [sym, targets] of state.transitions) {
    if (sym === symbol) { results.push(...targets); continue }
    if (sym === '__dot' && symbol !== '\n') { results.push(...targets); continue }
    if (sym === '__digit' && /\d/.test(symbol)) { results.push(...targets); continue }
    if (sym === '__word' && /\w/.test(symbol)) { results.push(...targets); continue }
    if (sym === '__space' && /\s/.test(symbol)) { results.push(...targets); continue }
    if (sym.startsWith('__class_')) {
      const matcher = state.matchers.get(sym)
      if (matcher && matcher(symbol)) results.push(...targets)
    }
  }
  return results
}

export function runMatch(built: BuiltNFA, input: string): MatchResult {
  const { states, startState, anchorStart, anchorEnd } = built
  const steps: MatchStep[] = []
  const startTime = performance.now()

  const pushStep = (step: Omit<MatchStep, 'stepIndex'>) => {
    steps.push({ ...step, stepIndex: steps.length })
  }

  const buildResult = (matched: boolean, startPos: number, matchEnd: number): MatchResult => {
    // 回溯次数与失败步骤数严格一致——计数是步骤的派生值，单一数据源
    const backtracks = steps.filter(s => s.isBacktrack).length
    const duration = Math.round((performance.now() - startTime) * 100) / 100
    return {
      matched,
      matchText: matched ? input.substring(startPos, matchEnd) : '',
      groups: matched ? [input.substring(startPos, matchEnd)] : [],
      steps,
      backtracks,
      totalSteps: steps.length,
      duration
    }
  }

  const isAccept = (stateSet: number[]) => stateSet.some(s => states[s].isAccept)

  const lastStart = anchorStart ? 0 : input.length
  for (let startPos = 0; startPos <= lastStart; startPos++) {
    let currentStates = Array.from(epsilonClosure(states, startState))

    // 贪心最长匹配：记录最近一次“已到达接受态”的位置；死路时回溯到该位置
    // lastAccept = 已消耗的字符数；-1 表示尚未接受
    let lastAccept = (!anchorEnd || startPos === input.length) && isAccept(currentStates) ? 0 : -1
    let deadCharIndex = startPos < input.length ? startPos : Math.max(0, input.length - 1)
    let deadChar = input[deadCharIndex] ?? ''
    let deadState = currentStates[0] ?? -1

    for (let i = startPos; i < input.length; i++) {
      const char = input[i]
      const nextStates: number[] = []
      const seen = new Set<number>()

      for (const s of currentStates) {
        const targets = matchTransition(states[s], char)
        for (const t of targets) {
          const closure = epsilonClosure(states, t)
          for (const c of closure) {
            if (!seen.has(c)) {
              seen.add(c)
              nextStates.push(c)
              pushStep({
                charIndex: i,
                char,
                currentState: s,
                nextState: c,
                transition: char,
                kind: 'transition',
                isBacktrack: false,
                isMatch: true
              })
            }
          }
        }
      }

      const consumed = i - startPos + 1
      const consumedAll = i + 1 === input.length
      if (nextStates.length === 0) {
        deadCharIndex = i
        deadChar = char
        deadState = currentStates[0] ?? -1
        break
      }

      currentStates = nextStates
      if (isAccept(currentStates)) {
        if (anchorEnd) {
          if (consumedAll) return buildResult(true, startPos, input.length)
        } else {
          lastAccept = consumed // 非锚定：先记下，继续贪心扩展
        }
      }
      if (anchorEnd && consumedAll) {
        deadCharIndex = i
        deadChar = char
        deadState = currentStates[0] ?? -1
        break
      }
    }

    // 非锚定：本轮探索结束，取最近接受位置（最长匹配）
    if (!anchorEnd && lastAccept >= 0) {
      return buildResult(true, startPos, startPos + lastAccept)
    }

    // 每次尝试的失败只落一条 FAIL（计数与该步骤严格对应）
    pushStep({
      charIndex: deadCharIndex,
      char: deadChar,
      currentState: deadState,
      nextState: -1,
      transition: 'FAIL',
      kind: 'fail',
      isBacktrack: true,
      isMatch: false
    })

    // 还有下一个起始位置可尝试 -> 记录一次“恢复/换道”，与失败一一对应
    if (startPos < lastStart) {
      pushStep({
        charIndex: startPos + 1,
        char: '',
        currentState: -1,
        nextState: startState,
        transition: 'RETRY',
        kind: 'recover',
        isBacktrack: false,
        isMatch: false
      })
    }
  }

  return buildResult(false, 0, 0)
}

const SPECIAL_LABELS: Record<string, string> = {
  __dot: '.',
  __digit: '\\d',
  __word: '\\w',
  __space: '\\s'
}

function transitionLabel(symbol: string | null): string {
  if (symbol === null) return 'ε'
  return SPECIAL_LABELS[symbol] ?? (symbol.startsWith('__class_') ? '[…]' : symbol)
}

export function computeNFA(nfaResult: BuiltNFA): NFA {
  const nodes = nfaResult.states.map((s, i) => ({
    id: s.id,
    isStart: i === nfaResult.startState,
    isAccept: nfaResult.acceptStates.includes(s.id),
    x: 0, y: 0
  }))

  // 环形布局
  const cx = 400, cy = 300, radius = 200
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    n.x = cx + Math.cos(angle) * radius
    n.y = cy + Math.sin(angle) * radius
  })

  const transitions: NFA['transitions'] = []
  nfaResult.states.forEach(s => {
    s.transitions.forEach((targets, symbol) => {
      targets.forEach(t => {
        transitions.push({ from: s.id, to: t, symbol, label: transitionLabel(symbol) })
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
      if (pattern[pos] === '?') pos++
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
