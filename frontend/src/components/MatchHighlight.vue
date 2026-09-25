<template>
  <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
    <h3 class="text-sm font-bold text-slate-400 mb-3">匹配结果高亮</h3>
    <div v-if="store.error" class="text-red-400 text-sm">解析错误</div>
    <div v-else-if="store.matchHighlight" class="bg-slate-900 rounded-lg p-4 font-mono text-sm overflow-x-auto">
      <span class="text-slate-500">{{ store.matchHighlight.before }}</span>
      <span class="bg-green-600 text-white px-1 rounded">{{ store.matchHighlight.match }}</span>
      <span class="text-slate-500">{{ store.matchHighlight.after }}</span>
    </div>
    <div v-else-if="store.matchResult && !store.matchResult.matched" class="text-red-400 text-sm">未匹配到结果</div>
    <div v-else class="text-slate-500 text-sm">等待执行...</div>

    <div v-if="store.matchResult && store.matchResult.matched" class="mt-4">
      <h4 class="text-xs font-bold text-slate-500 mb-2">分组捕获 ({{ store.matchResult.groups.length }})</h4>
      <div class="space-y-1">
        <div v-for="(group, i) in store.matchResult.groups" :key="i" class="flex items-center gap-2 text-sm">
          <span class="inline-block w-4 h-4 rounded" :style="{ backgroundColor: store.groupColors[i % store.groupColors.length] }"></span>
          <span class="text-slate-500 w-16">Group {{ i }}</span>
          <span class="text-slate-200 font-mono bg-slate-900 px-2 py-0.5 rounded">{{ group || '∅' }}</span>
        </div>
      </div>
    </div>

    <div v-if="store.matchResult && store.matchResult.steps.length > 0" class="mt-4">
      <h4 class="text-xs font-bold text-slate-500 mb-2">
        执行步骤 ({{ store.currentStep + 1 }}/{{ store.matchResult.totalSteps }} ·
        回溯 {{ store.matchResult.backtracks }} 次)
      </h4>
      <div class="space-y-1 max-h-40 overflow-y-auto">
        <div v-for="step in recentSteps" :key="step.stepIndex"
          class="text-xs font-mono px-2 py-1 rounded border-l-2"
          :class="stepClass(step)">
          <template v-if="step.kind === 'fail'">
            [{{ step.stepIndex }}] 字符位置 {{ step.charIndex }} 处失败 ⚠ 回溯 #{{ backtrackNos.get(step.stepIndex) }}
          </template>
          <template v-else-if="step.kind === 'recover'">
            [{{ step.stepIndex }}] ↩ 恢复尝试，从起始位置 {{ step.charIndex }} 重新出发
          </template>
          <template v-else>
            [{{ step.stepIndex }}] '{{ step.char }}' → 状态{{ step.currentState }}→{{ step.nextState }} ({{ step.transition }})
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRegexStore } from '../store/regex'
import type { MatchStep } from '../types'

const store = useRegexStore()

// 与结果面板读取同一结果（经 API 缓存的同一引用），列表不自行计算
const recentSteps = computed<MatchStep[]>(() => {
  const result = store.matchResult
  if (!result) return []
  const end = store.currentStep + 1
  return result.steps.slice(Math.max(0, end - 50), end)
})

// 回溯序号：按失败步骤出现顺序编号，保证每次失败对应唯一编号
const backtrackNos = computed(() => {
  const map = new Map<number, number>()
  const steps = store.matchResult?.steps ?? []
  let no = 0
  for (const s of steps) {
    if (s.kind === 'fail') map.set(s.stepIndex, ++no)
  }
  return map
})

function stepClass(step: MatchStep): string {
  if (step.kind === 'fail') {
    return 'border-red-500 bg-red-900/60 text-red-300'
  }
  if (step.kind === 'recover') {
    return 'border-cyan-500 bg-cyan-900/40 text-cyan-300'
  }
  return step.stepIndex === store.currentStep
    ? 'border-orange-400 bg-cyan-900 text-cyan-200'
    : 'border-slate-700 bg-slate-900 text-slate-400'
}
</script>
