# 阶段二部署清单（未执行）

2026-11-11。所有操作必须另行授权；本文件不授权部署。

## 已核实的本地配置

- 分支 `codex/stage-2`，起点 `stage-1 / ad8f155 / stage-1-baseline`。远程只读 `ls-remote` 成功、没有引用；未推送。
- 基线源 manifest 实际已有 `wx54dea9a4a48bfed5`，与交接文档“为空”的描述不同。旧 dev 产物为游客；重新编译已恢复正确 AppID。每次编译后运行 `node scripts/check-weixin-config.cjs`；发行传同一 `--appid` 并加 `--upload false`。
- HBuilderX 两工程本地关联均为支付宝 `env-00jy72i6ol3c`，admin 本地发行编译也报告该空间。未更改关联。云函数列表只读查询成功，当前没有返回业务函数。
- 两端有 uni-id-common/uni-config-center 模块；未找到本地实际 uni-id 配置。云端密钥内容及存储目录权限尚未核实，不能由已安装模块推断已配置。

## 待授权目标与具体变更

建议明确该空间可用作隔离开发环境后，才部署以下内容；若空间有其他项目使用，先另建隔离开发空间并重新核对两端关联。

1. app/uniCloud-alipay 为唯一服务端源码。安装 fy-api 的本地公共模块依赖；上传 uni-config-center、uni-id-common、fy-api。admin 不维护另一份云函数。
2. 上传 database 下新增 `fy-*` schema/index，全部客户端权限为 false。`uni-id-users.schema.json` 也为拒绝客户端访问；先核对现有用户 schema，禁止盲目覆盖其他项目集合权限。确定性主键承担业务唯一约束，不依赖客户端请求去重。
3. 云端 uni-config-center 的 `uni-id/config.json`：为 app `__UNI__66F7643` 和 admin `__UNI__2F0DD1B` 配置相同的高强度 tokenSecret、tokenExpiresIn=7200、tokenExpiresThreshold=0。不要把 tokenSecret 提交 Git。
4. 云端 uni-config-center 的 `fy/config.json`：参考 fy-api/config.example.json。微信 AppSecret 仅在云端安全填写；mediaEncryptionKey 为安全生成的 32 字节密钥的 base64，长期安全保存，不能直接更换导致历史照片不可读。environment 使用 development，测试数据不在 production 目录中展示。
5. 在支付宝存储创建 `fy-private` 私有目录，验证匿名和另一用户不能直接获得原始照片。服务端另做 AES-256-GCM 加密，客户端只得到业务 mediaId，按身份解密读取；不返回存储 fileID、原始 URL 或解密密钥。验证后才设 privateStorageVerified=true，未验证拒绝上传。请求/响应包含敏感内容，云函数平台日志也必须关闭请求正文采集。
6. 通过 `scripts/prepare-admin.cjs` 生成离线首个管理员导入文件（只写 .superpowers 忽略目录；密码来自安全环境变量）。授权后导入 uni-id-users，校验没有同名账号；无公开注册管理员或提权接口。密码不放命令参数、文档或日志。
7. 配置后台实际来源的安全域名及微信隐私声明、定位权限与请求域名。检查当前正式工具的开发者权限，不能用游客登录结果验收真实微信身份。
8. 无需上传旧素材。后台使用澳喵本地精选图；仅创建明确标记的开发测试路线。正式馆名、GCJ-02 坐标、允许打卡区域和馆方资料尚缺；当前正式内容发布被门禁拒绝，需完成内容核实流程后再开放。

## 授权后的联调顺序

- 先在隔离空间验证事务 doc.set/commit/rollback，以及同节点并发：两个不同请求只留一条 checkin/diary；注入断网/响应丢失后同请求可恢复。若支付宝返回的冲突错误类型不同，按实际错误码补充重试适配，不能将失败显示成成功。
- 微信真实账号 A 登录、重启恢复、令牌到期换 code、主动退出后旧令牌拒绝；B 猜 A 的 run/mediaId 拒绝。普通用户调用 drafts/saveDraft/publish 必须拒绝；撤销管理员角色后旧令牌立即失去管理权限。
- 后台登录 → 保存馆方与节点测试草稿 → 发布 → 游客读取 → 登录创建探索 → 定位选图 → 上传 → 服务端范围校验 → 打卡与日记 → 进度回地图。
- 测试错误类型/超过 1MB 照片、定位拒绝/越界、上传失败、提交响应丢失、篡改媒体 ID、照片绑定错误、重复请求、版本发布后旧 run 不变。限流集合需要定期清理过期计数；未绑定加密媒体需后续受控清理作业，不能删除已被日记引用的照片。
- 真机 iOS/Android 的定位精度、隐私授权、弱网、首次分包耗时及小屏长标题仍须实际设备检查。不能用本地内存事务测试替代以上验证。

官方能力依据：[支付宝私有目录与服务端文件接口](https://doc.dcloud.net.cn/uniCloud/storage/dev)、[数据库事务](https://doc.dcloud.net.cn/uniCloud/cf-database?id=start-transaction)、[uni-id-common](https://doc.dcloud.net.cn/uniCloud/uni-id/cloud-common.html)、[调试与 systemLog](https://doc.dcloud.net.cn/uniCloud/rundebug.html)。
