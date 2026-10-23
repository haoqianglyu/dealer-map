# 亮色主题设计稿

2026-10-22 · Fable · 范围：地图页 / 登录页 / 项目详情页全部可见颜色 + 主题切换。只读审阅代码（main @ 4ff2685），**未改代码、未登录线上**（自动化 Chrome 里没有已登录的生产标签页，按规矩不登录）。工程按本稿实现。

业主原话：「可以做一版亮色主题的看看」。用途：白天办公室、亮会议室、截图进报告 / PPT。**深色仍是默认**（展厅）。

---

## 0. 结论

1. **底图选 远山黛 `amap://styles/whitesmoke`**（三选一给业主截图：远山黛 / 月光银 `light` / 雅士灰 `grey`）。叠加层调色按「三张底图都能用」设计：所有标记色在最亮的底（≈ `#f5f5f5`）上 ≥ 4.3:1，在最暗的雅士灰建筑面（按 `#d2d2d2` 估）上 ≥ 3.1:1，文字在面板上 ≥ 4.9:1。
2. **标记保持「细环 + 数字」**（业主已批、三轮评审都写了不要再动的东西），不改成实心球：环 2px 状态色，填充近白（白 94% + 状态色 10%），数字改深墨 `#10213a`——数字对比 > 13:1，任何状态都一样，截进 PPT 缩到一半也能读。
3. **热力改「墨染」**：白底上 `lighter` 叠加等于没画。亮色时 canvas 元素加 `mix-blend-mode: multiply`，画琥珀 → 赭石（项目）/ 红 → 深绯（告警）三层径向渐变，层内也用 `multiply`（重叠处像墨水积深）。告警数字挪到第二张不混合的 canvas 上。
4. **切换**：顶栏右侧、退出按钮左边一个两段控件 `[深色 | 亮色]`，与现有「点位 / 热力」同款，40 px 高，常显、无悬停依赖；存 `localStorage.dm_theme`，`<html data-theme="light">` 驱动全部 CSS 变量；高德 `map.setMapStyle()` 运行时换底图，不刷新。
5. **一个值要改**：`global.scss` 里预留的亮色离线灰 `#6b7a90` 在雅士灰上只有 2.9:1，改 `#65758b`（3.1:1；白底 4.7:1）。

---

## 1. 三张底图怎么选

| 样式 | 陆地 / 水 / 建筑（目测估计，工程截图后以实测为准） | 对叠加层的影响 | 适合 |
|---|---|---|---|
| **远山黛 whitesmoke（推荐）** | 陆地极浅冷灰（≈ `#eef2f3`，L* ≈ 95），水浅蓝灰，建筑略深一档，注记灰 | 彩度最低、亮度最高 → 彩色环、红角标、墨染全都最清楚；冷灰底和面板白色 `#ffffff` 有一点点差别，面板不会「消失」 | 办公室大屏、PPT |
| 月光银 light | 陆地近白（≈ `#f3f3f3`），水浅蓝，注记深灰且略密 | 与远山黛接近；底更白，玻璃面板和底图几乎同色，要靠面板阴影（§2 `--dm-shadow`）分层；高德注记偏重，z ≥ 14 会和我们的胶囊名抢 | 投影仪（投影会整体变灰，越白越好） |
| 雅士灰 grey | 陆地中浅灰（≈ `#dcdcdc`–`#e6e6e6`，L* ≈ 88–91），建筑 / 水再深一档 | 所有对比度打 7–8 折：细环最弱的离线灰 3.1:1、正常色 3.5:1，刚过线；墨染的浅晕几乎看不见，只剩深芯 | 想要「低调」时；不推荐 |

工程给业主的三张图：同一视野（无锡市城市视野 + 滨湖区 z12 点位 + 热力项目），1920×1080。叠加层三张图**完全一样**，只换 `mapStyle`。

`setFeatures` 分档不变（区县级 `bg, road`；其余 `bg, road, building, point`）。亮色样式里注记是深灰字，和我们的深墨字同色系——区县级高德不画字、小区级我们的字在胶囊里，这个分工已经保证不重名（第三轮 P0-1），亮色下不用再调。

---

## 2. Token 表（深 → 亮）

全部放 `global.scss` 的 `:root[data-theme='light']` 块。括号里是现在代码中硬编码、要改成用 token 的位置。新增的 token 深色也要给值（给的就是现在的硬编码值，视觉零变化）。

### 2.1 基础

| token | 深色（现值） | 亮色 | 备注 |
|---|---|---|---|
| `--dm-bg` | `#040b18` | `#eef2f6` | 页面底、`html/body/#app`、`.amap` 瓦片未到前的底（现在硬编码 `#06101f`）、`.login`、`.pd-screen` |
| `--dm-panel` | `rgba(6,16,36,.82)` | `rgba(255,255,255,.86)` | 面板玻璃；`backdrop-filter: blur(12px)` 不变 |
| `--dm-panel-solid` 新 | `rgba(4,11,24,.9)` | `rgba(255,255,255,.94)` | 图例、状态行（标记从后面经过不透出） |
| `--dm-line` | `rgba(120,170,255,.14)` | `rgba(16,33,58,.10)` | 面板边、分隔线 |
| `--dm-line-2` 新 | `rgba(120,170,255,.10)` | `rgba(16,33,58,.08)` | KPI 格线、告警行底线、弹窗头底线 |
| `--dm-shadow` 新 | `none` | `0 4px 16px rgba(16,33,58,.08), 0 1px 2px rgba(16,33,58,.06)` | 面板、图例、状态行、KPI；深色靠边线分层，亮色靠阴影 |
| `--dm-shadow-pop` 新 | `0 16px 40px rgba(0,0,0,.5)` | `0 12px 32px rgba(16,33,58,.18)` | 弹窗、下拉、抽屉、告警浮层 |
| `--dm-text` | `#f2f7ff` | `#10213a` | 16.2:1 |
| `--dm-text-2` | `#b7d3f0` | `#3b4f6b` | 8.3:1 |
| `--dm-text-3` | `#8fb0d0` | `#5b6b80` | 5.4:1（最小 12 px 字也够）；同时替换硬编码 `#7f9cc0`（状态行）、`#7fa3c8`（KPI 标签、告警区县）、`#93b5d6`（详情页 muted） |
| `--dm-accent` | `#35d4ff` | `#0e7490` | 文字 5.4:1；按钮白字 5.4:1。亮色 accent 不能再是青亮色（`#35d4ff` 在白上 1.7:1） |
| `--dm-accent-text-on` 新 | `#04121f` | `#ffffff` | 选中分段 / 登录按钮上的字 |
| `--dm-hover` | `rgba(53,212,255,.06)` | `rgba(14,116,144,.06)` | 行 hover；`rgba(255,255,255,.06)`（分段 / 退出 / 标题按钮 hover）→ `rgba(16,33,58,.06)` |
| `--dm-focus` 新 | `#35d4ff` | `#0e7490` | 全站 `:focus-visible` 2px；accent 实底按钮上用双环 `box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--dm-focus)` |
| `--dm-scrollbar` 新 | `rgba(53,212,255,.3)` | `rgba(16,33,58,.50)` | 4 px 不变；hover `.70`（.50 在白上 3.1:1，再浅就找不到了） |
| `--dm-logo-filter` | `brightness(0) invert(1)` | `none` | logo 用原图（深灰 `#3d3d3d`，在 `#eef2f6` 上 9.7:1） |
| `--dm-logo-opacity` | `.92` | `1` | |
| `--dm-num` / `--dm-font` | 不变 | 不变 | |

