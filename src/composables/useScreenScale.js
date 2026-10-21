// 大屏适配（与 niuniu DashboardLayout 相同）：按 1920×1080 设计稿布局，整体 transform 缩放铺满视口，
// X / Y 分别缩放（与 niuniu 一致，不留黑边），任何窗口尺寸看起来都一样。
import { ref, onMounted, onBeforeUnmount } from 'vue'

export const DESIGN_W = 1920
export const DESIGN_H = 1080

export function useScreenScale() {
  const style = ref({ width: `${DESIGN_W}px`, height: `${DESIGN_H}px`, transform: 'scale(1) translate(-50%, -50%)' })
  const resize = () => {
    const w = document.documentElement.clientWidth || window.innerWidth
    const h = document.documentElement.clientHeight || window.innerHeight
    style.value = { width: `${DESIGN_W}px`, height: `${DESIGN_H}px`, transform: `scale(${w / DESIGN_W}, ${h / DESIGN_H}) translate(-50%, -50%)` }
  }
  onMounted(() => {
    resize()
    window.addEventListener('resize', resize)
  })
  onBeforeUnmount(() => window.removeEventListener('resize', resize))
  return style
}
