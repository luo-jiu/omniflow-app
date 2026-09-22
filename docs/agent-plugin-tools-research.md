# 内部 Agent Tool 与插件扩展调研

更新时间：2026-09-22
状态：调研与建议；AT0 契约及隔离运行时已实现，AT1 macOS 核心范围验收完成：合成链路及真实 gpt-5.5 + win 资料库 CSV 查询、单文件授权和来源审计通过。完整故障闭环与长时性能留待 AT2，其他平台未验收。当前实现与验收边界见 [AT0](plugin-system-at0-tool-runtime.md)与 [AT1](plugin-system-at1-agent-tools.md)。
适用对象：正在实施 OmniFlow 插件系统的开发者和 Coding Agent。

## 1. 结论与范围

建议将 Agent Tool 纳入插件系统的独立贡献类型，与 Viewer 并列。插件的业务算法可以同时被查看器和 Agent 使用；安装新业务插件后，不应每次都修改 Agent 核心才能调用它。

首期建议只开放“单个已授权资料库文件上的只读结构化分析”，用现有 CSV 插件实现一个查询 Tool。先验证声明、发现、授权、隔离执行、结果、取消和停用全过程，再讨论写操作。主题、图标插件无需强制提供 Tool；现有内置工具也无需立即迁移成插件。

用户明确当前不是多租户产品，本方案不引入成员级 RBAC、组织模型或跨租户协作。已有账号、后端、资料库、会话和 Run 范围仍要保留，用于防止资源串用，并不意味着新增多租户设计。

本次为静态代码调研，未运行新的插件或 Agent 联调，不把历史测试数字当作本方案的验收结果。基准 HEAD 为 `57cf1f6`，同时读取了工作树中正在进行的 E1 目录查看器改动；实施前应重新核对这些文件的最新版本。

原 A0～D2 方针未包含 Agent 路线；后续按用户确定方向单独推进 Tool 接入。本文保留调研依据，不将 Agent 接入追加入当前 E1 的完成门槛，也不改变既有 A0～D2 验收结论。

## 2. 当前内部工具清单

注册事实以 [Agent 编排器](../electron/service/agent/agent-orchestrator.ts)、[只读工具集合](../electron/service/agent/tools/file-read-tools.ts)和[写操作集合](../electron/service/agent/tools/directory-create-tool.ts)为准。工具注册不等于每个模型、每个 Run、每个平台都可执行；仍经过能力、权限和模型适配筛选。

| 类别 | 当前 canonical Tool 名称 | 能力与边界 |
| --- | --- | --- |
| 浏览与定位 | `file.list`、`file.search`、`file.stat`、`file.resolve` | 元数据目录查询、名称/glob 搜索、节点查询、精确路径定位；不等于存储正文可达 |
| 文本阅读 | `file.read`、`file.grep` | 读取文本和搜索正文，有输出预算与续读；部分读取工具也支持明确的 host scope |
| 创建与编辑 | `directory.create`、`file.write` | 创建目录；直接创建或按 revision 修改资料库文本，非任意二进制编辑 |
| 整理 | `file.rename`、`file.move`、`file.copy`、`file.delete` | 当前资料库内改名、移动、独立复制、移入回收站；目录有递归约束 |
| 回收站 | `recycle.list`、`recycle.restore` | 查询与恢复；没有向 Agent 开放永久删除工具 |
| 标签关系 | `tag.list`、`tag.update` | 查询标签、增删节点直接标签；不是创建/改名/删除标签定义 |
| 批量整理 | `library.batch` | 最多 50 项，支持 rename/move/copy/tag.update；不包含批量删除、恢复 |
| 内部文档 | `library.document.inspect`、`library.document.read`、`library.document.query`、`library.document.view` | PDF/DOCX/XLSX/PPTX 复用文档引擎；格式操作不完全对称，query 主要针对 XLSX，view 针对可渲染页面 |
| 媒体 | `media.inspect`、`media.extractAudio` | 媒体信息检查和音频提取，不是完整转码工具集 |
| 结果核对 | `operation.verify` | 当前会话 ToolRun 查询，加节点存在、名称和父目录核对；不是后端幂等提交证明 |
| 文件桥 | `file.stage`、`file.upload`、`file.publish` | 本机、Run 工作区和资料库之间的受控暂存与交付；由 Shell 服务运行时注册，有环境条件 |

