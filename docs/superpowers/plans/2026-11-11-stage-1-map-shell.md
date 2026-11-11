# 阶段一 页面复用与微信运行实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的旧版地图及页面结构迁入新 app 工程，形成能在微信开发工具运行的页面基础；真实登录与云端打卡在阶段二接通。

**Architecture:** 保留现有 App.uvue/main.uts 和 DCloud 身份配置，使用微信可用的内置 map 与新的轻量展示封装。旧版只作为页面、资源和交互参考；新工程不连接旧版演示代理，不自动初始化旧数据库。

**Tech Stack:** 当前已安装 HBuilderX 5.15、uni-app x、UTS/uvue、内置 map；Node.js node:test 用于纯状态逻辑。

**Spec:** [设计说明](../specs/2026-11-10-feiyiyunxiang-design.md)；[总路线图](2026-11-11-development-roadmap.md)。

## Global Constraints

- 微信小程序目标；无底部 Tab，无中央圆形按钮；侧边澳喵跳转、旧图钉、默认收起路线条。
- 原图/旧工程只读；不复制整个 uni_modules、原生 SDK 类型、旧云函数和历史数据。
- 预览 fixture 明确显示“开发演示”，不会把选图或按按钮当作服务端打卡成功。
- 不改变已关联云服务，不把 DCloud AppID 当作微信 AppID，不暴露密钥。
- 所有后续业务接口通过 feature 适配器接入，页面不直接持有 mock SDK 或管理员权限。

## Review Focus

1. 返回地图保留 routeId、选中节点与视野；对应 Task 1 状态验证。
2. 无路线和空节点不出现无效底栏；对应 Task 2 验收。
3. 触控和地图手势不相互遮挡；对应 Task 2 微信设备检查。
4. 退出、登录中断等未接通能力不显示成功；对应 Task 3/4 页面检查。
5. 生产构建不启用演示账号、云 SDK 替换或演示内容入口；对应 Task 4 检查。

## 文件结构与约定

- `app/features/exploration/types.uts`：`RouteSummary`、`RouteNode`、`MapViewport` 数据约定。
- `app/features/exploration/map-state.js`：纯状态 reducer；`map-state.uts` 为 UTS 兼容镜像，行为在应用集成验收核对。
- `app/features/exploration/map-store.uts`：Vue reactive 保存页面共享的地图状态。
- `app/features/exploration/demo-fixtures.uts`：开发展示数据，独立显式开关，发布构建关闭。
- `app/components/exploration/RouteMap.uvue`：内置 map 的 marker/事件展示封装；不依赖 Android 原生 SDK 类型。
- `app/components/exploration/MapSideActions.uvue`：两侧跳转与地图操作。
- `app/components/exploration/CurrentRoutePanel.uvue`：当前路线进度折叠条。
- `app/components/AppPageHeader.uvue`：复用旧页头的结构并接入返回地图规则。
- `app/pages/index/index.uvue`：组合首页，不堆入所有领域逻辑。

客户端共有类型固定为：`RouteSummary = { id:string, name:string, total:number, done:number, nextNodeId:string|null }`；`RouteNode = { id:string, title:string, latitude:number, longitude:number, checked:boolean }`。store 导出 `mapState:MapState` 与 `dispatchMapEvent(event):void`，参数类型与 reducer 一致。开发 fixture 仅在开发编译且显式启用展示时读取，正式构建不能通过本地缓存打开它。

### Task 1 地图状态与页面返回契约

**Files:** Create `app/features/exploration/types.uts`、`map-state.js`、`map-state.uts`、`map-store.uts`、`app/tests/map-state.test.cjs`。

**Interfaces:** `MapViewport = { latitude:number, longitude:number, scale:number }`；`MapState = { routeId:string|null, selectedNodeId:string|null, viewport:MapViewport, panelExpanded:boolean }`。纯函数 `reduceMapState(state,event)` 处理 `select-route`、`select-node`、`set-viewport`、`toggle-panel`、`clear-route`。`select-route` 事件含 routeId 和目标视野，`clear-route` 清空选中节点并收起面板。

- [ ] 写失败测试 `starts_collapsed_without_route`、`selecting_node_preserves_route`、`returning_from_child_keeps_viewport`、`clear_route_hides_and_collapses_panel`；断言无路线时 routeId 为 null、panelExpanded 为 false，返回保留原视野数值。
- [ ] 运行 `node --test app/tests/map-state.test.cjs`，确认因模块未实现而失败。
- [ ] 实现 reducer、类型与 reactive store；UTS 镜像只解决编译兼容，不额外改变业务规则。
- [ ] 重跑上述测试，全部 PASS；后续页面返回验收同时核对实际 UTS 行为。
- [ ] 若已建立 Git 仓库，按本任务文件作本地提交；不推送、不改无关文件。

### Task 2 地图首页与精选资源

**Files:** Modify `app/pages/index/index.uvue`、`app/pages.json`、`app/uni.scss`；Create 上述三个 exploration 组件、`app/static/ip/`、`app/static/map/`、`app/features/exploration/demo-fixtures.uts`。

