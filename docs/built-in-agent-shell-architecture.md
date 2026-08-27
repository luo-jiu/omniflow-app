# 内置 Agent Shell 架构

更新时间：2026-08-27

状态：**目标架构已批准；持久化与共享存储基座进行中，`shell.run` 尚未实现**。

适用范围：

- `src/shared/agent/`
- `electron/service/agent/`
- `electron/platform/`
- `electron/ipc/agent.ts`
- `src/features/agent/`
- Agent Run 工作区、Shell 权限、进程、日志和资料库文件桥

本文冻结 OmniFlow 内置 Agent 的 Code Agent 级 Shell 目标架构。它扩展 `docs/built-in-agent-architecture.md`，但不改变当前代码事实：**当前尚未注册 `shell.run`，模型仍不能执行宿主命令**。在本文列出的实现和双平台验收完成前，不能在 UI、文档或发布说明中宣称 Shell 已可用。

现有 Session / Run / ToolRun、Tool Registry、Run capability snapshot、Permission Gate、Tool Broker、SQLite、revision、停止和恢复规则继续有效。Shell 不是绕过这些基建的第二条执行链。

## 1. 冻结结论

本轮已经确定以下方向：

- 不做预设命令白名单或“只读 Shell” Profile；第一版直接接受原始 Shell 命令字符串。
- `shell.run` 以当前系统用户权限运行。审批、权限规则、审计和数据最小化是主要防线，不能把命令分析器、工作目录或提示词描述成 OS 沙箱。
- Shell 只能经 Tool Registry、main prepare、权限判断、ToolRun、AgentToolBroker 和平台 Provider 执行；不得直接暴露 `AgentLocalProcessRunner`、Node `spawn` 或 raw IPC。
- V1 产品协议只提供非交互、前台命令：没有 stdin、PTY、密码输入、TUI、后台 Job 或跨重启续跑，并拒绝分析器能识别的脱离语法。宿主权限下的 raw command 仍可能借助其他解释器、本机程序或 GUI API 间接 daemonize、注册计划任务或弹出窗口；没有 OS containment 时不能声称完全阻止。
- macOS / Linux 与 Windows 使用独立 Provider；Windows 默认 PowerShell，不用 POSIX quoting 模拟 Windows。
- 每个 Run 有独立虚拟工作区。模型优先使用逻辑相对路径，宿主绝对路径只由 main 解析和持有。
- 资料库文件必须经 `file.stage` 暂存后才能被 Shell 使用；Shell 产物必须经 `file.publish` 才能进入资料库或本机目标位置。
- 普通 Tool 仍逐次审批。Shell 可以拥有独立、显式、可撤销、可审计的长期权限规则，但记忆、Skill、历史文本和普通 Tool 的一次批准都不能生成或扩大规则。
- stdout / stderr 使用有序、有界的实时 tail；main 托管有配额的已清洗全流日志。超过日志上限后的输出只继续 drain 和计数，不能整体写入 SQLite、时间线或模型上下文。
- `AgentLocalProcessRunner` 继续以绝对 executable + argv、`shell: false` 启动平台解释器；其当前内存收集、输出超限即终止和 Windows 取消兜底不能原样承担 Shell Runtime。

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

Claude Code 提供了较深的 Bash AST、复合命令逐项分析、无法证明时询问、非交互进程和有界输出参考。OpenCode 主要提供 raw command + workdir + timeout、pattern 权限、外部目录审批、Bash / PowerShell 平台分流、输出托管和进程生命周期参考；其不同实现代际的 parser 覆盖并不一致，不能被当成已经完成的跨平台 fail-closed 分析器。

综合两者后，OmniFlow 采用以下原则：

- 原始命令先经过 schema、分析、权限和审批，再进入进程层。
- 复合命令按原子操作、重定向和副作用逐项评估；无法可靠分析时默认询问。
- AST 用于解释和生成规则，不改写将要执行的命令，也不是沙箱。
- 非交互命令和 PTY 是两种不同产品能力，不共用一套含糊状态。
- 输出落到 main 托管存储，模型和 UI 只消费有界投影。
- 取消必须终止 supervisor 管理的进程组 / Job，不能只取消等待命令结果的 Promise；宿主程序主动脱离仍是没有 OS containment 时的残余风险。
- Windows 使用独立的 PowerShell / 进程树策略，不能假设 POSIX 行为存在。

OmniFlow 不复制两者的编码、Git、CLI 或多 Agent 产品假设。Shell 必须继续服从资料库 scope、Run capability snapshot、ToolRun 审计和受控 UI 协议。

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
- 只投影完成任务所需的有限 tail，不自动上传 main 托管的有界全流日志或整个生成文件。
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

- `command`：原始命令正文，允许多行；1～24,576 UTF-8 bytes，禁止 NUL。完整 Tool input 的规范 JSON 仍必须落在现有 64,000 字符总上限内。
- `cwd`：Run 工作区内的逻辑相对路径，默认 `work`，最多 1,024 UTF-8 bytes；不接受宿主绝对路径、盘符、UNC 或未经授权的 `..` 逃逸。
- `timeoutMs`：main 再钳制；初始默认 10 分钟，硬上限 6 小时。
- `env`：只允许非秘密、任务级临时覆盖；最多 32 项，名称最多 64 ASCII 字符，单值最多 2,048 UTF-8 bytes、合计最多 16 KiB，不能覆盖 main 保留变量。
- `providerId`：可省略且最多 128 ASCII 字符；只能选择本 Run Effective View 中的平台 Provider，不能提供 executable path。

