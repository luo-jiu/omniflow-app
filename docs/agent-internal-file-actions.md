# Agent 内部文件操作

更新时间：2026-09-10。

## 当前能力

Agent 的内部文件工具直接使用资料库接口，不把逻辑路径当作本机路径。本轮补齐基础整理操作，复用已有创建、重命名、移动、删除及恢复接口，并新增独立复制和原子标签增删后端接口；没有表结构迁移。

| 操作 | Tool 与定位参数 |
| --- | --- |
| 浏览、搜索、属性、路径定位 | file.list/search/stat/resolve，沿用现有分页与路径约定 |
| 文本创建与修改 | file.write，修改必须携带 file.read 返回的 revision |
| 跨目录建目录 | directory.create：完整新目录 path，或 name + parentPath/parentId；仅 name 使用当前目录，无当前目录时使用根 |
| 重命名 | file.rename：path/nodeId 二选一，name 为含后缀的完整新名称 |
| 移动 | file.move：path/nodeId + parentPath/parentId，保留原名，同名报冲突 |
| 复制 | file.copy：path/nodeId + parentPath/parentId，可选副本 name；目录必须 recursive=true，冲突默认 error，可选 auto_rename |
| 删除 | file.delete：资料库 path 或已确认 nodeId，目录需要 recursive=true |
| 回收站浏览与恢复 | recycle.list 按 keyword 查询；recycle.restore 用实际回收站 nodeId 恢复原位置 |
| 标签 | tag.list 查询目录/节点标签；tag.update 按明确 addTagIds/removeTagIds 原子增删，保留其他关系 |

普通操作不提供覆盖语义，名称不得混用路径。多级新目录依次创建，父目录必须存在。恢复到原位置遇到冲突明确失败，不能自动永久删除冲突项。复制在原存储中生成独立对象，每次最多1000节点、1 GiB、后端120秒；它复制内容和目录结构，不复制标签、归档/展示配置或历史，源存储必须可达。复制和标签写入必须使用本轮新后端，不能把旧服务器的404误判为能力已经可用。标签细节见 [标签工具](agent-library-tags.md)，统一 UI 同步见 [节点变更同步](internal-node-ui-synchronization.md)。

`file.delete` 支持直接传绝对 path；使用 nodeId 时先通过 file.stat/file.resolve 或目录查询取得本轮已知节点。仅处理当前 Run 资料库，根目录禁止删除。普通文件直接移入回收站，文件夹必须明确 recursive=true。本工具不提供永久删除、清空回收站或本机文件删除。

删除只修改现有后端节点删除状态，不下载文件，也不删除 MinIO 对象，因此不要求文件所在存储当前可达。回收站恢复可通过系统入口或 Agent 工具完成。

## 权限与执行

- 使用既有 main Tool Registry、Run 冻结权限、renderer broker 与提交回执。移入回收站属于可恢复写操作；`full-access` 直接放行，`ask/auto` 使用标准工具确认。不会再弹出文件树自己的删除确认框。
- Renderer 收到 main 绑定的节点名称、类型、父目录、路径及修改时间。开始操作与收集后代后再次查询当前节点，拒绝跨库、移动、重命名、修改或类型变化。每次异步准备后检查 owner，提交前检查取消状态。
- 后端沿用现有权限和事务。客户端重验不等价于原子条件删除：元数据重验与 DELETE 之间仍有短暂并发窗口，未来若需要严格版本条件删除，应扩展后端契约，而非声称已有 CAS。
- 复用 `softDeleteNodeSubtree`：收集后代、执行提交前检查、请求后端、记录提交事实、清理草稿和 Viewer 恢复快照。后端成功即提交回执，不因随后取消、刷新失败或本地清理失败而反转成功。
- HTTP 明确拒绝返回 `uncommitted`；请求发出后连接中断等无法确定的失败返回 `commit_unknown`，提示核对原目录及回收站，禁止盲目重试。
- 新基础写工具共用 mutationCommitState 三态与 committing 阶段通知；file.write/file.delete 保留原兼容字段。完全访问直接执行可恢复操作，其他权限模式使用统一审批。两种路径定位在执行开始与提交前按 owner、library、父目录、名称、类型和版本复验；复制和移动禁止指向自身或子目录。后端复制与标签同步开放 HTTP/CLI/dry-run。
- recycle.list 与 tag.list 的正文JSON有字节上限，实际条目可少于 limit，nextOffset 按实际交付条数前进，revision 绑定快照和查询条件。回收站不输出存储 URL/key。计划 schema 的 toolName enum 从当前冻结业务工具生成，模型可选名称与运行时校验一致；没有用静态模型名单授予工具。

## 界面同步

