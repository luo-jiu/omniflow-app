# 内置 Agent 架构

更新时间：2026-08-24

适用范围：

- `src/shared/agent/`
- `src/features/agent/`
- `electron/ipc/agent.ts`
- `electron/service/agent/`
- Agent 使用的 AI 服务访问边界

未来 Tool、Skill、向量检索和媒体处理能力的设计草案见 `docs/wip/built-in-agent-development-notes.md`。本文只记录已经落地的稳定边界。

## 1. 当前能力

内置 Agent 当前提供：

- 资料库工作区中的流式文本对话。
- OpenAI-compatible 和 Claude provider 适配。
- 受控只读 `file.list` / `file.stat` Tool Calling。
- 受控只读 `media.inspect`：按当前感知节点取得短期链接，并通过本机 `ffprobe` 返回清洗后的容器和媒体流元数据。
- 经过确认的 `directory.create` 写操作，以及执行后的目录树刷新和再感知。
- 经过确认的 `media.extractAudio`：从当前感知范围内的单个媒体文件提取第一条音轨，上传回当前目录，并刷新目录树和再感知。
- main / renderer Tool 的统一执行分发，以及只由已注册媒体 Tool 间接使用的受控本地进程基座。
- 本机会话分页列表、搜索、新建、打开、重命名和删除。
- 等待确认状态持久化、应用重启后的会话恢复，以及未完成运行的中断标记。
- 由持久化 ToolRun 驱动的统一 Agent 时间线：实时进度、确认、结果、产物和中断状态在恢复后保持一致。
- 由规范 Run + ToolRun 派生的任务现场：当前阶段、已实际执行步骤和终态可实时展示并从 SQLite 恢复，不在 renderer 复制第二套任务状态。
- Run 内一次性受限计划：复杂任务可以先声明 2 至 8 个预计由 Tool 支撑的步骤，任务卡再把这些计划步骤与真实 ToolRun 关联展示。
- 受控展示块与语义动作注册表；当前可展示通用状态、进度、媒体信息和资料库产物，并可安全定位结果节点。
- 受控 `interaction.request`：当任务确实缺少有限选择或少量参数时，在同一个 ToolActivity 中展示选择卡片或表单，回答持久化后恢复原 Run，且只允许提交一次。
- 有界上下文投影与会话摘要：完整 transcript 保留在 SQLite，provider 只接收结构化摘要、独立的近期规范 ToolRun 事实、近期完整 Run 和当前 Run；摘要以两阶段 checkpoint 持久化，失败时退回确定性的有界近期历史。
- 仅本机长期记忆：用户明确要求记住时，`memory.propose` 先生成完整提案并复用 Tool 审批卡；批准后才保存 `preference / project / reference`。每个 Run 只召回少量相关记录，并以独立低权限消息投影；管理页支持查看、搜索、修改和删除。

当前不提供任意 Shell、通用文件写入、通用媒体转码 Tool、可重写计划、跨多轮 Workflow、自动恢复未完成运行、后台自动记忆提取、跨机器同步或向量检索。`AgentLocalProcessRunner` 只被 `media.inspect`、`media.extractAudio` 等具体 Tool 内部使用，不是模型可调用的 Tool。

## 2. 分层与所有权

```text
AgentWorkspace / useAgentSession
  只持有输入草稿、当前会话投影、确认交互和流式展示态
       |
agent.api -> preload electronAgent
  受控 IPC 契约，不暴露 SQLite 和 AI 凭据
       |
electron/ipc/agent.ts
  校验主窗口 sender，管理 renderer 销毁时的运行取消
       |
AgentOrchestrator
  会话续接、Run 生命周期、权限门、Tool loop、流式事件和安全上限
       |                    |                         |
AgentContextManager      AgentToolBroker             AI Service
  有界上下文投影           main / renderer 执行分发     provider、模型请求和 API Key
  无 Tool 摘要调用                |
       |                 memory.propose 审批后写入
AgentSessionStore               |
  SQLite 会话事实          AgentMemoryStore -> MemoryRetriever
  两阶段摘要 checkpoint      SQLite 记忆事实    结构化 Top-K 投影
                               |
             media.inspect / media.extractAudio
                Renderer 临时链接 -> main 一次性能力校验
                   -> 本机 loopback 代理 -> ffprobe / ffmpeg
                               |
                    AgentLocalProcessRunner
                      受控进程生命周期基座
                               |
                  AgentMediaArtifactStore
                 临时产物配额、所有权、TTL 和清理
                               |
                  Renderer 复用现有 MinIO 直传
```

状态所有权约束：

