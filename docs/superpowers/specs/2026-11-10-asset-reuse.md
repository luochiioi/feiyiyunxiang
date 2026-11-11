# 澳喵与首页素材复用清单

日期：2026-11-10。旧素材根目录：`C:/Users/Raymond/Desktop/feinibuke/app-latest/app/static`。当前只引用与检查，不修改旧图，不复制到产品 static，不改变新工程配置。

| 旧相对路径 | 设计用途 | 处理说明 |
| --- | --- | --- |
| pet/wave.png | 用户指定澳喵主形象，欢迎、个人角色与完成提示 | 已查看；约 1.06 MiB，实施时按显示需求优化资源策略 |
| healing-map/icons/ip-v3/home-ai-route-tight.png | 探索路线入口 | 已查看；只复用图片，“AI 路线”旧语义不继承 |
| healing-map/icons/ip-v3/home-points-tight.png | 路线节点、地图打卡入口 | 已查看；配“路线地图”“去打卡”等文字 |
| healing-map/icons/ip-v3/home-community-tight.png | 社区入口 | 已查看；透明区域需在浅色底检查 |
| healing-map/icons/ip-v3/home-profile-tight.png | 我的入口 | 已查看；配合新版资料与日记 |
| healing-map/icons/ip-v3/home-locate-tight.png | 地图回到当前位置 | 文件存在，实施前再检查小尺寸可读性 |
| healing-map/icons/ip-v3/account-friends.png | 好友邀请与旅伴辅助入口 | 文件存在，候选；正式采用前确认画面 |
| story-icons/aomiao-story-entry.png | 剧情入口辅助图 | 文件存在，候选；不继承校园标题 |
| tabbar/map-off.png、map-on.png | 主导航探索候选 | 文件存在，需检查与新配色、尺寸是否合适 |
| tabbar/account-off.png、account-on.png | 主导航我的候选 | 文件存在，需检查文字语义 |

2026-11-11 更新：首版已确定不使用底部 Tab，以上 tabbar 图片仅作为历史候选，不用于底部导航。新增预览复用：account-friends.png → 旅伴侧边入口，aomiao-story-entry.png → 剧情侧边入口，home-locate-tight.png → 地图定位，macau_silk_route.png → 路线主题封面。草图精选素材现共 9 张，均为旧图副本，不修改原图。

不复用为功能入口：home-steps、home-coins、home-campus、商城 tab、原宠物养成相关的食物、金币、增益图。排行榜如复用旧图片，只代表好友路线完成榜，不恢复步数榜。

旧图片和新图保持可追溯映射；发布前确认素材使用权。不会因用户允许复用按钮而假定旧剧情、馆藏图片和外部素材均可随意使用。

点位图标新增确认：复用 `marker_default.png`（灰色未打卡）、`marker_checked.png`（彩色已打卡），草图已采用；选中状态在实施时沿用旧版 `marker_default_selected.png` 与 `marker_checked_selected.png`，保留视觉而不继承不适合小程序的原生类型封装。

当前草图所需的十一张图片以精选副本放入 `docs/design/assets/`，使用相对路径展示。它们仅服务设计预览；正式实现须按素材策略进入产品资源位置，不能把最终项目绑定在旧工程绝对路径上。