这里的 raw Shell 指 `command` 由平台解释器按原生语法执行，不是把命令拆成预设 CLI Profile。模型仍不能决定解释器路径、启动 flags、物理 cwd、基础环境、stdin、PTY、后台模式或进程树策略。

### 6.1 环境规则

main 使用显式基础环境，再叠加经过校验的 `env`：

- `HOME / USERPROFILE` 映射到 Run 的 `home`。
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
5. Provider 对**原始命令**生成 AST / token 分析结果。
6. Policy Engine 计算原子操作、重定向、网络、外部路径、删除、嵌套解释器和无法解析项。
7. 先应用不可变 deny，再匹配显式 Shell 规则；未覆盖部分进入 `ask`。
8. 生成 public prepared action、main-only execution binding、单次 ID 和 snapshot hash。
9. 持久化 ToolRun 后才向 renderer 展示审批或进入执行。

分析器只能描述命令，不得重写、补引号、排序或“修复”命令。真正执行的 command bytes 必须与审批绑定的 bytes 完全相同；Provider 为传输、编码和禁用 profile 增加的固定 wrapper 不属于模型命令，但必须由 provider registration identity 冻结。

### 7.2 Public prepared action

严格的 `AgentPreparedActionPublic` 判别联合已经落地，目前只有 `media.extractAudio@1` 分支。Shell 落地时必须新增独立的 `shell.run@1` 分支，目标结构为：

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

解析失败、动态 command head、`eval`、嵌套解释器、PowerShell encoded command 等可以在没有命中不可变 deny 时允许“仅本次”，但不得生成 Session 或持久规则。

### 7.4 执行前权威复验

prepare 或 approval 成功都不直接等于可以 spawn。`AgentShellRuntime` 必须先向 `AgentShellWorkspaceStore` 取得当前 execution lease，并在该 lease 内紧邻 spawn 完成最后复验：

1. 重新校验 owner、Session、Run、ToolRun、prepared action / execution identity、Provider registration、command bytes / hash、逻辑 cwd realpath、环境策略、AI destination、规则 ID / revision 和全部 policy revision。
2. 对当前 cwd 重新枚举有界 manifest 并计算 `workspaceContentIdentity`，与 prepared binding 逐项比较；只看 workspace generation 不足以发现同用户外部进程或先前逃逸进程直接改写文件。
3. 任一内容、realpath、symlink / junction、来源 provenance 或授权身份变化都废止旧 execution capability，回到新 prepare / ask；不能把“执行失败”当成继续使用旧批准的理由。
4. Session / 持久规则自动允许只有在 WorkspaceStore 能从刚复验的内容创建 main-owned 新 execution generation 时才可用：先复制 / clone 出内容一致的执行快照，绑定 resolved cwd handle，再启动 Provider；命令写入该 generation，进程收口后重新生成 manifest 并把它切换为规范 workspace generation。无法对完整 cwd 建立有界快照、或命令依赖无法冻结的外部内容时降级为“仅运行本次”。
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

V1 不可变 deny 至少包括：

- 提权和 UAC。
- PTY、stdin 依赖和后台脱离。
- 覆盖 Provider / PATH / HOME / loader / credential 环境。
- 读写 main 控制目录、权限数据库、日志 store 或其他不向 Shell 暴露的内部路径。
- prepared action、Provider、工作区或规则身份漂移。

命令能否删除工作区文件、访问网络、安装包或启动子进程由风险分析、明确规则和审批决定，不用硬编码 CLI 白名单冒充 raw Shell。

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

- 模型、Tool result 和 SQLite 只保存 `input/...`、`work/...`、`output/...` 等逻辑路径。
- main 在执行前将逻辑路径解析为 realpath，并绑定工作区 ID / generation。
- 已暂存输入记录来源、大小、content hash 和只读语义；不能通过同名覆盖偷换内容。
- 工作区 manifest 维护单调累积的数据来源 provenance。Shell 把 staged 内容复制或转换到 `work / output` 后，来源不会因路径变化而消失；在具备可信细粒度 lineage 前，后续可能读取 workspace 数据的规则都按保守来源集合评估。
- `output` 只表示候选产物，不代表已经上传或保存。
- stage、publish 和每次 Shell 完成后更新 manifest / generation；同一 Run 的 Shell V1 串行执行。
- symlink、hardlink、Windows junction、reparse point 和 UNC 必须在 stage / publish 边界检查，不能把逃逸后的文件作为可信产物。
- 物理根路径由 main 持有并在输出投影中替换为逻辑路径；这属于隐私最小化，不构成防逃逸沙箱。