- SQLite 是 Session、Run、Message、ToolRun 和已确认长期记忆的唯一持久化事实源；召回排序与 provider 消息都是可重建投影。
- Renderer 不把会话历史复制到 `localStorage`，只保留本机模型 / 推理强度偏好和临时展示状态。
- `LibraryDetail` 只向 Agent 投影当前 `libraryId`、目录和选中节点，不持有 Agent 会话副本。
- API Key 继续由 AI Service 的本机安全存储负责，禁止进入 Agent 数据库、消息或事件。
- 会话 owner 由规范化 `VITE_API_BASE_URL`、数字用户 ID 和 `libraryId` 共同确定；同一台机器切换账号或后端环境时不得复用其他 owner 的会话。
- 长期记忆按同一 `backend_scope + account_scope` 隔离；`library_id IS NULL` 表示用户级记忆，非空值只能在对应资料库读取。Renderer 只持有管理页临时投影，不能直接打开数据库。

## 3. 本地数据模型

数据库位置：

```text
app.getPath('userData')/agent-sessions.sqlite3
```

关系：

```text
agent_sessions
  ├─ agent_messages
  ├─ agent_context_checkpoints
  └─ agent_runs
       └─ agent_tool_runs

agent_memories
  独立于 Session 生命周期的已确认长期记忆
```

- `agent_sessions`：按 `backend_scope + account_scope + library_id` 隔离，保存标题、最新安全上下文、消息预览和生命周期时间。
- `agent_runs`：一次用户提交对应一个 Run，保存 provider 配置 ID、模型、推理强度、状态、当前步骤、错误、可空的受限计划快照和从 `1` 起单调递增的 `revision`。
- `agent_messages`：按 Session 内单调递增的 `sequence` 排序，保存 user / assistant / tool 消息。
- `agent_context_checkpoints`：append-only 的派生摘要记录，保存 base checkpoint、覆盖到的消息和 `sequence`、模型来源及 `started / completed / failed / interrupted` 状态。只有 `completed` 能进入 provider 投影；它不改变 Session 排序、预览、消息数或任何 Run / ToolRun 事实。
- `agent_tool_runs`：保存 Tool 输入、结构化结果、最新进度、权限决策、确认快照、交互请求 / 回答、Run 内稳定 `ordinal`、可空的 `plan_step_id`、从 `1` 起单调递增的 `revision` 和运行状态，不把 Tool 状态压进聊天文本作为唯一事实。交互字段为 `interaction_id / interaction_request_json / interaction_status / interaction_response_json / interaction_decided_at`，请求和最终回答都归属于原 ToolRun。
- `agent_memories`：只保存已经确认的 `preference / project / reference`，正文拆分为标题、规则、保存原因和适用场景，同时记录 global / library scope、来源 Session / Run、创建时间、更新时间和乐观锁 `revision`。删除 Session 不删除已经确认的长期记忆。

创建 Run 和首条用户消息必须原子完成。当前由 SQLite 的 `agent_runs_create_user_message` trigger 在插入 Run 时同步创建 user message，避免进程退出后出现只有 Run 或只有消息的半状态。

当前 schema 标记保持为 `2`。v1 升级时原有会话保留为不可认领的 `legacy` scope，不能自动暴露给升级后首先登录的账号；新会话写入完整 owner scope。项目仍处于未正式发布阶段，确认审计字段、进度字段、交互字段、Run / ToolRun `revision`、Tool `ordinal`、Run `plan_json`、ToolRun `plan_step_id` 和上下文 checkpoint 表直接并入当前建表定义；本机已有的 schema 2 数据库幂等补列或补表，已有 Run / ToolRun 的 `revision` 初始化为 `1`，并按既有 `rowid` 回填 Run 内 Tool 顺序，原地兼容且不新增 schema 版本。`agent_memories` 也由独立 Store 在同一数据库中幂等建表，不改变 `user_version`。开发期间曾短暂写入过 `user_version = 3`；启动时仅在四张核心表和确认审计字段均匹配该已知中间结构时保留数据并把标记归回 `2`，其他更高版本或未知结构仍拒绝打开。不能在无法证明归属时自动认领历史数据。

Run / ToolRun 每次成功状态 mutation 都在同一条 SQL 中执行 `revision = revision + 1`；`updatedAt` 只用于展示与会话列表时间，不承担并发版本语义。SQLite trigger 保证 completed Run 不能仍有开放 Tool，failed / cancelled / interrupted Run 会原子收口遗留 Tool；终态 Run 之后也禁止新增 Tool 或把既有 Tool 重新切回 active 状态，直接 SQL 不能绕过该不变量。

### 3.1 长期记忆闭环

