// 展示模式（?showroom=1）：对外演示时隐去户号与客户姓名/电话。默认关闭，暂无 UI 开关。
import { communityName } from '../geo/normalize.js'

// 进入展示模式后写进会话（sessionStorage）：跳到详情页、自动重载后仍保持，直到 ?showroom=0 或关闭标签页。
export const parseShowroom = (qs, stored) => (/(^|[?&])showroom=1(&|$)/.test(qs) ? true : /(^|[?&])showroom=0(&|$)/.test(qs) ? false : stored)
const KEY = 'dm_showroom'
export function isShowroom() {
  const qs = location.search + '&' + (location.hash.split('?')[1] || '')
  let stored = false
  try {
    stored = sessionStorage.getItem(KEY) === '1'
  } catch {
    /* 存储不可用：只看 URL */
  }
  const on = parseShowroom(qs, stored)
  if (on !== stored) {
    try {
      on ? sessionStorage.setItem(KEY, '1') : sessionStorage.removeItem(KEY)
    } catch {
      /* 同上 */
    }
  }
  return on
}
// 项目名「小区 + 楼栋户号」→ 展示模式下只留小区名
export const showName = (name) => (isShowroom() ? `${communityName(name) || '项目'} · ***` : name || '')
export const showPerson = (s) => (isShowroom() ? (s ? `${String(s).slice(0, 1)}**` : '') : s || '')
export const showPhone = (s) => (isShowroom() ? (s ? String(s).replace(/^(\d{3})\d+(\d{2})$/, '$1******$2') : '') : s || '')
