# Agent 文件与正文搜索

更新时间：2026-10-21

## 当前能力

`file.search` 查名称和元数据；`file.grep` 查 UTF-8 正文。两者使用 `scope=library|host`，默认 library。host 必须显式提供本机路径，library 只访问当前资料库。工具不解释 Shell 管道，也不新增资料库挂载或任意 URL 执行入口。

`file.grep` 两端共用 literal / regex 匹配、include / exclude Glob、行列与续搜契约，只搜索权威已保存正文；不读取编辑器未保存 buffer 或 DraftStore。正文仍逐文件安全读取后搜索有界快照；host 的文件候选现使用原生 rg 枚举，未绕过读取身份校验，也没有全文索引。

路径与其他 file 工具复用同一 main resolver：library 相对路径以显式 basePath 或 Run 当前目录为基准；host 相对路径必须有明确绝对 / `~/` basePath，不使用进程 cwd。scope 不因查无文件自动切换，规范路径在权限判断前冻结；详见[统一文件读取](agent-unified-file-reading.md)。

## 文件名 Glob

内外共用 minimatch 9 的 matcher，支持 `*`、`**`、`?`、`[abc]`，忽略大小写并包含隐藏文件：

- `*.txt`：匹配任意层级的 `.txt` 文件名。
- `docs/*.md`：匹配查询目录下 docs 的直属 Markdown 文件。
- `docs/**/*.md`：匹配 docs 下任意深度的 Markdown 文件。
- 路径模式统一使用 `/`，不含 `/` 时按 basename 匹配，含 `/` 时相对查询 path 匹配。

不支持大括号展开、extglob、`!` 排除、绝对 glob 或 `..` 段；这些输入明确失败，不私自改写成另一种模式。模式长度最多 256 字符。`keyword` 保留原有名称包含查询，按扩展名筛选应使用 glob。

资料库复用现有 HTTP 元数据搜索，按候选页应用 glob，不修改后端 SQL 或 CLI。每页最多 100 个候选；匹配结果可能为空但 hasMore 仍为 true，此时不能判定整个范围不存在目标，必须使用 nextCursor。新的 glob 游标绑定 path、目录 ID、模式、关键词、类型、标签和资料库；筛选变化时拒绝续页。目录本身不算子树中的匹配条目。

本机递归且 `nodeType=file` 的搜索（包括 grep 候选）使用私有 `rg --files --hidden --no-ignore --no-follow --null --no-config` 枚举，最多 5,000 个文件候选、4 MiB 路径输出、5 秒枚举预算，最多 4 个并发枚举进程。`file.search` 自身的公共 Glob / keyword 在 JS 中筛选后，最多 8 路并发读取命中文件的元数据，不转成 rg `-g`。grep 当前未向候选查询传递 Glob：其 glob / include / exclude 在候选元数据取得后、正文读取前过滤，因此不享有文件名搜索的过滤前元数据开销收益。路径范围、重复结果、严格 UTF-8、根身份和命中父目录 canonical path 均复验，符号链接 / 特殊文件不成为可读正文。

缺少 rg 时使用等价 JS 文件枚举，保留共同筛选、排序和游标指纹；兼容遍历另有 50,000 项目录条目预算。权限 / 进程失败、超时、超限或部分原生输出明确失败，不改用旧结果冒充完整。单层 list 与需要目录的混合搜索仍使用原有 5,000 项条目扫描。每页都会重新枚举并对排序后的匹配元数据求指纹，变化后拒绝旧游标；没有缓存整棵目录，也不保证跨页原子快照。

## 正文搜索

调用示例：

```text
file.grep(scope="library", path="/文档", glob="*.md", pattern="部署", limit=50)
file.grep(scope="host", path="/tmp/fixture", glob="**/*.txt", pattern="alpha", limit=1)
file.grep(scope="library", path="/文档", mode="regex", regexProfile="rust-regex-v1", include=["**/*.md"], exclude=["archive/**"], pattern="部署|发布")
```

path 可以是单个文件或目录；目录按子树递归搜索。pattern 必须是非空单行文本，最多 256 个 Unicode 字符，不含换行或 NUL。`mode` 默认 `literal`，此时 `|`、`.`、`*` 都按字面匹配；`mode=regex` 使用 `rust-regex-v1`，可省略同值的 `regexProfile`，不支持 PCRE2、lookaround、backreference 或跨行匹配，非法正则明确失败。`regexProfile` 不能用于 literal 模式。

`caseSensitive` 默认 true。false 时 literal 继续使用两端相同的 ECMAScript lowercase，regex 使用 Rust Unicode simple fold；两种模式的大小写规则不能混称为同一种。每条结果代表一个匹配行，只给出该行首个匹配位置，不返回行内全部 occurrences。

