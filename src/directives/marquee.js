// v-marquee：单行文字放不下时横向滚动（代替省略号）。只对真的溢出的行生效。
// 节奏：停 1.5 s → 约 40 px/s 左移到末尾 → 停 1.5 s → 淡出回到开头 → 循环；各行错开起始时间。
// 悬停/聚焦所在行时暂停；prefers-reduced-motion 时不滚动（保留省略号）。只动 transform/opacity（GPU 合成，不触发布局）。
// 用法：<span class="x" v-marquee><span>文字</span></span>（外层 overflow:hidden; 内层 inline-block）
const SPEED = 40 // px/s
const PAUSE = 1500
const FADE = 350
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }
let seq = 0

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
  const total = PAUSE + scroll + PAUSE + FADE * 2
  const o = (t) => t / total
  const x = (v) => `translateX(${v}px)`
  st.anim = inner.animate(
    [
      { transform: x(0), opacity: 1, offset: 0 },
      { transform: x(0), opacity: 1, offset: o(PAUSE) },
      { transform: x(-d), opacity: 1, offset: o(PAUSE + scroll) },
      { transform: x(-d), opacity: 1, offset: o(PAUSE * 2 + scroll) },
      { transform: x(-d), opacity: 0, offset: o(PAUSE * 2 + scroll + FADE) },
      { transform: x(0), opacity: 0, offset: o(PAUSE * 2 + scroll + FADE) },
      { transform: x(0), opacity: 1, offset: 1 },
    ],
    { duration: total, iterations: Infinity, delay: (seq++ % 6) * 900 }
  )
  if (st.paused) st.anim.pause()
}

export const vMarquee = {
  mounted(el) {
    const st = (el._mq = { sig: '', anim: null, paused: false })
    const host = el.closest('li, [tabindex], a, button') || el
    const pause = () => {
      st.paused = true
      st.anim?.pause()
    }
    const play = () => {
      if (host.matches(':hover') || host.contains(document.activeElement)) return
      st.paused = false
      st.anim?.play()
    }
    st.off = [
      ['mouseenter', pause],
      ['mouseleave', play],
      ['focusin', pause],
      ['focusout', () => setTimeout(play)],
    ].map(([ev, fn]) => (host.addEventListener(ev, fn), () => host.removeEventListener(ev, fn)))
    st.ro = new ResizeObserver(() => setup(el))
    st.ro.observe(el)
    st.onMotion = () => setup(el)
    reduce.addEventListener?.('change', st.onMotion)
    requestAnimationFrame(() => setup(el))
  },
  updated(el) {
    requestAnimationFrame(() => setup(el))
  },
  beforeUnmount(el) {
    stop(el)
    el._mq?.ro?.disconnect()
    el._mq?.off?.forEach((f) => f())
    reduce.removeEventListener?.('change', el._mq?.onMotion)
    el._mq = null
  },
}
