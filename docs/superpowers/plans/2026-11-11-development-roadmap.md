# 非遗云想微信小程序开发路线图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已确认设计基础上复用旧页面，实现微信小程序、两地合作玩法与配套运营后台。

**Architecture:** app 为微信小程序，admin 为桌面 Web 管理端，沿用用户新建的 uni-app x 工程。app/uniCloud-alipay 为候选唯一云端源码来源，两端使用同一套受控业务接口；关联和能力需要实施时核实。复用旧视觉和组件，不复制旧数据库、不迁移历史数据、不直接继承旧权限漏洞。

**Tech Stack:** uni-app x、UTS、uvue、uniCloud、uni-id 身份能力；纯云端领域逻辑用 Node.js node:test 验证。

**Spec:** [已确认设计](../specs/2026-11-10-feiyiyunxiang-design.md)；[当前草图](../../design/2026-11-11-map-home-design.html)；[旧版复用评估](../../design/2026-11-11-legacy-reuse-review.md)。

## Global Constraints

- 项目目录 C:/Users/Raymond/Desktop/feinibuke/feiyiyunxiang；GitHub git@github.com:luochiioi/feiyiyunxiang.git。
- 只以微信小程序作为用户端发布目标；后台是桌面 Web；app/admin 基础工程已由用户创建。
- 首页保留大地图、左右澳喵入口；无底部 Tab、无中央圆形按钮；当前路线条默认收起，未选路线隐藏。
- 侧边草图尺寸 46×55，图标约 30；正式实现核对逻辑像素、触控与安全区，不照搬 rpx/px 数值。
- 点位用旧版灰色/彩色澳喵图钉，以及原选中状态图；打卡照片默认私密。
- 不迁移旧数据；不恢复步数、金币、商城、道具、抽奖、养成、校园入口或旧 AI 路线生成。
- AI 猜图只保留“敬请期待”；邮箱、学生认证、展品识别和人工打卡审核不在首版。
- 失败任务 assignedAt + 72 小时后可拒绝，完成或拒绝后解除本人下一次 PK 限制。
- 私密凭证与社区图片独立，帖子及修改先审后公开；评论云端过滤与限流。
- 本地预览 SDK 替换和模拟登录仅用于设计，不进入 app/admin 业务代码，不进入正式身份流程。

## Review Focus

1. 微信真机地图与遮挡：缩小图标后仍能准确点击，胶囊和底部条不抢地图手势。阶段一检查。
2. 授权失败与中断：游客、拒绝定位、会话过期、上传失败有恢复路径，不伪造打卡成功。阶段二检查。
3. 并发和重放：打卡、合作成果、PK 结算只产生一次，72 小时用服务器时间。阶段二及四检查。
4. 发布与私密边界：猜文件 ID、待审版本和用户间越权无法暴露照片。阶段二及五检查。
5. 内容停用与在途进度：版本固定、闭馆或下架有有日志的取消处理，不使用户被永久锁住。阶段三及四检查。

## 工作划分

总范围按依赖分阶段；当前先提供阶段一的可执行计划。每个后续阶段开始前补齐对应详细任务和接口测试，不把这份路线图当作所有子系统已完成的技术细案。

| 阶段 | 可运行成果 | 复用与新增 | 验收重点 |
| --- | --- | --- | --- |
| 一 页面基础与微信运行 | 地图首页、路线列表/详情、点位详情、档案、社区和我的页面能在微信开发工具运行 | 复用旧布局、图钉、澳喵、卡片；适配微信页面和返回状态 | 无 Tab/圆形按钮，路线条收起，地图可点击，旧源码不改 |
| 二 真实探索闭环与最小后台 | 微信登录 → 后台发布路线 → 定位照片私密打卡 → 日记和进度 | 新身份、媒体归属、独立 checkins、后台发布和权限 | 真实云端联调、越权、失败重试、重复提交、普通用户不能管理 |
| 三 剧情与文化互动 | 六幕阅读、DIY、答题、学习卡、进度恢复、后台版本发布 | 复用旧剧情阅读器，替换内容与门槛；新增现代收尾 | 分支、资源失败、断点恢复、在途版本、文化事实校订 |
| 四 好友合作与 PK | 两地好友组队、双方进度、共同成果；可选 PK 与三天任务 | 复用好友卡和关系界面，新增状态机 | 原子结算、24 小时无完成处理、72 小时边界、退出和异常取消 |
| 五 社区审核与治理 | 发帖、修改审核、评论、互动、举报、好友路线榜与后台治理 | 复用帖子/评论布局，重做发布版本、媒体及治理 | 待审不可读、旧公开版与新版切换、规则限流、禁言和审计 |
| 六 完整联调与交付 | 微信双机跨账号验证、后台闭环、素材配置齐全、可发布构建 | 接通站内消息、账号处理、资源清理，关闭测试内容 | iOS/Android 微信真机、权限拒绝、弱网、隐私、空态和内容停用 |