- 写入入口只有 `memory.propose`。模型只有在用户明确表达“记住”“以后都这样”或同义意图时才能调用；普通对话、当前任务状态、可重新读取的文件事实和后台自动提取都不能静默写入。
- 提案的 Schema、领域字段和敏感信息检查先于 ToolRun、审批和副作用。Tool 的动态权限固定返回 `ask`；审批前只在原 ToolRun 中保留待确认输入，`agent_memories` 中没有 pending row。拒绝、停止、超时和重启都不会保存。
- 保存内容必须同时包含规则、原因和适用场景。API Key、Authorization、Cookie、密码、token、私钥和签名 URL 在 Tool 与管理页更新边界都被拒绝，不做“清洗后继续保存”。
- `project` 只能绑定当前资料库；`preference / reference` 可为用户级或资料库级。所有 CRUD 都重新校验 owner scope，资料库页面只能访问 global 与当前 `libraryId` 的记录。
- 修改和删除携带 `revision`，冲突时拒绝覆盖。保存先落 SQLite，再把稳定 memory ID 与 revision 返回 Tool loop；管理页 mutation 直接使用 main 返回的 authoritative 快照更新、重排或移出当前查询，不追加一次会折叠已加载分页的写后全量重载。
- 管理页的 owner / 资料库 scope、搜索、分页、错误和 CRUD 临时投影只由 `useAgentMemories` 持有。scope 在提交后失效旧请求，查询也有独立代次；切换账号、API 基址、资料库或搜索词后，迟到响应和旧 mutation 不能写回新投影。首屏失败显示可重试错误，下一页失败保留已有列表和游标。
- 管理列表按 `updatedAt + memoryId` 稳定游标分页，每页 50 条，并返回当前搜索条件下的真实 `total`；搜索由 SQLite 执行，不受 renderer 已加载页限制。任一 owner 的“global + 当前资料库”可见集合最多 200 条，第 201 条在 SQLite 写入边界明确拒绝；不同资料库的 project 记忆不会互相占满配额，同时召回候选的 200 条上限仍覆盖当前可见完整事实集。初始化会删除并重建当前 quota trigger，避免原地 schema 沿用旧定义；开发期遗留数据库如果已经超限，不自动删除数据，管理页仍可分页清理，但 Retriever 会拒绝部分截断的候选集，清理到 200 条后恢复召回。
- 第一版 `MemoryRetriever` 使用结构化 scope 候选、确定性关键词排序、语义去重、最多 5 条和 6,000 字符预算。当前显式要求忽略记忆时不查询 Store。FTS5 和向量召回尚未接入，但可在 Retriever 后替换或组合，SQLite row 始终是事实源。
- 候选召回发生在每个 Run 的预算预检之前，同一 Run 使用同一份快照，但记忆不占用当前请求的预检预算。系统先完成规范近期历史投影，再只用其剩余 token 预算装入记忆；无剩余预算时本轮不注入记忆，也不能为了保留记忆裁掉近期历史。投影是独立的 user / assistant 低权限 envelope，不进入 system role、不持久化回 transcript，也不能授权 Tool；当前请求、重新感知和安全策略始终优先。删除后从下一 Run 起立即不再召回。

## 4. 生命周期与恢复

```text
用户提交
  -> 按 owner + 当前资料库结构化召回少量长期记忆候选
  -> 解析当前模型预算并预检 system + Tool schema + 当前 user message
  -> 预算不足时明确拒绝，不创建 Session / Run 或发送 provider 请求
  -> 创建或校验 Session
  -> 原子创建 Run + user message
  -> 返回 sessionId / runId 并发布 started
  -> 组装 system + Tool schema + 完整请求预算
  -> 超过预算时创建 started checkpoint
  -> 无 Tool 摘要成功并校验后发布 completed checkpoint
  -> 从最新 completed checkpoint 重建有界 provider 投影
  -> 只用规范 provider 投影的剩余预算装入长期记忆
  -> 流式执行 provider / Tool loop
  -> 执行任一 Tool 前原子预检整轮业务 Tool 配额和全部最小合法结果消息
  -> 写操作进入 awaiting_approval 并等待精确动作确认
  -> 缺少有限参数时，interaction.request 进入 awaiting_interaction
  -> 用户一次性提交受控回答后，原 ToolRun / Run 回到 running
  -> 批准后由一次性 Renderer execution request 执行
  -> 只读 Renderer Tool 由 main 生成一次性 execution request 后自动派发
  -> 写入成功后立即提交 authoritative result
  -> 刷新目录树并重新感知真实结果
  -> Renderer 提交包含最新感知的最终结果
  -> 持久化 assistant / tool message
  -> Run 进入 completed / failed / cancelled
```

恢复规则：