工作区必须具备总量、单 Run、单文件、低磁盘水位和终态 TTL。Shell 可以比监控更快地写满磁盘，因此没有 OS quota 时，周期扫描和超限取消只是可靠性保护，不得宣传为严格安全隔离。现有 `AgentMediaArtifactStore` 与 Shell 工作区必须共享全局本机 Agent 存储配额 owner，不能各自认为磁盘预算充足。

### 10.1 共享本机存储配额

当前已经落地唯一的 `AgentLocalStorageQuotaManager` 及 SQLite ledger，`AgentMediaArtifactStore` 与 Run workspace 已向它登记；后续 Shell control script 和 `AgentShellLogStore` 也必须复用同一个 manager，禁止各自维护互不相知的“剩余额度”。main-only 契约为：

```text
reserve(owner, category, runId, expectedBytes, ttl, adapterId) -> reservationId
bindResource(reservationId, resourceRef, owner)
commit(reservationId, resourceRef, actualBytes, owner)
adjust(reservationId | resourceRef, newExpectedOrActualBytes, owner)
touch(resourceRef, ttl, owner)
acquireLease(resourceRef, ttl, owner) -> lease
releaseLease(resourceRef, leaseId, owner)
cancelReservation(reservationId, owner)
requestRelease(resourceRef, owner)
sweep(reason)
```

配额规则：

- `reserve` 在同一个 main 串行 owner 中原子检查全局 Agent、category、Run、单文件和低磁盘水位上限；失败时不能先写文件再补记账。并发 stage、publish、媒体产物和日志不能同时把同一份剩余额度都预留成功。
- 已知长度的输入先按预期字节预留，写入完成后以 main `stat` 得到的真实物理字节 `commit / adjust`。未知长度流按小块增量扩展 reservation，扩展失败即停止生产者、继续必要的 pipe drain 并按对应 Tool 语义清理半文件。
- `shell.run` 启动前按本 Run 的允许增长上限取得 workspace reservation；执行期间监控逻辑大小与实际分配字节并校正。无法取得初始 headroom 时不启动命令，不能只依赖命令结束后的目录扫描。
- reservation、已提交 resource、owner、Run、category、真实字节、lease、TTL 和清理状态写入 main-only ledger。进程崩溃后先扫描固定托管根目录，以真实大小校正 ledger；过期 reservation 只有在确认没有 live Tool / process lease 后才能释放。
- Workspace / Log / Artifact Store 只注册 main-only resource adapter、绑定 opaque resource ref、报告实际用量和提交 cleanup intent。Quota Manager 独占 ledger、TTL eligibility、清理优先级和额度返还；它调用对应 adapter 的幂等 remove，只有收到物理删除成功回执后才删 ledger / 返还额度。Store 不得自行 sweep 已提交资源，Quota Manager 也不得绕过 adapter 拼物理路径。
- reservation 创建后，在首个临时文件落盘时立即 `bindResource`。取消未落盘 reservation 可以直接释放；已经绑定半文件时，`cancelReservation` 先经 adapter 删除物理文件，失败则保留 `deleting` 占用供 sweep 重试。不能因为 Tool 已取消就在半文件仍存在时提前返还额度。
- 清理优先级固定为：已过期终态详细日志 -> 已过期终态 workspace / artifact -> 已取消或失败的残留 -> 其他可重建缓存。不能为了腾空间直接删除 active Run、尚未发布的用户产物或 authoritative commit 所需文件；低磁盘时先停止对应生产者并生成明确终态。
- Session 删除、owner release、注销、窗口销毁和应用退出只为各自保留策略选中的资源提交清理意图；物理删除成功后才释放真实占用。删除失败保留 `deleting` ledger 项并由启动 sweep 重试，不能提前把额度返还后形成双重占用。
- Shell 进程可以绕过应用写入 API，直接在 workspace 中高速扩容。Quota Manager 只能通过预留、目录监控、周期真实大小校正和超限取消降低风险；没有文件系统 quota / 容器时，这不是严格磁盘隔离，文档和 UI 都不能作相反承诺。

## 11. 资料库与本机文件桥

`file.stage` 与 `file.publish` 都是 Tool Registry 中的 `business` Tool，各自创建规范 ToolRun，并计入现有每 Run 8 次业务 Tool 配额。它们不因被 `shell.run` 前后调用而变成免费内部步骤，也不能由 Skill、Shell wrapper 或 renderer 合并成一个不留审计的隐藏动作。两者的 Schema 递归 strict 到根对象、每个嵌套对象和判别联合分支：各分支按 `kind` 固定自己的 `required`，并分别设置 `additionalProperties: false`；危险对象键在通用 Schema 边界拒绝，不做类型转换、默认值注入或未知字段删除。`local-picker` 分支额外携带 `path`、library 分支混入本机字段、或 destination 分支出现另一分支字段都必须在 ToolRun 创建前失败。

### 11.1 `file.stage`

V1 模型输入和安全结果冻结为：

```ts
interface AgentFileStageInputV1 {
  source:
    | { kind: 'library-node'; nodeId: number }
    | { kind: 'local-picker' };
}

interface AgentFileStageResultV1 {
  logicalPath: string;
  displayName: string;
  sizeBytes: number;
  contentHash: string;
  sourceKind: 'library-node' | 'local-picker';
}
```

