<template>
  <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
    <h3 class="text-sm font-bold text-slate-400 mb-3">正则表达式输入</h3>
    <div class="relative">
      <span class="absolute left-3 top-2 text-cyan-500 font-bold text-lg">/</span>
      <input
        v-model="localPattern"
        @input="onInput"
        @keyup.enter="execute"
        type="text"
        placeholder="输入正则表达式..."
        class="w-full bg-slate-900 border border-slate-600 rounded-lg pl-8 pr-12 py-2 text-cyan-400 font-mono text-sm focus:outline-none focus:border-cyan-500"
      />
      <span class="absolute right-3 top-2 text-cyan-500 font-bold text-lg">/g</span>
    </div>
    <div v-if="store.error" class="mt-2 text-red-400 text-sm">⚠ {{ store.error }}</div>
    <textarea
      v-model="localTestString"
      @input="onTestInput"
      placeholder="输入测试字符串..."
      rows="3"
      class="w-full mt-3 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 font-mono text-sm focus:outline-none focus:border-cyan-500 resize-none"
    ></textarea>
    <button @click="execute" class="w-full mt-3 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-bold text-sm">执行匹配</button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRegexStore } from '../store/regex'

const store = useRegexStore()
const localPattern = ref(store.pattern)
const localTestString = ref(store.testString)

// 应用模板等外部变更时，同步输入框，避免编辑区与实际执行的正则不一致。
watch(() => store.pattern, v => { localPattern.value = v })
watch(() => store.testString, v => { localTestString.value = v })

let debounceTimer: ReturnType<typeof setTimeout>
function onInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { store.setPattern(localPattern.value); store.execute() }, 300)
}
function onTestInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { store.setTestString(localTestString.value); store.execute() }, 300)
}
function execute() {
  clearTimeout(debounceTimer)
  store.setPattern(localPattern.value)
  store.setTestString(localTestString.value)
  store.execute()
}
</script>
