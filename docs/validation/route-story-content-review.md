# 路线与剧情正式内容核对

2026-11-12。两馆公开资料、点位和可复用图源可用于路线草稿。本轮核对的《海丝瓷绣·一念归期》分镜由项目方确认已审定。下面记录现有程序与脚本的对应和仍需现场或权利人确认的事项。

## 两馆首站和打卡参数

| 路线 | 官方名称及地址 | 高德 POI（纬度，经度） | 首站与半径 |
| --- | --- | --- | --- |
| 澳门 | 澳门博物馆，澳门博物馆前地 112 号（大炮台）。[澳门政府旅游局](https://www.macaotourism.gov.mo/zh-hant/sightseeing/museums-and-galleries/macao-museum) | 22.194192, 113.547292。[高德 POI](https://ditu.amap.com/place/B073D00AS8) | 以大炮台澳门博物馆入口一带为首站，产品半径 **100 米**。只引导到馆外允许停留和取景处。[馆方拍摄须知](https://www.macaumuseum.gov.mo/visit/photographmustknow) |
| 湖南 | 湖南湘绣博物馆，湖南省长沙市芙蓉区车站北路 39 号。[馆方](https://www.hnembmusuem.com/) | 28.198609, 113.009827。[高德 POI](https://ditu.amap.com/place/B02DB03F24) | 以车站北路 39 号的湘绣博物馆馆外入口一带为首站，产品半径 **80 米**。只引导到馆外允许停留和取景处。 |

高德开放平台在中国大陆和澳门使用高德坐标系。两馆各配置一个馆外实体站，后续阶段在小程序内完成。表中半径是应用的距离判定参数；允许停留和取景的范围以现场标识及馆方要求为准。双机联调需复测入口位置与半径边界。[高德坐标系说明](https://lbs.amap.com/faq/advisory/others/39840/)

## 上、下集参观说明

- 澳门上集按常设展三层编排观察任务，涵盖一楼通商、二楼传统行业与民间生活、三楼当代城市和艺术。定位照片在馆外入口区域完成，蓝白瓷砖活动在小程序内进行。[常设展览](https://www.macaumuseum.gov.mo/zh-hans/exhibitions/75001) · [参观资讯](https://www.macaumuseum.gov.mo/zh-hans/visit/access) · [拍摄须知](https://www.macaumuseum.gov.mo/visit/photographmustknow)
- 湖南下集按馆方四个主题展厅编排，结合展签和作品观察湘绣历史、纹样、线条、色阶与双面绣。定位照片在馆外完成，辨认及学习卡使用原创示意图。[湖南湘绣博物馆馆情](https://hnembmusuem.com/aboutUs.html) · [参观指南](https://www.hnembmusuem.com/visitReservation.html) · [国家级非遗名录](https://www.ihchina.cn/project_details/13982.html)

## 图片及科普资料

| 用途 | 可用来源或待核项目 |
| --- | --- |
| 澳门路线入口图 | 摄影 LN9267，澳门博物馆入口，CC BY-SA 4.0。采用时标作者、来源、许可及修改情况，改作按同一或兼容许可发布。[原图及许可](https://commons.wikimedia.org/wiki/File:Macau_Museum_entry_09-02-2023.jpg) |
| 蓝白瓷砖纹样示例 | 摄影 LBM1948，里斯本建筑蓝白瓷砖，CC BY-SA 4.0，可作跨地域的纹样示意，图注写明拍摄地。[原图及许可](https://commons.wikimedia.org/wiki/File:Lisboa,_azulejos_01.jpg) |
| 两馆藏品、工序图和湖南馆入口图 | 澳门馆官网声明转载须经许可。湖南馆有展陈资料，暂未核实可供本项目转载的馆藏照片、工序图或入口照片许可。使用前记录藏品编号、摄影者、权利人、允许的用途及改作范围。[澳门馆版权](https://www.macaumuseum.gov.mo/copyright) · [湖南馆介绍](https://hnembmusuem.com/aboutUs.html) |
| 湘绣科普 | 采用国家级非遗项目资料与馆方展陈资料核实基本介绍。脚本的针法分类、工序细节，以及特定历史贸易断言需要逐条核对依据。[国家级非遗项目湘绣](https://www.ihchina.cn/Article/Index/detail?id=15341) · [湖南馆介绍](https://hnembmusuem.com/aboutUs.html) |

## 已纳入小程序的图像和科普素材

- 六幕使用剧情插画，界面标注「AI 场景插画」。一、二、四幕使用项目已有素材，第三幕瓷砖作坊、第五幕湘绣摊位和第六幕绣房使用本次通过内建 imagegen 工具生成的 `tile-workshop.jpg`、`embroidery-stall.jpg`、`embroidery-room.jpg`。三张新增图共 518,878 字节。素材位于 `app/packages/story/static`。
- 纹样辨认和观察卡使用小程序的原创学习图示。澳门博物馆入口照片与里斯本纹样照片保留为开放许可备选，当前小程序使用项目自制图像。馆藏原图仍由权利人单独授权。
- 澳门草稿采用葡萄牙国家瓷砖博物馆对 azulejo、建筑用途的说明，以及该馆研究者关于钴蓝和传统色料的研究。题目用自制船帆和海浪纹样。[葡萄牙国家瓷砖博物馆](https://mnazulejo.gov.pt/en/museu) · [葡萄牙瓷砖色料综述](https://conservarpatrimonio.pt/article/view/27252)
- 湖南草稿采用国家级非遗名录中的公布时间及关于掺针、色阶和劈丝的说明。四张卡分别观察走向、长短与劈丝、色阶与掺针、层次。图示是观察练习。[国家级非遗名录湘绣](https://www.ihchina.cn/art/detail/id/13982.html)
- 两套内容在后台新建路线时可分别载入。澳门馆外线索打卡后进入瓷砖任务，湖南馆外线索打卡后进入湘绣任务。已有路线快照继续按原内容运行。

<details>
<summary>新增插画生成提示</summary>

- `tile-workshop.jpg` A single 16:9 landscape illustration for act 3 of a Chinese maritime heritage mini-program visual novel. Warm muted watercolor and gouache on lightly textured paper, elegant historical storybook, first-person viewpoint at a fictional Portuguese azulejo workshop. Sunlight hits a wooden worktable, with a pale ceramic tile painted cobalt blue and white, a small brush, clay and pigment bowls. An adult hand and a child's hand are near the tile, anatomically natural and unobtrusive. Tile has a simple geometric sailing motif, invented for this illustration. Clear focal point in center for phone screens, subdued wood amber and cobalt palette. No text, no logo, no modern equipment, no claim to depict a real museum or specific collection. Full bleed, no frame.
- `embroidery-stall.jpg` A single 16:9 landscape illustration for act 5 of a Chinese maritime heritage mini-program visual novel. Soft watercolor and gouache on textured paper, vintage warm-toned historical storybook. First-person view of a fictional historical Macao waterfront market stall, on the wooden counter a small blue and white rose embroidered textile with visible silk thread texture, and at foreground edge a hand holding a blue and white ceramic tile. Slight view of a kindly vendor on the far edge, ocean and market awnings softly painted behind. Focus on the contrast between silk and glossy tile. No text, no logos, no claims of a real artifact or museum. Full bleed, no frame.
- `embroidery-room.jpg` A single 16:9 landscape illustration for act 6 of a Chinese maritime heritage mini-program visual novel. Soft watercolor and gouache on textured paper, muted warm historical storybook. Fictional embroidery workroom with daylight through a wooden lattice window. Two central wood frames on a broad table show blue white silk stitches, with quiet artisans at work in softer background and a small glazed blue white tile resting beside the textile in the foreground. Tangible contrast between soft silk and glaze. Respectful calm craft scene, visibly a narrative illustration and not a factual stitch diagram. No text, no labels, no logos. Full bleed, no frame.

</details>

## 六幕分镜对照

分镜表含连续编号 1–41。现有第一幕随小程序打包，第二至六幕来自已发布路线版本。下表的差异用于准备试读稿，旧探索仍按自身快照和存档路径读取。

| 幕及镜头 | 审定脚本 | 当前实现及待确认差异 |
| --- | --- | --- |
| 一 · 1–6 | 展廊、看地图或闲逛、触碰后转场 | 游客阅读器以瓷砖或红线两分支开场。脚本中「闲逛回到原地」要明确如何在现有阅读器表现并兼容游客断点。 |
| 二 · 7–13 | 风暴、护住瓷砖、忆起女儿 | 现有绳索或垫布分支用于联调。合并模板仍由同一探索任一有效打卡解锁。 |
| 三 · 14–23 | 作坊回忆、制作过程、DIY 与记忆转折 | 现有三纹样、三预设配色及保存作品。工序内容和分镜中的配色比例需校订，镜头中未写出的台词需补齐。 |
| 四 · 24–26 | 商船靠岸、穿过渔村、遇到绣品摊 | 当前瓷砖纹样辨认为小程序的章前任务。 |
| 五 · 27–33 | 辨认湘绣、答错重试、邀往后厅 | 当前题目辨别针脚方向，脚本题目辨认作品类别。替换题目和配图应进入新修订。 |
| 六 · 34–41 | 四位绣娘的四项针法互动，瓷砖与湘绣并置收尾 | 当前四卡是观察示意。逐张已读仍是合并模板的第六幕门槛。现代收尾和双人终章需要另行补稿。 |

## 本地验证和待联调

- Node 全量回归 82/82。后台测试模板的预览不写入数据，分支、节点、答案及资源引用校验和版本回归已通过。用内存服务另行重现正式草稿在保存后无法得到审定状态，发布返回 `CONTENT_REVIEW_REQUIRED`。待确认按确切修订审批的后台方案。
- HBuilderX 5.15 后台 Web 开发编译通过。后台 Web 发布构建提示 DCloud 账号须完成实人认证。小程序已关联支付宝开发云 `env-00jy72i6ol3c`，已确认云端存在 `fy-api`；后台工程未关联。
- 绑定开发云后已重新编译微信开发包。微信开发者工具接受打开和启用自动化的请求，但模拟器未响应自动化调用，现行路线版本和双账号真实会话尚未核验。
- 本机使用实际两馆路线参数和模拟坐标验证边界。澳门 99 米通过、101 米拒绝；湖南 79 米通过、81 米拒绝。两馆有效线索打卡均开放后续文化任务，另一账号无法读取探索。现场实测本阶段暂缓。
