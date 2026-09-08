# 内置 Agent Shell 架构

更新时间：2026-09-02

状态：**macOS Zsh 的三权限模式、终态日志分页、本机与资料库文件桥已接入生产 Registry、Orchestrator、Runtime、日志与配额，作为开发预览；Linux / Windows 与持久规则仍 fail-closed，尚未达到稳定发布标准**。

宿主机 raw Shell 的迁移目标、Codex 对照结论和 `host` / `run-workspace` 执行上下文契约见 [`built-in-agent-host-execution-contract.md`](./built-in-agent-host-execution-contract.md)。macOS `host` 分支已经接入本文描述的 Registry、Runtime、lease、preflight、Supervisor 与日志链，当前仍是开发预览；Linux / Windows 与持久规则继续 fail-closed，不能把这段预览实现称为稳定跨平台能力。

适用范围：

- `src/shared/agent/`
- `electron/service/agent/`
- `electron/platform/`
- `electron/ipc/agent.ts`
- `src/features/agent/`
- Agent Run 工作区、Shell 权限、进程、日志和资料库文件桥

本文冻结 OmniFlow 内置 Agent 的 Code Agent 级 Shell 目标架构。它扩展 `docs/built-in-agent-architecture.md`，当前代码事实是：**应用启动时只有 macOS 系统 Zsh 探测为 execution-ready，随后动态注册 `shell.run@1`；模型可提出非交互前台命令，每个 Run 使用创建时冻结的 `ask / auto / full-access` 本机设置经过 main prepare 与策略决策**。main-only execution lease 在签发与消费前重扫 workspace preparation context，绑定 owner、Run capability、ToolRun、workspace generation / content identity、真实 cwd、Provider binding 与命令 hash，消费后立即失效；SpawnPreflight 在 Supervisor 启动前复验冻结 action / invocation / environment、Provider registration / probe / snapshot、AI destination 和 analyzer / policy revision，并在短期 watcher 前后权威重扫。Supervisor 只接受已消费 grant，固定 `shell: false`，负责进程生命周期、取消、超时、输出上限和进程树终止。LogStore 与物理 LogFileStore 负责安全序号、ANSI / OSC 清洗、脱敏、有界 tail、详细正文、opaque `logRef`、TTL 和共享 quota。生产 Service Runtime 已连接 Provider / AI binding resolver、Registry、Orchestrator、审批 UI、结果 presenter、ToolRun settlement 与应用启动 / 退出。Linux Bash 与 Windows PowerShell 保持 `executionReady: false`；在本文剩余门禁和真实安装包验收完成前，只能把 macOS 链路称为开发预览，不能宣传为稳定 Shell、OS sandbox 或跨平台能力。

现有 Session / Run / ToolRun、Tool Registry、Run capability snapshot、Permission Gate、Tool Broker、SQLite、revision、停止和恢复规则继续有效。Shell 不是绕过这些基建的第二条执行链。

详细日志的当前实现边界：Supervisor 输出仍同步进入 LogStore 的 tail；当绑定物理 Store 时，详细正文按 NDJSON frame 串行异步写入 main-owned 文件，内存只保留有界 tail、frame 索引和未完成写入的短暂队列。分页读取是异步的，会等待该日志的物理写入队列并按 `offset / recordBytes` 校验后解码。SQLite 只保存日志 metadata、tail 和物理 frame refs；旧版本 inline `detailedFrames` 可以被读取并迁移到物理 Store。配额 ledger 通过 resource ref 在重启后重新绑定，物理日志文件和 SQLite 记录仍由同一个 storage runtime 生命周期关闭。单条日志句柄提供精确 `flush`，Runtime 在终态 settlement 前等待当前日志的物理写入、quota operation 与 metadata checkpoint，不等待其他日志的物理写入。

## 1. 冻结结论

本轮已经确定以下方向：

- 不做预设命令白名单或“只读 Shell” Profile；第一版直接接受原始 Shell 命令字符串。
- `shell.run` 以当前系统用户权限运行。审批、权限规则、审计和数据最小化是主要防线，不能把命令分析器、工作目录或提示词描述成 OS 沙箱。
- Shell 只能经 Tool Registry、main prepare、权限判断、ToolRun、AgentToolBroker 和平台 Provider 执行；不得直接暴露 `AgentLocalProcessRunner`、Node `spawn` 或 raw IPC。
- V1 产品协议只提供非交互、前台命令：没有 stdin、PTY、密码输入、TUI、后台 Job 或跨重启续跑，并拒绝分析器能识别的脱离语法。宿主权限下的 raw command 仍可能借助其他解释器、本机程序或 GUI API 间接 daemonize、注册计划任务或弹出窗口；没有 OS containment 时不能声称完全阻止。
- macOS / Linux 与 Windows 使用独立 Provider；Windows 默认 PowerShell，不用 POSIX quoting 模拟 Windows。
- 每个 Run 有独立虚拟工作区。`cwd` 始终使用工作区逻辑相对路径；但用户在当前请求中明确给出的宿主绝对路径，可以直接出现在受支持只读命令的 `command` 中，用于查看、读取、概括或分析本机文件。外部路径仍由 Analyzer 与 Run 冻结的权限模式决策，不能据此取得 workspace 物理路径或自行指定任意本机输出路径。
- `run-workspace` 中的 `~`、`$HOME` 与 `%USERPROFILE%` 指向 Run 虚拟 `home`；`host` 中则指向 main 冻结的宿主用户目录。直接读取宿主文件必须显式选择 `executionContext = host`，不能只靠相同路径文字隐式切换上下文；`file.stage` / `file.upload` 的 `~/` 来源仍由 main 按宿主路径单独规范化。
- 资料库文件必须经 `file.stage` 暂存后才能被 Shell 使用；本机文件只有在需要工作副本、修改、转码或作为生成流程输入时才暂存。单纯读取明确宿主绝对路径不先 stage；Shell 产物必须经 `file.publish` 才能进入资料库或本机目标位置，原样上传本机文件仍使用 `file.upload`。
- 普通 Tool 仍逐次审批。Shell 可以拥有独立、显式、可撤销、可审计的长期权限规则，但记忆、Skill、历史文本和普通 Tool 的一次批准都不能生成或扩大规则。
- stdout / stderr 使用有序、有界的实时 tail；main 托管有配额的已清洗全流日志。超过日志上限后的输出只继续 drain 和计数，不能整体写入 SQLite、时间线或模型上下文。
- `AgentLocalProcessRunner` 继续以绝对 executable + argv、`shell: false` 启动平台解释器；其当前内存收集、输出超限即终止和 Windows 取消兜底不能原样承担 Shell Runtime。

## 1.1 当前实现进度

已落地并接入 macOS 开发预览 Tool 链的 Process Supervisor 位于 `electron/service/agent/shell/agent-shell-process-supervisor.ts`；LogStore 位于同目录的 `agent-shell-log-store.ts`，物理正文 Store 位于 `agent-shell-log-file-store.ts`，SpawnPreflight 位于 `agent-shell-spawn-preflight.ts`，Runtime 编排契约位于 `agent-shell-runtime.ts`。Supervisor 只接受 execution lease manager 消费后生成的 main-only grant，拒绝普通对象、过期 grant、命令 hash / Provider executable / cwd / fixed argv 漂移和同一 lease 重复 spawn；macOS / Linux 使用 detached process group，Windows 使用非 detached 子进程并复用平台进程树终止策略。

Supervisor 当前提供 `starting -> running -> terminating -> terminal` 生命周期、`completed / failed / cancelled / timed-out / interrupted` 终态、温和终止到强制终止的 grace / settle budget、单 Supervisor 并发上限、有序 stdout / stderr 事件和 UTF-8 carry decoder。它持续 drain 并向 Runtime 发送全部解码事件，同时维护最多 `1 MiB` 的 main-only head + tail 诊断采集；采集超限只丢中段、继续更新 tail 和省略字节数，不再终止命令。head / tail 同时受固定字节数和最多 `4,096` 个返回事件约束，尾部回收使用有界游标 / 周期压实而非 `Array.shift()` 搬移。LogStore 接受 Supervisor 的输出事件并重新分配从 1 开始的统一序号，分别维护双流的 ANSI / OSC parser 和 redaction carry，保存有界详细日志与最新 tail，并把同一批已清洗 frame 送入独立、最多 `160,000` UTF-8 bytes 的安全 head + tail 模型源；该模型源使用固定 Buffer 与环形 tail，不按来源碎片积累对象。Shell Tool 再让结构化结果自适应收口到约 `90,000` JSON 字符，以通过 Broker 的 `100,000` JSON 字符规范结果门禁并为清洗和传输字段留余量。详细日志达到自己的持久化上限后才按日志协议停止保存正文并继续 drain / 计数。LogStore 继续提供身份绑定的分页和过期清理；持久化与配额 adapter 通过注入接口保留。配额 adapter 契约已支持新建日志的异步 `reserve -> adjust / commit` 和 `markDeleting -> release` 生命周期，`agent-shell-log-quota-adapter.ts` 已将该契约映射到共享 `AgentLocalStorageQuotaManager`，并校验 reservation / resource 身份：输出热路径只合并目标字节数，不等待配额 I/O；详细日志达到上限后仍继续 drain 并累计丢弃字节。SQLite metadata、物理正文、共享 quota 和重启后的 resource ref reattach 已由生产 storage runtime 接线。`AgentShellSpawnPreflight` 已收敛 spawn 前 action / binding / workspace 重扫与观察窗口，并对 watcher 不可用、内容漂移、Provider / AI / policy identity 漂移 fail-closed。`AgentShellRuntime` 已收敛“获取并消费 lease -> spawn preflight -> 启动 Supervisor -> 绑定单条 LogStore -> 等待进程与当前日志 flush -> 生成结构化终态”，并将超时、日志失败、已确认取消、已确认中断和 termination incomplete 映射为稳定 settlement reason。Runtime / Supervisor / LogStore / SpawnPreflight 已接入 macOS 的 safe presenter、生产 binding resolver、Orchestrator 与 ToolRun settlement；Linux / Windows Provider、Windows Job Object containment 和对应安装包验收仍未完成，因此其他平台继续不注册用户可调用的 `shell.run`。

## 2. 目标与非目标

### 2.1 V1 目标

- 让模型运行 `ffmpeg`、`git`、`npm`、文本处理和其他本机已有 CLI。
- 支持管道、重定向、变量、条件和多行脚本等原生 Shell 语义。
- 在执行前展示并冻结精确命令、Provider、逻辑 cwd、环境覆盖、超时和风险分析。
- 支持“仅本次”“本 Session”“当前资料库长期允许 / 拒绝”三类用户决策。
- 实时展示 stdout / stderr，并在取消、超时、页面卸载和应用退出时得到确定终态。
- 让资料库文件、本机用户选择的文件、Shell 工作文件和最终产物形成可追踪闭环。
- macOS 与 Windows 共享同一 Tool / ToolRun / UI 语义，平台差异只落在 Provider 和进程树实现。

### 2.2 V1 不做

- 不做交互终端、PTY、stdin 转发、密码提示或全屏 TUI。
- 产品协议不提供 `&`、`nohup`、`disown`、`Start-Job`、脱离式 `Start-Process` 等后台运行，并拒绝分析器识别出的对应语法；间接 daemonize 仍属于宿主权限模型下的残余风险。
- 不做应用重启后的命令续跑或自动重放。
- 不做提权、`sudo`、`su`、UAC、`runas` 或系统服务安装。
- 不把 Shell 嵌入 Skill 定义，也不允许 Skill 自带脚本、Hook 或权限规则。
- 不把命令分析器包装成安全沙箱；不承诺 macOS、Linux、Windows 具有相同的 OS 隔离能力。
- 不让模型直接取得 MinIO 签名 URL、API Key、Cookie、宿主完整环境、本机真实工作区根路径或日志文件路径。
- 不用 Shell 取代已有高层 Tool。目录创建、资料库上传、Save As、媒体检查等稳定业务动作仍优先使用结构化 Tool。

后台 Job 与 PTY 只有在独立的 ProcessSession、持久状态、输入所有权、日志、取消和恢复协议完成后才允许进入后续版本。

## 3. 调研取舍

### 3.1 证据等级

- 本地 `project/claude-code-book-main` 不是 Claude Code 官方源码。其 README 明确声明内容来自公开文档和产品行为分析，因此本文只能写成“解析材料声称”，不能把其中的接口、状态和实现细节当作 Anthropic 官方源码事实。
- 本地 `project/opencode-dev` 是本轮可直接核对的源码快照，但本文没有锁定其上游 commit。下面关于 OpenCode 的结论只对应当前本地快照，升级参考项目后必须重新核对。
- 本地 `project/codex` 是可直接核对的 Codex 官方开源仓库快照；本文关于输出分层和 Tool loop 的结论锁定到 commit `a9519cbcdd2d`，升级参考项目后必须重新核对。
- OmniFlow 只吸收能由源码、测试或明确产品契约支撑的原则，不复制项目名称、模块形状或未经验证的内部实现。

### 3.2 两家共同支持的原则

Claude Code 解析材料把查询运行时描述为 Tool 生命周期、权限和取消的 owner，UI 只消费事件；权限在执行前基于不可变快照判断，Tool 区分 `queued -> executing -> completed -> yielded`，并为单个 Tool 使用分层取消。材料还声称大输出会截断并把剩余内容写入磁盘。可借鉴的是“执行事实归运行时、完成与发布分开、完整输出不直接进入模型”，而不是其未公开的具体代码。

OpenCode 当前源码提供了更直接的交叉证据：

- `packages/core/src/tool/registry.ts` 的统一 settlement 边界在 leaf Tool 返回后执行输出 bounding；leaf Tool 自己持有解析、权限和副作用顺序，Registry 不替代业务事务。
- `packages/core/src/session/runner/llm.ts` 先发布 Tool 调用事实再开始执行；恢复时遗留的 `pending / running` 调用会被标记为 interrupted，而不是自动重放副作用。
- `packages/core/src/tool-output-store.ts` 把模型结果限制为 2,000 行 / 50 KiB，超限正文写入托管目录；写入失败会让 settlement 失败，不会谎称全文已经保存。
- `packages/core/src/cross-spawn-spawner.ts` 在 POSIX 尝试终止负 PID 进程组，在 Windows 使用 `taskkill /T /F`，必要时从 SIGTERM 升级到 SIGKILL 并等待进程关闭。

Codex 当前源码把“命令实际输出”“模型看到的 Tool result”和“界面默认展开量”明确拆开：

