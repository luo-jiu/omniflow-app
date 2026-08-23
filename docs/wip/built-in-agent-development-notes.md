# 内置 Agent 开发讨论稿

> **临时文档。** 本文记录 OmniFlow 内置 Agent 的阶段性讨论结论和当前落地边界，不是最终架构契约。方案稳定后，应将有效边界整理到工具工作区、AI 服务和对应任务文档中，并删除或归档本文。

更新时间：2026-08-22
适用范围：`src/features/tool-workspace/`、`src/features/ai-services/`、Electron 本地任务能力，以及未来的内置 Agent 工具区。

> 已落地的 Agent IPC、会话存储、运行恢复和状态所有权以 `docs/built-in-agent-architecture.md` 为准。本文后续章节主要记录尚未实现的 Tool、Skill、长期记忆和本地进程路线。

## 1. 目标

内置 Agent 的定位不是 Codex / Claude Code 这一类通用编码 Agent，而是 OmniFlow 内部工具的自然语言编排器：

- 用户用自然语言描述目标。
- Agent 识别意图、补齐必要参数并组织已有工具流程。
- 工具负责执行真实任务、报告进度、支持取消和返回结构化结果。
- 现有工具页面继续保留，作为精细控制、失败恢复和调试入口。

典型目标：

```text
“把当前选中的视频压缩成 720p，保存到下载目录。”
“读取当前字幕，翻译所有空白行并保存回资料库。”
```

Agent 不通过模拟鼠标点击页面来完成任务。OmniFlow 的页面和业务能力都属于自己的代码，直接调用稳定的 Tool 比依赖坐标、焦点、弹框和布局更可靠，也更容易跨 macOS / Windows 复用。

## 2. 运行模型

第一版可以采用最小 Agent loop。这里的 Agent 四件套不是四个互相独立的页面，而是一轮任务中的四个阶段：

```text
感知：读取当前应用状态和必要的 Tool 结果
  -> 思考：请求当前 AI 服务，决定下一步或直接回答
  -> 执行：校验权限后调用注册 Tool
  -> 再感知：重新检查真实状态，将结果回传模型
  -> 继续下一轮或输出最终结果
```

“再感知”不能省略。Agent 不能只根据进程退出码或自己的上一条回复判断任务成功，而应重新读取输出文件、媒体元数据或资料库状态。例如提取音频后至少确认输出文件存在、大小合理，并且可以再次被媒体服务读取。

第一版每轮 Agent loop 必须有明确上限（最大 Tool 调用次数、总执行时间和可取消状态），避免模型在错误结果下无限重试。聊天文本只是展示层，运行现场由独立的 Run / ToolRun 记录保存。

Agent 的聊天界面只是展示层，至少还要展示：

- 当前携带的文件、目录或浏览器资源。
- Agent 准备执行的步骤。
- 当前工具、进度、失败和取消状态。
- 输出文件以及“打开 / 定位 / 保存到资料库”等后续动作。

长任务不能只依赖聊天消息。当前一轮模型与 Tool 执行由独立的 Run / ToolRun 管理；未来跨多轮、可重试的业务任务可在其上增加 Workflow 层，页面切换后仍能观察、取消和查看结果。

## 3. Tool 与 Skill

### 3.1 Tool

Tool 是真正可执行的能力，必须有稳定名称、输入约束、权限级别和结构化结果。概念接口：

```ts
interface AgentTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: 'read' | 'write' | 'destructive' | 'external';
  execute(
    context: AgentContext,
    input: unknown,
    signal: AbortSignal,
    onProgress: (progress: ToolProgress) => void,
  ): Promise<ToolResult>;
}
```

候选 Tool：

```text
file.list
file.stat
file.readText
media.inspect
media.transcode
media.extractAudio
subtitle.load
subtitle.translate
file.saveLocal
file.importToLibrary
workspace.openResult
```

第一批只需要覆盖：当前上下文感知、音视频转码 / 提取音频、结果保存和打开。字幕翻译属于后续可选 Skill，不进入 Agent 核心链路。

### 3.2 Skill

Skill 是 Tool 的使用说明和流程配方，不是任意代码插件。它可以用 Markdown + manifest 描述：

```yaml
name: subtitle-translation
tools:
  - subtitle.load
  - subtitle.translate
  - file.saveLocal
  - file.importToLibrary
```