辅助能力包括 `attachment.inspect/read/query/view`、`interaction.request`、`memory.propose`、`skill.activate`、`agent.plan.set` 和条件可用的 `shell.run`。它们不应与内部系统管理能力混为一谈。

### 当前不能夸大的能力

- [operation.verify](../electron/service/agent/tools/operation-verify-tool.ts)没有通用的标签集合、内容哈希或后端操作结果核对协议。标签核对仍需读取标签关系；节点存在不能证明某一次复制已经提交。
- 本地 ToolRun 记录能说明客户端曾观察到什么，不能保证响应丢失后重复请求绝不产生副作用。单租户同样存在这个问题。
- [批量工具](../src/features/agent/services/agent-library-batch.ts)逐项结果不能被整个批次的成功状态代替；插件写工具也不能把 `ok=true` 等同于全部已提交。
- PDF/PPTX 渲染依赖运行环境；解析成功与真实页面渲染成功分别验收。
- Markdown 文件链接已经是客户端打开/定位能力，不等于模型已有通用“操作 UI”Tool。
- 已有插件中的目录读取针对 E1 的普通漫画目录及直属图片，不是任意资料库遍历能力。

## 3. 内部能力扩展优先级

以下名称都是候选语义，不是已经注册的 Tool 或确定的公开 API。

| 优先级 | 能力 | 用户场景 | 建议实现位置 |
| --- | --- | --- | --- |
| 高 | 存储可达性、任务状态与错误查询 | 为什么打不开、上传进度、失败原因、迁移是否结束 | 核心宿主/后端 API，统一提供脱敏结果 |
| 高 | 归档与节点属性操作 | 设置漫画归档、封面、排序、内置类型 | 核心业务服务持有校验和写入，插件可以提出结构化请求 |
| 高 | 标签定义管理 | 创建“待整理”并应用，查询名称冲突 | 核心工具扩展，复用已有标签业务规则 |
| 高 | 专业格式和业务分析 | CSV 汇总、JSON 检查、漫画文件序列检查、字幕分析 | 插件提供算法与 Tool |
| 中 | 完善批量删除/恢复及逐项核对 | 批量清理测试文件，列出未处理项 | 扩展现有 batch 与内置操作，不创建另一套执行系统 |
| 中 | 宿主展示动作 | 打开结果文件、定位目录、展示产物 | 复用文件工作区受控动作，不让插件操作宿主 DOM |

首期不要求把上述所有能力一起完成。优先选一个核心只读状态查询和一个插件分析样板，分别验证“系统事实读取”和“可安装扩展”。

## 4. 插件系统实际可复用的部分

| 模块 | 已有事实 | Agent 接入时的缺口 |
| --- | --- | --- |
| [manifest 与包校验](../electron/service/extensions/manifest.ts)、[JSON Schema](../packages/plugin-sdk/manifest.schema.json) | 严格字段校验、命名空间、包指纹、版本、平台、权限和 Viewer 激活 | 目前要求 HTML entry、非空 viewers 和 viewer: 激活事件；没有 Tool 贡献，不能直接添加字段冒充兼容 |
| [SDK](../packages/plugin-sdk/index.d.ts) | context、read、目录读取、settings、阅读状态、事件 | 上下文以 viewerId/resource 为中心；没有工具调用的请求/响应、进度与取消协议 |
| [隔离运行器](../electron/service/extensions/isolated-view.ts) | sandbox、独立 session/origin、禁任意网络和 Node、资源预算、心跳、停止与诊断 | load 必须选择 Viewer 且匹配文件后缀/目录类型；实例绑定 WebContentsView，不能直接复用成通用后台执行 |
| [资源 Broker](../electron/service/extensions/resource-broker.ts) | 宿主授权、资源句柄、revision、分块读取、配额和撤销 | stateScope 使用 viewers[0].id，单一初始资源；激活前已先筛选当前 Viewer，现有多 Viewer 不因此串状态；Tool 接入时需分离上下文，不伪装成阅读状态 |
| [插件管理器](../electron/service/extensions/plugin-manager.ts) | 安装、启停、权限、指纹、版本切换、故障隔离、恢复模式 | resolve/stillAllowed 以 viewerId 查找；要增加贡献类型并覆盖在途 Tool |
| [Tool Registry](../electron/service/agent/agent-tool-registry.ts) | schema、风险、超时、prepare、注册身份、快照 | 目前执行对象是宿主代码，Registry 只提供追加注册且拒绝重名；需设计新 Run 的有效目录组合与旧 Run 身份固定，不能把插件代码 import 到 main |
| [Run 能力快照](../electron/service/agent/agent-run-capability-snapshot.ts) | 冻结当前 Tool/Skill/Provider 能力及注册身份 | 增加插件指纹和 Tool 协议身份；冻结不能替代实时撤权检查 |
| [资料库访问检查](../electron/service/agent/agent-library-access.ts) | 根据内置工具名称提取资源读写意图，绑定组目录策略 | 未知工具走 opaque 路径；不能简单按插件自行声称的 risk 放行 |
| [ToolRun 持久化](../electron/service/agent/agent-session-store.ts) | 执行事实、进度、交互、结果、恢复 | 需保留可追溯插件来源与版本，不把临时句柄或凭据持久化 |
| [Provider 名称转换](../electron/service/agent/agent-provider-tool-name.ts) | 名称替换为模型允许字符，并限制为 64 字符 | 横线保留，点等非法字符变下划线并截至 64 字符；Provider 请求层已有双向表并拒绝碰撞，插件接入应提前在有效目录构建时检查 |