`nodeId` 必须是正整数；本机来源不接受 path 字段。`logicalPath`、`displayName`、大小和 hash 由 main 在原子落盘后生成：逻辑路径不超过 1,024 UTF-8 bytes，文件名不超过 240 UTF-8 bytes，大小是未超过单文件 quota 的安全整数，hash 使用固定 `sha256:<64 lowercase hex>` 格式。结果中不出现 library provider、签名 URL、本机路径、picker token、workspace realpath 或 capability。

`file.stage` 把受控来源复制到当前 Run 的 `input`：

- 资料库来源使用安全 `nodeId`，但 node 必须来自本 Run 当前感知集合或用户通过受控交互显式选择的集合；main 重新校验 canonical backend / account / library owner、节点类型、可见性和内容读取授权，不能只验证“nodeId 是正整数”。
- 通过校验后才生成一次性 renderer capability 取得内容；Shell 永远看不到 MinIO 签名 URL。
- 本机来源只能来自 main 的系统文件选择器或其他显式用户授权 capability，模型不能提交宿主绝对路径。
- V1 一次暂存一个普通文件；目录、symlink、special file 和无限递归复制不支持。
- 完成后返回逻辑相对路径、文件名、大小和 content hash；来源 token、物理路径和临时 URL 不进入模型或 SQLite。
- 暂存失败不创建半文件；先写临时文件，校验大小 / hash 后原子进入 `input`。

`file.stage` 是正式 Registry Tool，不是 Shell Runtime 的私有下载方法。当前资料库感知范围内的普通文件可以按只读策略评估；本机选择、外部来源和超出既有感知的对象仍需显式交互或审批，并完整经过 ToolRun、Broker、取消和审计。

stage 的 main-only binding 至少冻结：canonical owner / library、source kind、node ID 或 local-picker capability、node revision / content hash、感知或显式 grant provenance、storage binding、workspace ID / generation、目标 realpath、single-use ID 和 expiry。stage 只把内容放入本机工作区，不等于允许把正文发送给 AI；后续 `shell.run` 仍需按 staged data scope 与 `aiDestinationIdentity` 独立决策。

prepare 和执行 owner 固定如下：main 创建 ToolRun、校验 Schema、来源授权、工作区和配额，并生成一次性 binding；资料库 adapter 仍依赖 renderer 认证与临时内容能力时，只能经 `AgentToolPrepareBroker` / `AgentToolBroker` 取得绑定回执，真正文件下载和 hash 尽量在 main 托管。`local-picker` 必须先展示受控交互或审批动作，只有用户在绑定主窗口中直接操作后，main 才打开系统选择器并取得一次性 grant；模型调用、历史恢复和后台重试都不能自动弹选择器。未来 adapter 完全迁入 main 时可以替换 executor，但不能改变 Tool 输入、ToolRun、授权和结果契约。

一次性来源 capability 在 fetch 开始时原子 claim，失败后不能重放。claim 前 main 必须重新权威校验 canonical backend / account / owner / library、node revision、可见性、读取 grant、storage binding 与 capability expiry；任一漂移都在读取正文前拒绝。下载到临时文件并计算大小 / hash 后、原子进入 `input` 前，再次校验 node revision、content identity / ETag、storage binding 和读取授权；漂移时删除半文件、经 Quota Manager 取消 reservation 并废止 capability。若后端无法提供可比较的稳定 revision / content identity，该资料库来源不得静默 commit，只能重新 prepare 或报告当前 adapter 不支持一致暂存。本机 picker 则绑定实际打开的 file handle / 平台文件 identity，并以从该 handle 读取到的字节 hash 为准，不能在选择后重新按可替换 path 打开。

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

`sourcePath` 只能是 `output/...` 逻辑相对路径，最长 1,024 UTF-8 bytes；`parentId` 必须是正整数，文件名沿用当前上传边界的 240 UTF-8 bytes 上限，`providerId` 最多 128 ASCII 字符且只能来自本 Run 的安全 Effective View。省略 `conflictPolicy` 表示以 `rename` 解释，但不把默认字段写回原始 Tool input；省略 provider 时由 prepare 从当前目标目录解析安全路由。结果中的大小 / hash 服从 stage 的同一格式，不返回本机目标路径、物理 provider alias、上传 session 或 capability。资料库 authoritative commit 已成功但刷新暂时失败时，结果可以明确区分 `committed + pending`；Agent 可以说明文件已经提交，但在重新感知前不能声称目录树已看到或继续用该节点执行后续动作。

`file.publish` 把 `output` 中的普通文件发布到资料库或本机：

- 输入只接受工作区逻辑路径，main 重新检查 realpath、类型、大小、hash 和 workspace generation。
- 资料库目标冻结 `libraryId / parentId / provider / conflictPolicy`，复用现有上传、authoritative commit、刷新和再感知语义。
- 本机目标由 main 系统 Save As 选择；模型不提供绝对目标路径。
- 用户可在审批卡修改目标目录、文件名、Provider 或冲突策略；任何修改都会重新 prepare 并生成新 hash。
- 后端已经 commit 后刷新失败时保留成功文件，不重传；commit 不确定时不自动生成第二份本机兜底。
- 资料库不可用时可以通过 `interaction.request` 让用户改选本机，但不能未经确认自动改变目的地。

