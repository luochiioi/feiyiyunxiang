# 桌面项目运行恢复与实际验证

2026-11-23（澳门时间）。项目方要求以后固定在桌面现有项目开发、运行，不再新建 worktree。

## 固定目录

- 源码：`C:/Users/Raymond/Desktop/feinibuke/feiyiyunxiang`；当前本地开发分支 `codex/desktop-development`，包含好友消息 PR #10 的 56f8d6e 和原有本地改动。未把未提交改动推到 main。
- HBuilderX 已关闭本轮额外 worktree 的 app/admin 工程入口，仅保留桌面 app/admin；旧文件与工作区未删除。
- 微信开发者工具现应打开桌面 `app/unpackage/dist/dev/mp-weixin`，不再打开 `.codex/worktrees/...` 目录。
- 后台产物：桌面 `admin/unpackage/dist/build/web`。
- 同步前原有 10 个改动／未跟踪文件备份在 `C:/Users/Raymond/.codex/backups/desktop-friend-sync-20261123-010402`，stash 也保留。恢复后源码冲突为零。

## 登录问题根因与恢复

原截图运行的是 community-review-notifications 工作区，本地云函数模式缺少被 Git 忽略的 `fy-api/fy/config.json`，HBuilderX 控制台对 wxLogin/catalog 返回 CONFIG_REQUIRED。已使用同 AppID 的既有受控本地配置恢复该目录，未打印或提交密钥；catalog 随后返回 OK。

按项目方选择切回桌面项目，项目方重新关联支付宝开发空间 env-00jy72i6ol3c。编译器输出已确认使用此 spaceId。期间出现 UTS cache ENOENT，单纯移开生成缓存不足以恢复；停止一直驻留的 mp-weixin 编译进程后重新编译成功。缓存备份保留于桌面 `.superpowers/uts-cache-backup-20261123-0112`，未删除源码或云端数据。

最终桌面微信开发编译和 AppID 校验通过；后台 Web 导出通过。177/177 本机测试通过，较独立好友分支多 1 项来自原有未提交 gateway 测试。

使用微信官方 miniprogram-automator 连接**桌面项目实际运行时**（不是浏览器模拟接口），调用本项目实际 `features/api.js` 登录并重开「我的」后：

| 实际调用 | 结果 |
| --- | --- |
| 微信登录 login / wxLogin | OK，登录态已保存 |
| 重开「我的」后登录态 | 保持已登录 |
| aomiaoStatus | OK，已领取 |
| friends | OK，现有好友列表可读 |
| notificationsSummary | NOT_FOUND |
| notificationsList | NOT_FOUND |

这里的 NOT_FOUND 来自真实开发云，说明当前远端尚未提供消息接口；不是本地页面或账号登录问题。不能据此把真实好友消息闭环标通过。

## 图一代码质量扫描

- 当前为开发构建，`project.config.json.setting.minified=false`，JS 未压缩与正式发行包应区分。正式发布前使用发行包复查压缩。
- 澳喵 PNG 为 345779 字节，796×659，超过截图 200 KB 优化阈值；发布前应在保留当前形象与透明背景的前提下优化体积。本次未改动项目方素材。
- 主包未使用 JS 提示应按正式包依赖确认后下沉至分包，不能直接删除这些仍被分包使用的模块。当前主包大小与组件项通过。
- 截图中收起的其他扫描项没有逐项证据，不标为通过。

## 真正验证好友消息

先获得开发云同步授权，应用私密消息 Schema 和 recipient_order/recipient_readAt 两项索引，应用 fy-friends.responseId 可选字段，再部署桌面完整最新 fy-api，最后重编两端。不会因“已关联云空间”自动上传云函数、Schema 或索引。

部署后，两账号验证：A 在旅伴向 B 发送申请；B 在「我的 → 消息」看到申请，进入详情标读，再进入旅伴接受；A 收到接受结果。再验收拒绝、撤回、过期、重登补读及切账号隔离。第三账号不能查看其他人的消息。模拟器本机通过不替代两台手机的真实账号验证。

本记录写入时，开发云同步授权仍在等待项目方确认，未上传本轮资源，也未向真实好友发送测试申请。

## 随后获得授权并完成开发云同步

项目方明确“确认授权”后已完成消息 Schema、两项索引、好友可选字段及完整 fy-api 同步。真实消息接口由 NOT_FOUND 恢复为 OK，隔离账号事务／权限验证与清理完成。详见[开发云部署证据](development-cloud-notifications.md)。两台手机的真实账号交互仍需项目方实测。
