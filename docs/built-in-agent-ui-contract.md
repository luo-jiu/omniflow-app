# 内置 Agent UI 契约

上下文计量与 Run.contextUsage 持久化继续保留，但 Composer 暂不挂载统计展示，也不占位。最终展示留到 UI 收尾阶段，只保留一个必要数字，不恢复多项统计行或预算编辑入口。详细口径见 [上下文计量](agent-context-accounting.md)。

`file.grep` 沿用无框工具行，hasMore 显示“可继续”，扫描结束但 complete=false 显示“结果不完整”。skipped 与续搜信息保留在规范结果中，不能把空匹配页画成完整无结果。正文搜索不新增目录树状态或宿主路径跳转能力。

文件工具支持显式 host 范围及 `file.read` 正文读取，继续使用无框紧凑行。正文未读完显示“可继续”；本机结果只显示路径，不生成 `tree.revealNode`。现有审批仍绑定 main ToolRun，不由 renderer 推断 host 是否已授权。契约见 [Agent 统一文件读取](agent-unified-file-reading.md)。

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

Agent 工作区内部有四种展示形态：

```text
空会话       居中空态 + Composer
当前会话     Timeline + 底部 Composer
会话管理     SessionManager，隐藏 Composer
记忆管理     MemoryManager，隐藏 Composer
```

- 会话管理和记忆管理是 `AgentWorkspace` 内部 manager mode，不是 Library Detail 工作区模式。
- 从管理页返回时回到当前会话，不创建、恢复或切换另一个工作区实例。
- 当前待确认或待输入任务不能被默认折叠到无法发现的位置；用户必须能恢复并完成或停止它。
- 新增页面分区时，优先拆展示组件，不新增平行的 Session、Run、ToolRun 或 Workflow store。

## 3. 状态所有权

| Owner | 负责 | 不负责 |
| --- | --- | --- |
| `LibraryDetail` | `workspaceDisplayMode`、当前资料库、根目录、目录树选中项，把只读上下文投影给 Agent | Agent 会话、消息、Run、ToolRun、确认、长期记忆副本 |
| `AgentWorkspace` | 页面编排、manager mode、Composer 高度、模型偏好 UI、会话列表查询、滚动跟随与受控 action 分发 | 执行状态机、规范消息、Tool 成败、审批结果 |
| `useAgentSession` | 当前 renderer Session 投影、输入草稿、流式增量、恢复协调、scope 防串、审批/交互 busy ID 和 renderer Tool 的在途协调 | 持久化事实、业务权限、规范终态 |
| `useAgentMemories` | 当前记忆管理页的查询、分页、mutation 投影和请求代次隔离 | 长期记忆主存储、召回事实和未提交表单字段 |
| 审批 / 交互 / 记忆编辑组件 | 当前卡片尚未提交的字段草稿 | 已提交决策、规范状态和持久化事实 |
| Electron main + SQLite | Session、Run、Message、ToolRun、审批/交互决策、长期记忆的唯一规范事实 | React 布局和页面视觉状态 |
| `localStorage` | `agent-model-preferences:v1` 的模型与推理强度；读取时清理已退役的 `agent-model-budget:v1:*` 键 | 会话历史、消息、Run、ToolRun、Workflow、审批、交互回答、长期记忆、预算覆盖 |

规则：

- Timeline、Workflow、待确认、待输入和进度都是规范事实的投影，不能再放进 Zustand、Context、`localStorage` 或组件镜像数组成为第二份事实。
- 未提交的输入、审批编辑稿和交互表单值可以留在 renderer。发送消息时只允许插入带临时 ID、可由 `started` 和规范快照对账的乐观 user message，避免时间线跳位；Run、Tool、审批、交互回答和结果状态必须等待 main / SQLite 的规范回执，不能乐观伪造。
- API Key 仍由 AI 服务本机安全存储负责，Agent 页面只能读取安全配置投影，不能把 Key 写入消息、日志、Agent SQLite 或页面持久化。
- owner scope、账号、后端地址或 `libraryId` 变化时，必须立即清空旧投影、取消或收口关联的 renderer 在途工作，并拒绝迟到事件写入新 scope。

Agent 是通用前端分层里“renderer 负责编排”的明确例外：Agent loop、Run 生命周期、Tool 调度、审批决策和任务状态机由 Electron main 持有；renderer 只负责展示、用户草稿和 main 明确请求的一次性业务 executor 分发。不能引用通用规则把 Agent 状态机搬回 React。

### 3.1 工作区切换与卸载

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
- Tool 分组只读取 main 投影的 `kind / risk / groupKind / operationKind`，不能在组件按名称猜。只有同 Run、连续、成功、无需审批或交互、同 `groupKind` 的只读 Tool 可以合并；写入、外部操作、破坏性操作、未知 Tool、Shell、失败、取消、中断、commentary、审批和交互都断组。分组 key 始终从首个 ToolRun ID 派生。

## 5. 状态展示契约

2026-09-07 起，ToolActivity、读取分组、审批和交互统一使用无框紧凑行或内联表单，不再绘制浮动卡片。文件名经受控 `tree.revealNode` 操作定位，成功详情按需展开；失败和待决输入不能默认隐藏。完整规则见 `agent-media-availability-and-permissions.md`。

Run 和 ToolActivity 当前共享八种状态 ID：

