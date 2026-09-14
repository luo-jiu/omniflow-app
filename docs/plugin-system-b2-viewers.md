# B2 查看器贡献与状态恢复标识

更新时间：2026-09-14

状态：**B2 已验证完成（可信宿主贡献与状态兼容范围，桌面平台为 macOS）**。总体进度见 [实施计划](plugin-system-implementation-plan.md)。当前仍为可信宿主贡献机制，不是第三方加载/隔离运行或公开 SDK。

## 1. 文件事实与查看器选择分开

fileType 继续由现有 file-identity 与打开链路决定，不因安装或选择查看器而改写。`viewerRegistry` 为查看器提供稳定 id、标题、匹配条件和内部 View 入口；原 14 种类型通过既有 BuiltInDispatcher 适配，原查看器 props 与内部实现保持。

内置 ID 为 `omniflow.viewer.<kind>`，归档下划线转换为短横线。新增 ID 必须位于注册 owner 的命名空间。当前额外贡献仅匹配资料库中的 text/image/pdf/other；本机预览、外部 URL、媒体和归档继续走原内置路径。匹配使用已有 fileType 和可选扩展名集合，不在匹配时读取文件正文；MIME 尚未从打开链路向本 registry 投影，不能宣称已开放 MIME 条件。

内置适配批次由 registry 专门管理；热更新重复求值只替换自己持有的内置批次，旧 disposer 不会删除新批次，普通 registerBatch 的重复 ID 拒绝规则不变。此路径修复了实际开发验收中发现的 HMR 重复注册错误。

选择顺序：本次显式 viewerId → 已打开 tab 的选择 → 新打开文件时读取已保存的格式关联 → 原内置默认。registry 的候选按 ID 确定顺序；新注册的贡献不会自动成为默认。

有多个候选或所选贡献不可用时，分发器显示“查看器”选择框和“设为此类文件默认”。选择必须经 FileViewerContext.selectViewer，验证注册和匹配后，在同一个 tab 中更新 viewerId/generation。不存在第二套 tab owner；文件 tab ID 继续为 node:<id> 或 url:<url>。

## 2. 状态归属与持久化

| 数据 | owner / 存储 | 兼容规则 |
| --- | --- | --- |
| fileType / 文件引用 | 既有文件事实与 FileViewerContext | 不通过贡献匹配修改 |
| requested viewerId | 现有 tab 状态，可由 FileViewerOpenOptions 指定 | 旧 tab 不含此字段时采用内置默认 |
| viewerGeneration | tab owner | 显式切换时递增，促使旧视图卸载 |
| 按格式关联 | 本机 localStorage | 按账号和资料库隔离，不写节点 viewMeta |
| 阅读位置 | 既有 Warm/Cold owner | 额外 viewerId 加入 key，内置 key 保持 |
| 编辑草稿 | 既有 ViewerDraftStore | 本批不向额外贡献开放草稿能力 |

关联键前缀为 `omniflow:viewer-associations:v1:`，后接账号 scope 和资料库 ID。每个 scope 最多 256 个格式关联，格式键由 fileType 与末尾扩展名组成；读取长度超过 64 KiB 或损坏 JSON 时回退。已保存但未安装的 ID 保留，不能将临时回退自动保存为用户改选。当前只提供“设为此类文件默认”；选择内置查看器并设为默认即可覆盖旧关联，不提供跨设备同步。

registry/内部 View props 含 React 类型和宿主文件 URL，**禁止作为第三方 SDK 导出**。匹配限制与恢复 key 是组织规则，不是读取授权；C1/C2 必须用消息适配、真实身份和受控资源句柄提供权限边界。

## 3. 恢复标识与旧数据

`ViewerResourceKey` 新增可选 viewerId，viewerKind 仍使用原严格内置类型，未放宽为任意字符串。

- 旧内置资源 key 仍是 `[accountScope, libraryId, resourceIdentity, viewerKind]`，没有全库重写或 IndexedDB 表结构变更。
- 显式传入对应内置 ID 会规范化到同一个旧 key。
- 额外贡献 key 追加 viewerId，成为五字段 key；不同查看器即使匹配同一格式也不共享快照。
- 当前已有快照 envelope 的 schemaVersion/contentRevision 校验继续生效；版本不匹配只影响目标命名空间的 UI snapshot，不清理其他查看器或 Text dirty draft。
- key 的格式校验不要求贡献当前已安装，因此缺失插件的合法快照可以保留。真正执行与选择仍必须通过 registry，不凭一个持久化 ID 激活代码。
- 额外贡献使用宿主固定的 Warm memory / device Cold / 无草稿策略，继续受原快照容量、账号总量和保留期限制，不允许贡献自定无限保活。

