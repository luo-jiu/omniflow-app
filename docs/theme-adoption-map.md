# 主题接入覆盖地图

更新时间：2026-09-23

本文按[主题推广计划](theme-design-and-rollout-plan.md)的六类页面维护源码接入事实、剩余入口和内容例外。它是维护清单，不是全页面视觉验收结果；状态来自当前源码及其消费者核对，亮暗、窄工作区和真实交互证据统一见[验证矩阵](frontend-validation-matrix.md#310-主题--布局--浮层)。本轮锁屏期间未操作应用界面。

新页面的使用方法见[通用主题基础](theme-foundation.md)，颜色所有权、跨窗口传递和受限强调色覆盖见[外观系统](appearance-system.md)。本文不另设主题 owner，不要求业务页面为了接颜色而改状态、布局或事件协议。

## 1. 如何读这张地图

| 标记 | 源码事实 | 不能据此推断 |
| --- | --- | --- |
| **共享基础已接** | 组件直接使用 foundation fragments/组件，或继承已经接入的共享组件 | 不等于该文件每个状态、所有子组件或全页面视觉均已统一 |
| **变量已接，交互独立** | 消费 `--app-*`、已经映射的 Semi 变量或主题快照，但本地仍定义 hover、active、选中、禁用、焦点 | 不是“完全不支持主题”，也不代表与样板拥有相同状态规则 |
| **固定色待迁移** | 活跃宿主 UI 中存在与内容无关的固定配色，或只按亮暗硬分支而忽略当前配色 | 不能只凭一个 HEX、黑色阴影或颜色 fallback 判错，须一起核对前景、背景和消费者 |
| **内容/专用视觉例外** | 内容像素、用户配置、品牌标识、媒体舞台或明确的专用颜色策略 | 例外仅覆盖指定层；外围按钮、错误提示、普通面板仍需主题化 |

同一文件可以同时拥有几种标记。表格按共享入口和代表选择器组织，不用固定色数量、文件数量或 token 数计算“完成百分比”。公共 CSS 变量已映射、组件引用了变量、组件复用了共享状态，以及真机看过这四件事分别记录。

## 2. 当前可复用的基础入口

| 入口 | 已提供 | 范围 |
| --- | --- | --- |
| [theme-foundation-styles](../src/components/ui/theme-foundation-styles.ts) / [基础原生组件](../src/components/ui/theme-foundation.tsx) | app/panel/elevated/raised/input/popover/sidebar 表面；五级文字；选择三态；主、普通、描边、轻量、危险按钮；输入外观及紧凑尺寸；禁用、错误、焦点 | 只提供视觉，保留原生语义及调用方状态。`inputAppearanceStyles`可在保留旧尺寸的情况下迁移输入/文本域 |
| [ResourceLabel](../src/components/business/resource-label.tsx) | 独立归档名称色与字重 | 归档事实由调用方提供，允许与行选中背景同时存在 |
| [ContextMenu](../src/components/ui/context-menu/index.tsx) / [MenuContent](../src/components/ui/menu-content/index.tsx) | 同一普通/危险/禁用/hover/active视觉，紧凑菜单用同一状态色绘制外扩伪元素 | 菜单不是通用按钮皮肤；尺寸与子菜单行为继续由原组件拥有。禁用 ARIA 是既有状态投影，不是新增完整键盘菜单协议 |
| [Semi适配器](../src/features/appearance/theme-adapters.ts) | bg-0～4、fill、文字、边框、焦点、主色三态、选中三态、状态基础色及禁用变量 | 不改写 Semi 交互实现；未映射的 secondary/tertiary、状态 hover 等变量不能当作已接受完整主题控制 |
| [CompactModal](../src/components/ui/compact-modal.tsx)、[openCompactConfirm](../src/components/ui/compact-confirm.ts)、[common.less](../src/assets/css/common.less) | 已有共享弹框表面、关闭按钮、footer、尺寸与输入方式焦点规则 | 这是已有共享家族，当前仍有局部状态规则；不要因未 import foundation 就复制第二套弹框 |
| [工作区滚动条](../src/components/ui/workspace-scrollbar.ts)、[编辑器主题](../src/features/appearance/editor-theme.ts) | 滚动条、CodeMirror 专属颜色语义 | 复用专用入口，不把编辑器选区/光标直接换成普通控件选中色 |

## 3. 六类页面的接入情况

### 3.1 工作区外壳与导航

| 入口及代表状态 | 当前分类 | 后续接入点 |
| --- | --- | --- |
| [目录树样式](../src/features/file-explorer/components/directory-tree/style.ts)与[名称渲染](../src/features/file-explorer/components/directory-tree/index.tsx)：树行、`.tree-row-selected`、归档名称 | **共享基础已接** | 保留原选区分组圆角、测量、拖拽与图标槽；后续只核对组合状态，不重写树 owner |
| [侧栏图标按钮](../src/views/library/detail/icon-button-styles.ts) | **共享基础已接** | 真实按钮保持原热区和图标大小 |
| [工作区布局](../src/views/library/detail/layout-styles.tsx)：导航、地址/书签区域、分栏按钮 | **变量已接，交互独立**；favicon fallback仍有固定中性灰 | 普通图标按钮与书签行逐类接共享规则；favicon图像保留，缺省占位的背景/前景可主题化 |
| [FileTabsBar](../src/components/business/app-main/FileTabsBar.tsx)：`TabButton`、关闭/更多按钮、溢出列表 | **变量已接，交互独立**；本机来源橙色为专用来源提示 | 当前普通激活底已经是`control.selected.*`，不能说未接主题。后续补齐同类hover/active/disabled/focus；本机来源色先评估来源语义，不直接抹成普通选中底 |
| [仓库首页样式](../src/views/library/style.ts)：顶部操作、侧栏操作、文件夹卡片 | **变量已接，交互独立**；少量普通hover为固定黑透明度；文件夹素材/材质为专用视觉 | 先迁移普通操作hover和焦点。文件夹素材、`--folder-*`与用户后续图标工作单列，不以主题推广为由重绘 |
| [EmbeddedBrowserPanel](../src/features/embedded-browser/components/EmbeddedBrowserPanel.tsx) | **变量已接，交互独立** | 宿主错误/空态/重试使用统一按钮；真实网页内容是隔离内容，不由宿主全局重着色 |

macOS侧栏的`surface.sidebarVibrancy`着色层与原生材质是明确边界。`surfaceStyles('sidebar')`是实色表面，不能拿它覆盖毛玻璃层。

### 3.2 表单与管理

| 入口及代表状态 | 当前分类 | 后续接入点 |
| --- | --- | --- |
| [AppearanceSettings](../src/features/appearance/AppearanceSettings.tsx) | **共享基础已接** | 继续复用原预览事务；颜色输入自身展示的用户色值不是待替换固定色 |
| [PluginManagement](../src/features/plugin-management/PluginManagement.tsx)：`Page`的面板、按钮、说明、details | **共享基础已接** | 已接普通按钮、表面、文字及焦点；执行、权限和审批事实不由样式推断 |
| [工作区设置](../src/features/system-workspace/views/settings/index.tsx)、[SettingsSections](../src/features/system-workspace/views/settings/SettingsSections.tsx) | **共享基础已接（操作与分类入口）** | 管理/退出操作分别复用outline/secondary按钮，既有Semi实心主操作保留primary投影；分类普通交互、`aria-current`选中与焦点复用共享规则，内容滚动区提供焦点入口。`.theme-toggle`等专用切换仍独立 |
| [旧设置独立页](../src/views/settings/index.tsx) | **变量已接，交互独立** | 尚未随工作区设置迁移；不能因为同名页面的一处改动就认为两个入口都完成。后续核对路由消费者后迁移其操作按钮与专用切换 |
| [AI服务样式](../src/features/ai-services/styles.ts)、[模型控件](../src/features/ai-services/components/AIModelSettingsControl.tsx) | **变量已接，交互独立** | `.ai-service-row.is-active`、行内操作、模型/推理菜单和上下文输入各有状态；先保持既有键盘、拖拽和菜单布局，迁移视觉入口 |
| [存储设置](../src/views/storage-settings/index.tsx)、[浏览器文件映射](../src/views/browser-file-mappings/index.tsx) | **变量已接，交互独立** | toolbar描边按钮、列表和紧凑编辑弹框重复局部规则；适合使用outline按钮及既有CompactModal |
| [标签管理](../src/views/tag-management/index.tsx) | **变量已接，交互独立**；标签颜色/文字色/色盘是**用户内容例外** | 表格、过滤、目标chip和弹框操作可迁移；`form.color/textColor`、预设色盘、预览白字fallback代表标签作者选择，不能全替换成主题色。`.tag-editor-tone-button`的固定文字色目前对应空色块按钮，不据此当正文风险 |
| [Cookie设置](../src/features/embedded-browser/cookies/components/EmbeddedBrowserCookieSettings.tsx)、[密码设置](../src/features/embedded-browser/passwords/components/EmbeddedBrowserPasswordSettings.tsx) | **变量已接，交互独立**；危险按钮hover仍有固定白前景 | 危险动作应成对核对前景与底色。当前使用`semi-color-danger`作实心底，不能假设它永远是可配白字的深红；可先采用现有危险浅底规则 |
| [密码保存条](../src/features/embedded-browser/passwords/components/EmbeddedBrowserPasswordSaveBar.tsx)、[自动填充条](../src/features/embedded-browser/passwords/components/EmbeddedBrowserAutoFillBar.tsx) | **变量已接，交互独立**；保存主按钮固定白前景 | 主操作用accent.foreground与共享主按钮三态，关闭/忽略复用轻量按钮；不读取或改变密码事实 |
| [AppUpdateSettings](../src/features/app-update/components/AppUpdateSettings.tsx)、[浏览器外部工具设置](../src/features/embedded-browser/external-tools/components/EmbeddedBrowserExternalToolSettings.tsx) | **变量/Semi控件已接** | 继续通过Semi适配统一基础色；自写容器与说明不因组件库变色自动满足全部样板层次 |

表单迁移时优先复用外观而不改变提交、busy、校验或权限边界。`aria-invalid`仅负责视觉与语义投影，错误说明及label关联仍由表单提供。

### 3.3 列表、表格与任务结果

| 入口及代表状态 | 当前分类 | 后续接入点 |
| --- | --- | --- |
| [工具共享壳](../src/features/tool-workspace/styles.tsx)：`ToolNav`、`.tool-card`、折叠按钮、Panel、ConfigGrid | **共享基础已接（指定入口）** | 导航卡片选中/交互、共用表面和说明已经收拢；不能外推为所有工具内页已接 |
| [媒体资源工具](../src/features/tool-workspace/ToolWorkspaceMedia.tsx)、[保存目标](../src/features/tool-workspace/ToolWorkspaceSaveTarget.tsx) | **共享基础已接（部分）**＋**变量已接，交互独立** | 媒体类型/保存位置各有蓝绿识别色；原生按钮、焦点、输入已部分复用。类型标识应先决定领域语义，不借成功色统一全部分类 |
| [插件命令样式](../src/features/plugin-commands/styles.ts)、[参数表单](../src/features/plugin-commands/CommandParameterForm.tsx) | **共享基础已接** | 面板、主/普通按钮、输入/select、checkbox焦点、长提案表格与details；业务提交链继续原样 |
| [插件工具宿主壳](../src/features/plugin-workspaces/styles.ts) | **共享基础已接（继承CommandWorkspaceBody）** | 资源栏、宿主状态、审批区继承同一套规则；里面独立插件文档属于第3.6节 |
| [回收站](../src/views/recycle-bin/index.tsx)、[传输中心](../src/views/transfer-center/index.tsx)、[上传中心](../src/views/upload-center/index.tsx) | **变量/Semi控件已接，交互独立** | 表格、工具栏、空态和批量操作先选一页作代表；上传/下载任务状态不可为套样式而重排 |
| [资源探针历史](../src/features/resource-monitor/components/ResourceProbeHistoryPanel.tsx)、[资源组成仪表盘](../src/features/resource-monitor/components/ResourceBreakdownDashboard.tsx) | **变量已接，交互独立**；分类图表调色板是专用数据视觉 | success/danger探针状态已有语义色；类别调色板与状态调色板要分开，不能用主色替换全部分类 |
| [资源监测图表](../src/features/resource-monitor/components/ResourceMonitorCharts.tsx)及[切换回归](../src/features/resource-monitor/components/ResourceMonitorCharts.test.tsx) | **只读主题快照已接（JS图表）** | 文字、坐标、网格与tooltip直接取`AppearanceViewContext`目标颜色，消除计算样式在宿主动效中读到旧色后滞留的问题；没有DOM观察、逐帧读取或第二套主题状态。默认HEX仅在缺Provider时回退，分类调色板与数值保留。快照更新不等于canvas与宿主WAAPI逐帧插值同步 |
| [浏览器资源面板](../src/features/embedded-browser/resources/components/EmbeddedBrowserResourcePanel.styles.ts) | **变量已接，交互独立**＋**固定色待迁移** | `.resource-panel-filter-error`固定红，`.resource-panel-badge.is-active`与`.resource-hls-analysis`直接混white，`.resource-chip`固定黑透明底；均是宿主UI，不是捕获网页内容 |

### 3.4 阅读与编辑

| 入口及代表状态 | 当前分类 | 后续接入点 |
| --- | --- | --- |
| [CodeMirror主题](../src/features/appearance/editor-theme.ts)、[TextViewer样式](../src/features/file-viewer/components/text-viewer/style.ts) | **专用共享适配已接**＋**变量已接，交互独立** | 编辑器背景/正文/光标/选区/语法已经有统一入口；Markdown正文和底栏按钮仍局部定义。`.icon-action-btn`、模式切换和另存弹框可收拢，不修改文档/草稿owner |
| [ImageViewer](../src/features/file-viewer/components/image-viewer/style.ts)、[GalleryViewer](../src/features/file-viewer/components/gallery-viewer/style.ts) | **变量已接，交互独立**＋**内容/舞台例外** | 正常外围跟主题；图片像素、裁剪遮罩/网格/白边界是图像上的工具视觉，前景与遮罩成对保留。图库空封面装饰可另评估主题化 |
| [PdfViewer](../src/features/file-viewer/components/pdf-viewer/style.ts) | **变量已接，交互独立**＋**PDF专用舞台例外** | `.viewer-stage`深灰、`.page-frame/.pdf-canvas`白纸、页码白字及舞台滚动条成组处理；底部工具栏已消费Semi。错误/空态仍属宿主反馈，需分别在舞台与普通表面检查可读性 |
| [VideoViewer](../src/features/file-viewer/components/video-viewer/style.ts)及[字幕源按钮](../src/features/file-viewer/components/video-viewer/VideoSubtitlePanel.tsx) | **共享基础已接（普通控制侧栏）**＋**媒体舞台例外** | `.console-panel/.console-section`、说明/标题接共享表面和文字；字幕源普通/选中三态与焦点接共享规则，并以`aria-pressed`投影真实当前项；`.inline-alert.error`成对使用danger背景/前景。黑色视频、`.subtitle-preview`黑底白字、字幕/列表/倍率覆层和进度色仍按媒体专用策略保留 |
| [FloatingMiniVideoPlayer](../src/features/file-viewer/components/floating-mini-video-player/style.ts) | **变量已接，交互独立**＋**混合待核对** | `.floating-video-host`黑底是舞台；header/footer却以主题容器再叠黑透明底、文字继承宿主色，不能把整窗直接登记为“恒暗播放器”。先核对亮色时的成对前景/背景 |
| [统一音频查看器](../src/features/audio-viewer/components/unified-audio-viewer/style.ts)、[音量控件](../src/features/file-viewer/components/media-volume-control/style.ts) | **变量已接，交互独立**＋**封面衍生例外** | 列表播放/hover、底栏、歌词使用主题变量；封面上的白色播放图标配深色遮罩保留。`mask-image`中的黑白是遮罩通道，不是待迁移可见配色 |
| [封面取色](../src/features/file-viewer/components/audio-spectrum-visualizer/audio-spectrum-cover-color.ts) | **内容衍生专用策略** | 有彩色封面时频谱/进度来自封面，无可用色回退蓝色；当前对比算法使用自身亮暗背景假设。后续应核对紫罗兰实际舞台，而不是直接把频谱换成accent |
| [ASMR查看器](../src/features/file-viewer/components/asmr-viewer/style.ts) | **变量已接，交互独立**＋**固定状态色待迁移** | `.row-playing-badge.active/paused`和playing pulse写死绿/黄，是播放状态标识，适合统一状态语义；标签作者提供的色值保留 |
| [漫画查看器](../src/features/file-viewer/components/comic-viewer/style.ts) | **变量已接，交互独立**＋**固定装饰待决策** | 图像原色保留；最外层固定绿色光晕是应用装饰，不是漫画像素，不能自动当永久内容例外 |
| [漫画归档](../src/features/archive-viewer/components/comic-archive-viewer/style.ts)、[ASMR归档](../src/features/archive-viewer/components/asmr-archive-viewer/style.ts)、[视频归档](../src/features/archive-viewer/components/video-archive-viewer/style.ts)及[共用归档外观](../src/features/archive-viewer/components/archive-card-theme.ts) | **共享基础已接（外壳/卡片/普通信息）**＋**封面装饰例外** | 页面/底栏/空态/错误共享角色；卡片底与hover/active边框、焦点统一。ASMR/视频普通标题和metadata跟主题，ASMR标签槽/缺省标签使用表面与文字角色，视频合集名称使用`folder.archive.label`；真实用户标签保留。漫画封面白遮罩与深色标题作为配对覆盖层保留，类型badge/占位梯度仍需专用视觉决策 |
| [图库归档](../src/features/archive-viewer/components/gallery-archive-viewer/style.ts) | **共享基础已接（外壳/元信息/反馈）**＋**封面覆盖例外** | 页面/底栏/状态复用归档外观，元信息、卡片hover/active边缘和focus接共享角色；`.gallery-album-overlay`深渐变与`.gallery-album-title`白字成对保留。占位封面及类型badge仍需单独校准 |

归档卡片本轮已收拢普通表面与信息，但封面覆盖、空封面装饰和用户标签不能按普通正文机械替换；其配对层仍需在有封面/无封面/长标题的真实数据上检查。现有卡片没有统一选中、禁用或CTA事实，不为了展示完整样板而发明这些业务状态。

### 3.5 会话与交互卡片

| 入口及代表状态 | 当前分类 | 后续接入点 |
| --- | --- | --- |
| [AgentWorkspace](../src/features/agent/AgentWorkspace.tsx)：AgentRoot、Composer、ArchiveHeader、RecoveryNotice | **变量已接，交互独立**；`.agent-submit.stop`固定橙白 | 普通/恢复/发送按钮可收敛。停止的业务含义和圆形热区保留，先确定warning或独立运行操作语义；不因改主题改变发送/停止逻辑 |
| [AgentTimeline](../src/features/agent/components/AgentTimeline.tsx)、[AgentMessageContent](../src/features/agent/components/AgentMessageContent.tsx) | **变量已接，交互独立** | 用户消息、工具栏、复制、文件链接与表格颜色已消费主题；复制/链接状态仍单独定义。Markdown/代码正文不能被选中行规则一把覆盖 |
| [Agent语法色](../src/features/appearance/agent-syntax-theme.ts) | **专用策略（只统一明暗与动效）** | 使用内部`--app-agent-syntax-*`，不由67色主题schema控制。它与CodeMirror主题不是同一覆盖范围；后续统一需明确契约 |
| [AgentInteractionBlock](../src/features/agent/components/AgentInteractionBlock.tsx)、[AgentConfirmationCard](../src/features/agent/components/AgentConfirmationCard.tsx) | **变量已接，交互独立** | choice/form原生输入、主操作与说明、审批字段可复用输入/按钮外观；保留唯一本地草稿、pending/busy、失效与中心提交handler |
| [AgentSessionManager](../src/features/agent/components/AgentSessionManager.tsx)、[AgentMemoryManager](../src/features/agent/components/AgentMemoryManager.tsx)、[AgentSessionPeek](../src/features/agent/components/AgentSessionPeek.tsx) | **变量已接，交互独立** | 搜索/编辑、行选中、归档入口、更多按钮与焦点可按家族合并。MemoryManager中残留`.agent-memory-button.is-danger`固定白字当前未找到JSX消费者，不把它当活跃危险按钮来估进度 |
| [AgentPermissionControl](../src/features/agent/components/AgentPermissionControl.tsx)、[共享模型控件](../src/features/ai-services/components/AIModelSettingsControl.tsx) | **变量已接，交互独立** | radio菜单当前项、hover与焦点仍各有规则；必须保留原键盘/Escape与规范权限投影，不直接换成缺少协议的普通按钮列表 |
| [AgentToolActivityCard](../src/features/agent/components/AgentToolActivityCard.tsx)、[AgentActivityText](../src/features/agent/components/AgentActivityText.tsx) | **变量已接，专用状态交互** | 无框工具行、错误/警告、展开日志和扫光使用真实状态与主题变量；不能为套卡片模板恢复已经撤下的大卡或把运行态画成成功 |
| [AgentConversationIndex](../src/features/agent/components/AgentConversationIndex.tsx) | **专用视觉待归类** | 红/黄表示异常/暂停，绿表示当前位置或活跃，紫/玫瑰表示里程碑/标记；固定色不是一组普通“状态色”。先区分定位、运行、纪念标识再讨论主题角色，保留当前优先级与波纹规则 |
| [附件条](../src/features/agent/components/AgentAttachmentStrip.tsx)、[图片预览](../src/features/agent/components/AgentAttachmentPreview.tsx) | **变量已接，交互独立**＋**图片遮罩例外** | 普通附件名称/错误/移除按钮可共用视觉；图片本身和独立预览的深色遮罩保留 |

主题迁移不新增Session/Run/ToolRun状态源，不改变受控展示协议。规范边界见[Agent UI契约](built-in-agent-ui-contract.md)。

### 3.6 浮层与隔离页面

| 入口及代表状态 | 当前分类 | 后续接入点 |
| --- | --- | --- |
| [MenuContent](../src/components/ui/menu-content/index.tsx) / [ContextMenu](../src/components/ui/context-menu/index.tsx) | **共享基础已接** | 真正消费者包括目录树、仓库、书签、查看器和媒体工具；默认/紧凑两种尺寸共享状态。禁用后不显示hover/active底色，图标/箭头一并接禁用角色 |
| [CompactModal/Confirm公共CSS](../src/assets/css/common.less)、[目录树紧凑弹框](../src/features/file-explorer/components/directory-tree/modals/compact-modal-style.tsx) | **已有共享家族，变量已接** | 关闭按钮和表面仍存在重复局部规则；保留原尺寸、焦点陷阱、输入方式处理，不为收色改弹框协议 |
| [节点选择弹框](../src/features/file-explorer/components/library-node-picker-modal/index.tsx) | **变量已接，交互独立** | `.node-row`选中/hover及搜索控件可复用共享状态；不将真实目录树的owner或测量逻辑搬进选择器 |
| [OverlayThemeBridge](../src/overlay/OverlayThemeBridge.tsx)及[overlay注册](../src/overlay/registry.tsx) | **跨窗口快照已接** | overlay经同一只读快照应用颜色，目录菜单与弹框仍复用原组件。快照同步不等于独立窗口逐帧动画同步 |
| [JSON转换插件CSS](../samples/json-transform/src/workspace.css)及[主题映射](../samples/json-transform/src/workspace.js) | **快照已接，插件独立CSS** | 已消费背景、表面、文字、边框、强调前景/三态、焦点、错误与滚动条。fallback色用于未提供字段，不表示宿主快照未生效；禁用仍保留插件自身策略 |
| [CSV Viewer](../samples/csv-viewer/src/main.js) / [CSS](../samples/csv-viewer/src/style.css)、[CSV Tool附带Viewer](../samples/csv-tool/src/main.js) / [CSS](../samples/csv-tool/src/style.css) | **快照已接，插件独立CSS** | 表格表面/边框、正文/说明、普通按钮三态/禁用、错误、原生控件强调、焦点、文字划选与滚动条已映射；当前全部是数据`td`，不将每页首行冒充表头。`tool-runner`无DOM，不需要主题 |
| [JSON树Viewer](../samples/json-tree-viewer/src/main.js) / [CSS](../samples/json-tree-viewer/src/style.css) | **快照已接，插件独立CSS** | 表面/文字/边框、按钮、树节点hover/active、错误/焦点/禁用、划选和滚动条均使用有限语义；原分页、展开与阅读检查点不由主题重建 |
| [漫画插件](../samples/comic-viewer/src/main.js) / [CSS](../samples/comic-viewer/src/style.css) | **快照已接，插件独立CSS**＋**图片内容例外** | 普通外壳/控件/说明/错误/焦点/禁用/滚动条已映射，图片像素保留；不直接导入宿主React基础组件 |
| [只读生成模板](../templates/readonly-viewer/src/main.js) / [CSS](../templates/readonly-viewer/src/style.css)、[开发包指南](../templates/plugin-kit/README.md#主题接入) | **快照已接，生成工程独立CSS** | 新生成工程包含表面、三级文字、边框、普通按钮三态/禁用、错误、焦点、划选与滚动条；context与theme事件共用递增revision投影，读取/取消/配额/检查点沿用原协议 |

宿主样板与隔离插件不能共享运行时组件树。统一的是有限颜色语义与开发约定，插件仍须主动消费快照、保留缺字段回退，并重建/更新安装包后才改变实际已安装版本。

本轮四个旧样板与只读生成模板只通过包内外链CSSOM修改自己的规则，`mode`同步`color-scheme`；每次恢复亮暗两套原始默认值再应用已给出的颜色，避免完整快照切回部分字段时残留旧色。源码事件probe覆盖乱序revision、切换模式与同模式缺字段回退，仓库外离线构建通过；这些证据不等于实际已安装版本更新或隔离页面视觉验收。

## 4. 明确保留和需要决策的例外

| 对象 | 处理原则 |
| --- | --- |
| 图片/视频帧、PDF原文白纸、网页、标签作者色值 | 保留内容。只迁移宿主控制和不属于内容的普通文字/表面 |
| [登录页](../src/views/login/index.tsx)的`--auth-*`玫瑰品牌配色 | 已有独立亮暗视觉，不随森林/海蓝/紫罗兰整套替换。若未来开放品牌主题，应明确新增能力，不能声称当前67色已覆盖登录视觉 |
| 工具导航QQ音乐红色图标、文件/目录素材 | 保留已确认标识与素材；图标库重绘由用户另行推进 |
| 视频深色舞台、图片裁剪/播放覆盖、图库封面标题遮罩 | 黑白成对关系服务内容对比，不逐项机械替换。普通侧栏、错误提示和非覆盖标题不因此豁免 |
| `mask-image`的黑白、透明清除、阴影中的黑色 | 属于遮罩/合成几何或材质，不按普通文字固定色统计；阴影是否统一仍可独立评估 |
| 本机文件橙色来源提示、工具保存目标蓝绿识别、聊天索引里程碑、图表分类palette | 专用语义待维护者决定如何主题化；暂保留既有含义。已有status角色能准确表达的异常/警告则优先接入，不能把全部分类强行映射为success/info |
| 漫画绿色光晕、归档类型badge、无封面插画底色 | 应用装饰而非用户内容；须作明确视觉决定，当前不登记为永久保留例外 |

## 5. 下一批最值得做的热点

1. **剩余管理控件**：旧独立设置页、AI服务、存储/映射、Cookie/密码操作。工作区设置的操作与分类已收拢，不重复迁移。其他入口已有变量占多数，优先修主色/危险底配固定白字和禁用hover，而不是重排管理页。
2. **Agent基础交互**：先处理Composer按钮、choice/form、会话/记忆列表操作，再处理专用索引。它们用户触达频繁且复用价值高；颜色迁移与执行/审批逻辑分离。
3. **归档与媒体专用视觉决策**：归档普通外壳/卡片信息、视频普通控制侧栏已收拢；剩下类型badge、无封面装饰、媒体播放覆层/进度和封面衍生色各有含义。先决定专用语义，再在有封面/无封面/长标题/用户标签上验证，不再把整组归档卡片列为未迁移。
4. **浏览器资源面板**：普通宿主面板的white混色、固定错误红与黑透明chip适合接现有角色；捕获网页内容保留隔离边界。
5. **插件实际版本与作者接入核对**：CSV、JSON树、漫画及只读生成模板的有限语义与开发说明已补齐；后续验证更新安装后的真实页面，并检查新增控件是否沿用模板角色。源码与仓库外构建完成不能代替已安装版本的视觉证据。

以上顺序针对当前已存在页面的维护收益。每批只挑代表消费者检查，再推广相同共享入口；不把一次锁屏代码工作宣称为六类页面全部验收。

## 6. 新页面是否已经够用

目前足以覆盖普通表面、文字、按钮、输入、行选择、归档名称、菜单与基础焦点；旧页面可以只接CSS fragments保留尺寸，新页面可用原生Theme组件。以下仍需明确边界：

- **状态展示**：已有success/warning/danger/info前景、背景、边框，但没有统一的提示条/状态徽标组件。先复用现有Semi通知/Tag或按语义变量组合，不每页发明一组新色，也不将危险文字色当必然可配白字的实心底。
- **完整表单协议**：foundation不提供label/帮助/错误关联、复选/单选组键盘、校验、busy、提交。复用Semi或已有表单组件；文本域可复用`inputAppearanceStyles`，不会自动得到统一高度和业务校验。
- **复合选择与导航**：行视觉不等于table、tree、tab、menu、listbox协议。样式以原选择投影接入，不能为了使用`ThemeSelectableButton`删除组件本来的键盘/ARIA行为。
- **媒体/来源/分类语义**：媒体控件恒暗前景、封面衍生色、来源标识及分类palette不在通用按钮角色中。先登记具体用途及fallback，再决定共享专用入口或是否扩展schema。
- **字体与密度**：Theme组件继承字体并给紧凑原生控件默认尺寸，不构成完整排版/间距系统或可自定义字体主题。沿用[显示基线](ui-display-readability-baseline.md)，不在本次顺带改变字号。
- **强调色成套关系**：现有用户强调色覆盖仍不是完整accent三态/前景生成器。共享组件会忠实消费当前角色，不能解决任意用户色与原palette不协调的问题；这仍是T2产品决策。
- **插件隔离**：独立HTML/CSS可复用语义契约，无法直接依靠宿主styled-components自动获得所有视觉规则。现有[通用主题基础](theme-foundation.md)和[开发包主题接入说明](../templates/plugin-kit/README.md#主题接入)分别提供宿主组件与插件CSS接法；完整主题作者指南尚未定稿。

## 7. 维护方法

每次迁移按表格中的“入口＋具体状态”更新分类；只有实际核对过其引用关系，才把“变量已接”升级为“共享基础已接”。新增例外说明用途、前景/背景配对和消费者，不把所有固定色一概白名单。

代码核查可搜索foundation引用、app/Semi变量及固定颜色，再回到JSX/调用点确认是否活跃、是否被inline style覆盖、是否属于内容或fallback。不要因残留CSS、测试fixture、颜色选择器样值或图表类别色增加无意义迁移工作。

亮暗与交互验收使用设置中的主题预览和非第一个真实资料库；至少覆盖一个真实消费者的hover/active/禁用/选中＋焦点组合、长文字与窄工作区。锁屏期间只更新代码核查状态，解锁后的视觉结果写入验证矩阵并链接回来。
