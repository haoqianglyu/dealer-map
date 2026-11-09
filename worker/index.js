// dealer-map Worker：静态 SPA + /api 只读代理（→ 平台 /v1）+ 高德安全密钥代理（/_AMapService）
// 全部逻辑在 ./core.js（与阿里云 FC 版 functions/web 共用）；这里只负责注入 Worker 专属的离线坐标种子。
import { createApp } from './core.js'
import geoSeed from './data/geo-seed.json'
import geoOverrides from './data/geo-overrides.json'

export default createApp({ seed: geoSeed, overrides: geoOverrides })