正文规定：缺少模型时如何提示、默认翻译哪些行、保存前需要询问什么。Tool 表达“能做什么”，Skill 表达“何时以及怎样组合它们”。

未来工具市场可以让插件同时注册：

- Tool：可执行能力。
- Skill：Agent 使用该能力的规则。
- UI：需要人工精细调整时的可视化页面。

## 4. 本地进程与 Shell

当前项目已经在 Electron main 侧使用 `spawn(command, args)` 执行 ffmpeg。Agent 不应直接拼接任意 Shell 字符串，而应调用高层 Tool：

```text
Agent -> media.transcode -> 生成受控 ffmpeg 参数 -> LocalProcessRunner -> ffmpeg
```

推荐抽出统一的 `LocalProcessRunner`，集中处理：

- stdout / stderr 和退出码。
- 超时、取消和子进程树清理。
- 输出大小、并发数和临时目录。
- macOS / Windows 的进程终止差异。
- 可选的 ffmpeg 进度解析。

`ffmpeg` 属于 `media-processing` 能力，不属于只读 Shell。它需要读取输入、写入临时文件和输出文件。

权限级别暂定为：

```text
read-only
  只读取文件列表、元数据和文本

workspace-write
  只能写入临时目录或用户明确选择的目录

media-processing
  读取媒体，启动受控 ffmpeg，写入临时目录和明确输出路径

destructive
  删除、覆盖、批量移动，必须确认

external
  网络请求、上传或向外部服务发送内容，单独确认
```

第一版不提供无限制 `shell.run`。如果未来增加高级 Shell Tool，必须默认关闭并具备：

- 命令白名单，不接受模型直接拼接任意命令。
- 工作目录和真实路径限制，防止 `..`、符号链接和 Windows UNC 路径逃逸。
- 环境变量白名单，不向子进程暴露 API Key、Cookie 和完整环境。
- 超时、输出上限、并发限制和可取消的进程树。
- 显示完整命令、工作目录和风险，并按危险级别确认。

“只读 Shell”不能仅靠禁止几个写命令实现；Shell 语法、重定向、命令替换、脚本解释器和网络工具都可能绕过表面限制。因此优先提供结构化只读 Tool，而不是任意 Shell。

## 5. 记忆系统与上下文

大模型请求本身是无状态的。OmniFlow 的“记忆”不是把所有历史都塞进 Prompt，而是由 Memory Store 持久化，再由 Context Assembler 按当前任务选择性投影到下一轮请求。

完整方案不是在 SQLite 和向量数据库之间二选一，而是两者分工并存：SQLite 保存真实记忆、元数据和生命周期；FTS5 / 向量索引负责检索。第一版先落地本机 SQLite 的会话真实状态，FTS5、长期记忆和向量索引暂缓实现，但从后续 `MemoryStore` 接口和数据归属上预留并存关系。

### 5.1 四层记忆

#### 当前应用上下文

这是动态感知结果，不是长期记忆。每轮从应用状态实时获取：

```text
libraryId、当前目录、选中节点、活动工具、当前平台、可用能力
```

不把整个目录树或完整文件正文永久写进记忆；需要时调用 `file.list`、`file.stat` 或其他 Tool 重新读取。

#### 工作记忆

工作记忆属于当前任务，但需要持久化到本机，支持页面切换、模型压缩和任务恢复：

```text
任务目标、已完成步骤、当前步骤、待确认动作、Tool 结果、进度、错误、取消状态
```

#### 会话记忆

保存用户消息、Agent 回复、Tool 调用和结果。对话过长时，裁剪旧的目录列表、文件全文和重复 Tool 输出，生成滚动任务摘要，只保留目标、关键结果、限制、未完成事项和下一步。

#### 长期记忆

只保存删除后会实质改变未来行为的信息，分为：

- `preference`：用户明确要求长期遵守的偏好。
- `project`：资料库用途、目录习惯和命名规则。
- `reference`：固定的外部文档或入口信息。

`feedback` 合并到 `preference`，正文保留规则、原因和适用场景。用户明确说“以后都这样”时，才提示是否保存；第一版不做每轮后台自动提取。

### 5.2 本地数据结构

由 Electron main 侧的 `AgentSessionStore` 管理当前会话真实状态；后续长期记忆再引入独立 `MemoryStore`。SQLite 表先保持窄而稳定：

