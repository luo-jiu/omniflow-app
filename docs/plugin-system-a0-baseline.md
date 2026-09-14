# 插件化 A0 基线与首批契约

更新时间：2026-09-14

状态：**macOS 基础基线已收口**。已具备静态契约、兼容 fixture、真实编译主程序的隔离加载/空闲样本、组件交互与 80 轮资源趋势，足以继续 A1。测量范围和限制见第 6 节；不宣称已完成真实业务 I/O 或 Windows 性能验收。

执行入口：[插件化实施计划](plugin-system-implementation-plan.md)。本文件保留 A1 接入前的基线及后续补测；A1 当前实现见 [外观系统](appearance-system.md)，第三方插件执行和安装仍未开放。

## 1. 基线版本与验证范围

- 开始时提交：`460c6dd54784dbbe2aad8acee163521187053259`，初始 `git status --short` 为空。
- 环境：macOS 26.5.2、arm64，Node v25.5.0，npm 11.8.0，应用 0.2.2。
- 初始检查：lint 退出 0；测试 349 文件/2374 项通过，3 文件/7 项跳过，总耗时 27.50 秒；build 退出 0。Vite 有大 chunk 提示，不是本批新增失败。
- 加入本批工具和 fixture 后复验：lint 通过；测试 350 文件/2380 项通过，3 文件/7 项跳过，总耗时 40.91 秒；build 通过。新增 6 项测试全部通过。两次测试耗时不同，不据此推导应用性能回归。
- 继续推进后的全量测试：351 文件/2403 项通过、3 文件/7 项跳过；build 通过。初次 lint 发现独立 fixture 的 Fast Refresh 导出警告，修正后 lint 通过；没有降低 lint 门槛。
- 测试耗时属于测试 runner，不是应用启动性能。构建成功不代表打包/签名或 Windows 支持通过。
- 当前其他 agent 可能修改工作区，后续比较必须记录差异范围，不能将并行改动导致的指标变化全部归因于插件工程。

## 2. 可复用兼容样本

固定数据：[legacy-v1.json](../tools/plugin-baseline/fixtures/legacy-v1.json)。测试入口：[legacy-compatibility.test.ts](../tools/plugin-baseline/legacy-compatibility.test.ts)。所有账号、库、节点、正文和 URL 都是合成内容；不会发请求或写真实浏览器存储。

这些记录在插件迁移之前固化。后续不得用新版 serializer 重新生成旧记录以让测试通过；兼容行为发生变化时，增加显式迁移测试和新版本 fixture，保留原记录。

| 样本 | 当前验证的兼容结果 |
| --- | --- |
| 历史 user.ext 主题 | dark 模式仍被正确读取 |
| 工具布局与排序 | 保存顺序和宽度恢复一致 |
| 字幕草稿 | 原文/译文保留，旧 translating 状态恢复为 idle |
| 旧 tab | URL/revision 更新保持节点身份与单 tab，不修改输入记录 |
| Warm snapshot | 原资源 key 可读，另一个账号不能命中 |
| Cold 持久记录 | 直接读取固化 envelope，无需重写；另一个资料库不能命中 |
| Text dirty draft | 重建存储实例仍保留正文和原 revision，另一个账号无法读取 |

当前 6 项测试通过。Warm 检查使用真实 registry；Cold/draft 使用真实存储解码器和内存 persistence，**未验证浏览器 IndexedDB 的真实磁盘升级**。旧 tab 检查覆盖资源更新适配，未替代完整 Provider 挂载、关闭和草稿回收回归。现有领域测试继续保留。

运行方式（项目根目录）：

```bash
npx vitest run tools/plugin-baseline/legacy-compatibility.test.ts
node tools/plugin-baseline/appearance-inventory.mjs > /tmp/omniflow-plugin-appearance-inventory.json
```

## 3. 外观消费面与迁移清单

工具：[appearance-inventory.mjs](../tools/plugin-baseline/appearance-inventory.mjs)。输出相对文件路径、行号和 token 引用，不采集运行账号、正文或凭据。扫描 `src` 的 TS/TSX/CSS/LESS，跳过测试和 SVG 图标目录；这是词法候选清单，不计算 CSS cascade，也不把颜色候选数当缺陷数量。

