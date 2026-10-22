// 登录 → 地图预热（docs/fable-review-round5.md 第 3 条）：拿到 token 的那一刻（不等 300 ms 的成功勾 + 路由切换）
// 并行发 /me、坐标缓存（overrides / seed / 共享）、高德 JS、地图页 chunk，以及全部项目的翻页拉取。
// 结果放在模块级，DealerMap 挂载时 take() 一次性取走复用；token 变了（退出 / 换账号）就作废。
import { me, pickProjectEndpoint, listAllProjects } from './index.js'
import { session } from './session.js'
import { loadShared } from '@/geo/shared'
import { loadOverrides, loadSeed } from '@/geo/geocoder'
import { hasAmapKey, loadAmap } from '@/geo/amap'

const FETCH_ALL = import.meta.env.VITE_FETCH_ALL === 'true'
const PAGE_SIZE = Number(import.meta.env.VITE_PAGE_SIZE) || 20

let pending = null
const quiet = (p) => (p.catch(() => {}), p)

// 高德 JS 不依赖登录（Key 本来就在前端）：登录页空闲时就可以开始加载
export function warmAmap() {
  if (hasAmapKey()) quiet(loadAmap())
}

// 项目翻页流：页到达即缓存；订阅者先回放已到的页，再接收后续页
function projectStream(endpointP) {
  const pages = []
  const subs = new Set()
  const done = endpointP.then((ep) => {
    if (!ep || !FETCH_ALL) return null
    return listAllProjects(ep, {
      region: '',
      limit: PAGE_SIZE,
      concurrency: 3,
      onPage: (list, total) => {
        pages.push([list, total])
        subs.forEach((fn) => fn(list, total))
      },
    })
  })
  quiet(done)
  return {
    endpointP,
    // onPage 回放 + 订阅；返回整体完成的 Promise（与 listAllProjects 相同的完成 / 失败语义）
    consume(onPage) {
      pages.forEach(([l, t]) => onPage(l, t))
      subs.add(onPage)
      return done.finally(() => subs.delete(onPage))
    },
  }
}

export function prefetchAfterLogin() {
  const token = session.token()
  if (!token) return
  const meP = quiet(me())
  const endpointP = quiet(meP.then((d) => pickProjectEndpoint(d?.permission_paths || [])))
  pending = {
    token,
    me: meP,
    shared: quiet(loadShared()),
    projects: projectStream(endpointP),
  }
  quiet(loadOverrides())
  quiet(loadSeed())
  warmAmap()
  quiet(import('@/views/DealerMap.vue'))
}

// 一次性取走（同一 token 才有效）
export function takePrefetch() {
  const p = pending
  pending = null
  return p && p.token === session.token() ? p : null
}
