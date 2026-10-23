# 展厅待机巡览（attract mode）实施规格

2026-10-22 · Fable · 基于 main @ c949dee（线上）。来源：`docs/fable-review-round5.md` 第 2 条（老板已批），第 5 条「新告警 toast」与本稿的插播共用判定。
对象文件：`src/views/DealerMap.vue`、`src/components/AmapView.vue`、新建 `src/composables/useTour.js`（状态机）+ `src/geo/tourPlan.js`（纯函数选内容，可单测）。

一句话：**120 s 没人碰 → 地图自己按固定脚本讲一轮「全市 → 告警最多的 3 个区 → 每区一个告警小区的弹窗 → 热力」，约 75 s 一轮循环；任何输入 100 ms 内退出；新一级告警到达就插播。** 不新建标记、不重建索引、不改现有交互路径 —— 巡览只是在替人「点」。

---

## 1. 触发与开关

### 1.1 空闲判定
- 监听（`window`，**捕获阶段**，`{ passive: true }`，一个 `AbortController` 统一卸载）：`pointerdown`、`pointermove`、`wheel`、`keydown`、`touchstart`。`pointermove` 只在距上次记录点 ≥ 6 px 时算输入（劣质鼠标 / 电视触框抖动不算）。
- 不按每次输入重置计时器：输入只写 `lastInputAt = performance.now()`；一个 `setTimeout` 到点检查 `now - lastInputAt ≥ IDLE_MS`，不够就按差值再排一次。零计时器抖动。
- `IDLE_MS = 120 000`。`localStorage.dm_tour_idle`（秒，30–3600）可改；`?tour=<秒>` 同义、只对本次会话生效（与 `?theme` 同一读法：hash 后 `?` 与 search 都读）。
- 开始前置条件（全部满足，否则到点后 10 s 再查）：
  1. `route.path === '/dealer-map'` 且组件处于激活态（`onActivated` / `onDeactivated` 维护 `active` 标志；详情页不巡览）；
  2. `document.visibilityState === 'visible'`；
  3. `AMapRef` 已有（不是 FallbackMap）、`mapReady`、`communities.length > 0`、`!loadError`；
  4. 没有人为打开的东西：`AmapView.popOpenedBy() !== 'user'`、城市 / 经销商下拉未展开（CityPicker 新增 `expose({ isOpen })`）、`helpOpen === false`；
  5. `!document.documentElement.classList.contains('theme-vt')`（主题揭开进行中）。
- **「有人在读弹窗」**：条件 4 的弹窗 / 下拉例外 —— 它们把阈值抬到 `IDLE_MS × 5 = 600 s`，600 s 仍无输入视为没人在看，巡览开始（开始时关掉它们）。不是「永远不」：展厅里前一个人留下的弹窗不该让屏幕静止一整天。
- 退出巡览后重新计时（又是 120 s）。

### 1.2 开关
| 入口 | 行为 |
|---|---|
| `?tour=off` / `?tour=0` | 本次会话禁用（不监听、不显示按钮） |
| `?tour=now` / `?tour=1` | 首批标记就绪（`mapReady && communities.length > 0`，上限 8 s）后立即开始一轮；之后按正常空闲规则 |
| `?tour=<秒>` | 改空闲阈值 |
| `localStorage.dm_tour = 'off'` | 持久禁用（运维用） |
| `?kiosk=1`（第 9 条） | 不改巡览参数；只是语义上「展厅盒子」 |
| 顶栏按钮 | 40×40 图标按钮（▶ 轮廓，`aria-label="开始自动巡览"`，样式同 `.logout` 的常显边框），放在时钟左侧；点按 = 立即开始。**依赖第 8 条顶栏减负**（去公司全称 + 主题改单按钮）；第 8 条未上线前在 `compact`（1350）隐藏，只靠 `?tour=now`。无「停止」按钮 —— 任何触摸就是停止。 |

---

## 2. 一轮脚本（约 75 s，循环）

`S` = 当前筛选城市（`cityCode`，「全部城市」时 = 主城市）。所有飞行 900 ms，飞行结束后留 100 ms 稳定再开始停留计时（下表「停留」不含飞行）。

