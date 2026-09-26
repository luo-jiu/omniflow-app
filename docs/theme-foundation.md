# 通用主题基础：语义、组件与接入

更新时间：2026-09-23

本文规定新页面和旧页面迁移共用的视觉入口。主题解析、存储和快照仍由[外观系统](appearance-system.md)拥有；字体、字号、密度仍遵循[显示基线](ui-display-readability-baseline.md)。本批实现通用基础与代表消费者，不表示全部业务页面已迁移。

## 1. 各层职责

1. `features/appearance` 提供颜色角色、内置配色和唯一主题快照。
2. `components/ui/theme-foundation-styles.ts` 将角色组织为共享状态样式；`theme-foundation.tsx` 提供无业务状态的原生控件。
3. `components/business/resource-label.tsx` 展示调用方传入的归档标识，使用独立归档文字色。
4. 页面选择适合的角色、组合布局和原有业务状态，不自行维护主题或重新计算一套颜色。

基础层消费当前 67 色 CSS 变量，不新增颜色 schema，不引用 React 主题 owner，不在 render 中按明暗分支写颜色。Semi 继续复用已有组件，通过同一适配器得到颜色；无需为迁移而重写其交互。

## 2. 语义分工

| 用途 | 入口 | 规则 |
| --- | --- | --- |
| 页面、面板、卡片、次级区域、输入、浮层、实色侧栏 | `surfaceStyles(role)` / `ThemeSurface` | 分别使用 `app/panel/elevated/raised/input/popover/sidebar`；`elevated`和`raised`消费不同的既有角色，不互作别名。布局、阴影、边框由容器决定。`sidebar`是实色，不能覆盖macOS原生毛玻璃着色层 |
| 正文、说明、弱信息、禁用、强调 | `textToneStyles(tone)` / `ThemeText` | `primary/secondary/muted/disabled/accent`；只控制颜色，继承字体。必要说明不能以 muted 替代可读正文 |
| 行与可选项交互 | `interactiveItemStyles` / `selectableItemStyles` | 悬停、按下使用交互背景；`data-selected=true` 用选中三态。布局和业务选择由调用方持有 |
| 旧组件已有选中类 | `selectedItemStyles` | 可直接接 `.is-selected` 等现有投影，不复制选择状态，也不改原交互 |
| 归档开启的资源名称 | `ResourceLabel $archived` | 调用方继续判断是否为归档目录；只给名称归档色及600字重。归档含义与行选中背景同时保留 |
| 主、普通、描边、轻量、危险操作 | `buttonStyles(variant)` / `ThemeButton` | `primary/secondary/outline/quiet/danger`；实心主色有自己的前景，危险态保留状态语义。outline用于普通管理入口，不替代显式实心主按钮 |
| 输入、错误、禁用 | `inputAppearanceStyles` / `inputStyles` / `ThemeInput` | appearance片段只提供颜色/边框/placeholder/禁用/焦点与`aria-invalid=true`错误边框；完整input另带紧凑尺寸。错误说明及关联仍由表单提供 |
| 键盘焦点 | `focusVisibleStyles` | 2px内收轮廓，避免被滚动容器裁切；实心主按钮用强调色前景绘制轮廓，避免与底色重合。保留原生焦点，不能以blur消除 |
| 正文划选 | 全局 `::selection` | `selection.background/text`，与控件选中底分离；编辑器可使用更具体的编辑选区样式 |
| 滚动条 | 现有 `workspaceScrollbarStyles` | 宿主内容溢出时常驻；目录树继续保留原有交互显隐，不另造主题滚动条 |

普通正文、文件名和目录名使用中性文字角色；主题强调色只用于强调、导航/选中、链接、焦点和归档等明确语义。亮暗模式可以调整中性文字的明度以保持对比度，但不能把普通文字整体染成主题强调色。选中项和文本选区只改变背景，保留调用方原有文字前景与语法颜色。

状态组合规则：禁用项不响应悬停/按下的颜色；选中项有独立 hover/active；焦点轮廓可叠加选中背景；子元素上的领域文字色不会被选中规则统一抹掉。归档不是成功状态，不能借 `status.success` 实现高亮。