```text
agent_sessions   会话、标题、当前摘要和生命周期
agent_messages   用户、Agent、Tool 消息及顺序
agent_runs       单次提交、状态、当前步骤、取消和错误信息
agent_tool_runs  Tool 输入、输出、耗时、错误和进度摘要
agent_memories   长期记忆、scope、来源、启用状态和更新时间
```

Renderer 只通过受控 preload bridge 读取会话、订阅流式事件和提交确认，不直接访问 SQLite。

### 5.3 向量检索的定位

向量数据库不是 SQLite 的替代品，而是与 SQLite 并存的语义检索层：

```text
SQLite：记忆内容、元数据、权限、生命周期和真实状态
向量索引：根据问题找语义相关的记忆
```

当前可以先不实现向量层。后续优先在 `MemoryStore.search()` 后面增加本地向量索引或 SQLite 向量扩展，不改变 Agent 上层契约；如果需要跨设备同步、多人共享或大规模知识库，再考虑把同一套向量索引放到服务端。无论采用哪种实现，SQLite 都继续保留为记忆的主存储，向量数据属于可重建的派生索引。

API Key、Cookie、签名 URL、完整环境变量和未经用户确认的临时内容不得进入长期记忆。

### 5.4 上下文组装顺序

每轮请求按以下优先级组装，避免“记住了很多却忘了当前任务”：

```text
稳定系统规则与 Tool schema
  -> 当前应用上下文
  -> 工作记忆与任务现场
  -> 会话摘要
  -> 最近几轮对话和 Tool 结果
  -> 与当前问题相关的长期记忆
```

上下文预算应按当前 provider 的真实窗口计算。达到约 80% 时安排压缩，约 90% 时先裁剪旧 Tool 结果；连续摘要失败后暂停新的 Tool 调用并向用户说明，不无限重试。

### 5.5 记忆 API 抽象

即使第一版只用 SQLite，也应隔离存储实现：

```ts
interface MemoryStore {
  save(memory: Memory): Promise<void>;
  search(query: string, scope?: MemoryScope): Promise<Memory[]>;
  delete(id: string): Promise<void>;
}
```

这样未来增加 FTS5、向量索引或服务端检索时，不需要重写 Agent loop。

### 5.6 用户偏好示例

只记录用户明确确认的稳定偏好，例如：

```json
{
  "defaultSaveTarget": "library",
  "preferredAudioFormat": "m4a",
  "subtitleStyle": "简洁自然，保留人名",
  "confirmBeforeOverwrite": true
}
```

只有用户明确表达“以后都这样”时才写入长期偏好。普通聊天内容不自动永久保存，避免记忆污染。

## 6. 安全边界

安全不是一个单独的“沙箱开关”，而是多层限制：

```text
Tool 权限
  -> 参数校验
  -> 命令白名单
  -> 路径沙箱
  -> 环境变量隔离
  -> 网络限制
  -> 进程资源限制
  -> OS 级沙箱（后续增强）
```

默认规则：

- 查询和读取可以自动执行。
- 创建新文件可以在明确目标目录后执行。
- 覆盖、删除、批量 AI 消耗和外部发送需要确认。
- Agent 不能直接访问 `safeStorage`、API Key 或原始 IPC。
- Agent 上下文只传稳定的 `libraryId`、`nodeId`、任务 ID 和安全投影。

OS 级 sandbox 可以作为后续增强，但不能替代 Tool 和路径策略。应用层必须先做到“Agent 只能看到注册能力”。

## 7. 推荐宿主结构

```text
Renderer
  聊天、确认、进度、结果
       |
Preload
  受控 Agent bridge
       |
Electron main
  Agent loop
  Tool registry
  Permission gate
  Run / ToolRun store
  Memory store（未来）
  LocalProcessRunner
       |
现有 AI Service / ffmpeg / 字幕 Runner / 文件服务
```

AI Service 继续负责 provider、模型和 Key；Agent 只请求当前启用的 AI 服务，不读取 Key。批量任务复用现有 main 侧运行会话和取消机制。

## 8. 分阶段计划

### Phase 0：设计与观测

- 不改变现有工具行为。
- 列出 Tool 输入、输出、风险、取消和验证矩阵。
- 明确目录树选中项、当前资料库和当前工具上下文的只读投影。
- 已落地的协议基座包括共享上下文 / 消息 / Session / Run 类型，以及 main 侧的 `ToolRegistry` 和 `AgentSessionStore`。
- 这一阶段不接入聊天 UI、不开放任意 Shell、不执行媒体任务；先用单元测试验证 Tool 白名单、取消边界和任务状态隔离。

