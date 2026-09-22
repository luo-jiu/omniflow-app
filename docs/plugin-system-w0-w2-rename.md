# W0～W2 受控批量重命名插件

更新时间：2026-09-22
状态：W0～W2 已完成本批限定 macOS 功能验收。真实 Agent、插件、标准审批、条件提交、PG/SQLite 审计及目录/预览名称同步通过；发行包暂缓，剩余范围见第 5 节。

## 1. 当前结论与边界

独立 `example.batch-rename` 样板已通过公共 SDK 生成提案，内部 Agent 可发现工具并请求宿主执行。插件提供前缀、后缀规则；宿主持有真实资源范围、版本、预览批准、事务提交和审计，不为样板 ID 添加私有能力。

一次输入 1～50 个同库普通文件，仅改变名称主体，保留扩展名、节点 ID、父目录和存储对象。未变化项不提交；无变化则明确结束，不显示成功改名。目录、归档虚拟成员、重复 ID、跨库、陈旧目标、非法名称、同目录重名、交换名称、覆盖及自动改名均不支持。插件没有正文写入、删除、移动、Shell 或任意网络能力。

本批服务于[项目长期方针](../../PROJECT_PRINCIPLES.md)中的资料整理、稳定身份和写入可核对原则。用户资料名称与服务端回执是持久事实；临时提案、权限能力和不透明文件引用不是另一套文件状态。

## 2. 提案与批准

SDK npm 版本为 `0.4.0`，wire 与 `sdkVersion` 仍为 `1`，提案使用 Manifest v2。Tool 声明 `kind: "rename-proposal"`，分别请求 `resource.rename.propose` 和 `agent.tools`；读取权限不能代替提案权限。首版提案包不混合 Viewer、正文读取或目录读取贡献。

模型输入中的 `resources` 是 1～50 个明确 nodeId。会话范围授权后，main 经一次性文件 authority 获取 name/ext/parentId/updatedAt，并将节点换成本次调用的随机引用。沙箱只收到 `{parameters,files:[{id,name}]}`，其中 name 是完整文件名；`context.resource` 为 null，正文、目录、state/settings API 均拒绝，真实节点、账号、路径和凭据不进入沙箱。

插件返回固定 `{changes:[{id,name}]}`。宿主确认引用属于输入、没有重复、名称合法且保留原扩展名，完整名称最多 240 UTF-8 字节；旧名称从宿主快照取得。空提案不写入。样板及独立构建说明见 [batch-rename](../samples/batch-rename/README.md)，协议与预算见 [SDK](../packages/plugin-sdk/README.md)。

标准 Agent 审批卡展示插件、版本、包指纹、文件数量和完整旧名→新名列表，列表可滚动。范围授权与具体提案批准分开；即使会话为完全访问，提案仍须明确批准。卡片不执行写入、不自行编辑提案，不从模型返回内容推导批准身份。

批准前重新运行提案与 dry-run，审批封印绑定 owner、窗口、库、Session/Run/ToolRun、Tool registration、AI 目的地、输入摘要、包指纹及真实旧值快照。变化要求重新批准；随机引用不进入稳定摘要。语义不变的重准备产生同一 operation ID。执行使用封印后的真实条目，复验范围、节点和当前账号，不再次运行插件代码。

## 3. 受控提交与结果核对

现有单项 rename 无旧值条件，内部 `library.batch` 也不是带持久回执的原子批量，不能直接作为插件公开写入接口。本批新增通用后端契约：

- `POST /api/v1/nodes/rename/batch/conditional?dryRun=true|false`
- `GET /api/v1/nodes/rename/batch/status?libraryId=...&operationId=...`

请求为 `{libraryId,operationId,items:[{nodeId,expected:{name,ext,parentId,updatedAt},name}]}`。服务端验证当前账号与库写权限，在同一事务锁住 actor/operation 和按 ID 排序的全部节点，核对旧值、目标名称，再修改节点并写入 `node_mutation_receipts`。数据库维护的 updatedAt 在更新后读回，客户端比较完整时间精度，不用毫秒截断通过微秒漂移。

