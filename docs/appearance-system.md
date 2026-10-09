# 外观系统：主题、图标与跨窗口快照

更新时间：2026-10-02

适用范围：内置外观选择、主窗口、设置、目录树、CodeMirror、overlay 与隔离插件颜色快照。颜色与图标贡献当前仅支持随应用交付的内置项；功能插件的安装、执行另见 D1 及后续专题，不等于已支持第三方外观包。

视觉目标、代表样板和页面类型推广顺序见[主题视觉设计与推广计划](theme-design-and-rollout-plan.md)。通用表面、文字、交互、归档高亮与新旧页面接入入口见[通用主题基础](theme-foundation.md)，逐类源码范围与例外见[覆盖地图](theme-adoption-map.md)；全页面迁移尚未完成。

## 1. 当前入口与能力

现有工作区「设置」和兼容 `/settings` 页面均包含「外观」区域。颜色主题为森林/海蓝/紫罗兰，目录图标为彩色文件夹/线条文件夹，两者独立选择。默认仍为森林（`omniflow.default`），新增紫罗兰（`omniflow.violet`）不会迁移或覆盖已保存选择。还可覆盖强调色，预览、保存、取消或恢复默认；恢复默认先进入预览，不自动覆盖已保存选择。

设置中的三个字段明确区分作用：界面配色切换背景和交互颜色；目录图标只切换目录类资产，普通文件图标保持原有解析；强调色仅覆盖 `accent.default`、`text.link`、`focus.border`，悬停、按下和浅色背景等仍使用配色自身的值，不自动生成整套颜色。字段旁提供对应说明，明暗模式引导到下方「界面主题」。修改立即预览，保存仅保留于本机当前账号；取消或离开页面恢复已保存选择。

明暗/系统模式继续使用现有主题按钮。外观预览期间切模式也属于同一预览事务；取消恢复原模式和外观。普通模式切换仍走原用户偏好保存入口，预览中的模式切换不提前写旧云端偏好。

外观 UI 不保存第二份选择对象，直接使用 owner 的 requested 投影，仅保存本页面预览 token 和错误提示。页面卸载会取消自己尚未保存的预览；过期 token 不能取消另一个事务。保存失败显示错误并恢复上次保存值。

### 1.1 界面配色的实际影响范围

2026-09-23 按内置配色、适配器和代表性消费组件核对源码。以下是当前实现范围，不是全页面视觉验收结论。

“切换明暗”和“切换配色”影响不同。森林使用完整默认值；海蓝在亮色覆盖 12 个、暗色覆盖 19 个颜色项，其余继承该明暗模式的默认值。新增紫罗兰分别显式定义亮暗全部 67 个颜色项，包括透明侧栏、文字、边框、选中状态、状态提示和编辑器；这表示配色数据完整，不表示所有组件已经消费所有项。森林/海蓝原有 62 个颜色值保持不变，新增导航和选中控件语义使用历史紫色/蓝色默认值。用户自定义强调色覆盖优先于内置配色，切换配色不会自动清除已有覆盖。

| 可见区域 | 当前影响与边界 |
| --- | --- |
| 右侧工作区、顶栏、设置、Agent、工具页主背景 | 使用 `surface.app`，亮暗两种模式都会变化。 |
| 面板、输入区、菜单、未激活 tab | 消费 `surface.panel/elevated/input/popover` 等角色；紫罗兰定义独立层次。旧海蓝在暗色下变蓝灰，旧亮色两套仍共用部分白底。并非所有控件状态都已接管。 |
| 主色按钮、链接、焦点、tab 边框、Agent 用户气泡 | 使用强调色及链接/焦点颜色的部分会变化；自定义覆盖可能保留用户选色。 |
| 工作区激活导航、目录树和各 tab/工具的选中底色 | 导航消费 `navigation.active`；选中控件消费 `control.selected.background/hover/active`，Semi 对应浅主色三态也由这些项适配。旧森林/海蓝保留原紫色导航和蓝色选中底色，紫罗兰统一为自身紫色层次。 |
| 普通文字、灰图标、普通边框、滚动条、成功/警告/危险色 | 紫罗兰定义对应角色；森林/海蓝仍沿用原有相同明暗值。未变色不等于未接入，状态色也不会被统一替换成主色。 |
| 归档目录文字 | 使用独立 `folder.archive.label`，会变化；目录与文件图标素材不由界面配色替换。 |
| 文本编辑器 CodeMirror | 背景、正文、gutter、光标、选区、当前行及语法色消费统一角色；紫罗兰提供完整编辑器配色，旧森林/海蓝保留原来的共用语法色。 |
| 图片、漫画、视频、PDF、网页内容 | 图片外围跟随背景；漫画外围有主题底色和固定绿色光晕。视频黑底、PDF 深灰舞台/白纸有自己的样式；图片像素、文档原色、网站页面不做全局重着色。 |
| 归档卡片和视频普通工具台 | 四类归档共用页面、状态与底栏规则；漫画/视频/ASMR普通卡片表面及信息区跟主题，图库保留自身封面结构并接主题边缘。封面遮罩与其配对文字、用户标签及媒体徽章保留。视频字幕工具台的表面、来源选中三态及错误提示已接共享语义，视频覆层与字幕模拟保留专用黑白。 |
| 资源监测图表 | 轴、网格、文字与tooltip直接消费只读主题快照目标色，不从DOM动效中间帧取色；分类调色板保留，Canvas不承诺逐帧主题插值。 |
| 隔离插件页面 | Viewer/工具工作区通过同一适配器下发完整67色快照。插件须主动消费；JSON转换样板和CSV Viewer/CSV Tool附带Viewer、JSON树、漫画样板及只读开发模板的源码均已接各自需要的表面、文字、边框、按钮/焦点/错误和滚动条。旧安装包不会因宿主改动自动得到新的CSS。 |

