# AT0 Tool 契约与隔离运行时

更新时间：2026-09-22
状态：AT0 在 macOS 开发环境已验证完成；后续[AT1](plugin-system-at1-agent-tools.md)已完成真实模型与实际资料库核心验收。本文保留AT0阶段的边界和证据，当前Agent能力以AT1为准。

## 范围与决策

AT0 验证插件 Tool 能在无 Viewer 标签页时读取一个已授权文件、返回结构化结果并释放实例。AT1 再接入内部 Agent 的 Run 有效工具目录、会话范围、AI 目的地和 ToolRun 持久化。AT2 补完整故障验收；本阶段不改 Agent SQLite、不向模型发布实验工具。

- 旧 formatVersion 1 Viewer 包与 wire 1 继续兼容；formatVersion 2 新增 agentTools，允许只有 Tool 的包。npm SDK 0.3.0 与清单/wire 版本独立管理。
- 每个 Tool 独立 id/entry/inputSchema/outputSchema，首期 resource 参数固定为单个 nodeId，只读资料库普通文件。声明 resource.read 和 agent.tools，不与 directory.read 混合。
- Schema 为有界子集，禁止远程引用与任意表达式。宿主校验完整 input，插件仅得到本次调用的随机 ID、Tool ID、业务参数和临时资源句柄，不能取得原始 nodeId、Run 身份、URL 或凭据。
- 管理器分开保存读取批准与 Tool 批准，旧包升级不继承新增能力。AT0交付时对模型可见的注册尚未接入，批准仅用于隔离实验；后续生产入口与独立会话授权已由AT1接通。
- 共享来源路由、session 配额和撤销广播；Viewer 继续绑定 tab，Tool 绑定一次调用。不得复制第二套独立 RPC handler 或创建无上限 Tool 池。
- Tool 完成、报错、取消、超时、撤权、旧包替换和宿主销毁都进入统一释放；结果只接受一个终态，验证调用身份、输出 schema、字节上限及当前权限后交付。
- 新 Run 未来使用“内置贡献 + 已启用插件的冻结快照”，不向现有只追加 Registry 反复注册。快照绑定包指纹/Tool 定义，停用或换包后旧快照不能重新执行；Provider 名冲突在生成目录时拒绝。

## 本阶段不等同于 Agent 完整授权

实验入口只存在 Electron main 模块。宿主必须提供当前 resource authority、完整不可变调用绑定以及可重复执行的授权检查；没有插件可调用的 launch RPC，没有 renderer 或模型自报身份入口。调用绑定包含账号/后端/库/资源/Session/Run/ToolRun/AI 目的地身份，但这些字段本身不是授权证明。

AT1 必须在真实 Agent 适配器中实现并验证这些检查，再将入口接入生产 Run。不能用合成实验中的 always-true guard 替代会话目录策略，不能用一次未知工具确认的 opaque grant 扩大资源范围。来源审计须在 ToolRun 创建时保存，覆盖失败和取消；本阶段 main 返回的来源信息不冒充已持久化 ToolRun。

## 实现与协议

- `manifest.ts`、SDK schema 与 `tool-schema.ts`：格式 1 向后兼容；格式 2 每包最多 8 个 Tool，名称在插件命名空间内，Viewer/Tool 激活条件逐项匹配，所有入口都经过包路径与存在性检查。
- `PluginManager`：多运行时撤销广播、独立 `toolApproved`、安全模式、升级/回滚重批；随包 Tool 的批准额外绑定 fingerprint。停止订阅失败时继续通知其他运行时并隔离故障包。
- `plugin-tool-catalog.ts`：只读取包元数据形成冻结目录，与传入的内置 Tool 名一起检查 canonical/Provider 名冲突。注册身份包含包代码指纹，不导入插件 JS。
- `isolated-view.ts`：Viewer 与隐藏 Tool 使用同一沙箱、全进程来源路由、四槽 session pool 和全局加载/实例预算。初始化失败和外部 WebContents 销毁都走同一回收路径；宿主 dispose 还会取消尚未创建 view 的调用。
- `plugin-tool-runtime.ts`：一次性、main-only 能力绑定插件/代码版本/Tool、账号/后端/库/节点及 Session/Run/ToolRun/AI 目的地。按声明校验输入，将 resource 参数剥离后才交给插件。输出在 schema、大小、权限、版本复验后返回，来源 envelope 由 main 写入。
- `resource-broker.ts`：Tool 上下文独立于 viewerId；Tool 不提供 Viewer 的 state/settings 或目录 API。`tool.invocation` 取得业务参数，`tool.complete` / `tool.fail` 提交单终态；错误只接受固定 code，不透传插件任意异常为宿主错误。
- `samples/csv-tool`：同包 Viewer 与 Tool 共享纯 parser/读取模块。Tool 按列索引做精确字符串筛选，返回表头、总行数、匹配数、有界行和 truncated。重复/空表头允许，行宽不一致明确拒绝；没有表达式执行或数值聚合。