- 进入资料库 Agent 首页时恢复该资料库最近更新的会话。
- 会话管理页可打开其他历史会话；新建会话只清空当前展示投影，不删除历史。
- 会话列表使用稳定的 `updatedAt + sessionId` 游标分页，每页 50 条，同时返回当前查询的真实总数；搜索由 SQLite 执行，不受 renderer 已加载页限制。
- 切换资料库时立即清空旧资料库投影；迟到的列表响应和流式事件不得写入新资料库界面。
- 切换资料库或卸载 Agent 页面时，仍在读取感知快照的待提交请求不得继续启动 provider；已经跨过启动边界的迟到请求收到 `sessionId` 后立即停止。
- 恢复仍在运行的 Session 时，Renderer 在 SQLite 快照读取期间暂存该 Session 的流式事件，再以快照为基线顺序补入，避免丢失中间增量。
- SQLite 打开时将遗留的 `running` / `awaiting_approval` / `awaiting_interaction` Run 和 ToolRun 标记为 `interrupted`；待确认动作和待回答交互都不会跨应用重启继续有效。
- SQLite 打开时同时把遗留的 `started` 上下文 checkpoint 标记为 `interrupted`。半成品、失败或损坏摘要永不成为激活边界；恢复时继续以完整 Message / Run / ToolRun 为事实源重建投影。
- `interrupted` 只表示上次应用退出时未完成，不自动重放 provider 请求或 Tool。
- 当前目录和选中节点每轮重新感知，数据库里的历史上下文不作为当前文件事实。
- 活跃 Run 不能删除；同一个 Session 同时只允许一个 Run 进入启动或运行阶段。
- 普通工作区切换允许纯 main Run 留在后台继续。Renderer 写操作在后端确认创建节点前，页面卸载或 scope 切换会中止上传并停止 Run；已经提交 authoritative result 后不再撤销已完成的写入，而是等待最终结果回执后停止 Run。注销、401 清理或主窗口销毁必须取消该窗口的全部 Run，不能把旧账号任务带入新认证会话。
- 每个 Run 在启动边界读取一次 AI Service 连接快照并锁定来源配置；后续 Tool 轮次和无 Tool fallback 均使用同一份 provider、Base URL 和 Key。完成、失败、停止或 owner 销毁后释放锁。

## 5. IPC 契约

请求：

```text
agent:chat:start
agent:chat:stop
agent:owner:release
agent:tool:approval:resolve
agent:interaction:submit
agent:tool:execution:commit
agent:tool:execution:complete
agent:tool:execution:progress
agent:media:inspect
agent:media:extract-audio
agent:media:artifact:release
agent:session:list
agent:session:get
agent:session:rename
agent:session:delete
agent:memory:list
agent:memory:update
agent:memory:delete
```

事件：

```text
agent:chat:event
  started
  run-updated
  delta
  tool-started
  tool-progress
  tool-execution-requested
  tool-execution-cancelled
  tool-approval-required
  tool-approval-resolved
  tool-interaction-required
  tool-interaction-resolved
  tool-completed
  completed
  cancelled
  error
```

每个流式事件同时携带 `sessionId` 和 `runId`。`started` 与 `run-updated` 携带 SQLite 返回的完整 `AgentRunSnapshot`；Run 终态事件也携带该 Run 的规范快照。Renderer 只消费当前 Session 的事件，按持久化 `revision` 单调合并并拒绝终态回退；`updatedAt` 不参与版本比较。创建新 Session 时允许在 `start` IPC 返回前短暂缓存该 Session 的抢跑事件，恢复活跃 Session 时也只为目标 Session 暂存快照读取期间的事件。Tool 开始、进度、确认和完成事件携带对应的规范 ToolActivity 投影；renderer 同样按 ToolRun `revision` 拒绝迟到快照。完成、取消或失败事件同时携带该 Run 已持久化的规范消息、Run 与 ToolActivity 投影，renderer 用它们替换临时流式状态。累计文本只作为读取规范投影失败时的降级补齐路径。不能仅按字符长度补后缀，因为离开页面期间漏失的 delta 可能位于回答中间，也不能跨 Tool 边界重复或错序插入文本。

除停止当前 Run 外，所有 Session 与 Memory 请求都必须携带完整 owner scope。main 必须重新规范化 scope，并将其加入每一条查询和修改条件；只校验 `libraryId` 不构成账号隔离。Memory 修改与删除还要携带当前 `revision`。确认、交互回答、Renderer 能力调用、写入提交与执行完成请求必须同时匹配发起窗口、`sessionId`、`runId`、`libraryId` 和一次性 ID，重复或迟到结果不能再次执行。交互回答还要按已持久化请求 schema 重新校验，renderer 临时草稿不构成事实。

Renderer 写操作有两个不同的回执边界：后端已经确认创建节点时，通过 `agent:tool:execution:commit` 立即提交不可逆的成功结果；目录刷新和再感知结束后，再通过 `agent:tool:execution:complete` 提交最终感知。main 在 commit 前遇到 Run 取消或执行超时会发送 `tool-execution-cancelled`，要求 Renderer 中止上传；commit 后则保留 authoritative result 作为降级结果，并只给 Renderer 30 秒完成刷新与最终回执，避免已成功写入被误报失败并被模型重复执行。

所有 Agent IPC 必须经过 `assertMainWindowAgentSender`。overlay、独立媒体窗口和非主 frame 不能调用 Agent 或读取会话。

