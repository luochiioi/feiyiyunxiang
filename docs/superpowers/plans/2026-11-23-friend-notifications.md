# 好友申请消息 Implementation Plan

> 使用 superpowers:executing-plans 按任务实施；TDD 和最终独立审查。

**Goal:** 消息中心补读好友申请与接受结果，跳转旅伴处理。
**Architecture:** 固定事件键及原业务事务；本人详情重查申请状态；复用分页／已读。
**Tech Stack:** UTS、uni-app x、CommonJS、支付宝 uniCloud。
**Spec:** docs/superpowers/specs/2026-11-23-friend-notifications-design.md。

## Global Constraints

从最新 main 创建独立 codex/ 分支及 worktree；不动原改动；旧审核 DTO/事件键兼容；不公开 uid/媒体；不改无关业务，不部署不合并。

## Review Focus

申请／接受响应丢失和竞争；通知失败回滚；旧申请与新申请隔离、同 requestId 不同发送方；跨账号及会话续期；旧审核接口与 Schema 兼容。

## Task 1：事务事件与服务端

Files: 新 friend-notification-events.js、friend-notifications.test.cjs；修改 notification-service.js、partnership-service.js、fy-notifications.schema.json；扩展现有 gateway/partnership 测试。

- [ ] 基线全量测试；记录用户对上一轮的验收反馈。
- [ ] RED：申请通知接收人、接受通知申请人；响应丢失／重复／并发、通知失败回滚、已读不回退、旧申请失效、旧 requestId 不处理新申请、越权，拒绝/撤回/过期不新增消息。
- [ ] GREEN：独立事件辅助（crypto/policy 依赖，避免 service/partnership 循环引用）；好友详情可选 friend DTO，精确代次及权限；同结果接受重试幂等。
- [ ] 定向及全量回归，提交服务端。

## Task 2：页面与重试

Files: notifications.uts、profile 消息列表/详情/account、partner.uvue、好友客户端测试。

- [ ] RED：好友消息展示与跳转，读消息不处理申请；发送失败复用 requestId，成功后刷新失败只刷新；切账号、旧请求和旧审核兼容。
- [ ] GREEN：通用消息文案；详情状态与旅伴入口；旅伴读取/写入/刷新分离，按账号与序号隔离。
- [ ] 全量测试和两端构建，提交前端。

## Task 3：证据与交付

Files: docs/validation/friend-notifications.md、PROJECT-TODO.md、证据和浏览器验收脚本。

- [ ] app 执行 node --test 'tests/*.test.cjs'；根 build-local.ps1 -Target WeixinDev / Admin，核对实际路径。
- [ ] Chrome 实际 Web 产物＋本地模拟接口验证新旧消息；云端/手机未执行的不得标通过。
- [ ] 独立审查全分支；重要发现补测修复，全量回归及 diff --check。
- [ ] 推送 codex/friend-notifications，PR 到 main；记录可选 Schema 字段→完整 fy-api→前端的部署顺序，待真实账号联调；不自行合并／部署。
