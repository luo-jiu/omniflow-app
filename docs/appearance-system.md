# 外观系统：主题、图标与跨窗口快照

更新时间：2026-09-23

适用范围：A1 内置外观选择、主窗口、设置、目录树、CodeMirror 和 overlay。当前仅支持随应用交付的内置贡献，不提供第三方安装或插件执行。

## 1. 当前入口与能力

现有工作区「设置」和兼容 `/settings` 页面均包含「外观」区域。颜色主题为森林/海蓝，目录图标为彩色文件夹/线条文件夹，两者独立选择。还可覆盖强调色，预览、保存、取消或恢复默认；恢复默认先进入预览，不自动覆盖已保存选择。

设置中的三个字段明确区分作用：界面配色切换背景和交互颜色；目录图标只切换目录类资产，普通文件图标保持原有解析；强调色仅覆盖 `accent.default`、`text.link`、`focus.border`，悬停、按下和浅色背景等仍使用配色自身的值，不自动生成整套颜色。字段旁提供对应说明，明暗模式引导到下方「界面主题」。修改立即预览，保存仅保留于本机当前账号；取消或离开页面恢复已保存选择。

明暗/系统模式继续使用现有主题按钮。外观预览期间切模式也属于同一预览事务；取消恢复原模式和外观。普通模式切换仍走原用户偏好保存入口，预览中的模式切换不提前写旧云端偏好。

外观 UI 不保存第二份选择对象，直接使用 owner 的 requested 投影，仅保存本页面预览 token 和错误提示。页面卸载会取消自己尚未保存的预览；过期 token 不能取消另一个事务。保存失败显示错误并恢复上次保存值。

## 2. 唯一 owner 与存储

`src/contexts/ThemeContext.tsx` 持有唯一 `ThemeState`，使用 [纯事务模型](plugin-system-a1-state-and-icons.md)。ref 仅用于同步派发时读取同一个最新模型，不额外保存派生业务状态；React updater 内不执行持久化或 IPC。

模型 → `createThemeSnapshot` → 有限 `ThemeView` → DOM、Semi、styled-components、编辑器和 IPC。`AppearanceViewContext` 是只读投影，`AppearanceControlContext` 提供预览/确认/取消与账号绑定；都不自行成为 owner。

- 本机键：`omniflow:appearance:v1:anonymous` 或 `omniflow:appearance:v1:user:<id>`，保存完整已确认选择。
- 初始化读取合法本机记录；缺失/损坏时回退。首次进入账号没有记录时，沿用旧 `user.ext` 的明暗偏好；已有本机外观记录优先，当前不承诺跨设备外观同步。
- `UserPreferencesBootstrap` 只在真实账号切换时绑定 scope，旧 user.ext 刷新不会把已选外观覆盖回去。
- 预览不写任何存储。确认由 service 写当前 scope，成功后才推进 committed；quota/存储异常回退。
- `app-theme` 继续作为匿名登录页旧模式兼容投影；账号外观不再通过该全局键向其他窗口同步。
- 账号切换取消旧预览/请求，重新读取当前账号记录；本机存储原记录保留，不复制到另一个账号。
- 包 ID 缺失时保留选择意图，渲染默认并在设置提示不可用。图标 fallback 同理。第三方安装/卸载仍属于 D1，A1 不展示虚假的安装入口。

## 3. 主题应用

系统默认 → 当前明暗变体 → 用户覆盖。颜色、效果和原子拒绝规则见 [外观解析契约](plugin-system-a1-color-contract.md)。内置目录中的 name 是显示元信息，不进入主题 schema 校验对象。

`applyThemeView` 在 layout effect 中设置 body 的 theme-mode/theme-source 和受限 CSS 变量。原 `--app-*` 名称继续保留；Semi 只消费适配结果。`src/main.tsx` 已移除独立的静态 styled-components ThemeProvider，改由 ThemeContext 提供解析后的 styled theme；旧 mixin 保留，旧颜色不再是权威来源。

全局 `body *` 不再强制写文字颜色，以免覆盖菜单危险态和控件内部的继承；body 自身仍提供默认文字色。归档文字使用独立 `--app-folder-archive-label`，不再借用 success 色。

TextViewer 将外观扩展直接交给 CodeMirror 的 theme 属性，覆盖背景、gutter、光标、选择、当前行和语法颜色；字号/换行/文档/草稿 owner 不变。独立原生窗口不从 renderer 直接导入 React 状态。

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

## 5. 图标与 SVG

目录事实识别和 expanded owner 不变。Semi Tree 的全局 icon 运行时校验仅接受 ReactNode；目录图标作为节点 icon 元素提供，使用现有 expandedKeys 的只读 Context 投影更新开合，不向 Tree.icon 传函数，也不因展开重建 treeData。`getDirectoryBuiltInIcon` 先取得纯语义，保留未知类型警告及 DEF+archive 的既有特殊返回，再由 `ThemedDirectoryIcon` 消费只读图标选择。子菜单对图标尺寸/style 的 clone 仍透传到 img。

线条包包含 22 个目录 SVG，覆盖普通目录及五种业务目录的普通/归档、闭合/展开状态。普通文件类型继续继承原有 material 资产。开态缺失先用同包闭态，再回退原内置资产；不改节点类型、树数据或打开行为。错误、离线等宿主状态装饰不被新资产替代。

`validateIconSvg` 接受有界声明式子集：最大 256 KiB、2048 元素，元素与属性白名单；拒绝 DTD、实体声明、脚本、事件、style、foreignObject、image/use、外部引用和未知 namespace。现有两套目录资产均有实际内容校验测试。此函数是拒绝式校验，不执行“修复后加载”。

当前资产随源码构建，尚无第三方解包入口；路径词法检查不能代替 D1 的真实包内边界、symlink、文件大小/MIME/来源检查。未来动态加载必须调用内容与包校验，不得只依赖后缀。

## 6. 验证与维护

自动验证覆盖 owner 持久化/失败/账号往返/模式预览、缺包回退、两套颜色变体、两套目录 SVG、主题 IPC 来源/frame/epoch/revision、迟到 get，以及既有纯模型测试。

实际验证使用列表第三个 win 资料库，覆盖四种颜色/图标组合、模式切换、取消、保存后刷新恢复、文本打开和原生右键菜单。macOS 验收结果与平台范围见 [A1 验收记录](plugin-system-a1-acceptance.md)。不得用 macOS 结果宣称 Windows/Linux 已验收。

新增主题消费面、存储结构、IPC 或图标路径必须更新本文及测试。插件平台是否完成仍按上位方针判断，A1 外观可用不代表第三方插件平台已完成。