已确认的覆盖缺口与独立策略：

- 新增 `accent.foreground` 用于主色底上的可读前景。共享 CSS 已接入非禁用的 Semi 主色实心按钮、选中 checkbox/radio 标记；Agent、插件命令、浏览器资源、下载和视频倍率等直接绘制的主色按钮也消费同一角色。不得通过修改全局 `--semi-white` / `--semi-color-white` 改写危险按钮或其他白色表面。Semi 焦点边框也映射 `focus.border`，不再固定使用组件库蓝色；Switch 的启用态继续使用成功语义。
- Semi 的 `--semi-color-bg-3` 已映射 `surface.popover`，覆盖下拉、Popover/箭头、日期面板及通知表面；`bg-4` 映射 `surface.elevated`。禁用文字/边框/背景/填充也映射现有语义，避免默认灰色脱离主题。其他状态交互变量尚未逐项适配，配色默认值与控件接入仍须分别核对。
- macOS 目录树侧栏由原生 `sidebar` vibrancy 单独呈现，renderer 不再叠加 `surface.sidebarVibrancy` 主题色，避免目录名称被主题色污染；Windows 使用 `surface.sidebar` 实色回退。其他工作区若确实需要主题投影，仍须使用低不透明度变量并保留原生材质，不能提高叠层不透明度遮住透色。
- 目录树拖入背景已消费 `accent.soft`；Agent 回复的代码语法色通过内部 `--app-agent-syntax-*` 变量保留原亮暗值，参加统一切换动效，但仍不由配色包自定义，也不扩充 67 个主题颜色 token。部分媒体工具分类色与漫画光晕尚未接入对应语义项。图片像素、PDF 原文和网站内容保留原色。

本轮收口宿主背景、导航、选中/悬停/按下/焦点、输入/菜单及插件快照；自动检查和 macOS 代表性界面验证见本文第 6 节。维护时区分“配色给了相同值”“组件尚未接入”和“内容保留原色”，避免只按是否变色判断覆盖。

核查入口：`built-in-themes.ts`、`color-theme.ts`、`theme-adapters.ts`、`theme-view.ts`；消费面包括 `library/detail/layout-styles.tsx`、`FileTabsBar.tsx`、目录树样式、`AgentWorkspace` / `AgentTimeline` / `AgentMessageContent`、工具工作区、各 viewer 及 `PluginWorkspace`。调整上述定义或适配范围后同步更新本表。

## 2. 唯一 owner 与存储

`src/contexts/ThemeContext.tsx` 持有唯一 `ThemeState`，使用 [纯事务模型](plugin-system-a1-state-and-icons.md)。ref 仅用于同步派发时读取同一个最新模型，不额外保存派生业务状态；React updater 内不执行持久化或 IPC。

模型 → `createThemeSnapshot` → 有限 `ThemeView` → DOM、Semi、styled-components、编辑器和 IPC。`AppearanceViewContext` 是只读投影，`AppearanceControlContext` 提供预览/确认/取消与账号绑定；都不自行成为 owner。

