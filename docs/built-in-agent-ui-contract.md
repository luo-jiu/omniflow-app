# 内置 Agent UI 契约

W3 文件产物卡只展示 main 的 `plugin.file-output` action：新文件名、目标目录、provider、MIME、大小、摘要和插件来源；目标目录优先显示宿主已知名称，不能把模型自报目录当权威。正文与本机 artifact 路径不进入卡片，批准仍经原 prepare/审批链，完全访问也确认具体产物。真实 CSV→JSON 正常另存/打开已验证，范围见 [W3](plugin-system-w3-file-output.md)。

未知插件操作可展示固定 `agent.operation.reconcile`（“查询回执”）动作，仅传 owner/库/Session/ToolRun 与预期 revision，由 main 从持久 action 取 operation ID 并执行只读核对。结果经 CAS 更新同一 ToolActivity，保留原结果与有限核对记录，不重开 Run 或重写历史对话；成功不降级，过期/未查到仍未知。历史改名核对仍只刷新目录，不重播旧名称。该 UI 入口目前只有自动化覆盖，不能称真机故障或重启后点击已验收。

插件改名使用标准 `AgentConfirmationCard` 的只读完整预览：显示插件/版本、包指纹、文件数量及每个旧名→新名，长列表在卡内滚动并保留键盘进入能力。数据只来自 main 的规范 `plugin.rename` public action，审批不能从插件 output 或模型 input 临时拼装；按原批准链提交，变化后重新批准。资源范围授权不能代替提案确认，完全访问也保留这一步。真实 macOS 已验证两文件范围授权、暗色两项卡片、批准提交与目录/预览同步；50 项列表完整性有自动化断言，亮/暗 50 项长列表的视觉与滚动点击未手验，范围见 [W0～W2](plugin-system-w0-w2-rename.md)。

成功界面只消费已核对且匹配批准目标的 committed ToolRun，本次实时完成按节点 ID 同步目录和已打开标签名称；历史会话恢复只刷新父目录，不广播旧回执里的名称，避免覆盖后来发生的改名。Run 停止不抹去已经提交的 ToolRun；commit_unknown 显示结果未确认及操作身份，不冒充“已取消且未修改”，也不提供换新 ID 的盲重试。SQLite 可恢复审批/结果投影，但本批未提供跨重启自动核对或撤销页面。

启动后，已批准但提交尚未确认的改名显示 main 恢复的 interrupted/commit_unknown 和原操作 ID，提示先核对、勿直接重发。已保存 committed ToolRun 不降级；如果所属 Run 尚未完成就退出，提示查看已有成功回执继续未完成步骤、勿重复改名。同一 Run 含未知改名时采用更保守的核对提示。审批前中断仍按普通未执行中断展示；UI 不据此发起自动回执查询或恢复执行。

AT1插件Tool的终态卡沿用受控details块显示宿主记录的插件/版本/工具/包指纹，input/result自报字段不能生成来源展示。插件活动单独呈现，不混入内置读取分组。无需新增执行状态owner；实际模型/界面联调边界见 [AT1](plugin-system-at1-agent-tools.md)。

## 本机会话组与归档（2026-09-13）

新组编辑器、新建/移动会话选择器为条件挂载的Semi Modal，必须先以visible=false挂载，再在effect中打开，避免StrictMode重放销毁初始可见Portal。不得以禁用全局StrictMode修复；当前开发版已实际验证创建、再次打开设置和选择组。实际读写、归档恢复、主题与隔离验收见 [验收记录](agent-session-groups-live-acceptance.md)。

右侧目录支持单层分组、按组分页和折叠，当前会话仅显示标题并在悬停时提供细线归档图标。组头提供组内新建与设置，底部集中会话管理、新建会话、归档和长期记忆入口。新建会话先选组，首次发送才保存Session；管理页可移动组，归档页可只读查看、恢复或确认后永久删除。归档当前会话有未发送草稿时拒绝操作，成功后切到同组最近会话或组内空态。