| # | 步骤 | 相机 | 模式 | 停留 | HUD 步骤标签 |
|---|---|---|---|---|---|
| 0 | 城市视野 | `flyCity()`：与 `fitCity → fitBounds(…, padding(40), true)` **同一算法**算 zoom / center（1350 ≈ z 9.86、1920 ≈ 10.7、2560 ≈ 11.16），侧栏偏移折进目标中心，一次 `setZoomAndCenter(z, c, false, 900)` | 点位 | 10 s | `无锡市 · 595 个项目 · 进行中告警 23` |
| 1a | 区县 i（i = 1..3） | `flyDistrict(key)`：`zoomTo(points, lnglat)` 同一套点集过滤（near + mainMass），`fitBounds(padding(60))` 的结果改成 900 ms 动画；下限 `zoomCluster()` | 点位 | 6 s | `滨湖区 · 29 个项目 · 3 条进行中告警` |
| 1b | 区县 i 的焦点小区 | `flyCommunity(key)`：目标 z 16，中心 = 小区坐标向左让出 `(avoid.right − avoid.left)/2` px（`zoomInto` 的 degPerPx 换算），900 ms；到达后走 `focusCommunity` 的后半段（找项 → `openGroup(it, key)` / `openPopover(c)`），**不再 `setCenter`**；`avoidUi` 照常（≤ 1 次 250 ms 快速平移） | 点位 | 8 s | `绿地香颂 · 2 条进行中告警` |
| 1c | 关弹窗 | `closePop()`；300 ms 后进入下一区 | | 0.3 s | |
| 2 | 热力 · 项目 | `flyCity()`（已在城市视野时跳过飞行）；`mode = 'heat'`、`heatMetric = 'projects'` | 热力 | 8 s | `热力 · 小区内项目数` |
| 3 | 热力 · 告警 | `heatMetric = 'alarms'` | 热力 | 8 s | `热力 · 一级告警（近 10 天）` |
| 4 | 回点位 | `mode = 'markers'`；300 ms 后回 #0 | 点位 | | |

合计：10 + 3 × (0.9 + 6 + 0.9 + 8 + 0.3) + 0.9 + 8 + 8 + 0.3 ≈ **76 s**。
- 1b 没有可用小区（见 §3）时该区只做 1a，停留延长到 8 s；若该区只有**未定位**的进行中告警，1a 期间调用现有 `revealUnlocated(d)`（告警列表滚到那条并 `flash` 3 次），停留 8 s。
- 热力两步之间不飞行；热力层 `show()` 目前是瞬时显隐，给 `warmLights` 的 canvas 加 `transition: opacity .4s ease`（点位 ↔ 热力各一次 400 ms 淡入淡出；`prefers-reduced-motion` 时 0 ms）。
- 无告警剧本（§3.3）替换 1a/1b 的选取规则与标签，步骤结构不变。

---

## 3. 内容选取（`geo/tourPlan.js`，纯函数）

```js
planTour({ districts, communities, alarmStateMap, cityCode, alarmsUsable, sameCity })
// → { story: 'alarm' | 'scale', districts: [{ key, label, community: key | null, unlocatedOnly: bool }] }
```

### 3.1 告警剧本（`alarmsUsable === true` 且至少 1 个区有进行中一级告警）
- 候选区县：`districtMarkers` 里 `sameCity(d.key, cityCode)` 且有 `lnglat` 的。
- 排序：`alarmCount(d.projects)`（进行中一级告警数，含未定位）降序 → `projects.length` 降序 → key 升序（稳定）。取前 3；不足 3 个有告警的，用无告警区按项目数补齐到 3（标签改 `· 无进行中告警`）。
- 每区焦点小区：该区 `communities`（已定位）中进行中一级告警数最多的；并列取最新告警 `ts`；再并列取项目数多的。**跨区去重**：一轮内同一小区只出现一次（区县边界上的小区可能同时算在两区）。
- 有告警但全部未定位 → `community: null, unlocatedOnly: true`。

### 3.2 焦点小区的告警行
- 1b 期间告警列表高亮「该小区最新一条进行中告警」（`alarmSorted` 里 `key === community && isActiveAlarm` 的第一条）；不在前 100 条时走 `pinnedAlarmId` 追加（现有机制）。

