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

    <div v-if="steps.length > 0" class="mt-4">
      <h4 class="text-xs font-bold text-slate-500 mb-2">
        执行步骤 (最近5步) · 回溯 <span class="text-orange-400">{{ visibleBacktrackCount }}</span> 次
      </h4>
      <div class="space-y-1 max-h-32 overflow-y-auto">
        <div v-for="step in recentSteps" :key="step.stepIndex"
          class="text-xs font-mono px-2 py-1 rounded"
          :class="step.isBacktrack ? 'bg-orange-900 text-orange-300' : step.stepIndex === store.currentStep ? 'bg-cyan-900 text-cyan-300' : 'bg-slate-900 text-slate-400'">
          [{{ step.stepIndex }}] '{{ step.char }}' → 状态{{ step.currentState}}→{{ step.nextState }} ({{ step.transition }}){{ step.isBacktrack ? ' ⚠回溯' : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRegexStore } from '../store/regex'

const store = useRegexStore()

// 步骤列表通过接口读取与结果面板同一份结果，杜绝两处数据不一致。
const steps = computed(() =>
  store.resultKey ? store.getStepsByKey(store.resultKey) : (store.matchResult?.steps ?? [])
)
const visibleBacktrackCount = computed(() => store.visibleBacktracks)
const recentSteps = computed(() => {
  const end = store.currentStep + 1
  return steps.value.slice(Math.max(0, end - 5), end)
})
</script>
