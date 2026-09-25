<template>
  <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-bold text-slate-400">NFA 状态机可视化</h3>
      <span v-if="store.nfa" class="text-xs text-slate-500">{{ store.nfa.states.length }} 状态 · {{ store.nfa.transitions.length }} 转移</span>
    </div>
    <canvas ref="canvasRef" width="800" height="500" class="w-full bg-slate-900 rounded-lg border border-slate-700"></canvas>
    <div class="mt-2 flex gap-4 text-xs text-slate-500 flex-wrap">
      <span><span class="inline-block w-3 h-3 rounded-full bg-cyan-500 mr-1"></span>起始/恢复</span>
      <span><span class="inline-block w-3 h-3 rounded-full bg-green-500 mr-1"></span>接受状态</span>
      <span><span class="inline-block w-3 h-3 rounded-full bg-orange-500 mr-1"></span>当前激活</span>
      <span><span class="inline-block w-3 h-3 rounded-full bg-red-600 mr-1"></span>回溯失败点</span>
      <span><span class="inline-block w-3 h-3 rounded-full bg-slate-600 mr-1"></span>普通状态</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRegexStore } from '../store/regex'

const store = useRegexStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 无论是否有 NFA 都先清屏：出错、重置或重新执行后旧高亮/回溯标记不得残留
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!store.nfa) return

  const activeStates = new Set<number>()
  const failedStates = new Set<number>()
  const recoverStates = new Set<number>()
  const step = store.activeStep
  if (step) {
    if (step.kind === 'fail') {
      if (step.currentState >= 0) failedStates.add(step.currentState)
    } else if (step.kind === 'recover') {
      if (step.nextState >= 0) recoverStates.add(step.nextState)
    } else {
      activeStates.add(step.currentState)
      activeStates.add(step.nextState)
    }
  }

  // Draw transitions
  store.nfa.transitions.forEach(t => {
    const from = store.nfa!.states.find(s => s.id === t.from)
    const to = store.nfa!.states.find(s => s.id === t.to)
    if (!from || !to) return

    const isActive = activeStates.has(t.from) && activeStates.has(t.to)
    ctx.strokeStyle = isActive ? '#f97316' : '#475569'
    ctx.lineWidth = isActive ? 2.5 : 1
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)

    if (t.from === t.to) {
      // Self loop
      const mx = from.x, my = from.y - 35
      ctx.quadraticCurveTo(mx + 25, my, from.x + 10, from.y - 15)
    } else {
      const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2
      const dx = to.x - from.x, dy = to.y - from.y
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const offX = -dy / len * 20, offY = dx / len * 20
      ctx.quadraticCurveTo(mx + offX, my + offY, to.x, to.y)
    }
    ctx.stroke()

    // Arrowhead
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    const ex = to.x - Math.cos(angle) * 22, ey = to.y - Math.sin(angle) * 22
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex - Math.cos(angle - 0.4) * 8, ey - Math.sin(angle - 0.4) * 8)
    ctx.lineTo(ex - Math.cos(angle + 0.4) * 8, ey - Math.sin(angle + 0.4) * 8)
    ctx.closePath()
    ctx.fillStyle = isActive ? '#f97316' : '#475569'
    ctx.fill()

    // Label
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2
    const dx2 = to.x - from.x, dy2 = to.y - from.y
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1
    const lx = mx - dy2 / len2 * 15, ly = my + dx2 / len2 * 15
    ctx.fillStyle = isActive ? '#fbbf24' : '#94a3b8'
    ctx.font = '11px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(t.label, lx, ly)
  })

  // Draw states
  store.nfa.states.forEach(s => {
    const isActive = activeStates.has(s.id)
    const isFailed = failedStates.has(s.id)
    const isRecover = recoverStates.has(s.id)
    const color = s.isStart ? '#06b6d4' : s.isAccept ? '#22c55e' : isActive ? '#f97316' : isFailed ? '#dc2626' : isRecover ? '#06b6d4' : '#475569'

    ctx.beginPath()
    ctx.arc(s.x, s.y, 20, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = isActive || isFailed || isRecover ? '#fbbf24' : '#1e293b'
    ctx.lineWidth = 2
    ctx.stroke()

    // 失败回溯状态额外红色警示环
    if (isFailed) {
      ctx.beginPath()
      ctx.arc(s.x, s.y, 25, 0, Math.PI * 2)
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (s.isAccept) {
      ctx.beginPath()
      ctx.arc(s.x, s.y, 15, 0, Math.PI * 2)
      ctx.strokeStyle = '#16a34a'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.fillStyle = '#f1f5f9'
    ctx.font = 'bold 12px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(s.id), s.x, s.y)

    if (s.isStart) {
      ctx.beginPath()
      ctx.moveTo(s.x - 40, s.y)
      ctx.lineTo(s.x - 22, s.y)
      ctx.strokeStyle = '#06b6d4'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(s.x - 22, s.y)
      ctx.lineTo(s.x - 28, s.y - 4)
      ctx.lineTo(s.x - 28, s.y + 4)
      ctx.closePath()
      ctx.fillStyle = '#06b6d4'
      ctx.fill()
    }
  })
}

onMounted(() => { draw() })
// matchResult 变化（重新执行/重置）也必须重绘，保证旧回溯标记被清理
watch(() => [store.nfa, store.matchResult, store.currentStep], () => draw(), { deep: false })
</script>
