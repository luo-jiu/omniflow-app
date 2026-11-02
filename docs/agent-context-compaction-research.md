# Agent 上下文计量与压缩对照研究

更新时间：2026-10-23

适用范围：内置 Agent 的模型窗口来源、当前上下文计量、摘要压缩、恢复与显示。本文记录源码证据和后续取舍；当前运行契约以[上下文计量](agent-context-accounting.md)、[模型预算](agent-model-context-and-reliability.md)、[旧正文清理](agent-context-pruning.md)和[Agent 架构](built-in-agent-architecture.md)为准。

## 1. 当前结论与本次边界

OmniFlow 已有可用的主进程计量账本、读取正文清理、当前 Run 语义摘要和跨 Run checkpoint。问题不在于缺少一套压缩器，而在于计量来源不够可见、旧文档与模型预算实现有漂移，以及辅助摘要请求也必须完整受模型输入和输出预算约束。

本次交付包括深度研究、Composer 模型选择器旁的小圆环与使用比例、窗口来源说明、随应用发布的 Codex 窗口表，以及两条摘要路径的请求预算修复。后续按用户要求给窗口表增加 OpenAI 服务商与 `/models` 精确 ID 双重匹配，重排提示词以保留更长稳定前缀。**没有迁移新版 OpenCode 压缩算法，没有接入 Codex 原生压缩，也没有完成本轮真实模型对照。** 具体测试和界面验收结果单独记入验证矩阵，不以本研究代替通过证据。

应继续使用普通模型摘要作为通用 Provider 的主线。Codex 服务端的加密压缩内容不能靠客户端源码复刻；新版 OpenCode 虽支持原生压缩，其 ChatGPT 登录插件目前仍显式使用普通摘要。后续值得先做的是完整摘要成本计量、精确的 Provider 限额表达和有界溢出恢复；后台压缩与原生压缩应在这些基础稳定后再接入。

## 2. 可复核的来源

| 来源 | 本轮固定版本与同步方式 | 可证明的范围 |
| --- | --- | --- |
| `project/codex` | `git fetch origin` 后 `git merge --ff-only origin/main`；`1a69ad3237fc485273ccfa9731239fdf789b43e4` → `d6817454d76885e9d0e118bbf82e507aed6f715a`；保留原有 3 个未跟踪文件 | 客户端模型目录、计量、压缩请求及安装过程；不能证明服务端内部压缩算法或当前账号真实限额 |
| `project/opencode-upstream` | 原 `project/opencode-dev` 无 `.git`，保持不动；新增官方仓库浅克隆，`dev` HEAD `4d30794bcf4dccdcadbcb1f62bb35b4943a96426` | 2026-10-23 新版 core/ai 实现；旧目录仅用于历史对照，不能赋予未知的 commit 身份 |
| OmniFlow | 本轮工作区实现及上述专题文档 | 既有 owner、预算和失败边界；历史实测不能替代本轮新增行为的验收 |