### 3.3 规模剧本（`alarmsUsable === false`，或全市 0 条进行中一级告警）
- 区县按 `projects.length` 降序取 3；焦点小区 = 该区项目数最多的已定位小区（并列取 `area` 大的）。
- 标签：#0 `无锡市 · 595 个项目 · 336 个小区`；1a `滨湖区 · 142 个项目`；1b `太湖国际聆湖 · 18 个项目 · 1.2 万㎡`。
- 热力步骤只做「项目」（跳过告警热力，省 8.9 s）。

### 3.4 不选的
- 离线小区：不做巡览步骤。在线状态有「未知」态（5 分钟过期、与账号对不上），展厅里把一个灰圈作为故事讲风险大于收益；离线数在弹窗头 / 状态行已经有。
- 其它城市（「全部城市」时）：不选，与右侧「各区项目」面板同口径；它们的新告警只通过插播（§5.2）出现。
- 「区县未填」组、`#id` 单项目组：不选。

### 3.5 数据可用性 `alarmsUsable`
| 告警状态（`alarmTracker` 视图） | `alarmsUsable` |
|---|---|
| 正常 / `stale` 且 `!aged`（< 5 min） | true |
| `aged`（5–30 min 沿用） | **false**（过期数据不当故事讲；地图角标照旧是 `alarmStateMap` 的事） |
| `error`（expired / failed / forbidden） | false |
| `!alarmsLoaded` | 等 `alarmsLoaded` 再开始（上限 8 s 后按 false） |
每轮开始时重新 `planTour`（不是每步），轮中数据变化不改当前剧本；插播除外。

---

## 4. 相机与动效

- 唯一的动画 API：`map.setZoomAndCenter(zoom, center, false, 900)`（高德 2.0 四参形式，代码里已在用 350 / 600 ms 的版本）。高德不暴露缓动，实测接近匀速，接受；不要再套一层逐帧 `setCenter` 补间（会和高德自己的动画打架）。纯平移（弹窗避让）仍用现有 `quickPan` 250 ms ease-out。
- 飞行期间不调用任何其它改视野的方法；`fitBounds` 里的 `panBy` 不能用于动画路径 —— `flyCity` / `flyDistrict` 把 `(right − left)/2、(bottom − top)/2` 的像素偏移按目标 zoom 换算进中心点，一次到位。
- 步骤切换：弹窗关闭 → 300 ms → 下一步飞行（弹窗 `dm-pop-in` 入场 160 ms 保留；关闭无动画，与现状一致）。
- 标记拆分 / 合并动画沿用（放大 split 240 ms、缩小 merge 160 ms）—— 巡览触发的缩放与用户缩放走同一条 `onZoom` 路径，不加特判。
- `prefers-reduced-motion: reduce`：所有 `setZoomAndCenter` 第三参改 `true`（瞬时）；切换瞬间给 `.map-layer` 加 `.tour-dip`（`opacity .35`，`transition: opacity .15s`），150 ms 后移除（共 300 ms 的「一暗一亮」代替镜头移动，不建新 DOM）；HUD 圆点不呼吸；热力淡入淡出 0 ms。

---

## 5. HUD、高亮、退出、插播

### 5.1 HUD 胶囊（`.tour-chip`，放在 `.ui` 内，随 `--ui-scale` 缩放）
- 位置 `top: 108px; left: 24px`（顶栏 96 + 12；与弹窗避让的顶边同值，弹窗不会压它）。高 40 px，`padding 0 14px`，圆角 20，`pointer-events: none`（任何点按都由 window 捕获退出，胶囊不挡地图）。
- 内容：`● 自动巡览中 · 触摸任意处退出` ＋ 竖线 ＋ 步骤标签（§2 表）。字 13 px / `--dm-font`，数字 `--dm-num`；标签换文字时 200 ms 交叉淡入（两个 `<span>` 切换 `opacity`，不改宽度动画）。
- 圆点 8 px `--dm-accent`，`animation: breathe 1.6s ease-in-out infinite`（复用 DealerMap 已有 `@keyframes breathe`）。插播时圆点改 `--dm-alarm`、文字 `新一级告警`（§5.2）。
- 深色：`background: rgba(4,11,24,.9)`、`border: 1px solid rgba(120,170,255,.2)`、文字 `#b7d3f0`、`backdrop-filter: blur(8px)`（与 `.status` 同一套）。亮色（`:root[data-theme='light']`）：`background: var(--dm-panel-solid)`、`box-shadow: var(--dm-shadow)`、文字 `var(--dm-text-2)`、边 `var(--dm-line)`。
- 入场 / 退场：`opacity` 200 ms 进、**100 ms** 出。