- `codex-rs/core/src/unified_exec/mod.rs` 把单次统一执行的进程结果采集限制为 `1 MiB`，并把模型 Tool 输出的默认预算设为 `10,000 tokens`；这两个数字属于不同层，不能互相替代，`10,000 tokens` 也是 Codex 调研事实，不是 OmniFlow 当前 `shell.run` 的上限。
- `codex-rs/core/src/unified_exec/head_tail_buffer.rs` 等额保留 head 与 tail，超限时丢弃中段，而不是让长文件开头或错误结尾单独占满结果。
- `codex-rs/core/src/tools/context.rs` 在进入模型上下文前再次做独立投影；进程采集上限不代表要把 `1 MiB` 全部发送给模型。
- `codex-rs/tui/src/exec_cell/render.rs` 默认只展示约 5 行 Agent 命令输出，完整 transcript 由独立查看路径承担；这个对照只证明“摘要与完整输出应分层”，不要求 OmniFlow 复制其五行默认展示，OmniFlow 当前采用更紧凑的无框单行入口。
- `codex-rs/core/src/session/turn.rs` 和 `stream_events_utils.rs` 以 Tool 执行后是否仍需要 follow-up 决定是否继续主循环，没有固定 Tool 调用次数计数器。源码中的 `256` 只限制 analytics 收集的 call ID 数量，不限制 Tool 执行。

OmniFlow 同样不设置固定 provider turn 或 Tool 调用次数上限，但在 main 保留最近 24 轮稳定摘要：长度 `1..8` 的同一 Tool 调用 / 结果周期连续重复 3 次时停止，任一周期内容变化都会破坏匹配。普通 Tool 的业务 revision / 时间字段参与摘要，只有 `shell.run` 的 `result.data` 顶层 execution transport 元数据被忽略，不能以全局删字段制造“无进展”。

这些证据支持 OmniFlow 继续采用以下 Shell 原则：

- 原始命令先经过 schema、分析、权限和审批，再进入进程层。
- 复合命令按原子操作、重定向和副作用逐项评估；无法可靠分析时默认询问。
- AST 用于解释和生成规则，不改写将要执行的命令，也不是沙箱。
- 非交互命令和 PTY 是两种不同产品能力，不共用一套含糊状态。
- Supervisor 的 main-only 诊断采集最多 `1 MiB`、最多返回 `4,096` 个事件并等额保留 head / tail；全部输出仍继续进入已清洗的有界全流托管，超过持久化配额后继续 drain 和计数。Runtime 的安全 head + tail 模型源最多保留 `160,000` UTF-8 bytes，使用固定 Buffer 与环形 tail；碎片化的一字节输出不能造成无界对象增长或反复数组头部搬移。规范结果再受 `100,000` JSON 字符硬门禁并自适应收口到约 `90,000` JSON 字符。单个 Shell provider 结果使用最高约 `40,000 tokens` 的独立投影预算，真实 continuation 空间不足时按 byte / token 再次收缩并重算真实 `omittedBytes`；renderer 每流只接收最多 `4 KiB` 摘要，但非审批 Shell 的默认 UI 只显示无框单行命令摘要，详细正文仅在点击后进入受控分页日志。原始诊断采集、规范结果中的模型源、provider Tool result、renderer 摘要和详细日志各有独立预算，不能相互替代或把任一完整正文直接铺满时间线。
- 取消必须终止 supervisor 管理的进程组 / Job，并等待 teardown，不能只取消等待结果的 Promise；宿主程序主动脱离仍是没有 OS containment 时的残余风险。
- Windows 使用独立的 PowerShell / 进程树策略，不能假设 POSIX 行为存在。

### 3.3 不能照搬的缺口

两家都没有给出 OmniFlow 资料库发布所需的完整事务答案：

- Claude Code 解析材料没有可核验的 idempotency key、远端提交查询、`commit_unknown`、multipart session、冻结上传目标或 complete / abort 竞争协议；“取消并丢弃 Tool 结果”也不能证明已经发生的远端副作用不存在。
- OpenCode 的 `packages/core/src/file-mutation.ts` 明确把 `Tool.Called` 与 durable settlement 之间副作用的 crash recovery 和 idempotency 留作 TODO；多文件修改仍可能部分成功。
- OpenCode 通用 settlement 不按 `toolCallID` 去重，重复进入仍可能再次执行 leaf Tool；其 Bash 在托管前先把捕获限制为 1 MiB，完整输出可能已经丢失。
- OpenCode 输出托管仍返回裸绝对路径，`sessionID / toolCallID` 没有形成 owner-bound opaque artifact；源码文档也把 opaque managed-output reference 列为后续工作。
- 两家都没有 sealed artifact 到预签名上传、资料库目标冻结、authoritative complete receipt、提交响应丢失后的状态核对，以及取消发生在提交边界附近时的稳定终态。

因此不能把 `cancelled`、超时或 IPC 断开直接解释为“副作用未发生”，也不能在提交结果未知时 abort、自动重传、生成第二份结果或切换成本机兜底。

### 3.4 OmniFlow 冻结的额外能力

OmniFlow 在共同原则之上保留自己的 authoritative settlement：

```text
Renderer：用户授权、进度和结果展示
Main：冻结 Tool 身份与目标、持有产物、执行上传事务和对账
Backend：幂等 operation ID、authoritative committed receipt
```

- 副作用开始前持久化稳定的 Tool / operation identity；恢复时查询同一 operation，不盲目重放。
- `uncommitted / commit_unknown / committed` 是不同事实。complete 响应丢失时只使用同一 operation 查询状态，取得 authoritative receipt 后才宣告成功。
- 资料库目标、Provider、冲突策略、文件身份和一次性 artifact grant 在 main 冻结；renderer 不提交签名 URL、upload session、part、ETag 或任意网络目标。
- 取消在本地执行阶段终止进程树并清理未提交资源；进入远端 complete / reconcile 边界后，先保存真实提交事实，再决定 Run 如何停止。
- 托管日志和产物必须使用 owner-bound opaque reference。托管失败时 Tool 明确失败，不能只保留截断文本却声称完整结果可恢复；超过预先公开的持久化上限时必须明确记录丢弃字节数。
- 现有 `media.extractAudio` sealed artifact 已按该边界完成 main-owned 上传事务：Renderer 不再协调 init / sign / complete，也不接触签名 URL。开发预览中的 `file.publish` / `file.upload` 已复用同一结算原则，后续维护不能重新引入 Renderer control-plane 过渡接口。

这不是对参考项目的无谓加层，而是在补 OpenCode 源码已经明确承认、Claude Code 解析材料没有覆盖的副作用持久化缺口。OmniFlow 仍不复制两者的编码、Git、CLI 或多 Agent 产品假设；Shell 必须继续服从资料库 scope、Run capability snapshot、ToolRun 审计和受控 UI 协议。

## 4. 信任模型

### 4.1 权限事实

`shell.run` 启动的进程拥有 OmniFlow 当前系统用户可以拥有的宿主权限。除非以后增加真实 OS sandbox，否则命令理论上可以读取用户可读文件、修改用户可写文件、访问网络并启动其他进程。

因此必须始终使用准确表述：

- AST / token 分析是审批辅助，不是隔离边界。
- 相对 cwd 和 Run 工作区是默认操作范围，不是不可逃逸的容器。
- 环境白名单减少无意泄密，但不能证明子进程绝不发现其他宿主信息。
- 权限规则表达用户信任，不代表命令已经“安全”。
- macOS 可选 sandbox、Linux namespace / seccomp 或 Windows Job Object 都只能作为后续纵深防御，不能改变跨平台共同契约。

### 4.2 不可信输入

以下内容一律视为不可信数据：

- 用户消息和模型生成的命令。
- 目录名、文件名、文件正文、字幕、媒体 metadata 和命令输出。
- Shell 错误、外部 CLI 提示、ANSI 控制序列、URL 和包管理脚本。
- Skill instructions、长期记忆和历史审批文字。

文件或命令输出中的“忽略规则”“已经批准”等文字不能形成权限。Skill 只能收窄本 Run 已存在的 Tool view，不能授予 `shell.run` 或生成 Shell 规则。

### 4.3 数据披露

Shell 输出作为 Tool result 进入下一轮模型上下文时，等价于把该输出发送给当前 AI provider。实现必须：

- 在审批卡中说明本次命令的有界输出会用于 Agent 后续推理。
- 单个 `shell.run` Tool result 最高使用约 `40,000 tokens` 的 provider 投影预算，并在 continuation 空间不足时继续收缩；普通 Tool 保持约 `1,024 tokens`，`skill.activate` 为保证完整内置说明单独保留约 `10,000 tokens` 且禁止截断。预算依据 Provider 已解析回 canonical 的 Tool 名选择。Shell 文本结果来自 LogStore 清洗 frame 形成、最多 `160,000` UTF-8 bytes 的安全模型源；规范结果在 `100,000` JSON 字符门禁前自适应收口到约 `90,000` JSON 字符。未发生省略时 provider 投影使用完整 `content`；只有真实超限时才按 byte / token 选择 head + tail，并重新计算 `omittedBytes`。它不读取 Supervisor 的原始 `1 MiB` 诊断采集，也不自动上传 main 托管的有界全流日志或整个生成文件。
- OpenAI-compatible 与 Claude 的实际 input usage 只用于校准当前 Run 后续请求预检：累计本地估算相对实际值的最大正向低估量，缺少 usage 时继续使用字符估算，估算更保守时不放宽预算。Provider 返回结构化 context overflow 时失败当前 Run，不新建 Run、不重放已经执行的 Shell Tool，也不自动重试同一 provider turn。
- 在 provider 投影前继续执行凭据和敏感文本清洗。
- 检测到明确凭据、认证头、Cookie、私钥、签名 URL 或其他高置信秘密时拒绝执行或拒绝投影，不能用占位符掩盖后继续建立长期规则。
- 把本 Run 冻结的 AI profile / 配置 revision、provider 类型和规范 Base URL hash 合成为 `aiDestinationIdentity`；Shell 自动允许规则必须绑定该身份，切换本地 / 远端服务或修改 endpoint 后重新询问。
- 把命令可能读取的 staged source 集合纳入 prepared action 和 rule matcher；同名文件、不同 content hash 或不同 owner / library 不能沿用旧 `cat / grep / ffmpeg` 规则。

## 5. 分层与状态所有权

目标调用链固定为：

```text
AgentOrchestrator
  -> AgentRunCapabilitySnapshot
  -> AgentToolRegistry: shell.run
  -> AgentShellPreparationService
       -> AgentShellWorkspaceStore
       -> AgentShellProviderRegistry
       -> AgentShellAnalyzer
       -> AgentShellPermissionRuleStore
  -> prepared action / approval ToolRun
  -> AgentToolBroker
  -> AgentShellRuntime
       -> platform ShellProvider
       -> DesktopProcessSupervisor
       -> AgentShellLogStore
  -> bounded result / refreshed workspace manifest
  -> next provider turn
```

所有权规则：

| Owner | 负责 | 不负责 |
| --- | --- | --- |
| `AgentOrchestrator` | Run、ToolRun、prepare / approval / execute 顺序、取消和模型续轮 | Shell quoting、物理路径和 OS 进程细节 |
| `AgentRunCapabilitySnapshot` | 冻结本 Run 可见的 Tool、Provider capability 和 registration identity | 实时切换 Provider |
| `AgentShellPreparationService` | 规范命令、解析逻辑 cwd、分析风险、匹配规则、生成冻结动作 | 真正启动进程 |
| `AgentShellPermissionRuleStore` | 本机 Shell allow / deny 规则、scope、revision、撤销与命中审计 | 普通 Tool 审批和长期记忆 |
| `AgentShellWorkspaceStore` | Run 工作区、manifest、stage / publish binding、物理资源 adapter 和用量报告 | 全局配额、TTL 决策和自行返还额度 |
| `AgentLocalStorageQuotaManager` | Agent 临时产物、Shell 工作区和日志的原子预留、真实占用校正、TTL、清理选择与崩溃回收协调 | 业务文件内容、物理路径解析和 Run 状态机 |
| `ShellProvider` | 平台探测、方言分析、解释器参数、编码和进程树策略 | Agent 状态机和审批 UI |
| `AgentShellRuntime` | 运行一个已批准动作、流式输出、超时、取消和终态 | 修改已冻结命令或权限决策 |
| `AgentShellLogStore` | 有序已清洗日志、tail、安全引用、物理资源 adapter 和用量报告 | 全局配额、TTL 决策、自行返还额度或把日志路径交给 renderer / 模型 |
| `AgentDatabaseSchemaCoordinator` | Agent SQLite canonical DDL、开发期 reconcile、结构自检和全 Store 启动 barrier | Session / Rule / Memory / Quota 的业务 CRUD |
| Electron main + SQLite | Session / Run / ToolRun / approval / rule 的规范事实 | React 视觉状态 |
| Renderer | 命令审批草稿、tail 展示、规则管理和受控动作分发 | 直接 spawn、直接读日志文件、创建权限或判定执行成功 |

Shell 继续复用现有八种 Run / ToolRun 状态。V1 不新增第二套 Process 状态机；后台 Job / PTY 进入产品时才新增正式 ProcessSession。

## 6. `shell.run` Tool 契约

V1 模型输入冻结为：

```ts
interface AgentShellRunInputV1 {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  providerId?: string;
}
```

字段语义：

- `command`：原始命令正文，允许多行；1～24,576 UTF-8 bytes，禁止 NUL。当前 macOS Analyzer 支持的 `cat / du / file / head / ls / stat / tail / wc` 等只读命令可以直接引用用户明确给出的宿主绝对路径；该路径仍属于外部访问，必须进入 Analyzer、Policy 和审批 / 放行链，不能扩展成对任意命令或相邻路径的授权。完整 Tool input 的规范 JSON 仍必须落在现有 64,000 字符总上限内。
- `cwd`：Run 工作区内的逻辑相对路径，默认 `work`，最多 1,024 UTF-8 bytes；不接受宿主绝对路径、盘符、UNC 或未经授权的 `..` 逃逸。
- `timeoutMs`：main 再钳制；初始默认 10 分钟，硬上限 6 小时。
- `env`：只允许非秘密、任务级临时覆盖；最多 32 项，名称最多 64 ASCII 字符，单值最多 2,048 UTF-8 bytes、合计最多 16 KiB，不能覆盖 main 保留变量。
- `providerId`：可省略且最多 128 ASCII 字符；只能选择本 Run Effective View 中的平台 Provider，不能提供 executable path。

这里的 raw Shell 指 `command` 由平台解释器按原生语法执行，不是把命令拆成预设 CLI Profile。模型仍不能决定解释器路径、启动 flags、物理 cwd、基础环境、stdin、PTY、后台模式或进程树策略。

### 6.1 环境规则

main 使用显式基础环境，再叠加经过校验的 `env`：

- `run-workspace` 的 `HOME / USERPROFILE` 映射到 Run `home`，其中 `~` 只展开到虚拟 home；`host` 使用 main 过滤并冻结的宿主环境，`HOME / USERPROFILE / ~` 表示宿主用户目录。
- `TMPDIR / TEMP / TMP` 映射到 Run 的 `tmp`。
- `PATH` 由平台 Provider 构造并冻结，模型不能覆盖。
- locale 和编码由 Provider 固定为可预测值。
- 不继承 API Key、Cookie、认证头、代理凭据或应用内部 token。

以下环境键至少属于禁止覆盖范围：

