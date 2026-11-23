# 开发云消息部署与联调

日期：2026-11-23（澳门时间）。项目方本次明确“确认授权”同步开发云并继续联调。

## 部署来源与目标

- 固定桌面源码：`C:/Users/Raymond/Desktop/feinibuke/feiyiyunxiang`，`codex/desktop-development`，好友消息基线 56f8d6e。保留原有未提交改动；部署内容包含该目录既有 partnership-service 的 invitedAt/expiresAt 取同一 at 的两行修订。
- 目标：支付宝开发空间 `env-00jy72i6ol3c`（feiyiyunxiang），未发布微信正式版本、未合并 PR 或推 main。
- 私有备份：`C:/Users/Raymond/.codex/backups/development-cloud-notifications-20261123`，含部署前远端 fy-api、公共模块、好友 Schema 及桌面源码快照。备份含受控配置，不进入 Git。
- 关联元数据曾失配，CLI 明确重新选择已授权的同一 spaceId 后，Schema 操作恢复。没有创建其他空间。

## 实际部署

1. 创建 fy-notifications 并上传私密 Schema，保留既有社区字段，增加可选好友字段 friendId/friendEventKey/actorNickname。
2. 将索引初始化范围临时限定为 fy-notifications 的 Schema＋index 两个文件，上传 recipient_order（recipientUid ASC, order DESC）和 recipient_readAt（recipientUid ASC, readAt ASC）。没有导入任何 init_data 文件，也没有初始化其他集合。
3. 备份并强制更新 fy-friends Schema 的可选 responseId 字段，数据记录不变。回读确认 responseId 为 string；消息 Schema 回读确认 read/create/update/delete 全为 false 和三项好友字段齐全。
4. 上传桌面完整 fy-api，包含 notification-service 和 friend-notification-events。公共模块 fy-cloud-core 的四个源码文件与远端一致，package.json 仅排版不同，因此保留现有公共模块，不重复覆盖其他模块。
5. 下载已部署 fy-api 回读：index、notification-service、friend-notification-events、community-service、partnership-service、step-service、coop-story 与桌面源码内容一致。

部署前发现桌面旧配置与当前云端在用配置不同，因此使用**当前云端配置**随新代码上传；原 AppSecret、identity 与媒体加密配置全部保留，部署后完整配置 JSON 与部署前相同。没有在日志、Git 或本文输出密钥。重新微信登录通过，澳喵与好友列表正常。

CLI 显示本机调试 Node 18.20.0、云端 18.18.2；实际云端探针通过，没有更换运行时。

## 实际证据

| 层面 | 执行结果 |
| --- | --- |
| 本机回归 | 桌面 app `node --test 'tests/*.test.cjs'`，177/177，0 失败 |
| 微信真实运行时＋已部署 fy-api | 登录 OK；aomiaoStatus、friends、notificationsSummary、notificationsList 均 OK；当前本人 unread=0、items=0 |
| 消息页面 | 实际微信开发者工具打开「消息」，正常显示“暂无消息”，无旧 NOT_FOUND 加载失败，见截图 |
| 开发云真实事务 | 本地验证程序通过 uniCloud 连接该开发云数据库，隔离 A/B/C 身份验证 13 项断言通过（下述列表） |
| 已部署网关权限 | 用当前真实微信 token 查询／标读隔离账号的已存在消息，均 NOT_FOUND；伪造 recipientUid 仍返回本人 unread=0；游客和假后台 token 均 AUTH_REQUIRED |
| 数据清理 | 所有隔离记录按精确 collection/id 删除，再回读确认 remaining=0；13 条记录清理完成 |
| 真机 | 本轮未执行两台手机／两个真实微信号的交互；不得以隔离身份代替真机证据 |

开发云事务的 13 项断言：实际提交后模拟响应丢失、申请事件唯一、收件人未读计数、跨账号详情隔离、跨账号已读隔离、已读持久化、重试不清已读、并发相同决定幂等、接受事件唯一、消息反映当前 accepted、注入通知失败、真实事务回滚好友状态、回滚不残留通知。

验证程序**仅在本地运行**，未上传临时测试云函数。它只写隔离前缀账号及从这些账号派生的 profile/friend/request/notification；未向真实好友发送申请。测试结束已移出 cloudfunctions，归档在桌面 `.superpowers/development-cloud-acceptance-local-archive`。远端云函数列表仍仅 fy-api 和 fy-guess。

索引上传／初始化返回成功，带数据的分页排序与未读 count 查询通过；没有另行取得索引后台状态字段截图。客户端 JQL 直读探针没有得到可用于断言的独立权限错误，本轮数据库权限证据为 Schema 回读全 false；本产品继续通过已验证的 fy-api 本人接口访问。

实际日志摘要与源码哈希见 [执行记录](evidence/development-cloud-notifications/results.txt)，[微信消息空态截图](evidence/development-cloud-notifications/messages-live-empty.png)。

## 项目方下一步验收

继续从桌面 app 运行，微信工具打开 `app/unpackage/dist/dev/mp-weixin`。重新登录后，用 A/B 两真实账号验收 A 发申请 → B 消息收件／已读 → B 在旅伴接受 → A 收到接受消息。再验收拒绝、撤回、过期、重登补读、第三账号隔离。当前暂无消息是正常结果：没有回填历史好友或旧审核记录，只有新事件生成消息。

本机、浏览器模拟、开发云隔离身份和真实手机验收分别记录，不将本轮自动探针写成双手机已通过。
