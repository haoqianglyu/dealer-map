// 详情页状态文案（纯函数）：加载中 / 失败 / 真正的「没有」要分开，查询失败不能说成「无告警」「未配置」「离线」。
const hm = (ms) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// view = createAlarmTracker 的视图：{ alarms, okAt, staleSince, error }
export function alarmDisplay(loaded, view) {
  if (!loaded) return { state: 'loading', text: '告警查询中…' }
  if (view.error === 'forbidden') return { state: 'error', text: '无告警查看权限' }
  if (view.error) return { state: 'error', text: view.okAt ? `告警查询失败，${hm(view.okAt)} 起未更新` : '告警查询失败，正在重试' }
  if (view.staleSince) return { state: 'stale', text: `告警 ${hm(view.okAt)} 未更新` }
  if (!view.alarms.length) return { state: 'empty', text: '10 天内无一级告警' }
  return { state: 'ok', text: '' }
}

// 在线列表（查询 30）：没有结果时，查询中 / 查询失败都是「不知道」，不是离线
export function onlineStateOf(st30, hasList, inList) {
  if (hasList) return inList ? 'on' : 'off'
  return st30 === 'loading' || st30 === 'idle' ? 'querying' : 'unknown'
}
export const ONLINE_LABEL = { on: '在线', off: '离线', unknown: '未知', querying: '查询中' }

// 顶部实时状态：现场设备未响应（超时）与查询失败（网络 / 权限）分开
export function liveFailText(st41, st30) {
  if (st41 === 'timeout' || st30 === 'timeout') return { text: '现场设备未响应', dot: 'off' }
  return { text: '实时查询失败', dot: '' }
}