### 5.2 同步高亮
| 步骤 | 高亮 | 实现 |
|---|---|---|
| 1a / 1b | 「各区项目」面板该区的行 | `.row.tour-on`：左侧 3 px `--dm-accent` 竖条 + 底色 深 `rgba(53,212,255,.08)` / 亮 `var(--dm-hover)`；`scrollIntoView({ block: 'nearest' })`（1350 compact 面板只有 248 px 高，会滚） |
| 1b | 告警列表该小区最新进行中告警行 | `li.tour-on`：同一套底色，**不用 `flash`**（flash 是「现在看这里」3 闪，留给未定位 / 插播）；滚到列表中线（复用 `revealUnlocated` 的 `scrollTo` 算法） |
| 1b | 弹窗 | 现有 `focusKey` 排序 + 进行中告警默认展开，不加新样式 |
| 2 / 3 | 顶栏分段 `.on` 自然跟随 `mode` / `heatMetric` | 无新样式 |
退出 / 换步时移除所有 `.tour-on`（一个 `tourRow` ref：`{ district, alarmId }`，模板里 `:class` 绑定即可）。

### 5.3 退出（任意输入，≤ 100 ms）
在捕获阶段监听器里**同步**执行，顺序：
1. `state = 'idle'`，`clearTimeout(stepTimer)`，`stepSeq++`（所有排队中的异步步骤靠 seq 自检作废，含 900 ms 飞行到达后的「开弹窗」回调）。
2. 胶囊 `opacity → 0`（100 ms），`tourRow = null`。
3. 弹窗：若本次输入的 `event.target` 在 `.dm-pop` 内 → **保留**（他就是来读这个弹窗的；`pop.by` 改成 `'user'`）；否则 `AmapView.closePop({ onlyIf: 'tour' })`。
4. 恢复巡览开始时记下的 `mode` / `heatMetric`（只在巡览改过它们时；pointerdown 先于 click，用户若正点着分段按钮，click 随后把它设成他要的值，不冲突）。
5. **不恢复视野**：人刚碰屏幕，镜头停在他看到的地方。进行中的 900 ms 飞行不急停、不发新相机指令；他若在飞行中开始拖动，由高德自己的拖动接管（验收项：飞行第 400 ms 开始拖动，松手后地图不回弹）。
6. 重新计空闲（120 s）。
`visibilitychange → hidden`：同样执行 1–4（不恢复视野无所谓），且不计空闲；回到 `visible` 后从 0 计 120 s。详情页 `onDeactivated` 同 hidden。

### 5.4 新告警插播
- 判定（与第 5 条 toast 共用，放在 `applyAlarmView` 之后的一个 watcher）：本次 `alarms` 中 `id` 未见过、`isActiveAlarm`、`level === 1`、`ts > 上次轮询时刻 − 5 min`；**首轮不算**；`alarmsUsable` 为 false 时不算。多条 → 取 `ts` 最新的一条插播，胶囊写 `3 条新一级告警 · 显示最新`。
- 巡览中：立即（下一宏任务）打断当前步骤：`closePop` → 若已定位 `flyCommunity(key)`（900 ms）→ 弹窗 + 告警行 `flash` + `li.tour-on` → 停 15 s → 回 #0 重新开一轮（不接回被打断的步骤，简单且可预期）。胶囊：红点 + `新一级告警 · 绿地香颂 · 空气处理机(122) 通讯故障`。未定位 → 不动镜头：`revealUnlocated` 同样的滚动 + `flash`，胶囊同上加 `（未定位）`，停 6 s 后继续原步骤剩余时间。
- 非巡览中：只做第 5 条的 toast + 列表行 `flash`，**不动视野**。
- 插播期间再来新告警：排队，当前 15 s 结束后接着插播（队列上限 3，溢出只留最新）。
- 节流：同一小区 10 min 内只插播一次。

---

## 6. 数据异常与边界

