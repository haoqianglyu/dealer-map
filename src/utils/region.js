import DISTRICTS from '@/data/districts.json'

// region 字段形如 "320000/320200/320211"（省/市/区 行政区划代码）
export function parseRegion(region = '') {
  const [province = '', city = '', district = ''] = String(region).split('/')
  return { province, city, district }
}

export function regionInfo(code) {
  const d = DISTRICTS[code]
  return d ? { code, name: d[0], lng: d[1], lat: d[2] } : null
}

export const regionName = (code, fallback = '未知') => regionInfo(code)?.name || fallback
