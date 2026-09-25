<template>
  <div class="min-h-screen bg-slate-900 text-slate-200">
    <header class="border-b border-slate-700 px-6 py-4">
      <h1 class="text-2xl font-bold text-cyan-400">正则表达式可视化调试器</h1>
      <p class="text-sm text-slate-500 mt-1">NFA 状态机可视化 · 逐步匹配高亮 · 分组捕获 · 回溯追踪</p>
    </header>

    <div class="flex flex-col lg:flex-row gap-4 p-4">
      <div class="lg:w-1/4 space-y-4">
        <RegexEditor />
        <TemplateLibrary />
      </div>

      <div class="lg:w-1/2 space-y-4">
        <NfaVisualizer />
        <MatchHighlight />
      </div>

      <div class="lg:w-1/4 space-y-4">
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">匹配统计</h3>
          <div v-if="store.matchResult" class="space-y-2 text-sm">
            <div class="flex justify-between"><span class="text-slate-500">匹配状态</span><span :class="store.matchResult.matched ? 'text-green-400' : 'text-red-400'">{{ store.matchResult.matched ? '✓ 匹配成功' : '✗ 未匹配' }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">匹配文本</span><span class="text-cyan-400 font-mono truncate ml-2">{{ store.matchResult.matchText || '—' }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">总步数</span><span class="text-slate-300">{{ store.matchResult.totalSteps }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">回溯次数</span><span :class="store.matchResult.backtracks > 0 ? 'text-orange-400 font-bold' : 'text-slate-300'">{{ store.matchResult.backtracks }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">耗时(ms)</span><span class="text-slate-300">{{ store.matchResult.duration }}</span></div>
          </div>
          <div v-else class="text-slate-500 text-sm">点击"执行匹配"开始</div>
        </div>

        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">逐步控制</h3>
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <button @click="store.stepBackward" :disabled="store.currentStep === 0" class="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 rounded text-sm">⏮ 上一步</button>
            <button v-if="!store.isPlaying" @click="store.play" class="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-sm">▶ 播放</button>
            <button v-else @click="store.stop" class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm">⏸ 停止</button>
            <button @click="store.stepForward" :disabled="!store.matchResult || store.currentStep >= store.matchResult.steps.length - 1" class="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 rounded text-sm">下一步 ⏭</button>
            <button @click="store.resetStep" class="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm">⟲ 重置</button>
          </div>
          <div class="text-sm text-slate-400">步骤: {{ store.currentStep }} / {{ store.matchResult?.steps.length || 0 }}</div>
        </div>

        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">当前步骤详情</h3>
          <div v-if="store.activeStep" class="space-y-1 text-sm">
            <div>步骤序号: <span class="text-cyan-400">{{ store.activeStep.stepIndex }} / {{ store.matchResult?.totalSteps ?? 0 }}</span></div>
            <div>字符索引: <span class="text-cyan-400">{{ store.activeStep.charIndex }}</span></div>
            <div>当前字符: <span class="text-yellow-400 font-mono">'{{ store.activeStep.char }}'</span></div>
            <div>状态转换: <span class="text-green-400">{{ store.activeStep.currentState }}</span> → <span class="text-blue-400">{{ store.activeStep.nextState }}</span></div>
            <div>转移符号: <span class="text-purple-400 font-mono">{{ store.activeStep.transition }}</span></div>
            <div v-if="store.activeStep.kind === 'fail'" class="text-red-400 font-bold">⚠ 回溯失败点（本次执行共 {{ store.matchResult?.backtracks ?? 0 }} 次回溯，每次仅一条记录）</div>
            <div v-else-if="store.activeStep.kind === 'recover'" class="text-cyan-400 font-bold">↩ 回溯恢复，重新出发</div>
          </div>
          <div v-else class="text-slate-500 text-sm">无步骤数据</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRegexStore } from './store/regex'
import RegexEditor from './components/RegexEditor.vue'
import NfaVisualizer from './components/NfaVisualizer.vue'
import MatchHighlight from './components/MatchHighlight.vue'
import TemplateLibrary from './components/TemplateLibrary.vue'

const store = useRegexStore()
onMounted(() => store.execute())
</script>