已查阅的官方资料：[Compaction 指南](https://developers.openai.com/api/docs/guides/compaction)、[Models list API](https://developers.openai.com/api/reference/resources/models/methods/list)、[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。官方通用 Models list 的职责是列举模型；不能假定任意兼容 `/models` 都提供上下文窗口、输出限额和原生压缩能力。

以下路径以固定 checkout 为基准；Codex 的 `core/`、`protocol/`、`models-manager/`、`model-provider/` 等短路径省略 `codex-rs/`，OpenCode 的 `session/`、`config/`、`util/`、`models-dev/` 等 core 短路径省略 `packages/core/src/`。已经带完整前缀的路径直接相对 checkout 根。后续升级先固定新 SHA，再复核公式和分支；不要只更新某个模型数字。

## 3. 模型窗口从哪里来

### 3.1 三种不同的目录策略

| 产品 | 主要来源 | 覆盖、缓存与未知值 |
| --- | --- | --- |
| Codex | 专用能力目录 `GET /models?client_version=...`；默认 Codex backend，支持认证身份；可指定 `model_catalog_url` 或本地 `model_catalog_json` | 缓存绑定 Provider、认证身份、客户端版本、时间和 ETag，TTL 300 秒；默认有 bundled 回退。显式外部目录有自己的失败规则。配置可调整默认窗口但受 `max_context_window` 限制；未知型号的 272k 是客户端 fallback，不是规格保证 |
| OpenCode | `models.opencode.ai/api.json`；仓库内置目录快照 | 显式文件 → KV 缓存 → 内置快照 → 网络；后台每 5 分钟更新，用户配置可覆盖 `limit`。窗口为 0 表示未知，不用猜测窗口触发自动压缩 |
| OmniFlow 当前 | 选择 OpenAI 服务商且当前连接 `/models` 列出的 ID 精确命中随应用发布的 Codex 窗口表，才使用目录默认；其余使用连接窗口元数据，再用 128k 内部回退 | 内部覆盖优先并受目录最大值限制；连接目录缓存按 Provider、Base URL 和凭据摘要隔离。Run 启动时解析并冻结，renderer 不决定窗口，也没有聊天预算编辑入口 |

OmniFlow 当前 `agent-model-context.ts` 的顺序是：内部覆盖 → 满足双重匹配的目录默认 → Provider 窗口 → `128,000`。`src/shared/ai-model-catalog.json` 只包含固定 Codex SHA 的 11 项 ID / 默认 / 最大窗口和来源，不包含上游提示词；运行时不读 Codex 源码或账号。普通 `/models` 只有 ID 时也可匹配；别名、大小写变体和未列出的日期后缀不能猜测。发现失败时仅可沿用同连接已有成功缓存，无缓存不套表；目录缺失不禁止调用。

该快照使 `gpt-6-astra` 从旧 1.05M 默认值收敛为 272k / 872k，补入 `gpt-6-sol`、`gpt-6-luna`。不在当前上游快照中的旧型号改走 Provider 窗口 / 默认预算；执行协议适配另有独立目录，不因此禁用 Tool 或改变日期 ID 的适配规则。旧 Run 分母仍保留原快照。

**已知目录优先仍有明确风险**：兼容网关可能在官方模型窗口之外另设更小的请求上限。模型身份默认值与网关约束不是同一个字段。后续应将它们分别建模，再取适用约束的交集；不能把 Provider 返回的较小值一概丢弃，也不能把所有 `context_length` 不经契约识别直接当官方容量。本轮来源标签只让这个事实可见，不证明网关支持目录值。

### 3.2 同名模型不能取最大值

本次两份源码目录里的 `gpt-6.1-sol`：

| 来源 | 默认 context | 最大可配置 / input | output |
| --- | ---: | ---: | ---: |
| Codex bundled | 272,000 | max context 872,000 | 由独立配置与协议决定 |
| OpenCode bundled 的 openai / opencode 条目 | 1,050,000 | input 922,000 | 128,000 |
| OmniFlow 本轮补录 | 272,000 | max context 872,000 | 沿用现有输出预留策略 |

这是不同客户端目录、路由与默认策略的差异，不能据此认定任何兼容代理一定支持其中一个数值。OmniFlow 使用 Codex 静态窗口表，显示“内置默认”；`872,000` 不自动成为分母。本轮没有读取用户 Codex 凭据来查询账号目录，也没有对这些最大容量进行真实请求验证。

证据：Codex `codex-rs/models-manager/models.json:177`、`:206`；`model-provider/src/models_endpoint.rs:92`、`:129`；`models-manager/src/manager.rs:586`、`:703`、`:766`。OpenCode `packages/core/src/models-dev.ts:247`、`:280`、`:331`、`:386`，`config/plugin/provider.ts:100`、`:140`，以及 `models-dev/snapshot.txt`。

### 3.3 872k 配置如何生效

Codex `models-manager/src/model_info.rs:20` 使用 `model_context_window` 覆盖默认窗口，再取不超过 `max_context_window` 的值。配置成 872,000 时，默认 95% 可用窗口为 828,400，90% 自动压缩阈值为 784,800；可显式配置更低的压缩阈值。HTTP / WebSocket 请求结构与 `core/src/client.rs:1113` 不发送窗口参数，因此客户端设置本身不增加服务端能力。

OmniFlow 的底层 resolver 已有有界 override，但生产档案未接入该字段。推荐后续在现有 AI 服务档案内按模型 ID 保存可选扩展值，默认为自动，下一 Run 冻结后生效；不要给一个服务的所有模型套同一个数字，也不要重建 Composer 的旧预算状态源。最大值与默认值相同时不展示扩展选项。当前输出预留、安全比例和实测校正仍生效，使用比例分母与实际调度一起变更。详见[模型预算](agent-model-context-and-reliability.md#最大可配置窗口的含义与后续入口)；本轮仅落实静态表与上限约束，没有默认开启 872k。

## 4. 先统一“用量”的含义

必须区分：当前模型可见上下文、允许发送的输入预算、累计消费。多轮调用会反复计费同一段历史；累计 token 除以窗口会把对话很快算成超过 100%。缓存命中减少成本，但缓存内容仍占上下文。

| 实现 | 当前上下文计算 | 不能直接照搬的细节 |
| --- | --- | --- |
| Codex | 最近一次服务端 `last_token_usage.total_tokens` + 其后新增条目估算；压缩安装后重估新历史，累计消费保持不变 | `cached_input_tokens` 是 input 子集，reasoning output 也不能不加区分地再加到 output；原生加密内容有专门估算。基础文本近似为 UTF-8 bytes / 4 |
| OpenCode | 同 Provider 最近有效响应的 input + cache read/write + output + reasoning，再加未发送的新消息/工具结果估算 | 它先把 input 规范化为 **non-cached input**、output 规范化为 **visible output**，五项互斥后才相加。文本近似为 JS 字符数 / 4；图片/PDF固定估算，并非精确 tokenizer |
| OmniFlow | 固定提示与消息前缀仍相同时：最近实测 input + 当前本地输入相对基准的增量；否则重估完整请求 | input 已含应计的缓存输入；只把实际回传的可见回答/工具参数计入后续消息，不把包含隐藏 reasoning 的整个 completion 再算一遍。不同 Run/模型独立建账本 |

OmniFlow 当前公式：

```text
L = floor((窗口 C - 输出预留 O) × 有效比例)
Δ = 本 Run 内 max(服务端输入 - 当次本地估算, 0) 的最大值
E = 兼容实测基准 + 新增估算；无兼容基准时为完整本地估算
S = max(E, 完整本地估算 + Δ)
安全可追加 = max(0, L - S - 工具预留)
```

基准只保存固定提示和消息前缀 hash。工具定义、提示、前缀或压缩变化会使基准失效，保留该 Run 已观测到的低估校正。缺 usage 不当作 0；`estimate / provider / provider-plus-estimate` 不能混成“精确已用”。当前 Run 累计报告尚不包含所有辅助摘要及未报告的失败请求，因此也不能叫完整账单。

证据：OmniFlow `agent-context-usage-ledger.ts` 的 `observe / snapshot / compacted`；Codex `protocol/src/protocol.rs:2425`、`core/src/context_manager/history.rs:939`、`core/src/session/mod.rs:5276`；OpenCode `session/usage.ts:11`、`session/compaction.ts:1067`、`:1122`，`util/token.ts:3`。

### 4.1 百分比与压缩线不是同一个数

- Codex 默认可用窗口 `U=floor(C×95%)`，自动压缩阈值通常不高于 `floor(C×90%)`。TUI 还从分子、分母扣固定 12k baseline 后显示剩余比例，表达的是用户可控制部分，不是原始窗口的线性占比。
- OpenCode UI 取最后一次响应的互斥 token 合计 / context；自动触发另用 `W=input||context`，默认 `W-max(floor(W×15%), W>=32k ? 16k : 0)`。压缩后首个响应之前 GUI可能显示0，这不证明新上下文为空。
- OmniFlow 本轮圆环展示主进程最近快照的当前估算输入 / 模型窗口；详情解释估算来源、窗口来源和可用预算。它不是自动压缩倒计时，不计未发送草稿，也不在 renderer 重新扫描聊天。旧会话未知用量不伪装成 0；切换配置/模型不继续套用旧快照。

## 5. 三方压缩机制比较

| 维度 | Codex | 最新 OpenCode | OmniFlow 当前 |
| --- | --- | --- | --- |
| 路线 | Provider capability决定 remote V2或local摘要；V2在 Responses 流追加 `compaction_trigger`，不是一律走旧独立 endpoint | summary/native双路径；native优先trigger再endpoint。ChatGPT插件明确强制summary | 通用无工具模型摘要；当前 Run与跨 Run两套生命周期，均不使用加密压缩 |
| 原始事实 | 活跃历史替换，持久checkpoint与rollout另存；local主要保留近期用户文本和handoff | 原始消息仍在数据库，checkpoint改变读取边界；native不兼容时回到原始历史 | SQLite Message/Run/ToolRun不被摘要覆盖；跨 Run摘要不充当执行回执，规范ToolRun事实独立投影 |
| 尾部 | local约20k近期用户文本；V2约64k符合条件的消息，不是所有最近工具日志 | 默认约15k最近对话文本，按user exchange边界；工具正文仅1250字符、媒体占位、reasoning省略 | 跨 Run保留预算内完整终态Run；当前Run保护最新及未消费工具回合、Skill正文和普通对话原文 |
| 工具配对 | 裁剪/删除保持call与output配对；V2可把可裁剪结果替换为占位 | 正常保持完整请求；超限时转纯文本transcript，避免编辑协议消息造成孤立tool | 只选连续、完整、已消费且允许摘要的工具回合；未完成或受保护记录阻断候选，副作用前预检全部最小结果 |
| 摘要内容 | progress/decisions/constraints/next steps；V2内容不透明 | Objective/Requirements/Decisions/Work State/Next Move/Relevant Files/Important Context；新事实优先并清理过时事项 | 跨 Run JSON V1保留目标、偏好、决定、待办；当前Run另有verifiedFacts/completedActions等严格结构与来源标记 |
| 权限与回执 | 当前权限/初始上下文由运行时重建；客户端摘要不等于工具副作用证明 | 摘要要求保留工作状态；不能据此证明具有OmniFlow同样的operation账本语义 | 摘要禁止表达/继承批准与许可；opaque capability和当前权限独立；`committed/uncommitted/unknown`从规范账本核对，不能由摘要猜测 |
| 失败安装 | 完整成功、V2恰好一个合法compaction项后才安装；后台候选还校验prefix/version/auth/model | 只有completed可作为历史边界；失败、取消、遗留running有明确结算；native仅同Provider/model重放 | 当前Run在副本暂存，任一摘要异常保持原上下文；跨Run started→completed两阶段，失败/损坏/中断checkpoint不激活 |
| 缓存 | 原生流复用相应transport；客户端细节不能证明服务端内部策略 | 摘要尽量发送原消息前缀+摘要提示，利用prompt cache；不适配后才展平并去掉工具定义 | 摘要使用专门payload和无工具请求，易校验但不保证复用工作请求的大段缓存 |
| 真实超窗 | local删旧历史配对重试；V2有明确裁剪/重试边界，取消和不完整流不能装入 | 无可见输出时可自动压缩恢复一次；摘要按首次拒绝估算的85%/70%/50%/35%缩小 | 目前结构化context overflow明确终止Run，不自动重放当前turn或Tool；估算不足不会变成盲重试 |
| 消费与后台 | 活跃用量和SpendingOnly分离；async compaction仍默认关闭 | 摘要失败/取消已发生的调用也记消费；实验background compaction默认关闭 | 主Run已有报告计量；辅助摘要完整usage/cost仍是缺口；无后台预生成 |

“local摘要”均指客户端组织一次普通 LLM 调用，不代表离线算法。摘要都是有损的；记录保留在磁盘与模型当前还能看到原文也不是同一件事。

### 5.1 OpenCode 新版实际增加了什么

旧 `opencode-dev` 同时含 legacy `packages/opencode` 与早期 `packages/core`，不能把两者都当新版入口。旧legacy的prune保护最近两轮与约40k工具正文，至少能省20k才清理，并保护skill；早期core摘要输入大于窗口就放弃。

新版统一至 `packages/core/src/session/compaction.ts` 后，独立legacy prune已不在该核心流程中。核心变化是：

1. 保持原请求前缀来生成摘要；全量不能容纳时先只发将被摘要的head，避免同时丢掉head与tail。
2. 极端超限将输入展平，按旧到新逐层缩减：工具输出首尾合计2000字符 → 去工具结果并缩输入 → 只留用户文本 → 最后才丢整段；上一checkpoint保留，最新exchange可缩短但不整体丢弃。
3. 摘要至少命中一个模板heading，否则nudge一次；输出因length截断判失败。这个格式校验比OmniFlow严格JSON校验宽松，不能宣称全面更安全。
4. 可选后台摘要在约85%压缩线、至少64k实测prompt时启动，等真正需要再换入，避免提前破坏缓存；检查保留尾部长度、模型、初始上下文，连续失败有抑制。

OmniFlow已有的40k/20k读取清理比旧OpenCode更窄：只清理可恢复定位、带路径/revision/范围的成功 `file.read` 正文，保留明确有损标记。本轮不扩大到任意工具结果，也不引入删除用户对话的降级策略。

### 5.2 本轮修复的摘要预算缺口

跨 Run摘要不能只用“最多多少字符”决定批次。中文、转义字符、上一份摘要、system prompt、协议开销和输出预留共同决定一次真实请求是否适配窗口。

本轮给每个跨 Run 摘要批次加入完整请求token预检，输出上限不超过4,096及本模型当前输出预留；选历史候选时同时用转义字符与非ASCII摘要上界规划最多4批。上界不能夹带ASCII标签而低估合法的全中文摘要；派生摘要里的孤立UTF-16 surrogate规范化为替代字符，合法Unicode和原始transcript不改，避免JSON六字符转义造成上界失真。不能完整容纳的Run不推进checkpoint边界，保持旧完成checkpoint与有界近期历史。这个修复使用现有JSON摘要格式、scope和两阶段提交，不是采用OpenCode的有损逐档缩减。

当前 Run 摘要的候选判断和实际调用也使用相同的有效输入预算，输出上限取2,048与本Run输出预留的较小值，并由原ledger扣除已观测的低估校正；不再只比较原始window。仍在副本上处理、成功后原子安装。辅助调用自身的usage与完整成本观察仍需补齐，不能把这些请求预检表述成“所有辅助请求已精确计量”。

### 5.3 缓存复用的本轮改进与下一步

[OpenAI 官方缓存说明](https://developers.openai.com/api/docs/guides/prompt-caching)要求完整渲染前缀一致；工具定义及顺序、模型、推理设置都可能影响匹配。OmniFlow 本轮将模型适配、Skill 目录等稳定提示放在目录 ID / 选区 / 感知说明前面，保持原始事实、权限规则、工具定义与消息顺序。这避免动态上下文提前打断稳定前缀，但不宣称必然命中或节省某个比例。没有设置更长 TTL 或给兼容网关添加未知缓存参数。

下一步若做当前 Run 的工作前缀摘要，应保存最近成功请求的不可变、有限生命周期快照；仅在模型、工具顺序、system、推理强度及候选前缀均匹配时复用到候选末尾，并追加明确范围的摘要指令。正文清理会改写 staging 前缀，不能把它直接当作曾发送的缓存前缀。完整请求仍须满足摘要预算，协议显式禁用 Tool，运行时再拒绝 Tool 调用；输出继续通过严格 JSON 与原子安装，失败沿现有隔离摘要恢复边界。

跨 Run 的 SQLite 消息不等于原始 Provider 请求，不能据此声称已重建缓存；保留更多历史、工具与工作请求的高推理强度也可能增加消费。启用新路线前先补辅助摘要 usage，分开缓存读取与写入，再按下文门槛做配对对照。当前 Claude `cachedInputTokens` 含读取与创建，不能直接当作缓存命中率。

模型目录缓存另有本轮修复：此前模型菜单已成功获得 ID，但 Agent 独立发现仍可能失败而使用未知窗口。现成功目录在 AI 服务层统一持有，菜单刷新发布白名单快照，Agent 同连接直接复用；Agent 的 3 秒发现、失败冷却与旧成功回退保持独立于菜单的显式报错。快照按连接 / 凭据隔离，请求序号防止晚到旧结果覆盖新目录。这个缓存保存模型信息，与服务端提示词缓存是两回事。

## 6. 推荐实施顺序

1. **计量可信且可见。** 保持main唯一owner和Run快照；本轮先接比例及来源。随后给辅助摘要/失败请求增加独立消费账本，不能污染活跃窗口，也不能把缺失usage当免费。
2. **限额表达完整。** 把模型默认/最大窗口、Provider输入上限、输出上限和客户端安全预留分开。专用目录按路由与认证身份隔离；普通`/models`缺字段继续带来源回退。只有确认字段语义后才调整现有catalog优先行为。
3. **一次有界overflow恢复。** 仅在没有可见响应、没有待决副作用且仍能重建原上下文时尝试；复用既有摘要和原子安装，禁止重放已执行Tool。失败保留明确原始错误及checkpoint，避免无限压缩循环。
4. **缓存与摘要质量对照。** 在保持当前权限/回执隔离的前提下，试验原前缀摘要与最近对话投影；用同一输入、相同模型比较质量、延迟、缓存命中和成本。不能仅因调用数下降就接受事实丢失。
5. **最后做可选native/后台压缩。** native由明确Provider capability开启，checkpoint绑定Provider/model/auth及格式；后台候选需prefix版本、模型、权限快照和取消所有权检查。上述两者当前都不是已实现承诺。

不新增给用户的确认框或强制工作流程。权限是否可执行继续由现有Run冻结与工具协议决定，不能从压缩内容恢复旧许可；研究中的验收门槛约束工程交付，不替代Agent自主选择工具。

## 7. 后续实施的验收门槛

### 确定性与真实接线

下列用例必须全部通过；越权、错误提交态、丢失当前用户请求、半成品checkpoint激活、重复副作用任一出现即否决：

- 覆盖input已含/未含cache、output已含/未含reasoning、缺失/非法/重复usage；当前占用与累计消费分别断言。
- 新会话、旧会话恢复、切模型/配置、压缩后重估、流式中与未发送草稿；验证main→SQLite→IPC→UI相同来源、同一数值，不用renderer stub代替生产接线。
- 中文/代码/反斜杠转义、超长单条、工具调用成组、当前任务与Skill、多模态占位；摘要请求本身也满足真实窗口和输出预算。
- 摘要空值/非法结构/输出截断/取消/进程死亡/完成回执延迟：旧事实可恢复、无错误激活，已产生消费可结算。
- 连续三次压缩后保留当前目标、更新后的要求、路径与revision，并区分旧观察/当前未知；规范`no-op/uncommitted/unknown`跨压缩、跨Run仍不升级为committed。
- 如新增overflow恢复，验证未输出可恢复、已有可见输出不重放、再次超窗停止；如新增后台/native，再覆盖晚到输入、配置/权限变化及跨模型不兼容回退。
- 使用非首资料库，优先Win；host使用隔离临时目录。运行全量lint/test/build，并按显示基线完成亮暗、窄栏、键盘焦点与会话恢复验收。

### 真实模型对照

新压缩路线开测前固定模型精确ID、Provider路由、推理强度、scope、窗口、任务版本、每组请求/消费硬上限和判定脚本；不根据结果调整样本。建议至少12个固定任务，每个方案每任务重复3次，同一模型形成36对配对结果；至少覆盖读取检索、文件编辑、要求变更、取消/未知回执四类。OpenAI-compatible与Claude分别报告，不能混合掩盖一侧退化。

验收同时报告首次无需恢复成功率、最终任务正确率、恢复额外调用、摘要调用/费用、总费用、延迟与缓存情况。建议初始门槛：最终正确率不低于基线且至少95%；首次成功率不低于基线；恢复调用中位数不增加、P95最多增加1次；单任务总成本中位数最多增加10%。新方案还应至少实现一项可复核收益，例如摘要调用中位数下降20%或压缩等待中位数下降15%。若需以成本换质量，必须在开测前写明替代门槛，不能事后解释。

报告配对结果与不确定性，样本不够、预算不足或只有单次成功时保留“未验收”。历史固定fixture测试只证明当时有限场景，不能算本轮的对照数据。本文不宣称Codex密文或OpenCode摘要在OmniFlow任务上质量更高。

## 8. 源码维护入口

- OmniFlow：`electron/service/agent/agent-model-context.ts`、`agent-model-catalog.ts`、`agent-model-profiles.ts`；`agent-context-usage-ledger.ts`；`agent-context-manager.ts`；`agent-active-context.ts`、`agent-active-context-summary.ts`、`agent-context-pruning.ts`；`agent-orchestrator.ts` 的摘要预检/Run投影。
- Codex窗口与UI：`codex-rs/protocol/src/openai_models.rs:523`；`core/src/session/context_window.rs:54`；`tui/src/token_usage.rs:8`。压缩：`core/src/compact.rs:263`、`compact_remote_v2_attempt.rs:174`、`compact_remote_v2.rs:375`、`session/mod.rs:4334`；后台默认关闭：`features/src/lib.rs:2136`。
- OpenCode：`packages/core/src/session/compaction.ts:253`默认配置、`:440`摘要、`:518`native、`:570`重试、`:660`缩减、`:858`结算、`:954`tail、`:1067`计量、`:1104`门槛；`session/history.ts:20`重放边界、`:144`tail恢复；`session/recent-text.ts:5`有损文本投影；`plugin/provider/chatgpt.ts:284`强制summary。

更新目录、Provider协议或摘要策略时，连同本文的来源、窗口公式、usage互斥语义和验收状态一起复核。不要把外部注释中的“verbatim”“total”“local”直接翻译成OmniFlow契约而不核对实际代码。
