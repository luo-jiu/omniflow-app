# A1 外观契约与纯解析内核

更新时间：2026-09-23

状态：解析契约已接入实际 ThemeContext、设置、存储、编辑器和 overlay；当前实现见 [外观系统](appearance-system.md)。历史 A1 已通过 macOS 桌面验收，见 [验收记录](plugin-system-a1-acceptance.md)。2026-09-23 新增紫罗兰及主题消费接线，本轮自动检查与 macOS 代表性界面范围见 [验证矩阵](frontend-validation-matrix.md#310-主题--布局--浮层)。本文保留纯解析层契约。

## 1. 当前实现

[color-theme.ts](../src/features/appearance/color-theme.ts) 提供内部 `validateColorTheme`、`resolveColorTheme`、`isThemeColor` 及语义 token → CSS 变量映射。所有结果由调用者使用，模块不写 DOM、localStorage、IPC 或全局主题状态，不建立第二个 owner。这是宿主内部主题解析契约，不是第三方主题包安装 API。

[appearance-theme.ts](../src/features/appearance/appearance-theme.ts) 提供组合入口 `resolveAppearanceTheme`；[theme-effects.ts](../src/features/appearance/theme-effects.ts) 校验受限效果；[theme-adapters.ts](../src/features/appearance/theme-adapters.ts) 将同一个解析结果投影为 Semi CSS 变量及编辑器 palette。适配结果为普通可序列化数据，不导出 UI 组件，不在导入时执行任何界面变更。

颜色包当前结构为 `schemaVersion: 1`、`id` 和 `variants`。ID 长度最多 128，使用小写字母/数字以及点或短横线分段，必须有命名空间分隔；此格式仅适用于当前颜色主题候选契约，不提前冻结所有插件 ID 的规则。variants 提供 light/dark 中至少一个，token 可以省略。

解析顺序：内置当前模式默认值 → 包内当前明暗变体 → 用户覆盖。包没有当前变体时使用当前模式默认值，不借另一模式的颜色填充。调用方保留用户选择意图；返回的有效 themeId 在包缺失或非法时为内置默认。

组合入口沿用颜色包 v1 的根字段，额外允许可选 `effects`：`variants.light/dark` 仍是颜色 token 对象，`effects.light/dark` 为效果 token 对象；旧包不带 effects 时仍可使用。用户覆盖格式为 `{ colors: {...}, effects: {...} }`，两组均可省略，显式 null 不视为省略。颜色专用入口仍只接受原颜色结构，含 effects 的包应使用组合入口。

## 2. 校验与原子性

- 允许 `#RGB/#RGBA/#RRGGBB/#RRGGBBAA`、整数 RGB、0～1 alpha 的 RGBA 和 `transparent`；通道 0～255、单值最多 64 字符。
- 不接受命名色、currentColor、CSS 变量、url、calc、全局规则或脚本。暂不支持 HSL、百分比/空格形式 RGB，不能将浏览器能解析理解为契约允许。
- 只接收普通对象或无原型对象；数组和其他原型对象拒绝。跨边界调用仍须在宿主消息层限制包体积并解析 JSON，本模块不代替包校验或消息身份验证。
- 单变体/用户覆盖最多 256 个条目。未知 token 诊断并忽略，`__proto__` 等不能复制到结果。已知字段非法则拒绝整个包，即使非法值位于非当前变体。
- 包 schema、ID、variant 或顶层字段错误时整包回退；用户覆盖中出现非法已知字段时不应用任何本次用户覆盖，保留有效主题结果。错误与警告分别返回，原始输入不变。
- 输出 token 与包变体冻结。更新 UI 必须处理 errors，不得把解析兜底当作成功保存；保存前失败应保留当前已提交选择。
- 组合入口跨颜色和效果执行整包原子校验；即使非当前明暗变体的阴影非法，也拒绝全部包贡献。用户覆盖的任一组非法时，整个用户覆盖事务都不应用，保留有效主题。未知颜色/效果 token 只诊断并忽略；未知根字段拒绝。
- 解析输入 mode 必须是已经解析好的 light/dark，传入 system 或其他值抛错；系统模式归既有 owner 处理，本内核不会自行订阅系统主题。

### 2.1 阴影与圆角

| 项目 | 合法值与边界 | 默认行为 |
| --- | --- | --- |
| shadow.default / shadow.soft | 数组，0～3 层；每层必须且只能包含 x、y、blur、spread、color | 空数组序列化为 none |
| x / y | 有限数值，-32～32 px | 默认 0 / 1 |
| blur | 有限数值，0～64 px | default 亮 3 / 暗 4；soft 为 2 |
| spread | 有限数值，-16～16 px | 默认 0 |
| color | 与颜色 token 相同的受限颜色语法 | 沿用现有阴影黑色及透明度 |
| radius.small / medium | 有限数值，0～24 px，可为小数 | 默认 5 / 10 |
| radius.large | 0～24 px 或显式 pill | 默认 pill，映射为既有 999px |

不接受任意 box-shadow 字符串、单位字符串、inset 或额外字段，不静默截断越界值。每组效果 token 最多 256 项。校验后的阴影层逐层复制并冻结，调用方修改原始输入不会改变解析结果。

`effectsToCss` 是内部序列化函数，仅接受已校验的解析效果；第三方包输入必须先经组合入口。字体、行高、密度与间距仍不开放。

## 3. 已实现 token 范围

默认值和映射的代码权威入口是 `DEFAULT_COLOR_TOKENS` 与 `COLOR_CSS_VARIABLES`。已有表面、文字、边框、强调和滚动条默认值沿用当前 reset.less；消费范围见外观系统，历史验证见 A1 验收记录，本轮新增语义的验证状态以验证矩阵为准。

| 分组 | 当前 token | 说明 |
| --- | --- | --- |
| 表面 | surface.app/sidebar/sidebarVibrancy/elevated/panel/muted | 映射现有 app 背景变量 |
| 新增表面 | surface.input/popover/raised | 输入区、浮层和 Semi bg-2 |
| 填充 | fill.subtle/default/strong/pressed | 对应 Semi fill-0～3 的现有默认值 |
| 边框 | border.default/strong | 保留透明度 |
| 文字 | text.primary/secondary/muted/disabled | disabled 为独立增量语义 |
| 链接 | text.link | 链接独立于强调色，默认一致 |
| 强调 | accent.default/soft/hover/active/foreground | 主色及状态、主色底前景；foreground 不等于全局白色 |
| 导航 | navigation.active | 工作区激活导航；保留独立于强调色的角色 |
| 选中控件 | control.selected.background/hover/active | 宿主选中控件及 Semi primary-light-default/hover/active |
| 滚动条 | scrollbar.thumb/hover/track | 保留 transparent 轨道 |
| 交互 | selection.background、focus.border | 增量语义 |
| 补充交互 | interaction.hover/active、selection.text | 悬停、按下和选中文字 |
| 危险态 | status.danger.text/background/border | 增量语义，不与归档混用 |
| 其他状态 | status.success/warning/info 各自的 text/background/border | 分别解析，不借用业务颜色 |
| 目录 | folder.archive.label | 归档独立语义 |
| 其他目录 | folder.default/media/unknown.label | 普通、媒体与未知目录语义 |
| 编辑器 | editor.background/text/gutter/cursor/selection/activeLine | 通过宿主扩展应用到 CodeMirror |
| 语法 | syntax.keyword/string/number/comment/function/type/operator/invalid | 语义色，不暴露 Lezer 内部类型 |

当前共 67 个颜色 token、2 个阴影 token 和 3 个圆角 token。内置森林/海蓝保持原 62 个解析色值；新增导航默认值沿用原紫色，选中控件三态沿用原 Semi 明暗蓝色，`accent.foreground` 默认白色。新增紫罗兰（`omniflow.violet`）显式定义完整亮暗 67 色，但默认主题 ID 仍为 `omniflow.default`，不改已保存用户选择。完整颜色数据不代表所有组件已经消费，也不保证任意用户覆盖满足对比度；内置目录图标已接入，第三方图标包安装和用户自定义命名空间 token 尚未开放。

强调色设置目前只覆盖 `accent.default`、`text.link` 和 `focus.border`，不会自动推导导航、前景、hover/active 或选中控件三态。已有用户覆盖优先于新选配色，不随切换配色自动清除。

### 3.1 适配结果

- 组合结果返回 colors、effects、cssVariables、有效 themeId、mode 和诊断。cssVariables 是宿主可应用的有限映射，不含选择器和样式脚本；此层不生成 epoch/revision，也不持有当前快照。
- Semi 适配覆盖既有背景、fill、文字、边框、链接、焦点边框、强调色/hover/active、选中控件浅背景三态及各状态主要颜色和轻背景；未映射的组件状态不能宣称已适配。`accent.foreground` 通过共享 CSS 交给非禁用主色实心按钮和 checkbox/radio 标记，不能改写 `--semi-white` / `--semi-color-white` 导致危险按钮或白色表面串色。自定义主题应显式提供相关交互色，本内核不会自动推导配色。
- 编辑器适配返回背景、正文、gutter、cursor、selection、activeLine 和 syntax palette；不会创建 CodeMirror 扩展，后续由宿主编辑器 adapter 消费。
- styled-components、原生主窗口背景和 overlay 已接入。隔离 Viewer/工具工作区通过同一个 `toPluginThemeSnapshot` 复制完整颜色，继续使用既有 SDK `schemaVersion/revision/mode/colors` 形状；不下发效果、图标或内部 owner 状态，也不允许插件改宿主配色。插件消费与包更新边界见 [外观系统](appearance-system.md#41-隔离插件颜色投影)。

## 4. 验证与后续接入

[color-theme.test.ts](../src/features/appearance/color-theme.test.ts) 与 [组合契约测试](../src/features/appearance/appearance-theme.test.ts) 覆盖颜色 grammar、危险 CSS、未知/原型字段、坏 schema/ID、超限输入、跨颜色/效果事务原子性、有限数值、旧颜色包兼容、输出隔离、Semi/编辑器投影。兼容测试读取当前 reset.less，比对明暗模式已有颜色、圆角、Semi 固定值和默认阴影参数，防止默认外观在准备阶段漂移。该测试是接入前兼容约束，后续替换 reset 声明时须保留相应历史 fixture，不能直接删掉兼容断言。

新增 [内置主题测试](../src/features/appearance/built-in-themes.test.ts) 对原森林/海蓝全部 62 个颜色保留兼容指纹，同时检查新增默认角色、紫罗兰完整字段及两模式关键文字/控件对比度不低于 4.5。插件颜色复制由独立适配测试覆盖。任意用户覆盖、透明材质和组件叠色仍须实际观察，不能从这些用例推导全界面均通过对比度验收。

历史自动检查和实际场景见 [A1 验收记录](plugin-system-a1-acceptance.md)，本轮检查及未验证项见 [验证矩阵](frontend-validation-matrix.md)。单元测试不能替代组件对比度和跨窗口验证。

解析快照的版本、预览事务纯状态模型与目录图标契约现已落地，见 [主题事务、快照与图标契约](plugin-system-a1-state-and-icons.md)。owner、CSS/Semi/编辑器、账号本机存储和 overlay 同步继续复用；新增配色不建立第二套状态或迁移旧用户偏好。

新增 token 时同时补默认值、映射、合法值与对应消费面；公开为 SDK 前单独冻结完整 schema 和错误协议。