## 5. 推荐架构

```text
已安装并启用的插件 manifest
    -> 宿主贡献目录（只读元数据，不执行插件）
    -> Agent Tool 适配器 + Run 冻结快照
    -> 参数校验 / 资源解析 / 权限检查 / 必要审批
    -> 隔离 Tool 实例（无需打开 Viewer 标签页）
    -> 受控资源 Broker
    -> 有界结构化结果
    -> 既有 ToolRun / 模型结果投影 / UI
```

Viewer 与 Tool 可以来自同一个包，共享纯业务模块。例如 CSV 解析模块由 Viewer 展示表格，由 Tool 执行筛选和数值统计。Tool 不能通过模拟点击 Viewer 或读取其 DOM 工作，用户关闭查看器也不应丢失运行中的工具任务。

不创建插件专用会话系统、审批系统、操作账本或媒体 owner。插件管理器拥有包生命周期，Agent 拥有 Run/ToolRun，资源 Broker 拥有资源授权；新代码负责适配这些已有 owner。

### 隔离执行器选择

首期建议复用当前 Chromium sandbox 的约束，新增“Tool 执行实例”适配层，验证它在无可见 Viewer、应用切后台时能完成一次有界调用。可使用无可见界面的 sandbox 页面，但不要为了凑接口创建假的 viewerId、匹配后缀或占用文件标签。

不要把 Node worker 或 utility process 自身等同于安全沙箱。若未来换执行载体，必须重新验证文件、网络、进程和宿主 API 隔离，不沿用 Viewer 的验收结论。

## 6. 贡献协议建议

下面只示意新增贡献块，不能直接放进当前 v1 manifest；完整格式和 SDK 版本由实施者冻结。

```json
{
  "agentTools": [{
    "id": "example.csv.query",
    "title": "查询 CSV",
    "description": "在指定 CSV 文件中筛选行并汇总数值列",
    "entry": "tools/query.html",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["resource"],
      "properties": {
        "resource": {
          "type": "object",
          "additionalProperties": false,
          "required": ["nodeId"],
          "properties": { "nodeId": { "type": "integer", "minimum": 1 } }
        }
      }
    },
    "outputSchema": { "type": "object" },
    "resourceAccess": [{ "parameter": "resource", "mode": "read", "kind": "file" }],
    "timeoutMs": 30000,
    "maxResultBytes": 32768
  }]
}
```

示例省略具体 CSV 筛选字段及输出 schema；实施时必须补成有界、严格的协议。`timeoutMs` 和 `maxResultBytes` 只能在宿主上限内申请，不由插件自行提升预算。

关键要求：