`include` / `exclude` 各接受最多 16 个 Glob，使用上述共同 minimatch 规则，不直接转换成 rg 原生 `-g`。include 为空或省略时不限制，否则任一命中即保留；exclude 任一命中即排除；旧 `glob` 是附加的 AND 条件。两端当前只支持 `ignoreMode=none`，包含隐藏文件，不自动读取 `.gitignore` / `.ignore`；不支持的 ignore mode 明确失败。

`contextLines` 默认 1，允许 0 至 3；limit 默认 50，最多 100 条匹配行。结果包含 scope、path、matches、skipped、scannedFiles、scannedLines、skippedFiles、complete、hasMore 和可选 nextCursor / stopReason，并明确返回 engine、matchProfile、caseFold、ignoreMode、warnings、coverage 和 limits。

matches 包含文件路径、可用时的节点 ID、一基行号、column / endColumn、textColumn、匹配附近片段、内容 revision 和相邻上下文行。column / endColumn 按原始行的一基 Unicode code point 计数，endColumn 为 exclusive；textColumn 标记展示片段的起始列。长行与上下文可能被裁短，分别以 textTruncated / truncated 标记；完整内容可通过 file.read 的行号和 revision 定位。搜索本身检查整条逻辑行，不因为展示片段较短就漏掉行尾匹配。

## Matcher 与快照边界

