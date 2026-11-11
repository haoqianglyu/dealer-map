// 电视长期开着的兜底：① 发版后空闲时重载 ② 每天凌晨固定时段重载 ③ 连续错误时显示「正在恢复」并重载（防死循环）
import { entryOf, shouldDailyReload, ymd, createErrorCounter, recoverAllowed, isNoise } from '@/utils/reloadPolicy'

const VERSION_MS = 3600 * 1000
const TICK_MS = 30 * 1000
const IDLE_MS = 5 * 60 * 1000
const DAILY_KEY = 'dm_daily_reload'
const RECOVER_KEY = 'dm_recover'

let tourRunning = () => false
export const setTourStateGetter = (fn) => (tourRunning = fn)

let pending = false
let lastInput = Date.now()
const idle = () => !tourRunning() && Date.now() - lastInput >= IDLE_MS
const dailyDue = () => {
  try {
    return shouldDailyReload(new Date(), localStorage.getItem(DAILY_KEY) || '')
  } catch {
    return false
  }
}
function doReload() {
  try {
    if (dailyDue()) localStorage.setItem(DAILY_KEY, ymd(new Date()))
  } catch {
    /* 存储不可用也继续 */
  }
  location.reload()
}
const reloadIfDue = () => (pending || dailyDue()) && doReload()
// 巡航一轮结束时调用：巡航一直在跑也能在两轮之间换版（只在这一刻重载，不打断讲解）
export const onTourRoundEnd = () => reloadIfDue()

async function checkVersion(cur) {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: 'no-store' })
    if (!r.ok) return
    const e = entryOf(await r.text())
    if (e && e !== cur) pending = true
  } catch {
    /* 网络不通：下一小时再查 */
  }
}

function overlay(text, retry) {
  let el = document.getElementById('dm-recover')
  if (!el) {
    el = document.createElement('div')
    el.id = 'dm-recover'
    el.setAttribute('role', 'alert')
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font:600 22px/1.5 var(--dm-font,sans-serif);color:var(--dm-text,#f2f7ff);background:var(--dm-bg,#040b18)'
    document.body.appendChild(el)
  }
  el.innerHTML = `<div>${text}</div>`
  if (retry) {
    const b = document.createElement('button')
    b.textContent = '重新加载'
    b.style.cssText = 'height:48px;padding:0 24px;font:inherit;font-size:18px;color:inherit;background:var(--dm-btn-bg,#0d1b2c);border:1px solid var(--dm-btn-line,#1f3754);border-radius:6px;cursor:pointer'
    b.onclick = () => location.reload()
    el.appendChild(b)
  }
}
let recovering = false
function recover() {
  if (recovering) return
  recovering = true
  let hist = []
  try {
    hist = JSON.parse(sessionStorage.getItem(RECOVER_KEY) || '[]')
  } catch {
    hist = []
  }
  const { allowed, history } = recoverAllowed(hist)
  if (!allowed) {
    overlay('页面多次恢复失败，已暂停自动重载', true)
    setTimeout(() => location.reload(), 30 * 60 * 1000) // 过了窗口再试一次
    return
  }
  history.push(Date.now())
  try {
    sessionStorage.setItem(RECOVER_KEY, JSON.stringify(history))
  } catch {
    // 记不住次数就防不了重载死循环：停止自动恢复，等人点
    overlay('页面异常，自动恢复不可用', true)
    return
  }
  overlay('正在恢复…')
  setTimeout(() => location.reload(), 2500)
}

export function startAutoReload(app) {
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(t, () => (lastInput = Date.now()), { capture: true, passive: true })
  // 新版本
  const script = document.querySelector('script[type="module"][src*="/assets/index-"]')
  const cur = entryOf(script?.getAttribute('src') || '')
  if (cur) setInterval(() => checkVersion(cur), VERSION_MS)
  setInterval(() => idle() && reloadIfDue(), TICK_MS)
  // 错误恢复：渲染错误（Vue 组件）更严重，门槛低；未处理异常要多几次才动
  const render = createErrorCounter({ limit: 3, windowMs: 60000 })
  const global = createErrorCounter({ limit: 6, windowMs: 60000 })
  app.config.errorHandler = (err, inst, info) => {
    console.error('渲染错误', info, err)
    if (isNoise(err)) return
    if (render.hit()) recover()
  }
  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window) return // 资源加载失败不算（图片 / 地图瓦片）
    if (isNoise(e.error, { message: e.message, filename: e.filename })) return
    if (global.hit()) recover()
  })
  window.addEventListener('unhandledrejection', (e) => {
    if (isNoise(e.reason)) return
    if (global.hit()) recover()
  })
}
