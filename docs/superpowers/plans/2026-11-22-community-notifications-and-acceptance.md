# 非遗云享社区审核消息与联调收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户会另开会话实施，本会话只规划。

**Goal:** 在「我的」提供可补读的社区审核消息，打通结果、原因、对应版本与已读，并用可复现证据收尾社区和管理端的联调缺口。

**Architecture:** 沿用 uni-app x、支付宝 uniCloud、现有作者会话与独立后台会话。在审核状态变更的原事务中写入收件人专属消息，消息模块独立负责本人查询和已读；帖子与图片继续通过原有权限接口读取。首轮只接社区人工审核结果，为后续好友、合作和 PK 通知保留扩展位置。

**Tech Stack:** UTS / .uvue、Node.js CommonJS 云函数、uniCloud Schema／索引、node:test、HBuilderX 5.15。

**Spec:** `docs/superpowers/specs/2026-11-10-feiyiyunxiang-design.md` 第 4、10–13、15 部分；`docs/PROJECT-TODO.md` 第 4–6 部分；本计划「本轮产品决定」。已有实现和联调边界见 `docs/validation/community-admin-iteration.md`。

## Global Constraints

- 每轮先 fetch 最新 `origin/main`，从它创建独立 `codex/` 分支及 worktree；保留所有原工作区改动。开发分支推送后 PR 到 `main`，不自行合并，不直接推 `main`。
- 云函数、Schema、索引上传及正式发布需要项目方另行明确授权；本计划与新会话提示词不代表部署授权。无授权时交付可检查的变更、部署顺序和待联调清单。
- 保留当前澳喵图片、领取与恢复、探索档案、九图与单图重试、审核缩略图、绿色侧栏底部「退出登录」、红色驳回标记和仅箭头的返回按钮。
- 保留最新 main 已合入的微信步数、自动同步、好友步数榜、路线榜及双城终章，不能用旧分支覆盖。
- 不修改路线、地图、馆内任务、剧情、AR、单馆试点；本轮也不做私信、账号注销、日记删除、资源批量清理、全站通知或后台群发。
- 不新增底部 tabBar，不用 switchTab。消息从「我的」进入，复用 `AppPageHeader`；无上页时沿用回首页逻辑，返回只显示箭头。
- 消息权限只能来自服务端会话，不接受客户端指定收件 uid；审核权限不赋予读取个人原始打卡照片或日记的能力。

## Review Focus

1. 审核提交时响应丢失、并发处理或事务重试：结果、审计和消息同成同败，一次状态转移只有一条消息（Task 3）。
2. 切换账号或旧请求延后返回：上一账号的列表、详情、未读数和已读回执均不能污染当前账号（Task 4）。
3. 同一毫秒产生超过两页消息，翻页中又产生新消息：稳定排序与游标不能重复或漏掉既有记录（Task 2）。
4. 旧驳回没有消息记录，或新版再次被驳回：旧入口继续可读；读旧版本不清除新版本提醒（Task 3、4）。
5. 内容被撤回、下架、替换或目标消失：消息保留有限的结果与原因，打开目标仍重查权限，不能借消息恢复公开链接或图片权限（Task 2、4）。

## 基线与优先级依据

- 2026-11-22 已 fetch 并核对 `origin/main = eb519652b6d39f0debdaf2118c26772543933b23`，包含社区 PR #3、微信步数与自动同步，以及双城合作终章 PR #8。实施时重新 fetch，以当时最新 main 为基线。
- 当前独立工作区已切到 `codex/community-next-stage-plan`。桌面原工作区仍有其他同事／用户的改动，本计划不处理它们。
- 本次在最新代码的 `app` 执行 `node --test 'tests/*.test.cjs'`，147 通过、0 失败。日志为本机忽略文件 `.superpowers/next-stage-baseline-tests.log`，不是开发云或真机证据；本次规划未重新编译两端。
- 已有 `communityReviewNotices`／`communityReadReview` 只支持最新有效驳回版的未读提示，`reviewSeen` 缺省为未读；尚无消息中心页面和统一消息集合。
- A1–A5 的旧计划复选框没有完整回填，不能据此重做已交付功能。以实际代码、合并记录和验收文档判断。总待办里的部分部署／工程关联描述可能落后于后续操作，联调前重新核对实际环境。

## 本轮产品决定