### Phase 1：最小可用 Agent

- 新增工具工作区中的 Agent 入口。
- 支持文本对话和 Tool 调用卡片。
- 仅接入文件查询、媒体转码、字幕翻译、保存结果。
- 不提供任意 Shell，不引入复杂记忆。

### Phase 2：任务与记忆

- 在现有 Run / ToolRun 上增加进度快照、失败重试、结果定位和可跨多轮的 Workflow 投影。
- 增加会话摘要、用户偏好和资料库偏好。
- 对高风险动作增加统一确认门。

### Phase 3：Skill 与插件

- 加载受控 Skill manifest。
- Tool / Skill / UI 三者建立注册协议。
- 工具市场只允许声明权限和依赖，不允许插件绕过 main 侧安全边界。

### Phase 4：高级本地命令能力

- 评估是否需要 `shell.run`。
- 只对明确启用的高级用户开放。
- 首先支持受限工作目录和命令白名单，再考虑交互式 PTY。

## 9. 当前未决问题

- Agent 入口是否作为独立工具，还是工具区内的统一入口。
- 第一版使用当前 AI provider 的原生 Tool Calling，还是统一结构化 JSON 输出降级。
- 未来 Workflow 是否需要跨资料库编排；当前 Session 明确按 `libraryId` 隔离。
- 长期记忆是否增加账号 scope；当前本机会话只按 `libraryId` 隔离。
- 插件市场的 Skill 是否允许附带本地可执行程序。

## 10. 维护规则

本文从讨论稿升级为正式契约前，必须同步更新：

- `docs/tools-workspace.md`
- `docs/ai-service-architecture.md`
- `docs/frontend-validation-matrix.md`
- 对应 Electron IPC、preload 和任务生命周期文档

新增 Tool、权限级别、持久化字段、IPC channel、记忆范围或本地进程能力时，必须先更新本文或正式专题文档，再实现代码。

## 11. Claude Code 核心系统调研结论

本节根据 Claude Code 源码解析资料第二部分（设置、记忆、上下文、钩子）整理，只吸收适合 OmniFlow 的设计原则，不把资料中的实现细节当作必须照搬的架构。

### 11.1 最值得保留的工作记忆模型

Claude 的工作记忆设计可以简化为五个层次：

```text
稳定前缀
  系统规则、Tool schema、权限规则

应用上下文
  当前资料库、选中节点、活动工具、媒体 / 字幕任务投影

会话摘要
  当前目标、关键决策、已完成步骤、未解决问题

最近对话
  最近若干轮用户消息、Agent 回复和 Tool 结果

当前执行现场
  正在运行的 runId、取消句柄、待确认动作和最近错误
```

这比“把完整聊天记录一直拼给模型”更适合 OmniFlow。尤其要注意：当前执行现场不应该只存在于聊天文本中，它必须由 Run / ToolRun 记录维护，并以安全投影注入上下文。

### 11.2 OmniFlow 的简化压缩策略

不直接实现 Claude 的 Snip / MicroCompact / Collapse / AutoCompact 四套完整系统，先采用三层策略：

1. **结果裁剪**：旧的 `file.read`、`file.list`、媒体元数据和已完成 Tool 输出替换成短标记或摘要，保留消息链和 Tool 调用 ID。
2. **滚动工作摘要**：对话达到预算阈值时，保留最近几轮，并生成一份结构化摘要。
3. **硬上限保护**：摘要失败、连续失败或预算仍不足时暂停新的 Tool 调用，提示用户压缩、开启新会话或明确要保留的内容。

第一版不做：

- Collapse 的复杂消息分组和 spawn 阻断机制。
- 针对特定厂商的 prompt cache editing。
- 依赖精确 tokenizer 的复杂跨 provider 预算算法。
- 让压缩 Agent 继续调用业务 Tool。

压缩摘要只需保留以下五个部分：

```text
目标与用户意图
已完成的操作与结果
当前文件 / 资料库 / 任务现场
用户明确的限制、偏好和确认
未解决问题与下一步
```

摘要生成必须是受限的一轮模型调用：不允许 Tool 调用，不允许写文件，不允许改变任务状态。摘要完成后插入一个明确的压缩边界标记，避免后续重复压缩同一批原始消息。

### 11.3 工作记忆的保留优先级

空间不足时，按以下顺序保留信息：

