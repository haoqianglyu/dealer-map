<template>
  <canvas ref="cv" />
</template>

<script setup>
// 登录舞台灯光（预烘焙的粗粒度灯光点，仅 0.01° 网格计数，无小区名）：登录页舞台与地图页加载罩共用，
// 登录 → 地图时两处画在同一位置，交叉淡化看起来是同一片灯光（docs/fable-review-round5.md 第 3 条）。
// 复用热力暖光的三层径向渐变 + lighter 叠加，4 s 缓慢呼吸；亮色「墨染」multiply。尺寸 / 位置 / 透明度由父级 CSS 决定
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import LIGHTS from '@/assets/login-lights.json'
import { theme } from '@/composables/useTheme'

// k：灯光半径的像素倍数。登录页画布在缩放的逻辑画布里（自动 × 屏幕比例）；加载罩不在缩放层里，传屏幕比例让两处一样大
const props = defineProps({ k: { type: Number, default: 1 } })
const cv = ref(null)
let raf = 0
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const HALO = [255, 184, 87]
const CORE = [255, 222, 158]
const FIL = [255, 245, 219]
// 亮色「墨染」（§5.3）：赭石三色，元素与层内都 multiply
const INK = { halo: [196, 138, 46], core: [168, 106, 24], fil: [107, 61, 8], a: [0.32, 0.5, 0.9], op: 'multiply' }
const GLOW = { halo: HALO, core: CORE, fil: FIL, a: [0.42, 0.6, 0.9], op: 'lighter' }
function glow(ctx, x, y, r, [R, G, B], a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${R},${G},${B},${a})`)
  g.addColorStop(0.5, `rgba(${R},${G},${B},${a / 2})`)
  g.addColorStop(1, `rgba(${R},${G},${B},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
function draw(t = 0) {
  const c = cv.value
  if (!c) return
  const w = c.clientWidth
  const h = c.clientHeight
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const m = theme.value === 'light' ? INK : GLOW
  const blend = m === INK ? 'multiply' : ''
  if (c.style.mixBlendMode !== blend) c.style.mixBlendMode = blend
  ctx.globalCompositeOperation = m.op
  const k = (h * 0.95) / 1.6 // 像素 / 纬度
  const cx = w * 0.55
  const cy = h * 0.52
  const breath = reduced ? 1 : 0.92 + 0.08 * Math.sin((t / 4000) * Math.PI * 2)
  for (const [lng, lat, n] of LIGHTS) {
    const x = cx + (lng - 120.3) * k * 0.853
    const y = cy - (lat - 31.55) * k
    if (x < -40 * props.k || y < -40 * props.k || x > w + 40 * props.k || y > h + 40 * props.k) continue
    const r = (10 + Math.sqrt(n) * 9) * props.k
    glow(ctx, x, y, r, m.halo, m.a[0] * breath)
    glow(ctx, x, y, Math.min(r * 0.3, 7 * props.k), m.core, m.a[1])
    glow(ctx, x, y, 2.4 * props.k, m.fil, m.a[2])
  }
  ctx.globalCompositeOperation = 'source-over'
  if (!reduced) raf = requestAnimationFrame(draw)
}
// 减少动态效果时只画一帧：换主题 / 改尺寸时补画
const redraw = () => reduced && draw()
watch(theme, redraw)
onMounted(() => {
  raf = requestAnimationFrame(draw)
  window.addEventListener('resize', redraw)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', redraw)
})
</script>