1. Tool ID 必须位于插件命名空间，不覆盖内置名；canonical 名、Provider 名和注册身份分别管理。
2. Schema 只支持宿主验证器允许的有限子集，限制字节数、深度、数组和描述长度，不允许远程 schema 引用。
3. 安装时校验格式；生成有效目录时校验与其它工具的 Provider 名冲突。需要缩短名称时用稳定映射并保留反向表，不能只截断后接受碰撞。
4. 首期只允许宿主定义的 resource 参数结构，支持明确 nodeId，路径先复用资料库解析。libraryId/owner/session/run 由宿主绑定，不信任插件或模型自报。
5. `resourceAccess` 用固定字段规则解析，不能允许插件执行任意解析函数、脚本或随意枚举宿主对象。
6. 插件拿到的是本次调用专用句柄和业务参数，不是 token、签名 URL、文件系统路径或整个 Agent 感知快照。
7. 声明 Tool 与授权读取是两件事；启用外观/Viewer 或安装包，不代表允许 Agent 自动读取所有文件。
8. SDK 和 manifest 版本按正式兼容策略演进；旧 v1 Viewer 包继续工作，旧宿主应明确拒绝新格式，不静默忽略权限或 Tool 声明。

工具只有一个资源的首期不开放目录 Tool、多文件输入、网络、本机文件和写入。E1 的目录能力可以作为后续扩展参考，但不自动继承进 Agent Tool 首期。

## 7. 授权、执行与结果

### 7.1 资源授权

有效权限为：插件已启用且未隔离 + 当前包版本有效 + 插件所获能力 + Agent 当前运行范围 + 后端资源授权。

不能把插件名称塞入 `intentFor()` 的“external”放行列表，也不能给所有插件统一免审。应由 main 适配器根据宿主支持的资源声明生成访问意图，复用现有目录访问 guard，再签发限定资源的句柄。句柄绑定插件指纹、实例、调用、owner、library、Session/Run/ToolRun 和 revision；不可跨调用复用。

只读 Tool 也可能接触正文。读取与向模型交付结果必须沿用当前 AI 目的地绑定和授权约束；插件没有任意网络出口。返回内容视为不可信数据，不能升级为系统提示词或授权指令。

### 7.2 执行顺序

1. 冻结有效 Tool 目录，未启用/不兼容/恢复模式阻止的插件不暴露。
2. 模型选择 Tool 后验证 schema，创建既有 ToolRun 执行记录。
3. 宿主解析资源、校验范围和当前授权；必要时走既有 prepare/审批。
4. 检查包指纹仍匹配，启动隔离实例，注入本次调用句柄。
5. 接收有界进度和一个终态结果；迟到、重复或其它调用的回包拒绝。
6. 校验输出、清洗敏感内容、应用字节和 token 预算，持久化既有 ToolRun 事实。
7. 结束后撤销句柄、停止实例、清理计时器和请求；不要求用户关闭某个 Viewer 才释放。

首期允许完成一次调用即销毁实例，先保证生命周期正确，不必提前做实例池。插件失败以普通 Tool 错误返回，让 Agent 能解释并选择其它已有能力，不能让整个宿主失去响应。

### 7.3 生命周期与撤销

Run 快照冻结代码身份和协议，不冻结访问权。停用、卸载、撤权、恢复模式、账号/后端/资料库切换后，新调用必须拒绝，在途调用取消，迟到结果不得写回新环境。

当前插件管理器更新包会停止实例。首期可沿用这个策略：旧调用中断并记录明确错误，新包用于后续新 Run；不要声称已经支持旧版本保活。冻结 Run 不能在重试中悄悄切到新版本。

Tool 超时、Run 取消、进程崩溃均要回收。首期只读不会留下文件写入副作用；写插件开放以后，取消不能被简单解释为“未提交”。

### 7.4 结果与审计

输出应包含结构化业务数据、分页或截断信息、格式警告。来源 nodeId/revision 由宿主根据本次授权资源绑定并核对，不信任插件自报的来源。插件可提供易读摘要，但不能自行声明宿主已执行某个写入或批准动作。

ToolRun 应能追溯 pluginId、包版本/指纹、Tool ID/注册身份和结果状态。字段落点优先复用现有注册与持久化扩展方式；如需 SQLite schema 演进，走既有协调器，不另建插件执行数据库。保留操作事实，不持久化可重放权限句柄、全文凭据或无限量日志。

图像、文件产物和可点击链接应经宿主受控 artifact/展示协议交付，不开放任意 HTML、IPC 名称或执行回调。

## 8. 工具发现与上下文预算

首个样板只有一个 Tool，可以直接纳入现有 Run 工具集合并测量固定输入预算；不要一开始构建复杂搜索系统。