| 情况 | 处理 |
|---|---|
| 告警 aged / error / 403 | `alarmsUsable = false` → 规模剧本，无告警热力；状态行文案由现有逻辑负责，胶囊不重复写 |
| 在线状态未知 | 与巡览无关；不选离线内容 |
| `communities.length === 0`（定位还没到 / 全部失败） | 不开始；每 10 s 再查 |
| 区县没有已定位小区 | 1a 用 `zoomTo` 的兜底分支（`zoomCluster() + 0.5` 到区中心，350 ms 改 900 ms）；无 1b |
| 同坐标 / 分期簇（z16 仍合并） | `flyCommunity` 到达后 `lastItems` 里找含该 key 的终态簇 → `openGroup(it, key)`，焦点组排第一且展开（现有 `focusKey` 逻辑）；胶囊标签用小区名不用「A 等 3 小区」 |
| 未定位告警 | 只走列表（§2、§5.4），绝不飞到 `fallbackPos` |
| 城市 ≠ 无锡 / 全部城市 | 一切以 `cityCode` 为准：`flyCity` 用该城区县中心、区县候选 `sameCity`；账号下只有一个城市时同样成立 |
| 区县 < 3 | 有几个讲几个；0 个（只有「区县未填」）→ 只做 #0 + 热力，一轮 27 s |
| 1350×700 | 城市 z 9.86；`compact` 下按钮隐藏（§1.2）；面板行高亮要滚；胶囊 `--ui-scale .85` 后 34 px 高（显示元素可 < 40，它不是点按目标） |
| 2560×1440 | 城市 z 11.16；胶囊随 `--ui-scale 1.33` 到 53 px；弹窗 / 标记已随 `--k` |
| 数据刷新（60 s 轮询）落在停留期 | 现有 `render(false)` + `refreshPopover` 增量，不动视野，巡览无感 |
| 主题切换落在巡览中 | 它本身就是输入 → 已退出；不会在 `theme-vt` 期间开始（§1.1） |
| 项目翻页仍在进行（`loading`） | 允许开始（`communities` 渐增只影响下一轮的 plan） |
| 高德 Key 失效 / FallbackMap | 不开始 |

---

## 7. 长期运行与性能

- 计时器：常驻 1 个空闲 `setTimeout`；巡览中再加 1 个步骤 `setTimeout`。**不用 `setInterval`**；所有回调先比对 `stepSeq`。
- 不新建标记、不 `rebuildIndexes`、不 `fitBounds` 全量重算（`flyCity` 只算数不调 `panBy`）；每步的渲染与用户同样操作一致 → 60 fps 目标继承现状（空闲 1201 帧 / 60 fps、最差帧 19 ms）。
- 新增 WAAPI / CSS 动画：胶囊圆点 1 个（CSS），标签交叉淡入用 `transition`；总数 53 → ≤ 55。
- 内存：3 轮后堆增长 ≤ 10 MB（现 53 MB）；弹窗开关 `clearPopMq` 路径不变；`tourRow` 只存 id。
- 监听器全部挂在一个 `AbortController` 上，`onBeforeUnmount` → `abort()`；keep-alive 停用时不卸载监听但 `active = false`（监听是 passive 的，开销可忽略）。
- token 续期：全局 `startTokenRefresh` 不受影响；巡览不发任何请求。
- 后台标签 / 熄屏：hidden 即停，timers 被浏览器节流也无副作用（`stepSeq` 作废旧回调）。
- 开发环境：`window.__dmTour = { state, step, plan, start(), stop() }`，与 `__dmViewLog` 配合核对巡览没有多余的 `setCenter`。

---

## 8. 代码改动清单

**AmapView.vue** — `defineExpose({ flyCity, flyDistrict, flyCommunity, closePop, popOpenedBy })`
- `pop` 增加 `by: 'user' | 'tour'`（`openPopover(c, keep, by = 'user')`）；`popOpenedBy()` 返回 `pop?.by ?? null`。
- `flyCity(ms = 900)`：抽 `fitBounds` 的算 zoom / center 部分为 `fitTarget(bounds, pad)` → `{ zoom, center }`（含偏移折算），`fitBounds` 与 `flyCity` 共用；`fitZoom` 仍在城市适配时更新。
- `flyDistrict(key, ms)`：`zoomTo` 的点集逻辑抽成 `districtTarget(d)`，返回 `{ zoom, center }` 后 `setZoomAndCenter(..., false, ms)`。
- `flyCommunity(key, { ms = 900, by = 'tour' })`：`focusCommunity` 拆成「飞」与「到达后开弹窗」两段；返回 Promise（`ms + 100` 后 resolve），内部不 `setCenter`。
- `closePop({ onlyIf })`。
- `reducedMotion()` 为真时 `ms` 视为 0、第三参 `true`。