### 2.2 状态色

| token | 深色 | 亮色 | 白底 / 远山黛 / 雅士灰建筑面 对比 |
|---|---|---|---|
| `--dm-alarm` | `#ff4d4f` | `#d7263d` | 5.0 / 4.5 / 3.3；白字在上面 5.0:1 |
| `--dm-alarm-text` 新 | `#ffd2d2`（`.al.on`）/ `#ff6b6b`（弹窗 em）/ `#ff9a9b`（处理中标签） | `#b42318` | 6.6:1，告警正文、「N 告警」红字、处理中标签 |
| `--dm-warn` | `#ffc722` | `#a16207` | 4.9 / 4.5 / 3.3 |
| `--dm-warn-text` 新 | `#ffd76a` | `#8a5200` | 6.4:1，notice 横幅、「未定位」黄标文字、CapsLock 提示 |
| `--dm-ok` | `#00e2a1` | `#0f8a5f` | 4.4:1；只用于图标 / 点（无文字） |
| `--dm-offline` | `#8a9bb3` | **`#65758b`**（原预留 `#6b7a90` 作废） | 4.7 / 4.3 / 3.1 |
| `--dm-offline-fill` | `10%` | `8%` | 不变（已有） |
| `--dm-offline-name` | `#9fb0c6` | `#5b6b80` | 5.4:1（= text-3，可接受，深色两者也只差一点） |
| `--dm-normal` 新 | `#00d4ff` | `#0e7490` | 5.4 / 4.9 / 3.5；`STATES.normal.color` 改引用它（见 §8） |
| `--dm-notice` 新 | `#5b8ff9` | `#3b6fd6` | 4.7:1；`NOTICE_COLOR` 改引用 |
| `--dm-heat-halo` | `#ffb857` | `#c48a2e` | 只给图例 / 登录舞台引用，canvas 调色见 §5 |

### 2.3 地图叠加层