规模扩大后采用“目录摘要 + 按需暴露完整 schema”。底层先冻结本轮可用插件集合，按需选择只是缩小或激活这个集合内的能力，不能绕过 Run 快照动态注入新包。

现有 Skill 协议 source 仅为 built-in，不能直接把插件文案当已支持的第三方 Skill。插件 Tool 首期不同时扩展 Skill。后续若需要插件工作流说明，单独设计来源、预算和允许工具范围。

## 9. 实施顺序与验收

这些是新工作包建议，不占用另一个 agent 正在执行的 E1 批次编号。

| 工作包 | 内容 | 完成证据 |
| --- | --- | --- |
| AT0 契约与生命周期实验 | manifest/SDK 演进、工具身份、无 Viewer 执行、资源声明、撤销策略 | 旧 Viewer 样板正常；无可见标签能运行只读工具；停止实例后旧句柄失效 |
| AT1 CSV Tool 完整接入 | 宿主 Tool 适配、资料库授权、CSV 查询、结构化输出、ToolRun | 同一 OmniFlow 会话完成定位 CSV → 调用插件 → 返回可核对结果，用户无需先打开 CSV |
| AT2 故障与管理闭环 | 停用/撤权/升级/崩溃/超时、输出预算、错误展示 | 下表负向场景通过；无残留进程、句柄、悬挂 ToolRun；更新后不执行旧授权 |
| 后续写能力 | 变更提案、宿主提交、冲突检测和幂等回执 | 另行冻结提交协议后再开放，不以 Tool 注册成功当作验收 |

最小验收矩阵：

- 成功：有标题行、多行中文 CSV，筛选和统计与已知样本一致；结果带来源和覆盖范围。
- 解析失败：损坏数据、非法编码、超大行或单元格明确失败/截断，不把未处理内容算作完整结果。
- 授权：错误资料库、越出组目录、伪造句柄、跨实例复用、资源 revision 改变均拒绝。
- 生命周期：运行中取消、超时、停用、撤权、升级、插件崩溃后终态可解释；迟到结果不污染另一 Run。
- 发现：停用插件不出现在新 Run；重复 Tool ID 和转换后 Provider 名冲突拒绝；固定输入预算不被无界 schema 撑满。
- 恢复：重启后历史 ToolRun 可查看来源和结果，不自动重放旧调用；新运行需重新解析资源和授权。
- 兼容：CSV/JSON Viewer 及 E1 当前样板不回归，查看器关闭不影响独立 Tool 的生命周期。
- 真实验收：使用非第一个资料库，优先可用 Win；正文对象必须位于当前可达存储。持续使用同一个 OmniFlow 会话，记录模型、Run 和关键 ToolRun，不只看最终回答。

代码实施后执行项目要求的 lint、测试、build，并补打包环境的 sandbox 与插件执行验证。平台结论按实际验收范围标注，不由 macOS 自动推广到 Windows/Linux。

## 10. 开放写 Tool 的后续条件

写能力建议采取“插件生成结构化变更提案，宿主准备、展示、授权并执行”模式。创建、重命名、移动、删除、标签和上传仍使用已有核心业务链路，不让插件访问数据库或对象存储。

只读接入不需要新增 Go 表。以后要保证写请求重试不重复副作用，必须补稳定 operation ID、请求指纹、服务端持久化回执和查询接口，并验证数据库事务与对象存储副作用的失败窗口。不能用本地 ToolRun 的成功字段代替服务端幂等。

如涉及 Go schema，必须先执行迁移，再运行生成脚本生成 model/query，随后写业务代码并同步 HTTP/CLI。单租户不是省略这一顺序或一致性处理的理由。

## 11. 与当前插件化工作的协作

当前正在修改的 manifest、SDK、resource broker、isolated view、plugin manager 和插件计划均是共享接入点。本文独立存放，不修改这些进行中的代码，也不替另一个 agent 承诺已实现状态。

实施者接手时先核对 E1 最新契约，优先分离 Viewer 与 Tool 的实例上下文，再接注册表。保持原 Viewer entry/activation 的兼容；不能为了接 Tool 取消既有 CSP、sandbox、包指纹、资源授权或输入输出配额。

需要冻结的决策只有：manifest/SDK 版本、执行实例入口、资源参数契约、Provider 名称映射、更新与撤销行为、ToolRun 来源字段。首期采用本文推荐的单文件只读范围即可推进，不必等完整插件平台或全部内部工具迁移。

