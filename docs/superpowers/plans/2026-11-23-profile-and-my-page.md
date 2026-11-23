# 用户资料与「我的」页面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 不默认分派子代理。

**Goal:** 用户可提交昵称／头像及可选资料，审核后在社区、排行榜、好友等现有位置一致显示，并整理「我的」页面。

**Architecture:** 独立 profile-service 与统一公开资料投影，复用现有私密媒体清理／加密和 repository 事务；待审快照与公开资料分离。客户端使用账号绑定资料状态和版本化头像组件，后台在现有治理入口审核，通知沿用本人消息。

**Tech Stack:** uni-app x／UTS、HBuilderX 5.15、微信小程序、uniCloud 支付宝、Node 原生测试、已有 Web 后台。

**Spec:** [设计与规则](../specs/2026-11-23-profile-and-my-page-design.md)。以下任务尚未实施。

## Global Constraints

- 只在 `C:/Users/Raymond/Desktop/feinibuke/feiyiyunxiang` 开发和运行；不新开 worktree，不在 main 实施；先保留所有已有未提交改动及忽略的私密配置。
- 开始先 fetch，核对 PR #10 最新状态。已合并则从最新 origin/main 创建 codex/profile-and-my-page；未合并则从 origin/codex/friend-notifications 继续，在 PR 中明确依赖 #10，不能重复开发其代码或自行合并。
- 昵称 2–20 码点；简介 0–80；城市标签 0–20；兴趣最多 3 项，白名单见设计。昵称允许重名，code／uid 不变。
- 头像 JPG／PNG，服务端最多 1 MiB，去除 EXIF 等元数据；当前上传密钥和 mediaLegacyDecryptionKeys 都要保留，不直接轮换密钥或公开存储。
- 审核前展示旧公开资料；审核、审计、结果通知同事务。旧账号缺字段可读；新增字段均可选，旧客户端不强制升级。
- 保留澳喵与领取、档案、九图重试、后台缩略图、侧栏退出、红色驳回、仅箭头返回、步数自动同步和双城终章；不改定位、路线任务、剧情、AR、私信或注销。
- 本轮不自动部署云端、不推 main、不合并 PR；云端部署前具体列出资源与证据供项目方授权。

## Review Focus

- A→null→A 续期保留未确认请求，换 B 不显示 A 的资料草稿或迟到头像（Task 4/5）。
- 更新昵称后历史评论／排行榜仍显示旧名字；投影查询不能破坏分页或历史审计（Task 2）。
- 待审期间再次编辑、审核旧修订及提交响应丢失，只能发布准确修订且消息一次（Task 1/3/6）。
- 头像上传取消、存储故障、旧图片密钥、过期暂存及校验后账号停用，不得泄露原图或保留错误缓存（Task 1/4）。
- 旧客户端、重复／缺失 profile 记录与索引创建冲突，不能改 code 或覆盖私密配置（Task 1/8）。

## 文件与接口边界

| 单元 | 文件 | 职责 |
| --- | --- | --- |
| 资料 | app/uniCloud-alipay/cloudfunctions/fy-api/profile-service.js、profile-presenter.js | 本人编辑、修订、公开投影、头像读取 |
| 网关 | app/uniCloud-alipay/cloudfunctions/fy-api/index.js | 本人／游客头像／审核员动作分组与错误码 |
| Schema | app/uniCloud-alipay/database/fy-profiles.schema.json、fy-profile-revisions.schema.json、fy-profile-uploads.schema.json 及对应 index.json | 私密字段、待审分页和归属查询 |
| 展示端 | partnership-service.js、community-service.js、step-service.js、community-operations.js、friend-notification-events.js、pk-service.js | 当前显示用资料；不改身份、比赛或快照 |
| 编辑状态 | app/features/profile/profile.uts、profile-avatar.uts | 本人状态、幂等草稿、有限缓存 |
| 组件／页面 | app/components/ProfileAvatar.uvue、app/packages/profile/profile-edit/profile-edit.uvue、app/packages/profile/account/account.uvue、app/pages.json | 头像、编辑、我的布局 |
| 后台 | admin/features/api.uts、admin/pages/index/CommunityGovernance.uvue（如需分拆，新建 ProfileReview.uvue 并由现有页调用） | 资料待审、缩略图、通过／驳回 |
| 通知 | fy-api/profile-notification-events.js、notification-service.js；app/features/notifications.uts、message-detail.uvue | 本人资料审核结果与目标路由 |