| 项 | 深色 | 亮色 |
|---|---|---|
| 标记填充 `.dm-mk` | `color-mix(var(--c) 12%, rgba(4,11,24,.55))` | `color-mix(in srgb, var(--c) 10%, rgba(255,255,255,.94))`（告警 `#fbe9ec`、正常 `#e7f1f4`、离线 `#f0f1f3`） |
| 标记内发光 | `inset 0 0 18px color-mix(var(--c) 28%, transparent)` | `inset 0 0 14px color-mix(in srgb, var(--c) 16%, transparent), 0 1px 4px rgba(16,33,58,.18)`（加一道外投影把环从底图上托起来） |
| 环 | 2px `var(--c)` | 不变（2px；区县圈也不加粗，粗了像实心） |
| 数字 `.dm-mk__n` | `#fff` | `var(--dm-text)` `#10213a`（填充上 13.8–14.3:1） |
| 离线：环 / 填充 / 数字 / 名字 | 环 70% 灰、填 10%、数字 `#c5d2e0`、名 `#9fb0c6` | 环 **100%** `#65758b`（70% 透明会掉到 2.6:1）、填 8%、数字 `#3b4f6b`、名 `#5b6b80`；仍不整体 opacity |
| 叠环 `.dm-mk--cluster::before` | 1px `color-mix(var(--c) 45%)` | 1px `color-mix(in srgb, var(--c) 80%, transparent)`（65% 只有 2.5:1，80% → 3.3:1） |
| 角标「N 告警」 | `#ff4d4f` 底 `#fff` 字，`0 2px 6px rgba(0,0,0,.4)` | `var(--dm-alarm)` 底 `#fff` 字 5.0:1，`0 1px 3px rgba(16,33,58,.25), 0 0 0 1.5px #fff`（白描边把角标和环、底图注记分开） |
| 脉冲环 `.dm-mk--pulse::after` | 2px `var(--c)`，opacity .9 → 0 | 同色同宽，opacity **.7** → 0（白底上 .9 起步太重） |
| 小点 `.dm-mk--dot` | 填 `color-mix(var(--c) 45%, rgba(4,11,24,.7))` + 2px 环 | 实心 `var(--c)`，2px `rgba(255,255,255,.95)` 边，`0 1px 3px rgba(16,33,58,.25)` |
| 区县名 / 外挂名 `.dm-mk__label` | `#d8ecff`，描边 3px `rgba(4,11,24,.9)` | `#10213a`，描边 3px `rgba(255,255,255,.92)` |
| 「k 小区」`--sub`、`small` | `#9fc0e0` | `#5b6b80`，描边同上 |
| 非区县标签 `#b7d3f0`、侧标 `#e8f4ff` | | `#3b4f6b` / `#10213a` |
| 胶囊内名字（无描边） | `#e8f4ff` | `#10213a` |
| hover 名字 `#fff` | | `#10213a`（已是最深，hover 只留 1.06 缩放） |
| 城市名 `.dm-city` / 邻近城市 `--ctx` | `#6f8fb8` / `#56708f`，描边 `rgba(4,11,24,.85)` | `#3b4f6b` / `#6b7a90`，描边 3px `rgba(255,255,255,.9)` |
| 热力区县标签 `.dm-hlabel` | `#ffde9e`，描边 `rgba(10,8,4,.85)` | `#7a480a`（6.9:1），描边 3px `rgba(255,255,255,.9)`；`b` 同色 |
| 比例尺 | 字 `#8fb0d0` + 深色 text-shadow；线 `rgba(216,236,255,.6)` | 字 `#3b4f6b`，`text-shadow: 0 0 3px #fff`；线 `rgba(16,33,58,.6)` |
| 弹窗 `.dm-pop` | 底 `rgba(6,16,36,.97)`，边 `rgba(120,170,255,.2)` | 底 `rgba(255,255,255,.98)`，边 `rgba(16,33,58,.12)`，阴影 `--dm-shadow-pop`；箭头同底同边 |
| 弹窗头 `b` / `span` / `em` / `×` | `#f2f7ff` / `#8fb0d0` / `#ff6b6b` / `#8fb0d0` | `#10213a` / `#5b6b80` / `#b42318` / `#5b6b80`（hover `#10213a` + `rgba(16,33,58,.06)`） |
| 行点：告警 / 预警 / 在线 / 离线实心 / 未知空心 | 状态色 / `#00d4ff` / `#8a9bb3` / 1.5px `#8a9bb3` | `#d7263d` / `#a16207` / `#0e7490` / `#65758b` / 1.5px `#65758b` |
| 离线行名字 `.pj.off .n` | `#b7d3f0` | `#5b6b80`（正常行 `#10213a`，降一档，不透明） |
| 面积 `.a`、告警行 `.al`、时间 `.t` | `#8fb0d0` | `#5b6b80` |
| 进行中告警行 `.al.on` | `#ffd2d2` | `#b42318` |
| 「详情 ›」`.go`、「更多」、`.dm-pop__all` | `#35d4ff`；按钮底 `rgba(53,212,255,.06)` 边 `.25` | `#0e7490`；底 `rgba(14,116,144,.06)` 边 `rgba(14,116,144,.3)`，hover 底 `.12` |
| 组头 `.grp`（sticky 实底） | `#0c1b35`，字 `#8fb0d0` / `.n #b7d3f0` | `#f3f4f5`，字 `#5b6b80` / `.n #3b4f6b` / `em #b42318` |
| 弹窗 / 告警列表跑马灯两端渐隐 `mask-image` | `transparent → #000 8px … #000 calc(100%-14px) → transparent` | **不用改**。这是 alpha 遮罩，`#000` 只表示「不透明」，和主题无关 |
| 图例 `.legend` | 底 `rgba(4,11,24,.9)`，点 = 2px 环 + 20% 填 | 底 `--dm-panel-solid`，边 `--dm-line`，阴影 `--dm-shadow`；点样式不变（跟着状态色走）；`?` 弹层底 `rgba(255,255,255,.98)` + `--dm-shadow-pop` |
| 热力图例色块 `HEAT_TIERS` | 琥珀 5 档 `rgba(255,184,87,.35)` … `#fff5db` | 赭石 5 档 **由浅到深**：`#ecdcc2` `#ddbb86` `#c99a52` `#a86a18` `#7a480a`，色块加 1px `rgba(16,33,58,.12)` 边；标题「亮度 = …」亮色时改「**深浅 = …**」 |
| 状态行 `.status` | 底 `rgba(4,11,24,.9)`，字 `#7f9cc0` | 底 `--dm-panel-solid`，字 `#5b6b80`，阴影 `--dm-shadow` |
| 顶栏渐变 | `rgba(4,11,24,.97) 0 → .94 72px → 0 96px` | `rgba(238,242,246,.97) 0 → .94 72px → 0 96px`（同结构，只换 RGB） |
| 分段 `.seg` | 底 `rgba(255,255,255,.06)`；字 `#b7d3f0`；选中底 `#35d4ff` 字 `#04121f` | 底 `rgba(16,33,58,.06)`；字 `#3b4f6b`；选中底 `#0e7490` 字 `#fff` |
| 退出 `.logout` | 字 `#fff`，底 `rgba(255,255,255,.06)`，边 `--dm-line` | 字 `#10213a`，底 `rgba(16,33,58,.04)`，边 `rgba(16,33,58,.14)`；hover 底 `.08` 边 `--dm-accent` |
| 定位进度条 `.geo-bar` | 底 `rgba(53,212,255,.1)`，条 `#0090ff → #35d4ff` | 底 `rgba(14,116,144,.12)`，条 `#1d6fd6 → #0e7490` |
| notice / 错误横幅 | 黄 `#ffd76a` on `rgba(40,28,4,.85)`；红 `#ffb3a8` on `rgba(48,10,10,.85)` | 黄字 `#8a5200` on `rgba(255,250,240,.96)` 边 `rgba(161,98,7,.45)`；红字 `#b42318` on `rgba(255,243,243,.96)` 边 `rgba(215,38,61,.45)`；按钮字 `#10213a` 底 `rgba(16,33,58,.05)` 边 `.2` |
| boot 首屏罩 | `radial rgba(27,98,216,.14)` + `rgba(6,16,36,.92)` | `radial-gradient(60% 70% at 50% 50%, rgba(14,116,144,.08), transparent 70%), rgba(238,242,246,.94)`；环 `rgba(14,116,144,.2)` / `--dm-accent`；字 `#5b6b80` |
| KPI 骨架 / 面板骨架 shimmer | `rgba(120,170,255,.08 → .16)` | `rgba(16,33,58,.06 → .12)` |
| 告警行 hover / `.on` 左条 | | hover `--dm-hover`；左条 `--dm-alarm` |
| 已处理 / 已恢复告警行 `.alarms li:not(.on)` | `opacity: .55` | **不用 opacity**（深墨 55% 只有 3.7:1）。改颜色降档：小区名 `#5b6b80`（5.4:1），区县 / 内容 / 时间 / 标签 `#62728a`（4.9:1），`›` `#8a97a8`。进行中行名字 `#10213a` 16:1，层次仍然一眼分 |
| 告警行闪烁 `feed-flash` | `rgba(255,200,80,.16)` + inset `rgba(255,200,80,.55)` | `rgba(161,98,7,.12)` + inset 1px `rgba(161,98,7,.5)` |
| 「未定位」`.unloc` | `#ffc722` on `rgba(255,199,34,.1)` 边 `.45` | `#8a5200` on `rgba(161,98,7,.08)` 边 `rgba(161,98,7,.4)` |
| 处理中标签 `.tag--on` | `#ff9a9b` | `#b42318` |
| 无告警对勾 `<circle stroke="#00e2a1">` | 硬编码 | `var(--dm-ok)`（SVG 里 `stroke="currentColor"` + `color: var(--dm-ok)`） |
| 区县条形图 `.track` | 底 `rgba(120,170,255,.08)`；条 `rgba(53,212,255,.55)`；首行 `#35d4ff` | 底 `rgba(16,33,58,.08)`；条 `#4b97ac`（3.3:1，不要再用半透明 accent，1.9:1）；首行 `#0e7490` |
| 进行中胶囊 `.pill` | `--dm-alarm` 底白字 | 同（5.0:1） |

