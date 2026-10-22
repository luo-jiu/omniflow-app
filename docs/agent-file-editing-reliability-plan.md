# Agent 文件修改可靠性调研与优化方案

更新时间：2026-10-22。

状态：**第一批工程验收通过；第二批真实模型对照未验收。** 原 7,026 项门禁和限定 macOS 主链未覆盖长空白行阻塞、缺失账本仍按节点推断提交、no-op 在清理期间取消丢回执三个反例，首次验收不通过的记录保留。三项已独立复验关闭，后续发现的 renderer 入口取消额外等待 30 秒也已修复，最终全量 7,091 项测试、lint、build 与 diff 检查通过，具体范围见[验证矩阵](frontend-validation-matrix.md#agent-无数字上下文补丁第一批2026-10-22)。新调用使用 `file.patch@2 / context-v1`，历史 unified-v1 保持兼容；[当前写入契约](built-in-agent-file-write.md)记录生产接线语义。范围是模型发现、读取、修改、验证文件的闭环，重点解决已发生的补丁失败；不扩大为权限系统、Provider 协议或编辑器草稿的重建。

评审条件已纳入实现与测试：显式提交态优先、no-op 真实持久化 / verify 接线、精确 EOF 字节规则；模型效果仍按第 9 节另行验收。代码接入和确定性检查不代表真实模型收益已证实。

## 1. 结论与证据范围

主要差距在于**模型输入需要承担过多可由程序计算的细节，以及错误结果不足以帮助模型恢复**。内部 / 本机统一路由、共享补丁引擎、版本检查、条件保存和独立 Diff 已经存在，应继续复用。

推荐保留一个 `file.patch` 工具和 `scope/path/revision` 结构化参数，将 `patch` 正文改为无数字计数的上下文格式。程序负责定位、计数、换行和生成实际修改计划；底层继续分别提交到 library / host。LLM 自主决定操作哪一端、读取多少内容、采用结构化工具还是适合任务的 Shell，不增加每次先 stat、必须按固定顺序搜索或人工确认的流程。

本次依据：

- OmniFlow App 基线 `cadfb9cf3695c8f7ad9949a94c4e9880c1d46b62`；工作区另有 Markdown 链接修复，未修改本次研究的文件工具实现。
- 本地 Codex 源码快照 `1a69ad3237fc485273ccfa9731239fdf789b43e4`。下文关于 Codex 执行细节的结论只对应此 checkout，未核对当前安装二进制。
- 官方 [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) 的工具格式建议，以及 [Apply Patch](https://developers.openai.com/api/docs/guides/tools-apply-patch) 的错误恢复与验证建议。官方推荐接近模型训练格式，但不能据此推导 OmniFlow 所有模型上的成功率。
- 本机已有会话只读查询，全部业务查询限定非首资料库 `library_id=3`；不访问第一个资料库，不把会话正文复制到本文。
- 使用 esbuild 在内存中打包未修改的生产 TS 模块，对合成字符串调用真实读取器 / 补丁引擎。未调用真实模型、未写资料库、未调用文件提交 adapter。

## 2. 已证实的问题

以下问题与源码行号对应调研基线 `cadfb9cf`，保留为改造依据。

### 2.1 真实失败只由 hunk 数字引起

2026-10-22 的同一修改任务中，第一次 `file.patch` 的 header 为 `@@ -7,17 +7,26 @@`，正文实际消耗旧文件 18 行、产生新文件 27 行。第二次改为 `@@ -7,18 +7,27 @@` 后成功；程序比较确认两次正文完全相同，只有 hunk header 不同。

第一次结果为 `INVALID_PATCH / uncommitted`，第二次为 `committed`。失败发生在 journal 准备和真实写入之前，没有部分修改。这说明正确性检查发挥了作用，同时也说明当前模型协议制造了一次本可避免的调用失败。

当前保留会话中共找到 5 次 `file.patch`，4 次 completed、1 次 failed，其中包含人工验收调用。样本很小、不是随机评测，不能用来估计日常错误率，更不能与 Codex 的主观使用体验直接比较。

### 2.2 模型需要同时维护四个数字

[公共补丁引擎](../src/shared/agent/agent-file-patch.ts) 第 62～85 行检查旧起点、旧行数、新起点、新行数，第 142～143 行又检查累计修改后的新起点。多个 hunk 时，模型必须累计前面所有增删量。即使修改正文正确，任何一个数字不对也会失败。

当前 [工具 schema](../electron/service/agent/tools/file-patch-tool.ts) 只把 path / patch 声明为必填，revision / expectedRevision 都在可选属性中；但[归一化](../src/shared/agent/agent-file-write.ts) 第 71～80 行要求修改必须且只能提供其中一个。描述说明了约束，但 schema 与运行时没有充分对齐，也没有最小示例。

### 2.3 读取结果没有给出补丁所需的尾换行信息

[读取器](../electron/service/agent/agent-text-reader.ts) 第 44～46 行拆分逻辑行后删除最后的空项；第 95～99 行返回正文、行号和 revision，没有返回 `endsWithNewline`。因此 `old` 与 `old\n` 的正文、行数组、行数完全相同，仅 hash 不同，模型无法从 hash 还原是否存在尾换行。

但补丁引擎第 151～153 行要求源行是否有尾换行与 `\ No newline at end of file` 标记完全吻合。当前工具把未展示的信息变成了模型必须准确填写的条件。这比单纯计数失误更值得修复。

### 2.4 标称输入上限与传输上限不一致

补丁 normalizer / schema 声称最多 128,000 个 UTF-16 code units；[Provider 流式参数](../electron/service/agent/agent-provider-model.ts) 第 75～79 行默认最多接收单调用 64,000 字符，包含 JSON 转义与其他参数。[审计扫描](../electron/service/agent/agent-tool-audit.ts) 第 23、204～206 行又限制单字符串 64,000 字符。

所以 128k 补丁不能按正常模型调用完整抵达执行器。增加模型上下文窗口也不能解除这两个独立限制。

### 2.5 反馈尚不能直接指向下一步

当前失败通常只有 `code`、中文 message 和提交态，例如“补丁上下文与当前文件不完全匹配”。缺少失败 hunk、补丁位置、候选行和建议读取范围，模型容易再次猜数字或重新读取整份文件。

当前 `validate` 只做参数归一化和目标检查，不解析补丁正文；纯语法错误常在读取源文件以后才暴露。可在 `filePatchTool.execute` 入口、调用任何读取 / 提交 adapter 前完成纯语法 preflight，并直接返回带诊断的规范 Tool result；执行阶段仍复验版本与上下文。

不能仅把解析塞进现有 validate：`AgentToolValidation` 当前只允许 ok / message，Permission Gate 会将错误变成 deny 文案，丢失结构化定位。选择 execute 入口可沿用现有结果投影，不必为本次修改泛化所有 Tool 的审批协议；它不承诺在现有权限决策之前返回格式错误。

## 3. Codex 值得借鉴的部分与实现差异

| 环节 | 本地 Codex 源码事实 | 对 OmniFlow 的决定 |
| --- | --- | --- |
| 输入 | `@@` 或 `@@ 上下文锚点`，正文用空格 / `-` / `+`；不要求 hunk 数字 | 采用无数字的正文语法 |
| 工具传输 | 存在 freeform + Lark grammar 工具定义 | 当前先保留跨 Provider 的 JSON 外壳，不将 Provider 重建作为前置条件 |
| 定位 | 按上下文搜索，exact 失败后依次放宽尾空白、首尾空白、部分 Unicode 标点 | 引入有边界的上下文定位；不直接照搬所有容错 |
| 重复块 | 每一层返回从游标起的第一个匹配，没有证明匹配唯一 | 由完整上下文消歧；仍有多个位置时给 Agent 候选行，无人工弹框 |
| 修改 | 先求 replacement，再构造整份 after 写盘 | 延续现有模式，不把逻辑局部编辑误称为磁盘字节区间写入 |
| 换行 | 保留部分原行结尾，但结果通常补上末尾换行 | OmniFlow 默认保留补丁重建后的边界，不做全局补换行或修剪；结构变化可改变 EOF 状态 |
| Diff | 由程序比较实际 before / after 生成 | 沿用现有私有快照和独立 Diff，不信任模型填写的行数 |
| 多文件 | 顺序执行，不能保证全局事务；后面失败不保证前面撤销 | 先保持单文件全部 hunk 成功后提交，不承诺多文件强事务 |

证据入口：[grammar](../../project/codex/codex-rs/core/assets/tools/apply_patch.lark) 第 15 行、[工具定义](../../project/codex/codex-rs/core/src/tools/handlers/apply_patch_spec.rs)、[replacement 计算](../../project/codex/codex-rs/apply-patch/src/file_update.rs) 第 60～165 行、[匹配器](../../project/codex/codex-rs/apply-patch/src/seek_sequence.rs) 第 35～106 行、[换行重建](../../project/codex/codex-rs/apply-patch/src/text_file.rs) 第 79～108 行、[实际写入](../../project/codex/codex-rs/apply-patch/src/lib.rs)。

Codex 的优势是格式、模型熟悉程度、执行器和反馈共同形成的闭环。源码并不能支持“从不出错”或“所有宽松匹配都安全”的结论。

## 4. 方案选择

| 方案 | 收益 | 不足 | 结论 |
| --- | --- | --- | --- |
| 自动修正 unified hunk 行数 | 实现相对小，可消除本次计数错误 | 新旧起点和多 hunk 累计仍需维护；EOF 缺口仍存在；悄悄重写旧格式语义不利于审计 | 不作为长期方案，旧格式保持严格含义 |
| `oldText/newText` 替换 | JSON 易表达，不需要数字 | 大片相同上下文需在两侧重复；多处修改另需数组协议；也必须处理重复匹配 | 可作评测对照，不新增一套并列工具 |
| 无数字上下文 patch | 删除数字负担，可表达多 hunk，接近已有模型熟悉格式 | 需要明确定位、歧义、EOF 和兼容语义 | 推荐 |

不先接入 OpenAI Responses 内置 apply_patch。当前 [Provider client](../electron/service/agent/agent-provider-client.ts) 使用 chat/completions 与 Claude messages，[工具序列化](../electron/service/agent/agent-provider-model.ts) 第 152～168 行分别生成 function parameters / input_schema，[Registry](../electron/service/agent/agent-tool-registry.ts) 第 407～410 行要求顶层 object。修改 `patch` 字符串内容即可跨现有 Provider 解决主要问题，freeform / grammar 可独立按实际收益推进。

## 5. 推荐的新模型契约

以下契约已接入第一批代码，实际验证范围见第 10 节；不将尚未执行的模型评测写成已完成能力。

### 5.1 一套工具与一个首选格式

保留 `file.patch`；新注册身份建议为 `builtin:file.patch@2`。向新调用明确展示 `format=context-v1` 与 `revision`。同一 object schema 使用两个 acceptance 分支：context 分支要求显式 context-v1 / revision；legacy 分支允许 unified-v1 或缺省 format，revision / expectedRevision 恰好提供一个。必须让旧输入通过真实 Registry schema 后再到 normalizer，不能只在后者接受别名。结构化 path 是唯一目标，不让模型在 patch 正文重复声明另一个路径。

最小调用示意（revision 直接取读取结果，无需模型计算）：

```json
{
  "scope": "library",
  "path": "/文档/main.cpp",
  "revision": "<file.read 返回的完整 revision>",
  "format": "context-v1",
  "patch": "@@\n int main() {\n-    return 0;\n+    // 正常结束\n+    return 0;\n }\n"
}
```

host 只改变 scope / path / 可选 basePath；正文处理器相同。该格式借鉴 Codex 的 hunk 正文，JSON 传输、单文件 envelope、歧义和 EOF 规则由 OmniFlow 明确定义，并非完整 Codex apply_patch 的兼容实现。

正文规则：

- 一个或多个 `@@` hunk，使用连续旧侧上下文定位。本格式不接受 `@@ 函数名` 作为跳转锚点，避免产生未定义的函数边界 / 跳行语义；所需定位文字放在连续上下文内。
- 空格开头为上下文，`-` 为删除，`+` 为新增。正文中的行号展示前缀 `L…:` 不属于源内容。
- hunk 不含任何新旧起点 / 行数；程序根据正文生成计数。
- 中间插入必须携带可定位的上下文；只有 `+` 的 hunk 明确定义为追加到 EOF，空文件也适用，不猜测中间插入位置。
- 可选 `*** End of File` 表示旧侧必须匹配文件结尾；它是位置约束，不代表新增尾换行。
- 文件创建、删除和改名继续使用现有对应工具；该 patch 不从正文开启其他文件操作。

### 5.2 定位与消歧

1. 在同一已验证 revision 的源文件上，对完整连续旧侧序列求候选；各 hunk 按源顺序、互不重叠，EOF 约束一起参与定位。
2. 精确候选唯一则采用；精确候选多个时返回 `PATCH_CONTEXT_AMBIGUOUS`，不由运行时任选第一个位置。
3. 精确匹配为零时，允许只忽略**空格前缀的上下文行**末尾的 ASCII 空格 / Tab；删除行仍逐字符精确相等，首部缩进和 Unicode 标点 / 空白不做归一。容错候选也必须唯一，并返回实际 `matchMode`。
4. 容错只帮助定位，上下文行始终复制源字节，新增行使用模型原文。不得根据容错改写未请求修改的缩进、标点或字符串。
5. 如果仍找不到或歧义未消除，返回有界候选位置和建议读取范围，由 Agent 自行补上下文。它是一次可恢复的工具结果，不触发用户确认流程。

将所有 hunk 转为内存中的 replacement plan，验证完整后再重建 after。任何后段 hunk 失败都不调用提交器。replacement plan 是单次执行的派生数据，不引入持久 patchPlan、审批 owner 或第二套文件状态。

尾部空白裁剪采用线性尾扫，长行比较与源 UTF-8 解码 / 控制字符校验均按有界块计费，累计达到扫描步长后让出事件循环并检查取消与 deadline。禁止用可能回溯的尾空白正则，或只在同步整行工作外竞速 timeout。必须包含 60,000 空格后接非空白、长空白尾部、真实 timer 取消及超时后的零写入回归。

### 5.3 文本字节与 EOF

`file.read` 补充从权威原始字节得出的 `encoding=utf-8`、`hasBom`、`lineEnding=lf|crlf|cr|mixed|none`、`endsWithNewline`、`sizeBytes`。这些是元数据，不把编辑器草稿混入读取。

新格式默认 `finalNewline=preserve`；仅在用户任务需要时可显式 `ensure/remove`，无需模型书写旧侧无尾换行标记。旧 unified 格式继续保留原标记语义。

**先重建正文，再执行显式 EOF 策略。** 显式 ensure / remove 即使在 hunk 未触及 EOF 时也作用于最后边界；“不涉及 EOF 时保留末尾”只适用于默认 preserve。BOM 不参与正文行或 EOF 判断，保留规则独立。

行模型为 `(text, ending)`，ending 是 LF / CRLF / CR / none。空正文是零行，`"\n"` 是一个真实空行；split 产生的尾部 sentinel 不是额外正文行。按以下顺序处理：

1. 保留所有未删除行的正文和原始 ending，包括真实空行。替换行优先继承对应源行 ending，额外新增行使用邻近 ending；无参考时用 LF。原无尾换行行变成内部行时，添加分隔新内容所需的 ending。
2. 最后的新增 / 替换非空行若抵达原 EOF，继承原末行的 ending；向空正文新增内容默认 LF。新增的最后一行若为空，必须保留表示该真实空行所需的 ending，不能序列化成零字节而吞掉该行。
3. preserve 到此结束：保留重建字节，不再为了保持原 `endsWithNewline` 布尔值全局去尾。删除最后一行后，保留行的 ending 可能使末尾状态自然改变；返回实际元数据，附有界 `EOF_STATE_CHANGED_BY_STRUCTURE` 诊断即可，不弹框。
4. ensure 保证**已有的末行**有 ending；已有则不变，缺失则补一个。优先使用重建正文中最后一个 ending，其次源文件最后一个 ending，均没有时用 LF。零正文行（含 BOM-only）保持零行，不制造空白行。
5. remove 保证已有的**非空末行**无 ending；有则移除该行的一个完整 ending，已有 none 则不变。若最终末行的 text 为空，去掉 ending 会丢失这个真实空行，整次返回 `PATCH_FINAL_NEWLINE_CONFLICT / phase=finalize / uncommitted`；Agent 可明确删除该空行后重新形成调用。零正文行保持零行。
6. 显式策略和全部 hunk 都成功后才创建 journal / 进入提交。任何冲突保持原文件完整字节，不落部分正文。默认仍精确要求删除文本；有限上下文容错不改变这些规则。

混合换行在拼接边界还须防止裸 CR 与下一空行的 LF 合成一个 CRLF 而吞行。只允许调整新增 / 替换行的 ending：优先将前一新增 CR 扩为 CRLF，否则将后一新增空行的 LF 扩为 CRLF。若两边均为保留片段，则整次返回 `PATCH_LINE_ENDING_CONFLICT / phase=finalize / uncommitted`，不改保留字节、不吞行。该检查在显式 EOF 策略前执行。

以下字符串按 JSON 转义解释；每列均独立从 before 执行同一正文修改，不能把 preserve 列当作另两列的已提交基线。“拒绝”表示原 before 字节保留。仅改变策略而无正文修改的行，是重建 / EOF 核心的策略 fixture，不表示生产 parser 已接受无实际修改的 hunk。

| before | 正文修改 | preserve after | ensure after | remove after |
| --- | --- | --- | --- | --- |
| `"a\nb"` | 仅第一行 a → A | `"A\nb"` | `"A\nb\n"` | `"A\nb"` |
| `"a\nb\n"` | 仅第一行 a → A | `"A\nb\n"` | `"A\nb\n"` | `"A\nb"` |
| `"a\n\nb"` | 删除最后 b 行 | `"a\n\n"` | `"a\n\n"` | 拒绝，保留 `"a\n\nb"` |
| `"a\nb"` | 删除最后 b 行 | `"a\n"` | `"a\n"` | `"a"` |
| `"a"` | 追加非空行 b | `"a\nb"` | `"a\nb\n"` | `"a\nb"` |
| `"a"` | 追加一个真实空行 | `"a\n\n"` | `"a\n\n"` | 拒绝，保留 `"a"` |
| `"a\n\n"` | 无正文修改 | `"a\n\n"` | `"a\n\n"` | 拒绝，保留 `"a\n\n"` |
| `"a\n\n"` | 明确删除最后空行 | `"a\n"` | `"a\n"` | `"a"` |
| `"a\r\n\r\nb"` | 删除最后 b 行 | `"a\r\n\r\n"` | `"a\r\n\r\n"` | 拒绝，保留 `"a\r\n\r\nb"` |
| `"a\r\nb"` | 仅第一行 a → A | `"A\r\nb"` | `"A\r\nb\r\n"` | `"A\r\nb"` |
| `""` | 无正文修改 | `""` | `""` | `""` |
| `"\uFEFF"` | 无正文修改 | `"\uFEFF"` | `"\uFEFF"` | `"\uFEFF"` |
| `""` | 新增 x 行 | `"x\n"` | `"x\n"` | `"x"` |
| `"\uFEFFa"` | 删除唯一正文行 | `"\uFEFF"` | `"\uFEFF"` | `"\uFEFF"` |
| `"row-0\rrow-1\n"` | 替换为 x 行及一个真实空行 | `"x\r\n\n"` | `"x\r\n\n"` | 拒绝，保留 before |
| `"a\rb\nc\n"` | b 替换为真实空行 | `"a\r\r\nc\n"` | `"a\r\r\nc\n"` | `"a\r\r\nc"` |
| `"a\rx\n\n"` | a / x 两行替换为 A | `"A\r\n\n"` | `"A\r\n\n"` | 拒绝，保留 before |
| `"a\rx\n\n"` | 仅删除 x | 换行边界冲突，保留 before | 同左 | 同左 |
| `"a\rx\nb\n"` | 仅删除 x | `"a\rb\n"` | `"a\rb\n"` | `"a\rb"` |

preserve 的“保留”对象是重建后的内容边界，不再承诺任意结构修改后源 EOF 布尔值不变；ensure / remove 是显式要求，其不可满足条件必须失败，不能只警告后声称已满足。实际最终边界变化都进入 before / after Diff。

### 5.4 输入预算

将正文上限与总参数上限作为两个明确条件：建议新格式正文最多 32,000 UTF-16 code units，单调用序列化参数仍不得超过当前 64,000；JSON 转义、path / basePath 和其他字段计入总量。32k 正文不保证任意转义 / 路径组合都可通过，最终必须核算真实序列化总长度。

集中定义并测试 schema、normalizer、Provider 累积、审计扫描与诊断投影的预算，错误说明实际命中的限制。大改动由模型按任务拆分，每次使用上次成功返回的新 revision；不扩大所有工具的流式上限，也不把大补丁截断后尝试执行。单文件源 / after 的 8 MiB 上限继续单独校验。

### 5.5 无修改回执与提交态的全部消费者

无实际字节变化时返回 `ok=true / changed=false / outcome=unchanged`，before / after revision 相同；`mutationCommitState` 和 `writeCommitState` 均显式为 `uncommitted`，operationId 仍由 main 绑定。ToolRun 正常保存为 completed，message 明确“内容未变化”。不调用提交 begin、不创建文件变更 journal / Diff，不新增第四种提交态；ToolRun 的调用记录仍正常持久化。

实施前的 [readOperationJournal](../electron/service/agent/agent-orchestrator.ts) 曾以 `commitState === committed || result.ok === true` 推断 committed；[operation.verify](../electron/service/agent/tools/operation-verify-tool.ts) 曾只对 uncommitted 短路，其余按节点存在 / 名称 / 父目录推断。两处已按下述规范改造；首次独立验收又发现无账本分支漏拦截，本轮补齐。不能仅修改 executor 和展示。

提交态规范化检查 data 中四个**自有字段** mutationCommitState / writeCommitState / deleteCommitState / uploadCommitState，禁止通过 `||` 忽略已出现的空值：

| 持久化回执 | readOperationJournal 的状态 |
| --- | --- |
| 出现的所有字段均为合法三态且一致 | 精确采用显式状态，独立于 ok / ToolRun.status |
| 任一字段为空、null、未知值或类型错误，或字段互相冲突 | commit_unknown，附回执无效 / 冲突诊断；不回退 ok |
| 完全没有显式提交态 | unknown，不凭 ok=true 推断副作用 |
| 无结果 / 未找到活动 | unknown / 未找到，仍不凭调用终态推断提交 |

因此 `ok=true + uncommitted` 仍未提交，`ok=true + commit_unknown` 仍未知，`ok=false + committed` 仍已提交（可能仅后处理失败）。历史无态工具若确有兼容需要，应逐工具另行验证具体证据，不能保留通用成功回退。

no-op 的 operation.verify 应从可信账本直接返回 `status=not_committed / outcome=unchanged / changed=false`，不调用节点核对，也不把“操作已完成”表述为“文件已提交”。file.write / patch 的 commit_unknown / unknown 不得根据节点名称、父目录或存在状态升级为 committed；权威提交回执未确认时保留未知。当前内容 revision 可用于判断内容是否符合目标，但不能证明某个 operationId 曾提交、也不能触发重放或擅改 sealed 状态。

没有账本、reader 缺失 / 失败或工具类型未知也必须保留 `commit_unknown / retryAllowed=false / node=null`，不探节点；覆盖跨 Session 查询旧 operationId 与 ToolRun ID。仅已知账本中的既有节点元数据操作保留兼容核对。

必需真实接线：library 生产 no-op → Broker → SQLite completeToolRun → 生产 readOperationJournal 闭包 → 注册的 operation.verify；断言 completed 与 uncommitted 同时保留、没有提交 begin / 文件变更记录 / Diff、verify 不读取节点。SQLite 关闭重开后按 operationId 和 ToolRun ID 再查也必须相同。host no-op 同样验证持久化和账本投影，不把只支持资料库 nodeId 的 operation.verify 冒充宿主文件核对。另覆盖三态各配 ok=true/false、无态 / 非法值 / 冲突，以及 unknown 但元数据恰好匹配的文件修改；不能仅 stub 一个已经正确的 readOperationJournal。

正常完成、取消竞争、Broker / Provider 结果投影和 UI 都消费相同事实；展示层按 outcome 表达“未修改”，不能把它显示为失败或新保存。

已形成的 no-op 在 host 句柄关闭或 library 回传 IPC 期间遇到停止 / 超时，须在现有有界结算窗内保留。严格绑定可信注册身份、当前 operationId / executionId、冻结输入 revision 和一致的未提交态；不能拿普通未提交结果绕过取消，也不为 no-op 触发 begin / journal。真实 main→renderer→main 与持久化链均须覆盖，超过结算窗的迟到回执不得复活原结果。

## 6. 可操作的反馈与验证闭环

错误 data 增加有界结构：`phase=parse|match|finalize|version|commit`、`code`、`hunkIndex`、`patchLine`，以及按错误类型选择的 `candidateRanges`、`candidatesTruncated`、`suggestedRead`、`nextAction`。候选最多展示 5 个位置；找不到时不以编辑距离强行修改，也不伪造有把握的目标行。

| 情况 | 反馈 | Agent 的可行下一步 |
| --- | --- | --- |
| 格式 / 预算错误 | 具体补丁行或字段、限制；旧格式可报声明 / 实际计数 | 修正输入或拆小，不必重读没变化的文件 |
| 上下文找不到 | 失败 hunk 和有依据的建议读取范围；没有可靠位置时明确说明 | grep / read 获得真实上下文 |
| 上下文重复 | 有界候选行范围、是否截断 | 自行增加上下文再调用，无需询问用户 |
| EOF 策略与保留空行冲突 | PATCH_FINAL_NEWLINE_CONFLICT、phase=finalize、未提交 | 自行明确删除空行或改变策略后重新形成调用，不部分保存 |
| 保留的 CR / LF 边界拼接会吞行 | PATCH_LINE_ENDING_CONFLICT、phase=finalize、未提交 | 将需要改变 ending 的相邻行显式纳入修改后重新形成调用 |
| revision 冲突 | 文件已变化，`nextAction=reread` | 读最新正文并重新形成修改，不重放旧调用 |
| 已确认提交 | 新 revision、真实增删统计、changed、operationId | 继续下一处修改或运行测试 |
| commit_unknown | 明确不能安全重试，保留原 operationId | 先核对现有文件 / 回执；不能自动重写、跨通道绕过或宣布成功 |

`nextAction` 是恢复建议，不是新增模型行为白名单。恢复过程仍由 LLM 判断，不强制每次执行相同工具序列。

不把完整 before / after 或整个失败 hunk复制到诊断。当前 journal 快照私有，但模型原始 `content/patch` 参数仍会按现有审计策略进入会话输入 / Provider 历史；二者并非同一隐私范围。是否进一步私有化模型写入正文是独立议题，本次不改变。

成功保存、文本修改正确、代码行为通过验证是三个层次。结构化工具可以证明版本与提交，不能仅凭 `committed` 宣称代码无 bug；模型仍按任务运行测试、编译或重新读取。资料库编译沿用原始字节 stage 链路，不让模型从带行号输出重建源文件。

## 7. 读取与搜索：保留已有能力，单独改善成本

当前 `file.read` 已支持直接 path、默认尽量读取至末尾、10k token 输出预算、Unicode 长行续读、源字节 SHA-256 与版本绑定；[提示词](../electron/service/agent/agent-prompt-assembler.ts) 第 162～168 行已明确不用固定串联 search → resolve → stat。Codex 的本地 Shell 工具也没有必经 stat 的隐藏流程，模型按任务选择 rg、sed、cat 等命令。

要区分输出范围与 I/O 范围：当前先完整安全读取、hash、decode（最多 8 MiB），再按 offset / column / limit 输出。局部读取减少模型上下文，不等于对象存储或文件系统只读了几行。全文流式扫描 / 行索引是后续独立性能工作。

当前 grep 已使用共同匹配语义，但还未具备 rg 原生整树扫描的性能：

- [matcher](../electron/service/agent/agent-grep-matcher.ts) 第 73 行先启动一次空输入 rg，第 85 行对每份文本快照再启动一次。因此包含 50 个实际扫描文件的一页可产生约 51 次正文 rg 调用，另有候选枚举；这是调用链推导，未在本轮做真实性能测量。
- [grep](../electron/service/agent/tools/file-grep-tool.ts) 第 103、116 行先取得候选元数据，后做 include / exclude。可把共同 Glob 筛选提前，减少无用元数据读取，不直接翻译成 rg `-g` 而改变 minimatch 语义。
- grep 固定约 8 KB 输出，而 Orchestrator 给其 10k-token 预算。可采用与 read 一致的真实 envelope 预算打包，验证游标不会跳过尚未交付的匹配。
- grep 的主片段 / 上下文会截断，并有 `textTruncated`；模型不能把截断片段当作完整待删除行，应在需要时读取周边。

性能优先实验：literal 使用已有等价 JS 匹配器；regex 对有界快照批次进行匹配，避免每文件启动一次进程。批次须有总字节、映射、取消和部分结果结算，不能集中缓存 50 × 8 MiB。若尝试直接 rg 扫宿主路径，必须重新设计文件身份 / revision / 跳过统计，不可当作简单替换。资料库也不为使用 rg 而先下载整库。

## 8. 落地边界与兼容

核心调用链保持：

```text
模型 file.patch
  → 当前 Run 有效工具 / 参数 schema 校验
  → 既有路径冻结与权限决策
  → execute 入口纯语法 preflight，错误直接返回结构化 Tool result
  → 读取 saved 原字节并复验 revision
  → 公共上下文引擎生成完整 after
  → 私有 journal prepare
  → library 条件保存 / host 文件提交
  → 既有结算、内容事件、独立 Diff
```

必须同步的代码点：

| 落点 | 必须处理的内容 |
| --- | --- |
| `src/shared/agent/agent-file-patch.ts` | 格式分派、纯语法解析、上下文求址、EOF、结果和诊断 |
| `electron/service/agent/tools/file-patch-tool.ts` | @2、分支 schema、示例、execute 入口纯语法 preflight；旧参数兼容 |
| `electron/service/agent/agent-file-path-resolver.ts` | 旧 unified header 仍按原结构化 path 校验 / 归一；新格式正文不重复声明路径 |
| `src/features/agent/services/agent-file-write.ts` | library 使用同一新引擎；版本 / 条件提交 / 刷新不变 |
| `electron/service/agent/tools/agent-local-file-mutation.ts` | host 使用同一新引擎；身份 / hash / 临时文件 / 提交结算不变 |
| `electron/service/agent/agent-file-change-prepare.ts` | main 重新计算授权 after 时使用完全相同的格式与规则 |
| `electron/service/agent/agent-orchestrator.ts`、`agent-tool-broker.ts` | 当前硬编码 @1 的可信 mutation 判定必须一起更新；建议共用身份判定函数，仍校验执行器、来源和风险 |
| `agent-orchestrator.ts` 的 readOperationJournal、`tools/operation-verify-tool.ts`、真实 SQLite 接线 | 显式提交态优先；无态 / 冲突不按 ok 升级；no-op 短路；文件 unknown 不凭节点元数据确认 |
| `agent-text-reader.ts` 及对应结果 / 缓存 | 新增真实文本元数据；调整缓存类型和保守计费 |
| `agent-prompt-assembler.ts`、Provider / 审计预算 | 只教新调用的首选格式；总参数上限一致；保留上下文预算 |
| `src/features/agent/agent-tool-presentation.ts` 及规范结果投影 | no-op 表达为“未修改”，保留失败恢复字段，不新增入口或状态 owner |

兼容决定：

- `format=unified-v1` 保持当前严格语义；历史省略 format 的调用仍视作 unified-v1，不在升级时改变含义。
- 新 context 分支明确要求 format / revision，legacy 分支仍允许缺省 format / 旧版本别名；描述和示例只教 context-v1。Provider 展示与执行校验暂时共用这一 acceptance schema，不引入两套 schema。不能在匹配失败后猜另一种格式、忽略 revision 或自动切 scope。
- 新 Run 冻结新注册身份和能力；运行中的旧 Run 不热替换工具闭包。历史 ToolRun / journal 不重新执行或转换，也不因为新解析器更宽松而修改过去的失败事实。
- 当前上下文 prune 已保留读取的 path / scope / revision / 范围；补测压缩后重读再修改，不从摘要猜原文，也不新增永久文件内容缓存。
- 继续 saved-only、权限下轮生效、现有独立 Diff 入口。工具升级不迁移 working owner、不新增确认 UI。
- host 的外部进程 compare → rename 竞争、ACL / xattrs 保留不足，以及跨平台未验收边界仍独立存在；新补丁协议不使它们自动消失。

上下文搜索避免照搬每行对象数组：当前引擎专门处理大量空行，8 MiB 输入可能包含数百万行。推荐逐行扫描或紧凑 offset 索引、候选检索复用与线性序列匹配，有界候选和独立扫描预算。保持源 / 结果 / 补丁 / 工作内存分别有界；提供可中断的增量扫描接口，周期性让出事件循环，由执行 owner 检查 deadline / abort；纯核心不引入文件系统或 Electron 依赖。不能只在同步全文件搜索外包一个无效的 timeout Promise。

## 9. 分批交付与完成标准

| 批次 | 交付范围 | 完成标准 |
| --- | --- | --- |
| 第一批：修改闭环 | 无数字上下文格式、双 adapter 共用引擎、EOF / 读取元数据、结构化错误、schema / 预算 / 可信身份接线、旧格式兼容与 no-op 结算 | 同一 fixtures 两来源结果一致；本次真实计数失败正文不再需要数字；多 hunk 后段失败零写入；旧契约不变；既有 journal / unknown / Diff 回归通过 |
| 第二批：真实任务验收 | 生产接线后的多模型文件修改任务对照；调整版本后重新冻结正式评测 | 第 9.1～9.4 节预注册样本、零安全否决、正确率 / 首次收益 / 成本门槛全部满足；记录完整但未达门槛仍未验收 |
| 第三批：搜索成本 | literal / regex 调用成本实验、过滤提前、结果预算对齐 | 在小目录 / 大目录 / 有命中 / 无命中 / Unicode / 取消下比较时延、进程数、读入字节、结果完整性与游标；根据测量决定启用方案 |

第一、二批共同构成文件修改优化的完成验收。第三批改善搜索成本，可独立交付；不将它作为修复格式错误的前置条件。freeform Provider、多文件批量事务、模型 `file.diff`、持久索引和共享 working 都不以本次方案完成为由宣称已实现。

### 9.1 开测前必须冻结的清单

先以不进入正式结果的 6 个合成任务校准 harness / oracle；其后提交不可变评测 manifest 与判定脚本，记录 hash。正式样本固定如下；增加 oldText/newText 等实验组属于另一个探索实验，不能在看见正式结果后改变本组分母。

| 正式 fixture ID | 独立任务数 | 任务范围 |
| --- | --- | --- |
| N01～N10 | 10 | 小范围注释 / 替换 |
| N11～N20 | 10 | 函数内多 hunk |
| N21～N30 | 10 | 重复块消歧 |
| N31～N40 | 10 | BOM / LF / CRLF / CR / mixed |
| N41～N50 | 10 | EOF / 空文件 / 追加删除 |
| N51～N60 | 10 | Unicode / 长行 / 大文件导航 |
| R01～R06 | 6 | 读后、提交前固定边界注入 revision 变化 |
| R07～R12 | 6 | 提交边界固定注入丢回执 / unknown，不向模型泄漏真实结算 |

每个独立 fixture 固定不同的源文件 / 目标，不用同一字符串换名字充当多个独立样本。每个任务做 3 次全新会话重复；两种模型 / Provider 组合分别跑 library / host 两个 scope，每格都有旧 unified / 新 context 两组，总计 `72 × 3 × 2 × 2 × 2 = 1,728` 次正式任务运行。故障 / no-op 不混入正常首次写入成功率；no-op 的完整消费者接线另由确定性回归验证。

模型 / Provider 组合预定为 OpenAI-compatible 的 `gpt-6.1-sol` 与一个实际可运行的 Claude messages 模型。Claude 的完整 model ID、两组档案 / endpoint 身份 hash、实际返回的 model ID、reasoning / thinking、temperature / seed（不支持则明确标注）、输出 / 上下文预算、权限模式、工具视图、系统提示词和 schema hash 必须在 manifest 中填定。当前文档未执行配置探测，Claude ID 尚未冻结，不能称正式评测已经具备开跑条件；不可用的格标“未验收”，不静默换模型或用另一个 Provider 代替。

每个 fixture 在模型运行前固定 before 字节、允许 scope / 路径 / 修改区域、确定性 expected after 或语义测试 / 结构不变量、故障注入点与正确终态。正常任务均可在单次 32k 以内 patch 完成，模型收到同样的单文件修改任务；最终判定不依赖模型自称完成。多种正确实现的差异由预先指定、隐藏组别的复核者按冻结规则判定，不能看见组别后改 oracle。

### 9.2 执行控制与分母

- 旧 / 新组只改变本方案规定的工具格式、说明、文本元数据与恢复反馈；其他工具、权限、初始上下文和模型配置相同。使用固定随机 seed `20261022` 排 AB / BA 顺序，逐任务重建原字节、独立 Session 和目录。
- 单次运行统一停止于 10 分钟、30 次工具调用或 20 次 Provider 轮次中的最早边界；耗尽记未完成。上述是评测成本边界，不写入产品的 Agent 调用限制。
- 开测前按 1,728 次运行估算并冻结费用 / tokens 总预算；超预算停止并保留“未验收”，不临时减少模型、scope、重复数或只补跑失败组。
- 每次正式尝试都保留。模型已经产生输出后的 Provider / 网络 / 存储中断记录为基础设施失败，不删除；已确认在发送任何模型请求前就未开始的计划格也留存原因。任一模型 / scope / 协议格超过 5% 的运行因基础设施中断无法形成有效终态，该格证据不足。正式门槛同时公布全尝试分母和基础设施分类，不能只展示剔除后的成功率。
- 两组均记录实际路线。首次指标要求该组第一次修改工具调用就是所属协议的 file.patch（旧组 unified、新组 context），并一次满足完整 oracle；先用 file.write / Shell、换协议或修正后成功，最多计入最终任务正确率。这里定义指标，不为产品增加调用禁令。

### 9.3 指标与通过门槛

以下门槛在开测前固定，不能用低成本抵消错误提交，也不能用最终正确掩盖大量失败恢复。

| 指标 | 判定与门槛 |
| --- | --- |
| 确定性正确性 | 第 5.3 节全部字节 fixtures、双 adapter / Registry / Provider / Broker / 持久化 / verify / 取消回归 100% 通过；任何失败均阻断第二批 |
| 首次修改即正确 | 两组按第 9.2 节的对称定义，用相同正常任务和全尝试分母核对所属协议的首次修改；未发起修改也记失败。仅被 parser 接受、只保存部分任务不算。每个模型 / scope 格新组 ≥95% |
| 首次收益 | 四格等权的正常任务首次正确率比旧组提高 ≥5 个百分点，按独立 fixture 配对的双侧 95% 区间下界 >0；未满足仅可报告观察值，不能宣布收益已证实 |
| 最终任务正确 | 正常任务停止预算内全部 oracle / 字节不变量 / 代码测试与真实提交态通过；新组每格的全尝试正确率 ≥95% |
| 任务退化容忍 | 每个模型 / scope 格分别计算正常任务最终正确率的新减旧差值；配对 fixture 重采样的双侧 95% 区间下界 ≥−5 个百分点。逐 fixture 保留三次计数和失败分类，盲审计数下降的任务；发现可复现的协议回归须修复后重新冻结，随机波动本身不作安全否决 |
| 恢复正确 | 12 个故障任务每次重复均满足冻结的恢复 oracle：版本变化保留并发内容；unknown 不盲重试 / 绕过 / 误报。全部通过；正确保留 unknown 是该故障的安全终态，不伪称任务已经写完 |
| 恢复调用成本 | 每个模型 / scope 格单独核对 36 次恢复任务，从注入到正确终态的额外工具 / 模型轮次分别计算：新组中位数不高于旧组，p95 最多增加 1 次。旧组未完成也按停止预算结算，另列双方均正确样本，不能只删掉失败任务 |
| 总成本退化 | 每个模型 / scope 格的正常任务和恢复任务分别验收：单任务总 tokens / 费用中位数各 ≤旧组 120%，端到端 p95 ≤旧组 130%；固定两组实际模型价格口径，缺 usage / 价格证据则费用项未验收。不能靠跨格或跨任务类别平均通过 |

“首次 patch 被接受”另作诊断指标，不等于首次修改正确率。格式、定位、歧义、预期版本拒绝、存储、预算、代码行为与基础设施错误分别统计；正确的版本拒绝不当作引擎错误。原组成本为零的指标不使用比值，按绝对零 / 相同停止预算比较。成本分位数固定用 nearest-rank：排序后取第 ceil(p × n) 项；中位数用居中一项或居中两项均值。算法和缺失数据处理与判定脚本一同冻结。

统计单位是独立 fixture，3 次重复不是 3 个独立任务；四格共享同一 fixture 时也共同归入一个 cluster。首次收益与最终正确性差值均采用按 fixture ID 配对、按六类正常任务分层的 cluster bootstrap：每层从原 10 个 fixture 有放回抽取 10 个，合计 60 个，保留全部重复和四格配对，10,000 次重采样，seed `20261022`；双侧区间取差值重采样分布的 2.5% / 97.5% nearest-rank 分位点。判定脚本在正式模型请求前经合成统计数据核验并冻结。零差异的零宽区间不能证明首次收益，仍不满足下界 >0。

这些区间只衡量固定基准在既定任务类别配比下对任务构成的敏感性；固定挑选的任务不是任意真实任务的随机样本，不能据此宣称真实任务退化率低于 5% 或没有回归。每 fixture 的三次计数下降用于定位和复核，不将它当作潜在真实退化事件来计算总体风险界。确定性安全用例与第 9.4 节否决项仍要求零失败。

若旧组接近满分而无法达到预定的首次收益，仍保留“安全基线通过 / 首次收益未证实 / 第二批未验收”；不能事后更改目标来宣布完成。后续更换任务集或目标只能建立新的预注册版本，并保留本次结果。

### 9.4 安全否决与结论状态

以下任一发生，相关新方案验收立即停止，保留证据；修复后重新冻结代码 / manifest，旧失败结果保留：

- 修改错误文件、scope 或重复代码块，破坏允许区域外字节，覆盖并发内容或人工草稿。
- 后段 hunk / EOF 策略失败仍发生部分写入，或 Diff / journal 与真实 after 不符。
- 把 no-op、uncommitted 或 unknown 升级成 committed；把已经提交的事实降级成未发生。
- unknown 后未核对就重写、换通道绕过，或以节点名称 / 存在状态代替正文提交证据。

确定性与工程接线全部通过且四格正式评测全部达标，才标第二批“已验收”；代码通过但模型尚未跑、配置未冻结、样本不足、收益 / 成本不达标或证据缺失，分别明确记录原因并保持“未验收”。“结果已记录”不再构成完成标准；只测一个模型或 scope 就只报告该范围，不能宣布全方案已验收。

没有同条件 Codex 运行数据，所有成功率与成本结论只比较 OmniFlow 旧 / 新工具链，不发布相对 Codex 的成功率结论。

实机使用非首 win / library 3 与本机 macOS MinIO；host 使用隔离合成目录。真实模型试验采用现有受支持运行链路，单独记录实际产生的调用成本；本次调研未执行。

## 10. 本轮实验与后续验证矩阵

调研阶段直接调用基线引擎的 10 个合成场景结果：

| 场景 | 当前结果 |
| --- | --- |
| 正确 unified 单处替换 | 成功 |
| 正文正确、行数多报一行 | `INVALID_PATCH` |
| 正文正确、新起点偏一行 | `INVALID_PATCH` |
| 正文正确、旧起点偏一行 | `PATCH_CONTEXT_MISMATCH` |
| 无尾换行源、未声明标记 | `PATCH_CONTEXT_MISMATCH` |
| 有尾换行源、相同补丁 | 成功 |
| 无尾换行源、完整声明两侧标记 | 成功并保留无尾换行 |
| 无数字 `@@` 正文 | 当前不支持，`INVALID_PATCH` |
| 第一 hunk 合法、后段错误 | 整体抛错、不返回 after；实验没有接入提交器 |
| BOM + 混合换行局部替换 | 成功，未修改字节保留 |

另以生产读取器确认 `old` / `old\n` 返回相同 content / lines / totalLines，仅 revision 不同。以上证明当前差距和已有字节保留能力，不证明尚未实现的新匹配器已经通过测试。

实施时必须覆盖：

- parser：空 / 非法正文、单 / 多 hunk、纯插入 / 删除、EOF、重叠 / 逆序、错误位置；旧缺省 format / expectedRevision 经真实 Registry 接受，context 缺必填字段拒绝，execute 入口诊断经真实 Provider result 投影保留。
- 定位：唯一命中、重复块、多 hunk 重复序列、相同行号提示不足、上下文尾空白容错、删除行 / 首缩进 / Unicode 标点不误归一；候选截断；不将后续函数中的相同行误认为函数名锚点所属内容。
- 字节：第 5.3 节全部精确预期（含未触及 EOF 的显式策略、真实空末行冲突、BOM-only 和零行例外）、LF / CRLF / CR / mixed、emoji / 组合字符、长行、数百万空行、8 MiB 源 / 结果及工作内存预算。
- 路由：library / host 相同 golden fixtures、相对路径 / basePath、原始参数与规范参数的审计、不同 scope 同名文件、@2 可信身份与伪造工具拒绝。
- 提交：多 hunk / EOF 冲突失败零写、revision 变化、library 条件冲突、host 身份替换、journal prepare 失败、提交后丢回执 / 取消、unknown 不重试、迟到成功不改 sealed 事实；no-op 经生产 Broker → ToolRun 持久化 → readOperationJournal → operation.verify（含 SQLite 重开）仍未提交，无变更记录；显式三态优先与冲突 / 缺失处理。
- 预算 / Provider：OpenAI-compatible 与 Claude 流式参数、换行 / 引号 / 反斜杠转义、正文和总 JSON 边界、超限不执行、上下文 prune 后恢复。
- 端到端：读 → 局部 patch → 继续用新 revision → 读回 / 编译验证 → Agent 独立 Diff；人工草稿保留、后台不弹恢复 Modal。

第一批已实现公共 context 引擎、双 adapter、可取消 main 快照重算、schema / Provider 预算、原始文本元数据、no-op 与全部提交态消费者。19 组共享字节 fixtures 覆盖了独立复核发现的 CR / LF 拼接吞行问题；生产接线测试包含真实 Registry / Broker / ToolRun SQLite 关闭重开 / 双 ID / operation.verify、在途 prepare 跨取消释放 lease，以及预算封存后的迟到结算不改 ToolRun。三个验收反例及真实 renderer no-op 取消接线已复验通过；入口预检失败现返回明确未提交的失败回执，使停止后的 Run 及同会话下一次启动及时收口，不耗尽 no-op 窗口，adapter 内提交态仍由原执行器负责。最终全量 lint / 7,091 项测试 / build / diff 检查通过，第一批工程验收关闭。macOS 非首 win / 本机 MinIO 与隔离 host 的先前 GUI 主链证据保持原范围，本轮入口竞争以确定性注入验证，未重做 GUI 或写资料库正文，完整范围见[验证矩阵](frontend-validation-matrix.md)。该合成 smoke 不证明模型成功率收益；第二批 manifest / 实际模型配置 / 费用预算与正式对照尚未冻结或执行，第三批搜索性能未实施。

## 11. 维护规则

实施时先更新本文的状态与已完成批次，再将真实契约迁回 `built-in-agent-file-write.md`、统一读取专题、Agent 架构和验证矩阵。Codex checkout 或 Provider 协议升级后重核证据；性能数字必须注明数据集与测量条件。本文保留决策依据，不长期堆积开发流水账。
