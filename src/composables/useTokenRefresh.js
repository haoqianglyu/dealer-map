import { session } from '@/api/session'
import { refreshSession } from '@/api/http'
import { createTokenScheduler } from '@/api/tokenScheduler'

// 全局主动续期（main.js 启动一次，登录页 / 地图 / 详情页都生效）：token 到期前约 5 分钟续期，大屏可一直挂着直到「退出」
export function startTokenRefresh() {
  const sch = createTokenScheduler({
    session,
    refresh: () => refreshSession(),
    onError: (e) => console.warn('主动续期失败，1 分钟后重试', e?.message),
  })
  session.onChange(() => sch.reschedule()) // 本页登录 / 续期 / 退出
  // 别的标签页：续期 → 只重排；退出 / 换账号登录（sid 变了）→ 整页重载，不留上一个会话的账号数据
  let sid = session.sid()
  window.addEventListener('storage', (e) => {
    if (e.key != null && !Object.values(session.KEYS).includes(e.key)) return
    if (session.sid() !== sid && !location.hash.startsWith('#/login')) return location.reload()
    sid = session.sid()
    sch.reschedule()
  })
  session.onChange(() => (sid = session.sid()))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sch.onVisible())
  window.addEventListener('pageshow', (e) => e.persisted && sch.onVisible())
  sch.start()
  if (import.meta.env.DEV) window.__dmTokenScheduler = sch
  return sch
}
