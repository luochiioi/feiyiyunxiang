# 社区审核消息验收与联调交接

实施日期：2026-11-22 至 2026-11-23（澳门时间）。仅完成本机实现、自动回归和模拟接口浏览器验证；未部署云端，未用真实账号或微信真机验收。

## 源码与构建来源

- 源码：`C:/Users/Raymond/.codex/worktrees/community-review-notifications/feiyiyunxiang`。
- 分支：`codex/community-review-notifications`；fetch 后基线 `origin/main = eb519652b6d39f0debdaf2118c26772543933b23`。核对 main 未实现消息中心，保留它已合入的步数、自动同步、双城终章。原规划与桌面工作区的已有改动均未处理。
- 计划先备份到工作区外，再原样带入新分支：[实施计划](../superpowers/plans/2026-11-22-community-notifications-and-acceptance.md)。实现源码提交为 `731d2c3`；其后文档提交不改变已验证源码。
- 微信开发者工具应打开本工作区的 `app/unpackage/dist/dev/mp-weixin`，AppID 为 `wx54dea9a4a48bfed5`；本次脚本检查源码和产物一致。不要打开桌面 main 的同名旧目录。
- 后台产物为本工作区的 `admin/unpackage/dist/build/web`。浏览器使用本次实际 Web 导出；小程序页面浏览器辅助验收使用 `app/unpackage/dist/build/web`，该 Web 包只作本机辅助验证，不替代微信真机。
- 初次微信构建因 HBuilderX 未启动失败；启动并用绝对路径导入新 app、admin 后重新成功构建。未修改旧项目文件或上传云函数。

## 实际实现

「我的 → 消息」每页 20 条倒序，独立未读红点；列表不自动标读，详情成功显示后提交已读。读取详情、加载更多和已读失败有各自重试；刷新失败按原请求方式重试。消息仅包含固定标题、短原因摘要及本人结果快照，不复制帖子正文或图片地址。通过没有原因时不展示空原因区。

接入六类人工结果：`community.post.approved/rejected/removed`、`community.comment.approved/rejected/removed`。不通知举报人，不为自动词库拒绝生成通知。通知、审核状态及审计在原事务中写入；写入失败整体回滚。事件主键由收件人、类型、帖子、版本和评论确定，不含时间或随机数；重复写不覆盖 readAt。审核响应丢失后重新读取消息即可补读，重提审核沿用 STALE_VERSION／NOT_PENDING，不能重复产生审计或消息。

旧「我的帖子」驳回红点和 `communityReviewNotices`／`communityReadReview` 保留。新驳回两种已读入口在同事务同步同一版本；旧驳回没有消息仍可已读，不批量伪造历史通知。读旧版本不能清掉新版本提醒。消息详情明确说明不可打开的目标；打开帖子仍调用原鉴权接口，通知不恢复失效分享或图片。评论消息只跳转当前可见公开帖，作者版本才携带 revisionId。

页面和未读状态按账号与请求序号隔离，账号变化清空旧内容；会话 A→null→A 续期主动恢复读取。共用 API 捕获发起账号，旧账号响应不能清空新账号会话或被重试成新账号写入。原澳喵样式、领取与档案、九图重试、后台缩略图和底部退出、红色驳回及箭头返回继续沿用；路线、地图、任务、剧情、AR、私信、注销、全站消息不在本轮。

## 证据矩阵

表中“本机”指 Node + 内存数据库／事务模拟或真实页面脚本 VM；“浏览器”指 Chrome + 实际 Web 产物 + 明确的模拟接口，均不代表开发云通过。A 为作者、B 为其他普通用户、R 为审核员、M 为管理员，自动测试用隔离测试身份。

| 场景 | 本机 | 浏览器 | 开发云 | 微信真机 |
| --- | --- | --- | --- | --- |
| 45 条同毫秒消息 20/20/5，翻页插入新消息，非法游标 | 通过，ID 不重漏，按收件人 count | 列表及更多页、第二页失败重试通过 | 未执行 | 未执行 |
| A/B 通知详情及已读隔离，伪造收件人，游客／后台 token | 通过，NOT_FOUND／AUTH_REQUIRED | 游客引导通过；跨账号仅 VM 验证 | 未执行 | 未执行 |
| 六类审核结果、空通过原因、通知失败回滚 | 通过，通知与状态／审计同事务 | 驳回列表、原因和不可达说明通过 | 未执行 | 未执行 |
| 并发审核、已提交但响应丢失、重试后唯一消息和审计 | 通过，模拟提交后抛 RESPONSE_LOST，已读不回退 | 未执行真实审核竞争 | 未执行 | 未执行 |
| 旧公开版＋新待审版、驳回保留旧版、通过切版 | 既有社区回归通过 | 未执行 | 未执行 | 未执行 |
| 旧驳回无通知、精准版本双向已读、新驳回不被旧版清除 | 通过，旧接口保留且不回填通知 | 未执行旧数据场景 | 未执行 | 未执行 |
| 详情失败、独立已读重试、退出重进、A/B 延迟返回、会话续期 | 页面 VM 和实际 api/secured 脚本通过 | 已读首次失败，独立重试不重读详情通过 | 未执行 | 未执行 |
| 九图、私密日记副本、模拟上传失败重试 | 既有回归通过 | 后台自动九图，第九张失败后单图重试；9→10 次读取通过 | 未执行 | 未执行 |
| 举报以实际版本和评论归属为准 | 既有回归通过 | 未执行 | 未执行 | 未执行 |
| R 禁言／解除、M 停用／恢复、旧令牌和会话撤销 | 既有回归通过 | 本轮未重复用户治理写入场景 | 未执行 | 未执行 |
| 下架后旧分享／图片失效，目标消失只留有限快照 | 既有社区及新增消息回归通过 | 不可打开说明通过 | 未执行 | 未执行 |
| 澳喵 null、领取／档案、箭头返回、红色驳回、退出入口 | 既有页面和业务回归通过 | 消息箭头截图、后台侧栏底部退出通过；澳喵／红色驳回本轮未重复浏览器验证 | 未执行 | 未执行 |
| main 步数、自动同步及双城终章 | 全量回归通过，相关业务源码未改 | 未执行 | 未执行 | 未执行 |

