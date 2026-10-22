// 告警轮询的「沿用旧数据」策略（docs/fable-review-round5.md 第 1 条）：
// 失败一次不清数据 —— 过期 1 分钟的 23 条告警远比「0 条 = 一切正常」接近真相。
//  · 距上次成功 < STALE_MS：保留上次成功的列表与时间，标 stale（状态行「告警 hh:mm 未更新」）；
//  · STALE_MS ≤ 距上次成功 < EXPIRE_MS：仍保留（地图角标 / 红圈不掉），aged = true（面板顶部灰条「自 hh:mm 起无法更新告警」、列表变淡）；
//  · 距上次成功 ≥ EXPIRE_MS 且仍失败：清空列表并进入明确的错误态（面板写「自 hh:mm 起无法更新」，绝不显示「系统运行正常」）；
//  · 403（续期后仍 403 = 真无权限）：立即清空；
//  · 成功：stale 归零。
// 失败后的单独重试间隔：10 s → 20 s → 40 s → 60 s（封顶），成功后重置。
export const STALE_MS = 5 * 60 * 1000
export const EXPIRE_MS = 30 * 60 * 1000
export const RETRY_MS = [10000, 20000, 40000, 60000]
export const retryDelay = (fails) => RETRY_MS[Math.min(Math.max(fails, 1), RETRY_MS.length) - 1]

// view：{ alarms, okAt, staleSince, aged, error }
//  error：'' | 'forbidden' | 'expired'（stale 超时） | 'failed'（从未成功过）
export function createAlarmTracker({ now = () => Date.now() } = {}) {
  let alarms = []
  let okAt = 0
  let staleSince = 0
  let error = ''
  let fails = 0
  const view = () => ({ alarms, okAt, staleSince, aged: Boolean(staleSince && okAt && !error && now() - okAt >= STALE_MS), error, fails })
  const expire = () => {
    if (staleSince && okAt && error === '' && now() - okAt >= EXPIRE_MS) {
      alarms = []
      error = 'expired'
    }
  }
  return {
    ok(list) {
      alarms = list
      okAt = now()
      staleSince = 0
      error = ''
      fails = 0
      return view()
    },
    fail(status) {
      fails++
      if (status === 403) {
        alarms = []
        okAt = 0
        staleSince = 0
        error = 'forbidden'
        return view()
      }
      if (!staleSince) staleSince = now()
      if (!okAt) {
        // 从未成功过：没有可沿用的数据
        error = 'failed'
        return view()
      }
      expire()
      return view()
    },
    // 读取时也检查过期（轮询卡住 / 请求挂起时，到点同样变 aged / 进入错误态）
    current() {
      expire()
      return view()
    },
  }
}