本轮结果：`reset.less` 定义 21 个 `--app-*` token；源码出现 26 个不同 `--app-*` 名称；颜色属性上下文中的硬编码候选共 423 行。后续动态样式、CSS 继承和 JS 生成颜色仍需人工补查，源码中出现的额外 token 不直接等同于未定义变量。

| 消费面 | A1 处理方式 | 保留边界 |
| --- | --- | --- |
| 主壳/树/tab | 保留现有 `--app-bg`、panel、text、border 语义；新增明确交互状态 | 不改变工作区模式、尺寸和原生透明策略 |
| 菜单/表单/Semi | 把 primary hover/active、fill、焦点、禁用和危险态接入解析适配 | 不改既有业务动作和点击热区 |
| 目录图标/归档 | 语义与资产拆分；归档独立颜色 | expanded 仍由树 owner 提供，警告装饰仍由宿主叠加 |
| 编辑器 | CodeMirror 使用同一解析结果，光标/选择/语法色分别定义 | 不改文件正文、dirty draft 或编辑器布局 |
| overlay | 主主题快照初始化、更新和重连 | 本地 storage 只作旧模式兼容，不作为新同步协议 |
| 原生背景/标题栏 | main 消费有限原生投影 | macOS vibrancy 和透明 overlay 保留；Windows 单独验收 |
| 媒体查看器/PiP | 检查控制层硬编码和独立窗口适配 | 内容像素、用户图片/视频/网页不参与全局重着色 |
| 登录品牌画面 | 首批只覆盖共享控件与基础可读性 | 品牌装饰暂不承诺完整主题替换，不能阻挡故障恢复 |

候选较多的文件包括 video-viewer/style.ts（58 行）、reset.less（22 行）、image-viewer/style.ts（18 行）、video-archive-viewer/style.ts（17 行）、gallery-viewer/style.ts 和 library/detail/layout-styles.tsx（各 15 行）。迁移按语义和界面分批，不机械替换所有颜色。

## 4. A1 首批契约决策

以下为确定的实施约束，字段最终类型与 schema 在 A1 随代码冻结；本批没有创建生产 API。

### 4.1 偏好、预览与账号

1. 明暗模式、颜色主题 ID、图标包 ID、用户 token 覆盖分别保存，不把图标包塞进 `ThemeMode`。
2. 旧明暗模式继续兼容 `user.ext.omniflowPreferencesV1.theme` 和 `app-theme`。新增外观选择先采用设备上的账号隔离存储；匿名登录界面使用单独设备选择。跨设备同步不在 A1 隐式承诺，未来接入同步偏好必须单独迁移。
3. 安装资产是设备事实；账号保存的包 ID 是选择意图。包缺失时渲染内置回退，保留原选择意图，不能把缺包导致的回退自动同步成用户改选。
4. 登录/切账号初始化只对当前账号和当前请求 generation 生效。初始化开始后的本地用户选择不能被旧加载覆盖；设置页和旧设置路由使用同一个更新适配。需收敛目前 `UserPreferencesBootstrap` 因 theme 改变重新投影旧 user.ext 的路径。
5. 预览只作用于内存快照，不写持久偏好；取消恢复最新已提交选择；确认才保存。退出/换账号终止旧预览并忽略旧保存结果。保存失败明确提示并按当前操作 generation 回退，不覆盖更晚选择。
6. ThemeContext 保持 owner；底层 resolver 为纯函数，snapshot revision 单调递增。主 renderer 重建时通过新的 owner epoch 区分重置后的 revision，消费者不能只比较一个从零开始的数字。

### 4.2 Token、图标与同步

- 既有 21 个 token 作为兼容映射保留；首批增量语义覆盖：悬停/按下/选中、焦点/禁用、成功/警告/危险/信息、归档、编辑器颜色。完整字段表在 A1 实现前列出默认值、合法值与回退策略。
- 颜色 schema 只接收允许的颜色值，阴影和圆角使用单独受限类型；不接受任意 CSS、url、选择器、脚本和变量注入。未知字段诊断，非法已知字段拒绝；整包校验失败不部分发布。
- 主 owner 发布完整快照；main 只验证可信主来源、缓存和转发，不成为第二套解析 owner。消息含 owner epoch/revision，overlay 和插件重连首先索取完整快照。
- 初始内置兜底可在快照到达前显示；消费者收到快照后仅应用解析结果，不自行补出另一套主题。首次闪烁、系统变化和原生投影在真实窗口验证。
- 文件语义 → 图标资产 → 宿主装饰的顺序固定；缺少展开资产时先用同语义闭合资产，再用内置对应状态兜底。错误/离线提示不可被包资产覆盖。