1. 当前用户目标和明确限制。
2. 未完成任务的输入、输出、runId、取消状态和待确认动作。
3. 已确认的关键决策及其原因。
4. 当前选中节点、资料库和工具上下文的安全投影。
5. 最近几轮对话和最近一次失败结果。
6. 旧的原始 Tool 输出和可重新读取的文件内容。

可以重新通过 Tool 获取的内容不应长期占据工作记忆。比如目录列表、文件全文、模型列表和媒体元数据都属于可重新获取信息；“用户要求以后默认保存到资料库”或“这个目录是视频归档，不允许批量覆盖”才是不可轻易推导的上下文。

### 11.4 长期记忆的简化分类

Claude 的 `user / feedback / project / reference` 四类记忆可以在 OmniFlow 中压缩成三类：

| OmniFlow 类型 | 保存内容 | 不保存内容 |
| --- | --- | --- |
| `preference` | 用户明确要求长期遵守的操作偏好、格式偏好和确认习惯 | 一次性的聊天语气或临时选择 |
| `project` | 资料库用途、命名规则、不可从当前文件推导的设计决策 | 当前文件列表、节点结构和可重新读取的配置 |
| `reference` | 外部文档、服务地址和用户明确提供的固定入口 | 临时签名 URL、Cookie、API Key |

`feedback` 不单独建类型，合并到 `preference`，但记忆正文仍保留“规则 + 原因 + 适用场景”。例如：

```text
规则：批量翻译默认只处理空白译文。
原因：避免用户已经手动修订的译文被覆盖。
适用场景：Agent 调用 subtitle.translate 时使用，除非用户明确要求全文重译。
```

记忆必须满足“删除后会不会实质改变未来行为”的测试。代码、文件结构、Git 历史和已经写入正式文档的规则不进入记忆。记忆只是线索，涉及当前文件或配置时仍必须通过 Tool 验证，不能把历史记忆当成当前事实。

### 11.5 自动提取的取舍

Claude 的后台 Fork Agent、节流、互斥和 trailing extraction 值得参考，但 OmniFlow 第一版不必完整实现：

- 用户明确说“以后都这样”时，主 Agent 直接提出一条待保存记忆并请求确认。
- 对话结束后的自动提取先不启用，避免每轮额外消耗模型调用和产生噪声。
- 后续若需要自动提取，可每 N 次有效对话后台运行一次受限提取器。
- 提取器只能读取会话和当前安全上下文，只能写入记忆目录，不能调用媒体、上传、网络或破坏性 Tool。
- 主 Agent 已经保存同类记忆时，后台提取必须跳过或合并，不能重复创建。

### 11.6 调研后形成的最小实现

第一版工作记忆可以只实现以下对象：

```ts
interface AgentWorkingMemory {
  goal: string;
  constraints: string[];
  appContext: {
    libraryId?: number;
    selectedNodeIds: number[];
    activeToolId?: string;
  };
  taskState: Array<{
    runId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    summary: string;
  }>;
  summary: string;
  recentMessages: AgentMessage[];
}
```

推荐的最小触发点：

- 每次 Tool 完成后更新任务摘要，但不立即调用 LLM 压缩。
- 估算上下文达到约 `80%` 时提示或安排压缩。
- 达到约 `90%` 时先裁剪旧 Tool 结果，再尝试一次摘要。
- 连续 3 次摘要失败后熔断自动压缩，暂停继续堆积上下文。

具体百分比只是初始策略，不能假设所有 provider 的上下文窗口相同；实现时应以当前 AI 服务声明的窗口或保守上限为准。

## 12. Agent 工作区与前端入口规划

### 12.1 入口决策

Agent 不先做成工具区里的一个普通工具，而是作为 `library detail` 的默认工作区入口。当前顶部工具栏继续保留文件、工具区和内置浏览器等模式；顶部的主页 / 网格按钮进入 Agent 首页。

当前 `SearchWorkspace` 的“文件 / 网页”切换和文件引导卡片属于旧的空状态交互，后续应移除：

- “文件”不再作为一个需要搜索的模式，目录树本身已经是文件入口。
- “网页”继续由顶部内置浏览器按钮负责，不在 Agent 首页重复做一套网页搜索入口。
- “双击 / 右键 / 拖拽”三张说明卡片删除，避免把操作说明写成页面主体。

### 12.2 目标页面形态