## 6. 安全与运行上限

- 当前自动执行仅允许 main 注册且经过校验的 `risk: 'read'` Tool；Renderer 只读 Tool 还必须显式返回 `allow` 决策并走一次性 execution request。
- `AgentToolBroker` 是 main / renderer executor 的唯一分发入口。main Tool 收到停止或超时后先触发其 `AbortSignal`，并最多等待 6 秒让 Tool 完成回滚或返回已经提交的结果，再结束 Run；不能先宣布取消、后台仍继续副作用。Renderer 回执必须匹配窗口、owner scope、资料库、Session、Run 和一次性 execution ID。commit 前超时、取消或 owner 释放会主动通知 Renderer 中止并使请求失效；commit 后保留已提交的成功结果，在最终回执失败或 30 秒收口超时时作为 Tool 结果继续，不能再次执行写入。
- `media.inspect` 的模型输入和 ToolRun 只保存 `nodeId`。Renderer 依据 main 生成的节点请求取得短期签名链接，再通过 `agent:media:inspect` 瞬时交给 main；Broker 对该内部能力执行一次性校验和防重放。main 随后把上游链接封装进本机 loopback 代理，ffprobe 参数只包含本机 URL；签名链接、代理 token 和 ffprobe stderr 不进入 Tool 结果、模型消息、SQLite 或日志。
- `media.extractAudio` 只接受 main 根据当前感知节点生成的 `nodeId`、输出格式和目标当前目录；输出名固定为 `<源文件名>-audio.<格式>`，并在确认和 staging 前限制为 240 UTF-8 bytes，冲突时自动改名。Renderer 取得 6 小时签名链接后，通过一次性 capability 交给 main；ffmpeg 只接触 6 小时有效的 loopback URL 和 main 创建的临时输出路径。Renderer 只能把返回的临时产物上传到授权时的当前目录，成功后立即提交后端实际返回的节点 ID、名称和扩展名，再刷新并再感知；只有最新当前目录确实包含该 `createdNodeId` 才标记 `verified: true`。最后无论成功、失败或取消都释放产物。
- `AgentMediaArtifactStore` 位于 main，单文件上限 2 GiB、同时最多 4 个活跃产物、默认总预留上限 8 GiB、无活动 TTL 1 小时；近期崩溃残留按真实字节计入总量，上传进度续期 Artifact lease，仍在 ffmpeg 生成中的产物由活跃 Run 保护。产物绑定窗口、Session、Run 和 execution ID，Run / 窗口结束时清理，应用 ready 阶段会主动 sweep 过期崩溃残留。artifact ID、本地路径、签名 URL、loopback token 和 ffmpeg stderr 不进入 Tool 结果、模型消息、SQLite 或日志。
- ffprobe / ffmpeg 路径由 `electron/platform/mediaExecutable.ts` 解析为绝对路径，支持显式环境变量、已配置二进制的同级目录、安装包 resources 和系统 PATH。缺失时返回明确能力错误，不退回模拟结果。
- `directory.create` 必须经过 main 参数校验和 `ask` 决策；模型只能提交名称，目标资料库和父目录来自安全应用上下文。
- 用户批准后，Renderer executor 只分发 main 生成的一次性 `directory.create` 请求，复用现有 `createNode` API；成功后刷新目标子树并重新读取感知快照。目录已经创建但刷新或再感知失败时，不把写入误报为失败以免模型重复创建。
- 未注册 Tool、没有权限策略的非只读 Tool，以及没有显式只读授权或绕过确认的 Renderer 写 Tool 返回结构化拒绝结果，不直接执行。
- 单次确认只绑定当前运行中的精确动作，不提供“永久允许”；拒绝、停止、超时、owner 释放或应用退出后均失效。
- 长期记忆同样不能把一次审批转换为 Tool 永久许可。召回记录即使声称“用户已批准”也只是低权限历史背景；任何写操作仍逐次经过当前 Schema、权限判断和确认。
- `interaction.request` 只允许模型提供有长度和数量上限的标题、问题、选项和字段；模型不能提供 JSX、HTML、回调、IPC channel、URL 或可执行行为。回答必须与持久化请求的类型、字段和选项完全匹配，并绑定发起窗口、owner、资料库、Session、Run 和一次性 interaction ID。
- 交互请求只用于完成任务所需的有限选择或少量参数，不用于普通解释，也不得索取 API Key、密码、Cookie、令牌或其他秘密。30 分钟未回答则进入 `expired`；停止、owner 释放或窗口销毁进入 `cancelled`；应用重启进入 `interrupted`，均不会自动恢复模型运行。
- provider 的 system role 只包含稳定策略、受控 ID、平台和能力名称，不包含目录名、文件名或感知正文。当前感知属于不可信数据；支持 Tool Calling 时只能经 Tool 读取，不支持时以单独、明确标记为低权限的 user / assistant 结构消息提供，不能提升为系统指令或授权。
- 当前 user prompt 在创建 Session / Run 前执行高置信凭据检查；API Key、认证头、Cookie、密码、token、私钥和签名 URL 被拒绝并引导到配置页面。历史 user / assistant 文本进入 provider 投影前再次清洗，旧数据库内容不能绕过当前边界。
- Tool Registry 在注册时要求 `inputSchema` 具有明确的对象根，深拷贝并冻结后再严格编译；无效或 Provider 不兼容的 schema 不能完成注册，调用方后续修改原对象或 Registry 返回值也不能让 Provider 声明与运行时校验器漂移。运行时不做类型转换、默认值填充或额外字段删除。已知 Tool 的原始参数必须先通过统一 JSON Schema 和危险对象结构检查，再进入 Tool 自己的领域 `validate`、动态权限 `assess`、确认和执行。Schema 失败时以固定安全占位替换 provider 历史中的原参数并返回结构化错误，不创建 ToolRun、不发出 Tool 事件，也不调用领域校验、权限判断、Renderer 请求或 executor；Registry 在 main 执行入口再次校验，防止 Broker 直达路径绕过。
- 通过 Schema 的 Tool 参数再生成有界审计投影；发现敏感字段或无法完整审计时不产生副作用。Tool 进度、确认预览、规范结果和 Run 错误都必须在写入 SQLite 或发送 renderer 事件前完成文本或结构化递归清洗；未知、拒绝和失败 Tool 同样不能把原始参数或上游错误旁路到时间线。
- 每轮最多 4 轮 Tool 循环、8 次业务 Tool 调用。模型单轮返回的业务 Tool 数会与 Run 已用配额一起原子预检；超额时整轮拒绝，不能先执行一部分再失败。`agent.plan.set` 不计入业务 Tool 配额。
- provider 上下文按每一次完整请求重新估算 system、Tool schema、消息、Tool Call 参数和 Tool result；当前缺少可靠模型窗口元数据时使用保守 `16,384` token fallback，并为回答和后续 Tool loop 分别预留固定额度。main 可通过只接收 `providerType + model` 的预算 resolver 注入真实窗口，不向 resolver 暴露 Key，也暂不扩展配置 UI。解析后的回答预留同时作为常规 Tool turn、无 Tool fallback 和摘要请求的真实 provider 输出上限：官方 OpenAI 使用 `max_completion_tokens`，DeepSeek / Local 的 OpenAI-compatible Chat Completions 与 Claude 使用 `max_tokens`，两类字段不能同时发送；字符硬上限继续作为独立的本地内存保护。固定输入与预留已经占满窗口、当前 user message 超过剩余预算时，在创建 Session / Run 前明确拒绝；不能用最小预算下限制造负预算，也不能静默截断当前 Run。每轮 Tool Call 在执行任一 Tool 前必须能容纳全部最小合法 Tool 结果消息，逐项投影时还要精确保留后续 callId、Tool 名和最小结果的完整协议开销；若 Renderer Tool 可能在副作用后首次返回感知快照，预检必须同时覆盖执行前后两种 system prompt 状态。
- 经清洗和存储上限收口的规范 Tool 结构化结果保存在 SQLite 并用于时间线；进入 provider 前再生成独立、有 token 上限的结构化投影，始终保留 `ok` 和可容纳的状态 / message / data，省略数组、字段或长文本时写入 `_omniflowProjection.truncated`。API Key、认证头、Cookie、密码、token 和签名 URL 查询参数不能因 Tool 返回而进入 SQLite、renderer 或 provider；provider 的二次截断不反向覆盖规范执行事实。Tool loop 任一轮仍超窗时停止下一次 provider 调用。
- 历史投影只压缩完整终态 Run，当前 Run、等待确认 / 交互的 Run 和近期预算内完整轮次不被切开；预算不依赖上一轮 usage 或简单百分比。最近 12 条规范执行事实始终从所有终态 Run 的 ToolRun 单独投影，不受 checkpoint 对话边界或 provider tail 是否仍含对应 Run 消息影响。
- 自动摘要是一次独立、无 Tool、无时间线事件的纯文本模型调用，只读取经过长度限制和秘密清洗的 user / assistant 历史并产出严格 V1 JSON；单次压缩最多连续生成 4 个摘要批次，模型输出上限为 20,000 字符。摘要只保留目标、任务上下文、限制与偏好、决策及理由、未解决事项，不声称保存已完成操作或执行结果；规范执行事实由 ToolRun 投影独立提供。摘要调用不能调用 Registry / Broker、创建 Run / ToolRun、改变权限或把历史文字变成用户授权。API Key、认证头、Cookie、密码、token、JWT 和签名 URL 查询参数在摘要输入与输出边界都被清洗。
- checkpoint 先 `started` 再原子转为 `completed`，覆盖边界必须单调、不能切开 Run，同一 Session 同时只有一个压缩任务。连续三次失败后按 Session + 配置 + 模型进入五分钟冷却；更换配置 / 模型或冷却结束后允许一次探测。摘要不可用时仍只发送有界近期历史，不无限重试或阻塞普通对话。
- Agent 单个 provider turn 与整个 Run 的 assistant 内容硬上限均为 64,000 字符；Agent SSE 未完成事件缓存上限 128,000 字符，Tool 参数为每次调用 64,000、单轮合计 128,000 字符。通用 AI SSE 缓存上限 256,000 字符；非流式成功 JSON body 上限 2 MiB、错误 body 上限 64 KiB。达到任一上限都取消读取并失败，不继续累积内存或执行后续 Tool。
- 输入、感知快照和字段长度在 main 侧再次清洗和截断。
- renderer 销毁时取消该 renderer 拥有的活跃 Run。
- Renderer execution 使用独立 `AbortController` 关联 Run。commit 前停止、终态事件、资料库 scope 切换、组件卸载或 main 发出的 `tool-execution-cancelled` 会中止上传，并通过既有直传 abort 同时终止主进程 PUT 和后端 multipart Session；commit 后不再中止已完成的写入，只等待最终回执并停止后续 Run。
- 认证会话释放时通过 `agent:owner:release` 取消主窗口拥有的全部活跃 Run。
- Agent 不读取 AI Service API Key，也不将 Key、Cookie、签名 URL 或完整环境变量写入 SQLite。
- `AgentLocalProcessRunner` 不暴露 IPC 或 Tool；只接受 Tool 代码提供的绝对可执行文件路径与参数数组，固定 `shell: false`，只传安全环境变量白名单，并限制参数、并发、stdout/stderr、执行时间和取消后的进程树生命周期。macOS / Linux 使用独立进程组，Windows 终止策略收敛到 `electron/platform/processTree.ts`。

