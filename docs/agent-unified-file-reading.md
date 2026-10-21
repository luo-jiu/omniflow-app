# Agent 统一文件读取

更新时间：2026-10-21

## 当前能力

文件工具使用 `scope=library|host`，默认 library 不变。library 接受绝对或相对 path；相对路径以显式绝对 basePath，或 Run 当前目录的权威 path 为基准，`..` 不得越过 `/` 根。host 相对 path 必须显式提供当前平台绝对 / `~/` basePath，缺失即失败，不使用 `process.cwd()`；绝对 path 不依赖 basePath，但传入的 basePath 仍须合法。路径命名空间不根据文件是否存在自动猜测，不把资料库路径当作本机路径。

main 在 accessGuard / assess 前一次规范化并冻结 canonical input、移除 basePath；prepare、execute、renderer executor 和私有快照复用同一目标，不暗换 scope，也未新增稳定 resource ref。

- `file.list`：列出一层目录，默认 50 条、最多 100 条。
- `file.search`：在路径子树按名称字面包含、glob 和类型筛选；不区分大小写，不搜索正文，不解释正则或管道。
- `file.stat`：元数据；资料库可附带存储健康观察，不代表正文已读。
- `file.resolve`：精确路径定位；调用 read/list 时不是必要前置步骤。
- `file.read`：已保存的 UTF-8 正文，返回带行号的结构化文本片段。
- `file.grep`：按单行 literal 或 `mode=regex`（`rust-regex-v1`）搜索已保存正文，两 scope 共用 include / exclude Glob，返回路径、Unicode 行列、上下文和有界续搜游标。完整契约见 [文件与正文搜索](agent-file-search.md)。

资料库 ID、directoryId 和标签只属于 library，不透传给 host。资料库仍通过 renderer authority 和 HTTP 读取数据库；本机在 Electron main 读取，两者不经过 Shell 命令拼接。

`file.read` / `file.grep` 均只读取权威 saved 内容：library 从资料库当前存储绑定读取，host 从本机文件系统读取。它们不读取 TextViewer 的未保存 buffer 或 DraftStore，不会因文件已在编辑器打开而换成草稿，也不会顺带保存草稿。当前 read / grep 没有可选择 `view=working` 的输入；共享工作副本仍属后续设计。

## 正文契约

输入：`scope`、`path`、`basePath`、`offset`、`column`、`limit`、`revision`、`maxOutputTokens`。

offset 为一基行号，默认 1；column 为一基 Unicode 字符位置，默认 1，不是 UTF-16 下标或字节位置。省略 limit 时从指定位置尽量读到末尾；提供 limit 时按模型主动指定的行数读取，不再有默认 200 行或最多 2,000 行的限制。

输出包含 `scope/path/fileName/revision/offset/column/content/totalLines/endLine/hasMore`。content 使用 `L行号: 文本` 的紧凑格式；长行续读使用 `L行号:列号: 文本`，不再把逐行 JSON 数组传给模型。存在剩余内容时附带 `nextOffset/nextColumn`，这些字段仅用于模型续读，不显示成 UI 的“可继续”。内容 hash 变化时拒绝续读，不能拼接不同版本。CRLF/LF/CR 统一为逻辑行，文件末尾换行不产生多余空行。

长行只交付可容纳的字符，下一页从该行剩余 column 开始，不跳过中段。最终模型上下文不足以完整交付正文页时终止本轮并说明未交付，不能使用截断后的 nextOffset；这不同于 Shell 日志保留头尾的显示策略。

## 边界与授权

