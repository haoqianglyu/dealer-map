// 展示模式（?showroom=1）：对外演示时隐去户号与客户姓名/电话。默认关闭，暂无 UI 开关。
import { communityName } from '@/geo/normalize'

export function isShowroom() {
  const q = location.search + '&' + (location.hash.split('?')[1] || '')
  return /(^|[?&])showroom=1(&|$)/.test(q)
}
// 项目名「小区 + 楼栋户号」→ 展示模式下只留小区名
export const showName = (name) => (isShowroom() ? `${communityName(name) || '项目'} · ***` : name || '')
export const showPerson = (s) => (isShowroom() ? (s ? `${String(s).slice(0, 1)}**` : '') : s || '')
export const showPhone = (s) => (isShowroom() ? (s ? String(s).replace(/^(\d{3})\d+(\d{2})$/, '$1******$2') : '') : s || '')
