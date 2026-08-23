# 内置 Agent 架构

更新时间：2026-08-23

适用范围：

- `src/shared/agent/`
- `src/features/agent/`
- `electron/ipc/agent.ts`
- `electron/service/agent/`
- Agent 使用的 AI 服务访问边界

未来 Tool、Skill、长期记忆和媒体处理能力的设计草案见 `docs/wip/built-in-agent-development-notes.md`。本文只记录已经落地的稳定边界。

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

当前不提供任意 Shell、通用文件写入、通用媒体转码 Tool、自动恢复未完成运行、会话摘要、长期记忆或向量检索。`AgentLocalProcessRunner` 只被 `media.inspect`、`media.extractAudio` 等具体 Tool 内部使用，不是模型可调用的 Tool。

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
AgentSessionStore         AgentToolBroker             AI Service
  SQLite 真实状态          main / renderer 执行分发     provider、模型请求和 API Key
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

- SQLite 是 Session、Run、Message 和 ToolRun 的唯一持久化事实源。
- Renderer 不把会话历史复制到 `localStorage`，只保留本机模型 / 推理强度偏好和临时展示状态。
- `LibraryDetail` 只向 Agent 投影当前 `libraryId`、目录和选中节点，不持有 Agent 会话副本。
- API Key 继续由 AI Service 的本机安全存储负责，禁止进入 Agent 数据库、消息或事件。
- 会话 owner 由规范化 `VITE_API_BASE_URL`、数字用户 ID 和 `libraryId` 共同确定；同一台机器切换账号或后端环境时不得复用其他 owner 的会话。

## 3. 本地数据模型

数据库位置：

```text
app.getPath('userData')/agent-sessions.sqlite3
```

关系：

```text
agent_sessions
  ├─ agent_messages
  └─ agent_runs
       └─ agent_tool_runs
```

- `agent_sessions`：按 `backend_scope + account_scope + library_id` 隔离，保存标题、最新安全上下文、消息预览和生命周期时间。
- `agent_runs`：一次用户提交对应一个 Run，保存 provider 配置 ID、模型、推理强度、状态、当前步骤和错误。
- `agent_messages`：按 Session 内单调递增的 `sequence` 排序，保存 user / assistant / tool 消息。
- `agent_tool_runs`：保存 Tool 输入、结构化结果、权限决策、确认快照和运行状态，不把 Tool 状态压进聊天文本作为唯一事实。

创建 Run 和首条用户消息必须原子完成。当前由 SQLite 的 `agent_runs_create_user_message` trigger 在插入 Run 时同步创建 user message，避免进程退出后出现只有 Run 或只有消息的半状态。

当前 schema 标记保持为 `2`。v1 升级时原有会话保留为不可认领的 `legacy` scope，不能自动暴露给升级后首先登录的账号；新会话写入完整 owner scope。项目仍处于未正式发布阶段，本次确认审计字段直接并入当前建表定义；本机已有的 schema 2 数据库通过 `PRAGMA table_info` 幂等补列，原地兼容且不新增 schema 版本。开发期间曾短暂写入过 `user_version = 3`；启动时仅在四张核心表和确认审计字段均匹配该已知中间结构时保留数据并把标记归回 `2`，其他更高版本或未知结构仍拒绝打开。不能在无法证明归属时自动认领历史数据。

## 4. 生命周期与恢复

```text
用户提交
  -> 创建或校验 Session
  -> 原子创建 Run + user message
  -> 返回 sessionId / runId
  -> 流式执行 provider / Tool loop
  -> 写操作进入 awaiting_approval 并等待精确动作确认
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
- SQLite 打开时将遗留的 `running` / `awaiting_approval` Run 和 ToolRun 标记为 `interrupted`，待确认动作不会跨应用重启继续有效。
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
```

事件：

```text
agent:chat:event
  started
  delta
  tool-started
  tool-progress
  tool-execution-requested
  tool-execution-cancelled
  tool-approval-required
  tool-approval-resolved
  tool-completed
  completed
  cancelled
  error
```

