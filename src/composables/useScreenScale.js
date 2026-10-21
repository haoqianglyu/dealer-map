// 全站统一的屏幕适配（地图页叠加层 + 项目详情页共用）：
// 按 1920×1080 设计稿排版，等比缩放 s = min(视口宽/1920, 视口高/1080)，两页用同一个 s，字号一致。
// 画布逻辑尺寸 = 视口 / s（铺满视口、不留黑边，多出的方向由弹性布局吸收）。
// 下限 MIN_SCALE：小窗口（如 1350×700 笔记本）不再继续缩小，12px 字至少约 10px；
// 此时逻辑画布小于设计稿，地图页右侧栏 / 详情页整页改为滚动。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

export const DESIGN_W = 1920
export const DESIGN_H = 1080
export const MIN_SCALE = 0.85

function viewport() {
  return {
    w: document.documentElement.clientWidth || window.innerWidth,
    h: document.documentElement.clientHeight || window.innerHeight,
  }
}
function scaleFor({ w, h }) {
  return Math.max(MIN_SCALE, Math.min(w / DESIGN_W, h / DESIGN_H))
}

// 当前缩放（模块级，供 EChart 按缩放提高画布分辨率，放大时不发虚）
export const uiScale = ref(scaleFor(viewport()))

/**
 * @param {{ minW?: number, minH?: number }} opts 逻辑画布最小尺寸（不足时外层滚动）
 * @returns {{ scale, style }} style：绝对定位于左上角的逻辑画布（width/height/transform）
 */
export function useScreenScale({ minW = 0, minH = 0 } = {}) {
  const vp = ref(viewport())
  const resize = () => {
    vp.value = viewport()
    uiScale.value = scaleFor(vp.value)
  }
  onMounted(() => {
    resize()
    window.addEventListener('resize', resize)
  })
  onBeforeUnmount(() => window.removeEventListener('resize', resize))
  const scale = computed(() => scaleFor(vp.value))
  const style = computed(() => {
    const s = scale.value
    const w = Math.max(minW, vp.value.w / s)
    const h = Math.max(minH, vp.value.h / s)
    return {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${w}px`,
      height: `${h}px`,
      transform: `scale(${s})`,
      transformOrigin: '0 0',
      '--ui-scale': s,
    }
  })
  return { scale, style }
}