## 12. 维护规则

后续 [AT2故障恢复](plugin-system-at2-fault-recovery.md)已在macOS开发环境完成既定范围验收：63项原生断言、故障审计集成与实际权限等待期间离库取消。小时级性能、发行包、Windows/Linux仍单列。

本文是调研方案，不是当前能力说明。实施后逐项更新为已验证事实并关联实际代码/验收记录；未落地字段保留“建议”标记。改动 Tool 契约、插件执行器、资源授权、管理生命周期、上下文发现或写提交协议时同步更新本文。


## 13. 代码复核与当前调整决策（2026-09-22）

结论：独立 Tool 贡献、共享纯算法、复用既有 Agent 执行记录和权限的方向成立。当前 CSV/JSON/漫画 Viewer 不必为此重写，也不要求所有 Viewer 必须提供 Tool。以下是 AT0 开工前源码复核补充的接入门槛，表内行号与缺口描述对应当时工作树。AT0 已实现其中的 Tool 协议、共享运行时、调用身份和贡献快照；AT1 已接通生产 Agent 目录组合与 ToolRun 来源持久化，真实模型 + 合成资源及真实 win 资料库 UI 验证均通过，macOS 核心范围验收完成；AT2既定故障闭环已完成；小时级性能、发行包和其他平台仍单列。当前事实以 [AT0 实现记录](plugin-system-at0-tool-runtime.md)和 [AT1 验收记录](plugin-system-at1-agent-tools.md)为准，第 6 节 JSON 仍是示意而非完整包。

### 已确认的复用边界

| 证据 | 判断与必要动作 |
| --- | --- |
| [隔离宿主（57 行）](../electron/service/extensions/isolated-view.ts)先选择贡献，再将 manifest.viewers 缩成单项；[资源 Broker（83 行）](../electron/service/extensions/resource-broker.ts)读取该项 | `viewers[0]` 是当前激活贡献，不是现有多 Viewer 状态混用问题。AT0 内部明确 execution kind/contribution ID，保持旧 Viewer SDK 的 viewerId 与 Session key 兼容即可。 |
| [PluginManager.attachRuntime（22 行）](../electron/service/extensions/plugin-manager.ts)直接覆盖唯一 stop 回调；[隔离宿主（36 行）](../electron/service/extensions/isolated-view.ts)独占固定 RPC handler，dispose 移除它 | 不能复制一个 Tool Host 再 attachRuntime。先统一实例登记、来源路由和停止广播，再分别接 Viewer/Tool 生命周期；停用/撤权/升级必须覆盖两类实例。 |
| [PluginViewer（34 行）](../src/features/file-viewer/components/plugin-viewer/index.tsx)绑定 active tab；[session pool（5 行）](../electron/service/extensions/plugin-session-pool.ts)全局只有四槽 | Tool 绑定 Run/ToolRun，不能绑定查看器可见性。共享隔离底座及总预算；首期满额可返回忙，不先做预热、常驻服务或新实例池。隐藏页面执行需要独立验收。 |
| [Tool Registry（855 行）](../electron/service/agent/agent-tool-registry.ts)拒绝重复注册，[公开 API（1253 行）](../electron/service/agent/agent-tool-registry.ts)无 unregister/replace | AT0 必须选择 Run 级组合目录或受控目录替换方案。新 Run 能看到启停/升级；旧 Run 固定旧注册身份，实时撤权另行检查，不能不断追加到全局注册表。 |
| [Provider 名转换（4 行）](../electron/service/agent/agent-provider-tool-name.ts)与[双向映射（120 行）](../electron/service/agent/agent-provider-model.ts) | 当前已拒绝碰撞，不是静默覆盖漏洞。新插件应在目录形成时提前拒绝冲突，避免拖到模型请求时令整轮失败；稳定短名属于可选方案。 |
| [资料库 guard（176 行）](../electron/service/agent/agent-library-access.ts)给未知工具签发 opaque grant，[后续资源校验（247 行）](../electron/service/agent/agent-library-access.ts)受它影响；[文件 authority（15 行）](../electron/service/extensions/library-resource.ts)只持有后端资源范围 | “弹一次未知工具确认”不等于单文件授权。插件必须走可解释的固定资源参数与确切 target 检查；Viewer 的后端授权不包含 Agent 会话组/Run/AI 目的地约束，不能直接等同替换。 |
| [普通执行上下文（114 行）](../electron/service/agent/agent-tool-registry.ts)未公开全部调用身份；[默认 registrationId（595 行）](../electron/service/agent/agent-tool-registry.ts)仅哈希声明 | 宿主为适配器提供不可伪造的调用绑定，绑定 owner/Run/ToolRun/插件指纹。插件代码指纹须显式参与注册身份；从模型参数补这些字段无效。 |
| [ToolRun 创建输入（1064 行）](../electron/service/agent/agent-session-store.ts)没有插件来源字段；[结果清洗（117 行）](../electron/service/agent/agent-tool-broker.ts)只保留 ok/message/data | 宿主在 ToolRun 创建时记录来源，覆盖失败、取消和无返回结果；不要把来源只塞进插件成功 result。沿用既有持久化协调器，不新建执行数据库。 |