### Task 1：本人资料修订、头像暂存与私密 Schema

**Files:** 创建 profile-service.js、profile-presenter.js、tests/profile.test.cjs；修改网关、fy-profiles.schema.json；创建上述两张私密表及索引。

**Interfaces:**
- `getMyProfile(user)` → `{code,nickname,avatarVersion,bio,displayCity,interests,revision,pending: ProfileRevision|null}`。
- `profileStageAvatar(user,{requestId,base64})` → `{uploadId}`；相同本人 requestId 幂等，暂存 24 小时，仅单张。
- `profileSubmit(user,{requestId,baseRevision,nickname,bio,displayCity,interests,avatarUploadId?,resetAvatar?})` → `{revisionId,status:'pending'}`。未传头像沿用当前头像；resetAvatar=true 与 avatarUploadId 互斥，回到默认澳喵。
- `profileRevision(user,{revisionId})` → 本人修订详情；状态 pending/approved/rejected/superseded。提交事件 ID=`key('profile-revision',uid,requestId)`，相同 ID 不同内容返回 REQUEST_CONFLICT。

- [ ] 先写失败测试：空白／超长／控制字符昵称；允许重名；邀请码不变；跨账号头像／修订；旧记录缺字段、非标准主键；并发提交与响应丢失重试；过期暂存；取消／坏图片无写入；忽略传入 uid。首次失败后再实现。
- [ ] getMyProfile 先沿用现有 ensureProfile 语义，按实际 `_id` 更新；不批量重写 uid/code。旧记录缺省 revision=0。profile-presenter 导出统一 fallback 与公开字段白名单。
- [ ] 头像复用 common/fy-cloud-core/community-media 的 sanitize／加密，以 namespace=profile-avatar 存储。提交只接收本人有效 uploadId，复制引用到修订后不因暂存过期失效。幂等检查先于限制；新提交每小时最多 10 次，计数与修订同事务。
- [ ] Schema 客户端读写全 false。revisions 索引 status+order、uid+order；uploads 索引 uid+requestId（唯一）、expiresAt。给 profiles 的 uid/code 唯一索引先执行只读重复检查，有冲突先出报告，不能自动改邀请码或强建索引。
- [ ] 运行 `cd app; node --test tests/profile.test.cjs` 并提交此独立单元。只定义字段和索引，不初始化整库或上传云资源。

### Task 2：所有当前署名使用统一资料

**Files:** 修改上表展示端、客户端 community.uts、partner.uts、StepPanel.uvue、帖子／评论页面、admin 用户类型；新增 tests/profile-presentation.test.cjs。

**Interfaces:** `publicProfile(repo,uid)` → `{code,nickname,avatarVersion}`；`publicProfiles(repo,uids)` → 按 uid 的内部 Map，批量分组查询并缓存于本次请求。缺失／停用账号返回统一默认展示，不把内部 uid 返回前端。

- [ ] 先写失败测试：同一账号改名后，旧帖子、旧评论、邀请码查询、好友列表、路线排行与步数榜都显示新昵称；同名两人仍各归各身份；审计和 actorNickname 快照不改变。
- [ ] 接入投影，保留现有 DTO 字段 author/nickname/code；新增 avatarVersion／头像主体 code 为可选字段。旧 avatar 字段只保留既有安全值，绝不放 cloud fileID。更新评论投影为异步并保持顺序、分页和 mine 列表。
- [ ] 处理合作与 PK 现有私有旅伴显示，保持公开终章席位标签。后台用户／审核卡展示当前资料，操作定位仍使用稳定 uid/id；不重构排行榜算法或访问范围。
- [ ] 测试至少两页评论／好友和相同分数排名；检查新增查询按本页唯一 uid 聚合，不能为九图／每条字段重复拉整个资料集合。
- [ ] 跑 `node --test tests/profile-presentation.test.cjs tests/community.test.cjs tests/steps.test.cjs tests/friend-notifications.test.cjs`，提交。

### Task 3：后台资料审核与竞争保护

