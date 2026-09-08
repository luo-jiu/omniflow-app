# Agent 文件与正文搜索

更新时间：2026-09-08

## 当前能力

`file.search` 查名称和元数据；`file.grep` 查 UTF-8 正文。两者使用 `scope=library|host`，默认 library。host 必须显式提供本机路径，library 只访问当前资料库。工具不解释 Shell 管道，也不新增资料库挂载或任意 URL 执行入口。

## 文件名 Glob

内外共用 minimatch 9 的 matcher，支持 `*`、`**`、`?`、`[abc]`，忽略大小写并包含隐藏文件：

- `*.txt`：匹配任意层级的 `.txt` 文件名。
- `docs/*.md`：匹配查询目录下 docs 的直属 Markdown 文件。
- `docs/**/*.md`：匹配 docs 下任意深度的 Markdown 文件。
- 路径模式统一使用 `/`，不含 `/` 时按 basename 匹配，含 `/` 时相对查询 path 匹配。

不支持大括号展开、extglob、`!` 排除、绝对 glob 或 `..` 段；这些输入明确失败，不私自改写成另一种模式。模式长度最多 256 字符。`keyword` 保留原有名称包含查询，按扩展名筛选应使用 glob。

资料库复用现有 HTTP 元数据搜索，按候选页应用 glob，不修改后端 SQL 或 CLI。每页最多 100 个候选；匹配结果可能为空但 hasMore 仍为 true，此时不能判定整个范围不存在目标，必须使用 nextCursor。新的 glob 游标绑定 path、目录 ID、模式、关键词、类型、标签和资料库；筛选变化时拒绝续页。目录本身不算子树中的匹配条目。

本机沿用最多 5,000 项的有界目录扫描，先应用相同 matcher 再分页。目录大于该上限时明确失败并建议缩小范围或使用 Shell。不会绕过现有符号链接 / 特殊文件处理规则。

## 正文搜索

调用示例：

```text
file.grep(scope="library", path="/文档", glob="*.md", pattern="部署", limit=50)
file.grep(scope="host", path="/tmp/fixture", glob="**/*.txt", pattern="alpha", limit=1)
```

path 可以是单个文件或目录；目录按子树递归搜索。pattern 必须是最多 256 字符的单行字面文本，`|`、`.`、`*` 不解释成正则。`caseSensitive` 默认 true，false 使用统一的大小写转换匹配。每条结果代表一个匹配行，而不是同一行内每次出现。

`contextLines` 默认 1，允许 0 至 3；limit 默认 50，最多 100 条匹配行。结果包含 scope、path、matches、skipped、scannedFiles、scannedLines、skippedFiles、complete、hasMore 和可选 nextCursor / stopReason。

matches 包含文件路径、可用时的节点 ID、一基行号、匹配附近片段、内容 revision 和相邻上下文行。长行与上下文可能被裁短，分别以 textTruncated / truncated 标记；完整内容可通过 file.read 的行号和 revision 定位。搜索本身检查整条逻辑行，不因为展示片段较短就漏掉行尾匹配。

## 续搜与覆盖范围

- 单次最多读取 5 个文件、检查 20,000 行，目录候选页最多 10 页，并受 15 秒软扫描预算和 60 秒 Tool 超时约束；网络读取沿用原有取消和超时。
- 单文件沿用 8 MiB UTF-8 上限，复用正文授权、节点身份检查与 ETag 缓存。
- 匹配与错误条目采用约 8,000 字节输出预算；到达预算时返回续搜位置，不截断结果数组后跳过未交付命中。
- nextCursor 同时记录候选页位置、当前文件行号、版本、候选页指纹和累计跳过数量，并以 main 的进程内密钥签名。重启后失效；游标不是授权凭据，每次仍执行原有权限检查。
- 续搜文件内容或当前候选页身份变化时明确失败，不把不同版本拼接。目录分页是实时查询而非跨请求快照，已扫描范围之后发生的新增、移动或删除不能保证被追溯。
- 二进制、PDF、超限、离线或权限拒绝的文件列入 skipped，并累计 skippedFiles。即使 hasMore=false，只要有跳过文件，complete 仍为 false。后续页面不能丢失之前的不完整覆盖状态。

只有 complete=true 才能说本次查询范围已经全部检查。matches=[]、hasMore=true 表示尚未找到但还没搜完；matches=[]、complete=false 表示不能给出完整的无匹配结论。

## 权限与界面

本机正文搜索在 ask/auto 下使用现有一次性审批，预览显示递归读取范围、搜索文本和 glob；full-access 按既有 Run 权限执行。资料库复用当前 owner、窗口、资料库、Session、Run 和 ToolRun 的授权链，不绕过 API 读取对象。

结果继续走脱敏和上下文预算投影；若最终模型上下文不能完整交付 grep 页，明确失败，不能把未交付页的游标交给模型跳页。UI 使用无框工具行，区分“可继续”和“结果不完整”，不把本机路径生成为资料库跳转。

## 验证

自动化覆盖共享 glob、相对路径、隐藏文件、Unicode、非法模式、游标篡改和范围变化、空匹配续页、内外正文行号、上下文、文件版本变化、字面管道字符、二进制及离线跳过、跨页累计覆盖状态、长行片段、文件 / 行数预算，以及主进程 owner-bound 分发。

真实桌面验收使用非第一个 win 资料库和隔离文本。解锁后 gpt-5.5 已完成：host 的 `**/*.txt` 只返回 a.txt 与 nested/b.txt，排除 ignore.md；正文 alpha 以 limit=1 分三页命中 a.txt 第 1、3 行及 nested/b.txt 第 2 行，最终 complete=true、hasMore=false、skippedFiles=0；library 中 beta 命中隔离文本第 2 行。库内 glob 与 keyword 组合分页找齐两份 fixture，指定不存在文本的 grep 返回 0 匹配且明确覆盖完整。未读取真实用户文档、未调用 Shell、未写入；不可读文件、版本漂移和预算耗尽等边界仍以自动化为验收依据。

搜索实现时自动化结果：全量 1,949 项测试通过、7 项跳过，lint、TypeScript 与完整构建通过。后续模型适配回归为 1,958 项通过、7 项跳过。开发服务 `http://127.0.0.1:8849` 返回 HTTP 200；本轮实测只更新验收文档，没有变更代码或后端。