```text
PATH HOME USERPROFILE SHELL COMSPEC SystemRoot WINDIR
TMP TMPDIR TEMP
BASH_ENV ENV PROMPT_COMMAND
NODE_OPTIONS PYTHONPATH PYTHONHOME
LD_PRELOAD LD_LIBRARY_PATH DYLD_*
PSModulePath POWERSHELL_TELEMETRY_OPTOUT
*TOKEN* *KEY* *SECRET* *PASSWORD* *COOKIE* *AUTH*
```

普通环境值必须在审批中完整、可读地展示并绑定 hash。动态环境覆盖存在时，持久规则必须精确绑定全部键值；无法安全展示或审计时只允许本次执行。

## 7. Prepare、分析与冻结

### 7.1 Prepare 顺序

`shell.run` 在 main 中完成 prepare：

1. Tool Registry 对原始输入执行严格 JSON Schema 校验。
2. 从 Run capability snapshot 解析冻结 Provider；不可用或 registration identity 变化则 fail-closed。
3. 解析逻辑 cwd，检查工作区 generation、realpath 和目录存在性。
4. 规范 timeout 与环境覆盖，执行秘密检测和保留键校验。
5. `AgentShellCommandAnalyzer` 根据冻结 Provider 方言，对**原始命令**使用对应 Tree-sitter grammar 生成 AST。
6. Analyzer 从 AST 计算静态原子操作、重定向、网络、外部路径、删除、嵌套解释器和无法解析项；动态语法、不受支持参数或解析器故障会记录 `unresolved` / `unknown_syntax`，由后续 Policy 按权限模式决定是否询问或放行，Analyzer 本身不把未知命令当成永久执行白名单。
7. Policy Engine 先应用不可变 deny，再匹配显式 Shell 规则，并按 Run 冻结的 `ask / auto / full-access` 模式得出决定。
8. 生成 public prepared action、main-only execution binding、单次 ID 和 snapshot hash。
9. 持久化 ToolRun 后才向 renderer 展示审批或进入执行。

分析器只能描述命令，不得重写、补引号、排序或“修复”命令。真正执行的 command bytes 必须与审批绑定的 bytes 完全相同；Provider 为传输、编码和禁用 profile 增加的固定 wrapper 不属于模型命令，但必须由 provider registration identity 冻结。

### 7.2 Public prepared action

严格的 `AgentPreparedActionPublic` 判别联合已经包含独立的 `media.extractAudio@1` 与 `shell.run@1` 分支。Shell 分支已在共享 normalizer、main-only command hash seal、Registry seal、SessionStore bootstrap / 写入边界和 schema 2 trigger 中 fail-closed；macOS 开发预览已经使用该结构完成单次审批与执行，结构为：

```ts
interface AgentShellPreparedActionPublicV1 {
  kind: 'shell.run';
  version: 1;
  command: string;
  commandHash: string;
  provider: {
    id: string;
    dialect: 'bash' | 'zsh' | 'powershell';
    version: string;
  };
  cwd: {
    kind: 'run-workspace';
    path: string;
  };
  timeoutMs: number;
  environment: Array<{ name: string; value: string }>;
  assessment: {
    risk: AgentToolRisk;
    facets: string[];
    operations: Array<{
      executable: string;
      argvPrefix: string[];
      effects: string[];
    }>;
    unresolved: string[];
    persistentRuleEligible: boolean;
  };
  dataScope: {
    stagedInputs: Array<{
      logicalPath: string;
      sourceKind: 'library' | 'local-picker';
      displayName: string;
      contentHash: string;
    }>;
    unresolvedWorkspaceRead: boolean;
  };
  aiDestination: {
    profileLabel: string;
    providerType: string;
    identityHash: string;
  };
}
```

main-only binding 还必须冻结但不得投影：

- owner、library、Session、Run、ToolRun 和一次性 prepared action identity。
- Provider 绝对路径、启动 flags、探测 generation 和 registration identity。
- 逻辑 cwd 对应的物理 realpath、工作区 ID 和 generation。
- 完整有效环境、环境策略 revision 和 PATH hash。
- 冻结的 AI profile ID / 配置 revision、provider 类型和规范 Base URL hash；不含 API Key。
- staged source 的 canonical owner、来源授权、node revision / content hash 和工作区 data-scope hash。
- analyzer / policy revision、规则 ID / revision 和匹配结果。
- 命令、public action 与其他 snapshot material 的统一 hash。

用户编辑 command、cwd、timeout 或 env 后必须重新 prepare。批准后任一 binding 漂移都拒绝旧动作，不能静默换 Provider、目录或规则继续执行。

### 7.3 分析结果

分析器至少投影以下风险分面：

```text
filesystem.read / filesystem.write / filesystem.delete
external_path / redirection / command_substitution
network / package_install / process_launch
nested_shell / dynamic_command_head / unknown_syntax
environment_change / system_configuration
interactive / detached / privilege_escalation
```

管道、`&&`、`||`、子 Shell、命令替换、重定向和脚本块都必须拆成原子操作。`npm test` 的规则不能覆盖 `npm test && rm ...`。任一原子操作、重定向或风险分面没有匹配时，整个动作不能自动允许。

解析失败、动态 command head、`eval`、嵌套解释器、PowerShell encoded command 等在 `ask / auto` 下会进入询问路径；在 `full-access` 下，只要没有命中不可变 deny 或显式 deny，当前 Policy Engine 会直接放行（不限定为“仅本次”）。这些 assessment 仍不得据此生成 Session 或持久规则。

### 7.4 执行前权威复验

prepare 或 approval 成功都不直接等于可以 spawn。`AgentShellRuntime` 必须先向 `AgentShellWorkspaceStore` 取得当前 execution lease，并在该 lease 内紧邻 spawn 完成最后复验：

1. 重新校验 owner、Session、Run、ToolRun、prepared action / execution identity、Provider registration、command bytes / hash、逻辑 cwd realpath、环境策略、AI destination、规则 ID / revision 和全部 policy revision。
2. 对命令可读取的完整 Run workspace（`input / work / output / tmp / home`）重新枚举有界 manifest 并计算 `workspaceContentIdentity`，与 prepared binding 逐项比较；只有分析器能证明更小的精确 read set 时才允许收窄。只看 cwd 或 workspace generation 不足以发现同用户外部进程、先前逃逸进程或 `../input` 等跨逻辑根读取所涉及的内容变化。
3. 任一内容、realpath、symlink / junction、来源 provenance 或授权身份变化都废止旧 execution capability，回到新 prepare / ask；不能把“执行失败”当成继续使用旧批准的理由。
4. Session / 持久规则自动允许只有在 WorkspaceStore 能从刚复验的内容创建 main-owned 新 execution generation 时才可用：先复制 / clone 出内容一致的执行快照，绑定 resolved cwd handle，再启动 Provider；命令写入该 generation，进程收口后重新生成 manifest 并把它切换为规范 workspace generation。无法对命令可读取的完整 Run workspace 建立有界快照、或命令依赖无法冻结的外部内容时降级为“仅运行本次”。
5. “仅运行本次”同样在 spawn 前重验内容；能使用 execution generation 时继续使用。平台只能做到 rehash 后立即 spawn、无法彻底关闭同系统用户的 rehash-to-spawn 竞态时，必须在审批中保留该残余风险；execution lease 建立到 Provider spawn 完成之间，filesystem watcher 发现内容漂移就废止动作。spawn 后命令自身会合法写入，不能再把所有文件事件当成外部篡改；这仍不是 OS sandbox。

execution lease 只排除 OmniFlow 自己的并发 stage / publish / Shell mutation，不能阻止拥有相同宿主用户权限的外部进程。实现不得因为有 lease、snapshot 或 watcher 就删除第 4 节的宿主权限声明；真正消除此类竞态仍需要后续 OS containment。

## 8. 平台 Provider

### 8.1 统一契约

每个 `AgentShellProvider` 至少实现：

```text
probe -> identity / dialect / version / availability
analyze(command) -> AST-derived assessment
prepare(command, cwd, env) -> absolute executable + argv + process options
decode(stream bytes) -> normalized UTF-8 chunks
terminate(process) -> verified whole-tree outcome
```

Provider 必须随 Run capability snapshot 冻结。批准后版本、可执行文件、方言或能力 generation 改变时重新 prepare；不得自动降级到另一个解释器。

### 8.2 macOS

- 默认 Provider 使用系统 `zsh`，绝对路径解析后以 `shell: false` 启动。
- 固定禁用用户 profile / rc；不加载 alias、prompt hook 或 shell plugin。
- 使用独立进程组，取消时先软终止、再强制终止并确认进程组收口。
- Bash 兼容 Provider 只有在 Probe 后进入 Effective View，不能拿 Bash AST 分析结果声称覆盖全部 Zsh 扩展语法。

### 8.3 Linux

- 默认使用受 Probe 确认的 Bash Provider，禁用 profile / rc。
- 进程组、父进程死亡和孤儿清理必须单独验证；不能只复用 macOS 测试结论。
- Linux 尚非当前主要打包平台时，可以保持代码契约，但发布说明不得在真实安装包验收前宣称支持。

### 8.4 Windows

- 默认使用 PowerShell Provider，优先系统可用且已 Probe 的稳定实现；`cmd.exe` 不属于 V1 默认能力。
- 固定 `-NoLogo -NoProfile -NonInteractive` 和 UTF-8 输出策略。
- 为避免 `CreateProcess` quoting 与命令长度漂移，Provider 可以把原始命令写入 main-owned 控制目录的脚本，再以固定 argv 执行；控制脚本不位于 Shell 可发布目录。脚本编码必须随 Provider identity 冻结：Windows PowerShell 5.1 使用其能无损识别的 BOM / UTF-16LE 或带 BOM UTF-8 策略，PowerShell 7 `pwsh` 可以使用 UTF-8，并分别验证中文、多行和空格路径。
- PowerShell AST 必须由同方言 Parser 生成，Bash parser 不能分析 PowerShell。
- Windows 受管进程取消的完成门禁是禁用 breakaway 的 Job Object 或等价可验证 supervisor。当前 `taskkill.exe /T` 失败后直接终止子进程的兜底不足以宣称任意 Shell 已清理完成。

平台解释器始终由 `AgentLocalProcessRunner` 或其下沉后的共享 Process Supervisor 以“绝对 executable + argv + `shell: false`”启动。`shell.run` 这个名字不表示 Node `spawn({ shell: true })`。

## 9. 权限模型

Shell 权限模式固定为三种，并在 Run capability snapshot 创建时冻结；模式切换只影响后续新 Run，不能给正在执行或等待确认的 Run 中途提权：

- `询问我（ask）`：没有精确规则覆盖的命令进入用户确认。它是当前生产准备链的默认值；直接读取明确宿主绝对路径也属于需要确认的外部访问。
- `自动批准（auto）`：只由 main 的确定性 Analyzer + Policy 决策，不调用第二个 LLM，也不接受模型自己声明安全。只有语法已经完整分析、所有路径均由 main 证明位于 Run workspace、且不涉及外部路径、网络、包安装、系统配置、环境覆盖或其他未解决分面的命令才能自动放行；直接读取宿主绝对路径仍继续询问，其他情况询问或拒绝。
- `完全访问（full-access）`：用户明确选择后，当前 Run 不再因为外部路径、网络、系统修改、destructive 分面或 Analyzer 的 `unresolved` / `unknown_syntax` 结果而询问；在当前代码中，只要没有命中不可变 deny 或显式 deny，就直接 `allow`，语义上接近 Code Agent 的 full-access / no-approval 模式。它不是 OS sandbox：命令拥有当前宿主用户本来具备的文件、进程和网络权限。V1 尚不支持的 PTY、interactive、后台脱离和提权由不可变 deny 保持拒绝。若未来要让其他高影响分面在 `full-access` 下继续确认，必须新增并冻结 policy revision，不能把该意图写成当前行为。

`AgentShellPolicyEngine` 只消费结构化 assessment、main 已匹配的规则与 Run 冻结模式；它不解析命令字符串、不调用模型、不执行进程。显式 deny 和不可变 deny 始终优先于模式；随后 `full-access` 无条件放行剩余 assessment，`auto` 只放行完整分析且已验证 workspace 边界、没有自动确认分面的动作，`ask` 默认询问。当前代码已经落地该纯策略核心，并把三态模式纳入 Run snapshot identity；Agent 页面通过受控 IPC 读写 main-owned 本机设置，模式切换只影响后续 Run。macOS Zsh 探测成功时 `shell.run` 会注册，其他平台不注册。

### 9.1 决策优先级

main 按下面顺序得出最终行为：

```text
不可变 deny
  > 显式持久 deny
  > 当前 Session deny
  > 精确一次性批准
  > 当前 Session allow
  > 持久 allow
  > ask
```

`allow` 也必须经过本次 schema、prepare、Provider、cwd 和规则 revision 复验。不存在“因为以前运行过，所以直接执行”。

当前 `AgentShellPolicyEngine` 的不可变 deny 分支明确对应 `detached`、`interactive` 和 `privilege_escalation` 三个风险分面；接入规则时显式 deny 也始终优先。Provider / prepared action / workspace / rule 身份漂移由 prepare、lease 和 preflight 单独 fail-closed，protected / sensitive 环境覆盖在输入规范化阶段拒绝，并不是该 Policy 分支。

PTY、stdin、后台脱离、提权、控制目录访问和凭据 / 动态加载器注入仍是 V1 的整体能力边界；其中尚未映射为上述不可变分面的目标门禁，不能在文档中暗示已经由 `full-access` 自动保留确认。当前实现对 `filesystem.delete`、网络、包安装、系统配置、外部路径和其他 destructive 分面，在 `full-access` 且未命中 deny 时直接放行；若要收窄，必须增加新的 policy revision 和对应测试。

命令范围仍不靠硬编码 CLI 白名单限制 raw Shell；风险分析、明确规则和三种权限模式共同决定是否执行。

### 9.2 `AgentShellPermissionRuleStore`

Shell 长期规则使用独立本机 Store，不能复用长期记忆。最小字段包括：

```text
ruleId / revision / enabled / behavior
ownerScope / libraryScope / sessionScope
platform / providerId / dialect
matcherVersion / analyzerRevision / policyRevision / envPolicyRevision
canonicalMatcherJson / canonicalMatcherHash
commandHead / argvPrefixTokens / requiredFacets
atomicOperations / redirectTargets / networkDestinations
cwdSemanticScope / workspaceContentIdentity / workspaceDataScopeHash
envHash / timeoutCeiling
aiDestinationIdentity / providerRegistrationIdentity
createdFromPreparedActionHash
createdAt / updatedAt / lastMatchedAt / matchCount
```

规则要求：

