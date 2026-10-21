// 经销商品牌 logo。暂时按名称硬编码（目前只有 生普舒适家）；以后应由登录经销商的资料提供 logo。
// 原图为深灰色透明底 PNG（400×83），深色界面用 CSS 滤镜转成白色（主题变量 --dm-logo-filter / --dm-logo-opacity）。
const BRANDS = [{ match: /生普/, logo: '/logo-shengpu.png', name: '生普舒适家' }]

export const brandFor = (name = '') => BRANDS.find((b) => b.match.test(name)) || null

// 登录页 / 首屏（登录前还不知道经销商）用的品牌：构建变量 VITE_LOGIN_BRAND 指定（默认 生普）；设为空字符串则不显示品牌
const LOGIN_BRAND = import.meta.env.VITE_LOGIN_BRAND ?? '生普'
export const defaultBrand = () => (LOGIN_BRAND ? brandFor(LOGIN_BRAND) : null)