**Files:** profile-service.js、网关、profile-notification-events.js、notification-service.js 的资料消息标题映射、admin/features/api.uts、CommunityGovernance.uvue／ProfileReview.uvue；新增 tests/profile-review.test.cjs。

**Interfaces:** `profileReviewList(reviewer,{cursor})` → `{items,next}`，每页 20；`profileReviewDetail(reviewer,{revisionId})` → `{selected,current}`；`profileReviewAvatar(reviewer,{revisionId})` → `{src}`；`profileReview(reviewer,{revisionId,decision:'approve'|'reject',reason?})`。

`writeProfileReviewNotification(db,{recipientUid,revisionId,kind,reason,createdAt})` → 稳定消息 ID，kind 为 profile.approved/profile.rejected；由本任务创建并供审核事务调用，Task 6 只扩展本人读取与前端目标。

- [ ] 先写失败测试：普通用户／游客拒绝审核，审核员不能改登录信息；两个审核员竞争、重试、旧 pendingRevisionId、通知失败回滚、停用账户待审、空驳回原因。
- [ ] 审核事务核对 candidate.status=pending、profile.pendingRevisionId 与 baseRevision；通过只更新该候选白名单字段并递增 revision；驳回保留旧公开字段，原因 1–300 字，清理当前 pending 指针。新提交将上一待审置 superseded，不让旧审核结果覆盖新资料。
- [ ] 资料审核、现有审计与 writeProfileReviewNotification 原子写入；事件键包含收件人、修订和决定，重复决定不覆盖 readAt。消息标题映射同期接入。Task 6 再接资料目标与客户端，不能先留下非原子的审核写入。
- [ ] 后台增加「资料待审」入口，显示当前／申请昵称头像对比、简介标签和原因，缩略图最多三并发，失败单独重试；写入成功刷新失败不能再次审核。保留左侧退出和现有帖子审核界面。
- [ ] 运行 profile-review 和社区治理回归；提交。

### Task 4：版本化头像组件与客户端资料状态

**Files:** 创建 features/profile/profile.uts、profile-avatar.uts、components/ProfileAvatar.uvue、tests/profile-client.test.cjs；修改各展示端头像组件。

**Interfaces:** `profileAvatar(guestOrMember,{code,avatarVersion})` → `{src}`，只给当前已通过头像；`refreshMyProfile():Promise<void>`；`submitMyProfile(input):Promise<{revisionId,status}>`；`loadProfileAvatar(code,version):Promise<string>`；`releaseProfileAvatar(key):void`。

- [ ] 先写失败测试：A 延迟返回不能显示在 B，A→null→A 保留未确认请求但 B 清除；头像属性切换丢弃旧响应；40 项缓存淘汰、三并发上限；旧头像／停用／下架版本拒绝。
- [ ] 头像接口按 code 找当前 profile 和正常账户，只返回当前已审头像；下载后再次核对账户和 avatarVersion。支持现有读取密钥兼容与下载重试，拒绝任意 URL/fileID 入参。
- [ ] 组件默认澳喵、加载失败保留默认并提供重试；局部缓存最多 40 张，路径使用独立前缀，与社区预览文件分开；不把头像下载结果当作用户资料写回。
- [ ] 本人资料状态按 uid 绑定，未确认写入保留相同 requestId；保存成功但刷新失败仅重读。退出或换账号释放本人草稿和待审预览，公共头像缓存不携带私密待审内容。
- [ ] 运行客户端与服务端头像／跨账号回归并提交。

### Task 5：资料编辑和「我的」布局

**Files:** 新建 profile-edit.uvue，修改 account.uvue、pages.json；新增 tests/profile-editor.test.cjs、scripts/validate-profile-browser.js。

- [ ] 先写页面脚本失败测试：游客登录后恢复、空白／超长字段、选图取消、上传失败保留输入、提交成功刷新失败、切账号、重登续期、旧修订只读、重置默认头像。
- [ ] 编辑页采用设计中确定的字段长度／白名单；使用单张选图，主动按钮才调用权限相关接口。客户端压缩失败／仍超 1 MiB 明确提示，服务端再次验证，不信客户端 mime。
- [ ] 显示当前公开资料与待审／驳回状态；历史通知打开对应结果只读，点击「以此修改」才建立新草稿。重复点击提交 disabled，相同未确认请求不生成新修订。
- [ ] 「我的」按设计五部分排版；已领取澳喵用紧凑卡，未领取保留原引导；原消息、驳回红点、档案、退出、隐私指引都能继续到达。仅修改相关布局，不实现新作品／新步数业务。
- [ ] 本机脚本＋实际新 Web 产物的 375/390/430 宽浏览器模拟验证，长昵称不挤压邀请码和入口；截图只用测试资料。执行微信开发构建，提交。