**DealerMap.vue**
- 模板：`.tour-chip`、`.row` / `li` 的 `tour-on` 绑定、顶栏 ▶ 按钮；`<AmapView ref="mapView">`。
- `useTour({ mapView, mode, heatMetric, active, canStart, plan, onRevealUnlocated: revealUnlocated })`；`onActivated / onDeactivated` 维护 `active`。
- 新告警 diff watcher（与第 5 条 toast 共用）→ `tour.interrupt(alarm)`。
- `CityPicker` 加 `expose({ isOpen })`。

**useTour.js** 状态机：`idle → (空闲到点 && canStart) → running(step) → exit → idle`；`running` 内 `interrupt` 分支；对外 `{ state, step, chip, start(), stop(reason), interrupt(a) }`。所有时长为模块常量：`IDLE_MS 120000、FLY_MS 900、SETTLE_MS 100、GAP_MS 300、DWELL = { city: 10000, district: 6000, districtOnly: 8000, community: 8000, heat: 8000, interrupt: 15000, interruptUnlocated: 6000 }`。

**tourPlan.js**：§3 的纯函数，无 DOM / 高德依赖。

---

## 9. 验收

单测（`node --test tests/`）：
- `tests/tour-plan.test.mjs`：告警剧本排序 / 补齐 / 跨区去重 / 全未定位；规模剧本；`alarmsUsable=false` 走规模；区县 < 3。
- `tests/tour-idle.test.mjs`（注入 `now` / `setTimeout`）：120 s 到点开始；输入后 ≤ 100 ms `state === 'idle'`；弹窗 / 下拉打开时 600 s 才开始；hidden 停；旧回调（seq 不符）不执行；插播队列上限 3、同小区 10 min 节流。

线上（CDP 9333，1350 / 1920 各跑 3 轮，深 + 亮）：
1. `?tour=now`：首批标记后 ≤ 8 s 开始；一轮 70–80 s；`__dmViewLog` 中每步恰好 1 次 `setZoomAndCenter`（1b 允许 +1 次 `setCenter` 来自 `avoidUi`）。
2. 每步截图：#0 城市、1a 区县簇级、1b z16 弹窗 + 列表行高亮 + 面板行高亮、热力项目 / 告警；胶囊文案正确、两主题可读。
3. 真实鼠标 `move 10 px` / 触摸 / 滚轮 / 按键 各一次：100 ms 内胶囊消失、不再有视野变化；点在弹窗上退出时弹窗仍在。
4. 飞行第 400 ms 开始拖动：松手不回弹。
5. 退出后 `mode` 回到巡览前的值；视野不回。
6. 断网（CDP offline）≥ 5 min 后开始的一轮是规模剧本、无告警热力；恢复后下一轮回到告警剧本。
7. 模拟新告警（开发环境注入 `alarms`）：巡览中 ≤ 1.2 s 开始插播、15 s 后回 #0；非巡览只 toast。
8. 3 轮后：控制台 0 错误、堆增长 ≤ 10 MB、WAAPI 动画数 ≤ 55、空闲 60 fps 不变。
9. `prefers-reduced-motion`（CDP `Emulation.setEmulatedMedia`）：无飞行、只有 300 ms 明暗。
10. 详情页停留 3 min 不巡览；返回地图 120 s 后开始。

---

## 10. 顺序与工作量

1. `tourPlan.js` + 单测（1 h）
2. AmapView 四个 expose 方法 + `pop.by`（2 h）
3. `useTour.js` 状态机 + 单测（3 h）
4. DealerMap 接线、胶囊、高亮、按钮、两主题样式（2 h）
5. 插播（依赖第 5 条的 diff 判定；一起做 1.5 h）
6. 线上验收（1.5 h）

合计 ≈ 1.5 天（含插播与验收）。先上 1–4（`?tour=now` 可验），插播随第 5 条一起上。