- 本机键：`omniflow:appearance:v1:anonymous` 或 `omniflow:appearance:v1:user:<id>`，保存完整已确认选择。
- 初始化读取合法本机记录；缺失/损坏时回退。首次进入账号没有记录时，沿用旧 `user.ext` 的明暗偏好；已有本机外观记录优先，当前不承诺跨设备外观同步。
- `UserPreferencesBootstrap` 只在真实账号切换时绑定 scope，旧 user.ext 刷新不会把已选外观覆盖回去。
- 预览不写任何存储。确认由 service 写当前 scope，成功后才推进 committed；quota/存储异常回退。
- `app-theme` 继续作为匿名登录页旧模式兼容投影；账号外观不再通过该全局键向其他窗口同步。
- 账号切换取消旧预览/请求，重新读取当前账号记录；本机存储原记录保留，不复制到另一个账号。
- 包 ID 缺失时保留选择意图，渲染默认并在设置提示不可用。图标 fallback 同理。D1 已提供功能插件安装/卸载，但第三方颜色主题和图标包仍未接入安装目录。

## 3. 主题应用

系统默认 → 当前明暗变体 → 用户覆盖。颜色、效果和原子拒绝规则见 [外观解析契约](plugin-system-a1-color-contract.md)。内置目录中的 name 是显示元信息，不进入主题 schema 校验对象。

`applyThemeView` 在 layout effect 中设置 body 的 theme-mode/theme-source 和受限 CSS 变量。原 `--app-*` 名称继续保留；Semi 只消费适配结果。`src/main.tsx` 已移除独立的静态 styled-components ThemeProvider，改由 ThemeContext 提供解析后的 styled theme；旧 mixin 保留，旧颜色不再是权威来源。

全局 `body *` 不再强制写文字颜色，以免覆盖菜单危险态和控件内部的继承；body 自身仍提供默认文字色。归档文字使用独立 `--app-folder-archive-label`，不再借用 success 色。

基础UI通过`theme-foundation-styles.ts`消费表面、文字及交互角色，原生组件入口为`theme-foundation.tsx`。目录树原有选中class复用共享选中三态；名称通过`ResourceLabel`独立展示归档色，允许归档和选中同时存在。全局`::selection`使用文字划选专属角色，与行选中背景分离；编辑器保留更具体的选区样式。「设置 → 外观 → 主题预览」提供长期样式对照，在设置内部按需打开；切换只作预览，返回恢复已保存外观。详细接入、Semi范围及样板见[通用主题基础](theme-foundation.md)。

TextViewer 将外观扩展直接交给 CodeMirror 的 theme 属性，覆盖背景、gutter、光标、选择、当前行和语法颜色；扩展消费 `--app-editor-*`、`--app-syntax-*` 等 CSS 变量，随宿主同一帧的颜色变化，不再把静态解析色直接写入编辑器规则。字号/换行/文档/草稿 owner 不变。独立原生窗口不从 renderer 直接导入 React 状态。

共享消费已扩展到菜单普通/危险/禁用态、工作区设置分类与管理按钮、插件管理/命令/M2宿主审批区、工具导航/路径输入/字幕操作以及上述归档和视频侧栏。`inputAppearanceStyles`供旧输入保留尺寸，outline按钮供描边管理入口；均只消费既有67色，不增加主题owner或schema。具体子状态与未迁移项按覆盖地图核对，不外推为整页完成。

`npm run theme:audit`检查`src`未定义的静态app变量，带fallback的错名同样报告。本轮修正插件管理/Agent附件的不存在danger变量和资源组成页的不存在bg-base变量；固定色候选只作调查线索。检查边界与源码输出用法见通用主题基础，不替代样板和真实消费者的视觉验证。

### 3.1 同一文档内的统一颜色动效

`theme-dom.ts` 将主题颜色及 Semi、Agent 语法等内部投影注册为 `syntax: '<color>'`、`inherits: true` 的 CSS custom properties。配色变化时，在 body 上创建一个 `200ms ease-in-out` 的 Web Animations API 动画，后代直接继承同一帧的变量值；不让每层文字各自执行 `color` transition。背景、边框、文字及颜色中的 alpha 都沿同一时间轴变化，macOS 原生 vibrancy 的启用与材质策略保持不变。

- 动画期间，body 的 `data-app-theme-transition` 临时禁止其自身、后代及前后伪元素的 CSS transitions，防止组件对正在变化的颜色再执行一次渐变。CSS animations 不受影响；当时正在进行的局部 transition 会立即到达其目标，并不是暂停后续播。结束时先确认目标样式已落地，再移除属性，恢复组件交互动效。
- 快速连续切换先读取 body 当前 computed 颜色，以当前显示色作为新动画起点，再取消旧动画。完成回调只清理仍由自己持有的动画，旧回调不能移除新动画的抑制属性。
- source、revision 或预览阶段变化但颜色未变时，只更新主题投影，不重新开始或打断动画。首次应用、`prefers-reduced-motion: reduce`、注册/动画 API 不可用或动画启动异常时直接应用目标颜色，并在临时禁止组件 transition 的边界内结算样式。
- 主主题 owner、overlay 卸载与开发 HMR 会取消现有动画并清理临时属性。动画只是展示状态，不保存另一份业务主题选择。