### 2.4 ECharts（`src/utils/chartTheme.js` + 两页里的内联色）

| 项 | 深色 | 亮色 |
|---|---|---|
| `AXIS_LABEL_COLOR` | `#7ec7ff` | `#5b6b80` |
| `AXIS_LINE_COLOR` | `rgba(64,110,180,.45)` | `rgba(16,33,58,.25)` |
| `SPLIT_LINE_COLOR` | `rgba(64,110,180,.22)` | `rgba(16,33,58,.12)`（仍虚线） |
| `LEGEND_COLOR` | `#b7d3f0` | `#3b4f6b` |
| `tooltipStyle` | 底 `rgba(6,18,40,.92)` 边 `rgba(0,212,255,.4)` 字 `#d8ecff`，青色外发光 | 底 `rgba(255,255,255,.96)` 边 `rgba(16,33,58,.14)` 字 `#10213a`，`box-shadow: 0 4px 16px rgba(16,33,58,.14)`（去发光） |
| `PALETTE` | `#00d4ff #3b7cff #886eff #ffc722 #00e2a1 #ff7c5c #e665b0` | `#0e7490 #1d6fd6 #6d4fd3 #a16207 #0f8a5f #c2410c #b3327d`（同序同色相，全部 ≥ 4.3:1） |
| 地图页趋势柱 | 其余 `rgba(53,212,255,.55)`，当前 `#35d4ff`；轴字 `#8fb0d0`；柱顶字 `#b7d3f0` | 其余 `#4b97ac`，当前 `#0e7490`；轴字 `#5b6b80`；柱顶字 `#3b4f6b` |
| 详情页 `NIU` 折线 | blue `24,144,255` / green `0,201,120` / cyan `0,229,255` / yellow `245,194,43` / purple `179,127,235` | blue `29,111,214` / green `15,138,95` / cyan `14,116,144` / yellow `161,98,7` / purple `109,79,211`；面积渐变 `.4 → .05` 改 **`.22 → .02`**（白底上 .4 会把网格盖掉） |
| 详情页 y 轴 name `#93b5d6` | | `#5b6b80` |
| 兜底地图 `FallbackMap` | `inRange ['#0b2447','#124a8c','#1b77c9','#20b3e8']`，面 `#0b2447`，边 `rgba(0,212,255,.55)`，字 `#b7d3f0`，强调面 `#1d5fae` 字 `#fff`；散点 `rgba(255,199,34,.15)` 边 `#ffc722` 虚线 | `inRange ['#e6eef2','#b7d3dc','#5fa3b6','#0e7490']`，面 `#e6eef2`，边 `rgba(14,116,144,.55)`，字 `#3b4f6b`，强调面 `#5fa3b6` 字 `#10213a`；散点 `rgba(161,98,7,.12)` 边 `#a16207` 虚线 |

亮色下所有 ECharts 实例要在主题切换时 `setOption(opt, true)` 重画（option 是 `computed`，让它依赖 `theme` ref 即可，见 §8）。

---

## 3. 标记 / 胶囊 / 簇在亮色底上的样子

- **几何一个像素都不改**：直径公式、2px 环、44 px 点按区、角标 18/20 px、胶囊 padding、叠环 inset −5px、脉冲 2.4 s、拆分 / 合并动画、标签避让。只换颜色和两处阴影。
- **为什么是环不是实心**：实心要白字，白字在预警赭石 `#a16207` 上 4.9:1 勉强、在离线灰上 4.7:1、在正常色 5.4:1，都卡在线上；环 + 近白填充 + 深墨数字，数字对比 14:1，而且和深色主题是同一个造型，业主在两种主题之间切不会觉得是两个产品。
- **对比度核算（标记 = 非文字，≥ 3:1）**：

  | | 白 `#fff` | 远山黛 `#f2f4f6` | 雅士灰陆地 `#e2e2e2` | 雅士灰建筑 `#d2d2d2` |
  |---|---|---|---|---|
  | 告警 `#d7263d` | 4.96 | 4.50 | 3.83 | 3.28 |
  | 预警 `#a16207` | 4.92 | 4.47 | 3.80 | 3.26 |
  | 正常 `#0e7490` | 5.36 | 4.86 | 4.14 | 3.54 |
  | 离线 `#65758b` | 4.70 | 4.26 | 3.63 | 3.11 |
  | 叠环 80% | — | 3.3 | — | 2.4（次要线索，可接受；主环仍达标） |

