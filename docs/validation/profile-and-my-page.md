# 用户资料与「我的」验收交接

2026-11-23（澳门时间）。源码目录 `C:/Users/Raymond/Desktop/feinibuke/feiyiyunxiang`，功能分支 `codex/profile-and-my-page` 从 `origin/main` 的 `f376f39` 创建。[PR #10](https://github.com/luochiioi/feiyiyunxiang/pull/10) 已在本轮开始前合并。

## 实现与兼容

- 昵称、头像、简介、城市标签、文化兴趣提交现有治理工作台人工审核。审核前显示旧资料。审核、审计及结果消息在同一事务中提交。旧版数据按 `revision=0` 读取，按实际 `_id` 更新。
- 社区帖子、评论、两种排行榜、好友申请与列表、私有合作与 PK 界面按稳定账号显示当前署名。保留旧快照、邀请码与对外席位标签。后台账户和资料审核对比使用当前公开资料或准确的申请修订。
- 头像在服务端复用 JPG/PNG 清理、加密、旧密钥兼容和下载重试。公开接口只按邀请码和已发布头像版本服务，每次读取在下载前后复核账号与版本。客户端同时读取最多三张公开头像，缓存 40 个条目；正在显示的文件在组件释放后清理。
- 「我的」提供公开资料、邀请码复制、消息与红点、我的帖子与驳回红点、探索档案、紧凑澳喵、步数中心、旅伴、社区、微信隐私指引及退出入口。历史审核结果只读，点「以此修改」后才生成草稿。此入口可复用本人修订里的头像，过期暂存不影响已提交修订。
- 头像选取使用现有相册入口。微信 `chooseAvatar` 未作为本轮入口。账号续期时内存草稿和未确认请求标识保留给原账号，账号变化时清除。

## 实际验证

| 层面 | 结果 |
| --- | --- |
| 本机 Node | `cd app; node --test 'tests/*.test.cjs'`，204 项通过，0 失败。其中 1 项为桌面原有未提交的打卡提示用例。资料回归包括旧主键、权限、重复请求、同名身份、并发审核、回滚、已读重试、头像过期／版本／停用重查及切换账号。 |
| 微信开发包 | `./scripts/build-local.ps1 -Target WeixinDev`，HBuilderX 5.15 编译成功。产物为本目录下 `app/unpackage/dist/dev/mp-weixin`，AppID 与支付宝空间配置校验通过。仍有旧 AR 组件两条鸿蒙兼容提示。 |
| 后台 Web | `./scripts/build-local.ps1 -Target Admin` 编译成功。产物为 `admin/unpackage/dist/build/web/index.html`。编译器保留旧 Browserslist 数据提示。 |
| App Web | HBuilderX 本机 `publish web --project <桌面仓库>/app` 编译成功，产物为 `app/unpackage/dist/build/web/index.html`。保留可空类型及既有兼容告警。 |
| 开发云只读审计 | 支付宝开发空间 `env-00jy72i6ol3c`。本地调试探针只查资料集合，返回下面的汇总，随后从云函数目录移出。 |
| 开发云功能与微信真机 | 待验。资料 Schema、索引、函数和客户端均待授权后部署。 |

### 浏览器模拟

通过本机 Edge 和 Playwright 拦截新 Web 产物中云函数调用，两端只用本地合成数据。复现时将 app 和 admin 的 `dist/build/web` 分别绑定到 `127.0.0.1:8431` 和 `127.0.0.1:8432`，在独立会话运行 `run-code --filename scripts/validate-profile-browser.js`。

实测三种宽度的邀请码和编辑入口、相同标识重试提交、审核期间显示已通过资料、历史驳回只读及复制到草稿、消息已读消点、探索档案和旅伴入口、帖子及评论与两种排行榜署名、头像单独重试。后台实测当前／申请头像对照、单图重试、驳回成功后队列读取失败，以及单独刷新不会重复审核。

浏览器截图：[375 像素](evidence/profile-and-my-page/account-375.png)、[390 像素](evidence/profile-and-my-page/account-390.png)、[430 像素](evidence/profile-and-my-page/account-430.png)、[审核中](evidence/profile-and-my-page/pending.png)、[驳回历史](evidence/profile-and-my-page/rejected.png)、[后台资料审核](evidence/profile-and-my-page/admin-review.png)。

### 开发云数据审计

只读扫描 `fy-profiles` 共 **6** 条。非标准主键、缺失 uid、缺失或无效的邀请码、重复 uid 和重复 code 各 **0**。缺少 revision **6** 条，有旧头像 URL、加密头像或不完整加密引用各 **0**。开发空间 Schema 列表有 `fy-profiles`，新增两张资料表尚未建立。资料现有索引的名称及状态待在控制台核对，集合列表无法确认索引配置。部署前再次执行重复值与空值检查，因为数据可能继续变化。

启动前已将既有改动、未跟踪文件和私密配置备份到仓库外。35 项原有忽略配置／私密文件与备份逐个比较哈希，差异为 0。桌面 fy 私密配置检测到有效的当前媒体密钥和 1 个历史解密密钥。只读审计未输出密钥、头像存储路径、用户 ID 或资料内容。

## 明确授权后的开发空间部署顺序

1. 确认目标是支付宝开发空间 `env-00jy72i6ol3c`。备份该空间当前完整 `fy-api`、相关 Schema／索引与原有私密配置，核对管理员后台的开发空间绑定。分别确认当前 `mediaEncryptionKey`、全部 `mediaLegacyDecryptionKeys`、身份及微信配置。部署沿用当时远端配置，备份保存在仓库外。
2. 再次只读核对 `fy-profiles` 的现有 uid/code 索引、缺失值和重复组。结果无冲突后更新可选字段，按需建唯一索引 `profile_uid` 和 `profile_code`。如有冲突，先记录汇总并暂停索引创建。
3. 建 `fy-profile-revisions`（`status_order`、`uid_order`）和 `fy-profile-uploads`（唯一的 `uid_request`、`expires_at`）。两表客户端读写全关闭，`expires_at` 用于过期审计。更新 `fy-notifications.profileRevisionId` 与 `fy-community-limits.profileWrites` 两个可选字段。部署只包含本清单内的集合与索引。
4. 更新完整 `fy-api`，附当时的远端私密配置。本分支复用 PR #10 已有 `fy-cloud-core`，公共模块仅在回读发现目标空间缺少已验证版本时补齐。部署完重新拉取资源并核对 Schema、函数与配置。
5. 重新编译微信开发包和后台。用隔离测试账号验权限、并发、回滚、审核通知、撤销头像版本、停用恢复及旧密钥回读。只向测试账号发送通知，逐条记录并清理测试数据，回读确认。

回退时恢复部署前备份的 `fy-api` 和两个前端产物，保留新增可选字段、修订历史及密钥。已提交修订里的头像引用不随暂存过期清除，待审或过期孤儿先汇总，核对引用及获得授权后再删除。

## 微信真机待验

- **iOS 和 Android**：选图、取消、权限拒绝、压缩和 1 MiB 边界、弱网失败重试、冷启动、最新审核头像和默认澳喵。
- **两个微信账号加隔离第三账号**：切账号隐藏草稿和历史头像、续期沿用未确认请求、旧头像继续显示、审核通过后跨设备刷新。确认帖子、评论、路线与步数榜、好友及旅伴统一显示。
- **治理与回归**：驳回原因、红点与已读、旧通知的准确修订、停用恢复及旧密钥读图，同时复查九图、侧栏退出、隐私指引、步数自动同步与公开双城终章标签。