## 5. B1 首批契约决策

- 初始菜单位置限定为工具导航和目录菜单；命令参数使用宿主定义的有限 schema，不开放任意 JS 条件。
- 内置命令 ID 与插件命名空间分开；旧中文动作通过内置 adapter 映射，展示文案变化不改变 ID。
- 初始插件可调用命令只允许已开放的只读查看器打开和受控宿主界面；重命名、删除、上传、外部工具执行等旧菜单动作即使有注册项也不自动进入 SDK。
- 排序数据保留格式合法但暂不可用的贡献 ID；可见列表由注册表投影。未知 ID 不成为可执行目标，重新安装/启用后可恢复位置。
- 注册加载预检重复 ID 和 schema，一批贡献原子发布；失败清理本批资源，保留原注册表。
- 系统设置与插件管理属于宿主，不能被普通业务插件停用；插件管理与外观设置的页面交付已明确写入 D1。

## 6. 本轮桌面观察与剩余门禁

通过 CUA 确认资料库列表顺序后，选用第三个 `win`，未进入第一个资料库。该库已有合成文本能够实际读取，界面与测试记录不包含其签名链接或凭据。

已观察：

- 从资料库列表进入 win，目录树和工作区可用。
- 打开已有三行合成文本，显示 alpha/beta/gamma、UTF-8 和 LF，保存按钮处于禁用状态；没有编辑或写入正文。
- 从文件查看器切入宿主设置，主题模式可切换：系统 → 夜间 → 系统 → 白天 → 系统，最终恢复原模式。
- 白天设置和树可见；文件查看器的暗色基线可见。
- 文本右键弹出独立 Overlay 菜单，Escape 取消返回主窗口；未执行菜单中的修改动作。
- 从设置返回文本 tab，正文仍保留且保存禁用；关闭本轮文本和设置 tab，界面回到无文件打开状态。此项只证明可见状态，不等于底层全部资源已回到空闲基线。

这些是现有开发会话的行为观察，不是隔离冷启动性能证据，也不证明未检查的存储配置或跨平台支持。

### 6.1 可重复的隔离组件测量

执行 `node tools/plugin-baseline/run-runtime.mjs`。runner 单独构建测试入口到临时目录，启动 5 个独立 Electron 进程，每次使用全新 userData/sessionData；只运行合成组件，不复制认证状态，不访问真实资料库，网络和浏览器权限默认拒绝。产物不写入应用 dist，不影响现有 dev 会话。超时终止本次子进程，结果保留在 runner 返回的目录中。

场景：50 个目录 × 每目录 20 个文件（总 1050 节点），使用 Semi Tree、真实文件图标解析、现有 ThemeProvider、CodeMirror 和 DirectoryContextMenu；文本 2000 行。每进程空闲 5 秒（采得 4 个整秒空闲样本），执行 10 轮展开/滚动/打开/切换/主题/菜单/关闭。窗口隐藏、外框 1120×720、实际内容区 1120×692、zoomFactor=1，Electron 30.5.1 / Chromium 124.0.6367.243，关闭后台节流。

计时从 React 同步更新前开始，到两个 animation frame 回调后结束；包括帧等待，不是纯 CPU 时间或真实用户输入到屏幕呈现延迟。启动从进程 spawn 到 fixture ready 消息；fresh userData 不等于清空操作系统文件缓存。不能据此声称完整 OmniFlow 登录/主壳启动性能，也不能代替原生 overlay、应用 DirectoryTree 虚拟化、真实 TextViewer 或 FileViewerContext 的全链路测量。

原始数据：[自然回收基线](../tools/plugin-baseline/evidence/component-baseline-macos.json)、[结束后 GC 诊断](../tools/plugin-baseline/evidence/component-baseline-macos-gc.json)。前者中位数算法取排序后中间上侧样本，后者已改为偶数样本取中间两项均值；后续统一使用后者算法，不混合两组数值。GC 仅在全部操作计时与根组件卸载后执行 3 次，用于诊断，不在操作计时中主动 GC。

