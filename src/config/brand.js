// 经销商品牌 logo。暂时按名称硬编码（目前只有 生普舒适家）；以后应由登录经销商的资料提供 logo。
// 原图为深灰色透明底 PNG（400×83），深色界面用 CSS 滤镜转成白色（主题变量 --dm-logo-filter / --dm-logo-opacity），
// 以后浅色主题把滤镜设为 none 即用原色。
const BRANDS = [{ match: /生普/, logo: '/logo-shengpu.png', name: '生普舒适家' }]

export const brandFor = (name = '') => BRANDS.find((b) => b.match.test(name)) || null