`ViewerContributionContext` 是分发器到 useViewerSession 的可信内部投影，为 hook 绑定实际渲染的贡献 ID。回退到内置视图时使用内置 namespace，不能继续把内置状态写入缺失贡献的 key。直接使用底层存储的宿主代码仍须正确传入 identity；这不是隔离运行或文件写权限机制。

## 4. 切换、失败与清理

切换前捕获旧 live registration 的阅读位置；确认关联保存可成功后，才移除旧 live registration 并更新 tab。旧清理和 Cold 读取通过原 live key/generation 与卸载门禁失效；新视图获取新的 live 实例。媒体释放仍由 FileViewerContext 调用 globalAudioPlayer/floatingVideoService 的 releaseForTab，不让 viewer 自行操作 MediaHub。

Text 的原 dirty draft/hot-exit 语义不变，切换不会清除草稿。当前额外贡献不允许通过 ViewerDraftStore 继承 Text 的草稿写入策略；第三方文件写入权限仍未开放。

所选贡献缺失、不匹配或渲染异常时，保留 tab 文件引用、requested ID 和快照，回退内置视图并给出提示。渲染错误有边界；内置也无法显示时提供原始文件访问入口。该边界能处理 React 渲染异常，不能停止同 renderer 死循环，不能冒充后续插件故障隔离。

冷热淘汰比较实际 live viewerId，防止同 kind 的另一查看器快照被当作已捕获状态。删除节点时，在原内置枚举之外补充已知 Warm/live 命名空间，并扫描该账号/库的 Cold 记录清理对应节点，包括未安装贡献的状态；同时取消相关待写入快照。其他账号、库、节点不受影响。

## 5. 验证与限制

自动验证覆盖：内置 key 不变、同格式两贡献隔离、schema/version 不匹配、无插件时保留关联、跨账号/库的 key 区分、缺失贡献 Cold 清理、同 tab 切换与 generation、移除后回退和重新注册后的恢复。集成测试使用真实 registry、FileViewerContext、分发器和 useViewerSession，重型内置 viewer 和磁盘 Cold 接口采用隔离替身；不能替代真实查看器的桌面回归。

本批不随应用加入新的业务查看器，新增候选通过隔离注册样板验证；真正独立构建的 CSV 样板按 C1/C2 推进。当前没有第三方安装、授权、隔离宿主或文件写入 SDK。

最终检查：`npm run lint`、`npm test`、`npm run build` 均退出 0，测试 364 文件/2510 项通过，3 文件/7 项跳过。旧 Session、DraftStore 和 A0 固定 fixture 继续通过；渲染异常回退及 HMR 替换各有新增回归。

实际桌面验收使用第三个 win 资料库，未进入第一个资料库：

| 场景 | 结果 |
| --- | --- |
| 原默认文本预览 | 合成文本正常加载，正文 alpha/beta/gamma、UTF-8/LF 和保存禁用态保持 |
| 重复打开 | 同一文件仍只有一个 tab，没有自动采用其他贡献 |
| 关闭与重开 | tab 可关闭并重新打开，阅读位置可恢复到文本末尾附近，未改写正文 |
| 两个文件切换 | 两个合成文件形成独立 tab；切回第一份时读取位置仍为 2:3，第二份初始位置为 1:1 |
| 原布局 | 完整重载和窗口重绘后，原文本编辑器和底部工具区显示正常 |
| 清理 | 已关闭验收文件 tab，确认暂无打开的文件，关闭开发工具并恢复原窗口尺寸 |

桌面验证期间发现 HMR 重复注册内置 ID，已修复并经完整页面重载验证。窗口截图/无障碍树曾出现刷新不同步，通过原生窗口重绘重新核对；没有把旧截图当成新状态证据。额外贡献的同 tab 选择、缺失/异常回退、schema 和命名空间隔离通过受控集成测试验证，本批没有把测试 View 发布为用户业务功能。

Windows/Linux、真实第三方隔离、远程授权、任意文件写入和完整业务负载性能仍未验证或未开放，按 C1/C2 及后续阶段推进。继续遵守非第一个资料库规则，不通过删除真实资料库内容验证清理。