1. 「我的 → 消息」列出本人社区审核结果，倒序分页，每页 20 条；提供空态、游客登录引导、加载失败和加载更多重试。详情显示结果、时间和「审核员处理原因」，通过且原因为空时不渲染空原因区。
2. 接入六类人工操作：`community.post.approved`、`community.post.rejected`、`community.post.removed`、`community.comment.approved`、`community.comment.rejected`、`community.comment.removed`。只通知被处理内容的作者；自动词库拒绝沿用即时反馈，举报人结果回执另行规划，避免直接公开内部处理说明。
3. 列表显示固定结果标题和短摘要，不复制被审帖全文、原始凭证或图片 URL。详情显示本人的有限结果快照；「查看对应帖子／版本」由服务端返回受限目标信息，目标打开时仍调用原接口鉴权。评论已移除或原帖不可访问时停留消息详情，明确提示目标当前不可打开。
4. 打开并成功显示消息详情后提交已读，浏览列表不自动清零；已读失败保留未读并给独立重试。第一版不提供全部已读、删除消息和批量广播。
5. 消息读写持久化在云端，同账号重新进入或换设备可补读。「我的 → 我的帖子」现有驳回红点保留；「消息」入口显示消息自身的未读红点，两者不相加为一个总数。
6. 新驳回消息与既有 `reviewSeen` 双向同步：读该驳回理由会读掉对应消息；读消息会读掉对应驳回版的理由提示。只同步同一 postId / revisionId，不能顺带清除后来版本。
7. 兼容旧数据：不批量伪造历史通知；上线前已有的驳回继续从「我的帖子」查看并标已读。消息空态／说明提供「历史驳回可在我的帖子查看」入口，不删除旧 `reviewSeen` 和两个旧接口。若未来需要全量历史消息，另做可审查的迁移。
8. 暂不接好友、合作、PK、任务和系统通知，不修改那些业务的事务；也不承诺微信订阅消息或后台持续推送。

## 文件与接口边界

| 文件 | 职责 |
| --- | --- |
| 新增 `app/uniCloud-alipay/cloudfunctions/fy-api/notification-service.js` | 消息写入辅助函数、本人查询、详情、统计和幂等已读；不负责审核决策 |
| 修改 `app/uniCloud-alipay/cloudfunctions/fy-api/community-service.js` | 在六类审核事务内派生消息，旧驳回已读同步对应消息 |
| 修改 `app/uniCloud-alipay/cloudfunctions/fy-api/index.js` | 新本人接口分发，保持后台 token 与小程序 token 分离 |
| 新增 `app/uniCloud-alipay/database/fy-notifications.schema.json` 与 `.index.json` | 收件人专属持久消息；全部客户端直读写权限为 false |
| 新增 `app/features/notifications.uts` | 消息 DTO、调用和账号隔离的未读状态 |
| 新增 `app/packages/profile/messages/messages.uvue`、`message-detail/message-detail.uvue` | 消息列表、详情、原因、独立重试及受限跳转 |
| 修改 `app/pages.json`、`app/packages/profile/account/account.uvue` | 注册 profile 分包页，在「我的」增加消息入口 |
| 按需修改 `app/features/community/review-notices.uts`、`app/packages/community/community-post/community-post.uvue` | 沿用既有红点，详情已读后刷新两个入口，避免各自缓存过期 |
| 新增 `app/tests/notifications.test.cjs`、`notifications-client.test.cjs`；扩展 `community.test.cjs`、`gateway.test.cjs`、`community-feedback.test.cjs` | 业务一致性、真实页面脚本行为及旧行为回归 |
| 新增 `docs/validation/community-notifications.md`；修改 `docs/PROJECT-TODO.md` | 实际证据、权限／Schema／索引变化、部署与待联调项 |

服务端接口固定如下，均只接收小程序本人身份；游客和后台会话不能调用：

- `notificationsList(u, { cursor?: string }) -> { items: NotificationItem[], next: string }`。
- `notificationsSummary(u) -> { unread: number }`，使用按收件人过滤的数据库 count，不把全量消息下载到内存。
- `notificationDetail(u, { id: string }) -> NotificationDetail`，非本人 id 统一 `NOT_FOUND`。
- `notificationRead(u, { id: string }) -> {}`，幂等，不能接受 recipientUid 或任意目标版本。
- `NotificationItem = { id, kind, title, preview, createdAt, read }`，`NotificationDetail = NotificationItem & { reason, target }`；`target` 仅为 `{ postId, revisionId, commentId, preview }` 或 null，不包含数据库 uid、审核员身份、存储路径和 URL。`target.preview` 明确表示作者版；DTO 的字符串／布尔／数字类型在 UTS 中显式定义。

消息存储：`recipientUid`、`kind`、`postId`、`revisionId`、`commentId`、`reason`、`createdAt`、`order`、`readAt`，其中未读 `readAt = 0`。文案由 kind 固定映射。主键使用现有 `key()` 对 `['notification', recipientUid, kind, postId, revisionId, commentId]` 散列，不加入时间或请求随机数；同事件重复写不得覆盖已读状态。`order = 13 位毫秒时间 + '-' + id`，页游标校验和既有社区格式一致。