- **文字（≥ 4.5:1）**：圈内数字 `#10213a` 在四种填充上 13.8–14.3；区县名 / 外挂名 / 「k 小区」靠 3px 白描边，等效白底：`#10213a` 16.2、`#3b4f6b` 8.3、`#5b6b80` 5.4。
- **角标**：红底白字 5.0:1，外加 1.5px 白描边——亮色底图上角标常压在深灰注记或红环上，白描边是「角标属于这个圈」的边界。
- **离线**：亮色的「灯灭了」= 灰环 + 几乎白的填充 + 数字变 `#3b4f6b`（比正常的 `#10213a` 浅一档，但不透明）。灰和正常色靠色相分（蓝灰 vs 青），和高德浅色路网白 / 浅灰不撞（路是 `#fff`，灰环 `#65758b` 与之 4.7:1）。
- **脉冲**：同色 2px 环扩散，起始透明度 .7。白底上 .9 的红环扩到 2.2 倍时像一摊，.7 够看见、不抢。
- **hover**：只保留 `scale(1.06)`；深色里「名字变白」在亮色没有更深的颜色可变，不做。

---

## 4. 弹窗、面板、侧栏

- 面板：白 86% 玻璃 + 10% 深墨边 + 双层阴影。亮色底图和白面板只差几个灰阶，**阴影是分层的主要手段**，不能省。
- 弹窗：98% 白、阴影 `0 12px 32px rgba(16,33,58,.18)`；组头 sticky 实底 `#f3f4f5`。
- 文字三档 `#10213a / #3b4f6b / #5b6b80`，对应深色的 `text / text-2 / text-3`。全站只有这三个灰 + 两个语义红（`#d7263d` 填充、`#b42318` 文字）+ 两个语义黄（`#a16207` / `#8a5200`）。
- 已处理 / 已恢复告警行：深色用 `opacity: .55`，亮色下这会把 `#10213a` 压成 `#7c8593`（3.7:1，不达标），所以亮色改成颜色降档（§2.3），不碰 opacity。

---

## 5. 热力「墨染」（`warmLights.js`）

### 5.1 为什么现在的做法在白底上不工作

`ctx.globalCompositeOperation = 'lighter'` 只在**这张 canvas 内部**叠加，canvas 本身是作为普通 DOM 元素盖在瓦片上的（`source-over`）。深色时透明 canvas 上的亮光盖在深底上自然成立；白底上亮光盖白底 = 白。要和底图相乘，必须在**元素层**做：`canvas.style.mixBlendMode = 'multiply'`（Chrome / Safari / Android WebView 都支持）。

### 5.2 规格

```js
// warmLights.js
export const PALETTES = {
  gold:    { halo: [255,184,87], core: [255,222,158], filament: [255,245,219] }, // 深色 不变
  red:     { halo: [255,106,61], core: [255,176,112], filament: [255,240,224] }, // 深色 不变
  ochre:   { halo: [196,138,46], core: [168,106,24],  filament: [107,61,8]   },  // 亮色·项目  #C48A2E #A86A18 #6B3D08
  crimson: { halo: [198,40,60],  core: [160,22,44],   filament: [94,10,28]   },  // 亮色·告警  #C6283C #A0162C #5E0A1C
}
```

| 项 | 深色（不变） | 亮色 |
|---|---|---|
| canvas 元素 | `mix-blend-mode: normal` | **`multiply`**（`set()` / `setTheme()` 时切） |
| 整屏压暗 | `fillRect rgba(14,14,16,.28)`（source-over） | **不画**。multiply 下白色 = 不变，没意义；远山黛本身够淡 |
| 层内混合 | `lighter` | `multiply`（重叠处积深，像墨水） |
| 外晕 halo | 半径 `R`，α `peak × .55 × crowd × breath` | 半径 `R` 不变，α **`peak × .40 × crowd × breath`**（多层 multiply 比 lighter 累积得快，降一档） |
| 芯 core | `min(R×.22, 6+idx×1.2)`，α `peak × .62` | 同半径，α **`peak × .55`** |
| 灯丝 filament | `2.6+idx×.45`，α `peak` | 同半径，α **固定 `.92`**（不乘 peak：1 项目档 peak .62 时墨点只有 2.7:1，固定 .92 后 ≈ 7:1，远景每盏灯都有一个可见的深点） |
| 三层渐变 stop | `0 → α, .5 → α/2, 1 → 0` | 不变 |
| 五档 `TIERS`（min / peak / r / minPx） | 不变 | 不变 |
| `zoomScale`、`crowd` 密度抑制 | 不变 | 不变 |
| 告警呼吸 | 外晕 α × `breath`（2 s） | 同 |
| 小灯先画大灯后画 | | 同 |
| 告警数字 | 同一 canvas，`#FFF0E0` + 3px `rgba(40,10,4,.75)` 描边 | **第二张 canvas**（同尺寸、`mix-blend-mode: normal`，`zIndex 111`，同样 `pointer-events: none`）：字 `#5a0a18`（12.8:1），3px `rgba(255,255,255,.92)` 描边。原因：multiply 下白描边 = 消失，字会直接压在深灰注记上 |

远山黛上的实际落色（相乘后）：项目 1 户档 外晕 `#e4d8c4` / 芯 `#d6c3aa`；20+ 档 外晕 `#ddc9a9` / 芯 `#c7aa82`；墨点每档都是 `#71491b`（α 固定，只有半径随档变）= 7.1:1。告警 20+ 档 外晕 `#dda6af` / 芯 `#c3808c`，墨点 `#651c2d` = 10.8:1。外晕 1.3–1.9:1 是「晕」，读的是面积不是边；芯 1.6–2.8:1；墨点 ≥ 7:1 是「点」，远景每盏灯至少有它。

图例：五档色块换成赭石由浅到深（§2.3），标题「亮度 =」改「深浅 =」。告警口径图例仍用同一套赭石色块（和现在一样不分两套）。

### 5.3 登录页舞台灯