### 文件及接口分工

- `app/components/` 与 `app/pages/`：页面结构、地图壳、入口、表单、展示和返回；不在页面里决定可信结算。
- `app/features/exploration/`、`story/`、`partnership/`、`challenge/`、`community/`：客户端数据类型、状态及云端适配器。
- `app/uniCloud-alipay/cloudfunctions/`：按 identity、exploration、story、partnership、challenge、community、media、operations 边界组织；最终云对象名在对应阶段计划锁定。
- `app/uniCloud-alipay/database/`：单一来源 schema/index；打卡不再嵌在公共点位数组。
- `admin/pages/`、`admin/features/`：路线剧情发布、审核、评论词库、用户和活动异常处理；调用服务端权限接口。
- `docs/superpowers/plans/`：各阶段任务、已执行检查和交接说明；不存放密钥。

## 阶段五追加：合作与 PK 的发起入口

阶段四交付的合作详情页与 PK 页只有"进行中"视图，没有发起入口。旅伴页的「查看合作」「进入 PK」不带 `teamId`/`matchId`，详情页 `onShow` 判断标识为空就直接显示"还没有进行中的"，再跳到没有发起按钮的路线列表页。`invitePk` 云端动作前端从未调用。阶段五补上发起入口，与社区审核并行，不依赖社区部分。

- 合作详情页（`app/packages/partner/coop/coop.uvue`）无进行中合作时，显示"选路线 → 选好友 → 选席位（默认澳门）→ 发起"。路线来自 `catalog`，不能拆成澳门/湖南两席的路线禁用并说明原因，避免选了才收到 `INVALID_ROUTE`。发起调用已有的 `inviteCoop({ code, routeId, requestId, seat })`，成功后用返回的 `teamId` 加载本页详情。
- PK 页（`app/packages/partner/pk/pk.uvue`）同样改为"选路线 → 选好友 → 发起"，路线无席位限制，调用已有的 `invitePk({ code, routeId, requestId })`。同时补上 PK 页 `onShow` 真正读取对局状态，替换现在写死的 `status: 'preparing'`。
- 旅伴页（`app/packages/partner/partner/partner.uvue`）邀请码文字右侧加「复制」按钮，用 `uni.setClipboardData`。
- 云端需要补两个只读动作，否则页面找不到对局：现有 `coopStatus` 必须传 `teamId`，被邀请的一方无从得知；PK 完全没有读取对局的动作。新增 `myCoop(u)`、`myPk(u)`，返回当前用户处于 `invited`/`active`（PK 另含 `preparing`/`running`）的那一个团队或对局的视图，没有则返回 `null`；两个动作加进 `index.js` 的 `serviceActions`。结算、邀请、响应的现有逻辑不改。
- 客户端适配器加在 `app/features/partner/partner.uts`，沿用 `secured` 与 `requestId()`。PK 页还缺 `respondPk`、`settlePk`、`forfeitPk`、`cancelPk` 的适配器，按需补上。
- 实施前先核实：合作/PK 创建的 run 带 `purpose: 'coop'|'pk'`，需确认路线详情和打卡页能否打开这类 run，以及 `progress`/`routeProgress` 是否会把它们和普通探索 run 混在一起。不能打开则这一节要把"开始探索"入口也补上，范围会变大，先向用户报告再做。
- 验收：无进行中合作时能在合作页直接发起并看到"待接受"；对方接受后双方看到进度。PK 同理，且有未处理失败任务时发起按钮不可用。

## 首先执行的计划

- [ ] 审阅 [阶段一 页面复用与微信运行](2026-11-11-stage-1-map-shell.md)。
- [ ] 实施阶段一，在微信开发工具中演示实际页面。
- [ ] 进入阶段二前核实开发云空间、微信 AppID、uni-id 配置与存储私密访问能力，准备具体变更后确认部署目标。

## 配置资料按需提供

目前可以先完成页面复用和本地检查，不要求一次性提供所有配置。微信工具正式身份与登录联调时需要微信 AppID/开发权限；云端联调时需要确认开发空间、两工程关联和后端配置方式。Secret 不写客户端、不粘贴到日志或文档。

真实路线发布前提供两馆正式名称、位置、允许打卡区域、首批节点和素材；否则仅使用明显标记的开发演示内容。内容素材可与软件开发同步准备。

## 交付与执行建议

每一阶段完成后提供实际可运行结果、检查记录和未解决限制，再推进下一阶段。推荐由当前会话按依赖顺序实施，避免多个阶段同时改变身份、数据和接口。未确认开始编码前不写业务代码；本轮只保存计划及点位图标修订。

Git 初始化前检查用户指定远程是否已有内容，不覆盖既有历史；工作提交分任务进行，推送只在明确授权的范围内执行。本次没有进行初始化、提交、推送或云部署。