索引：`recipientUid ASC, order DESC` 支撑列表；`recipientUid ASC, readAt ASC` 支撑未读计数。主键唯一性用于去重，不额外建立 eventId 唯一索引。沿用已有集合和旧字段，不迁移或删除旧消息／审核数据。

## Task 1：确认基线与可复现验收场景

**Files:** `docs/validation/community-notifications.md`、`docs/PROJECT-TODO.md`；复用现有测试与 `scripts/build-local.ps1`。

- [ ] 记录新 worktree 绝对路径、feature 分支和最新 main SHA；先确认计划之后的 main 是否已实现同类通知，按事实调整范围，避免重复实现。
- [ ] 运行基线 `node --test 'tests/*.test.cjs'`；本计划基线为 147 项，不硬编码未来数量。若最新 main 已失败，先定位并记录真实失败，不通过删除旧测试掩盖。
- [ ] 将下列场景列入验收表，列分为本机、浏览器、开发云、微信真机，每格只记录实际执行结果：作者 A、另一普通用户 B、审核员 R、管理员 M；旧公开版＋新待审版；九图含一张失败；旧驳回无通知；审核响应丢失；停用后旧令牌；切账号中仍有请求。
- [ ] 对已有测试覆盖的九图、举报、禁言和会话撤销复用回归；只有发现缺口或实际故障才加测试／修复，保持修改范围。

## Task 2：消息存储与本人接口

**Files:** 新增 notification-service、两个数据库定义和 `notifications.test.cjs`，扩展 `index.js`、`gateway.test.cjs`。

**Interfaces:** `createNotificationService({ repo, now = Date.now })` 导出上述四接口；导出 `writeNotification(db, event)`，event 为持久字段除 order/readAt/id 外的数据，返回消息 id。写入函数只接收原业务事务句柄，不能自行开启独立事务。另导出内部辅助 `markNotificationRead(db, uid, id, at)`，由新接口和旧驳回接口复用，避免循环调用事务。

- [ ] 先写并运行针对性失败测试：A 读／标 B 的消息为 `NOT_FOUND`；payload 伪造 uid 无效；游客／后台 token 拒绝；45 条同时间消息按 20/20/5 返回且 id 全部唯一；首屏后新增一条不打乱既有分页；非法游标拒绝。
- [ ] 按文件边界实现四接口及 Schema／索引。未知 kind、无效收件人和超长 reason 不写入；reason 上限沿用审核的 300 字。读写基于会话 uid，不依赖前端隐藏按钮。
- [ ] 详情在服务端核对帖／版本／评论归属和当前可达性后产生 target；记录已不存在时返回 target=null，仍允许本人看有限消息快照，不返回失效媒体。为目标消失和已下架补测试。
- [ ] 测试同 id 重复写保持原 readAt；重复已读不回退时间；未读统计只 count 本人 `readAt: 0`，0 条返回 0。
- [ ] 运行 `node --test tests/notifications.test.cjs tests/gateway.test.cjs`，通过后只提交本任务文件。

## Task 3：六类审核结果与旧驳回兼容

**Files:** `community-service.js`、`notification-service.js`、`community.test.cjs`、`notifications.test.cjs`。

**Interfaces:** 使用 Task 2 的事务写入和已读辅助函数；现有 `communityReviewPost`、`communityReviewComment`、`communityReadReview` 的入参与返回兼容。

- [ ] 为六类人工状态转移分别写失败测试：收件人为实际帖子／评论作者，revisionId 来自被处理记录，不能来自伪造 payload；通过没有原因时使用空字符串，不编造审核原因。
- [ ] 在原审核状态与审计事务内调用 `writeNotification`；通知写入失败必须回滚审核和审计。不要在事务提交后 fire-and-forget 写通知。
- [ ] 测试审核竞争只有一个成功结果、一份审计、一条通知；模拟提交响应丢失后再读列表仍只有一条；失败重试不更改已读状态。
- [ ] 新驳回的两种已读入口在同一事务中同步相同版本；没有通知记录的旧 `communityReadReview` 仍成功。读取旧消息不清除新驳回版 `reviewSeen`。
- [ ] 不为旧的通过／下架记录自动回填通知，也不向举报人复制作者审核原因；复测旧公开版在改帖待审期间继续可见，下架后的分享／图片仍失效。
- [ ] 运行 `node --test tests/notifications.test.cjs tests/community.test.cjs tests/gateway.test.cjs`，通过后提交本任务。

## Task 4：「我的 → 消息」、详情与未读状态