`Login.vue` 自己的 `glow()` 复制了同一模型：亮色时 `canvas.style.mixBlendMode = 'multiply'`、`globalCompositeOperation = 'multiply'`、三色改 `ochre`，α：外晕 `.32 × breath`、芯 `.5`、灯丝 `.9`；`.stage__lights.on` 的 opacity `.85` 保持。

---

## 6. 登录页亮色

| 项 | 深色 | 亮色 |
|---|---|---|
| `.login` 底 | `#040b18` | `#eef2f6` |
| 舞台暗角 `.stage__vignette` | `radial rgba(27,98,216,.16)` + `linear(90deg, transparent 70%, #040b18)` | `radial-gradient(60% 80% at 38% 55%, rgba(14,116,144,.10), transparent 70%), linear-gradient(90deg, transparent 70%, #eef2f6)` |
| logo | 白色（filter） | **原图**（`--dm-logo-filter: none`，深灰 PNG 在 `#eef2f6` 上 9.7:1）；位置 / 高 44 不变 |
| 标题 h1 / 副题 p / 页脚 | `#f2f7ff` / `#8fb0d0` / `#6f8fb8` | `#10213a` / `#3b4f6b` / `#5b6b80` |
| 卡片 `.card` | `rgba(8,20,44,.72)`，边 `rgba(120,170,255,.16)`，阴影 `0 24px 64px rgba(0,0,0,.45)`，字 `#e8f4ff` | `rgba(255,255,255,.88)`，边 `rgba(16,33,58,.10)`，阴影 `0 24px 64px rgba(16,33,58,.14)`，字 `#10213a`；`blur(16px)` 不变 |
| h2 / `card__sub` | `#f2f7ff` / `#8fb0d0` | `#10213a` / `#5b6b80` |
| `card__notice`（登录已过期） | `#ffd76a` on `rgba(255,199,34,.08)` 边 `.3` | `#8a5200` on `rgba(161,98,7,.08)` 边 `rgba(161,98,7,.35)` |
| label | `#8fb0d0` | `#3b4f6b` |
| input | 底 `rgba(255,255,255,.04)` 边 `.10`，字 `#e8f4ff`，占位 `#4f6e93`，hover 边 `.18` | 底 `#ffffff` 边 `rgba(16,33,58,.16)`，字 `#10213a`，占位 `#7b8899`（3.6:1），hover 边 `.28` |
| input focus | 边 `#35d4ff` + `0 0 0 3px rgba(53,212,255,.18)` | 边 `#0e7490` + `0 0 0 3px rgba(14,116,144,.18)` |
| autofill | 内阴影 `#0b1a33`，字 `#e8f4ff` | 内阴影 `#ffffff`，字 `#10213a` |
| 错误态 | 边 `rgba(255,138,122,.7)`，晕 `.18`；msg `#ff8a7a`，图标底 `#ff8a7a` 字 `#04121f` | 边 `rgba(215,38,61,.7)`，晕 `rgba(215,38,61,.18)`；msg `#b42318`，图标底 `#d7263d` 字 `#fff` |
| CapsLock | `#ffc722` | `#8a5200`，图标底 `#a16207` 字 `#fff` |
| 眼睛 `.eye` | `#6f8fb8`，hover `#e8f4ff` + `rgba(255,255,255,.06)`，focus inset `#35d4ff` | `#5b6b80`，hover `#10213a` + `rgba(16,33,58,.06)`，focus inset 2px `#0e7490` |
| 记住账号 | `#8fb0d0`，`accent-color #35d4ff` | `#3b4f6b`，`accent-color #0e7490` |
| 登录按钮 | `#35d4ff` 字 `#04121f`，hover `#5fddff`，focus 外环 `#f2f7ff` | `#0e7490` 字 `#fff`（5.4:1），hover **`#0b5f77`**（亮色 hover 变深），focus `0 0 0 2px #fff, 0 0 0 4px #0e7490`；spinner `rgba(255,255,255,.35)` / `#fff` |
| 成功态 | `#00e2a1` 打勾 `#04121f` | `#0f8a5f` 打勾 `#fff`（只有图标，4.4:1 够） |
| 进场 / shake / 呼吸 | | 全部不变 |

登录页跟随 `localStorage.dm_theme`（同一台机器上登录前后一致），**不**在登录页放切换（P2 可选：页脚一个 36 px 文字按钮「亮色 / 深色」）。

---

## 7. 项目详情页亮色

详情页已经走 `--pd-*` → `--dm-*` 回退链，亮色把回退里的那几个未定义 token 定义出来即可（深色也顺手定义，值 = 现在的回退值）：

| token（`ProjectDetail` / `SmallSelect` / `CityPicker` 在用） | 深色（= 现回退值） | 亮色 |
|---|---|---|
| `--dm-page-bg` | `#050d1d` | `#eef2f6` |
| `--dm-panel-bg` | `#071630`（CityPicker 用 `rgba(6,18,40,.92)`） | `#ffffff` |
| `--dm-panel-border` | `rgba(0,212,255,.28)` | `rgba(16,33,58,.12)`（亮色面板边不再是青色） |
| `--dm-text-muted` | `#93b5d6` | `#5b6b80` |
| `--dm-input-bg` | `rgba(7,22,48,.85)` | `#ffffff` |
| `--dm-popover-bg` | `rgba(7,22,48,.96)` | `rgba(255,255,255,.98)` |
| `--dm-accent-line` | `rgba(0,212,255,.45)` | `rgba(14,116,144,.45)` |
| `--dm-hover` | `rgba(0,212,255,.1)` | `rgba(14,116,144,.08)` |

硬编码处（全部换成 token 或亮色值）：

