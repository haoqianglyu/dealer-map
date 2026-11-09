import { ref, onMounted, onBeforeUnmount } from 'vue'

// 全屏：标准 API 优先，webkit 前缀兼容旧版安卓浏览器。
// 浏览器要求必须由用户点击触发；iPhone Safari 不支持网页全屏，此时 supported 为 false。
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null

export function useFullscreen() {
  const root = document.documentElement
  const supported = Boolean(
    (document.fullscreenEnabled || document.webkitFullscreenEnabled) &&
      (root.requestFullscreen || root.webkitRequestFullscreen),
  )
  const isFullscreen = ref(Boolean(fullscreenElement()))

  const sync = () => {
    isFullscreen.value = Boolean(fullscreenElement())
  }

  const toggle = async () => {
    try {
      if (fullscreenElement()) {
        await (document.exitFullscreen || document.webkitExitFullscreen).call(document)
      } else if (root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: 'hide' })
      } else {
        await root.webkitRequestFullscreen()
      }
    } catch (err) {
      console.warn('切换全屏失败', err)
    }
  }

  onMounted(() => {
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    sync()
  })
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', sync)
    document.removeEventListener('webkitfullscreenchange', sync)
  })

  return { supported, isFullscreen, toggle }
}
