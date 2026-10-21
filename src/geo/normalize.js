// 把项目名称（小区 + 楼栋/单元/室号等自由文本）归一到「小区」级别，
// 只用小区名做地理编码，不把门牌、楼栋、房号发给地图服务，也不在页面展示。

const CN_NUM = '一二三四五六七八九十百零〇两壹贰叁肆伍陆柒捌玖拾'
// 第一个出现的「楼栋/单元/房号」标记处截断：阿拉伯数字，或中文数字 + 栋/幢/号楼/单元/室/层/楼
// （中文数字 + 号 不截断，避免误伤「运河一号府」「公园壹号」这类小区名）
const CUT_RE = new RegExp(`(\\d|[A-Za-z]\\d|[${CN_NUM}]+(?:栋|幢|号楼|单元|室|层|楼))`)
const TAIL_RE = /(地下室|办公室|样板间|样板房|展厅|别墅|测试|项目|住宅|[A-Za-z#＃\-－—_~]+)+$/
// 项目名里常混入的系统/产品/用途词（不是小区名的一部分）
const PRODUCT_RE = /三管制|三管式|空气系统|新风系统|新风|三恒|四恒|五恒|两联供|地暖|测试|实验室|样板间|样板房|展厅|展示屏|会议室|办公室/g
// 去掉上述词后若只剩这些泛称，视为无法识别小区
const GENERIC = new Set(['仓库', '公司', '工厂', '车间', '门店', '机房', '设备间', '地下室', '长期'])
const NOISE_RE = /[（(][^）)]*[）)]|[\s.。·•、,，:：;；'"“”‘’/\\|]+/g

export function communityName(raw) {
  let s = String(raw || '').replace(NOISE_RE, '').replace(PRODUCT_RE, '')
  const idx = s.search(CUT_RE)
  if (idx >= 0) s = s.slice(0, idx)
  let prev
  do {
    prev = s
    s = s.replace(TAIL_RE, '').replace(/[号栋幢座弄]+$/, '')
  } while (s !== prev)
  return s.length >= 2 && !GENERIC.has(s) ? s : ''
}

// 地理编码查询串 = 市 + 区 + 小区；同时作为缓存与 geo-overrides.json 的 key
export function geoQuery(cityName, districtName, community) {
  if (!community) return ''
  const prefix = `${cityName || ''}${districtName || ''}`
  // 名称里已带区县名（如「宜兴春晓江南」）时不重复拼接
  return `${prefix}${community}`.replace(/\s+/g, '')
}