| 位置 | 深色 | 亮色 |
|---|---|---|
| 标题 / 面板标题 / `.sum__name` / `.kv b` / `.rr__title` / `.ttl` / `.pd__title` `#fff` | | `var(--dm-text)` |
| `.hbtn`（返回 / 退出 / 关闭） | 字 accent，底 `rgba(0,212,255,.12)` 边 `.45` | 字 `#0e7490`，底 `rgba(14,116,144,.08)` 边 `rgba(14,116,144,.45)`，hover 底 `.16`；尺寸不变 |
| `.astrip` | 字 muted，底 `rgba(0,212,255,.06)` 边 `.25`；`.on` 字 `#ffd2d2` 底 `rgba(255,77,79,.1)` 边 `.55` | 底 `rgba(14,116,144,.06)` 边 `rgba(14,116,144,.3)`；`.on` 字 `#b42318` 底 `rgba(215,38,61,.08)` 边 `rgba(215,38,61,.5)` |
| `.live .dot` 默认 / on / off | `#8a9bb3` / `#00e2a1` / `#ff4d4f` | `#65758b` / `#0f8a5f` / `#d7263d` |
| `.lbtn`、`.tabs button`、`.pager button` 边 | `rgba(0,212,255,.35)` / `rgba(147,181,214,.45)` / `rgba(0,212,255,.25)` | 统一 `rgba(16,33,58,.2)`；选中：字 `#0e7490` 底 `rgba(14,116,144,.08)` 边 `#0e7490` |
| `.sum__div` 虚线、`.stats__div` | `rgba(147,181,214,.35)` / `.25` | `rgba(16,33,58,.18)` / `.12` |
| 房间卡 `.rr__card` | 字 `#8193a8`，边 `rgba(255,255,255,.2)`；`.on` 字 `#fff`，2px `rgba(0,212,255,.55)`，底 `.06`，外晕 `0 0 12px rgba(0,212,255,.25)` + inset | 字 `#5b6b80`，边 `rgba(16,33,58,.14)`；`.on` 字 `#10213a`，2px `rgba(14,116,144,.6)`，底 `rgba(14,116,144,.05)`，阴影 `0 0 0 1px rgba(14,116,144,.15), 0 2px 8px rgba(16,33,58,.08)`（去发光） |
| `.rr__head` 底线、`.rr__icon` 边 | `rgba(255,255,255,.2)`；on `rgba(0,212,255,.4/.55)` | `rgba(16,33,58,.12)`；on `rgba(14,116,144,.45)` |
| `.rr__nav` | 字 `#fff`，底 `rgba(0,212,255,.1)` 边 `.35` | 字 `#10213a`，底 `rgba(255,255,255,.9)` 边 `rgba(16,33,58,.16)`，阴影 `--dm-shadow` |
| 设备表 `.eq` | th 底 `rgba(0,212,255,.1)`，td 底线 `rgba(64,110,180,.15)`，偶行 `rgba(0,212,255,.03)`；在线灰 `#8a9bb3` / on accent | th 底 `#f3f6f9` 字 `#3b4f6b`，td 底线 `rgba(16,33,58,.08)`，偶行 `rgba(16,33,58,.02)`；离线 `#65758b` / 在线 `#0f8a5f`（在线改绿，和实时点一致；深色也建议一起改成 `--dm-ok`） |
| `.astrip__list` 浮层 | 底 `rgba(6,18,40,.97)` 边 `rgba(0,212,255,.45)` 阴影黑 .5；行虚线 `rgba(64,110,180,.25)`；`.d #fff` | 底 `rgba(255,255,255,.98)` 边 `rgba(16,33,58,.14)` 阴影 `--dm-shadow-pop`；行虚线 `rgba(16,33,58,.12)`；`.d #10213a`；`.on` 左条 `#d7263d` |
| 抽屉 `.drawer` | 阴影 `-8px 0 24px rgba(0,0,0,.5)` | `-8px 0 24px rgba(16,33,58,.14)` |
| `.pd__error` | `#ff8a7a`，边 `rgba(255,124,92,.6)` | `#b42318`，边 `rgba(215,38,61,.5)`，底 `rgba(255,243,243,.96)` |
| `.pd__logo .mark` 字 `#04121f` 底 accent | | 字 `#fff` 底 `#0e7490` |
| `SmallSelect` hover 行 `#fff` on `rgba(0,212,255,.18)`；选中 accent on `.08` | | hover `#10213a` on `rgba(14,116,144,.10)`；选中 `#0e7490` on `rgba(14,116,144,.06)`；列表阴影 `--dm-shadow-pop` |
| `CityPicker` | 面板阴影 `0 16px 40px rgba(0,0,0,.45), 0 0 14px rgba(0,212,255,.15)`；筛选框底 `rgba(0,0,0,.25)`；条 `rgba(0,212,255,.12)` / `rgba(53,212,255,.35)`；选中行 `#fff`；标题态 hover `rgba(255,255,255,.06)` | 阴影 `--dm-shadow-pop`（去青色发光）；筛选框底 `#f3f6f9`；条底 `rgba(16,33,58,.08)` / 条 `#4b97ac` / 选中条 `#0e7490`；选中行 `#10213a`；hover `rgba(16,33,58,.06)` |
| `BoxLoading` | accent | `var(--dm-accent)`（已是变量） |
| ECharts | §2.4 | §2.4 |

详情页**不放**切换按钮，跟随 `dm_theme`（P2 可选：`.pd__right` 加一个同款 `.hbtn`「亮色 / 深色」）。

---

## 8. 切换控件与实现

### 8.1 控件

- 位置：地图页顶栏 `.controls`，**退出按钮左侧**（顺序：点位/热力 · 项目/告警 · 时钟 · 账号 · **深色/亮色** · 退出）。主题是系统偏好，和退出放一组；数据模式分段留在左边。1350（逻辑 1588 px 宽）下右侧总宽 ≈ 850 px，放得下。
- 样式：复用 `.seg`（高 36 + 2px padding = 40 px，每段 `min-width 56px`，选中态 accent 实底）。两段文字 `深色` / `亮色`，不用图标（和旁边的「点位 / 热力」同款；电视 3 m 外文字比 ☀ / ☾ 可靠）。`role="group" aria-label="主题"`，按钮 `aria-pressed`。
- 行为：点击 / 遥控 Enter 即切，无确认、无过渡动画（UI 颜色瞬切；高德换底图自己有瓦片淡入；热力 canvas 下一帧重画）。不做全站 `transition: color`——截图时会截到中间帧。
- 焦点：`:focus-visible` 2px `--dm-focus`；选中段上用双环。