任一项失败全部回滚，不返回虚假的部分成功。相同 actor/operation/摘要重放原回执，不同摘要返回 409。dry-run 运行同一校验及写 SQL 后回滚，返回 validated，不留下节点修改或成功回执。后端详细请求、错误和 CLI 见[条件改名契约](../../omniflow-go/docs/architecture/node-conditional-rename.md)。旧服务返回 404 时直接失败，不能降级到无条件单文件改名。

main 在发送提交前登记 `commit_unknown` 收尾事实。提交前取消不发写请求；越过提交边界后使用独立的有限预算等待提交并按同一 operation ID 查询状态。已确认成功保留 committed；明确拒绝为 uncommitted；网络、取消、损坏回执或核对失败保留 commit_unknown。status 的 not_found 仅表示查询时无可见成功回执，不证明不存在在途提交。

宿主不换新 operation ID 盲目重试。网络层可能重发同一 HTTP 请求，因此后端幂等回执仍不可省略。只读 SDK 的停止/取消不能代替此提交结算协议。

## 4. 状态、恢复与工作区

ToolRun 仍是唯一 Agent 执行和展示事实源。SQLite 保留规范 `plugin.rename` public action、不可变插件来源和终态结果；SQL 约束独立拒绝跨库、来源不符、重复目标和额外字段。私有 binding、凭据及后端地址不进入 public action。审批恢复与真实提交恢复分别处理，恢复卡片不授予旧能力重新执行的权利。

Run 取消后，已经提交的插件 ToolRun 可以保持 completed；无法确认的 ToolRun 保留 failed 与 `mutationCommitState: "commit_unknown"`。两者都不能被通用取消分支覆盖。收尾超时保留未知结果，迟到回执不能回写终态或续跑旧 Run。

应用启动恢复另有保守处理：合法来源、已批准且仍 running 的改名 ToolRun 转为 interrupted，并保留 commit_unknown 和原 operation ID；审批前中断不伪造未知提交。已有规范 committed 回执的终态 ToolRun 保持原样，其尚未完成的 Run 提示“改名已提交，查看现有回执继续未完成步骤，勿重复改名”；同一 Run 同时有未知改名时优先提示核对未知结果。恢复不调用网络、不重跑插件或提交，也不再对这些 Run 建议直接重发上一条消息。

renderer 只消费 main 已确认、且与批准条目对应的 committed 回执。本次实时完成事件按节点 ID 通知既有文件变更链、更新已打开预览标签名称，并刷新父目录、失效树快照。历史会话恢复只刷新父目录与树快照，不重播旧名称通知，避免旧回执覆盖后续改名事实。刷新失败不反转提交成功，也不重新执行改名。

尚未实现跨应用重启的自动网络回执核对/自动续作、专用未知操作恢复页面或撤销。PostgreSQL 回执长期保留，可经状态 API/CLI 人工核对；上述保守状态恢复不等于这些能力已经完成。

## 5. 已验收证据与未验收项

最近一次全量门禁：401 个测试文件通过、3 个跳过，3087 项测试通过、7 项跳过；`npm run lint` 与 `npm run build` 通过。Go 全量测试与 CLI 构建通过。最终启动恢复收尾另通过 Store/session/bootstrap 79 项定向回归并重新构建通过；不把重复执行的测试数累加。已核对的本地交付包位于 `dist-plugin-kit/w2`，不属于桌面发行包验收。

| 验证层 | 已验证事实 | 不代表什么 |
| --- | --- | --- |
| 定向自动化 | SDK/Manifest 隔离、独立权限、Opaque 元数据、稳定操作身份、审批封印、范围/来源替换拒绝、完整时间精度、提交三态、SQLite 与展示投影 | 不代替实际客户端点击或真实模型决策 |
| macOS 真实 Electron | 独立构建 ZIP、真实 PluginManager/沙箱/Agent Orchestrator/SQLite，合成 HTTP、合成模型与合成 libraryId=3；批准、拒绝、丢响应、完全访问仍询问、提交后取消成功、取消且核对不可用共六类通过 | 不是现有 8850 后端、真实模型或用户资料库 UI 验收 |
| 本机真实 PostgreSQL | 单连接事务内建立临时影子表，以显式 ID 验证真实 usecase/SQL、权威微秒时间、dry-run/冲突全回滚、可见名称唯一索引、重放与回执查询，最终全部回滚 | 不覆盖跨连接崩溃、正式部署、用户表全部触发器或并发压力 |
| 实际 macOS 开发应用 | 管理 UI 安装/启用及独立提案/Tool 权限；真实 gpt-5.5 调用插件，先范围确认再完整提案批准；两个 Win/local-minio 合成文件原子改名，目录与原打开预览标签同步、正文不变 | 不覆盖发行包、其他平台、大批量长时间体验或所有异常的真实界面重现 |

