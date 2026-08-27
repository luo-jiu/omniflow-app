# 内置 Agent UI 契约

更新时间：2026-08-26

适用范围：

- `src/views/library/detail/`
- `src/features/library-workspace/`
- `src/features/agent/`
- `src/shared/agent/agent.types.ts` 中的展示协议
- 与 Agent 工作区直接相关的样式、组件测试和手工验证

本文是内置 Agent renderer UI 的权威契约。它回答“UI 可以怎样调整、状态从哪里来、哪些交互不能由页面自行实现”。Agent 的执行、持久化、IPC、安全和 Tool / Skill 事实以 `docs/built-in-agent-architecture.md` 为准；已经批准但尚未实现的 Shell UI / 日志 / 权限投影见 `docs/built-in-agent-shell-architecture.md`。

## 1. 阅读顺序与文档优先级

修改 Agent UI 前必须按顺序阅读：

1. `AGENTS.md`
2. `.agent-docs/frontend-review-standard.md`
3. `.agent-docs/frontend-handoff.md`
4. `.agent-docs/frontend-documentation-standard.md`
5. `docs/frontend-architecture-baseline.md`
6. `docs/library-detail-workspace.md`
7. `docs/built-in-agent-architecture.md`
8. 涉及 Shell 时继续读 `docs/built-in-agent-shell-architecture.md`
9. 本文
10. `docs/ui-display-readability-baseline.md`
11. `docs/frontend-validation-matrix.md` 的“内置 Agent”章节

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
| `localStorage` | 仅 `agent-model-preferences:v1` 的模型与推理强度本机偏好 | 会话历史、消息、Run、ToolRun、Workflow、审批、交互回答、长期记忆 |

规则：

- Timeline、Workflow、待确认、待输入和进度都是规范事实的投影，不能再放进 Zustand、Context、`localStorage` 或组件镜像数组成为第二份事实。
- 未提交的输入、审批编辑稿和交互表单值可以留在 renderer。发送消息时只允许插入带临时 ID、可由 `started` 和规范快照对账的乐观 user message，避免时间线跳位；Run、Tool、审批、交互回答和结果状态必须等待 main / SQLite 的规范回执，不能乐观伪造。
- API Key 仍由 AI 服务本机安全存储负责，Agent 页面只能读取安全配置投影，不能把 Key 写入消息、日志、Agent SQLite 或页面持久化。
- owner scope、账号、后端地址或 `libraryId` 变化时，必须立即清空旧投影、取消或收口关联的 renderer 在途工作，并拒绝迟到事件写入新 scope。

Agent 是通用前端分层里“renderer 负责编排”的明确例外：Agent loop、Run 生命周期、Tool 调度、审批决策和任务状态机由 Electron main 持有；renderer 只负责展示、用户草稿和 main 明确请求的一次性业务 executor 分发。不能引用通用规则把 Agent 状态机搬回 React。

### 3.1 工作区切换与卸载

`AgentWorkspace` 当前只在 `workspaceDisplayMode === 'search-home'` 时挂载。切到文件、浏览器、工具区或系统视图会卸载 Agent renderer，但不等于 owner / library scope 变化：

- 没有 renderer prepare / execution 的纯 main Run 可以在 UI 卸载后继续由 main 完成；返回 Agent 后从 Session 规范快照恢复，不依赖旧 React 实例。这里的“继续”不等于 detached OS 后台 Job：当前没有跨重启进程、PTY 或脱离 Run 生命周期的命令能力。
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
  -> Timeline / Workflow / Tool / Approval / Interaction 组件
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
- 临时 ToolActivity 通过 `id` 或 `runId + call.id` 与规范记录对齐。
- Run 终态事件携带的规范 messages / toolActivities 必须替换该 Run 的临时投影，不能继续拼补出另一份历史。

### 4.2 时间线顺序

- 规范 Message 顺序保持不变，不按浏览器收到事件的时间重新排序。
- Workflow 固定锚在对应 user message 之后。
- 同一 `runId + toolCallId` 已有 ToolActivity 时，历史 `role: tool` 消息在原位置由活动卡替换，不能重复显示两份。
- 没有持久 Tool message 的活动按同一 Run 的 `ordinal` 放到该 Run 最后一条消息之后。
- 只有损坏或遗留的孤儿记录才允许按时间作全局降级排序。
- Tool `ordinal` 是持久化审计顺序，UI 可以分组或折叠，但不能丢弃或自行重排执行事实。
- Timeline item 和卡片的 React identity 必须使用稳定的 message ID、Run ID 或 ToolActivity ID。待确认、待输入和其他含本地草稿的卡片不得使用数组 index、status、revision 或折叠层级作为 key；进度和 revision 更新不能通过重挂载清空未提交内容。