## 3. 新页面使用方式

新页面优先复用已有业务控件；需要原生基础控件时直接使用以下入口：

```tsx
import { ThemeSurface, ThemeText, ThemeSelectableButton } from '@/components/ui/theme-foundation';
import { ResourceLabel } from '@/components/business/resource-label';

<ThemeSurface $surface="panel" as="section">
  <ThemeText $tone="secondary">资源列表</ThemeText>
  <ThemeSelectableButton
    data-selected={selected}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <ResourceLabel $archived={isArchiveFolder}>{name}</ResourceLabel>
  </ThemeSelectableButton>
</ThemeSurface>
```

例子中的选择和归档事实来自调用方，组件不推断、不保存。列表需要 `listbox/option`、目录需要 `tree/treeitem` 时，沿用该类控件完整键盘与ARIA协议，不能给任意按钮随手套 `aria-selected`。

`ThemeButton` 和 `ThemeSelectableButton` 默认 `type=button`，需要提交时显式传 `type=submit`。使用原生 `disabled` 阻止操作；`aria-disabled` 仅提供语义和样式，自定义交互仍须由调用方拦截。用 `$surface/$tone/$variant/$archived` 传样式配置，避免把内部属性写到DOM。

基础按钮/输入默认最小28px，字体继承页面；页面按显示基线选择字号和行高。接旧控件时可直接引入CSS fragments，保留已有尺寸：`buttonStyles`、行状态样式不设置布局尺寸；旧输入/文本域优先用不含尺寸的`inputAppearanceStyles`。`inputStyles`含紧凑输入的基础尺寸。按钮片段含`font: inherit`，旧控件自身的字号、字重和行高须在片段后以相同或更高优先级保留；不能因嵌套variant覆盖而偷偷变更密度。不要为了换颜色改变虚拟行高、文字测量或点击行为。

Semi仍由自身variant决定实心、浅底或无边框风格。不要对所有`.semi-button`强加同一个primary皮肤；既有组件需要迁移时核对实际JSX、禁用class以及全局前景规则。仅视觉片段不会阻止点击、实现键盘菜单或建立表单关联。

## 4. 当前接入范围

| 共用位置 | 本批接入 |
| --- | --- |
| 真实目录树 | 原有选中class消费共享三态；名称使用ResourceLabel，原archive判断、选区分组圆角、测量、滚动和文件打开不变 |
| 外观设置（独立页与工作区共用） | 按钮、下拉、说明文字、键盘焦点复用基础规则，预览/保存/取消事务不变 |
| 资料库侧栏图标按钮 | quiet交互及焦点，保留已有按钮/图标尺寸 |
| 通用菜单 | popover表面；普通/危险/禁用项共享hover/active与图标、箭头颜色，紧凑外扩背景消费同一状态；保留原尺寸和子菜单事件 |
| 工作区设置 | 分类导航沿用aria-current接选中三态；管理入口outline、显式更新主按钮primary、说明文字和焦点统一。兼容独立设置页仍有旧局部规则 |
| 插件管理、手动命令和工具宿主审批区 | 管理面板、主/普通按钮、参数输入、错误说明、summary/checkbox焦点及结果表头；M2宿主壳复用命令样式。隔离插件内部CSS另行适配 |
| 工具工作区 | 导航、公共面板、媒体类型切换、保存路径、字幕工具操作接共享入口；保留QQ品牌色、蓝绿来源标识和字幕虚拟行高 |
| 视频字幕工具台 | 普通表面/文字、字幕来源选择三态、错误提示和键盘焦点；视频舞台、字幕模拟及播放覆盖层保留专用对比 |
| 四类归档 | archive-card-theme收拢页面/状态文字；漫画/视频/ASMR普通卡片复用表面和边框反馈，图库保留自身结构并接主题边缘与焦点。前三类article仍沿用原双击行为，不因focus片段获得键盘操作；封面配对遮罩/文字、媒体徽章和用户标签色保留 |
| 查看器悬浮气泡 | FloatingViewerDock集中呈现名称、计数和操作；默认底部居中，漫画阅读与漫画归档右侧竖排。半透明表面/边框/文字由既有主题角色提供；图标按钮常态透明，悬停/按下与键盘焦点复用基础规则。音频归档播放器仅共享材质并保留其控制布局，内容避让由各viewer负责 |
| Semi基础适配 | bg-3→popover、bg-4→elevated，disabled-text/border/bg/fill分别映射现有禁用文字、边框及填充语义；下拉/Popover/通知/输入等消费者自动获益 |
| 正文划选 | 全局消费selection角色，编辑器保持局部选区规则 |

