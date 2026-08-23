# 内置 Agent 架构

更新时间：2026-08-23

适用范围：

- `src/shared/agent/`
- `src/features/agent/`
- `electron/ipc/agent.ts`
- `electron/service/agent/`
- Agent 使用的 AI 服务访问边界

未来 Tool、Skill、长期记忆和本地进程能力的设计草案见 `docs/wip/built-in-agent-development-notes.md`。本文只记录已经落地的稳定边界。

## 1. 当前能力

内置 Agent 当前提供：

- 资料库工作区中的流式文本对话。
- OpenAI-compatible 和 Claude provider 适配。
- 受控只读 `file.list` / `file.stat` Tool Calling。
- 本机会话分页列表、搜索、新建、打开、重命名和删除。
- 应用重启后的会话恢复，以及未完成运行的中断标记。

当前不提供任意 Shell、写入 Tool、媒体处理 Tool、自动恢复未完成运行、会话摘要、长期记忆或向量检索。

## 2. 分层与所有权

```text
AgentWorkspace / useAgentSession
  只持有输入草稿、当前会话投影、加载态和流式展示态
       |
agent.api -> preload electronAgent
  受控 IPC 契约，不暴露 SQLite 和 AI 凭据
       |
electron/ipc/agent.ts
  校验主窗口 sender，管理 renderer 销毁时的运行取消
       |
AgentOrchestrator
  会话续接、Run 生命周期、Tool loop、流式事件和安全上限
       |                         |
AgentSessionStore               AI Service
  SQLite 真实状态                provider、模型请求和 API Key
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
- `agent_tool_runs`：保存 Tool 输入、结构化结果和运行状态，不把 Tool 状态压进聊天文本作为唯一事实。

创建 Run 和首条用户消息必须原子完成。当前由 SQLite 的 `agent_runs_create_user_message` trigger 在插入 Run 时同步创建 user message，避免进程退出后出现只有 Run 或只有消息的半状态。

当前 schema 版本为 `2`。v1 升级时原有会话保留为不可认领的 `legacy` scope，不能自动暴露给升级后首先登录的账号；新会话写入完整 owner scope。后续修改表结构必须增加显式迁移，不得只修改建表语句后假设旧数据库会自动更新，也不得在无法证明归属时自动认领历史数据。

## 4. 生命周期与恢复

```text
用户提交
  -> 创建或校验 Session
  -> 原子创建 Run + user message
  -> 返回 sessionId / runId
  -> 流式执行 provider / Tool loop
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
- SQLite 打开时将遗留的 `running` Run 和 ToolRun 标记为 `interrupted`。
- `interrupted` 只表示上次应用退出时未完成，不自动重放 provider 请求或 Tool。
- 当前目录和选中节点每轮重新感知，数据库里的历史上下文不作为当前文件事实。
- 活跃 Run 不能删除；同一个 Session 同时只允许一个 Run 进入启动或运行阶段。
- 普通工作区切换允许已启动 Run 留在 main 后台继续；注销、401 清理或主窗口销毁必须取消该窗口的全部 Run，不能把旧账号任务带入新认证会话。
- 每个 Run 在启动边界读取一次 AI Service 连接快照并锁定来源配置；后续 Tool 轮次和无 Tool fallback 均使用同一份 provider、Base URL 和 Key。完成、失败、停止或 owner 销毁后释放锁。

## 5. IPC 契约

请求：

```text
agent:chat:start
agent:chat:stop
agent:owner:release
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
  tool-completed
  completed
  cancelled
  error
```

每个流式事件同时携带 `sessionId` 和 `runId`。Renderer 只消费当前 Session 的事件；创建新 Session 时允许在 `start` IPC 返回前短暂缓存该 Session 的抢跑事件，恢复活跃 Session 时也只为目标 Session 暂存快照读取期间的事件。完成、取消或失败事件携带该 Run 已持久化的规范消息投影，renderer 用它替换临时流式消息；累计内容只作为读取规范投影失败时的降级补齐路径。不能仅按字符长度补后缀，因为离开页面期间漏失的 delta 可能位于回答中间，也不能跨 Tool 边界重复或错序插入文本。

除停止当前 Run 外，所有 Session 请求都必须携带完整 owner scope。main 必须重新规范化 scope，并将其加入每一条 Session 查询和修改条件；只校验 `libraryId` 不构成账号隔离。

所有 Agent IPC 必须经过 `assertMainWindowAgentSender`。overlay、独立媒体窗口和非主 frame 不能调用 Agent 或读取会话。

## 6. 安全与运行上限

- 当前自动执行仅允许 `risk: 'read'` 的注册 Tool。
- 未注册 Tool 和非只读 Tool 返回结构化拒绝结果，不直接执行。
- 每轮最多 4 轮 Tool 循环、8 次 Tool 调用。
- 输入、感知快照和字段长度在 main 侧再次清洗和截断。
- renderer 销毁时取消该 renderer 拥有的活跃 Run。
- 认证会话释放时通过 `agent:owner:release` 取消主窗口拥有的全部活跃 Run。
- Agent 不读取 AI Service API Key，也不将 Key、Cookie、签名 URL或完整环境变量写入 SQLite。

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
- `electron/service/agent/tools/file-read-tools.test.ts`
- `src/features/agent/*.test.ts`

完整手工路径见 `docs/frontend-validation-matrix.md` 的“内置 Agent”章节。测试资料库继续遵守 workspace 规则：任何场景禁止第一个资料库，`Win` 可用时优先使用 `Win`。
