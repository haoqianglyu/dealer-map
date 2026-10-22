// 把项目名称（小区 + 楼栋/单元/室号等自由文本）归一到「小区」级别，
// 只用小区名做地理编码，不把门牌、楼栋、房号发给地图服务，也不在页面展示。

const CN_NUM = '一二三四五六七八九十百零〇两壹贰叁肆伍陆柒捌玖拾'
// 第一个出现的「楼栋/单元/房号」标记处截断：阿拉伯数字，或中文数字 + 栋/幢/座/号楼/单元/室/层/楼
// （中文数字 + 号 不截断，避免误伤「运河一号府」「公园壹号」这类小区名）
const CUT_RE = new RegExp(`(\\d|[A-Za-z]\\d|[${CN_NUM}]+(?:栋|幢|座|号楼|单元|室|层|楼))`)
// 「别墅」不在此列：海源别墅、金臣别墅 这类「别墅」是小区名的一部分（只去掉「自建别墅/自建房」）
const TAIL_RE = /(地下室|办公室|样板间|样板房|展厅|自建别墅|自建房|自建|测试|项目|住宅|[A-Za-z#＃\-－—_~]+)+$/
// 截断后残留在末尾的楼栋标记只在前面是字母/#时才是户号（「A栋」「B座」「#号」）；
// 「蠡湖一号99」「花园弄99」里号/弄在户号数字之前，是小区/弄堂名的一部分，不能剥
const UNIT_TAIL_RE = /[A-Za-z#＃]+(?:号楼|[号栋幢座])$/
// 只剩分期/分区（「B区」「东二区」「三期」「第三期」「B区三期」）不是小区名
const PHASE_ONLY_RE = new RegExp(`^(?:第?[东西南北中]?(?:[A-Za-z]|[${CN_NUM}]+)?[区期])+$`)
// 多行地址里只有省市区县的行（「无锡市滨湖区」「苏州市吴中区」）跳过，取下一行的小区名；不带省/市的分期/分区（「华府庄园八区」）不算
const ADMIN_LINE_RE = /^(?:[\u4e00-\u9fa5]{1,6}?(?:省|自治区|市))*(?:[\u4e00-\u9fa5]{1,6}?(?:市|县|区))?$/
const PHASE_END_RE = new RegExp(`(?:[A-Za-z东西南北中]|[${CN_NUM}])区$`)
// 项目名里常混入的系统/产品/用途词（不是小区名的一部分）
const PRODUCT_RE = /三管制|三管式|空气系统|新风系统|新风|三恒|四恒|五恒|两联供|地暖|测试|实验室|样板间|样板房|展厅|展示屏|会议室|办公室/g
// 去掉上述词后若只剩这些泛称，视为无法识别小区
const GENERIC = new Set(['仓库', '公司', '工厂', '车间', '门店', '机房', '设备间', '地下室', '长期', '别墅', '私宅', '民宿'])
// 繁体/异体字 → 简体（「绿地悅墅」与「绿地悦墅」是同一个小区）
const TRAD = { 悅: '悦', 傢: '家', 匯: '汇', 國: '国', 際: '际', 灣: '湾', 華: '华', 園: '园', 龍: '龙', 東: '东', 綠: '绿', 錦: '锦', 豐: '丰', 莊: '庄', 館: '馆', 號: '号', 樓: '楼', 單: '单', 層: '层', 門: '门', 雲: '云', 濱: '滨', 瀾: '澜', 璽: '玺', 藍: '蓝', 嶼: '屿', 灝: '灏', 頤: '颐', 譽: '誉', 臺: '台', 灜: '瀛', 瓏: '珑', 鳳: '凤', 學: '学', 寶: '宝', 廣: '广', 場: '场', 陽: '阳', 張: '张', 長: '长', 開: '开', 風: '风', 興: '兴', 會: '会', 盧: '卢', 蘇: '苏', 無: '无', 錫: '锡', 陰: '阴', 寧: '宁', 灘: '滩', 島: '岛', 湯: '汤', 灃: '沣' }
const TRAD_RE = new RegExp(`[${Object.keys(TRAD).join('')}]`, 'g')
// 产品型态后缀：「隐山五叠」「隐山四叠上叠」「隐山叠拼」「隐山叠墅」都是「隐山」（合院保留）
const STACK_RE = new RegExp(`(?:[${CN_NUM}]?叠(?:拼|墅)?|[上下]叠)+$`)
const PAREN_RE = /[（(][^）)]*[）)]/g
const NOISE_RE = /[\s.。·•、,，:：;；'"“”‘’/\\|]+/g

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
// （括号里的备注可能跨行，先整体去掉再分行）
export function communityName(raw) {
  const lines = String(raw || '').replace(PAREN_RE, '').split(/[\r\n]+/)
  let adminOnly = ''
  for (const line of lines) {
    const c = lineCommunity(line)
    if (!c) continue
    if (lines.length > 1 && ADMIN_LINE_RE.test(c) && (/[省市]/.test(c) || !PHASE_END_RE.test(c))) {
      adminOnly ||= c
      continue
    }
    return c
  }
  return adminOnly
}

// 规则版本：归一化结果变化会改变缓存 key（区县adcode|市+区+小区），改规则时递增，便于核对种子/共享缓存是否已按新规则重查
export const NORMALIZE_VERSION = 3

function lineCommunity(raw) {
  let s = String(raw || '').replace(TRAD_RE, (c) => TRAD[c]).replace(PAREN_RE, '').replace(NOISE_RE, '').replace(PRODUCT_RE, '')
  s = s.replace(/(\d{1,2})(期|区)/g, (_, d, t) => cnNum(d) + t)
  // 分区字母统一大写：「金科蠡湖b区」与「金科蠡湖B区」是同一个小区
  s = s.replace(/[a-z](?=[区期])/g, (c) => c.toUpperCase())
  const idx = s.search(CUT_RE)
  if (idx >= 0) s = s.slice(0, idx)
  let prev
  do {
    prev = s
    s = s.replace(TAIL_RE, '').replace(UNIT_TAIL_RE, '')
    const t = s.replace(STACK_RE, '')
    if (t.length >= 2) s = t
  } while (s !== prev)
  return s.length >= 2 && !GENERIC.has(s) && !PHASE_ONLY_RE.test(s) && s.replace(STACK_RE, '') ? s : ''
}

// ---------- 名称开头的市 / 区县前缀 ----------
// 「宜兴湖悦天境」与「湖悦天境」是同一个小区；「太仓市天悦湾」填在吴中区，前缀才是对的区县。
// 只认：本市的区县（「江阴」「张家港」「惠山」）、本省的地级市、直辖市 / 省会；
// 其它地方的同名区县（安徽「太湖」、汕头「龙湖」、南京「栖霞」…）多半是小区名的一部分，不剥。
const CAPITALS = new Set(['北京', '上海', '天津', '重庆', '南京', '杭州', '合肥', '福州', '南昌', '济南', '郑州', '武汉', '长沙', '广州', '南宁', '海口', '成都', '贵阳', '昆明', '拉萨', '西安', '兰州', '西宁', '银川', '乌鲁木齐', '呼和浩特', '石家庄', '太原', '沈阳', '长春', '哈尔滨', '深圳'])
// 常见镇 / 街道名（单独出现时不是小区名）；其余以已知区县名判断
const TOWNS = new Set('玉祁 洛社 钱桥 阳山 前洲 堰桥 长安 石塘湾 杨市 陆区 胡埭 雪浪 马山 华庄 硕放 梅村 鸿山 新安 旺庄 江溪 东亭 安镇 羊尖 鹅湖 东港 锡北 厚桥 云林 东北塘 港下 张泾 八士 查桥 徐霞客 青阳 月城 璜土 利港 申港 华士 周庄 新桥 长泾 顾山 祝塘 南闸 云亭 澄江 夏港 丁蜀 和桥 高塍 官林 徐舍 张渚 湖父 太华 西渚 杨巷 屺亭 芳桥 万石 周铁 宜城 谈村 中堂 东山 西山 光福 木渎 甪直 胥口 临湖 越溪 横泾 渭塘 黄埭 望亭 湖塘 牛塘 礼嘉 洛阳 雪堰 前黄 南夏墅 横林 横山桥 郑陆 奔牛 孟河 罗溪 薛家'.split(' '))
const short = (n) => (n.length > 2 ? n.replace(/(?:特别行政区|自治区|自治县|自治州|新区|市|区|县|盟|旗)$/, '') : n)
let indexFor = null
function regionIndex(regions) {
  if (indexFor?.regions === regions) return indexFor
  const byName = new Map() // 名称（全称 / 简称）→ [adcode]
  for (const [code, v] of Object.entries(regions || {})) {
    if (/0000$/.test(code) && !/^(11|12|31|50)/.test(code)) continue // 省不参与（直辖市保留）
    const name = Array.isArray(v) ? v[0] : v?.name
    if (!name) continue
    for (const n of new Set([name, short(name)])) if (n.length >= 2) byName.set(n, [...(byName.get(n) || []), code])
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  return (indexFor = { regions, byName, names })
}
const MUNI = /^(11|12|31|50)/ // 直辖市：区县的上级「市」是 xx0100
const cityOf = (code) => (MUNI.test(code) ? `${code.slice(0, 2)}0100` : `${code.slice(0, 4)}00`)
const isCity = (code) => /00$/.test(code) // 市级（含直辖市 110000 / 110100）
// 名称开头的允许前缀：kind 'city' 只认市（本市 / 本省 / 直辖市省会），'county' 只认 base 市下的区县；返回 { code, len }
function leadingRegion(s, ix, kind, base) {
  for (const n of ix.names) {
    if (!s.startsWith(n) || s.length - n.length < 2) continue
    for (const code of ix.byName.get(n)) {
      const c = cityOf(code)
      if (kind === 'city' && isCity(code)) {
        if (c === base || (base && c.slice(0, 2) === base.slice(0, 2)) || CAPITALS.has(short(n))) return { code: c, len: n.length }
      } else if (kind === 'county' && !isCity(code) && c === base) return { code, len: n.length }
    }
  }
  return null
}

/**
 * 小区名 + 名称开头的行政区提示。
 * @param raw 项目名称 / 地址原文
 * @param ctx { city: 项目所填城市 adcode, regions: districts.json }
 * @returns { name, hint, vague } name：去掉市/区县前缀后的小区名（无法识别时为 ''）；
 *   hint：前缀对应的 adcode（区县级 = 应改到该区；市级 = 该市范围内查），无前缀时为 ''；
 *   vague：名字只剩区县 / 镇名（如「惠山」「玉祁」）时为该名字，进待校正「名字太泛」，不去查
 */
export function communityParts(raw, { city = '', regions = null } = {}) {
  const name = communityName(raw)
  if (!name) return { name: '', hint: '', vague: '' }
  const ix = regionIndex(regions)
  const bare = name.replace(/(?:镇|街道|乡)$/, '')
  if (TOWNS.has(bare) || ix.byName.has(bare)) return { name: '', hint: '', vague: name }
  let s = name
  let hint = ''
  // 先剥市（「常州市双龙原著」「苏州市昆山…」），再剥该市的区县（「常州新北区孟河首府」）；区县之后不再剥（「江阴上海花园」）
  const c = leadingRegion(s, ix, 'city', city)
  if (c) {
    s = s.slice(c.len)
    hint = c.code
  }
  const d = leadingRegion(s, ix, 'county', hint || city)
  if (d) {
    s = s.slice(d.len)
    hint = d.code
  }
  if (PHASE_ONLY_RE.test(s) || GENERIC.has(s)) return { name, hint: '', vague: '' }
  return { name: s, hint, vague: '' }
}

// 地理编码查询串 = 市 + 区 + 小区；同时作为缓存与 geo-overrides.json 的 key
// 小区名开头已带市 / 区县名（全称或简称，如「宜兴春晓江南」）时不重复拼接
export function geoQuery(cityName, districtName, community) {
  if (!community) return ''
  let c = String(community).replace(/\s+/g, '')
  for (const n of [cityName, districtName]) {
    if (!n) continue
    for (const p of [n, short(n)]) if (p.length >= 2 && c.startsWith(p) && c.length - p.length >= 2) c = c.slice(p.length)
  }
  return `${cityName || ''}${districtName || ''}${c}`
}