统一动效覆盖当前文档内消费这些变量的组件。overlay 使用同一机制，但收到 IPC 后按自己的时间起点执行，不承诺跨窗口逐帧同步；隔离插件 WebContentsView、网页和原生系统材质不受此 DOM 动画控制。固定颜色或媒体内容原色也不会被强制改色。

本次动效已通过 `lint`、全量测试（425 文件、3313 项通过；3 文件、7 项跳过）与 `build`。真实 Chromium 临时探针采样 48 帧，16 层嵌套文字、次级文字和面板颜色与同帧对应变量的不一致次数为 0，观察到中间插值色，最终到达目标且清除临时属性；在 85ms 处反向切换保持颜色连续，随后正常完成并清理。macOS Electron、Win（libraryId=3）实际预览紫罗兰明暗切换，设置标题、说明、分类导航、标签和目录文字在切换后均可读，未见此前数秒逐层补色，取消后恢复森林＋跟随系统。逐帧定量证据限定于探针场景；未逐页手验编辑器、Agent 代码块、overlay 或隔离插件。临时探针已清理。

## 4. 跨窗口 IPC

| channel | 方向 | 权限与语义 |
| --- | --- | --- |
| appearance:claim | 主 renderer → main | 仅主窗口 main frame；建立当前 owner epoch |
| appearance:publish | 主 renderer → main | 同一主 frame、匹配 claim、完整合法 payload、递增 revision |
| appearance:get | 主窗口或 overlay → main | 仅明确的主窗口/overlay main frame；返回缓存完整视图 |
| appearance:changed | main → overlay | 转发已验证的新快照 |

preload 暴露类型化 `electronAppearance`，页面通过 `src/service/appearance/appearance.api.ts` 使用。该 preload 仍是可信宿主能力，不得提供给第三方代码。

ThemeView 仅包含 schemaVersion、ownerEpoch、revision、mode/source、iconThemeId、完整颜色和受限效果，不含账号、文件、认证或存储路径。main 校验完整字段和色值，只缓存/转发，不重新解析主题包。导航重置 claim/cache；新 claim 使旧 epoch 失效，旧 revision 不广播。

overlay 首次挂载先用内置模式兜底，再订阅并索取完整快照。收到事件后，迟到的 get 结果不能覆盖新事件；同 epoch 只接受更大 revision。重建 overlay 再次 get。取消订阅、主窗口销毁和导航有清理，不依赖共享 localStorage。

main 将 source 投影到 nativeTheme；非 vibrancy 主窗口使用解析后的 app 背景，并在 nativeTheme 更新时保持该投影。macOS vibrancy 主窗口和 overlay 的透明策略不变。Windows 配置保持共用实现，但本次未进行 Windows DPI/安装包视觉验收。

### 4.1 隔离插件颜色投影

Viewer 与独立工具工作区共用 `toPluginThemeSnapshot`，从同一 `ThemeView` 复制完整颜色；SDK 形状仍为 `{ schemaVersion: 1, revision, mode, colors }`，不增加权限、不下发账号信息，也不把内部 ownerEpoch、图标资产和效果混入插件协议。插件从初始 context 和后续 theme 事件读取颜色，不能修改宿主主题。插件即使拿到完整颜色也需要自行应用，宿主不会向隔离页面注入全局 CSS。