`file.publish` 同样是正式写 Tool，不能由 Shell 进程、日志 action 或 renderer 直接调用上传 API。它必须复用 prepared action、一次性 execution capability、authoritative commit 和再感知边界。

publish 的 main-only binding 至少冻结：canonical backend / account / owner / library、目标 parent node 和其当前 revision、目标可见与写入 grant、规范 storage provider binding、冲突策略、来源 workspace ID / generation / realpath / content hash、一次性 upload 或 Save As grant identity、expiry、prepared action hash 和 execution identity。用户修改目录、文件名、Provider 或策略后旧 binding 立即失效。

进入资料库 commit 前，main 必须要求当前 adapter 重新校验 canonical owner、library、parent 存在性、可见性、写授权、provider route 和一次性 grant；回执必须绑定窗口、Session、Run、ToolRun、prepared action、execution 和内容 hash。任一项漂移都在上传前或 commit 前拒绝，不能因为 prepare 时曾有权限继续写入。一次性 grant 只允许一个 authoritative commit；超时、迟到和重复回执不能生成第二份文件。

Shell 在 `output` 写出文件不等于发布成功。资料库只有取得 authoritative commit 后才能声称“已经提交”；重新感知前只能保留 `perceptionState: pending`，不能声称目录树已出现节点或继续使用该节点。本机 Save As 则以 main 原子复制完成为准。

### 11.3 Renderer 与卸载生命周期

- Tool registration 必须声明该 adapter 的 prepare / execute 是否依赖 renderer。需要 renderer 而当前绑定主窗口页面不在场时，main 立即以稳定的 `renderer_unavailable` 结构化失败收口当前 ToolRun；不把它暂停到后台，不在页面回来后自动续跑，也不静默改成本机或另一个 provider。用户返回后由新的 Tool call 重试。
- `file.stage` 在 main 已取得可独立消费的一次性来源能力后可以继续 main-owned 下载；若数据仍由 renderer 传输，页面卸载或 renderer 销毁会取消传输、删除临时文件并释放 reservation。只有大小与 hash 校验后原子进入 `input` 才算完成。
- `file.publish` 在 authoritative commit 前发生 renderer 卸载时取消 executor、上传 session 和未提交临时文件。commit 后的卸载不能撤销真实写入；Broker 只在现有 30 秒最终回执窗口内尝试完成刷新 / 再感知，随后按 committed fallback 与 stop-after-commit 语义收口，绝不重传。窗口结束后，页面再次出现只能由正常目录刷新或新的 Tool call 感知文件，不得回写终态 ToolRun、续跑旧 Run 或复活旧 execution。
- main-owned 本机 picker / Save As 只要 owner 窗口仍存活即可完成；owner 释放、窗口销毁、注销或 Run 停止会取消。系统确认覆盖后仍先写同目录临时文件，成功时使用平台可用的原子替换语义，失败时不留下被误报成功的半文件。
- 页面卸载不删除已经完成的 staged input、已提交资料库文件或已经完成的本机保存；这些结果继续由 ToolRun、workspace manifest 和 quota ledger 管理。应用重启不恢复未完成的 picker、renderer capability、上传或 Save As。

## 12. 进程、输出、取消与恢复

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

处理顺序固定为：有状态增量解码 -> 有状态终端控制序列 parser -> 有状态敏感文本 redactor -> 按 Unicode 边界切分安全 frame -> 分配 sequence -> 写 main log -> 更新有界 tail -> 进入有界事件调度器。

`sequence` 在每个 `executionId` 内从 `1` 单调递增，由 stdout / stderr 共用同一个分配器。它表达 main 实际接收并完成清洗的顺序，不宣称两个 OS pipe 之间存在更强的因果顺序。实时事件使用 batch 降低 IPC 压力；batch 内 frame 构成连续递增区间，且 `firstSequence / lastSequence` 与首尾 frame 一致。重试发送、恢复分页与实时事件允许区间重叠，因此 renderer 不能把“收到一次事件”当成唯一性依据。

V1 实时 IPC 还必须具备明确背压，不能把有界日志实现成无界 `webContents.send`：

- 清洗完成后的单个 frame 最多 16 KiB UTF-8；一个 batch 最多 32 frame 或 64 KiB，任一先到即 flush。正常运行对同一 execution 最快每 50 ms flush 一次，终态 flush 可以立即执行。
- 每个 WebContents + execution 最多保留 4 个未确认 batch，合计最多 256 KiB。Renderer 把 batch 正文或 main 明确声明的不可恢复 gap 合并到 resolved 水位后发送 `AgentShellOutputAckV1`；main 重新校验窗口、owner、四级 identity、ack 单调性以及水位不超过该 identity 已经通过 event / page 交付或声明不可恢复的 sequence，ack 不进入模型或 SQLite。
- 达到 high watermark 时，main 不再向 Electron IPC 队列推送逐批输出；只保留有界的最新待发 tail / watermark，较早未发送 batch 可以丢弃。子进程 pipe、清洗、日志 append 和 SQLite tail checkpoint 继续进行，不能因为慢 renderer 反向堵塞命令。
- 收到 ack、renderer 重新订阅或 Tool 终态时，main 从最新可用 tail 恢复实时推送。丢弃 live batch 会自然形成 sequence gap，renderer 必须按下面的 `afterSequence` 协议 replay；详细日志已截断时显示明确缺口。ToolRun 终态快照的 `lastSequence` 是最终恢复水位，即使最后一个 live batch 没有送达也不会把输出误判为完整。

