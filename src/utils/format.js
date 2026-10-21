// 软件类型展示名（与 bigscreen_fable 一致）
export function appTypeName(appName) {
  if (appName === '通用版') return '辐射空调'
  if (appName === '水舒适') return '定制版'
  return appName || '未知'
}

export function fmtNumber(n, digits = 0) {
  const v = Number(n) || 0
  return v.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

export function fmtArea(m2) {
  const v = Number(m2) || 0
  return v >= 10000 ? `${(v / 10000).toFixed(2)} 万㎡` : `${fmtNumber(v)} ㎡`
}