### 当前已适配插件的处理

- **保持现状**：独立包、沙箱、CSP、签名 URL 不外泄、文件/目录句柄、内置回退和 Viewer 阅读状态继续使用。现有 SDK 无 `agentTools`，不提前接受无法执行的新声明，也不把 `viewerId` 简单改名后声称通用。
- **AT0 时调整**：协议新增 Tool contribution/invocation/result/cancel；管理器与隔离宿主共用实例目录；Viewer/Tool 身份和状态用途分离；安装读取批准不能自动变成 Agent 调用批准。每次资源使用与交付结果前仍检查本次调用、插件版本和授权有效。
- **样板可复用的实际部分**：[CSV parser（1 行）](../samples/csv-viewer/src/csv-parser.js)已经独立于 DOM，可以共享。当前它只产出字符串行，未实现表头、列类型、筛选或聚合；CSV Tool 仍须定义重复列名、空值、非法数字、精度、覆盖范围和输出预算。不能把现有表格渲染页面当作现成查询引擎。
- **不加入首期前置条件**：通用目录遍历、任意网络、写入、插件 Skill、后台常驻服务、完整动态发现、所有内置工具迁移。第 3 节中的其它内部工具建议可独立推进，不阻塞首个 CSV Tool。

### 本次发现并修复的当前缺陷

E1 的图片 MIME 白名单原先直接用普通对象按文件后缀索引。合成响应中的 `constructor`、`__proto__` 会命中继承属性，被加入图片条目快照；它们不属于承诺的图片授权范围。这是当前 E1 的真实缺陷，与是否接入 Agent 无关。

[目录 adapter（36 行）](../electron/service/extensions/library-directory.ts)现只接受白名单自有键；[回归用例（74 行）](../electron/service/extensions/directory-resource.test.ts)覆盖两个特殊后缀。修复前两项失败，修复后全部 8 项目录用例通过。现有 Viewer 功能和 Agent 协议未改变。

本次修复后全量 2618 项通过、7 项跳过，lint 与生产构建通过；此过滤修复没有 UI 改动，未重复运行真实应用交互。

本节接入判断来自实施前静态核对；后续 AT0 已验证无可见 Viewer 的 Tool 实验，AT1 已在隔离 Electron 中通过真实 gpt-5.5 + 合成资源验证：`file.resolve` 与 `example.csv-tools.query` 均完成，返回茶、牛奶两条匹配记录，`viewerCount=0`，插件 ToolRun 来源成功持久化。此项合成 `libraryId=3` 与真实资料库验收分别记录。真实应用随后已在 win 资料库（ID 3、本机 macOS MinIO）安装、启用并批准 CSV Tool 的两项权限；gpt-5.5 依次完成 `agent.access.request`、`file.resolve`、`example.csv-tools.query`，读取 `/文档/omniflow-c2-qa-20260914.csv`（节点 18517），结果为 205 行、表头“名称 / 内容”，返回前三行且明确 `truncated=true`。全程未打开 Viewer，来源详情已展开核对，SQLite 插件来源与安装包指纹一致。AT1 macOS 核心范围验收完成，完整故障闭环与长时性能留待 AT2；独立证据见 [AT1 记录](plugin-system-at1-agent-tools.md)。E1 已完成的真实资料库交互验收另见 [E1 记录](plugin-system-e1-directory-viewer.md)，不能代替 AT0/AT1 的独立验证。