删除事件带 account/backend/library 范围，由 FileViewerContext 通过现有 `closeTabByNodeId` 关闭预览并释放音视频资源，不新增 tab 状态 owner。发布后的目录刷新机制同时识别 `deleteCommitState=committed`，刷新父目录并标脏树快照；失败和未知结果不冒充成功。成功删除后清除 Run 旧节点感知，后续操作重新查询，避免继续使用已删除节点。

收集子树失败时沿用已有删除服务的尽力清理语义，明确报告本地清理不完整。结果不回传整个子树 ID 清单，避免大目录删除回执超出工具输出预算。

## 验证

已通过全量 2193 项测试（7 项跳过）、lint、TypeScript 和生产构建。随后补齐 renderer broker 提交阶段支持，22 项 broker 测试通过，覆盖删除提交中取消的结算，以及保留提交事实的同时交付晚到清理警告。专项另覆盖工具注册及参数、权限模式、猜测 ID/根目录/跨库/递归拒绝、节点变化、owner 变化、提交前取消、提交后取消、网络不确定结果、清理失败不反转提交、目录刷新条件和跨范围预览隔离、音视频释放。

2026-09-10 用户明确授权 win 资料库文件用于修改、删除测试后，已在真实桌面和 gpt-5.5 中完成以下验收；未启动或停止用户的后端。实验范围仅为 libraryId=3 的 `/agent-file-actions-qa-20260910/check.txt`，目录节点 18507，文件节点 18508。

| 场景 | 结果 |
| --- | --- |
| 列目录、创建目录、直接创建文本 | 通过，文件无需手动刷新即出现在树中 |
| 读取 revision、条件修改、重新读取 | 通过，预览及工具读回均为“第二版：修改成功” |
| 完全访问下删除单个已打开文件 | 通过，无额外确认，文件从树中消失、预览标签关闭，父目录保留 |
| 回收站恢复单文件 | 数据恢复通过，原内容保留；恢复后树刷新存在延迟，见下方问题 |
| 明确 recursive=true 删除整个测试目录 | 通过，目录及内容进入回收站，根目录查询不再返回目标 |
| 系统回收站恢复整个目录 | 通过，子文件恢复且内容不变；不是 Agent 恢复工具验收 |
| 询问模式拒绝删除 | 通过，审批记录 ask/denied，未重试或换工具，文件仍存在 |

真实 Run：读写 `2aa7e087-e8a7-4de9-a075-e47df450c038`；单文件删除 `0565548b-adc2-4731-8481-e45fb2515502`；递归删除 `8cad827e-c1e5-4aa8-8a5a-72a935a9db41`；拒绝删除 `322eefc4-d355-45c6-80e1-305393e86f44`。已用只读 SQLite 查询核对规范 ToolRun 的 completed/allow 与 failed/ask/denied 记录，不只依据模型回答。结束时恢复原完全访问设置，测试目录及文件保留在资料库中。

## 后续批次验收

- 已修复两个回收站页面的即时同步：恢复后读取真实节点父目录并广播，已提交写入不会因同步失败而反转。删除清理树 selection、anchor 和页面上下文，重命名同步预览标题但保留正文和媒体 owner，移动通知新旧父目录。
- 真实 gpt-5.5 / win 3 的 Run `96e08c1b-676d-47b5-8711-6ce10d8c6e2d` 完成跨目录创建 `/文档/agent-organize-qa`、将原测试文件改名为 renamed-check.txt 并移入该目录、读回核对和两边目录查询。预览标签改名且正文仍为“第二版：修改成功”，没有重开文件或执行 Shell。
- Run `3df850f9-a7d6-4216-8741-23eb8a0ead2a` 完成 file.delete(path) → recycle.list(keyword) → recycle.restore(nodeId) → file.read/list。恢复文件无需切换工作区即回到已展开目录，旧选择上下文已清除，预览已关闭。全部规范 ToolRun 均 completed/allow；两个 Run 均完成了合法的计划登记。
- 最终保留文件 `/文档/agent-organize-qa/renamed-check.txt`（节点18508），原测试目录为空。没有触碰其他用户文件，没有重启用户后端。
- 前端全量2258项测试通过（7项跳过），lint、TypeScript及生产构建通过；后端全量 go test ./... 和 CLI 构建通过。复制和原子标签接口尚未加载到正在运行的旧后端，实机写入联调待用户重启后端后进行。自动化覆盖其独立副本、冲突、权限、dry-run、回滚及提交不明语义，不能冒充真实对象存储验收。

仍保留的边界：不提供永久删除工具、跨库移动/复制、自动创建多级目录、标签定义创建/删除或旧格式文档转换。本轮集中完成当前资料库的基础管理能力，不把这些扩展混入普通文件操作。