### 8.2 状态

```js
// src/composables/useTheme.js
const KEY = 'dm_theme'                       // 'dark' | 'light'；缺省 dark
export const theme = ref(readInitial())      // URL ?theme=light|dark 优先（只对本次会话生效，不写入 localStorage —— 展厅电视不会被别人发的链接改掉）
watch(theme, apply, { immediate: true })
function apply(t) {
  document.documentElement.dataset.theme = t            // 驱动全部 CSS 变量
  document.documentElement.style.colorScheme = t        // 原生滚动条 / checkbox 跟随
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#eef2f6' : '#040b18'
}
export const setTheme = (t) => { theme.value = t; localStorage.setItem(KEY, t) }
```

- `index.html` `<head>` 里加一段内联脚本在 CSS 之前读 `localStorage.dm_theme` 并设 `data-theme`，首屏那个内联 spinner 的底色改 `var(--dm-bg)`（在同一段内联 `<style>` 里给 `:root[data-theme=light]{--dm-bg:#eef2f6}`），避免亮色用户每次打开先黑一下。
- 三个页面都 `import { theme }`；`DealerMap` 是 keep-alive 的，`watch(theme)` 仍然活着。

### 8.3 JS 里的颜色（CSS 变量管不到的）

| 位置 | 现状 | 改法 |
|---|---|---|
| `states.js` `STATES[*].color`、`NOTICE_COLOR` | 十六进制 | 改成 `'var(--dm-alarm)'` / `'var(--dm-warn)'` / `'var(--dm-offline)'` / `'var(--dm-normal)'` / `'var(--dm-notice)'`。它们只被写进 `style="--c:…"`、`style="background:…"`、图例 `'--c': st.color`，内联样式里 `var()` 照常解析，**零 JS 逻辑改动**；`markColor()` 已经在用 `var(--dm-offline)` |
| `AmapView` `MAP_STYLE` | 常量 `darkblue` | `watch(theme)` → `map.setMapStyle(t === 'light' ? 'amap://styles/whitesmoke' : 'amap://styles/darkblue')`；`setFeatures` 分档照旧重新 `applyFeatures()`（换样式后高德会重置 features） |
| `warmLights.js` | `PALETTES.gold / red` | 增加 `ochre / crimson` + `setTheme(t)`（切 `mixBlendMode`、层内 composite、调色、第二张字 canvas）；`renderHeat()` 里 `heat.set(lights, metric === 'alarms' ? (light ? 'crimson' : 'red') : (light ? 'ochre' : 'gold'))` |
| `Login.vue` 舞台 | 常量 `HALO / CORE / FIL` | 同上按 `theme` 取 |
| `chartTheme.js` | 常量 | 改成 `chartTheme(theme)` 返回同名字段；`tooltipStyle / categoryAxis / valueAxis` 接收 theme 或内部读 `theme.value`；两页的 `timeOption / dayOption / sensorOption / seriesOption` 的 `computed` 里引用一次 `theme.value` 即可触发重算 |
| `DealerMap` `HEAT_TIERS` | 常量 | `computed` 按 theme 取两套；标题文案「亮度 / 深浅」同 |
| `FallbackMap` | 常量 | 同 |
| 无告警对勾 SVG `stroke="#00e2a1"` | 硬编码 | `currentColor` |

### 8.4 验收

1. 三张底图各一组截图（城市视野 / z12 点位 / z14 胶囊 / 热力项目 / 热力告警 / 弹窗 / 登录 / 详情），1920×1080 + 1350×700。
2. 亮色下用取色器抽查：区县圈环 vs 周围底图 ≥ 3:1；圈内数字 ≥ 4.5:1；面板最浅的 12 px 字（状态行、KPI 标签）≥ 4.5:1。
3. 切换时：弹窗开着不关、视野不动、热力模式不退回点位、跑马灯不重启；刷新页面后保持；`?theme=light` 打开后刷新（去掉参数）回到本机设置。
4. 键盘：Tab 到主题控件可见焦点环，Enter 切换；切换后焦点仍在控件上。
5. 深色主题任何一张截图与改前逐像素一致（token 化不能带来深色回归）。

---

## 9. 不许动的

- 布局、尺寸、间距：顶栏 96、侧栏 380、面板高度、KPI 1 大 4 小、弹窗 360×k、所有 40 / 44 px 点按区。
- 标记几何：直径公式、2px 环、叠环、角标尺寸、脉冲周期、标签避让、拆分 / 合并动画、`--k` 缩放。
- 聚合四级与阈值、`setFeatures` 分档、城市名 / 区县名「只画一份」的分工。
- 热力五档 `TIERS`、半径、`zoomScale`、`crowd`、呼吸周期——亮色只换混合方式和调色。
- 语义：红 = 告警、黄 / 赭 = 预警、灰 = 离线、青 = 正常；图例顺序与文案（除「亮度 → 深浅」）。
- 字体（PingFang / Barlow）、字号阶梯、`tabular-nums`。
- 深色主题的每一个值（深色仍是默认，展厅不受影响）。
- 跑马灯 mask、`prefers-reduced-motion` 分支、弹窗 × 的 pointerdown 方案、退出整页重载。
- logo：用原 PNG，不新切图；深色继续用 filter。
- 展示模式 `?showroom=1`、`?kiosk` 等参数的语义；`dm_theme` 是新 key，不复用 `dm_remember` 之类。

---

## 附：对比度计算

脚本 `~/.tomo/workspace/tmp/dealermap/offline/lightcalc/contrast.py`（WCAG 2.x 相对亮度，alpha 合成按 sRGB 线性混合近似）。假设的底图取样：白 `#ffffff`、远山黛陆地 `#f2f4f6`、雅士灰陆地 `#e2e2e2`、雅士灰建筑 `#d2d2d2`；面板等效底 `#fdfdfe`（白 86% 盖在远山黛上）。工程截到真实瓦片后，把实测的陆地 / 建筑 / 水三个色值填回脚本复核一遍即可。