- Provider 负责 UTF-8 / PowerShell 编码一致性和跨 chunk 解码；UTF-8 字符、ANSI / OSC 序列和秘密即使横跨多个 raw chunk 也不能被拆开后绕过处理。
- ANSI CSI 可以转换为纯文本效果；OSC hyperlink、标题、剪贴板和其他控制序列必须由跨 chunk parser 删除。
- 二进制输出不直接渲染；提示命令把内容写入 `output` 文件。
- UI tail、模型 tail 和 main 托管的有界全流日志各有独立上限。达到全流日志上限后继续 drain 子进程输出并标记 truncated，不能因不再保存而堵塞 pipe；超出上限的正文只有仍落在独立最新 tail 中时可恢复，中间未被任一 Store 保留的 sequence 通过 gap 协议明确丢失。
- SQLite 只保存有界 `AgentShellOutputTailV1`、总字节数、行数、截断标记、exit 信息和不含路径的 `logRef`。`truncatedBefore = N` 表示 sequence `< N` 已从该 tail 移除；它不代表详细日志仍一定保留这些 frame。
- 配额内的已清洗全流日志在 main 的 TTL Store 中；renderer 通过绑定 owner / Session / Run / ToolRun 的分页 IPC 读取，永远不取得文件路径。
- 模型默认只获得有界 stdout / stderr 尾部、exit code、duration、timeout / cancellation 和 truncation 事实。

受控日志读取请求至少绑定 owner、`sessionId / runId / toolRunId / executionId`、页大小，以及用于实时补洞的 `afterSequence` 或用于继续分页的 opaque cursor；两者不能同时提交。main 将单页钳制为最多 128 frame 或 256 KiB，并把 main 有界详细日志与 SQLite / 内存 tail 视为一个只读恢复视图。`availableRanges` 返回当前仍保留的合并连续区间，V1 最多是“详细日志前缀 + 最新 tail”两个区间；单页 frame 自身不能跨 gap。对于 `afterSequence = N`，`nextAvailableSequence` 是仍可读取的最早 sequence `> N`；若它大于 `N + 1`，`unavailableThrough = nextAvailableSequence - 1`。若直到规范 `lastSequence` 都没有可读 frame，则 `nextAvailableSequence = null`、`unavailableThrough = lastSequence`。cursor 同时绑定 `logRef` generation 与区间位置；日志轮转、清理或 identity 漂移后旧 cursor 失败，不能落到另一条日志。renderer 的恢复与合并规则固定为：

1. 读取 Session 快照期间，先按完整事件身份暂存 live batch；快照到达后以 ToolRun tail 为基线。
2. 只接纳四级身份和当前 owner 全部匹配的 batch，并按 `executionId + sequence` 去重；分页日志和实时流共用同一套去重逻辑。
3. 如果新 batch 的 `firstSequence > lastResolvedSequence + 1`，先标记 gap 并以最后 resolved sequence 发起 `afterSequence` replay，不能直接把两段文字拼在一起。
4. replay 与 live batch 可以乱序、重叠；renderer 只在取得正文或 main 明确返回 `unavailableThrough` 后推进 resolved 水位。若 `nextAvailableSequence > lastResolvedSequence + 1`，UI 先插入“sequence X～Y 已截断 / 清理”的单个 gap 标记，把水位推进到 `unavailableThrough`，再合并后续区间；`availableRanges` 即使仍含早期前缀也不能掩盖中间缺口。
5. 用户向前分页详细日志时，新页与当前 live tail 仍按 sequence 合并；滚动位置和展开状态属于 renderer 临时投影，规范 tail、终态和截断事实仍只来自 main / SQLite。
6. Tool 进入终态前，main 先 flush decoder、control parser、redactor、日志 append 与最终 tail checkpoint，再持久化 exit 事实并发布终态。应用崩溃仍可能丢失尚未完成该 checkpoint 的最后少量 frame，恢复时必须以已提交水位为准，不能猜测补齐。

日志清洗只能降低风险，不能保证识别所有秘密。有界全流日志不跨机器同步，不自动附加到模型，不进入普通应用日志；过期后 UI 保留终态摘要并显示“详细日志已清理”。

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

当前 UI 契约禁止直接展示 `call.input`、本地路径和进程参数；Shell 是一个需要新增集中 safe presenter 的窄例外。Renderer 只能展示 main 生成的 public prepared action 和日志投影，不能自己从 `call.input` 拼命令卡，也不能渲染 ANSI、HTML、任意 URL 或可点击命令输出。

## 14. 持久化与审计

ToolRun 仍是 Shell 执行状态的唯一规范事实。Shell 分支复用现有 prepared action 三字段，并需要增加以下持久事实：