- 默认按当前 owner、backend、account、library、platform 和 Provider 隔离。
- “仅本次”只消费当前 prepared action；“本 Session”绑定当前 Agent Session，但在应用退出、注销或 owner release 后失效，不因会话历史恢复而复活；“当前资料库长期”保存在本机 SQLite，直到用户撤销。
- Session 规则可以由同一 Store 记录审计，但 active grant 只存在于当前 main 生命周期；持久规则只保存在本机，不跨机器同步。
- matcher 由 main 根据 AST 原子操作生成，renderer 和模型不能提交 regex、通配字符串或任意 prefix。`canonicalMatcherJson` 使用带版本、确定性序列化的结构对象，明确 matcher mode、命令 token、原子操作、重定向、网络目的地、cwd 语义、数据身份和所有 revision；`canonicalMatcherHash` 只用于去重与审计，不能代替重新解析候选命令。
- `analyzerRevision / policyRevision / envPolicyRevision / matcherVersion` 任一不一致时，旧规则不得自动命中。main 必须用当前 Provider 和策略重新 prepare，再由用户决定是否创建新 revision；不可变 deny 始终先于规则。
- token prefix 按语法边界匹配；字符串前缀不是权限边界。
- 复合命令只有全部原子操作、重定向目标、规范化网络目的地、cwd、环境和风险分面均被 matcher 覆盖时才能自动运行。数组顺序只有在不改变 Shell 语义时才允许规范化；管道、条件和命令替换的执行顺序必须保留。
- `cwdSemanticScope` 绑定逻辑 cwd、项目边界和其内容身份，不绑定一次性物理 Run 路径。`workspaceContentIdentity` 由 main 对本次命令可读取的完整、有界 cwd manifest、文件 content hash 和 staged provenance 计算，保持与物理 Run ID / generation 无关；prepared action 另行冻结当前 workspace ID / generation 防止执行前漂移。每次匹配都在当前 generation 重算语义 identity，因此同名目录、不同项目内容或前序命令改写后的目录不能复用旧规则。
- 网络下载、包安装、前序命令生成文件或外部工具改写工作区后，只有 main 能重新枚举并证明完整内容身份时才允许产生 Session / 持久规则。无法证明精确 read set 或 `workspaceContentIdentity` 时，即使 `workspaceDataScopeHash` 为空，也只能选择“仅运行本次”。例如一个项目批准的 `npm test` 不能只凭命令和空 data scope 在另一个项目自动运行。
- 动态 host、代理转发或无法规范化的网络目的地不得生成 Session / 持久规则；可规范化目的地至少绑定 scheme、host、有效端口和必要的路径 scope，不保存凭据或敏感 query。
- 每条 allow 规则同时绑定 AI destination identity。AI profile、配置 revision、provider 类型或 Base URL hash 改变后必须重新 ask，不能因为命令 token 相同就把输出发送给另一个服务。
- 读取 staged / derived workspace 数据的规则还要绑定来源集合：canonical owner、library、source kind、node revision 或 content hash。V1 无法证明精确读取集合时，保守绑定本 Run 单调累积的全部 staged provenance；如果连完整 workspace content identity 也无法证明，则 Session 和持久规则都不可用，只能运行本次。
- 命令、环境或 matcher 中出现无法安全持久化的凭据和敏感值时不生成规则；本机 SQLite 不是保存 Shell 秘密的例外入口。
- 规则可查看、停用、删除；修改和删除使用 revision 乐观锁。
- 每次命中记录 rule ID、revision 和 prepared action hash，历史审计不能反向修改规则。
- 动态命令、未知语法、外部绝对路径、环境变化或高风险分面可以被批准一次，但默认不提供“长期允许”按钮。

普通 Tool 的单次确认语义保持不变。只有用户在 Shell 审批 UI 中明确选择 Session / 持久规则时，`AgentShellPermissionRuleStore` 才能写入；“记住这个选择”、Skill instructions 或模型输出都不够。

## 10. Run 虚拟工作区

每个 Run 使用 main 创建的独立工作区：

```text
run-workspace/
  input/    只读语义的暂存输入
  work/     默认 cwd，可修改
  output/   等待发布的规范产物
  tmp/      本 Run 临时文件
  home/     隔离 HOME
```

Shell 不可见的控制数据单独存放：

```text
agent-shell-control/
  manifests/
  scripts/
  logs/
  leases/
```

规则：

- Workspace cwd、Tool result 和 workspace SQLite 事实只使用 `input/...`、`work/...`、`output/...` 等逻辑路径。精确 Shell command、prepared action 与审批审计可以包含用户明确给出的宿主绝对读取路径；`file.stage` / `file.upload` 的本机来源显示路径是另一处独立窄例外。两者都不会变成 Shell cwd、workspace realpath、相邻路径授权或任意本机输出授权。
- main 在执行前将逻辑路径解析为 realpath，并绑定工作区 ID / generation。
- 已暂存输入记录来源、大小、content hash 和只读语义；不能通过同名覆盖偷换内容。
- 工作区 manifest 维护单调累积的数据来源 provenance。Shell 把 staged 内容复制或转换到 `work / output` 后，来源不会因路径变化而消失；在具备可信细粒度 lineage 前，后续可能读取 workspace 数据的规则都按保守来源集合评估。
- `output` 只表示候选产物，不代表已经上传或保存。
- stage、publish 和每次 Shell 完成后更新 manifest / generation；同一 Run 的 Shell V1 串行执行。
- symlink、hardlink、Windows junction、reparse point 和 UNC 必须在 stage / publish 边界检查，不能把逃逸后的文件作为可信产物。
- 物理根路径由 main 持有并在输出投影中替换为逻辑路径；这属于隐私最小化，不构成防逃逸沙箱。

工作区必须具备总量、单 Run、单文件、低磁盘水位和终态 TTL。Shell 可以比监控更快地写满磁盘，因此没有 OS quota 时，周期扫描和超限取消只是可靠性保护，不得宣传为严格安全隔离。现有 `AgentMediaArtifactStore` 与 Shell 工作区必须共享全局本机 Agent 存储配额 owner，不能各自认为磁盘预算充足。

### 10.1 共享本机存储配额

当前已经落地唯一的 `AgentLocalStorageQuotaManager` 及 SQLite ledger，`AgentMediaArtifactStore` 与 Run workspace 已向它登记；Shell control script、`AgentShellLogStore` 和 `AgentShellLogFileStore` 也必须复用同一个 manager，禁止各自维护互不相知的“剩余额度”。main-only 契约为：

```text
reserve(owner, category, runId, expectedBytes, ttl, adapterId) -> reservationId
bindResource(reservationId, resourceRef, owner)
growReservation(reservationId | resourceRef, newExpectedBytes, owner)
commit(reservationId, resourceRef, actualBytes, owner)
adjust(resourceRef, observedBytes, owner)
touch(resourceRef, ttl, owner)
acquireLease(resourceRef, ttl, owner) -> lease
releaseLease(resourceRef, leaseId, owner)
cancelReservation(reservationId, owner)
markDeleting(resourceRef, owner, observedBytes?: number | 'unknown')
requestRelease(resourceRef, owner, observedBytes?: number | 'unknown')
sweep(reason)
```

配额规则：

- `reserve / growReservation` 在同一个 main 串行 owner 中原子检查全局 Agent、category、Run、单文件、资源数量和低磁盘水位上限；默认最多保留 4,096 条本机资源记录，零字节预留也必须经过数量、聚合额度与磁盘水位门禁。磁盘门禁以当前文件系统可用量减去所有尚未物理兑现的 reservation headroom 和本次新增 headroom 后仍达到安全水位为准，不能让多个并发预留各自重复使用同一份空闲空间。失败时不能先写文件再补记账。
- 已知长度的输入先按预期字节预留，写入完成后以 main 读取到的 data fork 长度与平台上报的 allocated blocks 执行 `commit / adjust`。`commit / adjust` 属于写后协调：已落盘字节已经反映在 `statfs` 可用量中，因此只校正 ledger 与聚合 policy，不把同一增量再次从磁盘可用量扣除。未知长度流必须在每个写入批次前用 `growReservation` 扩展 headroom，扩展失败即停止生产者、继续必要的 pipe drain 并按对应 Tool 语义清理半文件。generic xattr 等没有反映在 `st_blocks` 中的扩展元数据当前不属于精确计费范围；可执行 Shell 前必须由 handle-based 平台 metadata adapter 补齐身份和 allocated accounting。
- `shell.run` 启动前按本 Run 的允许增长上限取得 workspace reservation；执行期间监控逻辑大小与实际分配字节并校正。无法取得初始 headroom 时不启动命令，不能只依赖命令结束后的目录扫描。
- reservation、已提交 resource、owner、Run、category、已观测计费字节、TTL 和清理状态写入 main-only durable ledger。live lease 只属于当前 main 进程并与所有 quota mutation 串行，不跨进程恢复；`releaseLease` 只释放该进程内事实，不为未持久化字段额外重写 SQLite。进程崩溃后先扫描固定托管根目录，以 data fork 与平台 allocated blocks 校正 ledger；过期 reservation 只有在确认没有 live Tool / process lease 后才能释放。
- Workspace / Log / Artifact Store 只注册 main-only resource adapter、绑定 opaque resource ref、报告实际用量和提交 cleanup intent。Quota Manager 独占 ledger、TTL eligibility、清理优先级和额度返还；它调用对应 adapter 的幂等 remove，只有收到物理删除成功回执后才删 ledger / 返还额度。Store 不得自行 sweep 已提交资源，Quota Manager 也不得绕过 adapter 拼物理路径。
- 物理删除固定为两阶段：显式 release、TTL sweep 和失败重试都先持久化 `deleting` 与保守债务，成功后才能调用 adapter。已知完整快照按 `max(旧计费字节, 已观测字节)` 记账；扫描无法完成或快照已经漂移时使用 `'unknown'`，同时持久化独立 unknown 标志并至少按当时全局配额上限记账。unknown 标志不随后续 policy 上调而失效，物理删除成功前无条件关闭新增 reservation、正向扩容和新 lease。`deleting` 记录即使超过当前单资源或聚合 policy limit，重启也必须恢复并继续计入 usage；它会阻止不满足额度的新 reservation，但不能因此丢失清理索引。第一阶段持久化失败时不得调用 adapter，当前进程保留 owner 与债务明确的待协调意图，并临时拒绝新 admission；后续 sweep 会先补写同一事实再尝试删除，正常退出也必须先尝试刷入该事实，刷入失败则退出收口明确报错。该进程内 admission latch 不冒充跨崩溃事实，崩溃恢复仍由 workspace `deleting` metadata、durable quota ledger 与启动时受控根校验共同驱动。
- 同一 resource ref 的并发 `requestRelease` 在 main 内按 owner 合并为同一个物理删除；owner 不同立即拒绝，后续调用携带更保守的已观测字节或 `'unknown'` 时必须单调合并债务。应用退出只关闭新的外部准入，关闭前已经接纳的 release、bound reservation 取消和 sweep 必须完成全部两阶段操作；任一后续 durable snapshot 都要自动融合未落盘清理意图，最后才允许关闭 SQLite。
- reservation 创建后，在首个临时文件落盘时立即 `bindResource`。取消未落盘 reservation 可以直接释放；已经绑定半文件时，`cancelReservation` 先经 adapter 删除物理文件，失败则保留 `deleting` 占用供 sweep 重试。不能因为 Tool 已取消就在半文件仍存在时提前返还额度。
- 清理优先级固定为：已过期终态详细日志 -> 已过期终态 workspace / artifact -> 已取消或失败的残留 -> 其他可重建缓存。不能为了腾空间直接删除 active Run、尚未发布的用户产物或 authoritative commit 所需文件；低磁盘时先停止对应生产者并生成明确终态。
- Session 删除、owner release、注销、窗口销毁和应用退出只为各自保留策略选中的资源提交清理意图；物理删除成功后才释放真实占用。删除失败保留 `deleting` ledger 项并由启动 sweep 重试，不能提前把额度返还后形成双重占用。
- Shell 进程可以绕过应用写入 API，直接在 workspace 中高速扩容。Quota Manager 只能通过预留、目录监控、周期真实大小校正和超限取消降低风险；没有文件系统 quota / 容器时，这不是严格磁盘隔离，文档和 UI 都不能作相反承诺。

## 11. 资料库与本机文件桥

`file.stage`、`file.publish` 与 `file.upload` 都是 Tool Registry 中的 `business` Tool，各自创建规范 ToolRun。它们不因被 `shell.run` 前后调用而变成免费内部步骤，也不能由 Skill、Shell wrapper 或 renderer 合并成一个不留审计的隐藏动作；Run 是否继续由上下文预算、终态和重复循环门禁决定，不使用固定业务 Tool 配额。三者的 Schema 递归 strict 到根对象、每个嵌套对象和判别联合分支：各分支按 `kind` 固定自己的 `required`，并分别设置 `additionalProperties: false`；危险对象键在通用 Schema 边界拒绝，不做类型转换、默认值注入或未知字段删除。`local-picker` 分支额外携带 `path`、library 分支混入本机字段、或 destination 分支出现另一分支字段都必须在 ToolRun 创建前失败。

当前实现状态（2026-08-31）：开发预览已经启用 `local-picker -> input`、`local-path -> input`、`library-node -> input`、`output -> local-save-as`、`output -> library` 和 `local-path -> library`。资料库写入目标同时接受 parent node ID 与从当前资料库根开始的绝对目录路径；路径从根逐段精确解析，不模糊搜索且不自动创建。main 持有 picker、Save As、打开文件句柄、Workspace Store、共享 Quota Manager、hash、generation 与 owned-file 复验；资料库 adapter 只通过绑定 renderer 提供的短期一次性 authority 取得节点快照、路径解析结果、签名下载 URL 或上传凭据。prepare 不取得正文 URL / credentials，execute 重新授权；stage 下载后再次重验节点身份，publish / upload 复用 main-owned 上传管理器并保留 `committed / uncommitted / commit_unknown` 三态。确认卡只展示 public action 和安全 preview，结果只返回逻辑路径、文件名或已提交节点身份；用户明确提供的来源显示路径是窄例外，canonical 路径、token、签名 URL、credentials 和 workspace 物理路径仍不外泄。Run 释放与应用关闭会取消并等待文件桥的权威结算后再清理 workspace。Windows 与 Linux 文件身份、reparse point / junction / UNC 和安装包验收继续延期；macOS 真实资料库行为也仍需人工验收。

文件路由固定为：查看、读取、概括或分析用户明确给出的宿主绝对路径时，直接使用 `shell.run` 的受支持只读命令，不先 `file.stage`；需要工作副本、修改、转码或生成新文件时，使用 `file.stage -> shell.run -> file.publish`；本机普通文件无需加工而原样上传资料库时，使用 `file.upload`。这三条是 Tool 语义边界，不是按自然语言关键词写死的生产分支。

### 11.1 `file.stage`

V1 模型输入和安全结果冻结为：

```ts
interface AgentFileStageInputV1 {
  source:
    | { kind: 'library-node'; nodeId: number }
    | { kind: 'local-path'; path: string }
    | { kind: 'local-picker' };
}

interface AgentFileStageResultV1 {
  logicalPath: string;
  displayName: string;
  sizeBytes: number;
  contentHash: string;
  sourceKind: 'library-node' | 'local-path' | 'local-picker';
}
```