## 5. 状态展示契约

Run 和 ToolActivity 当前共享八种状态 ID：

| 状态 | 含义 | UI 约束 |
| --- | --- | --- |
| `preparing` | 已创建的 Tool 正在完成 renderer prepare、尚未进入真实执行 | 显示规范准备态，不伪造进度或副作用 |
| `awaiting_approval` | 等待用户批准准备好的动作 | 待决审批卡必须可见；只有规范 pending 审批可操作 |
| `awaiting_interaction` | 等待用户回答有限选择或表单 | 待决交互必须可见且可恢复 |
| `running` | provider 或 Tool 正在执行 | 使用规范进度；没有进度时只显示通用运行态 |
| `completed` | 规范完成 | 终态只读，可展示受控结果和产物动作 |
| `failed` | 执行失败 | 终态只读，显示清洗后的错误或结果说明 |
| `cancelled` | 用户或系统明确取消 | 终态只读，不能表现成失败或继续运行 |
| `interrupted` | 应用退出、恢复收口或运行链中断 | 终态只读，保留现场，不自动重放 |

状态文字、图标和卡片结构可以优化，但状态 ID、终态语义和可操作条件不能由 UI 改写。当前执行上限是 10 个 provider turn、8 次业务 Tool；控制 Tool 不占业务 Tool 配额。UI 不复制计数器或自行判断上限，只展示 main 返回的规范结果。旧文档中的“4 轮”属于过期描述。

`useAgentSession.isPreparing` 是另一个 renderer 局部 busy 状态，用于会话恢复、读取感知和创建 Run 前的启动协调；这时规范 Run / ToolActivity 可能尚不存在。UI 可以显示 Composer 级加载反馈，但不能把它伪造成 Workflow 步骤或持久化 `preparing` 状态。

## 6. Workflow 只是投影

`buildAgentWorkflowProjection()` 只从一个 Run 及其真实 ToolActivity 派生任务现场：

- 计划项只是一次性、不可改写的意图快照。
- 已绑定步骤的状态来自真实 ToolRun。
- 活跃 Run 中尚未绑定的计划项显示 `planned`；终态 Run 中显示 `not_run`。
- 偏离计划、重试或额外产生的 ToolRun 仍作为真实步骤展示。
- Workflow 卡可以调整密度、层级、折叠和动效，但不得保存自己的步骤状态、总进度或执行按钮逻辑。

如果未来需要跨 Run 重试、共享产物或跨 Session 编排，应先扩展正式架构和持久化模型，不能在 UI 中先造一个 Workflow 引擎。

## 7. 受控展示协议

ToolActivity 的定制 body 只能渲染 `AgentPresentationBlock` 声明的固定语义块；普通 `AgentMessage` 继续按纯文本渲染，`AgentWorkflowProjection` 继续由 Run + ToolRun 纯投影渲染，不需要转换成 block：

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

- 当前 assistant 消息按纯文本和换行展示，不支持 Markdown 富文本。
- 不得直接渲染模型或 Tool 提供的 HTML、JSX、CSS、React props、回调、IPC channel、任意 URL、本地路径或可执行行为。
- 原始链接、Markdown、代码高亮或媒体内嵌都属于新的安全协议；实现前必须明确 HTML 禁用、URL scheme / 导航白名单、内容清洗和外部打开策略。
- UI 文案不能暴露 API Key、Cookie、签名 URL、完整环境变量、进程参数、stderr 或本地隐私路径。
- 未来 Shell 是上述规则的窄例外，但只能展示 main 生成的 public prepared action、逻辑 cwd 和已清洗日志 tail；不得从 `call.input`、原始 stderr 或物理路径拼 UI。精确命令、风险、规则来源和有界详细日志动作必须先按 Shell 专题扩展受控 presenter，当前页面不能提前添加可执行入口。

## 8. 审批与交互边界

审批卡：