- 在现有 `kind / version`、public snapshot 和 hash 契约中增加独立的 `shell.run@1` branch 校验。
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

`prepared_action_json` 已升级为 `kind / version` 判别联合。三字段 `prepared_action_id / prepared_action_json / prepared_snapshot_hash` 继续全有或全无；prepared action 存在时，三者与 `approval_input_hash` 必须以 SQLite `text` 保存，且审批 hash 必须与冻结快照 hash 完全相等。当前 `media.extractAudio@1` 分支由共享身份清单、TypeScript strict normalizer、Tool / action 绑定校验和 SQLite trigger 共同约束，验证 JSON 根对象、原始字段类型、精确字段集合、重复键、跨字段规则与有界长度。现有媒体结构在 reconcile 时补成明确的 `kind = 'media.extractAudio', version = 1` 分支，历史 snapshot hash 原样保留但不恢复执行能力；任何损坏行、hash 绑定漂移或 BLOB 类型漂移都会让 bootstrap 事务整体回滚。后续需要持久化 prepared action 的 `shell.run / file.stage / file.publish` 也必须各自增加独立 `version = 1` 分支，不能只扩充身份清单而复用媒体字段校验，不能只要 JSON 中“碰巧有 outputFileName”就通过，也不能让未知 kind 绕过约束。

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
    agent-shell-tool.ts                Registry Tool 定义
    agent-shell-preparation-service.ts main prepare 编排
    agent-shell-policy-engine.ts        风险与不可变 deny
    agent-shell-permission-rule-store.ts
    agent-shell-runtime.ts              前台执行与终态
    agent-shell-log-store.ts
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

## 16. 当前实现差距与迁移顺序

当前代码不能直接注册 `shell.run`，至少存在这些前置差距：

- `AgentPreparedActionPublic` 的严格判别联合基座已经落地，目前只有 `media.extractAudio@1` 分支；Shell 必须新增自己的 public / main-only binding 分支，不能复用或扩宽媒体结构。
- 通用 prepare hook 当前只支持 Renderer prepare；Shell 需要 main prepare，但仍必须复用同一 Orchestrator / ToolRun 生命周期。
- `AgentPermissionGate` 没有 Shell rule Store、canonical matcher、analyzer / policy / env policy revision、workspace content identity 和命中审计。
- 当前 Run snapshot / ToolRun 还没有可供 Shell 规则绑定的 AI profile config revision、Base URL identity 与 staged source provenance；只绑定命令 token 会造成跨数据、跨 AI 目的地复用。
- `AgentToolBroker` 对 main Tool 固定使用 6 秒取消收口；Shell 需要由 registration identity 冻结并受全局上限约束的专用 settle budget，避免 Broker 先结束、进程后清理。
- `AgentToolProgress` 只有 message / percent，不能承载带完整事件身份、sequence 水位、gap replay 和 cursor 分页的双流日志 tail。
- `AgentLocalProcessRunner` 把完整输出留在内存并在超限时杀进程，环境与输出策略也不适合 raw Shell。
- Windows 当前取消兜底不能证明任意孙进程已经结束。
- UI 当前没有 Shell safe presenter、日志 action 和规则管理入口。
- 当前 `AgentShellWorkspaceStore` 已提供 main-only 的 Run 工作区目录创建、`input / work / output / tmp / home` 逻辑路径解析、owner / Session 绑定、symlink / traversal 边界、generation、有限批次的累积 provenance manifest 和 Quota Manager cleanup adapter；SQLite persistence adapter 可在重启后恢复 workspace metadata / manifest / owner / status，并通过固定 workspace 根目录重建物理路径。启动恢复会交叉校验 ledger adapter、Run 和实际目录；缺失、非目录、symlink、已进入 `deleting` 或失去匹配 ledger 的工作区立即转入清理，受管资源经 Quota Manager adapter 删除，无法匹配 ledger 的旧 metadata 只清理固定受控根内的物理目录并保留失败重试状态。创建时的同名目录碰撞不会删除既有目录。它尚未接入 stage / publish 和 Shell runtime 目录监控，也不能替代现有媒体 ArtifactStore。
- 当前 schema 2 已包含 workspace metadata、共享存储 ledger 和严格 prepared action 判别联合，并由统一 bootstrap 原地 reconcile / 自检；当前仍没有 Shell Rule 表、Shell ToolRun 审计字段和日志水位。
- `AgentLocalStorageQuotaManager` 已落地为 main-only 的 owner-bound ledger 基座，支持分类 / Run / 全局 / 单资源 / 低磁盘水位检查、真实字节 commit / adjust、live lease、TTL、deleting 保留和失败后 sweep 重试；SQLite `agent_local_storage_resources` write-through adapter 可在启动时恢复 reservation / resource 状态，lease 不跨进程恢复。`agent-shell-storage-runtime` 打开同一 Agent 数据库、恢复 quota/workspace 并执行启动 sweep；`AgentMediaArtifactStore` 已通过稳定 `media-artifact` adapter 接入同一 manager，创建前预留、落盘后 bind、finalize 后按真实大小 commit，重启后不恢复媒体任务但保留 TTL 清理索引。统一 persistence runtime 和独占 Schema Coordinator 已进入应用启动与退出顺序，退出会先取消并等待活跃 Agent，再关闭文件传输和 SQLite。当前尚未接入日志 Store。默认单资源上限为 2 GiB、总量上限为 8 GiB。