`nodeId` 必须是正整数。`local-path` 只接受当前平台绝对路径或 `~/` 路径，最长 4,096 UTF-8 bytes；相对路径、控制字符、Windows device / UNC / ADS、目录、symlink、hardlink 和特殊文件都拒绝。`local-picker` 仍不接受 path 字段。`logicalPath`、`displayName`、大小和 hash 由 main 在原子落盘后生成：逻辑路径不超过 1,024 UTF-8 bytes，文件名不超过 240 UTF-8 bytes，大小是未超过单文件 quota 的安全整数，hash 使用固定 `sha256:<64 lowercase hex>` 格式。结果中不出现 library provider、签名 URL、canonical 本机路径、picker token、workspace realpath 或 capability。

`file.stage` 把需要工作副本的受控来源复制到当前 Run 的 `input`；它不是查看本机文件的前置步骤：

- 资料库来源使用安全 `nodeId`，但 node 必须来自本 Run 当前感知集合或用户通过受控交互显式选择的集合；main 重新校验 canonical backend / account / library owner、节点类型、可见性和内容读取授权，不能只验证“nodeId 是正整数”。
- 通过校验后才生成一次性 renderer capability 取得内容；Shell 永远看不到 MinIO 签名 URL。
- 本机来源可以来自 main 的系统文件选择器，也可以是用户在当前请求中明确给出的绝对或 `~/` 文件路径。模型不能自行发明、扩展、枚举或把历史路径当作新授权；所有明确路径仍显示 main 生成的内联审批。
- V1 一次暂存一个普通文件；目录、symlink、special file 和无限递归复制不支持。
- 完成后返回逻辑相对路径、文件名、大小和 content hash；来源 token、canonical 路径、workspace 物理路径和临时 URL 不进入模型或 SQLite。用户明确提供的显示路径只保留在 Tool input、public action 与审计事实中。
- 暂存失败不创建半文件；先写临时文件，校验大小 / hash 后原子进入 `input`。

`file.stage` 是正式 Registry Tool，不是 Shell Runtime 的私有下载方法。当前资料库感知范围内的普通文件可以按只读策略评估；本机选择、外部来源和超出既有感知的对象仍需显式交互或审批，并完整经过 ToolRun、Broker、取消和审计。

stage 的 main-only binding 至少冻结：canonical owner / library、source kind、node ID、local-picker capability 或 local-path 文件 identity、node revision / content hash、感知或显式 grant provenance、storage binding、workspace ID / generation、目标 realpath、single-use ID 和 expiry。stage 只把内容放入本机工作区，不等于允许把正文发送给 AI；后续 `shell.run` 仍需按 staged data scope 与 `aiDestinationIdentity` 独立决策。

prepare 和执行 owner 固定如下：main 创建 ToolRun、校验 Schema、工作区和配额，并生成一次性 binding；资料库 adapter 依赖 renderer 认证时，经独立 `AgentFileAuthorityBroker` 向绑定窗口请求短期一次性回执，同时校验窗口、owner、资料库、Session、Run、ToolRun 和 authority ID，真正下载、hash、上传和三态结算都由 main 托管。`local-picker` 必须先展示受控交互或审批动作，只有用户在绑定主窗口中直接操作后，main 才打开系统选择器并取得一次性 grant；模型调用、历史恢复和后台重试都不能自动弹选择器。`local-path` 则展示包含用户原始显示路径的内联审批，批准后直接复验并读取该文件，不能再次弹 picker。未来 adapter 完全迁入 main 时可以替换授权来源，但不能改变 Tool 输入、ToolRun、授权和结果契约。

一次性来源 capability 在 fetch 开始时原子 claim，失败后不能重放。claim 前 main 必须重新权威校验 canonical backend / account / owner / library、node revision、可见性、读取 grant、storage binding 与 capability expiry；任一漂移都在读取正文前拒绝。下载到临时文件并计算大小 / hash 后、原子进入 `input` 前，再次校验 node revision、content identity / ETag、storage binding 和读取授权；漂移时删除半文件、经 Quota Manager 取消 reservation 并废止 capability。若后端无法提供可比较的稳定 revision / content identity，该资料库来源不得静默 commit，只能重新 prepare 或报告当前 adapter 不支持一致暂存。本机 picker 绑定实际打开的 file handle / 平台文件 identity，并以从该 handle 读取到的字节 hash 为准，不能在选择后重新按可替换 path 打开。`local-path` 在 prepare 时以 `lstat + realpath + O_NOFOLLOW handle + fstat` 冻结单链接普通文件 identity，执行时重新打开并要求路径、canonical path、`dev / ino / ctimeNs / mtimeNs / mode / size` 与 identity hash 全部一致；上传或暂存期间持续持有同一 handle，消费结束前再复验。

### 11.2 `file.publish`

V1 模型输入和安全结果冻结为：

```ts
interface AgentFilePublishInputV1 {
  sourcePath: string;
  destination:
    | {
        kind: 'library';
        parentId: number;
        fileName?: string;
        providerId?: string;
        conflictPolicy?: 'rename' | 'fail';
      }
    | {
        kind: 'library-path';
        directoryPath: string;
        fileName?: string;
        providerId?: string;
        conflictPolicy?: 'rename' | 'fail';
      }
    | {
        kind: 'local-save-as';
        suggestedFileName?: string;
      };
}

interface AgentFilePublishResultV1 {
  sourcePath: string;
  displayName: string;
  sizeBytes: number;
  contentHash: string;
  destination:
    | {
        kind: 'library';
        nodeId: number;
        parentId: number;
        commitState: 'committed';
        perceptionState: 'verified' | 'pending';
      }
    | {
        kind: 'local-save-as';
        saved: true;
      };
}
```

`sourcePath` 只能是 `output/...` 逻辑相对路径，最长 1,024 UTF-8 bytes；`parentId` 必须是正整数。`directoryPath` 必须是从当前资料库根开始的绝对目录路径，最长 2,048 UTF-8 bytes，逐段不超过 512 UTF-8 bytes且不接受空段、`.`、`..` 或反斜杠。文件名沿用当前上传边界的 240 UTF-8 bytes 上限，`providerId` 最多 128 ASCII 字符且只能来自本 Run 的安全 Effective View。省略 `conflictPolicy` 表示以 `rename` 解释，但不把默认字段写回原始 Tool input；省略 provider 时由 prepare 从当前目标目录解析安全路由。结果中的大小 / hash 服从 stage 的同一格式，不返回本机目标路径、物理 provider alias、上传 session 或 capability。资料库 authoritative commit 已成功但刷新暂时失败时，结果可以明确区分 `committed + pending`；Agent 可以说明文件已经提交，但在重新感知前不能声称目录树已看到或继续用该节点执行后续动作。

`file.publish` 把 `output` 中的普通文件发布到资料库或本机：

- 输入只接受工作区逻辑路径，main 重新检查 realpath、类型、大小、hash 和 workspace generation。
- 资料库目标以 parent node ID 或绝对目录路径表达；路径由绑定 renderer 从根逐段精确解析，prepare 后冻结 `libraryId / parentId / provider / conflictPolicy`，execute 再解析并要求同一目录 identity，随后复用现有上传、authoritative commit、刷新和再感知语义。
- 数据面遵循现有媒体产物的 main-owned sealed consumption：Renderer 至多提交 opaque workspace output ref、当前认证凭据和 execution / owner 身份，不能协调 init / sign / complete，也不能取得 workspace / artifact 物理路径；main 必须从已验证句柄的显式 offset 读取，上传完复验源身份后，才允许进入 authoritative complete。
- 本机目标由 main 系统 Save As 选择；模型不提供绝对目标路径。
- 用户可在审批卡修改目标目录、文件名、Provider 或冲突策略；任何修改都会重新 prepare 并生成新 hash。
- 后端已经 commit 后刷新失败时保留成功文件，不重传；commit 不确定时不自动生成第二份本机兜底。
- 资料库不可用时可以通过 `interaction.request` 让用户改选本机，但不能未经确认自动改变目的地。

`file.publish` 同样是正式写 Tool，不能由 Shell 进程、日志 action 或 renderer 直接调用上传 API。它必须复用 prepared action、一次性 execution capability、authoritative commit 和再感知边界。

publish 的 main-only binding 至少冻结：canonical backend / account / owner / library、目标 parent node 和其当前 revision、目标可见与写入 grant、规范 storage provider binding、冲突策略、来源 workspace ID / generation / realpath / content hash、一次性 upload 或 Save As grant identity、expiry、prepared action hash 和 execution identity。用户修改目录、文件名、Provider 或策略后旧 binding 立即失效。

进入资料库 commit 前，main 必须要求当前 adapter 重新校验 canonical owner、library、parent 存在性、可见性、写授权、provider route 和一次性 grant；回执必须绑定窗口、Session、Run、ToolRun、prepared action、execution 和内容 hash。任一项漂移都在上传前或 commit 前拒绝，不能因为 prepare 时曾有权限继续写入。一次性 grant 只允许一个 authoritative commit；超时、迟到和重复回执不能生成第二份文件。

Shell 在 `output` 写出文件不等于发布成功。资料库只有取得 authoritative commit 后才能声称“已经提交”；重新感知前只能保留 `perceptionState: pending`，不能声称目录树已出现节点或继续使用该节点。本机 Save As 则以 main 原子复制完成为准。

### 11.3 `file.upload`

`file.upload` 专门表达“本机普通文件 -> 当前资料库目录”的原样传输。模型输入固定为一个 `local-path` 来源和一个 `library` 或 `library-path` 目标；它不接受 picker、不接受本机输出目标，也不先占用 Run workspace。任务只要求先查看再上传同一原文件时，可以直接 `shell.run` 只读检查后调用 `file.upload`；只有需要工作副本、改写、转码或生成新文件时，才改用 `file.stage -> shell.run -> file.publish`，不能借 upload 绕过工作区与 Shell 审计。

prepare 先按 `file.stage` 的 local-path 身份规则打开并冻结来源，再解析目标目录、Provider、文件名与冲突策略，只返回用户显示路径、文件名、大小和目标标签组成的 public action；canonical 来源和 opened identity 留在 main-only binding。批准后 execute 重新打开来源并复验完整 identity，若目标来自 `library-path` 则再次逐段解析并要求同一 parent identity，再领取短期上传凭据。整个上传从同一个已验证 handle 读取，复用 `file.publish` 的 main-owned init / sign / PUT / complete / reconcile 和 `committed / uncommitted / commit_unknown` 结算；任一路径、文件或目标漂移都要求重新 prepare，不能自动换文件、换目录、重传或落本机兜底。

系统提示词只允许模型在当前请求明确给出来源路径时提出这类调用，并要求按“来源资源、目标资源、是否需要加工”理解任务，而不是匹配“上传、拷贝、放入”等动词表。这是 Tool 选择约束，不是运行时代码能够证明的语言来源，也不能单独构成文件访问授权。

运行时不把路径字符串本身当成授权。`file.upload` 在 `ask / auto` 下显示可恢复的无框内联审批；`full-access` 下由 main 对已验证、非破坏性的来源与目标自动授权。两种路径都必须冻结来源显示路径、文件名、大小和资料库目标，复验来源与目标身份，并签发一次性 execution capability。拒绝后不能原样重试；目录和多文件不支持。此行为沿用 Run 冻结模式，不创建另一份权限状态。

### 11.4 Renderer 与卸载生命周期

- Tool registration 必须声明该 adapter 的 prepare / execute 是否依赖 renderer。需要 renderer 而当前绑定主窗口页面不在场时，main 立即以稳定的 `renderer_unavailable` 结构化失败收口当前 ToolRun；不把它暂停到后台，不在页面回来后自动续跑，也不静默改成本机或另一个 provider。用户返回后由新的 Tool call 重试。
- `file.stage` 在 main 已取得可独立消费的一次性来源能力后可以继续 main-owned 下载；若数据仍由 renderer 传输，页面卸载或 renderer 销毁会取消传输、删除临时文件并释放 reservation。只有大小与 hash 校验后原子进入 `input` 才算完成。
- `file.publish` / `file.upload` 在批准后由 main 持有事务，普通 Agent 页面卸载本身不取消；Run 停止、owner release 或窗口销毁在 authoritative commit 前中止上传 session 和未提交临时文件。进入 complete 后在上传管理器的有界关键结算窗口内使用独立 signal 核对真实结果；commit 后任何卸载或停止都不能撤销写入、触发重传或生成本机副本。页面再次出现只能从规范 Session / ToolRun 投影和正常目录刷新感知结果，不得续跑旧 execution。
- main-owned 本机 picker / Save As 只要 owner 窗口仍存活即可完成；owner 释放、窗口销毁、注销或 Run 停止会取消。系统确认覆盖后仍从已验证句柄复制到同目录临时文件，提交前复验来源身份，成功时使用平台可用的原子替换语义，失败时不留下被误报成功的半文件。
- 页面卸载不删除已经完成的 staged input、已提交资料库文件或已经完成的本机保存；这些结果继续由 ToolRun、workspace manifest 和 quota ledger 管理。应用重启不恢复未完成的 picker、renderer capability、上传或 Save As。

## 12. 进程、输出、取消与恢复

### 12.0 内置操作的权限联动

2026-09-07 起，现有 Run 冻结的权限模式同时用于已校验的非破坏性内置操作。`full-access` 可自动授权创建目录、非覆盖音频提取及文件桥；原有 source / target、binding、一次性凭据和提交复验仍然执行。文件桥不再无条件要求人工审批；`ask / auto` 保持原确认方式，未知 Tool、明确 deny 和破坏性动作不受此联动放行。Shell 自己的分析器与 Policy Engine 不变。详见 `agent-media-availability-and-permissions.md`。

### 12.1 前台执行

- 每个 Run 同时最多一个 Shell 命令；全局并发由 main 固定上限控制。
- stdin 固定关闭，OmniFlow 不提供应用内密码提示或交互输入。已知提权和交互命令在 prepare 阶段拒绝；但宿主权限下的 raw command 仍可能通过 `open`、`osascript`、其他解释器或本机程序间接触发 GUI，只有真实 OS containment 才能阻止，V1 不作相反承诺。
- Renderer 卸载不终止纯 main Shell；返回页面后从规范 ToolRun 和日志 tail 恢复。
- 这只是“UI 隐藏时 main 仍执行”，不是 detached 后台 Job。Run 停止、owner 释放、注销、窗口销毁和应用退出仍必须取消命令。

### 12.2 日志与投影

stdout / stderr 的原始 chunk 先进入带 carry buffer 的增量处理器；只有完成解码、控制序列解析和敏感文本清洗的安全 frame 才获得单调 `sequence`：

