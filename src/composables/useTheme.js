import { ref, watch } from 'vue'

// 主题：'dark'（默认，展厅）| 'light'。localStorage.dm_theme 持久；?theme= 只对本次会话生效（不写入）
// ?basemap=whitesmoke|light|grey：亮色底图（远山黛 / 月光银 / 雅士灰）对比用，只对本次会话生效
const KEY = 'dm_theme'
const pick = (v, ok) => (ok.includes(v) ? v : '')
function param(name) {
  const m = (location.hash.split('?')[1] || '') + '&' + location.search.slice(1)
  return new URLSearchParams(m).get(name) || ''
}
function readInitial() {
  return pick(param('theme'), ['dark', 'light']) || pick(safeGet(), ['dark', 'light']) || 'dark'
}
function safeGet() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}
export const theme = ref(readInitial())
export const basemap = pick(param('basemap'), ['whitesmoke', 'light', 'grey']) || 'whitesmoke'
export const mapStyleFor = (t) => (t === 'light' ? `amap://styles/${basemap}` : 'amap://styles/darkblue')

function apply(t) {
  const html = document.documentElement
  if (t === 'light') html.dataset.theme = 'light'
  else delete html.dataset.theme
  html.style.colorScheme = t === 'light' ? 'light' : '' // 深色保持未设置（原生控件与改前一致）
  const meta = document.querySelector('meta[name=theme-color]')
  if (meta) meta.content = t === 'light' ? '#eef2f6' : '#040b18'
}
watch(theme, apply, { immediate: true })

export function setTheme(t) {
  theme.value = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* 隐私模式 */
  }
}
