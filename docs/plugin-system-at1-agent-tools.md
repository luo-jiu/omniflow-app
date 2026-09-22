# AT1 内部 Agent 插件 Tool 接入

更新时间：2026-09-22
状态：AT1 macOS 核心范围已验证完成；后续AT2已完成既定故障与离库清理验收；长时间性能、发行包与其他平台仍单列。

## 范围

在 AT0 隔离执行底座上，让内部 Agent 在每个新 Run 中发现并调用已启用、已批准的单文件只读插件工具。首个样板沿用同包 CSV Viewer + Tool，查询不要求打开 Viewer 标签页。后端 API、插件写入、任意网络、目录 Tool 和内置 Skill 插件化不在本批范围。

## 实施边界

- Run 开始前从管理器读取有效插件快照，与原内置 Tool snapshot 组合；不向全局只追加 Registry 注册动态包。原内置 prepared capability 的 seal/execute 继续委托原 snapshot，已有 Shell 与写入工具语义保持。
- 包更新、停用或撤权影响新 Run 目录；旧 Run 固定注册身份，但每次实际读取/结果交付仍复验包授权和指纹，不能借旧快照保留访问权。
- Guard 只根据主进程冻结的 pluginSource 精确识别插件，固定解析 resource.nodeId 为普通文件。读取前后检查当前库、会话目录及祖先链；已有 opaque grant 不扩大插件权限。
- 主进程执行闭包固定当前 ToolRun、Run、Session、sender、账号/后端、库、文件和 AI 目的地；输入和来源必须匹配冻结调用。更换 AI 配置或 owner 生命周期结束后拒绝继续交付。
- 新资源桥复用既有 AgentFileAuthorityBroker，以 main 绑定请求从可信 renderer 取得后端授权节点和签名 URL。URL只在主进程使用，限制存储 origin、对象路径、无重定向、Range和强ETag，初次及读取/结果复验都可取消；不修改现有 file.read 的8MiB正文/缓存契约。
- ToolRun 创建时保存 pluginId、pluginVersion、packageFingerprint、toolId、registrationId。读取范围审批前即留下来源；取消或失败也能追溯。来源是审计事实，不是权限证明，插件 input/result 同名字段不能提升为可信来源。
- SQLite 通过既有Coordinator幂等增加 plugin_source_json，schema标记保持2，保留旧历史。来源列不可变，损坏/未知历史来源不投影；不创建另一套执行数据库。
- UI沿用受控详情块展示插件来源。插件工具单独呈现，不混入内置文件读取分组；结果只作为普通Tool数据进入模型，不升级为系统指令。

## 验证

2026-09-22 自动验证：全量 2805 项通过、7 项跳过，lint、TypeScript 和生产构建通过。覆盖组合快照、权限组、未知名称伪装、输入/source漂移、AI目的地变化、范围审批、停止/撤权、来源持久化和旧库迁移。

独立 Agent 集成测试使用真实 Guard 和内存 SQLite，覆盖组内调用、组外批准/拒绝、参数错误审计、等待授权/执行期间取消、AI配置漂移，以及同Run固定旧版本、下个Run使用新版本。服务测试还验证异步授权期间窗口变化/停用时立即拒绝结果。

macOS Electron 合成全链路通过：真实 PluginManager 安装和双批准 → 生产 Agent Orchestrator → HTTP SSE 模型协议 → 隐藏插件沙箱 → Range/ETag 合成存储 → SQLite ToolRun 来源。CSV共4行数据，匹配2行“茶、牛奶”，发生7次受控Range请求，2次模型协议请求，Viewer数量为0。测试配置和SQLite全部在临时目录，不读取真实资料库。

更换有效 Key 后，真实 gpt-5.5 隔离联调通过：模型先调用 file.resolve，再调用 example.csv-tools.query，返回两条匹配数据“茶、牛奶”。Range 请求7次、Viewer数量0，ToolRun持久化插件来源。该轮使用合成资料库，与下述真实win资料库验收分开记录；未导出或修改用户凭据。Run：`5a638985-73fc-48c7-92a2-db11cbb8d41d`。

实际应用验收也已通过：从管理页安装 `example.csv-tools@0.1.0`，分别启用、批准读取、批准Agent Tool；在第三个win资料库（ID 3）新建“询问访问”会话，使用gpt-5.5/中推理读取既有合成验收文件 `/文档/omniflow-c2-qa-20260914.csv`（节点18517，local-minio，5127 bytes）。未使用第一个资料库。

- 实际步骤为 `agent.access.request` → `file.resolve` → `example.csv-tools.query`，三个ToolRun均completed。批准框只展示该文件的读取范围，未扩大为整库访问。
- CSV插件收到 `limit=3`，正确返回表头“名称、内容”、`totalRows=205`、`matchedRows=205`，前三行为“行1/中文测试 1”至“行3/中文测试 3”，`truncated=true`。模型回答与结构化结果一致。
- 全程处于Agent工作区，没有先打开CSV Viewer，没有调用file.read、Shell或文件写入工具。文件仍是原验收内容。
- 已展开插件调用详情，UI显示插件ID、0.1.0版本、工具ID与包指纹；通过只读SQLite查询核对pluginSource与结果来源一致，包指纹为 `955c75f8493988ab15d7eb1065ebd4c7eb5fe3de0a55b7f33a6ddae2580302bf`。
- 实际Session：`c2c0e6a3-cc0c-4dfe-948a-9c2df6d06869`；Run：`58209275-94a7-409e-82e5-5903d9e3bd3a`。该会话及插件双批准保留供复测，CSV默认查看器与漫画关联未改。

## 复现与剩余范围

- `node tools/plugin-isolation/run-at1.mjs`：隔离Electron、生产Agent及插件服务、临时SQLite、回环SSE和合成CSV；无需真实AI连接。
- `node tools/plugin-isolation/run-at1.mjs --live`：通过现有安全存储读取当前激活AI连接，运行真实模型但仍只用合成资料库；默认gpt-5.5，可用 `OMNIFLOW_AT1_MODEL` 指定模型。该命令会产生模型用量，不会修改用户AI配置或读取用户资料库。
- 实际界面复测使用已安装样板，或安装/双批准 `dist-plugin-kit/at0/csv-tools-0.1.0.zip`。在win（ID 3）新测试会话中查询既有CSV，不先打开Viewer；禁止使用第一个资料库。
- 核心实际审批、插件查询与详情点击已通过；后续[AT2](plugin-system-at2-fault-recovery.md)已覆盖既定故障矩阵、scope变化组件与实际权限等待期间离库取消；发行包、小时级资源趋势及扩展真实场景仍未宣称通过。Windows/Linux不在本批范围。本轮只补真实验收及文档，未改执行代码，未重复此前已通过的全量构建/测试。
- 停用立即取消插件调用和正文请求；已发出的会话权限元数据查询仍遵循既有Run signal及broker超时收口，不承诺单插件停用会同步停止整个Run的所有权限查询。

当前主进程入口为 `agent-plugin-service.ts`，调用协议沿用AT0 SDK 0.3.0和格式2，样板无需升级格式。新增可见审计为ToolActivity的可选pluginSource字段，无新的renderer启动插件IPC。