- 单文件上限 8 MiB，UTF-8 严格解码；二进制控制内容及 PDF 不作为正文返回。不支持自动 Office/PDF 解析、OCR 或字符集猜测。
- 本机复用安全打开普通文件的 helper：拒绝最终路径符号链接、特殊文件及多硬链接，打开和读取后检查文件身份。路径的中间目录可能存在正常的系统链接，此实现不是 OS sandbox。
- host 操作在 Run 冻结的 full-access 下允许，ask/auto 进入现有一次性审批；library 读取仍受当前用户、资料库、窗口、Session、Run 和 ToolRun 绑定。
- 资料库正文复用 stage-library-node authority 获取短期 URL，不产生 workspace staging 文件；下载限制 8 MiB，取消和超时会结束读取，读取后重新检查授权及节点身份，工具额外检查路径未漂移。
- 资料库正文具有 main-only 的 Run 内有界缓存：按 owner、窗口、资料库、Session、Run 和节点隔离，最多 16 项 / 16 MiB，原始 entry 创建后 60 秒过期，Run 结束主动释放。仅强 ETag 可以缓存；续读重新取得授权，以 `If-None-Match` 条件 GET 访问源存储。304 复用正文，200 重新读取；禁用 Chromium 隐式 HTTP 缓存。没有 / 弱 ETag 时退回完整读取，离线、拒绝访问或身份漂移时废弃缓存并报错，不把旧内容伪装成在线读取。
- 条件 GET 在等待响应前持有本次读取的原始字节引用；期间 TTL 到期或其他读取触发配额淘汰会立即解绑缓存，但不破坏这次已开始的读取。收到 304 后仍复核来源身份和授权，且不会恢复已淘汰的缓存条目。
- 已解码逻辑行数组由同一 raw entry 持有，共享上述条数、TTL 和 16 MiB 权重配额，不另建跨 Run 内容缓存。每次命中先算原字节 SHA-256，返回 bytes 被调用方改写时不能命中或污染缓存；派生数组只读。派生权重保守估算 UTF-16 backing 与行对象 / 数组，超额时仅保留 raw，继续正常解码；不是精确 V8 heap 计量。200、撤权 / 读取失败、身份变化、TTL 与 Run 释放同时使派生状态失效。
- URL、存储对象键和凭据不返回模型；正文仍通过既有 Tool 结果脱敏管线。正文是不可信内容，不授予工具权限。

本机 `file.search` 的 file-only 递归搜索用随包 rg 枚举最多 5,000 个文件候选，按该查询的共同 Glob / keyword 筛后并发取元数据；grep 的 Glob 当前在候选元数据后、正文前过滤。资源缺失时用 JS 等价枚举。单层 list / 混合目录搜索保留 5,000 条目边界，不递归符号链接。续页仍重新枚举，游标绑定查询和匹配元数据指纹，变化后拒绝，不伪装成完整结果；详见[搜索专题](agent-file-search.md)。

## 输出预算

内部目录元数据最多 100 条、24,000 UTF-8 字节。renderer 收到超大页面后保持原游标和筛选条件，内部减半 limit 重查，返回实际交付页对应的 nextCursor；不直接截断条目数组后复用原页游标。最多从 100 缩到 1，不无限重试。

正文与文件元数据的单次模型投影上限为 10,000 tokens，仍受当前上下文剩余量限制。本机目录按约 20,000 字节条目预算打包续页。

正文采用 Codex unified_exec 的默认 10,000-token 输出预算与 1 MiB 输出硬边界，不保留独立 6 KB 分页。main 在执行前传入可用的续接预算；读取后将真实结果 envelope 按现有模型投影计数打包，超限时在内存中寻找可交付范围，不重新下载文件或让模型猜 limit。maxOutputTokens 可请求更大值，但当前运行时单次模型策略仍封顶 10,000，且受真实剩余预算约束。输出 tokens 是预算估算，不是精确 tokenizer 计数；源文件 8 MiB 下载/解码边界与正文输出预算是两件事，本轮未修改前者。

成功的 file.read 时间线只显示“已读取 文件名.后缀”，无完整路径、无“可继续”、无单条展开箭头或详情 DOM；旧记录同样如此。失败原因和必要审批继续显示，搜索及元数据检查的详情不受影响。读取分组仍可展开查看文件名列表。

## 尚未实现

这不是资料库 FUSE 挂载或 Shell 管道解释器。`file.grep` 已在两 scope 支持默认 literal 与 `rust-regex-v1` 正则，以及共同 include / exclude Glob；PCRE2、lookaround、backreference、跨行或复杂管道仍超出该工具契约。本机需要这些能力时可使用现有 Shell。

grep 候选在 host 使用受限原生目录枚举、library 继续元数据分页；正文完整安全读取、hash 和解码后形成有界快照，再经 stdin 交给 rg。rg 不直接读整树正文或下载对象存储。没有 rg 时 literal 等价回退并返回 warning，regex 明确不可用。`ignoreMode` 只支持 `none`，不自动遵循 `.gitignore` / `.ignore`。当前没有全文索引、原生 Glob 目录剪枝或流式正文扫描。