两 scope 使用同一 main rg resolver，平台层只解析随应用提供的固定资源：`@vscode/ripgrep` 精确固定 1.18.0，对应 rg 15.0.0。开发 / 构建阶段按 lock 中目标平台 tarball 与 SHA-512 准备资源，运行时不安装或下载，也不查 PATH、其他 App 或用户 Shell。macOS 资源含 arm64 / x86_64 两片，打包置于 ASAR 外并纳入签名；路径、许可与跨平台接线见[桌面平台](desktop-platform-architecture.md#43-agent-随包-ripgrep)。可用路径短缓存 10 秒，缺失缓存 1 秒。

主进程先沿候选分页、安全打开 / 授权读取、hash 与 UTF-8 解码链路取得正文，再把本次行数预算内的快照经 stdin 交给匹配 adapter。匹配使用固定参数数组和 `shell:false`，包含 `--json --no-config --engine=default --encoding=none --no-multiline`；即使 binary 编译了 PCRE2，也不开放该引擎。模型不能指定 adapter 的可执行文件、原生参数或让正文 matcher 直接读取路径。UTF-8 已由公共读取器验证，关闭 rg 的二次解码也保留续页开头的 BOM 字符。

原生候选枚举和 stdin 正文匹配是两条私有能力；权限检查、正文安全打开、完整读取 / hash、对象存储访问仍由既有 adapter 承担。当前未实现 rg 直接扫描整树正文、流式文件读取或 WASM matcher。随包资源损坏 / 缺失或测试显式模拟无 rg 时，literal 等价回退到内置 `literal-v1` 并返回 `engine=literal-fallback` 与 warning；regex 返回 `UNSUPPORTED_CAPABILITY`，不悄悄降级为字面匹配。取消、超时与内部输出超限会结束 rg 子进程；搜索失败保留 skipped / code 与不完整覆盖标记。

## 续搜与覆盖范围

- 单次最多读取 50 个文件、检查 20,000 行，目录候选页最多 10 页，并受 15 秒软扫描预算和 60 秒 Tool 超时约束；网络读取沿用原有取消和超时。小文件扫描不再每 5 个文件强制一轮工具往返，匹配条数和输出字节预算保持不变。
- 单文件沿用 8 MiB UTF-8 上限，复用正文授权、节点身份检查与 ETag 缓存。
- 匹配与错误条目采用约 8,000 字节输出预算；到达预算时返回续搜位置，不截断结果数组后跳过未交付命中。
- nextCursor 同时记录候选页位置、当前文件行号、版本、候选页指纹和累计跳过数量，并以 main 的进程内密钥签名。查询绑定 scope、路径、pattern、mode / regexProfile、大小写、glob / include / exclude、ignoreMode 与上下文行数，续搜不得改变这些条件。重启后失效；游标不是授权凭据，每次仍执行原有权限检查。
- 续搜文件内容或当前候选页身份变化时明确失败，不把不同版本拼接。目录分页是实时查询而非跨请求快照，已扫描范围之后发生的新增、移动或删除不能保证被追溯。
- coverage 附带 `candidateEnumeration` 和应用层 `candidateMetadataReads`，区分原生 / 兼容候选和资料库查询；此计数是 describe 调用，不包含 rg 内部 I/O、根身份复验或 realpath 的系统开销，不能用作总 syscall 统计。
- 二进制、PDF、超限、离线或权限拒绝的文件列入 skipped，并累计 skippedFiles。即使 hasMore=false，只要有跳过文件，complete 仍为 false。后续页面不能丢失之前的不完整覆盖状态。

只有 complete=true 才能说本次查询范围已经全部检查。matches=[]、hasMore=true 表示尚未找到但还没搜完；matches=[]、complete=false 表示不能给出完整的无匹配结论。

## 权限与界面

本机正文搜索在 ask/auto 下使用现有一次性审批，预览显示递归读取范围、搜索文本和 glob；full-access 按既有 Run 权限执行。资料库复用当前 owner、窗口、资料库、Session、Run 和 ToolRun 的授权链，不绕过 API 读取对象。

结果继续走脱敏和上下文预算投影；若最终模型上下文不能完整交付 grep 页，明确失败，不能把未交付页的游标交给模型跳页。UI 使用无框工具行，续搜状态仅保留在结果中，不显示“可继续”；无法完整覆盖仍明确标记，不把本机路径生成为资料库跳转。

## 验证

本次性能增量已通过定向自动化：原生 / JS 枚举等价、隐藏 / Unicode / 符号链接、过滤后元数据计数、游标变化、原生部分输出 / 错误不静默降级、取消 / 超时 / 数量预算，以及 50 文件续页的累计覆盖。最终全量 lint、534 文件 / 6,632 项测试及完整构建通过；本轮真实模型完成 host 相对路径 read→patch→read，解锁后随包 regex 携带 include/exclude 的桌面补验通过，详见[验证矩阵续批](frontend-validation-matrix.md#路径性能与后台-diff-续批)。下列较早的全量 / 实机记录属于前一批次。

可复现合成基准：`npx vitest bench --run electron/service/agent/agent-file-performance.bench.ts`。macOS、默认随包 rg 15.0.0、暖文件系统缓存，2,010 文件 / 100 目录、10 个 Glob 命中：旧顺序 metadata→filter 平均 25.95ms（20 样本），新原生候选→共同 filter→有界 metadata 平均 11.39ms（44 样本，2.28 倍）；应用 describe 调用从 2,111 降到 11，筛除 2,000 个文件。新方案另做根身份复验且 rg 有内部扫描开销，该数字不是总文件系统操作数。基准仅代表 `file.search` 文件名过滤样本，不能套用到 grep 候选；每页仍重枚举，网络 / 深目录 / 大文件 / 跨平台性能没有由此验收。

随包增量的 6 文件 / 32 项测试通过，TypeScript 与相关 ESLint 通过。真实二进制已在 PATH 清空时完成注册表 `file.grep` 的 host 枚举、Unicode regex、include / exclude、隐藏文件与忽略规则验证；独立资源布局夹具在实际 app.asar 旁执行该 binary，并确认 macOS 两片架构。Windows x64 与 Linux x64 / arm64 资源完成锁定归档校验和制备，未在这些系统执行。本轮未签名或生成完整发行包，也没有新增真实模型桌面结果。

2026-10-21：本轮全量 lint、6,570 项测试（7 项跳过）与完整构建通过。新 regex / rg snapshot / include / exclude 的真实桌面验收仍待补齐，不能沿用下列早期字面搜索实测结论；本轮已验范围见[验证矩阵](frontend-validation-matrix.md#agent-内外文件工具与独立-diff2026-10-21)。

自动化覆盖共享 glob、两 scope 的 include / exclude、literal / regex、Unicode 列位置与大小写、非法正则、rg 缺失时的等价 literal 回退 / regex 不可用、rg 取消及输出预算，以及相对路径、隐藏文件、游标篡改和范围变化、空匹配续页、内外正文行号、上下文、文件版本变化、字面管道字符、二进制及离线跳过、跨页累计覆盖状态、长行片段、文件 / 行数预算和主进程 owner-bound 分发。

真实桌面验收使用非第一个 win 资料库和隔离文本。解锁后 gpt-5.5 已完成：host 的 `**/*.txt` 只返回 a.txt 与 nested/b.txt，排除 ignore.md；正文 alpha 以 limit=1 分三页命中 a.txt 第 1、3 行及 nested/b.txt 第 2 行，最终 complete=true、hasMore=false、skippedFiles=0；library 中 beta 命中隔离文本第 2 行。库内 glob 与 keyword 组合分页找齐两份 fixture，指定不存在文本的 grep 返回 0 匹配且明确覆盖完整。未读取真实用户文档、未调用 Shell、未写入；不可读文件、版本漂移和预算耗尽等边界仍以自动化为验收依据。

搜索实现时自动化结果：全量 1,949 项测试通过、7 项跳过，lint、TypeScript 与完整构建通过。后续模型适配回归为 1,958 项通过、7 项跳过。开发服务 `http://127.0.0.1:8849` 返回 HTTP 200；本轮实测只更新验收文档，没有变更代码或后端。
