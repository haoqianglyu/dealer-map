// 热力「暖光」图层（Bloom warm lights 风格）：每个已确认小区一盏灯，项目越多越亮越大。
// 三层同色系径向渐变（外晕琥珀 / 中芯浅金 / 灯丝近白），每层 α：峰值 → 峰值/2 → 0；
// 叠加混合（'lighter'），相邻灯光叠亮。半径按米换算成像素，随缩放变化，远景下有最小像素。
// 调色：项目 = Bloom 暖金；告警 = 同模型的暖红系（两种模式一眼可分）
export const PALETTES = {
  gold: { halo: [255, 184, 87], core: [255, 222, 158], filament: [255, 245, 219] }, // #FFB857 #FFDE9E #FFF5DB
  red: { halo: [255, 106, 61], core: [255, 176, 112], filament: [255, 240, 224] }, // #FF6A3D #FFB070 #FFF0E0
  // 亮色「墨染」（docs/fable-light-theme.md §5）：canvas 元素 multiply 到底图上，层内也 multiply（重叠处积深）
  ochre: { halo: [196, 138, 46], core: [168, 106, 24], filament: [107, 61, 8] }, // #C48A2E #A86A18 #6B3D08
  crimson: { halo: [198, 40, 60], core: [160, 22, 44], filament: [94, 10, 28] }, // #C6283C #A0162C #5E0A1C
}
// 每种调色的混合方式与三层 α 系数（深色 gold / red 的值 = 原值，零变化）
const INK = { blend: 'multiply', halo: 0.4, core: 0.55, filament: null, filamentFixed: 0.92, dim: false }
const GLOW = { blend: 'lighter', halo: 0.55, core: 0.62, filament: 1, filamentFixed: null, dim: true }
const MODE = { gold: GLOW, red: GLOW, ochre: INK, crimson: INK }

// 5 档：count 下限 → 峰值 α、外晕半径（米）、远景最小外晕像素；大小主要靠外晕增长，芯与灯丝保持很小
const TIERS = [
  { min: 20, peak: 0.95, r: 200, minPx: 68, idx: 4 },
  { min: 10, peak: 0.86, r: 160, minPx: 52, idx: 3 },
  { min: 5, peak: 0.78, r: 125, minPx: 40, idx: 2 },
  { min: 2, peak: 0.7, r: 95, minPx: 30, idx: 1 },
  { min: 1, peak: 0.62, r: 70, minPx: 22, idx: 0 },
]
export const tierOf = (n) => TIERS.find((t) => n >= t.min)