首次读取、缓存失效或没有强 ETag 时完整读取最多 8 MiB，再切片；缓存有效且源返回 304 时无需再次传输正文，并可复用 decoded 行数组。尚未实现 Range 续读、磁盘 / 字节偏移行索引或全文索引，续读仍有 hash、前后权限、元数据与条件请求开销。

## 验证

本次增量定向测试覆盖 decoded 复用与相同长度版本变化、可变返回 bytes 防污染、前后授权 / 撤权、无 / 弱 ETag、不跨 Run、配额拒绝派生、TTL / Run 释放。随包 rg 接线后重跑同一合成 CPU 基准（同搜索专题命令）：1,500,000 UTF-8 bytes、50,000 行混合 Unicode / CRLF，旧 hash+validate+decode+split 平均 4.33ms（116 样本），命中后的 hash+行复用 0.44ms（1,128 样本，9.77 倍）；缓存入账权重 8,700,128 bytes。该 CPU 项不调用 rg，不含网络或真实 authority 延迟，不能将此倍数套到端到端读取。最终全量 lint、534 文件 / 6,632 项测试及完整构建通过；解锁后的实机链路与剩余未验项见[验证矩阵续批](frontend-validation-matrix.md#路径性能与后台-diff-续批)，下列较早证据属于前一批次。

2026-10-21：本轮全量 lint、6,570 项测试（7 项跳过）与完整构建通过。macOS 第三个 win 资料库真实 Agent 读取→patch→读回通过：人工编辑器有第三行未保存草稿时，Agent 只读到已保存的 2 行，保存后人工草稿仍受保护。具体环境和 Diff / 恢复条验收见[验证矩阵](frontend-validation-matrix.md#agent-内外文件工具与独立-diff2026-10-21)。新 regex / rg snapshot / include / exclude 的真实桌面验收仍待补齐；下列早期读取验收保留为对应行为的历史证据，不代表本轮全部实机路径已通过。

读取预算与精简展示调整后：1,973 项测试通过、7 项跳过，lint、TypeScript 和完整构建通过。自动化确认 3,000 行可在默认预算下一次交付，显式行数可超过 2,000，小上下文仍能打包完整 envelope。真实 gpt-5.5 在非第一个 win 资料库的隔离测试中仅调用一次 file.read，不传 limit/offset/maxOutputTokens，读完 2,400 行，content 20,504 字符，hasMore=false，首尾标记正确；成功行只显示文件名且没有详情展开。首次模型请求遇到供应商过载，重试后成功，未把该过载当作读取失败。

单测覆盖内外相同行契约、长 Unicode 行无损续读、文件变化、空文件、非法范围、二进制与超限、取消、内部读取后重新授权、节点身份漂移、主进程 owner 绑定、host 权限模式及目录游标漂移；内部超大页自动缩页使用原游标重试。UI 沿用紧凑工具行，本机路径不生成资料库定位动作。

2026-09-08 验收：1,939 项测试通过、7 项跳过，lint、TypeScript 和完整构建通过。额度问题解除后，真实 gpt-5.5 已完成本机及非第一个 win 资料库的三行隔离文本续读，正确携带 offset/column/revision，没有调用 Shell 或读取其他文档。

首次内部验收暴露上传返回 basename 缺少扩展名，导致一次错误路径读取与额外 stat。现在 file.upload / file.publish 在提交后尽力读取新节点规范路径，返回完整 displayName 和 path；查询失败仍保留 committed 事实，不能因此重传。修复后实测仅有 file.upload + file.read + file.read 三次调用，自动改名路径 `/omniflow-unified-read-qa (1).txt` 正确，两份隔离 fixture 节点 18499 / 18500 保留供检查。

自动化验证同一 Run 两次读取的正文传输由 5 + 5 字节变为 5 + 0 字节，同时保留四次前后授权；还覆盖相同长度内容变化后旧 revision 拒绝、403、离线、不跨 Run、字节配额、TTL 与 Run 释放。真实 MinIO 下的正文变化 / 离线故障注入和实际网络字节采样尚未完成，不能把 mock 传输计数当作真实网络测量。本轮未修改后端或新增 IPC 通道。开发服务继续使用 `http://127.0.0.1:8849`。