每个流式事件同时携带 `sessionId` 和 `runId`。Renderer 只消费当前 Session 的事件；创建新 Session 时允许在 `start` IPC 返回前短暂缓存该 Session 的抢跑事件，恢复活跃 Session 时也只为目标 Session 暂存快照读取期间的事件。完成、取消或失败事件携带该 Run 已持久化的规范消息投影，renderer 用它替换临时流式消息；累计内容只作为读取规范投影失败时的降级补齐路径。不能仅按字符长度补后缀，因为离开页面期间漏失的 delta 可能位于回答中间，也不能跨 Tool 边界重复或错序插入文本。

除停止当前 Run 外，所有 Session 请求都必须携带完整 owner scope。main 必须重新规范化 scope，并将其加入每一条 Session 查询和修改条件；只校验 `libraryId` 不构成账号隔离。确认、Renderer 能力调用、写入提交与执行完成请求还必须同时匹配发起窗口、`sessionId`、`runId`、`libraryId` 和一次性 ID，重复或迟到结果不能再次执行。

Renderer 写操作有两个不同的回执边界：后端已经确认创建节点时，通过 `agent:tool:execution:commit` 立即提交不可逆的成功结果；目录刷新和再感知结束后，再通过 `agent:tool:execution:complete` 提交最终感知。main 在 commit 前遇到 Run 取消或执行超时会发送 `tool-execution-cancelled`，要求 Renderer 中止上传；commit 后则保留 authoritative result 作为降级结果，并只给 Renderer 30 秒完成刷新与最终回执，避免已成功写入被误报失败并被模型重复执行。

所有 Agent IPC 必须经过 `assertMainWindowAgentSender`。overlay、独立媒体窗口和非主 frame 不能调用 Agent 或读取会话。

## 6. 安全与运行上限