### Task 6：资料审核结果消息

**Files:** 扩展 Task 3 已创建的 profile-notification-events.js／notification-service.js、fy-notifications.schema.json、features/notifications.uts、message-detail.uvue；新增 tests/profile-notifications.test.cjs。

- [ ] 先写失败测试：profile.approved/rejected 仅本人、事件去重、通知失败审核／审计回滚、响应丢失重试保留 readAt、旧修订目标校验、原好友／帖子 DTO 不变。
- [ ] 验证 Task 3 的独立资料事件写入器以收件人＋修订＋决定生成稳定 ID，不复用要求 postId 的 writeNotification 校验。扩展私密通知 Schema 为可选 profileRevisionId，不修改旧数据。
- [ ] notificationDetail 按本人重新读取修订，返回可选 profileTarget={revisionId}；详情唯一主按钮「查看资料审核结果」打开 profile-edit 对应历史结果。删除／失配目标禁用，读取不会重新提交资料。
- [ ] 验证审核事务同时写资料状态、审计和消息；首页／我的的既有通知汇总无需新轮询服务。重跑所有消息回归与旧客户端兼容用例。
- [ ] 提交。

### Task 7：整体验证与资料兼容报告

**Files:** docs/validation/profile-and-my-page.md、docs/PROJECT-TODO.md，测试证据目录；必要时修复前述单元。

- [ ] `cd app; node --test 'tests/*.test.cjs'`；仓库根 `./scripts/build-local.ps1 -Target WeixinDev`、`./scripts/build-local.ps1 -Target Admin`。记录实际源码与输出目录，不能编译旧工作区。只做页面预览时补编本桌面 app Web 产物。
- [ ] 浏览器模拟：当前昵称／头像各显示端一致，待审保留旧资料、驳回编辑、已读消点、头像失败单独重试和底部入口；记录模拟接口，不能当开发云证据。
- [ ] 只读数据审计：旧 profile 主键、重复 uid/code、缺字段、头像引用、原 key 配置和索引状态；结果只记录数量／匿名结果，不把密钥、token、原图或用户资料提交 Git。
- [ ] 真机清单分 iOS/Android：头像选图／取消／裁剪或压缩、重启、弱网、授权拒绝；A/B 加好友、帖子／评论／两种榜显示改名、审核后跨设备刷新；未执行项保持未执行。
- [ ] 更新 TODO，记录本机／浏览器／开发云／真机的实际证据；提交。

### Task 8：分支 PR、部署与回退交接

- [ ] 只提交本轮明确文件，保留桌面原有素材、地图和其他用户改动；不 `git add -A`。推 codex/profile-and-my-page，创建 PR，写明对 PR #10 的依赖及真实验证。
- [ ] 部署清单：fy-profiles 可选字段／已核对的 uid 和 code 索引、fy-profile-revisions 与 fy-profile-uploads 私密 Schema／索引、fy-notifications.profileRevisionId 可选字段；然后完整 fy-api 和必要公共模块，再编译两端。不得对含无关 init_data 的整个 database 目录运行 initdatabase。
- [ ] 首次云端变更前向项目方展示目标空间、上述具体资源、配置备份与回退方案并取得授权；此前好友／图片部署授权不等于资料迭代已获部署授权。
- [ ] 获授权后先索引／Schema，再服务端，最后客户端。隔离测试身份验证事务与越权，不向真实好友发测试消息；逐条记录并清理测试数据，读取真实用户资料只做经授权范围。
- [ ] 回退到上一版函数／前端，保留可选字段和修订历史；不删除用户资料、不直接移除仍有密文引用的密钥、不回写预设名字覆盖用户昵称。暂存孤儿仅生成清理报告，批准后才删除未引用文件。不自行合并或部署正式环境。