Tool timeout 由包在宿主上限 30 秒内声明；输入最多 16 KiB、输出最多 32 KiB。只有 tool.complete 的 RPC 信封可到 34 KiB，旧普通请求仍为 16 KiB。Schema 每份 8 KiB、深度 6、128 节点、64 个属性，字符串最长 4096、数组最多 256；禁止 $ref、pattern、组合 schema 与远程引用。实际输出同时受包申请和宿主上限限制。

Tool 实例一次调用结束即销毁，不写 Viewer 阅读快照，不共享运行中的 Viewer DOM。资源读取继续有 64 KiB 分块、32 MiB 总额、每秒 64 请求等原有约束。目录资源不能传入首期 Tool。安装索引最多 2 MiB，写入前也校验，以容纳有界贡献 schema；没有放宽包大小或实例内存上限。

## 验证与复现

- `node tools/plugin-isolation/build-independent.mjs csv-tool`：仓库外 SDK 打包、离线依赖安装与独立构建；在输出的 sample 目录运行 `npm run package` 得到 ZIP。
- `node tools/plugin-isolation/run.mjs --at0`：隔离临时 profile + 合成 UTF-8 CSV，创建两个共享来源路由的宿主。验证真实无可见 Tool 执行、旧 Viewer 同时运行、两类实例撤权、跨实例句柄拒绝、终态来源、取消回收、销毁 Tool 宿主后旧 Viewer RPC 继续可用。
- 单元测试覆盖清单兼容/Schema 限制、管理授权和目录碰撞、调用能力防伪/一次消费、读取/结果复验、取消/超时/迟到加载、初始化异常、外部销毁和结果预算。
- 只用合成资源，不使用真实模型、真实资料库或用户现有安装配置。管理页显示 Tool 批准入口与实验状态，真实用户操作验收留到 AT1 接线后进行；当前组件交互由定向测试覆盖。

2026-09-22 验证结果：

- 全量 2720 项通过、7 项跳过；lint、TypeScript 与生产构建通过。
- macOS 原生 Electron AT0 实验 17 项通过；原 C1 隔离回归 23 项通过；E1 漫画原生链路回归 11 项通过。均使用临时 profile 与合成资源，没有调用真实模型或读取用户资料库。
- CSV Tool 通过公开 SDK 完成中文筛选：3 条数据中匹配 2 条、limit=1 返回 1 条并标记 truncated；Tool 未挂到父窗口，旧 Viewer 同时存在，结束后运行计数和实例数归零。
- 独立产物与 SDK 位于忽略目录 `dist-plugin-kit/at0/`；其中包格式 2 样板需要本阶段新版宿主，旧宿主会拒绝安装。
- 未验收：真实用户管理页的新增 Tool 批准操作、发行包、Windows/Linux、真实 Agent 目录/权限/ToolRun 接线。应用未被本轮强制重启，也未在用户当前配置自动安装新 CSV Tool 样板。

## AT1 接续条件

下一批将冻结贡献快照与内置工具合成每个 Run 的有效目录，主进程适配器为实际 Session/Run/ToolRun、会话组范围、后端资源和 AI 目的地签发本阶段能力；把宿主来源字段在 ToolRun 创建时持久化。不得把工具名加入 opaque/external 放行分支，也不得用样板中的合成 guard 替代真实授权。真实模型验收必须证明无需先打开 CSV Viewer 即可查询，并核对失败/取消的来源与终态。

AT0 没有改动内部 Agent 的 append-only Registry 或会话数据库。冻结目录、运行时与调用能力已有实现；模型发现和持久化的 owner 保持原系统。
