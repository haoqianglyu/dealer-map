import { ref, watch, nextTick } from 'vue'

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

// ---------- 切换动画 ----------
// 圆形揭开（Telegram / macOS 式）：View Transitions API 截下旧主题当底，新主题从按钮中心扩成圆盖上去。
// 不支持 View Transitions → 300 ms 颜色交叉淡入；prefers-reduced-motion → 直接切。
const REVEAL_MS = 550
const WAIT_MAX = 700 // 底图换样式后等瓦片的最长时间（期间画面停在旧主题上，不露出空白瓦片）
const FADE_MS = 300
const waiters = new Set() // 揭开前要等的异步就绪（地图组件注册：setMapStyle 后瓦片画完）
export function onThemeSwitch(fn) {
  waiters.add(fn)
  return () => waiters.delete(fn)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function originOf(src) {
  const r = src && src.getBoundingClientRect ? src.getBoundingClientRect() : null
  if (r && r.width) return [r.left + r.width / 2, r.top + r.height / 2]
  if (src && Number.isFinite(src.x)) return [src.x, src.y]
  return [innerWidth / 2, innerHeight / 2]
}
let fadeTimer = 0
let current = null // 进行中的 view transition（连点时新的会顶掉旧的）
let pending = null
// src：触发切换的元素（圆心取它的中心）或 {x, y}
export function switchTheme(t, src) {
  if (t === (pending ?? theme.value)) return // pending：已排队、回调还没执行的目标主题（连点时以它为准）
  const html = document.documentElement
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) return setTheme(t)
  if (typeof document.startViewTransition !== 'function') {
    // 交叉淡入：临时类把背景 / 边框 / 文字色过渡到新值（logo 的 filter 不参与，直接换，不闪）
    html.classList.add('theme-fade')
    setTheme(t)
    clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => html.classList.remove('theme-fade'), FADE_MS + 50)
    return
  }
  const [x, y] = originOf(src)
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  html.classList.add('theme-vt')
  pending = t
  const vt = document.startViewTransition(async () => {
    setTheme(t)
    if (pending === t) pending = null
    await nextTick() // 主题 watcher（data-theme、setMapStyle）已执行、DOM 已更新
    if (waiters.size) await Promise.race([Promise.all([...waiters].map((fn) => Promise.resolve(fn()).catch(() => {}))), sleep(WAIT_MAX)])
  })
  current = vt
  vt.ready
    .then(() =>
      html.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: REVEAL_MS, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
      )
    )
    .catch(() => {})
  vt.finished
    .catch(() => {})
    .finally(() => {
      if (current !== vt) return
      current = null
      html.classList.remove('theme-vt')
    })
}

// 过渡期间（含等瓦片的那段）Chrome 把整页当成截图，命中测试一律落在 <html> 上，点击到不了真实元素
//（::view-transition { pointer-events: none } 也不管用）。所以：过渡中在 <html> 上按下 → 立即结束动画（直接显示新主题），
// 把这次按下转发给坐标下的真实元素（pointerdown / mousedown + 聚焦：标记的「点 / 拖」判定、地图拖动都从这里开始；
// 之后真实的移动 / 抬起已能命中真实元素）。click 仍会落在 <html>（按下与抬起目标的公共祖先）→ 再转发给抬起处的元素。
const SLOP = 12
let redirect = null
const evInit = (e) => ({ bubbles: true, cancelable: true, composed: true, view: window, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, button: e.button, buttons: e.buttons })
function onOverlayDown(e) {
  if (!current || e.target !== document.documentElement) return
  current.skipTransition()
  redirect = null
  const t = document.elementFromPoint(e.clientX, e.clientY)
  if (!t || t === document.documentElement) return
  redirect = { x: e.clientX, y: e.clientY }
  t.dispatchEvent(new PointerEvent('pointerdown', { ...evInit(e), pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary }))
  t.dispatchEvent(new MouseEvent('mousedown', evInit(e)))
  const f = t.closest('button, a[href], input, select, textarea, [tabindex]')
  if (f && f.focus) f.focus({ preventScroll: true })
}
function onOverlayClick(e) {
  const r = redirect
  redirect = null
  if (!r || e.target !== document.documentElement || Math.hypot(e.clientX - r.x, e.clientY - r.y) > SLOP) return
  const t = document.elementFromPoint(e.clientX, e.clientY)
  if (!t || t === document.documentElement) return
  e.stopPropagation()
  t.dispatchEvent(new MouseEvent('click', evInit(e)))
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', onOverlayDown, true)
  window.addEventListener('click', onOverlayClick, true)
}
