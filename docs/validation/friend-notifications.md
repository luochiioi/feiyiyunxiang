# 好友申请消息验收与交接

日期：2026-11-23（澳门时间）。本轮完成本机实现、自动回归、构建及模拟接口浏览器验证；未部署云端，未执行本轮微信真机。上一轮社区消息由项目方反馈“我试过都没问题了”，已记录为项目方验收结论，未补造设备／部署明细。

## 来源与范围

- 工作区：`C:/Users/Raymond/.codex/worktrees/friend-notifications/feiyiyunxiang`。
- 分支：`codex/friend-notifications`；fetch 后 main 基线 `36dac2c956460b0beb6b4f8c8245cafc9a121929`。桌面 main 及原规划工作区的未提交改动保持原状。
- [设计](../superpowers/specs/2026-11-23-friend-notifications-design.md)；[实施计划](../superpowers/plans/2026-11-23-friend-notifications.md)。实现源码 `2539dac`，随后仅补 Schema 声明、测试、验收脚本及文档。
- 接入 `friend.request.received`（申请接收人）和 `friend.request.accepted`（原申请人）。复用「我的 → 消息」分页、未读和已读；消息进入旅伴处理，不直接接受／拒绝。拒绝、撤回、过期不另发消息；详情显示当前状态。读消息不等于接受申请。
- 未接入合作、PK、系统通知、私信或注销；路线、地图、剧情、AR、澳喵、步数、双城终章未改。

## 实现和兼容

通知与申请／接受结果写在原事务中，通知失败整体回滚。稳定事件键包含好友关系和原发起人/requestId，重复请求、已提交但响应丢失或并发处理只生成一条对应消息；已读时间不被重试覆盖。接受同一决定可重复确认，反向决定被拒；旧 requestId 不得处理新代次。

新申请存可选 `responseId`，接收方列表把它作为不透明处理标识，避免不同申请人使用相同 requestId 时串单。保留原申请人 requestId 和已有映射，旧记录继续用原标识，不迁移历史数据。新接收方映射仍在 `fy-requests`，不新增集合或索引。拒绝／接受仍沿用原本人接口及权限。

好友消息详情增加可选 `friend = { nickname, status }`，status 为 pending/accepted/rejected/withdrawn/expired/unavailable。昵称是写入时的有限快照，状态每次读取重查申请代次、归属、有效期和对方账号；旧代次、目标消失或停用只显示不可用，不跳转某一条新的申请。好友入口只打开本人旅伴列表，实际处理重新读取列表及原服务端权限。

消息 DTO 不公开数据库 uid、关系主键、请求标识或媒体；不回填历史好友消息。原审核消息 DTO、事件键、精准版本已读和九图行为保持兼容。

旅伴页发送失败保留输入与相同请求标识；写入成功后刷新失败单独重试读取，不重发申请／决定。未确认发送仅在内存按 uid 保存，A→null→A 续期可恢复，换到 B 清除。列表、决定和发送的延迟结果按 uid/序号隔离。好友详情返回时重新读取状态，已成功的已读回执不重复提交。

## 实际证据

| 场景 | 本机 | Chrome 实际 Web＋模拟接口 | 开发云 | 微信真机 |
| --- | --- | --- | --- | --- |
| 申请／接受消息收件人、本人权限和只读消息不处理申请 | 通过 | 收到申请、原因区不误用审核文案、跳旅伴及接受通过 | 未执行 | 未执行 |
| 并发申请／接受、接受与拒绝／撤回竞争、响应丢失 | 真实 repository＋内存 MVCC 冲突／事务模拟通过 | 发送响应丢失后同 requestId 重试通过 | 未执行 | 未执行 |
| 通知失败回滚状态及请求映射，重复写不清已读 | 通过 | 独立已读失败重试通过 | 未执行 | 未执行 |
| 拒绝、撤回、过期、旧代次、缺失目标、停用账号 | 通过；不新发拒绝／撤回通知 | 返回详情能读到接受后的状态 | 未执行 | 未执行 |
| 不同申请人相同 requestId、旧请求不能处理新申请 | 通过，独立 responseId 精确对应发送人 | 未执行碰撞场景 | 未执行 | 未执行 |
| A/B 延迟请求、同账号续期、发送和读取分离 | 真实页面脚本 VM 通过 | 接受成功但刷新失败，重试只读一次决定；切账号查看本人接受消息通过 | 未执行 | 未执行 |
| 原社区审核消息、旧驳回已读、九图及后台退出 | 原有全量回归通过 | 新产物重跑旧浏览器脚本通过（含九图第九张重试、底部退出） | 本轮未执行 | 本轮未执行 |