```text
library detail
  ├─ 左侧目录树
  └─ 主内容区
      ├─ file-viewer       已打开文件时展示 Viewer
      ├─ browser           顶部浏览器入口
      ├─ tools             AI 服务配置、媒体等精细工具
      └─ agent-home        没有打开文件时的默认 Agent 对话
```

Agent 首页采用“空状态居中、开始对话后变成时间线”的布局：

```text
未开始任务：
  中央 AgentComposer

已有消息：
  上方 AgentTimeline / ToolRunCard / ConfirmationCard
  下方 AgentComposer
```

标题、消息时间线和输入区以主内容工作区为基准水平居中。消息列与输入区共享同一条响应式宽度规则：默认占可用宽度约 `72%`，最小宽度约 `560px`，最大宽度约 `900px`；工作区窄于最小宽度时保留两侧 `16px` 安全间距并继续收缩，不产生横向溢出。

输入区视觉上参考 AI 字幕翻译页面的底部提示词栏，但语义改成通用 Agent：

- 中间是多行自然语言输入框，回车提交，`Shift+Enter` 换行。
- 输入框固定吸附在工作区底部，通过顶部拖拽条调整高度；向上拖动增高、向下拖动缩小，并受最小 / 最大高度约束，不使用浏览器原生右下角 resize 手柄。
- 左下角显示当前上下文（选中文件、当前目录、资料库），不是把文件名写死在输入框里。
- 右下角显示当前模型和推理强度，复用字幕翻译的模型设置组件、版本排序和二级菜单。`AI 服务配置`负责当前启用的服务商、地址与凭据；Agent 的具体模型和推理强度属于本机工具偏好。首次展开模型菜单时才读取当前服务的模型列表，同一次服务停留不重复请求，失败后允许再次展开重试；发送后提交按钮切换为停止按钮。
- Tool 执行、进度、确认和结果以消息卡片出现在时间线中。
- 不显示目标语言、字幕专用字段或“进入”按钮。

Agent 首屏不主动展示服务连接配置细节；服务仍由 `AI 服务配置` 管理，Agent 只读取当前启用档案的安全投影，不读取 API Key。模型与推理强度由 Agent 自己选择并存入本机偏好，不写回服务档案，也不跨机器同步。

### 12.3 前端状态 owner

```text
LibraryDetail
  持有 workspaceDisplayMode、当前资料库和目录树选中项
       ↓ 只读上下文投影
AgentWorkspace
  持有当前会话显示、输入草稿和滚动位置
       ↓ 受控 bridge
Electron main
  持有任务状态、Tool 执行、AI 流式请求和本地记忆
```

不能把 `AgentSessionSnapshot` 再复制到 `LibraryDetail` 或 `localStorage` 作为第二份事实。Renderer 只缓存输入草稿和展示状态，Session、Run、消息、Tool 结果和取消状态由 main 侧 `AgentSessionStore` 负责。

## 13. Agent 项目结构

第一版按“协议共享、界面展示、宿主执行、流程配方”拆分：

```text
src/shared/agent/
  agent.types.ts             renderer / main 共用的协议类型
  agent-events.ts            流式事件和任务状态枚举

src/features/agent/
  AgentWorkspace.tsx         页面级 Agent 工作区
  components/
    AgentComposer.tsx        输入、模型投影、提交 / 停止
    AgentTimeline.tsx        消息和工具执行时间线
    AgentToolRunCard.tsx     Tool 调用、进度和错误
    AgentConfirmationCard.tsx 高风险动作确认
    AgentContextStrip.tsx    当前文件、目录和资料库上下文
  hooks/
    useAgentSession.ts       订阅 main 流式事件、提交消息
  services/
    agent.api.ts             preload bridge 的 renderer 封装
  state/
    agent-view.state.ts      仅保存输入草稿和展示态
  skills/
    subtitle-translation/    字幕 Skill 的配置和结果展示

electron/ipc/agent.ts        IPC 权限、sender 校验和事件转发
electron/service/agent/
  agent-orchestrator.ts      感知 -> 思考 -> 执行 -> 再感知循环
  agent-context-provider.ts  安全应用上下文投影
  agent-tool-registry.ts     Tool 白名单与注册
  agent-session-store.ts    Session / Run / Message / ToolRun 的 SQLite 存储
  agent-permission-gate.ts   风险确认门
  agent-memory-store.ts      SQLite 记忆主存储
  agent-local-process-runner.ts 受控本地进程
  providers/                  provider 流式请求和 Tool Calling 适配
  tools/
    file-list.ts
    file-stat.ts
    media-inspect.ts
    media-extract-audio.ts
    subtitle-translate.ts
  skills/
    subtitle-translation.ts  Tool 的组合规则，不直接操作 UI
```

