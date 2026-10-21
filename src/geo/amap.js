import AMapLoader from '@amap/amap-jsapi-loader'

export const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || ''
// 安全密钥只在开发模式使用（.env.local）；生产构建不打包密钥，改走 Worker 的 /_AMapService 代理（服务端追加 jscode）
export const AMAP_SECURITY = import.meta.env.DEV ? import.meta.env.VITE_AMAP_SECURITY || '' : ''
const AMAP_SERVICE_HOST = import.meta.env.DEV ? '' : `${location.origin}/_AMapService`
export const hasAmapKey = () => Boolean(AMAP_KEY)

let loading = null
// 加载高德 JS API 2.0；安全密钥必须在 loader 之前写入 window._AMapSecurityConfig
export function loadAmap() {
  if (!AMAP_KEY) return Promise.reject(new Error('缺少高德 Key（VITE_AMAP_KEY）'))
  if (!loading) {
    if (AMAP_SERVICE_HOST) window._AMapSecurityConfig = { serviceHost: AMAP_SERVICE_HOST }
    else if (AMAP_SECURITY) window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY }
    loading = AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.Geocoder', 'AMap.PlaceSearch', 'AMap.Scale'],
    }).catch((e) => {
      loading = null
      throw e instanceof Error ? e : new Error(String(e))
    })
  }
  return loading
}