| 状态 | 含义 | UI 约束 |
| --- | --- | --- |
| `preparing` | 已创建的 Tool 正在完成 main-owned 或 renderer-owned prepare、尚未进入真实执行 | 显示规范准备态，不伪造进度或副作用；main-owned prepare 不要求 renderer 事件 |
| `awaiting_approval` | 等待用户批准准备好的动作 | 待决审批卡必须可见；只有规范 pending 审批可操作 |
| `awaiting_interaction` | 等待用户回答有限选择或表单 | 待决交互必须可见且可恢复 |
| `running` | provider 或 Tool 正在执行 | 使用规范进度；没有进度时只显示通用运行态 |
| `completed` | 规范完成 | 终态只读，可展示受控结果和产物动作 |
| `failed` | 执行失败 | 终态只读，显示清洗后的错误或结果说明 |
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

- completed final 使用 `AgentMessageContent` 的受限 Markdown，支持标题、列表、表格、代码与复制；HTML / MDX 不执行，链接只渲染文本，图片只渲染 alt，不产生导航或外部资源请求。过程说明继续按纯文本展示。
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
| `AgentMessageContent.tsx` | completed final 的受限 Markdown 与复制，按稳定 content 复用，避免流式增量重解析历史 |
| `AgentSubmitButton.tsx` | 发送 / 停止命令语义；停止点击禁止触发表单默认提交 |
| `AgentWorkflowCard.tsx` | 保留的派生任务现场组件；当前工作区不挂载 |
| `AgentToolActivityCard.tsx` | Tool 状态、进度、结果和受控 action 展示 |
| `AgentActiveRunDock.tsx` | 保留的活跃 Run 展示组件；当前工作区不挂载 |
| `AgentToolActivityGroup.tsx` | Registry 元数据驱动的连续只读 Tool 折叠展示 |
| `AgentConfirmationCard.tsx` | 未提交 prepared action 编辑与审批入口 |
| `AgentInteractionBlock.tsx` | choice / form 草稿和提交入口 |
| `AgentSessionManager.tsx` | 本机当前 scope 的会话管理投影 |
| `AgentMemoryManager.tsx` | 当前 scope 的长期记忆管理投影 |

可以直接进行的 UI 改动：

- 空态、时间线、Composer、卡片、管理页的布局和视觉层级。
- 图标、间距、字号、颜色、圆角、响应式、滚动和符合 reduced-motion 的动效。
- 在不改变语义和状态 owner 的前提下拆分展示组件。
- 为新 Tool 复用现有 block / action 增加受控 presenter 和展示组件；只有对应 action 已有中心 handler 时才能显示为可用操作。
- 将历史审计事实折叠或分组，但默认不能隐藏待确认、待输入、失败和中断状态。

必须先升级架构契约的改动：

- 新增状态 ID、展示块类型、action、IPC、持久化字段或跨页面 owner。
- 引入超出当前 Markdown 白名单的富文本、可导航链接、附件、图片理解、媒体预览或模型生成表单。
- 改变审批、交互、取消、恢复、Tool 执行或 Workflow 语义。
- 新增 Session / Run / ToolRun 的 renderer 持久化或缓存层。

当前附件和图片视觉能力尚未实现。正式 UI 不得添加暗示“可上传图片、可看图、可拖入附件”的控件、占位入口或成功状态；纯设计探索必须留在产品代码之外，等协议和执行能力完成后再接入主路径。

### 9.1 Composer 与模型选择

- `AI 服务配置`是 provider、Base URL、API Key 和当前启用档案的 owner；Agent 不复制一套服务配置页，也不提供 Key 查看入口。
- Agent 只保存具体模型和推理强度，不在 Composer 提供预算编辑入口，也不传入客户端预算覆盖。上下文和输出预算由 main 在每次 Run 启动时自动解析并冻结；遗留预算偏好在读取模型偏好时清理，不影响其他设置。当前没有真实 usage 的 renderer 投影，不显示推测的剩余百分比。细节见 `agent-model-context-and-reliability.md`。
- 模型列表继续通过 AI Service 的现有 bridge 读取当前启用档案，不允许页面自行向 provider 发 HTTP 请求。列表尚未读取时由模型菜单触发加载；失败后允许再次展开重试。
- 空闲时 `Enter` 提交，`Shift+Enter` 换行；IME composition 和 keyCode 229 的确认回车不提交。运行中输入框允许起草，回车不触发新 Run，发送按钮继续是既有停止入口；不自动发送草稿，不把此能力称为运行中插入指令或排队。提交前继续校验 owner scope、启用档案和模型。
- 当前上下文标签来自 `LibraryDetail` 的只读投影；文件名、目录名或感知结果不能写死在 Composer，也不能升级成长期记忆。
- 内部优先是模型选择工具和目的地的默认偏好，不是本机禁令。Skill 也可以保留当前 Run 实际可用的宿主工具作为备选，UI 不隐藏这些能力或新增本机禁止开关。

## 10. 视觉与交互基线

- 以 `100%` 页面缩放验证，不用旧缩放掩盖尺寸问题。
- 亮色、暗色和跟随系统主题都使用现有 `--app-*` / Semi token，不引入只适配单主题的硬编码背景。
- 消息列与 Composer 当前共享 `clamp(560px, 72%, 900px)`；窄于最小宽度时保留左右 `16px` 安全间距并继续收缩，不能产生横向溢出。
- Composer 高度范围是 `78px～260px`，初始 `96px`；向上拖动增高、向下拖动缩小，键盘方向键也必须可调。
- 时间线只在用户仍接近底部时自动跟随；用户向上阅读后，新 delta、进度或卡片展开不能强行拉回底部。
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