## 7. 受控时间线与展示协议

Agent 工作区使用统一时间线：

```text
AgentMessage + AgentRunSnapshot + AgentToolActivitySnapshot
  -> AgentTimeline
  -> 本地注册的受控展示组件
```

- `AgentSessionSnapshot.messages` 保存对话事实，`runs` 保存每次提交的规范 Run，`toolActivities` 保存 ToolRun 事实；不再额外返回 `pendingApprovals`。待确认只是 ToolActivity 的 `awaiting_approval + approval.status=pending` 阶段。
- 实时事件只对当前投影做增量合并，恢复与 Run 终态以 SQLite 返回的规范 Run / ToolActivity 为准。Run 和 ToolRun 均按 `revision` 接受更高版本；终态不能被迟到的 active 事件覆盖，较新的进度、确认或交互状态也不能被旧快照抹掉。系统时钟回拨或同毫秒更新不会改变状态新旧关系。
- 历史 `role: tool` 文本消息继续保留在数据库中，时间线发现同一 `runId + toolCallId` 的 ToolActivity 时在该消息原位置以活动卡片替换；实时 `tool-started` 也创建同语义的瞬时消息锚点，后续 assistant delta 因而不会越过 Tool 卡。恢复中的未完成 Tool 没有持久化 tool message 时，按 `ordinal` 放在同 Run 最后一条消息之后；只有完全缺失同 Run 消息的损坏或遗留记录才按时间作全局降级。没有匹配活动的旧 Tool 消息仍按文本显示。
- Tool 进度先写入 `agent_tool_runs.progress_json`，再发送 renderer 事件。应用退出或切走页面后，重新打开会话仍能看到最后一个规范进度和最终状态。
- `buildAgentWorkflowProjection()` 是纯 selector：从 Run 的 `currentStep / status` 与同一 Run 内按 `ordinal` 排序的真实 ToolActivity 派生任务卡。它不调用 Registry、Broker 或 executor，不创建假 ToolRun，也不持久化总百分比或 renderer 自己猜测的步骤状态。
- 复杂任务可通过保留的 provider 控制调用 `agent.plan.set` 声明一次 Run 内计划。该调用只在 provider 协议中可见，由 Orchestrator 截获；它不注册进业务 ToolRegistry、不创建 ToolRun、不调用 Broker / executor、不消耗业务 Tool 配额，也不形成预授权。
- 计划只允许 2 至 8 个步骤。模型只能提供计划标题、步骤标题和每步预计使用的已注册 Tool 名称；main 生成步骤 ID、`ordinal` 和时间。模型不能声明状态、进度、结果、权限、确认、关联 ID、revision、时间、UI、HTML、回调或 IPC。
- 计划在首个真实 ToolRun 前一次性写入 `agent_runs.plan_json`，写入后不可改写，并与 Run `revision` 在同一条更新中递增。真实 ToolRun 创建时按“计划顺序 + 精确 Tool 名称”单调绑定尚未使用的步骤；偏离计划或重试产生的 ToolRun 保持未关联并仍作为真实执行展示。
- 计划步骤状态完全由关联 ToolRun 派生。未关联步骤在活跃 Run 中显示为待执行，在终态 Run 中显示为未执行；计划本身不能推进执行、绕过参数校验、权限门或用户确认。恢复时保留计划和关联，但不自动重放未完成 Tool。
- 当前计划只属于单个 Run，不支持改写、跨 Run 重试或跨多轮 Workflow。出现共享产物、显式重试和跨 Session 编排需求后再评估独立 Workflow 表。