```ts
interface AgentShellOutputFrameV1 {
  executionId: string;
  sequence: number;
  stream: 'stdout' | 'stderr';
  text: string;
  observedAt: string;
}

interface AgentShellOutputBatchV1 {
  sessionId: string;
  runId: string;
  toolRunId: string;
  executionId: string;
  firstSequence: number;
  lastSequence: number;
  frames: AgentShellOutputFrameV1[];
}

interface AgentShellOutputTailV1 {
  executionId: string;
  firstSequence: number | null;
  lastSequence: number | null;
  truncatedBefore: number | null;
  frames: AgentShellOutputFrameV1[];
}

interface AgentShellOutputAckV1 {
  sessionId: string;
  runId: string;
  toolRunId: string;
  executionId: string;
  lastResolvedSequence: number;
}

interface AgentShellLogPageV1 {
  executionId: string;
  requestedAfter: number | null;
  pageFirstSequence: number | null;
  pageLastSequence: number | null;
  availableRanges: Array<{
    firstSequence: number;
    lastSequence: number;
  }>;
  nextAvailableSequence: number | null;
  unavailableThrough: number | null;
  nextCursor?: string;
  expired: boolean;
  frames: AgentShellOutputFrameV1[];
}
```

处理顺序固定为两段：Supervisor 对原始 chunk 做有状态增量解码，同时更新 main-only `1 MiB` head + tail 诊断采集并把全部解码事件继续交给 Runtime；LogStore 再执行有状态终端控制序列 parser -> 有状态敏感文本 redactor -> 按 Unicode 边界切分安全 frame -> 分配 sequence -> 写 main log -> 更新最多 `160,000` UTF-8 bytes 的安全模型源与有界实时 tail -> 进入有界事件调度器。

`sequence` 在每个 `executionId` 内从 `1` 单调递增，由 stdout / stderr 共用同一个分配器。它表达 main 实际接收并完成清洗的顺序，不宣称两个 OS pipe 之间存在更强的因果顺序。实时事件使用 batch 降低 IPC 压力；batch 内 frame 构成连续递增区间，且 `firstSequence / lastSequence` 与首尾 frame 一致。重试发送、恢复分页与实时事件允许区间重叠，因此 renderer 不能把“收到一次事件”当成唯一性依据。

V1 实时 IPC 还必须具备明确背压，不能把有界日志实现成无界 `webContents.send`：

- 清洗完成后的单个 frame 最多 16 KiB UTF-8；一个 batch 最多 32 frame 或 64 KiB，任一先到即 flush。正常运行对同一 execution 最快每 50 ms flush 一次，终态 flush 可以立即执行。
- 每个 WebContents + execution 最多保留 4 个未确认 batch，合计最多 256 KiB。Renderer 把 batch 正文或 main 明确声明的不可恢复 gap 合并到 resolved 水位后发送 `AgentShellOutputAckV1`；main 重新校验窗口、owner、四级 identity、ack 单调性以及水位不超过该 identity 已经通过 event / page 交付或声明不可恢复的 sequence，ack 不进入模型或 SQLite。
- 达到 high watermark 时，main 不再向 Electron IPC 队列推送逐批输出；只保留有界的最新待发 tail / watermark，较早未发送 batch 可以丢弃。子进程 pipe、清洗、日志 append 和 SQLite tail checkpoint 继续进行，不能因为慢 renderer 反向堵塞命令。
- 收到 ack、renderer 重新订阅或 Tool 终态时，main 从最新可用 tail 恢复实时推送。丢弃 live batch 会自然形成 sequence gap，renderer 必须按下面的 `afterSequence` 协议 replay；详细日志已截断时显示明确缺口。ToolRun 终态快照的 `lastSequence` 是最终恢复水位，即使最后一个 live batch 没有送达也不会把输出误判为完整。

- Provider 负责 UTF-8 / PowerShell 编码一致性和跨 chunk 解码；UTF-8 字符、ANSI / OSC 序列和秘密即使横跨多个 raw chunk 也不能被拆开后绕过处理。
- ANSI CSI 可以转换为纯文本效果；OSC hyperlink、标题、剪贴板和其他控制序列必须由跨 chunk parser 删除。
- 二进制输出不直接渲染；提示命令把内容写入 `output` 文件。
- main-only 诊断采集、UI 预览、模型 Tool result 和 main 托管的有界全流日志各有独立上限。达到全流日志上限后继续 drain 子进程输出并标记 truncated，不能因不再保存而堵塞 pipe；超出上限的正文只有仍落在独立最新 tail 中时可恢复，中间未被任一 Store 保留的 sequence 通过 gap 协议明确丢失。
- Supervisor 诊断采集最多保留 `1 MiB` 已解码但尚未做控制序列清洗和脱敏的正文；超限时 head 与 tail 各使用约一半预算并写入明确的中段省略事实。该采集只存在于 main 的进程结果中，不进入 SQLite、provider 或 renderer，也不替代 LogStore。
- SQLite 的 Shell ToolRun 结果保存有界 `AgentShellOutputTailV1` 摘要字段、由已清洗 frame 形成且经过规范结果门禁收口的 provider source、总字节数、截断标记、exit 信息和不含路径的 `logRef`。上游模型源最多 `160,000` UTF-8 bytes，Shell Tool 会把整个结构化结果自适应收口到约 `90,000` JSON 字符，随后再通过 Broker 的 `100,000` JSON 字符硬门禁；renderer 投影删除 provider source、executionId 和 logRef，只保留最多每流 `4 KiB` 的 head + tail 显示摘要。`truncatedBefore = N` 表示 sequence `< N` 已从该实时 tail 移除；它不代表详细日志仍一定保留这些 frame。
- 配额内的已清洗全流日志在 main 的 TTL Store 中；renderer 通过绑定 owner / Session / Run / ToolRun 的分页 IPC 读取，永远不取得文件路径。
- 模型从规范结果中的安全 provider source 生成独立的 `shell.run` Tool result，单个 Shell 结果最高使用约 `40,000 tokens`，并始终保留 exit code、duration、timeout / cancellation 和各层 truncation 事实；该上限足以让当前 27.5 KiB 中文 Markdown fixture 完整进入大窗口模型。完整输出流使用 `content + truncated=false + omittedBytes=0`；只有 `_omniflowProjection.truncated=true`、对应流 `truncated=true` 或 `omittedBytes>0` 才表示这条命令产生的正文被省略，此时才按 byte / token 选择 head + tail，并用原始总字节数减去本次实际保留字节得到真实 `omittedBytes`。传输完整性不证明源覆盖完整性：`cat` 明确文件且完整交付时可以认定全文可见，`head`、`tail` 和限定范围的 `sed` 即使 `truncated=false` 也只能证明所选范围完整。模型已经消费过、连续完整且允许压缩的旧 Tool 回合不再从 canonical result 机械重投影；Active Context 会把这些回合批量生成低权限严格 JSON 语义摘要，先在副本 staging，全部成功后才原子替换 main 内存上下文。终态 Run 的 ToolRun 事实另有总计最高约 `48,000 tokens` 的低权限跨 Run 投影；完成的 Shell 即使 Run 随后取消或中断，安全 stdout 仍可连同 ordinal 和 main public prepared action 中的命令进入下一 Run，而不是退化成状态文案。该投影删除 `executionId`、`logRef` 和 renderer preview；`skill.activate` 无论成功失败都不回灌完整说明或 allowlist。SQLite 规范结果、renderer 投影与详细日志始终不变，模型不能读取原始诊断采集或详细日志分页来绕过上下文预算。
- 等待审批的 Shell 继续使用完整确认卡；非审批 Shell 默认是无框单行，只显示最低状态和 main public prepared action 中的单行命令摘要，不显示输出预览、耗时、退出码或预览截断。只有具备 owner-bound 结果的行可以点击；展开区最高约 `156px`，超出后内部滚动，并按 cursor 读取受控日志。详细日志真实过期或存在不可恢复缺口时只在展开区弱提示；分页大小、滚动和保留期不反向改变模型投影。默认命令与展开命令都不得从 `call.input` 回退拼接。

受控日志读取请求至少绑定 owner、`sessionId / runId / toolRunId / executionId`、页大小，以及用于实时补洞的 `afterSequence` 或用于继续分页的 opaque cursor；两者不能同时提交。main 将单页钳制为最多 128 frame 或 256 KiB，并把 main 有界详细日志与 SQLite / 内存 tail 视为一个只读恢复视图。`availableRanges` 返回当前仍保留的合并连续区间，V1 最多是“详细日志前缀 + 最新 tail”两个区间；单页 frame 自身不能跨 gap。对于 `afterSequence = N`，`nextAvailableSequence` 是仍可读取的最早 sequence `> N`；若它大于 `N + 1`，`unavailableThrough = nextAvailableSequence - 1`。若直到规范 `lastSequence` 都没有可读 frame，则 `nextAvailableSequence = null`、`unavailableThrough = lastSequence`。cursor 同时绑定 `logRef` generation 与区间位置；日志轮转、清理或 identity 漂移后旧 cursor 失败，不能落到另一条日志。renderer 的恢复与合并规则固定为：

1. 读取 Session 快照期间，先按完整事件身份暂存 live batch；快照到达后以 ToolRun tail 为基线。
2. 只接纳四级身份和当前 owner 全部匹配的 batch，并按 `executionId + sequence` 去重；分页日志和实时流共用同一套去重逻辑。
3. 如果新 batch 的 `firstSequence > lastResolvedSequence + 1`，先标记 gap 并以最后 resolved sequence 发起 `afterSequence` replay，不能直接把两段文字拼在一起。
4. replay 与 live batch 可以乱序、重叠；renderer 只在取得正文或 main 明确返回 `unavailableThrough` 后推进 resolved 水位。若 `nextAvailableSequence > lastResolvedSequence + 1`，UI 先插入“sequence X～Y 已截断 / 清理”的单个 gap 标记，把水位推进到 `unavailableThrough`，再合并后续区间；`availableRanges` 即使仍含早期前缀也不能掩盖中间缺口。
5. 用户向前分页详细日志时，新页与当前 live tail 仍按 sequence 合并；滚动位置和展开状态属于 renderer 临时投影，规范 tail、终态和截断事实仍只来自 main / SQLite。
6. Tool 进入终态前，main 先 flush decoder、control parser、redactor、日志 append 与最终 tail checkpoint，再持久化 exit 事实并发布终态。应用崩溃仍可能丢失尚未完成该 checkpoint 的最后少量 frame，恢复时必须以已提交水位为准，不能猜测补齐。

日志清洗只能降低风险，不能保证识别所有秘密。有界全流日志不跨机器同步，不自动附加到模型，不进入普通应用日志；过期后 UI 保留无框终态单行，只有用户展开时才弱提示“详细输出已清理”。

跨 Run 的近期 ToolRun 事实先扣除当前对话、低权限 envelope 和命令关联占用，再把真实剩余 token 交给结果投影；Shell 命令关联最多占单条事实预算的四分之一且不超过约 `2,048 tokens`，超出时明确标记省略。事实按新到旧填充总计约 `48,000 tokens` 的预算；下一条最新事实连最小安全结果都无法容纳时立即停止，不继续同步重投影更旧的大日志。

### 12.3 取消与超时

取消顺序：

1. Tool / Run AbortSignal 进入 `AgentShellRuntime`。
2. Provider 对 supervisor 管理的进程组 / Job 发送软终止。
3. 等待固定 grace period。
4. 对仍存活的受管进程组 / Job 强制终止。
5. 等待 supervisor 确认其管理的进程组 / Job 已收口，再写 `cancelled`。

如果无法确认受 supervisor 管理的进程组 / Job 已经结束，ToolRun 必须以 `failed` 和稳定的 `termination_incomplete` reason 收口，不能伪装成成功取消。Windows 必须以禁用 breakaway 的 Job Object 或等价可验证机制达到这一要求；`taskkill` 的直接子进程 fallback 只能保留给当前受控媒体 Runner，不能作为 Shell 完成门禁。POSIX 进程仍可能通过 `setsid`、daemonize、计划任务或其他宿主程序逃离原进程组；已知形式必须分析并拒绝，未知形式在没有 OS sandbox 时是明确残余风险。

当前 `AgentToolBroker` 对 main Tool 固定只等待 6 秒取消收口，不能先于 Shell supervisor 的软终止、强杀和确认预算宣告终态。实现前应把取消收口预算改成 Tool registration identity 冻结的 main-only 配置：普通 Tool 保持 6 秒默认值，Shell 使用有全局硬上限的专用预算；Broker 超时只能产生 `termination_incomplete`，不能同时让后台进程继续而把 Run 标为普通 `cancelled`。

### 12.4 应用退出与崩溃

- 正常退出先取消并等待前台 Shell 收口，再关闭 Store。
- Shell supervisor 必须使用父进程存活 lease / pipe 或平台等价机制，在 Electron main 崩溃后清理仍受其管理的进程组 / Job；它不能保证清理已经主动 daemonize、注册为计划任务或以其他方式脱离的宿主进程。
- 启动时读取 main-only process lease，只在 PID、启动时间和 supervisor identity 全部匹配时清理疑似孤儿，不能误杀复用 PID 的无关进程。
- 应用重启后 active ToolRun 统一标记 `interrupted`；不自动重放命令。
- 同一 main 生命周期内仅发生 renderer 卸载时，pending approval 可以从 SQLite 快照恢复展示并继续走原一次性能力。应用重启后 `awaiting_approval` 与其他 active ToolRun 一律变为 `interrupted`；必须由新的 Tool call 重新 prepare，不能复活旧批准入口。

## 13. UI 安全投影

Shell 复用现有 ToolActivity / Approval 卡，不创建独立终端状态源。实现前必须扩展受控展示协议，至少增加：

```text
shell.command       精确命令、Provider、逻辑 cwd、env 和风险
shell.output-tail   有序 stdout / stderr tail 与截断状态
shell.rule          命中的规则或可创建规则的受控预览
shell.open-log      读取 main 托管有界日志的受控 action
```

Shell 审批卡必须显示：

- 完整命令；不能用省略号隐藏末尾副作用，长命令使用可滚动的纯文本区域。
- Provider / 方言 / 版本和逻辑 cwd。
- 环境覆盖、timeout、原子操作、风险分面和 unresolved 项。
- 可能读取的 staged 文件及 content identity，以及输出将发送到的 AI 服务 / endpoint 安全标签。
- 当前是规则自动允许、仅本次审批，还是准备创建 Session / 持久规则。
- 命令输出会以有界形式提供给当前 AI provider。

用户操作只允许：

```text
取消
仅运行本次
本 Session 允许等价操作       仅在 rule eligible 时出现
在当前资料库长期允许等价操作  仅在 rule eligible 时出现
本 Session / 当前资料库拒绝等价操作  通过受控次级入口创建
```

规则管理页属于 Shell 基建的一部分，至少支持查看 scope、命令 matcher、风险、最近命中、停用和删除。它不属于长期记忆管理，也不能把任意文本编辑成 matcher。