- 当前自动执行仅允许 main 注册且经过校验的 `risk: 'read'` Tool；Renderer 只读 Tool 还必须显式返回 `allow` 决策并走一次性 execution request。
- `AgentToolBroker` 是 main / renderer executor 的唯一分发入口。Renderer 回执必须匹配窗口、owner scope、资料库、Session、Run 和一次性 execution ID。commit 前超时、取消或 owner 释放会主动通知 Renderer 中止并使请求失效；commit 后保留已提交的成功结果，在最终回执失败或 30 秒收口超时时作为 Tool 结果继续，不能再次执行写入。
- `media.inspect` 的模型输入和 ToolRun 只保存 `nodeId`。Renderer 依据 main 生成的节点请求取得短期签名链接，再通过 `agent:media:inspect` 瞬时交给 main；Broker 对该内部能力执行一次性校验和防重放。main 随后把上游链接封装进本机 loopback 代理，ffprobe 参数只包含本机 URL；签名链接、代理 token 和 ffprobe stderr 不进入 Tool 结果、模型消息、SQLite 或日志。
- `media.extractAudio` 只接受 main 根据当前感知节点生成的 `nodeId`、输出格式和目标当前目录；输出名固定为 `<源文件名>-audio.<格式>`，并在确认和 staging 前限制为 240 UTF-8 bytes，冲突时自动改名。Renderer 取得 6 小时签名链接后，通过一次性 capability 交给 main；ffmpeg 只接触 6 小时有效的 loopback URL 和 main 创建的临时输出路径。Renderer 只能把返回的临时产物上传到授权时的当前目录，成功后立即提交后端实际返回的节点 ID、名称和扩展名，再刷新并再感知；只有最新当前目录确实包含该 `createdNodeId` 才标记 `verified: true`。最后无论成功、失败或取消都释放产物。
- `AgentMediaArtifactStore` 位于 main，单文件上限 2 GiB、同时最多 4 个活跃产物、默认总预留上限 8 GiB、无活动 TTL 1 小时；近期崩溃残留按真实字节计入总量，上传进度续期 Artifact lease，仍在 ffmpeg 生成中的产物由活跃 Run 保护。产物绑定窗口、Session、Run 和 execution ID，Run / 窗口结束时清理，应用 ready 阶段会主动 sweep 过期崩溃残留。artifact ID、本地路径、签名 URL、loopback token 和 ffmpeg stderr 不进入 Tool 结果、模型消息、SQLite 或日志。
- ffprobe / ffmpeg 路径由 `electron/platform/mediaExecutable.ts` 解析为绝对路径，支持显式环境变量、已配置二进制的同级目录、安装包 resources 和系统 PATH。缺失时返回明确能力错误，不退回模拟结果。
- `directory.create` 必须经过 main 参数校验和 `ask` 决策；模型只能提交名称，目标资料库和父目录来自安全应用上下文。
- 用户批准后，Renderer executor 只分发 main 生成的一次性 `directory.create` 请求，复用现有 `createNode` API；成功后刷新目标子树并重新读取感知快照。目录已经创建但刷新或再感知失败时，不把写入误报为失败以免模型重复创建。
- 未注册 Tool、没有权限策略的非只读 Tool，以及没有显式只读授权或绕过确认的 Renderer 写 Tool 返回结构化拒绝结果，不直接执行。
- 单次确认只绑定当前运行中的精确动作，不提供“永久允许”；拒绝、停止、超时、owner 释放或应用退出后均失效。
- 每轮最多 4 轮 Tool 循环、8 次 Tool 调用。
- 输入、感知快照和字段长度在 main 侧再次清洗和截断。
- renderer 销毁时取消该 renderer 拥有的活跃 Run。
- Renderer execution 使用独立 `AbortController` 关联 Run。commit 前停止、终态事件、资料库 scope 切换、组件卸载或 main 发出的 `tool-execution-cancelled` 会中止上传，并通过既有直传 abort 同时终止主进程 PUT 和后端 multipart Session；commit 后不再中止已完成的写入，只等待最终回执并停止后续 Run。
- 认证会话释放时通过 `agent:owner:release` 取消主窗口拥有的全部活跃 Run。
- Agent 不读取 AI Service API Key，也不将 Key、Cookie、签名 URL 或完整环境变量写入 SQLite。
- `AgentLocalProcessRunner` 不暴露 IPC 或 Tool；只接受 Tool 代码提供的绝对可执行文件路径与参数数组，固定 `shell: false`，只传安全环境变量白名单，并限制参数、并发、stdout/stderr、执行时间和取消后的进程树生命周期。macOS / Linux 使用独立进程组，Windows 终止策略收敛到 `electron/platform/processTree.ts`。

## 7. 构建边界

Agent Session Store 使用 `sqlite3` 原生依赖：

- Electron main 构建必须 externalize `sqlite3`，不能打进单文件 bundle。
- `tools/prepare-sqlite3-native.cjs` 在 electron-builder 的 `beforeBuild` 阶段按目标平台和架构准备官方 N-API v6 预编译文件，避免旧版 electron-builder 根据宿主 Node 版本错误重编译。缓存 metadata 同时记录 `sqlite3` 版本和 N-API 版本，任一身份变化都必须重建，不能静默复用旧 `.node`。
- electron-builder 只打入 `sqlite3`、`bindings`、`file-uri-to-path` 的最小运行文件，并将目标 `.node` 二进制解包出 ASAR；`build/native/` 是可重建缓存，不进入 Git。
- macOS / Windows 打包都要验证目标平台原生模块；从 macOS 交叉打 Windows 时必须使用 `win32-x64` 缓存，不能复用 Darwin 二进制。
- 普通 `npm run build` 只验证 TypeScript 和 bundle，不能替代安装包内原生模块验证。

## 8. 验证入口

自动化测试：

- `electron/service/agent/agent-session-store.test.ts`
- `electron/service/agent/agent-orchestrator.test.ts`
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
- `src/features/agent/services/agent-tool-executor.test.ts`
- `src/features/agent/*.test.ts`
- `electron/platform/processTree.test.ts`
- `electron/platform/mediaExecutable.test.ts`

完整手工路径见 `docs/frontend-validation-matrix.md` 的“内置 Agent”章节。测试资料库继续遵守 workspace 规则：任何场景禁止第一个资料库，`Win` 可用时优先使用 `Win`。