共享展示协议只允许固定语义块：

```text
status / progress / approval / artifact / details / notice
choice / form
```

当前 Tool 展示由 `agent-tool-presentation.ts` 的本地注册表生成：`media.inspect` 只投影白名单媒体字段，`directory.create` 与 `media.extractAudio` 生成资料库产物引用，`interaction.request` 只投影经过 main 规范化并持久化的 `choice / form` 字段。未知 Tool 只显示通用状态或结果说明，不把任意结果 JSON 当 UI 渲染。

安全约束：

- 模型、Tool 结果和历史消息不能提供 React 组件、JSX、HTML、CSS、回调、IPC channel、任意 URL 或本地路径。
- 按钮只能携带共享协议声明的语义动作，例如 `tree.revealNode`；renderer 在中心分发点再次按动作 ID 选择本地处理器。
- 当前仅注册 `tree.revealNode`，并且节点身份由已完成 Tool 的清洗结果和当前 `libraryId` 组合。其他已声明动作在没有本地处理器时不得执行。
- `choice / form` 是同一个 ToolActivity 的交互阶段，不创建独立时间线事实。Renderer 只持有未提交草稿；`pending / submitted / expired / cancelled / interrupted` 状态和已提交回答均由 SQLite ToolRun 持有。提交成功后卡片继续保留为只读历史，迟到的 `pending` 事件不能让它重新可编辑。

