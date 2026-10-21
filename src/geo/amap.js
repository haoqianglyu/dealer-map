import AMapLoader from '@amap/amap-jsapi-loader'

export const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || ''
export const AMAP_SECURITY = import.meta.env.VITE_AMAP_SECURITY || ''
export const hasAmapKey = () => Boolean(AMAP_KEY)

let loading = null
// 加载高德 JS API 2.0；安全密钥必须在 loader 之前写入 window._AMapSecurityConfig
export function loadAmap() {
  if (!AMAP_KEY) return Promise.reject(new Error('缺少高德 Key（VITE_AMAP_KEY）'))
  if (!loading) {
    if (AMAP_SECURITY) window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY }
    loading = AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.Geocoder', 'AMap.PlaceSearch', 'AMap.HeatMap', 'AMap.Scale'],
    }).catch((e) => {
      loading = null
      throw e instanceof Error ? e : new Error(String(e))
    })
  }
  return loading
}
