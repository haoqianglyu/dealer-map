// 把项目名称（小区 + 楼栋/单元/室号等自由文本）归一到「小区」级别，
// 只用小区名做地理编码，不把门牌、楼栋、房号发给地图服务，也不在页面展示。

const CN_NUM = '一二三四五六七八九十百零〇两壹贰叁肆伍陆柒捌玖拾'
// 第一个出现的「楼栋/单元/房号」标记处截断：阿拉伯数字，或中文数字 + 栋/幢/号楼/单元/室/层/楼
// （中文数字 + 号 不截断，避免误伤「运河一号府」「公园壹号」这类小区名）
const CUT_RE = new RegExp(`(\\d|[A-Za-z]\\d|[${CN_NUM}]+(?:栋|幢|号楼|单元|室|层|楼))`)
// 「别墅」不在此列：海源别墅、金臣别墅 这类「别墅」是小区名的一部分（只去掉「自建别墅/自建房」）
const TAIL_RE = /(地下室|办公室|样板间|样板房|展厅|自建别墅|自建房|自建|测试|项目|住宅|[A-Za-z#＃\-－—_~]+)+$/
// 截断后残留在末尾的楼栋标记只在前面是字母/#时才是户号（「A栋」「B座」「#号」）；
// 「蠡湖一号99」「花园弄99」里号/弄在户号数字之前，是小区/弄堂名的一部分，不能剥
const UNIT_TAIL_RE = /[A-Za-z#＃]+[号栋幢座]$/
// 只剩分期/分区（「B区」「东二区」「三期」）不是小区名
const PHASE_ONLY_RE = new RegExp(`^[东西南北中]?(?:[A-Za-z]|[${CN_NUM}]+)?[区期]$`)
// 项目名里常混入的系统/产品/用途词（不是小区名的一部分）
const PRODUCT_RE = /三管制|三管式|空气系统|新风系统|新风|三恒|四恒|五恒|两联供|地暖|测试|实验室|样板间|样板房|展厅|展示屏|会议室|办公室/g
// 去掉上述词后若只剩这些泛称，视为无法识别小区
const GENERIC = new Set(['仓库', '公司', '工厂', '车间', '门店', '机房', '设备间', '地下室', '长期'])
const NOISE_RE = /[（(][^）)]*[）)]|[\s.。·•、,，:：;；'"“”‘’/\\|]+/g

// 分期/分区是不同小区，必须保留：先把「3期」「2区」转成中文数字，避免被下面的「数字处截断」切掉
const CN_D = '零一二三四五六七八九'
const cnNum = (d) => {
  const n = Number(d)
  if (n > 99) return d
  if (n <= 10) return n === 10 ? '十' : CN_D[n]
  return (n >= 20 ? CN_D[Math.floor(n / 10)] : '') + '十' + (n % 10 ? CN_D[n % 10] : '')
}

// 多行地址（同一字段里重复写了几遍、或第二行是路名）逐行归一化，取第一行能识别出小区的，
// 避免把几行拼成「宝格丽宝格丽」「生普生普群星路」
export function communityName(raw) {
  for (const line of String(raw || '').split(/[\r\n]+/)) {
    const c = lineCommunity(line)
    if (c) return c
  }
  return ''
}

// 规则版本：归一化结果变化会改变缓存 key（区县adcode|市+区+小区），改规则时递增，便于核对种子/共享缓存是否已按新规则重查
export const NORMALIZE_VERSION = 2

function lineCommunity(raw) {
  let s = String(raw || '').replace(NOISE_RE, '').replace(PRODUCT_RE, '')
  s = s.replace(/(\d{1,2})(期|区)/g, (_, d, t) => cnNum(d) + t)
  // 分区字母统一大写：「金科蠡湖b区」与「金科蠡湖B区」是同一个小区
  s = s.replace(/[a-z](?=[区期])/g, (c) => c.toUpperCase())
  const idx = s.search(CUT_RE)
  if (idx >= 0) s = s.slice(0, idx)
  let prev
  do {
    prev = s
    s = s.replace(TAIL_RE, '').replace(UNIT_TAIL_RE, '')
  } while (s !== prev)
  return s.length >= 2 && !GENERIC.has(s) && !PHASE_ONLY_RE.test(s) ? s : ''
}

// 地理编码查询串 = 市 + 区 + 小区；同时作为缓存与 geo-overrides.json 的 key
export function geoQuery(cityName, districtName, community) {
  if (!community) return ''
  const prefix = `${cityName || ''}${districtName || ''}`
  // 名称里已带区县名（如「宜兴春晓江南」）时不重复拼接
  return `${prefix}${community}`.replace(/\s+/g, '')
}