Electron 复现：`node tools/plugin-isolation/run-rename.mjs`。隔离 profile 不接触用户现有会话；实验中拒绝提案没有提交，响应丢失时最多一次实际修改，完全访问仍出现提案批准。取消实验直接核对 SQLite 中的已提交/未知 ToolRun，不只看事件投影。

PostgreSQL 复现见后端 opt-in 测试：`OMNIFLOW_RENAME_POSTGRES_TEST=1 GOCACHE=/tmp/go-build go test ./internal/usecase -run '^TestRenameBatchPostgres$' -count=1 -v`。默认 Go 测试不连接真实数据库；临时影子表不修改用户节点、持久回执、共享 sequence 或常驻服务。

开发库已先查重、执行回执表和可见名称唯一索引迁移，再生成 model/query；迁移没有重命名用户文件。实际 8850 正常加载新版后，在 win（libraryId=3）`/文档` 新建两份专用合成 TXT，明确使用 local-minio。真实 gpt-5.5 调用 `example.batch-rename.propose`，范围确认后显示两条完整旧名→新名，批准添加 `W2通过-` 前缀。目录立即显示新名称，原已打开的 a 文件预览标签和底部文件名同步，正文仍为 fixture A。Tool-only 空 Viewer 列表曾导致进入库白屏，已修复并确认刷新可用。

本次实际提交的交叉证据：

- 节点 `18519`、`18520`，parentId 均为 `15971`，ext 均为 `txt`；新主体名分别为 `W2通过-omniflow-w2-qa-20260922-b` 与 `W2通过-omniflow-w2-qa-20260922-a`。
- PostgreSQL 唯一匹配回执 `2128c82f-4de4-8bb0-a8db-4f28f5d7232e`：atomic=true、state=committed、replayed=false、两项 committed；节点 updatedAt 与回执 committedAt 均为 `2026-09-22T06:42:43.370915Z`。
- SQLite Session `f355bcc9-d6c7-4cb5-b7e1-3bb485ddf14d`，Run `f42f3a97-2320-4e96-b739-09ef09d1f402`，ToolRun `75345f35-9802-4cc7-a333-d77163ab377d`；Run/ToolRun 均 completed、approval approved，同一 operation ID、atomic 和两项 committed 保留，来源为 `example.batch-rename@0.1.0` 及安装包指纹。
- 同一 Session 的首次试运行在范围批准前停止：Run `8c101276-b44e-4cb0-afcd-65c9daa91fb2` 与 ToolRun `b3ef1f34-10c6-44e1-9a47-4be02e0f7d9c` 均 cancelled，批准状态 cancelled，无提交 operation 或 commitState。

真实验证仅使用上述非第一个资料库中的新增合成文件，没有借用户已有内容做改名试验。50 项列表完整性有自动化断言；本轮实际查看的是暗色两项卡片，亮/暗 50 项长列表的视觉与滚动点击尚未人工验收，不能把数据完整性测试当主题视觉验证。小时级性能、跨连接崩溃压测、发行包、Windows/Linux、跨重启自动回执核对与撤销不属于本批限定 macOS 功能完成声明。

## 6. 维护规则

调整资源范围、名称/扩展名规则、审批身份、operation 摘要、回执保留、取消或恢复语义时，同步前后端契约、SDK 和验证矩阵。更广的正文保存、上传、移动、删除、网络及本机执行能力另行冻结契约，不能因提案插件已接通而默认为全部写入已开放。