这样增加字幕编辑、媒体预览或参数选择时，只需要新增受控 presenter / component / action handler，不改写 Session、Run 和 ToolRun 状态 owner。

## 8. 构建边界

Agent Session Store 使用 `sqlite3` 原生依赖：

- Electron main 构建必须 externalize `sqlite3`，不能打进单文件 bundle。
- `tools/prepare-sqlite3-native.cjs` 在 electron-builder 的 `beforeBuild` 阶段按目标平台和架构准备官方 N-API v6 预编译文件，避免旧版 electron-builder 根据宿主 Node 版本错误重编译。缓存 metadata 同时记录 `sqlite3` 版本和 N-API 版本，任一身份变化都必须重建，不能静默复用旧 `.node`。
- electron-builder 只打入 `sqlite3`、`bindings`、`file-uri-to-path` 的最小运行文件，并将目标 `.node` 二进制解包出 ASAR；`build/native/` 是可重建缓存，不进入 Git。
- macOS / Windows 打包都要验证目标平台原生模块；从 macOS 交叉打 Windows 时必须使用 `win32-x64` 缓存，不能复用 Darwin 二进制。
- 普通 `npm run build` 只验证 TypeScript 和 bundle，不能替代安装包内原生模块验证。

## 9. 验证入口

自动化测试：

- `electron/service/agent/agent-session-store.test.ts`
- `electron/service/agent/agent-orchestrator.test.ts`
- `electron/service/agent/agent-interaction-model.test.ts`
- `electron/service/agent/agent-tool-registry.test.ts`
- `electron/service/agent/agent-tool-broker.test.ts`
- `electron/service/agent/agent-local-process-runner.test.ts`
- `electron/service/agent/agent-media-inspector.test.ts`
- `electron/service/agent/agent-media-audio-extractor.test.ts`
- `electron/service/agent/agent-media-artifact-store.test.ts`
- `electron/service/agent/tools/file-read-tools.test.ts`
- `electron/service/agent/tools/directory-create-tool.test.ts`
- `electron/service/agent/tools/media-extract-audio-tool.test.ts`
- `electron/service/agent/tools/media-inspect-tool.test.ts`
- `electron/service/agent/tools/interaction-request-tool.test.ts`
- `src/features/agent/services/agent-tool-executor.test.ts`
- `src/features/agent/agent-tool-activities.test.ts`
- `src/features/agent/agent-tool-presentation.test.ts`
- `src/features/agent/agent-timeline.test.ts`
- `src/features/agent/*.test.ts`
- `electron/platform/processTree.test.ts`
- `electron/platform/mediaExecutable.test.ts`

完整手工路径见 `docs/frontend-validation-matrix.md` 的“内置 Agent”章节。测试资料库继续遵守 workspace 规则：任何场景禁止第一个资料库，`Win` 可用时优先使用 `Win`。