| 项目 | 自然回收组中位数（ms） | GC 诊断组中位数（ms） |
| --- | --- | --- |
| fixture 进程启动到 ready（5 次） | 351.1 | 316.3 |
| 展开 20 个目录（50 次） | 31.1 | 30.9 |
| 树容器滚动 | 12.7 | 12.0 |
| 挂载 2000 行编辑器 | 23.2 | 20.9 |
| 切换编辑器实例 | 22.1 | 20.4 |
| 切换暗色 | 59.8 | 52.2 |
| 切换亮色 | 72.7 | 64.4 |
| 挂载目录菜单组件 | 60.7 | 54.7 |
| 卸载编辑器/菜单并折叠树 | 13.1 | 12.7 |

回收观察：每次根组件卸载后编辑器 DOM 数为 0；独立 Session registry 的合成 snapshot 在 disposeLibrary/disposeSession 后为 0。fixture 的 CodeMirror 没有接入真实 TextViewer live registration，不能把该结果当成真实 viewer 资源全部回收证明。

自然回收组空闲总工作集约 351～353 MiB，循环后升到约 638～806 MiB。诊断组 JS heap 从约 6.7 MiB 开始，操作后约 15.0～27.1 MiB，结束 GC 后约 7.5～7.8 MiB；进程总工作集仍约 679～950 MiB。JS heap 回落说明大部分 JS 分配可回收，但不能解释完整工作集增长，**尚不能下无泄漏结论**。后续需区分 renderer/native/GPU 缓存及保留对象，在相同组件与真实主壳分别测量；本批不把 RSS 增长误判成已经定位的生产泄漏。

### 6.2 真实主程序与长循环补测

`node tools/plugin-baseline/run-full-host.mjs` 使用实际编译的 dist-electron/main.js，ESM 引导在 app ready 前设置独立 appData，避免触及正常登录态。每次新建 userData，未登录、未访问资料库；5 次入口到主文档 did-finish-load 的中位数为 417.3 ms，每次再采集 5 个整秒的进程资源样本。[原始数据](../tools/plugin-baseline/evidence/full-host-macos.json)。该时间不含进程创建前开销，也不等于登录页可交互完成时间。

`OMNI_BASELINE_CYCLES=80 node tools/plugin-baseline/run-runtime.mjs` 延长组件循环并分进程记录：[80 轮原始数据](../tools/plugin-baseline/evidence/component-baseline-macos-80cycles.json)。工作集主要增长来自 renderer：总量第 20 轮 811328 KiB，第 40 轮 818272 KiB，第 80 轮 828352 KiB；20～80 轮约增长 2.1%，已经明显趋于平台。Browser/GPU/Utility 进程大致稳定。结束 GC 后 JS heap 为 9058712 字节（约 8.6 MiB），编辑器 DOM 为 0，合成 registry 无残留。

这组证据支持在当前固定样本中“前期分配后趋于稳定”，不要求 RSS 回到起点，也不宣称已排除所有原生缓存/长时间业务泄漏。A0 以可复现基线、实际路径观察和有界趋势收口；真实业务 I/O 延迟、原生 overlay 的输入到绘制时间和插件实例性能预算在 C1 用真实样板继续测量，不用组件数字冒充。

A1 接入后还记录了 [主程序诊断样本](../tools/plugin-baseline/evidence/full-host-macos-a1.json)：入口到主文档加载中位数 340.4 ms，末次采样约 630208～633888 KiB。该补测发生在 Mac 锁屏期间，与先前前台环境不完全一致，因此不据此宣称启动提速或性能验收通过。

macOS 实际工作区行为见前节与 [A1 验收记录](plugin-system-a1-acceptance.md)；Windows/Linux、生产签名包和完整用户负载均不在此次基线通过范围。

## 7. 维护规则

本记录保留可重现基线、冻结的旧数据、决策和未验证项。自动检查原始日志本轮位于临时目录，长期事实以上述版本、计数及后续验收记录为准；需要跨机器对比时将脱敏的性能原始数据加入专项记录，不保存用户内容或认证信息。

完成 A0 时同步主计划与交接索引；后续迁移若改变这些决策，先解释兼容影响并更新本记录，不能仅让 fixture 跟着新实现变化。
