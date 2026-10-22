// v-marquee：单行文字放不下时横向滚动（代替省略号）。只对真的溢出的行生效。
// 节奏：停 1.5 s → 约 32 px/s 左移到末尾 → 停 2.5 s → 淡出回到开头 → 循环；各行错开起始时间（8 档 × 1.2 s），同屏同时在动的行少。
// 只有在视口里（含滚动容器裁切）的行才动（IntersectionObserver），滚出视野的行暂停。
// 悬停/聚焦所在行时暂停；prefers-reduced-motion 时不滚动（保留省略号）。只动 transform/opacity（GPU 合成，不触发布局）。
// 用法：<span class="x" v-marquee><span>文字</span></span>（外层 overflow:hidden; 内层 inline-block）；
// 非 Vue 渲染的 HTML（高德弹窗）用 mountMarquee(el) / 返回的清理函数。
const SPEED = 32 // px/s
const START_PAUSE = 1500 // 开始滚动前的停顿
const END_PAUSE = 2500 // 滚到末尾后的停顿
const FADE = 350
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }
let seq = 0

// 共享的可见性观察：不在视野里的行暂停
const io =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          const st = e.target._mq
          if (!st) continue
          st.visible = e.isIntersecting
          sync(st)
        }
      })
    : null

function sync(st) {
  if (!st.anim) return
  st.visible && !st.paused ? st.anim.play() : st.anim.pause()
}

function stop(el) {
  el._mq?.anim?.cancel()
  if (el._mq) el._mq.anim = null
  el.classList.remove('mq')
}

function setup(el) {
  const inner = el.firstElementChild
  const st = el._mq
  if (!inner || !st) return
  const sig = `${inner.textContent}|${el.clientWidth}|${reduce.matches}`
  if (sig === st.sig) return
  st.sig = sig
  stop(el)
  if (reduce.matches) return
  const dist = el.scrollWidth - el.clientWidth
  if (dist <= 1) return
  el.classList.add('mq')
  const d = dist + 14 // 末尾多走一点，越过右侧渐隐区
  const scroll = (d / SPEED) * 1000
  const total = START_PAUSE + scroll + END_PAUSE + FADE * 2
  const o = (t) => t / total
  const x = (v) => `translateX(${v}px)`
  st.anim = inner.animate(
    [
      { transform: x(0), opacity: 1, offset: 0 },
      { transform: x(0), opacity: 1, offset: o(START_PAUSE) },
      { transform: x(-d), opacity: 1, offset: o(START_PAUSE + scroll) },
      { transform: x(-d), opacity: 1, offset: o(START_PAUSE + END_PAUSE + scroll) },
      { transform: x(-d), opacity: 0, offset: o(START_PAUSE + END_PAUSE + scroll + FADE) },
      { transform: x(0), opacity: 0, offset: o(START_PAUSE + END_PAUSE + scroll + FADE) },
      { transform: x(0), opacity: 1, offset: 1 },
    ],
    { duration: total, iterations: Infinity, delay: (seq++ % 8) * 1200 }
  )
  sync(st)
}

/** 给一个「外层 overflow:hidden + 内层 inline 文本」的元素挂上跑马灯；返回清理函数 */
export function mountMarquee(el) {
  const st = (el._mq = { sig: '', anim: null, paused: false, visible: !io })
  const host = el.closest('li, [tabindex], a, button') || el
  const pause = () => {
    st.paused = true
    sync(st)
  }
  const play = () => {
    if (host.matches(':hover') || host.contains(document.activeElement)) return
    st.paused = false
    sync(st)
  }
  st.off = [
    ['mouseenter', pause],
    ['mouseleave', play],
    ['focusin', pause],
    ['focusout', () => setTimeout(play)],
  ].map(([ev, fn]) => (host.addEventListener(ev, fn), () => host.removeEventListener(ev, fn)))
  st.ro = new ResizeObserver(() => setup(el))
  st.ro.observe(el)
  io?.observe(el)
  st.onMotion = () => setup(el)
  reduce.addEventListener?.('change', st.onMotion)
  requestAnimationFrame(() => setup(el))
  return () => unmountMarquee(el)
}

export function unmountMarquee(el) {
  if (!el._mq) return
  stop(el)
  el._mq.ro?.disconnect()
  io?.unobserve(el)
  el._mq.off?.forEach((f) => f())
  reduce.removeEventListener?.('change', el._mq.onMotion)
  el._mq = null
}

export const vMarquee = {
  mounted(el) {
    mountMarquee(el)
  },
  updated(el) {
    requestAnimationFrame(() => setup(el))
  },
  beforeUnmount(el) {
    unmountMarquee(el)
  },
}

// 告警内容常以设备名开头（「三楼新风(122)超过更换时间…」）：拼「设备 · 内容」时不重复设备名
export function alarmText(device, content) {
  const d = String(device || '').trim()
  const c = String(content || '').trim()
  if (!d) return c
  if (!c) return d
  // 设备名带编号「三楼新风(122)」而内容只写「三楼新风超过…」时也算重复
  const base = d.replace(/\s*[（(][^）)]*[）)]\s*$/, '')
  for (const p of [d, base]) {
    if (p.length >= 2 && c.startsWith(p)) {
      const rest = c.slice(p.length).replace(/^[\s:：·,，-]+/, '')
      return rest ? `${d} ${rest}` : d
    }
  }
  return `${d} · ${c}`
}
