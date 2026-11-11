# 非遗云想设计资料

当前阶段：正在验收阶段一微信页面和地图交互。app 已实现主要页面并使用标记清楚的本地演示数据；真实登录和云端打卡在阶段二接通。admin 当前为基础工程。

- [阶段一验收清单](validation/stage-1-acceptance.md)：各页面当前可测试的操作、待开发能力、通过标准和进入阶段二的条件。
- [阶段一微信验证记录](validation/stage-1-weixin.md)：编译、分包、已完成的检查及模拟器截图。
- [阶段二接手说明](validation/stage-2-handoff.md)：当前实现、剩余复核、配置实际缺项和下一阶段范围。

- [完整设计说明](superpowers/specs/2026-11-10-feiyiyunxiang-design.md)：确认范围、页面、路线剧情、合作、PK、审核、后台、云端边界与验收。
- [当前主要页面草图](design/2026-11-11-map-home-design.html)：地图首页侧边按钮缩小、删除中央圆形按钮、当前路线条默认收起且可点击展开；无底部 Tab。其他页面延续旧版复用方案。
- [当前地图首页预览](design/2026-11-11-map-home-preview.jpg)：已在浏览器检查的新布局。
- [上一版草图（已被新布局替代）](design/2026-11-10-design-board.html)：历史参考，不再作为首页导航方案。
- [上一版首页截图](design/2026-11-10-home-preview.jpg)：仅作历史参考。
- [素材复用清单](superpowers/specs/2026-11-10-asset-reuse.md)：澳喵与旧首页图片的来源和新用途。
- [本轮检查记录](design/2026-11-10-review-notes.md)：设计审阅与展示检查结果。
- [旧版实际运行与复用评估](design/2026-11-11-legacy-reuse-review.md)：用户补充复用意向后，接通本地演示数据并核对旧版页面；后续设计优先评估已有布局和组件。
- [地图首页修订记录](design/2026-11-11-map-revision-notes.md)：本轮改动与显示检查。
- [开发路线图](superpowers/plans/2026-11-11-development-roadmap.md)：阶段划分、配置时机和验收成果。
- [首阶段实施计划](superpowers/plans/2026-11-11-stage-1-map-shell.md)：地图、旧页面复用与微信运行的具体任务。

HTML 是静态设计展示稿，不是小程序实现；按钮不执行登录、打卡、审核或任何云端操作。预览中的人物、数字、场景均为示意。正式内容与实现以审阅后的设计版本为准。

当前先完成阶段一页面和导航验收，再进入阶段二真实微信登录、私密打卡及最小后台的开发。GitHub 推送及云端部署另行授权。
