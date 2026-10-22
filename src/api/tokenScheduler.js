// 主动续期：在 access_token 到期前约 5 分钟续期（有效期很短时取 1/4），续完按新的过期时间重新排期；
// 标签页重新可见（电脑睡眠 / 切后台时定时器会被推迟）时若已临近或过期，立即续期。
// 续期失败不登出：1 分钟后再试；真的失效由接口 401/403 的被动续期兜底（再失败才回登录页）。
const LEAD_MAX = 5 * 60 * 1000
const RETRY = 60 * 1000

export function leadFor(life) {
  return Math.min(LEAD_MAX, Math.max(0, life) / 4)
}

// deps：{ session, refresh, now?, setTimeout?, clearTimeout?, onError? }
export function createTokenScheduler({ session, refresh, now = () => Date.now(), setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout, onError }) {
  let timer = null
  let stopped = false
  const dueAt = () => {
    const exp = session.expiresAt()
    if (!session.token() || !exp) return null
    const life = exp - (session.tokenTime() || exp - 2 * 60 * 60 * 1000)
    return exp - leadFor(life)
  }
  function schedule(delay) {
    ct(timer)
    timer = null
    if (stopped) return
    const due = dueAt()
    if (due == null) return
    timer = st(run, Math.max(0, delay ?? due - now()))
  }
  async function run() {
    timer = null
    if (stopped || !session.token()) return
    const due = dueAt()
    if (due != null && due > now()) return schedule() // 别的标签页已续过 / 定时器提前醒
    try {
      await refresh()
      schedule()
    } catch (e) {
      onError && onError(e)
      schedule(RETRY)
    }
  }
  // 可见时：已到续期点（含已过期）立即续，否则按时重排（睡眠后 setTimeout 可能已漂移）
  function onVisible() {
    const due = dueAt()
    if (due == null) return
    if (due <= now()) {
      ct(timer)
      run()
    } else schedule()
  }
  return {
    start() {
      stopped = false
      schedule()
    },
    stop() {
      stopped = true
      ct(timer)
      timer = null
    },
    reschedule: () => schedule(),
    onVisible,
    pending: () => timer != null,
  }
}