当前已经创建的 `ToolRegistry`、`AgentSessionStore` 属于这个结构的第一批基座；协议类型归位到 `src/shared/agent`，避免 main 反向依赖页面 feature。

## 14. 可选 Skill：字幕翻译

字幕翻译暂时不参与 Agent 核心开发。未来需要接入时，迁移顺序固定为：

1. 保留现有字幕解析、行状态、批量翻译、保存和取消逻辑，先把它们收敛成可被 Tool 调用的 service。
2. 新增 `subtitle.load`、`subtitle.translate`、`subtitle.save` Tool 和 `subtitle-translation` Skill。
3. Agent 根据用户目标组织流程，例如“翻译这个字幕文件”时自动读取、翻译空白行、展示进度并请求保存确认。
4. Agent 时间线中需要人工编辑时，打开复用的字幕结果面板，而不是再启动一套独立任务状态。
5. 等 Agent 链路通过验证后，移除工具区里的独立“AI 字幕翻译”入口；`AI 服务配置`继续保留为全局模型配置入口。

这样做可以保留现有功能的可靠实现，同时避免把字幕翻译重写成第二套状态机。Skill 负责流程，Tool 负责能力，字幕面板只负责结果编辑；在此之前不为字幕增加新的 Agent 专用状态。

## 15. 分阶段落地顺序

### Step 1：基座（当前已开始）

- 共享 Agent 协议类型。
- `ToolRegistry`、`AgentSessionStore` 和单元测试。
- 明确 main 是任务和执行状态的唯一 owner。

### Step 2：Agent 空间和流式对话

- 新建 `AgentWorkspace`，替换文件搜索空状态。
- 先只做文本流式回复，不接任何业务 Tool。
- 接入当前 AI 服务配置和模型选择。
- 完成消息、停止、错误和重新开始会话。

当前实现已完成本步骤的第一版：`AgentWorkspace` 已接入 `library detail` 默认空状态，Agent IPC 已支持 OpenAI 兼容接口 / Claude 的 SSE 增量回复、停止、错误和新会话。真实 provider 请求仍需要用户在本机配置 AI 服务后手工验证；本轮没有自动发起外部 AI 请求。

### Step 3：安全感知

- 从 `LibraryDetail` 注入资料库、当前目录和选中节点的安全投影。
- 实现只读 `file.list`、`file.stat`。
- 跑通“你能看到当前目录结构吗？”。

当前实现已完成本步骤：发送消息前由 renderer 的 `agent-context.api` 读取当前目录直属节点和选中节点详情，形成有数量上限的 `AgentPerceptionSnapshot`；主进程在接收后再次做字段清洗和截断。OpenAI 兼容服务与 Claude 均通过各自原生 Tool Calling 协议调用 `file.list` / `file.stat`，Tool Registry 只允许自动执行 `read` 风险工具，并将结构化结果交给模型继续回答；明确不支持 Tool Calling 的本地兼容模型会退回普通流式回答，仍只能依据同一份只读快照。当前最多执行 4 轮、8 次 Tool 调用；快照是请求级感知，不进入长期记忆，也不授予任意目录遍历、文件正文读取或写入能力。工具时间线当前展示开始、进度和结果，写操作确认卡片仍属于下一阶段。

内部 Tool ID 继续使用 `file.list` 这类带命名空间的稳定名称；Provider 传输边界会将其转换为 `file_list` 等兼容名称，并在流式 Tool Calling 返回后还原。协议映射会拒绝转换或 64 字符截断后重名的 Tool，Provider 命名限制不得反向污染 Tool Registry、任务时间线或 Skill 定义。

### Step 4：工具闭环

- 接入 `media.inspect` 和 `media.extractAudio`。
- 增加权限确认、进度、取消和执行后再感知验证。
- 字幕翻译等复杂 Skill 暂不阻塞核心 Agent 进度。

### Step 5：持久化和收口（已完成第一段）

- Session、Run、Message 和 ToolRun 已接到本机 SQLite，并提供会话管理与中断恢复。
- 增加会话摘要和用户确认的长期记忆。
- Agent 链路稳定后，删除旧的文件引导组件和独立字幕入口。