当前 UI 契约禁止直接展示 `call.input`、自行生成的本地路径和进程参数；Shell 与用户明确提供的本机来源路径是集中 safe presenter 的窄例外。Renderer 的单行命令摘要、完整审批卡和展开区命令都只能来自 main 生成的 public prepared action，不能自己从 `call.input` 拼命令或路径，也不能渲染 ANSI、HTML、任意 URL 或可点击命令输出。三处命令展示复用同一个 display-safe formatter：普通首尾空格和连续空格保持不变，反斜杠、换行、Tab、C0 / C1、Unicode 行分隔符与 Bidi 控制字符使用可审计转义；执行字节不因显示投影而改变。

## 14. 持久化与审计

ToolRun 仍是 Shell 执行状态的唯一规范事实。Shell 分支复用现有 prepared action 三字段；`shell.run@1` strict branch 与 exact command hash 的 main 边界已经落地，执行闭环还需要增加以下持久事实：

- 保持现有 `shell.run@1` public snapshot、exact command bytes / hash 和 SQLite strict branch 同源，不允许后续 runtime 绕过 main canonical normalizer。
- permission behavior、命中 / 创建的 Shell rule ID、revision、canonical matcher hash 与当时的 rule audit snapshot。
- Provider identity、逻辑 cwd、环境键、风险分面和 analyzer revision。
- exit code、termination reason、duration、输出计数、tail 的 `firstSequence / lastSequence / truncatedBefore`、truncated 和 `logRef`。
- workspace ID / generation 与 stage / publish 结果引用。

以下内容禁止进入 SQLite、普通日志或模型历史：

- Provider executable 绝对路径、物理 workspace root 和控制脚本路径。
- 原始日志文件路径、process supervisor token、PID lease secret。
- 宿主完整环境、AI Key、Cookie、签名 URL 和上传 capability。
- 未清洗 stdout / stderr。

`AgentShellPermissionRuleStore` 可以使用同一 SQLite 数据库，但保持独立表和 service owner。Shell 日志与大文件保留在 main 托管磁盘 Store，不放 BLOB。规则、日志和工作区都只在本机存在；未来记忆导出或跨机器同步默认不包含它们。

### 14.1 未发布期 schema 策略

OmniFlow 尚未正式发布，Agent 数据库继续以现有 **schema 2** 为唯一 canonical baseline。Shell 落地时不新增 `user_version = 3 / 4`：直接修改 schema 2 的完整 create DDL，并为开发机已有 schema 2 数据库增加幂等 reconcile。

当前生产 persistence runtime 已由唯一 `AgentDatabaseSchemaCoordinator` 持有 schema 执行权。它使用独占 bootstrap connection，在单个事务中执行现有 Session、Memory、Quota 和 Shell workspace 的领域 DDL / reconcile，完整自检 `user_version`、必需表、全部已知列、命名 index 与 trigger，再发布一次性 initialization barrier。canonical DDL 继续按领域维护在对应模块，Coordinator 负责唯一执行、事务、自检和 barrier；生产业务连接不再运行 Store DDL。后续 `AgentShellPermissionRuleStore`、日志 ledger 或其他 Store 必须先注册进同一 bootstrap 与结构清单，等待 barrier 成功后才能打开业务连接。barrier 失败时整个 Agent 持久化层 fail-closed，不允许“RuleStore 不可用但 SessionStore 继续写”的部分启动。`:memory:` 与直接 Store 测试保留局部初始化兼容入口，不构成第二个生产 schema owner。

Coordinator 的启动过程必须在单个事务中：

1. introspect 已知表、列、index 与 trigger；只接受能证明属于当前开发基线或已知中间结构的数据库。
2. 幂等补列 / 补表 / 补 index；需要改变约束的表使用受控 rebuild，不能靠多条启动后 raw SQL 留下半结构。
3. 删除并重新创建所有受影响的已知 trigger，避免旧 trigger 因 `IF NOT EXISTS` 静默保留旧规则。
4. 运行结构和关键不变量自检，成功后仍写 `user_version = 2`；任一步失败回滚并拒绝打开。

`prepared_action_json` 已升级为 `kind / version` 判别联合。三字段 `prepared_action_id / prepared_action_json / prepared_snapshot_hash` 继续全有或全无；prepared action 存在时，三者与 `approval_input_hash` 必须以 SQLite `text` 保存，且审批 hash 必须与冻结快照 hash 完全相等。当前 `media.extractAudio@1`、`shell.run@1`、`file.stage@1`、`file.publish@1` 与 `file.upload@1` 分支都由共享身份清单、TypeScript strict normalizer、Tool / action 绑定校验和 SQLite 独立 trigger branch 共同约束，验证 JSON 根对象、原始字段类型、精确字段集合、重复键、跨字段规则与有界长度；Shell 的 main canonical normalizer 还会验证 command hash 对应精确 command bytes，文件桥分别验证资料库身份、Provider、大小、SHA-256、逻辑输出路径和明确本机来源路径。现有媒体结构在 reconcile 时补成明确的 `kind = 'media.extractAudio', version = 1` 分支，历史 snapshot hash 原样保留但不恢复执行能力；任何损坏行、hash 绑定漂移、Shell command hash 漂移或 BLOB 类型漂移都会让 bootstrap 事务整体回滚。新增 prepared action 必须继续使用独立分支，不能复用其他 Tool 字段校验，也不能让未知 kind 绕过约束。

首次公开稳定版冻结 baseline 后，才切换为编号迁移：create DDL 代表最新 schema，旧版本按一次性、有序 migration 升级，未知更高版本继续 fail-closed。届时不得继续用“项目未发布”为由原地重写已经发布的数据契约。

### 14.2 Rule、ToolRun 与存储 ledger

canonical schema 至少增加以下本机事实 owner：

- `agent_shell_permission_rules`：保存第 9 节全部 rule 字段、`lifetime = session | library`、main lifecycle identity 和安全 public summary。`canonicalMatcherJson` 是有界结构 JSON，`canonicalMatcherHash` 使用固定算法；禁止保存 command/env 中的秘密。按 owner + library + enabled、session + lifecycle + enabled 和最近命中建立 index。active rule 使用两个 partial unique index：library lifetime 绑定 owner / library / behavior / matcher hash；Session lifetime 额外绑定 session scope / main lifecycle identity。不能依赖可空列的 SQLite unique 语义把两类 scope 混成一个 index。
- Session rule 即使为了审计写入表中，也必须绑定当前 main lifecycle；应用启动、注销或 owner release 原子标记失效，历史 Session 恢复不能重新激活。library rule 不级联依赖某个 Session，删除来源 Session 后仍按用户选择保留，直到在规则管理页撤销。
- 每次自动命中都把 rule ID、rule revision、behavior、canonical matcher hash、analyzer / policy / env policy revision、workspace content identity、data-scope hash、AI destination identity 和 prepared action hash 作为有界 audit snapshot 写入 ToolRun。删除或修改规则不能改变历史 ToolRun；不能只靠外键回查“规则现在长什么样”。
- `agent_tool_runs` 保存 opaque `executionId / logRef / workspaceId`、workspace generation、输出水位、计数、exit 与 termination 字段；不保存物理目录、日志路径、PID、provider executable 或 capability。详细 frame 仍在日志 Store，workspace manifest 和真实大小仍在 main-owned Store。
- `agent_local_storage_resources` 作为 `AgentLocalStorageQuotaManager` 的 reservation / resource ledger，保存 owner、category、Run、opaque resource ref、reserved / actual bytes、lease、TTL 和 `active / deleting` 状态。它只管理固定托管根中的本机资源，不把业务文件内容写成 SQLite BLOB。

### 14.3 删除与物理清理

Session 删除需要同时收口数据库事实和磁盘资源，但不能假设 SQLite 事务可以原子删除文件：

1. main 在同一 SQLite 事务中把该 Session / Run 的 workspace、日志和 artifact ledger 行标记为 `deleting`，再删除 Session 并级联 Message、checkpoint、Run 和 ToolRun。ledger 行不得通过 Session 外键同步级联删除，否则崩溃后将失去物理清理索引。
2. 事务提交后，由 Quota Manager 调用资源所属 Store 注册的幂等 adapter 删除固定托管根中的对应物理资源；adapter 成功回执后，Quota Manager 才删除 ledger 行并释放实际占用。
3. 进程在两步之间崩溃时，启动 sweep 根据 `deleting` 状态重试。物理删除失败时保留占用和安全错误，不把同一字节再次分配给新 Run。
4. TTL 清理详细日志或终态 workspace 后，SQLite 中的 ToolRun tail、exit、截断和产物摘要仍可读；日志分页返回 `expired`，workspace action 返回资源已清理，不能泄漏旧路径或把清理表现成 Tool 执行失败。

owner release、注销和应用退出使用同一清理队列与顺序，但按各自保留策略选择资源：正常应用退出不必删除仍在 TTL 内的终态详细日志，不能把“进入清理队列”误解成全部资源立刻清空。active Shell 必须先按进程终止协议收口，确认不再写盘后才能删除 workspace；无法确认进程结束时保留隔离资源和占用，交给后续安全 sweep，不能边运行边回收目录。

## 15. 建议代码结构

落地时按现有模块风格扩展，避免把所有逻辑堆进 Orchestrator：

```text
src/shared/agent/
  agent.types.ts                       通用判别联合与安全投影
  shell/
    agent-shell.types.ts               Tool / prepared / output 公共契约

electron/service/agent/
  storage/
    agent-database-schema-coordinator.ts
    agent-local-storage-quota-manager.ts
    agent-local-storage-quota-sqlite.ts
  shell/
    agent-shell-command-analyzer.ts   方言 AST 与确定性风险分析
    agent-shell-tool.ts                Registry Tool 定义
    agent-shell-preparation-service.ts main prepare 编排
    agent-shell-policy-engine.ts        风险与不可变 deny
    agent-shell-execution-lease.ts      一次性 main-only execution grant
    agent-shell-process-supervisor.ts    受控进程生命周期与输出边界
    agent-shell-permission-rule-store.ts
    agent-shell-runtime.ts              前台执行与终态
    agent-shell-log-store.ts
    agent-shell-log-file-store.ts
    agent-shell-workspace-store.ts
    agent-shell-workspace-sqlite.ts
    agent-shell-storage-runtime.ts
    agent-shell-provider-registry.ts
    file-stage-tool.ts
    file-publish-tool.ts

electron/platform/shell/
  shell-provider.types.ts
  zsh-shell-provider.ts
  bash-shell-provider.ts
  powershell-provider.ts
  process-supervisor.ts
  windows-job-supervisor.ts

src/features/agent/
  shell/
    agent-shell-presentation.ts
    AgentShellApprovalBlock.tsx
    AgentShellOutputBlock.tsx
    AgentShellRuleManager.tsx
```

目录名是目标责任划分，不要求一次创建全部空文件。只有当实现产生真实职责时再落对应模块；公共协议不反向依赖 renderer 组件。

## 16. 当前预览能力、剩余差距与迁移顺序

当前 macOS Zsh 已能注册并执行 `shell.run`，但仍只达到开发预览。下面同时记录已完成的生产链和进入稳定发布前仍需收口的差距：

- `shell.run@1` strict public action、main-only exact command hash、AI destination binding、Provider Registry、Run snapshot、Tree-sitter Analyzer、三态 Policy、PreparationService、execution lease、SpawnPreflight、Process Supervisor、Runtime 和生产 Service composition root 已落地。应用启动先探测 Provider；macOS 系统 Zsh 为 `executionReady: true` 时动态注册 Tool，并把 Provider 快照与 main-owned 本机设置中的权限模式注入 Orchestrator。Linux Bash 与 Windows PowerShell 保持 `executionReady: false`。在 macOS 的 `full-access` Run 中，普通未知命令以及带 `unresolved` assessment 的命令不会仅因分析不完整而 fail-closed；当前实现对未命中不可变 deny / 显式 deny 的其余分面直接放行，只有策略明确列出的不可变能力继续拒绝。任一冻结身份漂移仍 fail-closed。扩展元数据身份和同用户 TOCTOU 尚未由 native handle 收口，因此 `persistentRuleEligible` 固定为 `false`，不能生成持久规则。
- 通用 main prepare hook 已落地：Registry 冻结 `none / renderer / main` preparation identity，Orchestrator 复用同一 `preparing -> approval -> execution` 生命周期；main-only binding 与 snapshot material 被有界深拷贝、冻结并纳入 snapshot hash，任一单项和完整规范快照均限制为 256 KiB，只经 main execution context 交给 Run 快照中的同一 Tool 实现。批准时始终重新 prepare；稳定时以 SQLite CAS 保存并执行最新 capability，任一公开审批语义、私有 binding 或 material 漂移都建立新确认轮次。生产 `shell.run` 已使用该 hook，并有动态 prepared risk 的真实 Orchestrator 集成测试。
- `AgentPermissionGate` 没有 Shell rule Store、canonical matcher、analyzer / policy / env policy revision、workspace content identity 和命中审计。
- AI destination main snapshot 已绑定 profile、配置 revision、provider 与规范 endpoint identity，生产 binding resolver 与 Provider snapshot 已注入；当前仍缺持久规则命中 audit 与 staged source provenance。
- `AgentToolBroker` 使用随 Tool Registry 快照冻结、受 90 秒全局上限约束的取消结算预算；普通 Tool 默认 6 秒，`shell.run@1` 与文件桥使用 45 秒，避免 Broker 先结束、进程或上传后清理。
- `AgentToolProgress` 只有 message / percent，不能承载带完整事件身份、sequence 水位、gap replay 和 cursor 分页的双流日志 tail。
- `AgentLocalProcessRunner` 把完整输出留在内存并在超限时杀进程，环境与输出策略也不适合 raw Shell。
- Windows 当前取消兜底不能证明任意孙进程已经结束。
- UI 已有 Shell 专用审批块和轻量结果 presenter：审批从规范 public action 渲染完整冻结 command、Provider、逻辑 cwd、风险、timeout 与非敏感环境覆盖；非审批结果默认只显示无框单行最低状态和同一 public action 的命令摘要，不显示耗时、退出码、输出预览或预览截断。具备 owner-bound 结果时可以点击展开最高约 `156px`、内部滚动的紧凑 Shell 区域，并经 owner / Session / Run / ToolRun / execution 绑定的 IPC 分页读取详细日志；真实过期或缺口只在展开区弱提示。当前仍没有实时双流时间线和规则管理入口，不能从 `call.input`、模型 Tool result、日志第一页或未清洗输出自行拼默认正文。
- `AgentShellWorkspaceStore` 已提供 main-only Run 工作区、owner / Session 绑定、逻辑路径解析、symlink / hardlink / traversal 拒绝、generation、累计 provenance、SQLite 恢复、共享 quota adapter 和串行 mutation / persistence gate。Preparation 在 Quota live lease 下以 25 秒预算扫描五个逻辑根；SpawnPreflight 消费一次性 execution lease，并在短期 watcher 前后权威重扫。生产 Orchestrator 已注入 Provider / AI binding resolver。执行开始前另行预留默认 512 MiB growth headroom，reservation TTL 至少覆盖命令 timeout 加 60 秒；执行中默认每 500 ms 运行轻量 usage scanner，按 `max(logical size, st_blocks * 512)` 计费并拒绝链接、硬链接、特殊文件、超深、超条目、超单文件和超额度；进程结束后再执行完整 scanner v3 哈希扫描，并把 growth reservation 原子结算进既有 workspace resource。超限或计量不可信时取消进程、隔离 / 清理 workspace 并返回 `quota_exceeded`。应用关闭先关闭准入、abort execution、`interruptAll()`，等待日志 flush、最终扫描和配额结算后才释放 workspace。Windows content identity 继续 fail-closed；macOS generic xattr / ACL / file flags 和 path-based root guard 仍有同用户 TOCTOU，当前单次批准只是在明确残余风险下运行，不是 OS containment，也不能生成持久规则。
- Workspace Store lifecycle 也由 main 独占：首次 dispose 同步关闭公开方法准入，等待已经接纳但尚未进入 mutation queue 的 create / prepare / cleanup 等完整多阶段操作，再关闭 adapter 准入、等待已进入 adapter 的回调，最后注销 adapter 和关闭 persistence；重复 dispose 复用同一 Promise。同步 `get()` 在 closing 后只返回 `null`。同步读仍不是 read-committed 事务视图，当前只用于 main 内诊断，不能作为 Shell 执行授权依据。
- 当前 schema 2 已包含 workspace metadata、共享存储 ledger、Shell log metadata 和严格 prepared action 判别联合，并由统一 bootstrap 原地 reconcile / 自检；当前仍没有 Shell Rule 表和额外的规则命中审计字段。`AgentShellLogStore`、`AgentShellLogFileStore`、SQLite log persistence、物理正文、quota reattach、`AgentShellRuntime`、Orchestrator、动态 Registry 注册、生产 binding resolver、审批块、结果 presenter 和终态详细日志分页已接线。实时双流时间线仍未接到 renderer。
- `AgentLocalStorageQuotaManager` 已落地为 main-only owner-bound ledger，支持分类 / Run / 全局 / 单资源 / 4,096 条资源记录 / 低磁盘水位、reservation headroom、真实字节 commit / adjust、`settleReservationIntoResource` 原子结算、进程内 live lease、TTL、unknown occupancy、deleting 保留和失败后两阶段 sweep。Shell workspace、执行增长预留、日志和媒体产物共用同一 manager 与 `userData` 卷的 1 GiB 最低剩余水位；探针失败时 fail-closed。默认单资源上限为 2 GiB、总量上限为 8 GiB。周期扫描只能降低高速写满磁盘的风险，不等价于文件系统 quota。

