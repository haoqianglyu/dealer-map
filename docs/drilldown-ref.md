# 二级界面参考：niuniu 房间详情页（room-detail）

来源：`haoqianglyu/niuniu`（只读克隆于 `~/code/work/niuniu-ref`）。路由 `/dashboard/room-detail`（`src/views/Dashboard/RoomDetail.vue`），
入口为项目列表 `ProjectRight.vue` 的「查看设备>」，参数全部经 `history.state` 传入：
`project_id, project_name, level, app_name, app_version, using_config_id, default_config_id, other_info[]`。

## 布局
两列 flex：左 6 / 右 4，列内纵向 gap 20px。

| 位置 | 组件 | 内容 |
|---|---|---|
| 左 1 (1.5) | ProjectSum | 项目名；项目信息（等级/应用名称/系统版本）；室内数据（温/湿/PM2.5/CO₂）；清洁/更换（other_info 分页 4 条）；室外数据（温/湿/PM2.5） |
| 左 2 (2.5) | RoomReal | 各房间实时数据 |
| 左 3 (2) | RoomStats | 左：24 小时房间数据统计（平均温度/平均露点）；右：室内传感器 30 天日均（温度/湿度/PM2.5/CO₂，可切传感器） |
| 右 1 (2) | MeterData | 电表数据（时/日/月/年） |
| 右 2 (2) | BuildingStats | 建筑能耗（时/日/月/年） |
| 右 3 (2.5) | Equipments | 设备运行系统表：在线点、名称、设备 ID、设备类别、「查看数据>」抽屉 |

## 接口
| 接口 | 方法 | 请求 | 响应要点 | 用于 | 性质 |
|---|---|---|---|---|---|
| `/project-config/{using_config_id \|\| default_config_id}` | GET | — | `project_config_entity.config`（JSON 字符串：`空气Model/水力Model/冷热源Model/传感器Model/空气设备Model/floorConfigModel[].roomConfigList[]`，每项 `{id,name,model[]}`） | 设备清单、传感器列表 | 只读 |
| `/ctrl/get-device-data-list` | POST | `{device_id, project_id, start_time, end_time}`（秒） | `entities[{d1 温度, d2 湿度, d3 PM2.5, d4 CO₂, timestamp(秒)}]` | RoomStats 右图（传感器 model 含 `620db09cdcae9b926dc804e1`） | 只读 |
| `/device-categories` | POST | `{page_options:{page:1,limit:0}}` | `device_category_entities[{id,name}]` | 设备类别名 | 只读 |
| `/device-models` | POST | 同上 | `device_model_entities[{id,category_id}]` | model→类别 | 只读 |
| `/me` | GET | — | `user_entity.id` | Equipments 透传需 userId | 只读 |
| `/ctrl-message/pass` | POST | `{project_id, message_type, body(base64 protobuf), [user_id]}` | `request_id` | **实时透传**：41 RoomStatusGet（室内外、24h 统计）、40 RoomDataGet（RoomReal）、44 AmmeterDataQuery（电表）、43 EnergyDtoQuery（能耗）、30 OnlineDeviceListQuery（在线设备）、15 DeviceDataGetQuery（设备数据抽屉） | **设备控制通道**（向现场控制器发消息） |
| `/ctrl-callback-result` | POST | `{message_type, request_id}`，轮询 3s×5 | `body`（base64 protobuf，`src/utils/ctrlcb_pb.js` 解码） | 同上 | 控制通道回执 |

## dealer-map 的实现（2026-10-21）
- 路由 `#/project/:id`（`src/views/ProjectDetail.vue`），入口：小区弹窗每个项目行「详情 ›」、告警列表「详情 ›」；地图页 keep-alive，返回恢复原视图。
- 项目本体：`GET /project/{id}`（`/projects` 的 `project_ids` 过滤无效）。只读接口同上表。另加 10 天一级告警区（niuniu 没有）。
- 设备透传（业主 10/21 批准「该查的查」）：只放行查询类 message_type 41/40/44/43/30/15；Worker 校验 body.message_type，其它一律 403 并记录类型。
  只在打开详情页时查询，页面可见时最多 60 秒自动刷新一次 + 手动「刷新」；回执轮询 3 秒 × 5，超时显示「现场设备未响应」。
  protobuf：`src/vendor/ctrlcb_pb.js`（niuniu 原文件，按需加载 ~86 KB gzip）。40/41 的 body 为 "{}"，30/15 为 base64 protobuf 且带 user_id。
- 实测（生普账号）：30、15 普遍有回执；41/40 在「通用版 4.3.x」项目有回执，「水温湿 2.5.x」项目超时；43/44 在测到的项目上都超时（可能没有电表/能效数据）。
- 清洁/更换区块按业主要求不做。
- 展示模式 `?showroom=1`：项目名只留小区名（隐去户号）；客户姓名/电话本页不显示。