实现阶段：

### Phase 1A：前台 Shell 核心

- 以已落地的单一 Schema Coordinator 与 prepared action 判别联合为基础，继续完成 main prepare hook、Provider Registry 和 `shell.run`。
- 共享 Quota Manager、基础 Run workspace / manifest、仅本次审批、逻辑 cwd、受控 env、非交互执行、实时 tail、日志 Store。
- macOS 与 Windows 的整树取消、超时、应用退出和中断恢复。

### Phase 1B：文件闭环

- 扩展 workspace provenance 与 content identity。
- `file.stage` 资料库 / 本机输入和递归 strict Schema。
- `file.publish` 资料库 / Save As、commit、刷新和再感知。

### Phase 1C：可撤销权限

- Session / 当前资料库 Shell permission rules。
- rule candidate、命中审计和规则管理 UI。
- 复合命令绕过、外部路径和动态语法定向测试。

完成 1A～1C 且通过 macOS / Windows 真实安装包验收后，才把 `shell.run` 写入“当前能力”。

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

- JSON Schema：空命令、NUL、24,576 bytes command、1,024 bytes cwd、32 项 / 16 KiB env、64,000 字符总 Tool input、timeout、provider ID 和危险对象键边界。
- Prepare：Provider 漂移、cwd realpath 漂移、workspace generation、env policy revision、审批重放，以及批准后由外部进程改写 cwd 时的 spawn 前 rehash / execution generation 失效。
- Bash / Zsh / PowerShell：Unicode、空格路径、多行、管道、重定向、条件、替换、解析失败。
- Permission：exact / token prefix、复合命令、原子操作、重定向目标、网络目的地、动态 head、nested shell、encoded PowerShell、deny 优先级、canonical matcher、analyzer / policy / env policy revision 和跨 owner / library / provider 隔离。
- Data scope：未感知 node、跨 owner / library node、过期 picker capability、fetch 前撤销读取授权、下载期间 node revision / ETag / storage binding 漂移、同名不同 hash、derived workspace 数据、不同项目的 `npm test`、网络 / 前序命令生成文件、无法证明 read set、AI profile / 配置 / Base URL 切换后均重新 ask 或拒绝，不能沿用旧内容读取规则。
- Environment：Key / Cookie / token、loader 变量、PATH / HOME 覆盖和宿主环境泄漏。
- Output：跨 chunk UTF-8、秘密、ANSI / OSC、Windows 编码、二进制、输出洪泛、双流顺序、batch identity、sequence 重叠去重、gap replay、详细日志前缀与最新 tail 中间缺口、`availableRanges / nextAvailableSequence / unavailableThrough`、cursor 失效、tail / 有界全流日志截断和 TTL；终态前 flush，恢复只使用已提交水位。
- Process：正常退出、非零 exit、超时、停止、普通孙进程和 Broker 取消预算；单纯 renderer 页面卸载时 main 命令继续且返回后恢复 tail，注销、窗口销毁、应用退出时取消，崩溃后清理仍受 supervisor 管理的孤儿。
- Workspace：stage hash、同名冲突、并发原子 reservation、真实大小校正、低磁盘、Shell 直接高速写盘、崩溃 ledger 回收、symlink / junction / UNC、逻辑路径替换和终态清理。
- File bridge：两个 strict Tool Schema、8 次业务 Tool 配额、renderer 不在场、页面中途卸载、main-owned handoff 和失败后不得自动续跑。
- Publish：canonical backend / account / owner / parent 写授权、commit 前重验、资料库 commit、刷新失败、commit unknown、Save As 取消、重复提交和一次性 grant / capability 重放。
- SQLite：单一 Schema Coordinator barrier、并发 Store 启动失败隔离、canonical schema 2 全新建库、已知旧 schema 2 幂等补列 / 补表 / 重建 trigger、判别 prepared action 联合、Rule unique index、ToolRun audit snapshot、Session 删除与 `deleting` 资源崩溃回收；不得生成 schema 3 / 4。
- UI：完整命令可见、风险与规则来源、日志恢复、未知 block 降级、无 HTML / URL / 原始路径渲染。

### 17.2 真实平台验收

macOS 与 Windows 必须分别验证：

- 安装包中的 Provider Probe、命令编码、PATH、常用 CLI 和退出码。
- 运行产生普通子孙进程的 fixture 后停止，确认 supervisor 管理的进程组 / Job 消失；另用 `setsid` / daemonize / 计划任务 fixture 验证已知识别与残余风险报告，不把 POSIX 进程组描述成不可逃逸容器。
- renderer 页面切换后命令继续、返回后 tail 恢复；Run 停止和应用退出后不残留进程。
- 从非第一个资料库 stage 一个中性文本 / 二进制 fixture，处理后 publish 回资料库并重新感知。
- 本机文件选择与 Save As 不泄露路径给模型或 SQLite。
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