function glow(ctx, x, y, radius, [r, g, b], peak) {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
  grad.addColorStop(0, `rgba(${r},${g},${b},${peak})`)
  grad.addColorStop(0.5, `rgba(${r},${g},${b},${peak / 2})`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

// lights: [{ lnglat, count, pulse }]；pulse = 有进行中告警（外晕 2 秒缓慢呼吸）
export function createWarmLights(AMap, map) {
  const canvas = document.createElement('canvas')
  canvas.style.pointerEvents = 'none' // 只是画光，不能挡住标记的点击
  const layer = new AMap.CustomLayer(canvas, { zIndex: 110, zooms: [3, 20], alwaysRender: true })
  // 告警数字：亮色时光层 multiply（白描边会消失），数字画在第二张不混合的 canvas 上
  const labelCanvas = document.createElement('canvas')
  labelCanvas.style.pointerEvents = 'none'
  const labelLayer = new AMap.CustomLayer(labelCanvas, { zIndex: 111, zooms: [3, 20], alwaysRender: true })
  let lights = []
  let paletteName = 'gold'
  let palette = PALETTES.gold
  let visible = false
  let raf = 0

  // 高德把 canvas 包在带 z-index 的 .amap-layer 里（独立层叠上下文），只给 canvas 设 multiply 只会和透明的父层相乘；
  // 所以父层也设（父层与瓦片 canvas 同在 .amap-layers 内，真正乘到底图上）。父层在首次渲染时才挂上，draw 里补一次
  const blendEl = () => {
    const v = MODE[paletteName].blend === 'multiply' ? 'multiply' : ''
    for (const el of [canvas, canvas.parentElement]) if (el && el.style.mixBlendMode !== v) el.style.mixBlendMode = v
  }
  const fit = (cv, w, h, dpr) => {
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr
      cv.height = h * dpr
      cv.style.width = `${w}px`
      cv.style.height = `${h}px`
    }
    const c = cv.getContext('2d')
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, w, h)
    return c
  }

  function draw() {
    raf = 0
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    const w = size.width
    const h = size.height
    const mode = MODE[paletteName] || GLOW
    const ink = mode.blend === 'multiply'
    blendEl()
    const ctx = fit(canvas, w, h, dpr)
    const lctx = ink ? fit(labelCanvas, w, h, dpr) : null
    if (!ink && labelCanvas.width) {
      labelCanvas.width = 0 // 深色：数字仍画在光层上（原样），第二张清空
      labelCanvas.height = 0
    }
    if (!visible) return
    // 轻微压暗底图（不能太重，否则底图地名/道路看不清）；亮色 multiply 下不画
    if (mode.dim) {
      ctx.fillStyle = 'rgba(14, 14, 16, 0.28)'
      ctx.fillRect(0, 0, w, h)
    }
    if (!lights.length) return
    const res = map.getResolution() // 米/像素（视野中心）
    // 远景（zoom < 12）按 2^((zoom−12)·0.4) 缩小最小像素，城市级视图里各小区灯光才分得开
    const zoomScale = Math.min(2, Math.max(1, Math.pow(2, (map.getZoom() - 12) * 0.4))) // 近景放大（最多 2 倍），远景不再缩小（城市级要读得出热）
    // 密集处降低外晕 α：按 24px 网格统计邻近灯数
    const cell = 24
    const pts = lights.map((l) => ({ l, px: map.lngLatToContainer(l.lnglat) }))
    const grid = new Map()
    for (const { px } of pts) {
      const k = `${Math.floor(px.x / cell)},${Math.floor(px.y / cell)}`
      grid.set(k, (grid.get(k) || 0) + 1)
    }
    const density = (px) => {
      const cx = Math.floor(px.x / cell)
      const cy = Math.floor(px.y / cell)
      let n = 0
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) n += grid.get(`${cx + dx},${cy + dy}`) || 0
      return n
    }
    ctx.globalCompositeOperation = mode.blend
    const now = performance.now()
    const breath = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin((now / 2000) * Math.PI * 2)) // 2 秒一个周期
    let pulsing = false
    const { halo, core, filament } = palette
    // 小灯先画，大灯后画
    for (const { l, px } of pts.sort((a, b) => a.l.count - b.l.count)) {
      const t = tierOf(l.count)
      if (!t) continue
      const R = Math.max(t.r / res, Math.max(8, t.minPx * zoomScale))
      const crowd = Math.max(0.6, 1 / (1 + 0.12 * (density(px) - 1)))
      if (px.x < -R || px.y < -R || px.x > w + R || px.y > h + R) continue
      // 外晕：宽、很柔、低饱和；芯：小；灯丝：极小的近白亮点（各档几乎同大）
      if (l.pulse) pulsing = true
      glow(ctx, px.x, px.y, R, halo, t.peak * mode.halo * crowd * (l.pulse ? breath : 1))
      glow(ctx, px.x, px.y, Math.min(R * 0.22, 6 + t.idx * 1.2), core, t.peak * mode.core)
      glow(ctx, px.x, px.y, 2.6 + t.idx * 0.45, filament, mode.filamentFixed ?? t.peak * mode.filament)
    }
    ctx.globalCompositeOperation = 'source-over'
    // 告警热力：灯心标注进行中条数（亮色：第二张 canvas，深墨红字 + 白描边）
    const tctx = lctx || ctx
    tctx.font = '600 12px "DM Num", "PingFang SC", sans-serif'
    tctx.textAlign = 'center'
    tctx.textBaseline = 'middle'
    for (const { l, px } of pts) {
      if (!l.label || px.x < 0 || px.y < 0 || px.x > w || px.y > h) continue
      tctx.lineWidth = 3
      tctx.strokeStyle = ink ? 'rgba(255, 255, 255, 0.92)' : 'rgba(40, 10, 4, 0.75)'
      tctx.strokeText(String(l.label), px.x, px.y - 14)
      tctx.fillStyle = ink ? '#5a0a18' : '#FFF0E0'
      tctx.fillText(String(l.label), px.x, px.y - 14)
    }
    if (pulsing) schedule() // 有呼吸灯时持续逐帧重绘
  }
  const syncLabel = () => (visible && MODE[paletteName].blend === 'multiply' ? labelLayer.show() : labelLayer.hide())
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw)
  }
  layer.render = schedule
  labelLayer.render = schedule
  map.add(layer)
  map.add(labelLayer)
  labelLayer.hide()
  map.on('mapmove', schedule)
  map.on('zoomchange', schedule)
  map.on('resize', schedule)

  return {
    set(next, name = 'gold') {
      lights = next
      paletteName = PALETTES[name] ? name : 'gold'
      palette = PALETTES[paletteName]
      // 元素层混合：亮色 multiply 到底图（canvas 内部的 composite 管不到瓦片）；深色 normal（原样）
      blendEl()
      syncLabel()
      schedule()
    },
    show(v) {
      visible = v
      v ? layer.show() : layer.hide() // 点位模式下整层隐藏
      syncLabel()
      schedule()
    },
    destroy() {
      cancelAnimationFrame(raf)
      map.off('mapmove', schedule)
      map.off('zoomchange', schedule)
      map.off('resize', schedule)
      map.remove(layer)
      map.remove(labelLayer)
    },
  }
}
