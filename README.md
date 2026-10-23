# dealer-map

生普舒适家 经销商项目分布大屏 —— Vue 3 + Vite + 高德地图 JS API 2.0 + Cloudflare Worker。

线上：<https://dealermap.haoqianglyu.com>（需生普平台账号登录）

## 功能概览

- **点位 / 热力**：热力两种口径（小区内项目数 · 一级告警），深色主题 Bloom 暖光、亮色主题墨晕
- **4 级聚合**：区县气泡 → 街区簇 → 小区胶囊 → 终态标记，点击逐级放大
- **实时告警**：60 s 轮询；失败时保留上次结果，状态行标「未更新」，最长 30 min 后才清空并报错
- **离线变灰**：小区内项目全部离线（且无告警）时标记变灰
- **详情页**：`#/project/:id`，项目设备与房间数据（只读）
- **深色 / 亮色主题**：顶栏切换，圆形揭示动画；深色为默认（展厅）
- **展厅自动巡航**：闲置 2 min 后自动巡览城市 / 区县 / 小区 / 热力，新告警插播；任意操作即停
- **TV 规则**：不依赖 hover，可点击目标 ≥ 40 px

## 架构

```
浏览器 (Vue SPA, hash 路由)
   │
   ▼
Cloudflare Worker  dealermap.haoqianglyu.com   (worker/index.js)
   ├─ /*                  静态资源 dist/（SPA 回退）
   ├─ /api/*              白名单只读代理 → https://control.cosyhome.com.cn/v1
   ├─ /_AMapService/*     高德代理，服务端追加 jscode（安全密钥不进前端包）
   ├─ /geo-shared         共享坐标缓存（需平台 token）─┐
   └─ /geo-shared/seed    离线坐标种子（需平台 token） │
                                                      ▼
                         阿里云 FC + OSS  (functions/geo)
                         鉴权：转发 token 到平台 /me，必须 200
```

- `/api` 只放行前端实际用到的接口；设备透传只允许查询类 `message_type`，控制类一律 403。
- 共享缓存只存已确认的坐标和高德返回的名称/地址，不存户号、姓名、电话。

## 本地开发

```bash
npm ci
cp .env.example .env.local     # 填 VITE_AMAP_KEY / VITE_AMAP_SECURITY，可选 GEO_FC_URL
npm run dev                    # http://localhost:8090，/api 代理到生产平台
npm test                       # node --test tests/
npm run build                  # 产物 dist/
```

`.env.local` 变量：

| 变量 | 用途 |
| --- | --- |
| `VITE_AMAP_KEY` | 高德 Web 端 (JS API) Key |
| `VITE_AMAP_SECURITY` | 高德安全密钥，**仅开发**用；生产构建置空，由 Worker 追加 |
| `VITE_FETCH_ALL` / `VITE_PAGE_SIZE` | 是否翻页取完全部项目 / 每页条数 |
| `GEO_FC_URL` | 共享坐标缓存 FC 触发器 URL（开发时代理 `/geo-shared`；不填则不启用） |

### 部署

```bash
# Worker secrets（只需设置一次，值找维护者要）
npx wrangler secret put AMAP_JSCODE    # 高德安全密钥
npx wrangler secret put GEO_FC_URL     # FC 触发器 URL

npx wrangler deploy                    # 自动执行 wrangler.toml 里的 build 命令再发布

functions/geo/deploy.sh                # 共享坐标缓存 FC（需 aliyun CLI，凭据从 macOS Keychain 读）
```

## 重要：真实数据不入库

以下文件含真实小区数据，已在 `.gitignore` 中，**新 clone 里没有**，需向维护者索取后放回原位：

- `worker/data/geo-seed.json` —— 小区坐标离线种子
- `worker/data/geo-overrides.json` —— 人工校正坐标
- `docs/img/` —— 文档截图

缺这两个 JSON 时：

- `npx wrangler deploy` **会失败**（`worker/index.js` 直接 `import` 它们）；
- `npm run dev` 能启动，但 `/geo-shared/seed` 报错，前端按空种子处理（地图照常，坐标全部现查高德）；
- `npm test` 中 `geo-seed.test.mjs` 会失败。

只想跑起来，用占位文件即可（`_readme` 字段是测试要求的）：

```bash
echo '{"_readme":"placeholder for worker/data/geo-seed.json"}' > worker/data/geo-seed.json
echo '{}' > worker/data/geo-overrides.json
```

## URL 参数

hash 后（`#/dealer-map?theme=light`）和 `?` 查询串都能读。

| 参数 | 取值 | 作用 |
| --- | --- | --- |
| `theme` | `dark` / `light` | 本次会话的主题（不写入 localStorage） |
| `basemap` | `whitesmoke`（默认）/ `light` / `grey` | 亮色主题底图：远山黛 / 月光银 / 雅士灰 |
| `tour` | `off`/`0`、`now`/`1`、`<秒>` | 本次会话禁用巡航 / 立即开始 / 自定义闲置阈值（30–3600 s） |
| `showroom` | `1` | 展示模式：隐去户号、客户姓名与电话 |
| `region` | 如 `320000/320200` | 城市筛选（默认无锡），切换城市时自动写入 |
| `reverify` | `1` | 一次性复核没有高德匹配名称的旧定位结果 |

示例：

```
https://dealermap.haoqianglyu.com/#/dealer-map?theme=light&tour=off
https://dealermap.haoqianglyu.com/#/dealer-map?showroom=1&tour=now
```

localStorage：`dm_theme`（主题）、`dm_tour=off`（持久禁用巡航）、`dm_tour_idle`（闲置秒数）；开发构建另有 `dmStress=5000`（压测点数）。

## docs/ 索引

| 文件 | 内容 |
| --- | --- |
| [fable-review-login-map.md](docs/fable-review-login-map.md) | 登录页 + 地图页首轮设计评审 |
| [fable-rereview-login-map.md](docs/fable-rereview-login-map.md) | 登录页 + 地图页第二轮实机评审 |
| [fable-review-round3.md](docs/fable-review-round3.md) | 第三轮线上实机评审 |
| [fable-clustering.md](docs/fable-clustering.md) | 地图中间层级（聚合圈）设计稿 |
| [fable-review-clustering.md](docs/fable-review-clustering.md) | 聚合层级实测评审 |
| [fable-offline.md](docs/fable-offline.md) | 离线项目灰显设计意见 |
| [fable-light-theme.md](docs/fable-light-theme.md) | 亮色主题设计稿 |
| [fable-review-round5.md](docs/fable-review-round5.md) | 第五轮评审：还差什么才算完整 |
| [fable-autotour.md](docs/fable-autotour.md) | 展厅待机巡览实施规格 |
| [autotour-progress.md](docs/autotour-progress.md) | 自动巡航实施进度 |
| [polish-audit.md](docs/polish-audit.md) | 登录页 + 地图页打磨审计 |
| [normalize-bugs.md](docs/normalize-bugs.md) | 小区名归一化 bug 修复记录 |
| [drilldown-ref.md](docs/drilldown-ref.md) | 二级界面（详情页）参考 |

## 测试

```bash
npm test                  # 单元测试：聚合、告警沿用、巡航计划、归一化、种子鉴权、FC 等
tests/marker-click.sh     # 冒烟：标记点击逐级放大 + 弹窗
```

`marker-click.sh` 用 [agent-browser](https://github.com/vercel-labs/agent-browser) 驱动一个**已登录**的 Chrome 会话（CDP），页面需停在 `#/dealer-map`；脚本用带几像素抖动的真实鼠标点击（高德会吞掉原地合成点击），退出码 0 为通过。开发和线上环境均可跑。