**Interfaces:** `RouteMap` 接收 `nodes:RouteNode[]`、`selectedNodeId:string|null`、`viewport:MapViewport`，发出 `node-select(nodeId:string)`、`viewport-change(viewport)`。`CurrentRoutePanel` 接收 `route:RouteSummary|null`、`expanded:boolean`，发出 `toggle`、`continue-task(nodeId:string)`。`MapSideActions` 发出 `navigate(target:string)`、`zoom(delta:number)`、`locate`。

- [ ] 精选复制澳喵、侧边入口及四种 marker 状态图；新路径使用中性名称，保留来源清单。不得整目录搬入旧步数/商城资源。
- [ ] 按当前草图组合首页：左右小按钮、无中央圆形按钮、无 tabBar、路线条默认收起。未选路线时隐藏条；路线按钮进入列表，底条展开当前任务。
- [ ] `RouteMap` 绑定微信内置 map 数据；灰色/彩色图钉根据本次 run 的展示状态选图，选中图与状态组合映射完整。内部维护数字 marker ID 到字符串 nodeId 的映射，点击回传稳定 nodeId，不把数组下标当业务主键。不得复用旧 SDK namespace。
- [ ] 微信开发工具检查：小屏及大屏可点击、胶囊和安全区无重叠、拖动缩放不被面板全屏拦截，节点选择正确；打开/关闭面板不重置视野。
- [ ] 对没有路线、空节点、超长中文标题、定位拒绝分别检查；定位失败保留当前视野并给重试，不默认授予成功。
- [ ] 本地提交本任务文件（仓库建立后）。

### Task 3 复用旧二级页面与导航

**Files:** Create `app/components/AppPageHeader.uvue`；Create `app/pages/routes/routes.uvue`、`route-detail/route-detail.uvue`、`checkin-detail/checkin-detail.uvue`、`checkin/checkin.uvue`、`my-checkins/my-checkins.uvue`、`account/account.uvue`、`community/community.uvue`、`community-post/community-post.uvue`、`partner/partner.uvue`、`story/story.uvue`；Modify `app/pages.json`。

**Interfaces:** 路线详情 query 为 `routeId`，节点详情/打卡 query 为 `nodeId`，帖子详情 query 为 `postId`。页面统一 navigateTo/navigateBack；无历史栈时 reLaunch 地图。从路线选择后写共享 store，返回地图不再按旧城市/坐标覆盖选择。

- [ ] 按旧页结构迁入资料卡、路线封面与节点、日记足迹、私密照片备注、帖子评论布局，移除云调用和已删除入口后接入 feature 读取边界；不是仅复制图标后重画所有页面。
- [ ] 用明确的开发演示数据验证页面及参数；保留未接通功能的真实提示。上传、审核、PK 不展示伪造成功状态。
- [ ] 检查首页每个侧边入口、节点、路线条任务、二级返回，以及直接带 query 打开/缺失 query 的空态，确保无 switchTab 依赖。
- [ ] 查看旧页面后返回首页，确认 routeId、选中点、地图视野均保留；相关状态验证重跑 `node --test app/tests/map-state.test.cjs`。
- [ ] 本地提交本任务文件（仓库建立后）。

### Task 4 微信编译与阶段交付

**Files:** Modify `app/manifest.json` 仅限微信必需配置（需用户提供真实微信 AppID时再填）；Create `docs/validation/stage-1-weixin.md`。

**Interfaces:** 本阶段输出可编译的小程序页面基础，作为阶段二身份、媒体与探索接口的消费者；任何未接云端行为明确标注，不称真实打卡完成。

- [ ] 在 HBuilderX 打开新 app 工程并选择微信小程序编译。可用本机已提供的 CLI：`D:/HBuilderX/cli.exe launch mp-weixin --project C:/Users/Raymond/Desktop/feinibuke/feiyiyunxiang/app --compile true`。如工程未导入先导入，不借用旧项目路径。
- [ ] 记录编译器版本、构建结果和实际错误；缺微信 AppID/开发工具权限时只请求所需配置，不更换云绑定、不往客户端填 Secret。
- [ ] 在微信开发工具验证 Task 2/3 交互，记录是否真机验证；至少保存地图首页、路线、日记和社区截图，不用 Web 截图替代微信运行证据。
- [ ] 检查正式构建：关闭 demo-fixtures 展示入口，无 `LOCAL_DEMO_NOT_A_REAL_TOKEN`、无 `/__local-demo.js`、无代理云 SDK；业务未接通时明确不可用，不回退测试身份。
- [ ] 重跑本阶段状态测试并检查改动；交付实际可运行页面和局限，再开始阶段二详细计划。

## 完成标准与阶段边界

本阶段通过意味着已将主要旧页面迁入微信可运行工程、导航与地图状态有效；不意味着登录、打卡入库、帖子审核或双人玩法已完成。阶段二才接入真实微信身份、私有媒体和最小后台并完成第一条真实打卡闭环。

首次实施前检查 app/admin 是否有用户新改动及远程已有文件。没有 Git 仓库时先核对远程现状再建立版本管理，不用强制重置覆盖。云部署不属于此阶段。