本机命令（在上述新工作区运行）：

```powershell
cd app
node --test 'tests/*.test.cjs'
# 163 tests, 163 pass, 0 fail
cd ..
./scripts/build-local.ps1 -Target WeixinDev
./scripts/build-local.ps1 -Target Admin
```

HBuilderX 5.15。微信开发包及后台导出成功；微信有既有 AR 组件的 2 条鸿蒙兼容警告，后台提示 Browserslist 数据过旧。辅助 app Web 导出有既有页面的可空类型警告，不作为真机结果。Node 的 stripTypeScriptTypes 实验性提示来自 VM 回归工具。

浏览器复现：分别用仅绑定 `127.0.0.1` 的 HTTP 服务器把 app 和 admin 的 `dist/build/web` 服务到 8411、8412，运行 `npx --yes --package @playwright/cli playwright-cli -s=community-notices open about:blank --browser chrome`，再运行 `run-code --filename scripts/validate-community-notifications-browser.js`。脚本拦截实际 JS 产物中的云调用边界并注入本地固定响应，不调用真实服务端；用于验证 UI，不作为云端鉴权证据。

截图：[消息列表](evidence/community-notifications/messages-browser.png)、[消息详情](evidence/community-notifications/message-detail-browser.png)、[后台九图与退出入口](evidence/community-notifications/admin-nine-images-browser.png)。构建／测试摘要和路径哈希见 [本机执行记录](evidence/community-notifications/local-results.txt)。

## 权限、Schema 与索引

- 新集合 `fy-notifications`：`recipientUid, kind, postId, revisionId, commentId, reason, createdAt, order, readAt`；客户端 read/create/update/delete 全 false。所有调用使用小程序本人会话，后台 token 和游客不可调用；审核员的原始日记／凭证权限没有扩大。
- 新四接口 `notificationsList`、`notificationsSummary`、`notificationDetail`、`notificationRead`，收件人只来自服务端认证，不采信 payload uid。越权和不存在统一 NOT_FOUND。DTO 不含 uid、审核员、内部存储路径或媒体 URL。
- 索引 `recipient_order` = recipientUid ASC + order DESC；`recipient_readAt` = recipientUid ASC + readAt ASC。主键天然唯一，无额外 eventId 索引。order 为 13 位毫秒＋固定散列 ID，readAt=0 表示未读。
- 不迁移旧通知，不删除旧 reviewSeen 或索引。旧前端继续可调用旧已读接口；新版前端要求服务端先更新。

## 开发云核对结果、部署顺序和待联调

只读尝试 HBuilderX CLI：以新 worktree 绝对路径或项目序号传 cloud functions --list cloudfunction 被拒为无效项目；以 `--prj app --provider alipay --cloud` 返回“未找到服务空间”。本机存在同名工程，CLI 结果不能证明远程实际部署版本。本轮未确认新工作区关联空间、远端 fy-api 版本或索引状态，也未读取配置中的密钥。不得沿用旧文档的部署结论作为当前证据。

取得另行部署授权后：

1. 先在 HBuilderX 明确选中新 worktree 的 app/admin，核实目标支付宝开发云空间和当前远端版本，确认备份与真实测试身份。
2. 新增私密 `fy-notifications` Schema，创建上述两项索引并确认就绪；保留已有集合、reviewSeen 和审计索引。
3. 部署包含 notification-service 的**完整最新 fy-api**及所需公共模块，核对包含 main 的步数／合作代码。通知集合不可用时审核应失败回滚，不能静默丢通知。
4. 再联调两端前端。旧前端可回退，通知数据和 Schema 保留；不得用旧分支 fy-api 覆盖新 main。
5. A 九图混合相册与日记，指定失败图重传；R 驳回→A 读理由／消息→改帖→R 通过，核对旧公开版切换。B 举报→R 下架，旧分享／图片失效。跨设备补读、真实并发／提交响应丢失、通知插入失败回滚、R 禁言／解除、M 停用／恢复且旧令牌失效、B 不得访问 A 的消息／待审图／日记原图。
6. 微信上用真实 A/B、R/M 完成弱网、权限、两账号和换设备验证后再填写通过。没有云端、真实浏览器网络和手机证据的格子保持未执行；无需重做别的同事的步数／终章真机验收。

本分支只提交并推送功能分支、PR 到 main，不合并、不部署、不上传 Schema／索引、不修改真实用户数据。

## 2026-11-23 项目方反馈

项目方在本会话反馈“我试过都没问题了”，确认本轮试用无异常并同意进入下一段开发。PR #9 已合并到 main（36dac2c），桌面本地 main 已同步且原有未提交改动保留。本段为项目方验收反馈；未另行提供账号、设备或远端部署版本明细，不替代上述逐项执行证据。
