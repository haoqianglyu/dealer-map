import { parseRegion, regionInfo } from '@/utils/region'
import { appTypeName } from '@/utils/format'
import DISTRICTS from '@/data/districts.json'
import { communityParts, geoQuery, mergeAliases } from './normalize'

// 状态是位掩码：1 已创建 | 2 已交付 | 4 已验收（/v1/project-statuses）
export function statusName(status, delivered) {
  const s = Number(status) || 0
  if (s & 4) return '已验收'
  if (s & 2 || delivered) return '已交付'
  return '已创建'
}

// 把两种接口（/ctrl/projects 与 /project/new-list）的项目统一成页面所需的最小字段。
// 不保留客户姓名、电话、门牌等字段。
export function toProject(raw) {
  const region = parseRegion(raw.customer_region || raw.region)
  const ctx = { city: region.city, regions: DISTRICTS }
  const fromName = communityParts(raw.name, ctx)
  const fromAddr = communityParts(raw.customer_address, ctx)
  // 名称开头的市 / 区县前缀是更可靠的位置提示（「太仓市天悦湾」填在吴中区）：
  // 区县级 → 项目改归该区县；市级 → 在该市范围内查（同市时展示仍用所填区县）
  const hint = fromName.hint || fromAddr.hint || ''
  let { province, city: cityCode, district: districtCode } = region
  let geoDistrict = districtCode
  if (hint && !/00$/.test(hint)) {
    cityCode = /^(11|12|31|50)/.test(hint) ? `${hint.slice(0, 2)}0100` : `${hint.slice(0, 4)}00`
    province = `${hint.slice(0, 2)}0000`
    districtCode = geoDistrict = hint
  } else if (hint) {
    if (hint !== cityCode) districtCode = ''
    cityCode = hint
    province = `${hint.slice(0, 2)}0000`
    geoDistrict = ''
  }
  const city = regionInfo(cityCode)
  const district = regionInfo(districtCode)
  const geoDist = regionInfo(geoDistrict)
  // 以 name 为主（小区名 + 楼/户号），customer_address 作为第二候选
  const communities = [...new Set([fromName.name, fromAddr.name].filter(Boolean))]
  const queries = communities.map((c) => geoQuery(city?.name, geoDist?.name, c))
  const vague = communities.length ? '' : fromName.vague || fromAddr.vague
  const created = raw.created_at || raw.create_time || ''
  const rawName = String(raw.name || '').trim()
  return {
    id: raw.id,
    name: rawName, // 小区+户号原文：仅在登录后的小区弹窗里显示，不写入缓存/日志
    state: 'normal', // normal | offline | warning | alarm（见 geo/states.js）
    alarmCount: 0,
    newAlarm: false,
    community: communities[0] || '',
    queries,
    keywords: communities, // 小区名（不带市区前缀），用于 POI 搜索兜底
    vague, // 名字只剩区县 / 镇名：不查，进待校正「名字太泛」
    province,
    city: cityCode,
    cityName: city?.name || '',
    district: district ? districtCode : '', // 展示 / 统计用区县（表里没有的代码按「区县未填」处理：不在地图上画一个叫「区县未填」的圈）
    districtName: district?.name || '区县未填',
    geoDistrict, // 地理编码范围（区县 adcode；'' = 全市范围）
    type: appTypeName(raw.app_name),
    category: raw.app_category_name || '',
    status: statusName(raw.status, raw.is_delivered),
    area: Number(raw.building_area) || 0,
    rooms: Number(raw.brief_stat?.room_count ?? raw.room_count) || 0,
    devices: Number(raw.brief_stat?.device_count ?? raw.device_count) || 0,
    created,
    month: created.slice(0, 7),
    enabled: raw.enabled !== false,
    // 高德 Geocoder / POI 的 city 参数：区县 adcode 限定在该区内；全市范围时直辖市要用 xx0000（高德没有 310100 这类「市辖区」码）
    geoCity: geoDistrict || (/^(11|12|31|50)/.test(cityCode) ? `${cityCode.slice(0, 2)}0000` : cityCode),
    year: created.slice(0, 4),
    distributorId: raw.distributor_id || '',
    distributorName: raw.distributor_name || '',
  }
}

// 同一个小区被归一化成两个 key 时合并（normalize.mergeAliases）
export const mergeDeveloperAliases = (projects) => mergeAliases(projects, (code) => regionInfo(code)?.name)