实现阶段：

### Phase 1A：前台 Shell 核心

- 已完成 macOS Zsh 的 Provider 探测、Run snapshot、Analyzer / Policy、main prepare、单次审批、execution lease、spawn preflight、Supervisor、Runtime、动态 Registry 注册、ToolRun、safe approval / result presenter、日志 Store、执行期配额扫描与应用退出 settlement。
- main-owned 本机设置与模式 UI 已提供 `ask / auto / full-access`；模式切换只影响新 Run snapshot，不能修改活跃 Run。
- 实时阶段仍只投影有界 tail；终态 / 恢复后支持详细日志分页。实时双流时间线仍未实现，Shell 与文件桥的专用取消结算预算已补齐。
- macOS / Linux generic xattr、ACL、file flags 与 root guard 仍需 handle-based adapter 或 native directory anchor；当前仅本次审批明确接受残余风险，持久规则继续 fail-closed。
- Windows reparse point / ADS / UNC / 大小写敏感 NTFS、Job Object 和真机取消验收全部延期，Windows Provider 保持不可执行。Linux 也保持不可执行，直到独立宿主验收完成。
- 2026-08-31 已生成 unsigned macOS arm64 unpacked 包：Tree-sitter CommonJS 入口保持为 main 的外部依赖，ASAR 中该依赖只包含许可证、package metadata、`wasm/tree-sitter.js`、runtime WASM、Bash grammar WASM 与 PowerShell grammar WASM；使用打包 Electron runtime 从 ASAR 加载后，Bash 与 PowerShell fixture 均解析为无错误 `program` 根节点。macOS-only 自动化已通过真实 `/bin/zsh`、Runtime、Supervisor 与 LogStore 执行 PATH 中的临时 fixture CLI，并验证 host cwd、环境过滤和 stdout；真实应用 / 安装包中的常用 CLI、取消、超时、进程树和退出仍需手工验收。

### Phase 1B：文件闭环

- `file.stage` 的资料库 / 本机工作副本输入、递归 strict Schema、prepared action / SQLite 联合、下载后来源复验与 workspace provenance 已完成；明确宿主绝对路径的只读查看直接走 `shell.run`，不额外复制进 Run。
- `file.publish` 的资料库 / Save As、main-owned upload、authoritative 三态与取消结算已完成；真实资料库刷新和再感知体验仍需人工验收。
- `file.upload` 的用户明确本机路径、资料库绝对目录路径、内联审批、main-owned upload、来源 / 目标双重验与 authoritative 三态已完成；它只负责原样传输，不替代需要转换的 stage / shell / publish 链。

### Phase 1C：可撤销权限

- Session / 当前资料库 Shell permission rules。
- rule candidate、命中审计和规则管理 UI。
- 复合命令绕过、外部路径和动态语法定向测试。

当前能力清单只能标记“macOS 开发预览”。完成剩余 1A、1C，并分别通过 macOS / Windows 真实安装包验收后，才可改成稳定跨平台 `shell.run` 能力。

### Phase 2：纵深防御

- 按平台评估 sandbox / namespace / restricted token 等纵深能力。
- 外部目录 mount、网络策略和更严格磁盘 quota。
- 任何平台强化都不得制造 UI 声称一致、实际权限不同的隐性漂移。

### Phase 3：后台 Job

- main-owned ProcessSession、持久 Job 状态、日志、取消、恢复和配额。
- 明确应用退出和系统重启语义后再允许后台标记。

### Phase 4：PTY

- 独立 PTY session、stdin owner、终端 escape 安全、resize、密码和 TUI 交互契约。
- PTY 不复用 V1 ToolRun tail 假装终端。

## 17. 验证门禁

### 17.1 自动化

至少覆盖：

- Analyzer：`@vscode/tree-sitter-wasm` 必须使用与 analyzer revision 同步提升的精确版本；安装包与开发环境都能解析 runtime、Bash grammar 和 PowerShell grammar。静态已知子集生成稳定 `analysisIdentity / authorizationIdentity`；`cat / du / file / head / ls / stat / tail / wc` 对明确宿主绝对路径生成完整的外部只读路径 assessment，未支持的搜索 / 文本命令、动态语法、未知参数、link-producing copy、交互参数、Zsh `=command`、named-home 展开和 Parser / WASM 故障会标记 `unresolved` / `unknown_syntax`，再由 `ask / auto / full-access` Policy 处理；只有不可变 / 显式 deny 会在所有模式下无条件拒绝，其他分面可能在 `ask / auto` 下询问、在 `full-access` 下放行。electron-builder 只收集许可证、包元数据与三份所需 WASM，不能遗漏运行资源或误收整套无关 grammar。

- JSON Schema：空命令、NUL、24,576 bytes command、1,024 bytes cwd、32 项 / 16 KiB env、64,000 字符总 Tool input、timeout、provider ID 和危险对象键边界。
- Prepare：Provider 漂移、cwd realpath 漂移、workspace generation、env policy revision、审批重放，以及批准后由外部进程改写 cwd 时的 spawn 前 rehash / execution generation 失效。
- Bash / Zsh / PowerShell：Unicode、空格路径、多行、管道、重定向、条件、替换、解析失败。
- Permission：exact / token prefix、复合命令、原子操作、重定向目标、网络目的地、动态 head、nested shell、encoded PowerShell、deny 优先级、canonical matcher、analyzer / policy / env policy revision 和跨 owner / library / provider 隔离；完整分析的宿主绝对路径只读命令在 `ask / auto` 下询问、在 `full-access` 下直接执行；分析不完整时，`ask / auto` 询问，`full-access` 对未命中不可变 deny / 显式 deny 的 assessment（包括普通未知命令、高影响分面和 `unresolved`）直接放行。不可变 deny 仍优先于所有模式。
- Data scope：未感知 node、跨 owner / library node、过期 picker capability、fetch 前撤销读取授权、下载期间 node revision / ETag / storage binding 漂移、同名不同 hash、derived workspace 数据、不同项目的 `npm test`、网络 / 前序命令生成文件、无法证明 read set、AI profile / 配置 / Base URL 切换后均重新 ask 或拒绝，不能沿用旧内容读取规则。
- Environment：Key / Cookie / token、loader 变量、PATH / HOME 覆盖和宿主环境泄漏。
- Output：跨 chunk UTF-8、秘密、ANSI / OSC、Windows 编码、二进制、输出洪泛、双流顺序、batch identity、sequence 重叠去重、gap replay、详细日志前缀与最新 tail 中间缺口、`availableRanges / nextAvailableSequence / unavailableThrough`、cursor 失效、`1 MiB` 等额 head / tail 进程结果采集、最多 `160,000` UTF-8 bytes 的安全模型源、约 `90,000` JSON 字符的 Shell 规范结果收口、`100,000` JSON 字符 Broker 门禁、最高约 `40,000 tokens` 的 Shell provider 投影、每流最多 `4 KiB` renderer 摘要、无框单行默认 UI、最高约 `156px` 的内部滚动日志展开区、详细日志独立分页、tail / 有界全流日志截断和 TTL；必须覆盖 27.5 KiB 中文 Markdown 完整投影，断言完整流使用 `content` 且 `truncated=false / omittedBytes=0`，模型不得因文件长度、字段名或 UI 状态误判截断；真实省略时验证二次 byte / token 投影会保留 head + tail 并重算 `omittedBytes`。Run A 取消后同一 Session 的 Run B 仍要收到已完成 Shell 的安全 stdout、ordinal 和可用命令关联，不得只恢复状态文案或泄漏 execution ID、logRef、renderer preview。后续 turn 只对连续、完整、已消费且允许压缩的旧 Tool 回合生成严格 JSON 语义摘要，副本 staging 全部成功后才原子提交，最新结果、`skill.activate` 与 canonical ToolRun 保持不变。UI 自动化还必须验证：审批态保留完整卡片；其他状态只从 main public prepared action 显示最低状态和单行命令，不从 `call.input` 回退；默认不显示输出、耗时、退出码或预览截断；只有 owner-bound 结果可以展开，真实缺失只在展开区弱提示。分别以大量一字节 / 小 chunk 输入验证诊断采集与安全模型源的 retained bytes、retained object count 和处理耗时有界，且热路径不依赖数组头部搬移。终态前 flush，恢复只使用已提交水位。
- Process：正常退出、非零 exit、超时、停止、普通孙进程和 Broker 取消预算；单纯 renderer 页面卸载时 main 命令继续且返回后恢复 tail，注销、窗口销毁、应用退出时取消，崩溃后清理仍受 supervisor 管理的孤儿。
- Workspace：stage hash、同名冲突、并发原子 reservation、真实大小校正、低磁盘、Shell 直接高速写盘、崩溃 ledger 回收、symlink / junction / UNC、逻辑路径替换和终态清理。
- File bridge：三个 strict Tool Schema、上下文驱动 Tool loop、用户明确路径不弹 picker、renderer 不在场、页面中途卸载、main-owned handoff 和失败后不得自动续跑；本机只读查看不创建 `file.stage` ToolRun，需要工作副本 / 修改 / 转码 / 生成时才 stage，无加工原样上传使用 `file.upload`。
- Publish：canonical backend / account / owner / parent 写授权、commit 前重验、资料库 commit、刷新失败、commit unknown、Save As 取消、重复提交和一次性 grant / capability 重放。
- SQLite：单一 Schema Coordinator barrier、并发 Store 启动失败隔离、canonical schema 2 全新建库、已知旧 schema 2 幂等补列 / 补表 / 重建 trigger、判别 prepared action 联合、Rule unique index、ToolRun audit snapshot、Session 删除与 `deleting` 资源崩溃回收；不得生成 schema 3 / 4。
- UI：完整命令可见、风险与规则来源、日志恢复、未知 block 降级、无 HTML / URL / 原始路径渲染。

### 17.2 真实平台验收

macOS 与 Windows 必须分别验证：

- 安装包 ASAR 中存在 Tree-sitter runtime、Bash grammar 与 PowerShell grammar，Electron main 可通过包解析加载三者；不能只在源码目录或 Vitest 中成功。
- 安装包中的 Provider Probe、命令编码、PATH、常用 CLI 和退出码。
- 运行产生普通子孙进程的 fixture 后停止，确认 supervisor 管理的进程组 / Job 消失；另用 `setsid` / daemonize / 计划任务 fixture 验证已知识别与残余风险报告，不把 POSIX 进程组描述成不可逃逸容器。
- renderer 页面切换后命令继续、返回后 tail 恢复；Run 停止和应用退出后不残留进程。
- 从非第一个资料库 stage 一个中性文本 / 二进制 fixture，处理后 publish 回资料库并重新感知。
- 本机 picker 与 Save As 不泄露路径给模型或 SQLite；用户明确给出的宿主绝对读取路径可以进入精确 Shell command、public action、确认卡和 SQLite 审计，`file.stage` / `file.upload` 来源显示路径也可以进入对应 strict Tool input 与相同受控投影，但 canonical 路径、其他本机路径和任意输出目标仍不得泄露。
- Session / 持久规则只命中预期 token、cwd、风险和 scope，能够停用与删除。
- 在本地 AI profile 下批准读取 fixture 后切换到 Claude / OpenAI-compatible profile，旧规则不命中；重新暂存同名不同内容后也必须重新询问。

测试资料库继续遵守 workspace 规则：任何场景禁止第一个资料库；`Win` 可用时优先使用 `Win`。公司环境只能使用 macOS 本机 MinIO，因此公司内先完成 macOS 的非第一个资料库验收；Windows 的资料库桥必须在可访问 Windows MinIO 的环境补真实验收。媒体命令使用无声 fixture，涉及真实音视频内容的验证由用户执行。

## 18. 维护规则

- 实现 Shell 前必须阅读本文、`docs/built-in-agent-architecture.md`、`docs/built-in-agent-ui-contract.md`、`docs/desktop-platform-architecture.md` 和验证矩阵。
- 当前事实与目标设计分开维护。未落地字段、IPC、Store 和 UI 不得提前写进“当前能力”。
- Shell 新能力必须先更新 Tool / Provider / permission / workspace / UI 契约，再改实现。
- 不得因为某个命令难以分析，就把 AST 结果当沙箱或改回随手字符串白名单。
- 不得让 Skill、记忆或模型文本创建权限；不得让 renderer 直接执行命令或读取日志文件。
- 不得为 macOS 做一套成熟 Shell、Windows 只保留无法验证的 `taskkill` fallback 后仍宣称双平台完成。
- 如需改变 raw Shell、宿主权限、前台非交互、工作区桥或独立 RuleStore 中任一冻结决策，先修改本文并记录迁移与验证影响。