组编辑器以“资料库访问范围”解释目录用途，以“目录内自动允许”区分读取和编辑许可。支持按需添加多个目录，空列表不授权。各字段辅助说明通过标题旁问号Tooltip在悬停或键盘聚焦时显示，Esc可收起；工作区隐藏或打开目录选择器时关闭。目录行只显示左对齐完整路径（根为`/`），不重复名称或附加描述；图标与移除按钮固定宽度，长路径换行、长列表在192px内滚动。这里只编辑提交前草稿，不新增权限状态owner；文案、布局与多目录取舍见 [本机会话组与访问](agent-session-groups-and-access.md#目录访问)。

组事实与目录授权由main/SQLite持有，折叠只是设备显示偏好；首次进入某个账号/后端/资料库组合时默认展开未分组和当前组，用户的展开/收起状态之后按该组合写入本机localStorage并在下次进入时恢复，已保存状态优先于当前会话自动展开。组不嵌套，也不改变资料库真实目录。权限选择器变为会话级询问访问/组内自动/完全访问，未分组不出现组内自动。正在运行、启动及停止收尾期间的元数据变更由主进程拒绝。持久化、权限和边界以 [本机会话组与访问](agent-session-groups-and-access.md) 为准。

## 文件引用链接（2026-09-12）

本机预览标签以资源 URL 的本机来源判断，使用橙色底色与边框，激活态加深；图标按文件名和后缀解析，不继承资料库内置目录类型，无法识别时显示问号文件图标。来源不依赖可变的 tabTypeLabel 文案。

外部文件优先按后缀映射图标，只有无后缀时才按特殊文件名映射；因此 README.md 使用 Markdown 图标，不使用 README 名称的信息图标。标签栏更多按钮与上方刷新按钮共享距右边缘 25px 的中心线。

2026-09-12 在 Win 资料库同一 Agent 会话完成实际点击验收：内部 C++ 链接打开正文、切换文件模式并展开/高亮目录树；外部 README 在同一标签栏显示橙色背景和文件图标，与内部标签同时存在。未修改测试文件内容。

模型使用 `[名称](omniflow-library:/资料库绝对路径)` 或 `[名称](omniflow-local:/本机绝对路径)` 输出文件引用，含空格的目标用尖括号包裹。仅这两种协议经严格路径解析后显示为按钮，其他模型链接仍为普通文本。点击经页面工作区回调执行，不触发 Shell，也不从 Markdown 执行任意协议；资料库解析绑定当前消息所在工作区，异步返回后检查仍处于原资料库。

资料库文件复用预览标签页并发送目录树定位事件；目录只定位树，不伪造文件节点。本机文件以独立 URL 身份、空 nodeId 打开同一标签栏，标记“本机”。本机预览由受信主页面调用 `file:preview-local` 获取最多 32 MiB 的普通文件快照，支持文本、图片、PDF 和浏览器可解码媒体，格式不支持、文件丢失或超限明确报错。文件内容只用于本机预览，不上传或写入 Agent 会话；关闭后释放组件快照，媒体仍走既有 tab 释放链。本机文件不写回资料库，不支持本机目录树和行号自动定位；`#L数字` 可解析但当前只打开文件。

上下文计量与 Run.contextUsage 持久化继续保留，但 Composer 暂不挂载统计展示，也不占位。最终展示留到 UI 收尾阶段，只保留一个必要数字，不恢复多项统计行或预算编辑入口。详细口径见 [上下文计量](agent-context-accounting.md)。

`file.grep` 沿用无框工具行，不将 hasMore 显示为“可继续”；扫描结束但 complete=false 仍显示“结果不完整”。skipped 与续搜信息保留在规范结果中，不能把空匹配页画成完整无结果。正文搜索不新增目录树状态或宿主路径跳转能力。

文件工具支持显式 host 范围及 `file.read` 正文读取。成功的正文读取只显示“已读取 文件名.后缀”，包括历史记录；不显示完整路径或“可继续”，不提供单条展开、详情区或路径跳转。失败原因、审批仍保留，不由 renderer 推断 host 是否已授权。契约见 [Agent 统一文件读取](agent-unified-file-reading.md)。

目录发现 Tool 沿用无框紧凑行，`file.search` / `file.resolve` 不新增目录树卡片或状态 owner；路径定位结果可显示规范路径。跨目录输出不切换 UI 当前目录，详见 [Agent 资料库目录发现](agent-library-discovery.md)。

更新时间：2026-09-08

适用范围：

- `src/views/library/detail/`
- `src/features/library-workspace/`
- `src/features/agent/`
- `src/shared/agent/agent.types.ts` 中的展示协议
- 与 Agent 工作区直接相关的样式、组件测试和手工验证

本文是内置 Agent renderer UI 的权威契约。它回答“UI 可以怎样调整、状态从哪里来、哪些交互不能由页面自行实现”。Agent 的执行、持久化、IPC、安全和 Tool / Skill 事实以 `docs/built-in-agent-architecture.md` 为准；工作过程、commentary、稳定 assistant item、状态优先级和 reasoning summary 的分阶段设计见 `docs/built-in-agent-work-observability.md`，其中持久化、专用 item IPC、renderer 流式对账、工作过程 UI 与只读 Tool 分组已经落地，独立 Workflow / Active Run Dock 已从当前界面撤下，reasoning summary 仍不能视为现有能力；Shell UI / 日志 / 权限投影的现状见 `docs/built-in-agent-shell-architecture.md`。

## 1. 阅读顺序与文档优先级

修改 Agent UI 前必须按顺序阅读：

1. `AGENTS.md`
2. `.agent-docs/frontend-review-standard.md`
3. `.agent-docs/frontend-handoff.md`
4. `.agent-docs/frontend-documentation-standard.md`
5. `docs/frontend-architecture-baseline.md`
6. `docs/library-detail-workspace.md`
7. `docs/built-in-agent-architecture.md`
8. 涉及工作过程时继续读 `docs/built-in-agent-work-observability.md`
9. 涉及 Shell 时继续读 `docs/built-in-agent-shell-architecture.md`
10. 本文
11. `docs/ui-display-readability-baseline.md`
12. `docs/frontend-validation-matrix.md` 的“内置 Agent”章节

阶段性讨论稿只保留设计历史、调研取舍和早期规划，不是当前 UI 契约。旧稿中的 `agent-home`、阶段状态、待验证项或页面草图不能覆盖当前代码、正式架构和本文。

发现文档、共享类型和实现不一致时，不得选择一份方便的解释继续写 UI。先核对事实并修正文档或协议；如果需要改变 IPC、状态 owner、持久化或执行语义，按架构改动处理，不能伪装成视觉重构。

## 2. 工作区集成与页面模式

当前 `WorkspaceDisplayMode` 是：

```text
search-home / file-viewer / browser / tools / system
```

Agent 是 `search-home` 当前承载的默认内容，不存在独立的 `agent-home` 状态。UI 重构不得新增第二个 Agent 工作区模式，也不得让 `LibraryDetail` 保存 Agent Session 副本。

同一资料库中首次进入 Agent 后，`RetainedWorkspacePane` 保留组件实例；切到文件、浏览器、工具或系统视图只隐藏、不卸载，返回不重新恢复 Session 或重播目录行入场动画。隐藏采用保留布局的 visibility 与 inert/aria-hidden，并覆盖子元素显式 visibility，不能改用 display:none 造成尺寸归零或动画重启。实例以 backend/account/library 为 key，换库、换账号或离开资料库路由仍释放。

`WorkspaceVisibilityContext` 只投影前台可见性：隐藏时解除目录的全局关闭/快捷键监听，暂停波纹、计时刷新及自动跟随滚动，关闭模型/权限菜单并隐藏图片、组编辑和目录选择浮层；组件内草稿、目录分页/开合/位置与消息展开状态保留。返回时重新读取 AI 服务配置且隔离迟到请求，不能因保留挂载而沿用工具页修改前的配置。会话事件、工具桥及任务执行继续由原 owner 管理，不受 UI 可见性取消。

Agent 工作区内部有四种展示形态：

```text
空会话       居中空态 + Composer
当前会话     Timeline + 底部 Composer
会话管理     SessionManager，隐藏 Composer
记忆管理     MemoryManager，隐藏 Composer
```

- 会话管理、归档管理和记忆管理是 `AgentWorkspace` 内部 manager mode，不是 Library Detail 工作区模式。
- 从管理页返回时回到当前会话，不创建、恢复或切换另一个工作区实例。
- 当前待确认或待输入任务不能被默认折叠到无法发现的位置；用户必须能恢复并完成或停止它。
- 新增页面分区时，优先拆展示组件，不新增平行的 Session、Run、ToolRun 或 Workflow store。

## 运行状态文字

- 连续且符合分组条件的内部业务 Tool 按同 Run、同 groupKind 进入 ToolGroup，即使只有一条也使用同一结构。成功或失败的 resource-read 与其他内部操作当前分别成组；Shell、外部操作、待审批和待输入保留独立入口。失败不再断组，也不强制展开错误详情，包括执行前校验产生的 deny 和已审批后的执行失败；外层与单条详情均默认收起，手动展开后可检查原始错误。收起态摘要始终投影该组最后一条 Tool 的实时 summary 和图标；活跃 Tool 复用 AgentActivityText 扫光。收起时新增调用不增加组高度；展开态按内容自然增减，最大高度约156px，超过后内部滚动。外层摘要与内部最后记录共用同一份 ToolActivity，避免两套状态文案。

- 工具摘要与内部行统一左侧3px留白、20px图标槽、7px图文间距及20px文字行高，展开清单不缩小图标槽或另加缩进。`AgentToolIcon` 统一使用 OutlineIcon 的16px图形与1.25px实际描边：书页代表读取、文件笔代表编辑、放大镜代表搜索、终端代表Shell；删除、移动和复制也保留对应的操作轮廓，不再用实心完成圆点替换。通用完成文案在状态和操作之间保留一个空格，如“已完成 移入回收站”。

- 读取记录的资料库文件名通过 `buildFileFullName(name, ext)` 展示完整后缀，已带后缀时不重复追加，目录保留原名。外层摘要、内部记录及受控定位按钮使用同一份完整名称，不受目录树隐藏后缀偏好影响。

- “正在思考”与正文共用14px字号、1.65行高及4px上下/0px左右padding，保留弱文本色与扫光。首字到达前的空streaming消息不占额外高度，由规范活动状态行提供等待反馈；内容到达后恢复同一消息容器，不改变消息或Run事实。

- 用时与停止任务文案共用 d/h/m/s 格式，只展示非零单位：59s → 1m → 1m 1s，1h 1s，1d 1s；整天/整小时/整分钟不补零。尚未满一秒显示0s，历史任务仍依据规范起止时间冻结耗时。

- 普通 Provider 等待统一显示无前置图标的“正在思考”，沿用文字扫光；压缩上下文、重连和核对结果继续显示真实专用状态。工具准备/执行中的加载圈以900ms周期旋转，仅匹配spinner，不旋转文件图标或终态图标；reduced-motion下停用。

- 时间线末尾可出现一条无框 `icon + 一句话` 的临时状态，直接从规范 Run、ToolActivity 和 assistant item 派生，不创建消息、SQLite 记录或第二份执行状态。
- main `currentStep` 为整理上下文时显示“正在压缩上下文”；没有当前工具或可见流式文本时，显示“正在准备/正在处理”。待决审批/交互优先，终态 Run 不显示活动行；不复制已展示的 commentary 或 Tool 状态。
- main 报告“正在重新连接 n/m”时直接显示该状态，不自行计时或从错误文本推断重试；普通请求最多5次重试，只读部分流续接最多2次。真实流式正文出现后隐藏过时重连提示。只读部分流中断的旧片段附明确未完成说明，之后继续同 Run。边界见 [运行恢复](agent-run-reliability.md)。
- 长只读任务的候选答案不作为可见commentary，主进程仅保留在当前模型上下文，空展示item按既有规则隐藏。核对期间显示“正在核对结果”，完成后只显示正式答案；失败或取消时不释放缓冲候选。核对要求继续工具时，恢复正常过程说明和工具记录。
- `AgentActivityText` 仅在真实 preparing/running 状态上绘制灰色文字与从左到右的亮色扫光。动画只改变文字背景位置，不使用计时器修改文字、不改变布局尺寸；亮暗主题使用既有文字 token，reduced-motion 与 forced-colors 下禁用扫光、恢复普通文字。
- 活跃 `file.read` 仅显示图标和“正在读取/准备读取 文件名”，不重复“执行中”、不展开正文。成功继续只显示“已读取 文件名”；失败和待决交互沿用原路径，不被扫光遮盖。Shell 仅状态短语扫光，命令仍来自可信 prepared action，错误色不变。
- 这是实时状态投影，当前不额外持久化“上下文已压缩”时间线事件，也不从压缩次数倒推历史事件。没有 Provider reasoning summary 时不编造英文思考标题或隐藏推理。

2026-09-09 自动化验证覆盖活动/终态切换、审批优先、跨 Run 隔离、流式文本去重、读取文件名与停用动画、CSS 动态效果降级。解锁后在 win（ID 3）真实界面验证了过程说明、紧凑读取记录、等待/终态切换，并在正式预算长任务第24个文件后捕获“正在压缩上下文”。连续截图发现旧扫光在背景移出后文字会消失，现已增加固定灰色背景底层并补回归，底层也裁剪到字形而不是矩形背景。修复后全周期视觉复验、亮色、长文件名窄窗及 reduced-motion 真机验收仍未完成；上游连接关闭阻塞了后续完整长任务，不能将失败运行记为压缩成功。

同日后续已在真实32文件任务中复验暗色压缩提示的连续扫光画面，字形全程保留，完成后活动行消失；任务经历重连和一次压缩后正常结束，详情见 [运行恢复](agent-run-reliability.md)。亮色、长文件名窄窗及系统 reduced-motion 真机检查仍待补。

## 3. 状态所有权

最后打开的聊天由 `agent-session-selection:v1:<scope>` 保存一个会话 ID（scope 含账号、后端、资料库），`null` 表示用户明确选择的新空聊天，不保存消息、Run 或工具记录。进入 Agent 时通过 `useAgentSessionResume` 优先恢复该 ID，首次没有偏好时才选择最近会话；成功打开历史会话、创建真实会话和手动新建时更新指针。恢复失败保留指针，显示重试并禁止发送，不能悄悄降级新会话。删除当前/已选会话时清空指针。

Agent 仍按工作区模式挂载/卸载，返回时通过原主进程快照恢复，不改成全局常驻实例。恢复协调不能依赖 callback identity 或一次性 ref 标记；StrictMode effect 重放和 scope 切换必须取消过期尝试，不能让旧请求回写新资料库偏好。草稿和未提交表单仍不随该指针持久化。

| Owner | 负责 | 不负责 |
| --- | --- | --- |
| `LibraryDetail` | `workspaceDisplayMode`、当前资料库、根目录、目录树选中项，把只读上下文投影给 Agent | Agent 会话、消息、Run、ToolRun、确认、长期记忆副本 |
| `AgentWorkspace` | 页面编排、manager mode、Composer 高度、模型偏好 UI、会话列表查询、滚动跟随与受控 action 分发 | 执行状态机、规范消息、Tool 成败、审批结果 |
| `useAgentSession` | 当前 renderer Session 投影、输入草稿、流式增量、恢复协调、scope 防串、审批/交互 busy ID 和 renderer Tool 的在途协调 | 持久化事实、业务权限、规范终态 |
| `useAgentMemories` | 当前记忆管理页的查询、分页、mutation 投影和请求代次隔离 | 长期记忆主存储、召回事实和未提交表单字段 |
| 审批 / 交互 / 记忆编辑组件 | 当前卡片尚未提交的字段草稿 | 已提交决策、规范状态和持久化事实 |
| Electron main + SQLite | Session、Run、Message、ToolRun、审批/交互决策、长期记忆的唯一规范事实 | React 布局和页面视觉状态 |
| `localStorage` | `agent-model-preferences:v1` 的模型与推理强度；`agent-index-marks:v1:<scope>:<session>` 的节点 ID 与用户标签；`agent-session-selection:v1:<scope>` 的最后选中会话 ID/新空聊天指针；读取时清理已退役的 `agent-model-budget:v1:*` 键 | 会话历史、消息、Run、ToolRun、Workflow、审批、交互回答、长期记忆、预算覆盖 |

规则：

- Timeline、Workflow、待确认、待输入和进度都是规范事实的投影，不能再放进 Zustand、Context、`localStorage` 或组件镜像数组成为第二份事实。
- 未提交的输入、审批编辑稿和交互表单值可以留在 renderer。发送消息时只允许插入带临时 ID、可由 `started` 和规范快照对账的乐观 user message，避免时间线跳位；Run、Tool、审批、交互回答和结果状态必须等待 main / SQLite 的规范回执，不能乐观伪造。
- API Key 仍由 AI 服务本机安全存储负责，Agent 页面只能读取安全配置投影，不能把 Key 写入消息、日志、Agent SQLite 或页面持久化。
- owner scope、账号、后端地址或 `libraryId` 变化时，必须立即清空旧投影、取消或收口关联的 renderer 在途工作，并拒绝迟到事件写入新 scope。

Agent 是通用前端分层里“renderer 负责编排”的明确例外：Agent loop、Run 生命周期、Tool 调度、审批决策和任务状态机由 Electron main 持有；renderer 只负责展示、用户草稿和 main 明确请求的一次性业务 executor 分发。不能引用通用规则把 Agent 状态机搬回 React。

### 3.1 工作区切换与卸载

AT2补充：App级`AgentLibraryRunLifecycle`消费已有路由/Auth事实。离开精确LibraryDetail路由（包括回收站）、切库、账号/后端变化或登出时调用既有owner-release，覆盖pure-main插件Run；同库Agent/文件/工具/设置模式和query/hash变化不取消。仅比较已提交scope，不使用unmount cleanup发取消，因此StrictMode重放与同scope重挂不会误杀。已在win资料库实测等待读取批准时离库取消，并验证返回后的终态/来源恢复；执行中故障与剩余边界见 [AT2](plugin-system-at2-fault-recovery.md)。

`AgentWorkspace` 当前只在 `workspaceDisplayMode === 'search-home'` 时挂载。切到文件、浏览器、工具区或系统视图会卸载 Agent renderer，但不等于 owner / library scope 变化：

- 没有 renderer prepare / execution 的纯 main Run（包括 main-owned prepare）可以在 UI 卸载后继续由 main 完成；返回 Agent 后从 Session 规范快照恢复，不依赖旧 React 实例。这里的“继续”不等于 detached OS 后台 Job：当前没有跨重启进程、PTY 或脱离 Run 生命周期的命令能力。
- 正在 renderer prepare 的请求在卸载时取消。
- renderer 写操作在 authoritative commit 前卸载时取消执行并停止对应 Run，不能把可能尚未写入的操作留到超时。
- authoritative commit 后卸载不能撤销已经成功的真实写入；在途 executor继续收口规范结果，再按既有 stop-after-commit 语义结束。
- Composer 草稿、尚未提交的审批字段、交互表单和记忆编辑字段都是实例局部态，卸载后不保证保留；规范 pending approval / interaction 仍保存在 SQLite，返回后必须可恢复并重新编辑。

UI 重构不得为了保留视觉草稿而静默把 Agent 改成全局常驻实例、重复订阅事件或让隐藏页面继续执行 renderer Tool。改变挂载策略属于生命周期架构改动，必须同步更新取消、scope 隔离、资源释放和恢复测试。

## 4. 渲染数据流

Agent UI 固定使用下面的数据流：

```text
main 事件 / Session 规范快照
  -> useAgentSession 按 revision 合并并在终态对账
  -> agent-timeline / agent-workflow-projection 纯投影
  -> agent-tool-presentation 受控语义块
  -> Timeline / Tool / Approval / Interaction 组件
```

不得反向执行：

- 不能从 assistant 文本、卡片文案或动画状态推断 Tool 是否成功。
- 不能由 Workflow 卡片推进步骤、补写百分比、创建假 ToolRun 或触发 executor。
- 不能由组件直接修改 Run / ToolActivity status。
- 不能因为视觉重构绕过 `useAgentSession`，直接在页面订阅原始 IPC 或调用 main service。

### 4.1 revision 与终态

- Run 只接受更高 `revision`；`updatedAt` 只用于展示，不用于判断新旧。
- Run 已进入 `completed / failed / cancelled / interrupted` 后，迟到的 active 事件不能让它回退。
- ToolActivity 更高 `revision` 整份替换；相同 `revision` 才执行兼容合并，并保留更新的 progress、已决 approval 和已决 interaction。
- assistant item 使用稳定 message ID 与 UTF-16 绝对 offset 合并 delta；重复和前缀重叠事件保持幂等，gap 或内容冲突必须读取 main 规范快照修复，不能猜测补字。
- 活跃 Session 快照中的 streaming assistant 内容来自 main 内存 writer；SQLite 只保存空的 streaming 行，不能为了页面恢复逐 delta 写盘。
- 临时 ToolActivity 通过 `id` 或 `runId + call.id` 与规范记录对齐。
- Run 终态事件携带的规范 messages / toolActivities 必须替换该 Run 的临时投影，不能继续拼补出另一份历史。

### 4.2 时间线顺序

- 规范 Message 顺序保持不变，不按浏览器收到事件的时间重新排序。
- 时间线 item 显式属于 conversation、work journal 或 execution facts；user 与 completed final 属于 conversation，commentary 和其他未完成 assistant item 属于 work journal，ToolRun / 审批 / 交互属于 execution facts。Run 与 Plan 仍是规范事实，但当前不生成独立时间线卡。分层只影响投影和视觉，不复制规范事实。
- 每轮 user 消息前后不插入独立 Workflow / Run 摘要卡；真实执行状态由后续工作过程行和 ToolActivity 承担。失败、取消和中断 Run 在自身最后一个可见项后保留轻量终态行，内容仅来自规范 Run；空 streaming item 显示思考占位，不能过滤掉首字前的等待现场。
- 同一 `runId + toolCallId` 已有 ToolActivity 时，历史 `role: tool` 消息在原位置由活动卡替换，不能重复显示两份。
- 预发布阶段不兼容旧 Agent transcript；无法匹配 ToolActivity 的原始 `role: tool` 或 system message 不作为对话文本渲染。
- 没有持久 Tool message 的活动按同一 Run 的 `ordinal` 放到该 Run 最后一条消息之后。
- 只有损坏或遗留的孤儿记录才允许按时间作全局降级排序。
- Tool `ordinal` 是持久化审计顺序，UI 可以分组或折叠，但不能丢弃或自行重排执行事实。
- Timeline item 和卡片的 React identity 必须使用稳定的 message ID、Run ID 或 ToolActivity ID。待确认、待输入和其他含本地草稿的卡片不得使用数组 index、status、revision 或折叠层级作为 key；进度和 revision 更新不能通过重挂载清空未提交内容。
- Tool 分组读取 main 投影的 `kind / risk / groupKind / operationKind`，同 Run、连续、同 `groupKind` 的内部业务 Tool 可以合并；成功或进行中仍沿用 allow、无审批和交互记录的分组条件。失败 Tool 不因 allow/ask/deny 或已决审批记录断组，但任何 pending approval/interaction 仍不能隐藏。外部操作、未知 Tool、Shell、取消、中断、commentary 和不满足分组条件的审批/交互记录继续断组。分组 key 始终从首个 ToolRun ID 派生，错误详情保留在原 ToolActivity 中，折叠不修改执行或权限事实。

## 5. 状态展示契约

2026-09-08 起，commentary 作为 Agent 过程回复使用与 final 接近的无框正文排版，不显示前置图标，也不承担 Tool 执行状态。ToolActivity、工具分组、审批和交互继续使用无框紧凑行或内联表单；命令、查询和读取记录的图标、动作文字与路径统一使用路径级弱文本色并默认折叠，悬停时不恢复正文亮度。工具组收起时显示最新一条操作及其状态，图标与展开后的对应记录一致，不重复列出搜索、读取等机械计数；展开清单与汇总行左侧对齐，不增加层级缩进。汇总行的左侧图标、文字和右侧 Chevron 使用同一视觉中线；展开与收起使用克制的高度、透明度和轻微位移过渡，复用同一个细线 Chevron 旋转表示方向，不在两枚图标间瞬时切换。可展开行本身可以点击，Chevron 默认不占用末尾固定列，只在行悬停或键盘聚焦时紧跟摘要显示；展开的详情或工具清单最高约 `156px`，超出后使用工作区滚动条。文件名经受控 `tree.revealNode` 操作定位；失败工具详情默认折叠，待决输入不能默认隐藏。完整规则见 `agent-media-availability-and-permissions.md`。

Run 和 ToolActivity 当前共享八种状态 ID：

| 状态 | 含义 | UI 约束 |
| --- | --- | --- |
| `preparing` | 已创建的 Tool 正在完成 main-owned 或 renderer-owned prepare、尚未进入真实执行 | 显示规范准备态，不伪造进度或副作用；main-owned prepare 不要求 renderer 事件 |
| `awaiting_approval` | 等待用户批准准备好的动作 | 待决审批卡必须可见；只有规范 pending 审批可操作 |
| `awaiting_interaction` | 等待用户回答有限选择或表单 | 待决交互必须可见且可恢复 |
| `running` | provider 或 Tool 正在执行 | 使用规范进度；没有进度时只显示通用运行态 |
| `completed` | 规范完成 | 终态只读，可展示受控结果和产物动作 |
| `failed` | 执行失败 | 终态只读，Tool 错误详情默认折叠，展开后显示清洗后的错误或结果说明 |
| `cancelled` | 用户或系统明确取消 | 终态只读，不能表现成失败或继续运行 |
| `interrupted` | 应用退出、恢复收口或运行链中断 | 终态只读，保留现场，不自动重放 |

状态文字、图标和卡片结构可以优化，但状态 ID、终态语义和可操作条件不能由 UI 改写。Run 使用上下文驱动 Tool loop，不存在供 UI 展示或预判的固定 provider turn / 业务 Tool 次数上限；main 在最终回答、用户停止、终态错误、上下文不足，或最近 24 轮内长度 `1..8` 的同一稳定 Tool 调用 / 结果周期连续重复 3 次时收口，周期任一内容变化即不匹配。UI 不复制循环历史或自行判断停止条件，只展示 main 返回的规范结果。旧文档中的固定轮次和固定 Tool 次数描述都已过期。

`useAgentSession.isPreparing` 是另一个 renderer 局部 busy 状态，用于会话恢复、读取感知和创建 Run 前的启动协调；这时规范 Run / ToolActivity 可能尚不存在。UI 可以显示 Composer 级加载反馈，但不能把它伪造成 Workflow 步骤或持久化 `preparing` 状态。

内部主状态 selector 仍依次选择等待审批或交互、当前 Tool / progress、当前结构化计划项、最新仍有效 commentary、main `currentStep` fallback 和活跃 Provider 的“正在思考”，供状态投影测试与后续受控展示复用。当前工作区不把该投影挂载成独立 Workflow 或 Composer 上方状态卡；待决审批、待决交互、Tool 进度与终态直接由时间线 ToolActivity 展示。

## 6. Workflow 只是内部投影

`buildAgentWorkflowProjection()` 只从一个 Run、真实 ToolActivity 和该 Run 的结构化 assistant item 派生任务现场：

- 计划项只是一次性、不可改写的意图快照。
- 已绑定步骤的状态来自真实 ToolRun。
- 活跃 Run 中尚未绑定的计划项显示 `planned`；终态 Run 中显示 `not_run`。
- “当前”只来自绑定 active ToolRun 的 `planStepId`；“下一步”只来自其后第一个尚未开始的结构化计划项。没有计划时不显示下一步，commentary 不得升级成计划。
- 未绑定有效计划项的 business Tool 标记为计划外步骤；control Tool 和未知 Tool 不参与偏离判断。所有 ToolRun 仍在时间线保留真实执行卡，Workflow 不把额外 Tool 伪装成计划项。
- 当前工作区不展示独立 Workflow 卡或 Active Run Dock，避免在每轮 user 消息后和 Composer 上方重复出现低信息状态条。
- 隐藏汇总卡不删除规范事实：计划、Run 与 ToolRun 仍由 main + SQLite 持有，ToolActivity、审批、交互、失败和中断继续在统一时间线可见。

如果未来需要跨 Run 重试、共享产物或跨 Session 编排，应先扩展正式架构和持久化模型，不能在 UI 中先造一个 Workflow 引擎。

## 7. 受控展示协议

ToolActivity 的定制 body 只能渲染 `AgentPresentationBlock` 声明的固定语义块；user 与过程消息按纯文本展示，completed final 使用下述受限 Markdown：

```text
status / progress / approval / artifact / details
choice / form / notice
```

`agent-tool-presentation.ts` 是 Tool 结果到 UI 的本地 presenter 注册表：

- 新 Tool 的定制展示优先新增白名单 presenter 映射。
- 未知 Tool 只显示通用状态或清洗后的结果说明。
- 不得把 `call.input`、完整 `result.data` 或模型返回 JSON 自动做成表格、表单或按钮。
- `skill.activate` 等敏感结果只能消费 main 的 safe projection；禁止绕过 projector 读取 Skill instructions、allowlist 或内部能力信息。

共享协议已声明的 action 不等于已经具备处理器。当前实际接入：

```text
tree.revealNode
agent.interaction.submit
```

`artifact.preview` 和 `workspace.openNode` 虽已声明，但当前没有工作区处理器；UI 不能因为类型存在就表现成可用能力。新增 action 必须同时定义共享语义、main 安全投影或本地可信来源、中心 handler、失败反馈和验证，不能在卡片内部直接执行。

### 7.1 内容安全

- completed final 与 commentary 使用 `AgentMessageContent` 的受限 Markdown，支持标题、列表、表格与代码；final 保留复制回答，commentary 不显示整段复制按钮。HTML / MDX 不执行，链接只渲染文本，图片只渲染 alt，不产生导航或外部资源请求。过程说明使用普通正文颜色，不对整段应用扫光，不要求模型每次读文件都额外播报。
- 不得直接渲染模型或 Tool `call.input` 提供的 HTML、JSX、CSS、React props、回调、IPC channel、任意 URL、本地路径或可执行行为。用户当前请求明确给出的 `file.stage` / `file.upload` 来源显示路径只能经 main strict normalizer 和 public prepared action 回显在审批卡；canonical 路径、其他本机路径和任意目标路径仍禁止展示。
- 受限 Markdown 以 `react-markdown` 的 `skipHtml` 和元素白名单解析，不使用会求值 MDX 的组件。代码高亮、可点击链接、媒体内嵌或文件打开仍需先定义独立的安全和导航协议，不能因为 Markdown 支持而顺带放开。
- UI 文案不能暴露 API Key、Cookie、签名 URL、完整环境变量、进程参数、stderr 或本地隐私路径。
- Shell 与用户明确路径审批是上述规则的窄例外，但只能展示 main 生成的 public prepared action、逻辑 cwd、用户来源显示路径和已清洗日志投影；不得从 `call.input`、原始 stderr 或物理路径拼 UI。等待审批的 Shell 继续显示完整确认卡；其他 Shell 默认是无边框单行，只展示最低状态和来自 main public prepared action 的单行命令摘要，不展示输出预览、耗时、退出码或预览截断。只有具备 owner-bound 结果的单行可以点击，展开后以最高约 `156px`、内部滚动的紧凑 Shell 区域通过 opaque cursor 读取受控详细日志；日志确实过期或存在不可恢复缺口时，只在展开区弱提示。页面不能渲染完整进程采集或模型 Tool result，不能把日志正文回填到默认单行，也不能自行添加可执行入口。

## 8. 审批与交互边界

审批内联表单（组件仍名为 `AgentConfirmationCard`）：

- 可以维护尚未提交的 public prepared action 编辑稿，例如目标目录、文件名或格式。
- 批准或拒绝必须继续调用 `useAgentSession.resolveApproval` 对应的既有 bridge / IPC。
- UI 不直接执行目录创建、上传、保存或媒体进程，也不乐观标记 approved。
- 提交必须保留规范的 approval、Session、Run、prepared action 身份；main 每次批准都重新准备、校验并冻结动作。动作、预览、权限行为或私有执行绑定漂移时，原提交返回 `reapprovalRequired` 并由新的规范待确认卡继续展示，UI 不能把它当成拒绝或自行复用旧卡。SQLite CAS 成功后旧 approval 已不可操作，即使随后 Run / 事件投影失败也不能重新显示或重试旧卡。
- `approvalBusyIds` 是防重复提交的 UI 协调，不得删除后靠按钮动画替代。
- `full-access` 下已校验的非破坏性内置操作由 main 自动授权，不创建假 approval，也不靠 UI 隐藏待决记录。明确拒绝、未知工具、覆盖和长期记忆沿用各自的确认规则；选择保存位置与必要参数不是权限批准，仍可要求交互。

交互卡：

- 只能维护未提交的 choice / form 草稿。
- 提交必须走中心 `agent.interaction.submit` handler 和 `useAgentSession.submitInteraction`。
- `interactionBusyIds` 必须阻止并发重复提交。
- 提交后的回答和状态以 SQLite ToolActivity 为准；不能先在 UI 伪造 submitted。
- pending action 在恢复后仍要可发现；已决、过期、取消和中断状态保留为只读审计事实。

同一个 pending approval / interaction 同时只能有一个可编辑实例。当前由时间线中的规范 ToolActivity 承载编辑与提交，不在 Composer 上方复制第二份实例；不得在两处各维护一份表单草稿。

## 9. 组件职责与安全改动范围

| 文件 | 当前职责 |
| --- | --- |
| `AgentWorkspace.tsx` | 页面编排、AI 配置安全投影、manager mode、Composer、滚动和中心 action 分发 |
| `hooks/useAgentSession.ts` | 当前 Session renderer 投影、流式事件、恢复、scope 隔离、审批/交互和 renderer Tool 在途协调 |
| `agent-runs.ts` | Run 单调 revision 合并 |
| `agent-tool-activities.ts` | ToolActivity 合并和 Run 终态规范对账 |
| `agent-timeline.ts` | conversation / work journal / execution facts 的纯时间线排序、锚定和受控只读 Tool 分组；不生成独立 Workflow 卡 |
| `agent-workflow-projection.ts` | Run + Plan + ToolRun + assistant item 到主状态、当前/下一步和 Workflow 的纯投影 |
| `agent-tool-presentation.ts` | 受控展示块和 Tool presenter 白名单 |
| `AgentTimeline.tsx` | 时间线 item 分发、纯文本消息展示，以及 pending ToolActivity 的唯一可编辑实例 |
| `AgentMessageContent.tsx` | final/commentary 的受限 Markdown；final 默认有复制，commentary 关闭整段复制 |
| `agent-live-status.ts` / `AgentActivityText.tsx` | 规范快照到临时单行状态的纯投影，以及可停用的文字扫光 |
| `AgentSubmitButton.tsx` | 发送 / 停止命令语义；停止点击禁止触发表单默认提交 |
| `AgentWorkflowCard.tsx` | 保留的派生任务现场组件；当前工作区不挂载 |
| `AgentToolActivityCard.tsx` | Tool 状态、进度、结果和受控 action 展示 |
| `AgentToolIcon.tsx` | 工具摘要与内部记录共享的操作/状态轮廓图标 |
| `AgentActiveRunDock.tsx` | 保留的活跃 Run 展示组件；当前工作区不挂载 |
| `AgentToolActivityGroup.tsx` | Registry 元数据驱动的连续内部 Tool 折叠展示 |
| `AgentConfirmationCard.tsx` | 未提交 prepared action 编辑与审批入口 |
| `AgentInteractionBlock.tsx` | choice / form 草稿和提交入口 |
| `AgentSessionManager.tsx` | 本机当前 scope 的会话管理投影 |
| `AgentMemoryManager.tsx` | 当前 scope 的长期记忆管理投影 |

可以直接进行的 UI 改动：

- 空态、时间线、Composer、卡片、管理页的布局和视觉层级。
- 图标、间距、字号、颜色、圆角、响应式、滚动和符合 reduced-motion 的动效。
- 在不改变语义和状态 owner 的前提下拆分展示组件。
- 为新 Tool 复用现有 block / action 增加受控 presenter 和展示组件；只有对应 action 已有中心 handler 时才能显示为可用操作。
- 将历史审计事实折叠或分组；失败 Tool 默认折叠并保留手动查看入口，待确认、待输入和中断现场继续保持可发现。

必须先升级架构契约的改动：

- 新增状态 ID、展示块类型、action、IPC、持久化字段或跨页面 owner。
- 引入超出当前 Markdown 白名单的富文本、可导航链接、附件、图片理解、媒体预览或模型生成表单。
- 改变审批、交互、取消、恢复、Tool 执行或 Workflow 语义。
- 新增 Session / Run / ToolRun 的 renderer 持久化或缓存层。

当前附件和图片视觉能力按 [附件契约](built-in-agent-attachments.md) 接入，输入控件只展示既有准备、失败和规范附件结果；不得把不支持的文件格式或尚未完成的导入表现为可读取或成功。

### 9.1 Composer 与模型选择

- 输入法确认以 compositionstart/end 生命周期及原生 isComposing/keyCode 229 共同判断；兼容 compositionend 先于确认 Enter 的事件顺序，结束后 50ms 内的同次 Enter 按键序列不发送，keyup 清除该次确认锁。blur 清理局部状态，普通下一次 Enter 继续发送；运行中、Shift+Enter 语义不变。

- Agent 顶栏不再显示会话、长期记忆或新建按钮，也不保留toolbar DOM slot/portal。入口集中在会话目录底部：“会话管理”前放置由顶部标题移下来的历史图标，“新建会话”“归档”带同套细线图标，右侧保留OutlineIcon空心书签作为长期记忆入口；入口事件与busy状态仍归AgentWorkspace，不向LibraryDetail复制会话状态。
- 聊天界面的会话目录由 `AgentSessionPeek` 渲染在 AgentRoot 内，位于时间线滚动容器外。工作区宽于1246px时为常驻 aside，初始上/右边距各12px；不宽于该阈值时，在850px聊天栏被挤窄之前先向右滑出，再在原纵向位置显示48×32px的气泡页签，左端为半圆、右端为矩形，右边距仍为12px。气泡可用指针上下拖动或方向键/Home/End调整位置，不能水平移动；拖动松手不触发点击。点击后从同一纵向位置滑入非模态面板；点击外部、顶部收起按钮或Escape收起，选择/新建会话也会收起。Escape将焦点交还气泡，宽度跨越阈值后不自动重开浮层。
- 会话框两种模式均固定300px宽、480px高，分组内容变化不改变高度，面板和Composer均为20px圆角，取消原生纵向resize及右下角拖拽柄，高度只受可用空间限制，溢出仅在列表内部滚动。按住头部可在工作区内自由拖动整个框，拖动时禁用位移动画且不改变正文、输入框或目录预留宽度；松手、取消或丢失指针捕获后，以松手的top为准，用独立440ms动画仅沿水平方向吸附回右侧12px处。收起/打开/宽窄模式共用该纵向锚点，不重置到中央；仅在空间不足时约束边界，避免丢失操作入口。ResizeObserver和拖动位置只更新该目录组件的局部视图，不成为Session/Run状态源。
- 展开与收起均保持面板DOM，面板滑入/滑出、淡入/淡出与正文、Composer的占位和居中调整统一使用374ms及cubic-bezier(0.22, 1, 0.36, 1)，双向同时开始和结束；恢复常驻不额外延迟面板滑入。文字宽度独立于占位动画，不先缩窄再恢复。气泡在收起的原位置接续出现，其位移/淡入淡出同样延长70%至306ms/255ms；不能用display:none瞬间移除面板。隐藏期间立即设置aria-hidden/inert，完成可见性过渡前也不可聚焦操作；气泡、吸附与占位过渡均支持reduced-motion。气泡的位移过渡局部覆盖OutlineIcon对普通按钮关闭transition的规则，图标自身仍保持即时配色。
- 目录沿用当前owner/资料库的sessions投影，显示最近8个会话及当前选中项，每行仅展示标题，不显示时间或消息条数。新会话先以用户首次提问作标题，首轮完成后由main后台生成简短标题并写回同一title字段；未生成、失败和旧历史继续使用原提问，renderer不从回答首行猜标题。标题更新事件经独立onSessionTitleChanged回调只刷新当前scope列表，包括非当前会话的标题；不更新当前会话指针、不改变Run或消息，管理页的搜索条件继续保留。运行或恢复期间禁用切换、新建及长期记忆入口。会话/记忆管理页继续使用原完整视图；返回聊天时重新加载未筛选的最近会话。
- Composer 底栏仅保留上下文、模型/推理强度、权限模式和发送/停止。Agent 内模型与权限文字统一 12px、400 字重、20px 行高，权限图标使用独立居中槽位；不改变其他模块的共享模型控件排版。
- 权限选择使用与模型菜单一致的主题背景、8px 容器圆角和紧凑选项；当前选项同时显示主题色、选中底色和勾号，并提供 menuitemradio/aria-checked。选择经原 main 接口确认后才更新规范值，菜单开合不改变权限；保留键盘焦点和 Escape 关闭路径。
- 输入区不提供手动拖拽把手。文字区域（含底部42px工具栏和2px边框）初始120px、最高320px，随草稿内容与可用宽度自动增高/缩回，超出上限只在textarea内滚动。附件区独立计高且无附件不占位，即使文字区已到320px，加入附件仍向上增加附件区高度。占位文案为“从这里开始...”。
- `AI 服务配置`是 provider、Base URL、API Key 和当前启用档案的 owner；Agent 不复制一套服务配置页，也不提供 Key 查看入口。
- Agent 只保存具体模型和推理强度，不在 Composer 提供预算编辑入口，也不传入客户端预算覆盖。上下文和输出预算由 main 在每次 Run 启动时自动解析并冻结；遗留预算偏好在读取模型偏好时清理，不影响其他设置。当前没有真实 usage 的 renderer 投影，不显示推测的剩余百分比。细节见 `agent-model-context-and-reliability.md`。
- 模型列表继续通过 AI Service 的现有 bridge 读取当前启用档案，不允许页面自行向 provider 发 HTTP 请求。列表尚未读取时由模型菜单触发加载；失败后允许再次展开重试。
- 空闲时 `Enter` 提交，`Shift+Enter` 换行；IME composition 和 keyCode 229 的确认回车不提交。运行中输入框允许起草，回车不触发新 Run，发送按钮继续是既有停止入口；不自动发送草稿，不把此能力称为运行中插入指令或排队。提交前继续校验 owner scope、启用档案和模型。
- 会话最后一次执行为cancelled且没有新草稿/附件时，发送位置改为OutlineIcon细线播放按钮“继续任务”；点击调用受控resumeRunId流程，准备期间禁用，不能同时提交新消息。有草稿/附件时显示普通发送，新提问会解除旧节点的黄色暂停提示。继续不添加乐观用户消息，失败保留原暂停现场和用户新草稿。
- Composer 底栏标签显示“选中：名称”，来自 `LibraryDetail` 的只读投影；文件用 `buildFileFullName(name, ext)` 补全后缀，目录使用原名，悬停提示与可见文案一致。文件名、目录名或感知结果不能写死在 Composer，也不能升级成长期记忆。
- 内部优先是模型选择工具和目的地的默认偏好，不是本机禁令。Skill 也可以保留当前 Run 实际可用的宿主工具作为备选，UI 不隐藏这些能力或新增本机禁止开关。

## 10. 视觉与交互基线

- 索引摘要卡的标记入口使用统一 OutlineIcon 空心书签，点击选中仅使图标变紫罗兰，不增加背景、不展开标签输入框；再次点击取消。节点标记点与普通已标记节点同用紫罗兰，当前位置绿色仍优先；已有标签元数据保留兼容，取消时一并清除。

- 2026-09-10 位置配色更新：一基序号 5/15/25… 保留浅玫瑰金，10/20/30… 改用与顶栏同源的 --workspace-nav-accent 紫罗兰（亮色 #7850b8、暗色 #bd9af2），替代此前深玫瑰色。当前位置绿色优先于上述位置色和状态色，移开后恢复；当前位置到达正文底部时必须落在最后节点。

- 索引当前位置绿色优先于里程碑和标记；用户停止的黄色暂停提示及failed/interrupted的红色异常提示优先于当前位置绿色。正文距离滚动底部不超过2px时直接选择最后一轮，不要求最后一条提问到达视口顶部，否则短回答/折叠会让最后节点永远无法命中；其余位置继续用锚点二分查找。

- 聊天代码展示框的正文最大高度为 min(330px, 42vh)，长代码内部滚动，短代码按内容自然高度显示；语言/复制工具栏留在滚动正文外，整体宽度继续跟随消息列，不改动文档编辑器大小。

- Markdown 代码围栏在工具栏左侧显示语言标签，右侧仍为复制原始代码。语言由围栏标记解析，C++/JSON 等复用 components/code 的文档语法注册和 CodeMirror/Lezer parser；高亮只输出固定类别 span 和经过 React 转义的原文，不渲染模型 HTML，不挂载编辑器。无语言/未知语言保留纯文本，超过 64000 字符或解析未在限定预算内完成时降级原文。亮暗配色分别定义并覆盖全局文本重置，复制不含标签或高亮标记。

- 主导航 Agent 入口使用用户确认的星芒轮廓（A4），文件/工具/浏览器依次使用横线文件夹（F1）、水平滑杆（T1）、经纬球（B1）；只替换展示和 tooltip，不改变工作区切换或归档返回语义。

- 用户确认的复制及顶栏历史/记忆/新建使用共享 OutlineIcon，16px 空心轮廓、1.25px 实际描边；代码复制与回答复制保持同一种图形和原操作语义。按钮名称、热区、禁用状态不变，细节见 small-icon-rendering-guidelines.md。

- 索引点击按规范消息 ID 重新查找当前 DOM 锚点，不使用过期元素引用或仅靠数组位置。平滑定位期间屏蔽“接近底部”自动跟随判定；scrollend 结束定位保护，用户滚轮/拖动滚动条/滚动按键可接管。正文重新渲染使锚点断开后，索引跟踪需刷新锚点缓存。

- 重新加载 renderer/重启软件后，仅恢复的 Run completed 且有本轮非空、phase=final/status=completed 最终回答时默认折叠；运行中、停止、失败或中断但无最终回答的任务始终展开，不能手动折叠。用户显式展开/收起选择仍按 owner/资料库/会话/Run ID 保存在 renderer 内存，消息更新或同会话页面往返不覆盖选择，重启清空。最终回答硬条件优先于历史默认折叠和已有选择。

- 整轮折叠入口与自动折叠都要求 Run completed、本轮规范最终回答已完整到达，且没有待决审批/交互或活跃工具。中途失败后完成最终回答可折叠，只有终态状态而无最终回答不能折叠。cancelled 用时行显示“你在 1h 32m 21s 停止了任务”，不足一小时省略小时，依据 createdAt/finishedAt 计算并冻结。
- resumesRunId链接的执行段作为同一个逻辑任务展示：只保留原提问和索引节点、一个用时入口，后续执行的user目标审计条目不作为新提问渲染。计时累计各执行段而不包含暂停间隔；最新执行完成且有最终回答后，所有执行段的过程一起折叠，旧停止状态行不重复展示。规范消息和Run仍完整保存，组件不把旧cancelled Run改成completed。

- 索引摘要卡的纵向位置跟随悬停/聚焦节点中心及刻度内部滚动偏移，使用 100ms top 过渡；边界以整个 Agent 工作区和卡片真实高度计算，不以刻度条高度限制。短会话也必须能随节点移动；卡片内容/标签变化及窗口 resize 后重新测量，reduced-motion 关闭移动过渡。

- 索引色块直接使用 `background: var(--tick-color, var(--app-text-muted))`，不得依赖继承 currentColor；全局 `body *` 的 color 重置会使子 span 变为灰白色，导致状态色、里程碑色和波传播颜色失效。

- 聊天左侧刻度索引按规范 user message 顺序投影，第 5 次提问起显示，每轮一个刻度，垂直居中。可视高度最多 70 个 10px 槽位，并受工作区高度限制；更多记录在刻度区内滚动，不限制实际会话数量。所有刻度左端固定，标记点绝对定位，不推动短线。常态宽 6px、厚 2px、相邻色块空隙 8px，仅高亮当前项；悬停/聚焦及运行波峰固定 20px，两侧各三档递减，列表边缘直接截断，不重新分配峰值或范围。摘要仅展示该轮提问和最新 assistant 内容的有界原文片段，不额外调用模型。
- 点击索引定位提问并暂停自动跟随；正文滚动时每动画帧通过二分查找更新当前刻度，避免每次滚动全量扫描 DOM。窄工作区为索引预留左侧空间，消息和 Composer 继续等宽。方向键、Enter、焦点预览和 reduced-motion 降级均保留。
- 当前/活跃刻度为浅绿；main明确重连或待审批/交互为黄色，最后一个主动停止的节点也为黄色；接受继续或出现新的用户提问后清除旧暂停色。failed/interrupted失败或异常中断才使用红色，不从静默耗时猜测错误；续接取同一逻辑任务的最新Run状态，不额外创建刻度。运行波从最下方执行节点向上移动，约每140ms前进一项，越过顶部后间隔800ms重复。波经过有色节点时，仅使相邻短线自身渐变染色：源节点保持原色，强度越高影响范围越广，最多上下三项，距离越远颜色越淡，经过后恢复。没有背景染色、光晕、阴影或散射；已有语义色不被其他源覆盖。按一基序号 `%10 == 5` 使用浅玫瑰金、`%10 == 0` 使用较深玫瑰金，状态色优先。
- 波位置只属于展示动画，使用最多 30fps 的独立 RAF 驱动，不改变 Run 或消息。终态、隐藏文档、reduced-motion 及卸载时停止并清理 RAF/监听；传播计算仅访问当前波附近有限节点，不读取 DOM 或触发正文滚动。
- 运行律动仅在节点数 >=10 且存在活跃 Run 时启动，索引本身仍从第 5 次提问起显示。里程碑严格使用全会话一基位置：5/15/25… 为浅玫瑰色，10/20/30… 为较深玫瑰色，不按可见窗口重新编号。配色参考登录页：暗色浅/深分别为 #e8a7bc/#d88ca5，亮色为 #bd5d7b/#a84c67；有色节点使用完整不透明度，避免被常态灰度压淡。普通当前项及标签不覆盖里程碑色；活跃、等待、失败语义色优先，任务结束后恢复位置色，并可作为波经过时的染色来源。
- 索引支持本机书签标记，按账号/后端/资料库/会话隔离，只保存 message ID 与标记值；兼容已有最长 32 字符标签，不再提供输入入口。不缓存消息内容、状态或摘要，不是 Agent 长期记忆、授权或跨设备同步数据。切换会话重建局部交互态，管理页不显示索引。

- 以 `100%` 页面缩放验证，不用旧缩放掩盖尺寸问题。
- 亮色、暗色和跟随系统主题都使用现有 `--app-*` / Semi token，不引入只适配单主题的硬编码背景。
- 消息列与Composer保持等宽，优先维持850px。目录收起阈值按850px正文、64px左侧索引安全区、324px目录占位和8px滚动条余量计算，为1246px，不再等到正文被压到640px才收起。正文的实际宽度使用AgentRoot的容器宽度计算，最多850px；不以正在动画的父级padding或content box宽度作为上限。目录收起后先保持文字行宽并重新居中，继续缩窗，直到气泡模式下的可用宽度也不足850px（8px滚动条时约994px工作区宽度），才随窗口收窄和重新换行。气泡模式保留72px右侧安全区；气泡展开及头部自由拖动允许临时覆盖正文但不改动布局，停靠后的常驻目录仍有独立预留空间。尺寸、收起阈值、动画时序和拖动边界共用 `agent-session-directory-layout.ts`。
- 聊天栏收窄下限为640px。`LibraryDetail`在Agent模式下为整个右侧工作区保留784px，目录树到达该边界后不能继续拖宽；不是单独给Composer加min-width后把控件裁掉。已保存的过宽目录、从其他工作区返回、窗口缩小时都重新限制可见目录宽度，保持左侧索引和右侧气泡空间；暂时限制不覆盖目录树的已保存展开偏好。
- 会话管理页可以使用更宽的 `min(1120px, 100%)` 内容面；搜索框填满该内容面。会话标题保持单行省略，最近消息最多显示两行，长路径或无空格文本必须在卡片内部截断，时间、消息数和行内操作不能被横向挤出。
- Composer 文字区域高度范围是 `120px～320px`（含底栏和边框），附件区另行叠加；底部浮层留位继续按完整 Composer 的实际高度测量。
- 时间线独占覆盖完整 Agent 工作区的纵向滚动容器，滚动轨道一直延伸到窗口底部；Composer 是其同级的底部绝对定位浮层，不随消息滚动。两者共享列宽与左右安全间距，浮层按实际滚动条宽度避让轨道。Composer 下半部到窗口底部使用主题实色遮挡，消息不能从输入框下方露出；输入框自身完整可见。
- Composer 浮层通过 ResizeObserver 测量实际高度，时间线底部预留浮层高度加 18px，确保最后一条消息能完整滚到输入框上方；草稿自动增高、窗口宽度和管理模式往返后同步更新。观察器随实例清理，只保留布局测量，不新增会话或执行状态源。
- 时间线内部条目间距为 8px，普通工具标题最小高度 23px；Markdown 末尾不叠加多余段落 margin，工具记录与相邻正文保持紧凑节奏。
- 任务过程、连续读取组、单工具与 Shell 详情统一使用 `AgentDisclosureChevron` 的 1px 描边箭头；固定 20px 行高槽位，可见尖端以字行中线为基准，开合围绕同一图形中心旋转，不再混用 CSS 边框箭头和 Semi 实心箭头。工具入口保留悬停/键盘聚焦显现规则。
- 整轮过程展开/收起使用与工具详情一致的 220ms 高度过渡与 150ms 透明度过渡，条目间距同步收起，不累积空白。关闭时立即设置 aria-hidden 与 inert，动画期间也不可聚焦或点击；保留原组件实例，避免重建工具状态和未提交表单。reduced-motion 下取消过渡。
- 每轮在用户消息后显示无框用时行与细分隔线。计时来自 Run.createdAt；活跃期间每秒仅刷新计时组件，终态使用 finishedAt（缺失时使用 updatedAt），历史恢复不重新计时。格式为“用时 5m 2s”或“用时 1h 20m 31s”，包含等待审批和工具执行时间，不代表模型纯推理耗时。
- 仅在 Run completed 且已有规范最终回答、无未完成工具/待决交互时，自动隐藏该轮工作过程，留下用户消息、用时入口与最终回答；未完成或没有最终回答的异常现场始终可见。用时右侧使用 1px 细线 Chevron，可展开全部原始过程并再次收起。折叠只是本地可见性，不改变排序、事实或组件 key，不重挂载工具和表单；手动展开/收起暂停滚动跟随。没有过程的纯文本回答只显示用时，不提供空折叠入口。
- 时间线只在用户仍接近底部时自动跟随；用户向上阅读后，新 delta、进度或卡片展开不能强行拉回底部。用户主动展开 Tool、读取分组或 Shell 详情时立即暂停自动跟随，并关闭相关容器的浏览器 scroll anchoring，异步加载详情或后续状态更新不能在动画结束后再次把内容向上拉动；用户重新滚到底部后才恢复跟随。
- 管理模式隐藏 Composer，返回后恢复当前会话和合理的滚动跟随，不制造布局双层滚动。
- 工作区滚动条复用 `workspaceScrollbarStyles`，不能退回浏览器粗滚动条。
- 圆角、点击热区、字号和控件密度遵守 `docs/ui-display-readability-baseline.md` 与现有 `--app-radius-small / medium / large` 语义；菜单选项保持小圆角，普通可点击按钮优先中圆角，常驻强调动作和正方形强调态可使用大圆角或正圆。
- 正方形图标按钮必须有稳定宽高、可访问名称和清晰 focus；不能只靠 hover 暴露唯一操作。
- 进度使用 `role="progressbar"` 及 `aria-valuenow` 等语义；动态状态使用克制的 live region，避免流式 delta 每个字符都造成重复朗读。
- 动效不得改变状态先后或点击命中；`prefers-reduced-motion` 下取消非必要位移、旋转和错峰动画。

工作过程行和 `AgentToolActivityCard` 的旋转状态图标均提供 `prefers-reduced-motion` 降级；新增运行中动效必须沿用这一规则。

## 11. 验证门禁

自动化至少执行：

```bash
npm run lint
npm test
npm run build
```

状态和投影相关改动重点运行：

- `src/features/agent/agent-runs.test.ts`
- `src/features/agent/agent-tool-activities.test.ts`
- `src/features/agent/agent-timeline.test.ts`
- `src/features/agent/agent-workflow-projection.test.ts`
- `src/features/agent/agent-tool-presentation.test.ts`
- `src/features/agent/agent-stream-messages.test.ts`
- `src/features/agent/hooks/useAgentSession.test.ts`
- `electron/service/agent/agent-renderer-projection.test.ts`

布局和管理页相关改动还要覆盖：

- `src/features/agent/agent-composer-layout.test.ts`
- `src/features/agent/hooks/useAgentMemories.test.ts`
- `src/features/agent/components/AgentMemoryManager.test.tsx`
- 新增或修改组件自己的交互测试

手工至少检查：

- 空态、纯文本流式回答、准备、运行、进度、待确认、待输入、结果、失败、取消、中断和恢复后的状态。
- 会话新建、打开、搜索、重命名、删除；记忆查看、搜索、修改和删除。
- 切换资料库、账号或后端 scope 后旧消息、事件、busy 状态和 manager 查询不串入新 scope。
- 用户停留底部时自动跟随、向上阅读时不抢滚动；窄窗和宽窗均无横向溢出。
- 亮色、暗色、跟随系统、`100%` 缩放、键盘焦点和 `prefers-reduced-motion`。

测试资料库任何场景都禁止第一个资料库；`Win` 可用时优先使用 `Win`。当前公司环境使用 macOS 本机 MinIO 的非第一个资料库。涉及真实音频或视频的验证由用户操作，避免测试期间意外播放媒体。

## 12. 交付自检

交给 UI Agent 的改动在结束前必须回答：

1. 是否仍以 main + SQLite 为唯一执行事实源？
2. 是否保持 `search-home` 集成，没有新增 `agent-home` 平行状态？
3. 是否只从 revision-aware 规范投影渲染 Timeline / Tool 卡？
4. 是否保留待确认、待输入、失败、中断和 Tool 审计事实？
5. 是否只渲染受控展示块并经中心 handler 执行动作？
6. 是否没有把模型内容升级成 HTML、链接、回调、IPC 或任意 JSON UI？
7. 是否通过亮暗主题、窄宽窗口、100% 缩放、键盘和滚动跟随验证？
8. 是否补了与改动风险相称的测试和文档？

任何一项答案不明确时，先停在 UI 层，不要用临时状态、假数据或直连 IPC 把页面“做出来”。

## 13. 阶段交付与待优化项

2026-09-10 用户确认当前 UI 做阶段性提交，以下 review 问题保留到后续优化，不视为已修复：

- P2：自动恢复期间输入框仍可编辑，restore 成功的 setDraft('') 会清空这段时间输入的草稿。隔离测试已复现，应保护新增草稿或在恢复期间禁用输入。
- P2：索引摘要卡按 viewport 而非实际聊天区限宽，宽侧栏下可能被 ContentArea 裁切，右侧标记按钮不可达；需补聊天区横向边界适配。
- P2：70 项只是索引可视高度限制，运行波仍重绘全部节点；隔离测量 5000 节点单次 React 更新约 20ms，未计浏览器布局绘制。后续应限制渲染范围和动画更新范围。

最近完整 review 的 lint、2138 项测试与 build 通过；已做暗色主要路径检查，亮色、低 DPI、长索引连续动画及摘要卡窄栏实机验收仍需补齐。review 后已恢复测试前的侧栏宽度和文件视图，未修改真实文件内容。

## 附件输入补充

图片可点击打开遮罩预览并缩放，读取主进程保存的归一化清晰图，关闭可恢复焦点；只读 preview IPC 以 owner/library/id 校验，历史图额外要求会话绑定。图片按钮不触发发送或移除，移除按钮18px、内部X10px，上/右偏移2px；附件间距与附件至文字区顶部间距为10px。

附件输入布局按图片 82×72px、其他文件 164×72px；输入区顶/左各 10px，图片无名称行，文件在图标后单行省略。附件不换行，横向滚动条位于附件与输入正文之间并复用工作区样式。详细准备态/失败态与历史展示规则见附件契约。

Composer 在文本输入区上方展示按加入顺序排列的附件，图片使用小缩略图，文本使用文件名；异步准备不重排。粘贴图片与普通文本粘贴分开处理，选择文件与拖入使用同一队列。失败附件保留并可移除，不静默漏发；发送失败恢复原附件，历史用户消息保留同序缩略图与文件名。其他输入框控制项保持原布局职责。执行与持久化见 [附件契约](built-in-agent-attachments.md)。