Semi Input自身仍使用组件库的fill层次；通用ThemeInput使用surface.input。两者接同一套主题角色，但本批不重写Semi内部结构。菜单禁用态已有aria-disabled投影，仍保留原来的关闭回调和子菜单hover策略；菜单项仍是原有div，不代表完成键盘菜单协议。特殊品牌/媒体舞台、独立插件CSS、未迁移业务按钮不自动获得基础组件的完整状态规则。

逐类源码消费者、未迁移入口与例外见[主题接入覆盖地图](theme-adoption-map.md)。表格只表示指定共享入口，不表示其所有子页已统一或已完成视觉验收。

## 5. 可重复使用的样板

长期入口为「设置 → 外观 → 主题预览」，仓库首页和资料库内设置共用；在原设置内容区打开，保留工作区标签和目录树，点击「返回外观设置」回到外观分类。页面按需加载，发行版也可用；开发模式另保留快捷路由 `/#/dev/theme-foundation`。

预览复用应用真实ThemeProvider、基础控件、归档名称及少量Semi控件，以静态资料展示表面、文字、交互状态和归档＋选中叠加，不访问资料库或提交业务操作。它是长期的样式对照页：同一组件与状态应和业务页面一致；修正规则时修改共享实现，预览与消费者一起更新，不复制一份演示专用样式。页面布局仍按业务需要组合。

配色与明暗切换仅调用既有preview事务；恢复、返回设置或离开后取消自身token，不确认保存。进入预览会离开外观编辑区，其未保存修改按原离页规则取消；需要保留时先保存外观。样板会继承当前选择及用户覆盖，因此带有自定义强调色的账号和纯内置配色可能不同。观察默认主题时需明确是否带覆盖，不能静默清除用户偏好。

核验样板后，再检查非第一个真实资料库（当前优先Win）的目录树和设置。样板证明基础组合，真实页面检查消费接线；二者不能相互替代。运行证据统一见[验证矩阵](frontend-validation-matrix.md#310-主题--布局--浮层)。

## 6. 后续维护

新页面沿用上述入口。出现新视觉用途时先核对已有角色和控件家族；同类表现不同先修消费方式，可复用的新语义再评估扩展角色及回退。所有新状态都应能在样板中观察，并在至少一个真实消费者上验证。

本批未生成整套自定义强调色、未开放第三方外观安装、未完成全页面迁移。进一步推广按[主题视觉设计与推广计划](theme-design-and-rollout-plan.md)进行。

### 6.1 源码检查

`npm run theme:audit`扫描`src`中的静态`var(--app-...)`，在找不到源码定义时返回非零退出码；即使引用带fallback也报告，避免拼错变量后永久落回固定色。检查识别颜色映射、局部CSS声明与`setProperty`等定义，排除测试、生成目录与注释；动态变量名不推断。

用`node tools/theme-audit/audit.mjs --json`取得逐文件、行号、共享入口与固定色候选，结合[覆盖地图](theme-adoption-map.md)核对真实消费者。固定色和导入数仅作调查线索，不是失败条件或完成百分比。此工具不验证CSS作用域/级联、对比度、未映射Semi默认色、Electron或隔离插件页面；找到源码定义也不证明运行时已经应用。主题/共享样式变更时执行此检查，仍须按验证矩阵核验代表界面。