**Files:** 新增 UTS 消息模块、两个 profile 页面和客户端测试；修改 pages、account、既有 review-notices，按需修改帖子详情。

**Interfaces:** `hasUnreadNotifications` 为按当前 uid 绑定的 computed；`refreshNotificationsSummary(): Promise<void>`；`listNotifications(cursor: string)`、`loadNotification(id: string)`、`readNotification(id: string)` 使用 Task 2 接口及 `secured`。每个页面请求捕获 uid 和请求序号，回写前核对两者。

- [ ] 先用现有 VM／真实页面脚本测试方式写失败测试：游客、空列表、第二页失败、详情失败、已读失败、退出后重进和 A→B 账号切换；旧请求后到不能写进新账号。
- [ ] 新增列表和详情，复用现有色彩、卡片和箭头返回。列表失败重试保留已加载项目与游标；详情读取成功再触发已读，已读失败只重试回执，不重新提交审核或跳丢当前内容。
- [ ] 「我的」增加「消息」入口及独立红点，保留「我的帖子」及既有红点。空消息和历史说明提供「我的帖子」入口，不把旧驳回伪装为新消息。
- [ ] 详情给出对应的通过／驳回／下架／评论处理结果和「审核员处理原因」。可达目标按服务端的受限 target 跳转；不能打开时给文字说明和返回列表操作，不绕过媒体授权。
- [ ] 打开驳回理由或消息详情后刷新两个未读入口；失败不预先清零，切账号清空旧状态，同账号重登从云端读取。
- [ ] 运行 `node --test tests/notifications-client.test.cjs tests/community-feedback.test.cjs tests/page-header.test.cjs`。验证澳喵为 null 的「我的」正常渲染，原领取按钮和箭头返回仍可用。通过后提交本任务。

## Task 5：联调收尾、构建与 PR

**Files:** `docs/validation/community-notifications.md`、`docs/PROJECT-TODO.md`；发现真实问题时修复对应社区／后台文件并补针对性回归。

- [ ] 在 app 运行 `node --test 'tests/*.test.cjs'`；从仓库根运行 `./scripts/build-local.ps1 -Target WeixinDev` 与 `./scripts/build-local.ps1 -Target Admin`。核对脚本输出的源码绝对路径、当前提交、微信 AppID、`app/unpackage/dist/dev/mp-weixin` 和 `admin/unpackage/dist/build/web`，不把旧目录、旧浏览器标签页和旧产物当本次结果。
- [ ] 用实际本地构建产物验证列表、原因、红点、只箭头返回、自动九图、单张失败重试及侧栏「退出登录」。模拟接口测试必须明确标注，不能写成开发云或真机通过。
- [ ] 在已有授权范围内只读核对开发云空间、当前部署版本、关联工程和索引；未取得新的部署授权，不上传本轮云函数／Schema／索引，不改真实用户数据。列出实际阻塞及需要项目方执行的步骤。
- [ ] 获部署授权后的顺序：新增私密集合 Schema → 创建并确认两项索引就绪 → 部署包含 notification-service 的完整最新 fy-api → 两端构建联调。先服务端后前端，旧接口保留；回退前端不删除通知数据，不用旧 fy-api 覆盖 main 已合入的步数／合作代码。
- [ ] 云端／真机矩阵：A 混合相册与日记九图发布、指定失败图重传；R 驳回后 A 读原因并重新提交；R 通过新版时旧版正确切换；B 举报后 R 核对举报版本并下架，旧分享／图片失效；A 收到对应消息、已读并重登补读；R 禁言／解除禁言；M 停用／恢复且旧令牌均无效；B 不能查看 A 的通知、待审版和原日记。无需重做别的同事的步数和终章真机验收，但全量回归不能破坏它们。
- [ ] 逐项记录本机、浏览器、开发云、微信真机的实际结果、时间、环境和遗留项；无条件执行的步骤保持未勾选。更新总待办：消息中心只标本轮审核子项完成，好友／合作／PK／系统通知仍待办。
- [ ] `git diff --check` 后提交并推送实施分支，创建目标为 main 的 PR。PR 说明实际行为、验证证据、六类消息权限、新集合和两项索引、旧数据兼容、部署顺序和待联调项；不写已完成整站消息中心，不自行合并或部署。

## 后续独立阶段

1. 在本轮接口稳定后接好友、合作、PK、任务及系统事件；各模块负责自己的事件来源，本模块负责消息展示与本人权限。
2. 运营角色授权与私密凭证独立权限／访问审计另做设计，不能直接扩大现有 reviewer 权限。
3. 日记删除、账号注销及受控资源清理需要明确保留期限、引用关系和可重试清理流程，另开计划与 PR。
