import { onMounted, onBeforeUnmount } from 'vue'
import { session } from '@/api/session'
import { refreshSession } from '@/api/http'

// token 有效期 2 小时：超过 118 分钟主动续期（与 bigscreen_fable 一致），大屏可长时间挂着
export function useTokenRefresh() {
  let timer = null
  onMounted(() => {
    timer = setInterval(() => {
      const t = session.tokenTime()
      if (!t || Date.now() - t <= 118 * 60 * 1000) return
      refreshSession().catch((e) => console.warn('刷新 token 失败', e?.message))
    }, 30 * 1000)
  })
  onBeforeUnmount(() => clearInterval(timer))
}
