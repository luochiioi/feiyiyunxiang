# 新会话提示词

复制以下内容到新会话即可。本计划的昵称／头像和「我的」优化尚未实施。

```text
请实施「非遗云享」用户资料与「我的」页面迭代。

固定仓库：C:/Users/Raymond/Desktop/feinibuke/feiyiyunxiang
只在这个实际桌面目录开发和运行，不新开 worktree，不在 main 实施；保留所有已有改动和私密配置，不 git add -A。

先阅读：
docs/superpowers/specs/2026-11-23-profile-and-my-page-design.md
docs/superpowers/plans/2026-11-23-profile-and-my-page.md
docs/PROJECT-TODO.md
docs/validation/notification-entrypoints.md
docs/validation/community-image-recovery.md
docs/validation/development-cloud-notifications.md

先备份原有未提交／未跟踪文件和忽略的私密配置，再 fetch origin，核对 PR #10（https://github.com/luochiioi/feiyiyunxiang/pull/10）及最新代码，避免重复开发。PR #10 已合并就从最新 origin/main 创建 codex/profile-and-my-page；尚未合并就基于最新好友消息分支继续，并在新 PR 写清依赖。不要自行合并 #10。

按计划推荐默认方案完成 Task 1–8：昵称、头像是核心；可选简介、城市展示标签和最多三个文化兴趣；新公开资料由现有后台人工审核，审核前继续展示旧资料。统一帖子／评论／两种排行榜／好友申请和好友列表等当前昵称头像，保留历史审计和对外双城终章席位标签。邀请码和账号身份不变。完成「我的」资料头部、快捷入口和紧凑澳喵卡，保留领取、探索档案、未读／驳回红点、步数设置、隐私和退出。

资料、审计、审核结果消息同事务；本人权限、幂等、并发和响应丢失、旧资料缺字段、切账号、头像失败重试、审核与停用恢复必须有证据。头像复用已验证私密图片能力，去元数据；保留当前 mediaEncryptionKey 和 mediaLegacyDecryptionKeys，不暴露 fileID、不开放存储桶、不把密钥提交 Git。

路线、地图任务、剧情、AR、私信、账号注销和全站通知不纳入本轮。现有澳喵样式、九图、后台缩略图、侧栏退出、红色驳回、仅箭头返回、步数自动同步和双城终章都要保留。

在 app 运行 node --test 'tests/*.test.cjs'；仓库根运行 ./scripts/build-local.ps1 -Target WeixinDev 和 ./scripts/build-local.ps1 -Target Admin。核对实际源码及产物，分别记录本机、浏览器模拟、开发云、微信真机证据，未执行不能标通过。

先完成本地实现和验证，提交并推功能分支、整理 PR。云端变更前列出目标空间、Schema／索引／函数、私密配置备份和回退方案，再取得本轮明确授权；不把此前好友／图片授权扩展为资料部署授权。不要推 main、自行合并或部署正式环境。

结束时说明实际完成、测试、PR、部署顺序与仍待真机验收的项目。
```