在本工作区执行：

```powershell
cd app
node --test 'tests/*.test.cjs'
# 176 tests, 176 pass, 0 fail
cd ..
./scripts/build-local.ps1 -Target WeixinDev
./scripts/build-local.ps1 -Target Admin
```

HBuilderX 5.15；源目录、产物及哈希见 [执行摘要](evidence/friend-notifications/local-results.txt)。微信 AppID `wx54dea9a4a48bfed5` 源码与编译包一致，开发包位于本工作区的 `app/unpackage/dist/dev/mp-weixin`；后台产物为 `admin/unpackage/dist/build/web`。辅助 app Web 为 `app/unpackage/dist/build/web`，仅用于浏览器验收。保留既有 AR 鸿蒙兼容、Browserslist 和辅助 Web 的既有页面可空类型警告；不是零警告构建。

浏览器复现：用本机静态服务器把**此工作区**的 app/admin `dist/build/web` 分别服务到 127.0.0.1:8421/8422；分别开启干净的 Playwright CLI 会话后，执行 `run-code --filename scripts/validate-friend-notifications-browser.js` 与 `scripts/validate-community-notifications-browser.js`。两脚本注入本地固定响应并拦截产物中的云调用，不作为服务端／开发云证据。不同脚本使用独立浏览器会话，避免复用模拟状态。

截图：[收到申请](evidence/friend-notifications/friend-received-browser.png)、[旅伴处理](evidence/friend-notifications/friend-companion-browser.png)、[接受结果](evidence/friend-notifications/friend-accepted-browser.png)。

独立审查的两项 P2（返回详情未刷新、续期丢失未确认请求）已用失败测试复现并修复，再跑全量回归。

## Schema、权限与部署

- `fy-notifications` 新增可选字符串 `friendId`、`friendEventKey`、`actorNickname`。保留既有必填社区字段；好友消息的 postId/revisionId/commentId/reason 为空字符串。客户端直读写仍全 false，收件 uid 只来自服务端。
- `fy-friends` 新增可选字符串 `responseId`；全部客户端直读写权限不变。旧行缺省用原 requestId。`fy-requests` 仍使用已有通用映射字段，增加接收方不透明标识对应的行。
- 不新增索引；沿用 recipient_order、recipient_readAt 及各现有主键。新 writer 只依赖 crypto/policy，不引入 service→partnership 的循环依赖。

获另行部署授权后，先核对实际开发空间及远端版本，再应用两处可选 Schema 字段，保留原索引；部署包含 friend-notification-events 的完整最新 fy-api 及所需公共模块，最后更新前端。先服务端后前端；旧前端可继续按收到的申请标识调用原接口。若回退前端，保留通知数据；若回退云函数，必须保留好友消息读取／分类兼容，不能直接覆盖回不认识好友消息的旧 fy-api。

本轮没有上传云函数、Schema、索引或修改真实用户数据。继续由真实 A/B 两账号与第三账号 C 验证：申请和接受补读、拒绝撤回过期、并发／弱网／提交响应丢失、账号切换与续期、旧版本客户端、停用后不可访问、旧审核消息正常。执行后再填写开发云和手机证据。