- 可以维护尚未提交的 public prepared action 编辑稿，例如目标目录、文件名或格式。
- 批准或拒绝必须继续调用 `useAgentSession.resolveApproval` 对应的既有 bridge / IPC。
- UI 不直接执行目录创建、上传、保存或媒体进程，也不乐观标记 approved。
- 提交必须保留规范的 approval、Session、Run、prepared action 身份；main 负责重新准备、校验并冻结动作。
- `approvalBusyIds` 是防重复提交的 UI 协调，不得删除后靠按钮动画替代。

交互卡：

- 只能维护未提交的 choice / form 草稿。
- 提交必须走中心 `agent.interaction.submit` handler 和 `useAgentSession.submitInteraction`。
- `interactionBusyIds` 必须阻止并发重复提交。
- 提交后的回答和状态以 SQLite ToolActivity 为准；不能先在 UI 伪造 submitted。
- pending action 在恢复后仍要可发现；已决、过期、取消和中断状态保留为只读审计事实。

## 9. 组件职责与安全改动范围

| 文件 | 当前职责 |
| --- | --- |
| `AgentWorkspace.tsx` | 页面编排、AI 配置安全投影、manager mode、Composer、滚动和中心 action 分发 |
| `hooks/useAgentSession.ts` | 当前 Session renderer 投影、流式事件、恢复、scope 隔离、审批/交互和 renderer Tool 在途协调 |
| `agent-runs.ts` | Run 单调 revision 合并 |
| `agent-tool-activities.ts` | ToolActivity 合并和 Run 终态规范对账 |
| `agent-timeline.ts` | Message、Workflow、ToolActivity 的纯时间线排序与锚定 |
| `agent-workflow-projection.ts` | Run + ToolRun 到 Workflow 的纯投影 |
| `agent-tool-presentation.ts` | 受控展示块和 Tool presenter 白名单 |
| `AgentTimeline.tsx` | 时间线 item 分发和纯文本消息展示 |
| `AgentWorkflowCard.tsx` | 派生任务现场展示 |
| `AgentToolActivityCard.tsx` | Tool 状态、进度、结果和受控 action 展示 |
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
- 引入 Markdown、任意链接、附件、图片理解、媒体预览或模型生成表单。
- 改变审批、交互、取消、恢复、Tool 执行或 Workflow 语义。
- 新增 Session / Run / ToolRun 的 renderer 持久化或缓存层。

当前附件和图片视觉能力尚未实现。正式 UI 不得添加暗示“可上传图片、可看图、可拖入附件”的控件、占位入口或成功状态；纯设计探索必须留在产品代码之外，等协议和执行能力完成后再接入主路径。

### 9.1 Composer 与模型选择

- `AI 服务配置`是 provider、Base URL、API Key 和当前启用档案的 owner；Agent 不复制一套服务配置页，也不提供 Key 查看入口。
- Agent 只保存具体模型和推理强度的本机偏好。选择变化只作用于后续 Run，不能改写已启动 Run 冻结的 profile、model 或 reasoning effort。
- 模型列表继续通过 AI Service 的现有 bridge 读取当前启用档案，不允许页面自行向 provider 发 HTTP 请求。列表尚未读取时由模型菜单触发加载；失败后允许再次展开重试。
- `Enter` 提交，`Shift+Enter` 换行；提交前继续校验 owner scope、启用档案和模型。运行中发送按钮切换为既有停止入口，不能新增只改变 UI、不取消 main Run 的“停止”。
- 当前上下文标签来自 `LibraryDetail` 的只读投影；文件名、目录名或感知结果不能写死在 Composer，也不能升级成长期记忆。

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

已知差距：当前 `AgentWorkflowCard` 和 `AgentToolActivityCard` 的旋转状态图标还没有 `prefers-reduced-motion` override。后续 UI 改动应补齐后再宣称满足该项；在此之前的手工验证必须明确记录这一残余问题。

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
3. 是否只从 revision-aware 规范投影渲染 Timeline / Workflow / Tool 卡？
4. 是否保留待确认、待输入、失败、中断和 Tool 审计事实？
5. 是否只渲染受控展示块并经中心 handler 执行动作？
6. 是否没有把模型内容升级成 HTML、链接、回调、IPC 或任意 JSON UI？
7. 是否通过亮暗主题、窄宽窗口、100% 缩放、键盘和滚动跟随验证？
8. 是否补了与改动风险相称的测试和文档？

任何一项答案不明确时，先停在 UI 层，不要用临时状态、假数据或直连 IPC 把页面“做出来”。