只读开发模板与CSV/JSON树/漫画样板通过本包外链CSS规则的CSSOM映射接主题；`data-theme`选择亮暗fallback与原生控件color-scheme。应用新revision前恢复两套原始默认值，完整快照切回缺字段快照时不沿用旧颜色。各包保持独立，不引用宿主React或其他样板运行时；读取/恢复/权限和SDK契约保持原样。插件作者用法随[开发包主题说明](../templates/plugin-kit/README.md#主题接入)交付。本轮只核验源码与独立构建，未更新用户已安装版本；重建/更新后仍需真实隔离页面视觉核验。

JSON 转换样板源码更新后须重新构建并更新开发加载/安装包才会使用新版 CSS；目前仅源码接入，不代表旧安装样板已经刷新，也不代表所有第三方界面已适配。

## 5. 图标与 SVG

目录事实识别和 expanded owner 不变。Semi Tree 的全局 icon 运行时校验仅接受 ReactNode；目录图标作为节点 icon 元素提供，使用现有 expandedKeys 的只读 Context 投影更新开合，不向 Tree.icon 传函数，也不因展开重建 treeData。`getDirectoryBuiltInIcon` 先取得纯语义，保留未知类型警告及 DEF+archive 的既有特殊返回，再由 `ThemedDirectoryIcon` 消费只读图标选择。子菜单对图标尺寸/style 的 clone 仍透传到 img。

彩色和线条两套目录图标均按内置类型及闭合/展开状态选择资产；同一内置类型开启归档后继续使用原图标，不再选择 `-archive` 变体。归档名称保留独立 `--app-folder-archive-label` 文字色及既有字重，图标不附加归档角标。默认彩色文件夹的闭合、展开两态均已去除右下黄色矩形块。目录树、标签页、菜单和属性弹框复用同一解析入口，主题预览也使用相同的普通目录资产。

两套目录包中的历史 `-archive` SVG 暂时保留，线条包仍有 22 个目录 SVG。纯语义解析继续保留归档事实和宿主 warnings；普通文件类型仍继承原有 material 资产。开态缺失先用同包闭态，再回退原内置资产；不改节点类型、树数据或打开行为。错误、离线等宿主状态装饰不被新资产替代。

`validateIconSvg` 接受有界声明式子集：最大 256 KiB、2048 元素，元素与属性白名单；拒绝 DTD、实体声明、脚本、事件、style、foreignObject、image/use、外部引用和未知 namespace。现有两套目录资产均有实际内容校验测试。此函数是拒绝式校验，不执行“修复后加载”。

当前图标资产随源码构建，尚无第三方图标包解包/注册入口；路径词法检查不能代替 D1 的真实包内边界、symlink、文件大小/MIME/来源检查。未来动态加载必须调用内容与包校验，不得只依赖后缀。

## 6. 验证与维护

自动验证覆盖 owner 持久化/失败/账号往返/模式预览、缺包回退、内置颜色变体、两套目录 SVG、主题 IPC 来源/frame/epoch/revision、迟到 get，以及既有纯模型测试。本轮新增用例锁定森林/海蓝原 62 色、历史导航/Semi 选中默认值、紫罗兰完整性、亮暗关键文字与控件对比度及共享插件颜色投影。

2026-09-23：`lint`、全量测试（424 文件、3307 项通过；3 文件、7 项跳过）、`build` 通过，最后的 Semi 焦点映射另通过定向 lint 和主题测试。macOS、非首个 Win 资料库（id=3）已观察紫罗兰亮暗主背景、侧栏、导航、设置选中标签、目录交互背景与暗色原生菜单；预览内切模式后取消，恢复森林与跟随系统。核验中临时生成的空文件夹已移入回收站。未逐页手验全部按钮/编辑器/媒体，未更新已安装插件包，未重复紫罗兰保存后重启恢复，也未验收 Windows/Linux。

2026-09-24：根据实际观感，资料库左侧目录树所在的 macOS `SidePanel` 移除 `surface.sidebarVibrancy` 主题色叠层，改由原生 `sidebar` vibrancy 单独提供毛玻璃与桌面透色；Windows 仍使用 `surface.sidebar` 实色回退。`surface.sidebarVibrancy` 继续保留给其他明确需要主题投影的工作区入口，不应重新用于目录树容器。

2026-09-24：紫罗兰主题的普通文字角色改为中性灰阶，工作区的 surface/fill/border/scrollbar/editor 基础层也回到中性明暗值；普通文字在亮色提高深度、暗色提高亮度，但普通目录、文件、正文和页面底色不再携带紫色；紫色保留给强调色、导航/选中、链接、焦点、归档及聊天等明确语义角色。完整 67 色角色、用户自定义覆盖和缺省回退保持不变。

历史 A1 实际验证使用列表第三个 win 资料库，覆盖当时四种颜色/图标组合、模式切换、取消、保存后刷新恢复、文本打开和原生右键菜单，见 [A1 验收记录](plugin-system-a1-acceptance.md)。紫罗兰、新增消费面及新版插件样板的本轮验证统一见 [验证矩阵](frontend-validation-matrix.md)，当前不能从历史结果推导本轮或 Windows/Linux 已验收。

新增主题消费面、存储结构、IPC 或图标路径必须更新本文及测试。插件平台是否完成仍按上位方针判断，A1 外观可用不代表第三方插件平台已完成。
