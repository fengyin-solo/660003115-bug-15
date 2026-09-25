import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { NFA, MatchResult, MatchStep, RegexTemplate, ASTNode } from '../types'
import { analyzeRegex, getResult, clearResultCache } from '../api/regexApi'

const GROUP_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

export const TEMPLATES: RegexTemplate[] = [
  { name: '邮箱地址', pattern: '^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\\.([a-zA-Z]{2,})$', description: '匹配标准邮箱格式：用户名@域名.顶级域', testString: 'user@example.com admin@mail.org test.user+tag@sub.domain.co.uk', category: '常用' },
  { name: 'URL链接', pattern: '^(https?)://([^/:]+)(?::(\\d+))?(.*)$', description: '匹配HTTP/HTTPS URL：协议://主机:端口/路径', testString: 'https://www.example.com:8080/path/to/page http://localhost:3000/api', category: '常用' },
  { name: 'IPv4地址', pattern: '^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$', description: '匹配IPv4地址四段数字', testString: '192.168.1.1 10.0.0.1 255.255.255.0', category: '常用' },
  { name: '日期格式', pattern: '^(\\d{4})-(\\d{2})-(\\d{2})$', description: '匹配YYYY-MM-DD日期', testString: '2024-01-15 1999-12-31 2025-06-06', category: '常用' },
  { name: '手机号码', pattern: '^1[3-9]\\d{9}$', description: '匹配中国大陆手机号', testString: '13800138000 15912345678 18600000000', category: '常用' },
  { name: '身份证号', pattern: '^(\\d{6})(\\d{4})(\\d{2})(\\d{2})(\\d{3})([0-9Xx])$', description: '18位身份证：地区码+出生日期+顺序码+校验码', testString: '11010119900101001X 440304200512120039', category: '常用' },
  { name: '十六进制颜色', pattern: '^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$', description: '匹配#RGB或#RRGGBB格式', testString: '#FF5733 #abc #1A2B3C ff0000', category: '前端' },
  { name: '邮政编码', pattern: '^\\d{6}$', description: '6位中国邮编', testString: '100000 518000 200120', category: '常用' },
  { name: '浮点数', pattern: '^-?\\d+\\.\\d+$', description: '匹配带小数点的数字', testString: '3.14 -0.5 100.0', category: '数字' },
  { name: '科学计数法', pattern: '^-?\\d+(\\.\\d+)?[eE][+-]?\\d+$', description: '匹配科学计数法数字', testString: '1.5e10 -2.3E-4 6.022e23', category: '数字' },
  { name: 'MAC地址', pattern: '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$', description: '匹配MAC地址XX:XX:XX:XX:XX:XX', testString: '00:1A:2B:3C:4D:5E AA-BB-CC-DD-EE-FF', category: '网络' },
  { name: 'UUID', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', description: '标准UUID格式', testString: '550e8400-e29b-41d4-a716-446655440000', category: '网络' },
  { name: 'QQ号', pattern: '^[1-9]\\d{4,10}$', description: '5-11位QQ号', testString: '12345 10000 1234567890', category: '常用' },
  { name: '密码强度', pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$', description: '至少8位含大小写字母数字特殊字符', testString: 'Passw0rd! Str0ng@Pass', category: '安全' },
  { name: '中文姓名', pattern: '^[一-龥]{2,4}$', description: '2-4位中文字符', testString: '张三 李世明 王小明', category: '常用' },
  { name: '车牌号', pattern: '^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-HJ-NP-Z0-9]{5}$', description: '中国车牌格式', testString: '京A12345 沪B6789X', category: '常用' },
  { name: 'HTML标签', pattern: '<(\\w+)(\\s[^>]*)?>(.*?)</\\1>', description: '匹配HTML开闭标签对', testString: '<div class="x">content</div> <span>text</span>', category: '前端' },
  { name: '文件扩展名', pattern: '^.+\\.(\\w+)$', description: '提取文件扩展名', testString: 'image.png doc.pdf index.html', category: '前端' },
  { name: '经纬度', pattern: '^(\\-?\\d{1,3}\\.\\d+)\\s*,\\s*(\\-?\\d{1,3}\\.\\d+)$', description: '匹配经纬度坐标', testString: '116.404,39.915 -73.9857,40.7484', category: '地理' },
  { name: '版本号', pattern: '^(\\d+)\\.(\\d+)\\.(\\d+)(?:-(\\w+))?$', description: '语义化版本号x.y.z-tag', testString: '1.0.0 2.3.1-beta 10.20.30', category: '常用' },
  { name: '时间格式', pattern: '^([01]?\\d|2[0-3]):([0-5]\\d)(?::([0-5]\\d))?$', description: 'HH:MM或HH:MM:SS', testString: '14:30 23:59:59 00:00', category: '常用' }
]

export const useRegexStore = defineStore('regex', () => {
  const pattern = ref('^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\\.([a-zA-Z]{2,})$')
  const testString = ref('user@example.com admin@mail.org invalid-email')
  const currentStep = ref(0)
  const isPlaying = ref(false)
  const nfa = ref<NFA | null>(null)
  const matchResult = ref<MatchResult | null>(null)
  const ast = ref<ASTNode | null>(null)
  const error = ref('')
  const selectedTemplate = ref<string>('')

  const groupColors = GROUP_COLORS

  // 单一播放定时器：任何时刻最多一个，停止/重置/重新执行都会清理，杜绝旧标记残留
  let playTimer: ReturnType<typeof setInterval> | null = null
  // 请求令牌：输入快速变化时，只接受最新一次执行的结果
  let executeToken = 0

  /** 当前步骤（带越界钳制），画布与面板都从这里取，保证高亮与列表同步 */
  const activeStep = computed<MatchStep | null>(() => {
    const result = matchResult.value
    if (!result) return null
    if (currentStep.value < 0) currentStep.value = 0
    if (currentStep.value > result.steps.length - 1) currentStep.value = Math.max(0, result.steps.length - 1)
    return result.steps[currentStep.value] ?? null
  })

  const matchHighlight = computed(() => {
    if (!matchResult.value || !matchResult.value.matched) return null
    const matchText = matchResult.value.matchText
    const idx = testString.value.indexOf(matchText)
    if (idx === -1) return null
    return {
      before: testString.value.substring(0, idx),
      match: matchText,
      after: testString.value.substring(idx + matchText.length)
    }
  })

  function clearPlayTimer() {
    if (playTimer !== null) {
      clearInterval(playTimer)
      playTimer = null
    }
    isPlaying.value = false
  }

  async function execute() {
    const token = ++executeToken
    clearPlayTimer()
    const p = pattern.value
    const s = testString.value
    try {
      const result = await analyzeRegex(p, s)
      if (token !== executeToken) return // 已被更新的请求取代，丢弃过期结果
      nfa.value = result.nfa
      matchResult.value = result.matchResult
      ast.value = result.ast
      error.value = ''
      currentStep.value = 0
    } catch (e: any) {
      if (token !== executeToken) return
      error.value = e?.message || '正则表达式解析错误'
      nfa.value = null
      matchResult.value = null
      ast.value = null
      currentStep.value = 0
    }
  }

  function setPattern(p: string) {
    pattern.value = p
    execute()
  }

  function setTestString(s: string) {
    testString.value = s
    execute()
  }

  function applyTemplate(t: RegexTemplate) {
    clearPlayTimer()
    pattern.value = t.pattern
    testString.value = t.testString
    selectedTemplate.value = t.name
    execute()
  }

  function stepForward() {
    clearPlayTimer()
    if (matchResult.value && currentStep.value < matchResult.value.steps.length - 1) {
      currentStep.value++
    }
  }

  function stepBackward() {
    clearPlayTimer()
    if (currentStep.value > 0) currentStep.value--
  }

  /** 重置：停止播放、归零，画布回到初始高亮，旧回溯标记全部清除 */
  function resetStep() {
    clearPlayTimer()
    currentStep.value = 0
  }

  function play() {
    if (!matchResult.value) return
    clearPlayTimer()
    // 已在末尾时再次播放，先回到起点，避免“播放无反应”
    if (currentStep.value >= matchResult.value.steps.length - 1) {
      currentStep.value = 0
    }
    isPlaying.value = true
    playTimer = setInterval(() => {
      const result = matchResult.value
      if (!result) { clearPlayTimer(); return }
      if (currentStep.value < result.steps.length - 1) {
        currentStep.value++
      } else {
        clearPlayTimer()
      }
    }, 200)
  }

  /** 暂停：真正清除定时器，可在当前步骤继续 */
  function stop() {
    clearPlayTimer()
  }

  /** 强制重新执行（忽略缓存） */
  async function rerun() {
    clearResultCache()
    await execute()
  }

  /** 从接口按同一缓存键读取结果（面板与列表共用同一引用的入口） */
  function readResult(): MatchResult | null {
    return matchResult.value ?? getResult(pattern.value, testString.value)?.matchResult ?? null
  }

  return {
    pattern, testString, currentStep, isPlaying, nfa, matchResult, ast, error,
    selectedTemplate, groupColors, matchHighlight, activeStep,
    execute, setPattern, setTestString, applyTemplate,
    stepForward, stepBackward, resetStep, play, stop, rerun, readResult
  }
})
