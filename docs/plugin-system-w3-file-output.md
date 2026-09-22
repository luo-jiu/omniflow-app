# W3 文件处理产物与回执核对

更新时间：2026-09-22
状态：W3 本批限定 macOS 功能范围已验收。真实 gpt-5.5、插件处理、目标批准、同库新文件保存及原件保护核对通过；显式未知回执查询入口有自动化覆盖，未做真机故障点击。W0～W2 既有验收与阶段提交保持：前端 `da5e349`，后端 `61fd46f`。

## 1. 当前范围

独立 CSV 插件读取一个获准文件，筛选后生成 CSV 或 JSON，由宿主批准并保存为同库新文件。服务于资料处理和再利用，遵守[项目长期方针](../../PROJECT_PRINCIPLES.md)中的原件保护、稳定身份及提交可核对原则。

首期单源、单产物，UTF-8 正文为 1 字节至 1 MiB，声明类型限定 `text/csv` 或 `application/json`，目标使用对应的小写 `.csv`、`.json` 后缀。宿主固定 `conflictPolicy=error`，不覆盖、不自动改名、不修改源文件；输出节点不能复用源 nodeId。没有 Shell、任意网络、多产物、后台转换或自动续作。

样板 `example.csv-export@0.1.0` 完整导出全部数据或指定列精确匹配的行，源文件最多 4 MiB、含表头最多 10000 行、128 列、100000 单元格。超限明确失败，不截断成较小文件冒充完整结果；CSV 转义和 JSON 内容由样板负责，宿主不是通用文件格式语义验证器。独立构建入口见 [样板说明](../samples/csv-export/README.md)。

## 2. 协议与私有正文

SDK 为 `0.5.0`，wire 仍为 1、Manifest 为 2。新 Tool `kind: "file-output"` 同时要求 `resource.read`、`resource.output.propose`、`agent.tools`；文件产物使用独立 `outputApproved`，不从读取或普通 Tool 授权推导。包更新及回滚需重新批准对应指纹能力。

模型输入包含 `resource:{nodeId}`、`destination:{parentId,fileName}` 及声明的处理参数。runtime 将 resource/destination 剥离，只将处理参数与当前获准源句柄交给插件；真实 nodeId、目标目录、凭据和路径不进入沙箱。源读取沿用既有版本、分块与生命周期检查。

贡献声明 `output:{mediaTypes,maxBytes}`，使用固定产物协议，不扩大普通 Tool 的任意 JSON Schema 或 `tool.complete` 预算。`completeFileOutput(invocationId,{mediaType,text})` 通过专用 `tool.output.complete` 信封以 canonical base64 携带 UTF-8 字节。SDK、preload、broker、runtime 分别检查声明能力、MIME、字节与信封上限、合法 UTF-8 和单终态；普通 Tool 不能使用此完成方法，产物 Tool 也不能绕回普通 complete 输出正文。

结果正文短暂存在 main 的受限缓冲中，随后写入受管 artifact。模型 Tool result、public action、SQLite 会话和通用 renderer IPC 只获得目标、长度和摘要，不获得文件正文。产物本地 I/O 错误在服务边界转稳定错误，不将临时绝对路径随失败结果外泄。专用沙箱消息与可信 main 内部消费不是对主窗口开放的任意大文本通道。

## 3. 准备、缓存与批准

公开 `plugin.file-output@1` action 保存插件来源、sourceNodeId、libraryId、目标 parentId/fileName/providerId、MIME、sizeBytes、SHA-256 和 operationId。私有 binding 保存 artifact ID 及精确源/目标版本；不保存正文、物理路径或凭据。operationId 在准备阶段生成并写入 public action，早于 upload/init，提交与查询始终复用。

同一 owner、窗口、Session、Run、ToolRun 下，输入、来源与源版本未变时复用已封存 artifact，不重复运行插件。目标、源版本或产物摘要改变时不能沿用旧批准；源变化重新生成，目标漂移要求重新准备。随机 artifact 身份不进入公开稳定动作。每次重新准备仍通过已验证句柄核对产物摘要。

源读取范围与目标目录写范围分别受 Agent 会话权限控制；范围许可不能替代具体产物批准，完全访问模式仍展示最终新文件目标、大小、格式、摘要及插件来源。execute 对照 main 审批封印复验 owner、窗口、库、Run/ToolRun、Tool registration、AI 目的地、输入摘要及缓存绑定，上传前和 complete 前再次检查源与目标。

Store 的 `create` 可按本产物的 1 MiB 上限预留，原媒体调用默认仍为 2 GiB。finalize 严格检查内容长度，并容许末尾 4 KiB 物理分配块向上取整，实际 allocated bytes 继续记入共享配额。封存后消费仍使用同一受验 FileHandle 及文件/目录身份复核。

缓存不是恢复事实源。一次重新准备的临时失败可保留原待批准 artifact 供同一请求重试，但 Tool 拒绝/退出、Run finally、生命周期中止、停用及撤权都有 scope 清理入口；失败结束后不会仅等待 TTL。正在上传的 record 先完成有限结算，再由执行 finally 回收，不能清理仍在消费的文件。进程重启不重建该执行缓存，旧批准不能直接继续执行。

## 4. 上传与结算

复用既有 main-owned artifact upload manager 和后端 upload init/sign/complete/status，不增加插件专属表或写 API。main 传入已冻结 UUID operationId；旧调用方可继续使用既有 64 位摘要。上传结果的 committed/uncommitted/commit_unknown 分支均携带该 ID，正文、签名 URL 和 storage key 不成为公开结果。

只有通过新节点身份、库、父目录、完整目标名、字节数、provider 和 MIME 检查的 complete 或 status 回执才能结算 committed；同名明确 409 不覆盖。complete 前取消或授权漂移停止后续提交并清理上传会话；complete 发出后任何非 committed 查询、失败或超时均保留未知，不自动 abort、另建 operation 或触发本机兜底。旧后端曾以 uncommitted 表示 pending，新前端同样保守对待该值。

Go status 已修正 pending→unknown，并在命中当前 actor 的 session 后检查当前库 read 权限；未命中/跨 actor 保持 unknown，撤库权限返回 403。回执保留 7 天，过期仍是未知。客户端可提前持有 operationId，但服务端在 complete 认领前尚未绑定；init/PUT 期间查不到不能反证提交路径不存在。

SHA-256 是宿主已批准 artifact 的内容摘要。当前服务端上传回执不包含对象正文 hash，历史核对验证提交时元数据，不重新下载对象证明正文 hash，也不证明节点之后没有被移动或改名。

## 5. 显式回执查询与恢复

宿主固定“查询回执”动作绑定 owner/library/session/toolRunId 和预期 revision。main 从持久 ToolRun/public action 读取 operation 身份，只为已批准、来源匹配的 `plugin.rename` 或 `plugin.file-output` 终态记录查询；renderer 不提交任意 API、operation ID 或写入参数。当前凭据复验后使用后端只读状态接口，插件停用/卸载也无需重新运行插件。

查询是终态更新的显式受控例外，不是迟到执行回调。SQLite 以 revision CAS 保存核对结果，保留 originalResult/originalStatus 和最多八条核对记录，成功状态不降级；旧 Run 不重新打开，历史模型消息不重写。结果仍未知时保留原未知事实；当前权限失败或回执目标不符不伪造成功。旧上传没有可验证 operation action 时不能凭名称生成查询入口。

历史改名核对成功只刷新父目录，不重播旧名称覆盖当前标签。文件产物按成功节点事实刷新目标目录；输出正文、source 文件内容及凭据不进入核对轨迹。启动恢复只保守保留已批准在途操作的未知身份与已有成功回执，不自动查询网络、继续插件或重传；跨重启可由用户显式查询，但没有自动续作或撤销。

## 6. 状态与验证边界

最近一次全量自动化为 407 个测试文件通过、3 个跳过，3196 项测试通过、7 项跳过；最终 lint 与 `npm run build` 均通过。目录名称/来源展示收尾后，另通过 24 项产物服务和 22 项确认卡定向回归，共 46 项，不计入或累加为另一份全量总数。后端本批 Go 全量测试与 CLI 构建通过。

| 子批次 | 当前事实 | 仍需完成 |
| --- | --- | --- |
| W3.0 契约和状态查询 | new-file-only、旧请求兼容、稳定 operation、pending unknown 与当前库权限已接入，真实新文件回执已核对 | 并发压力与长期回执过期情形不在本批实测范围 |
| W3.1 SDK/样板/产物 | 私有产物协议、独立权限、CSV 样板、main 封存缓存/批准/上传完成，真实 gpt-5.5 与 Win/local-minio JSON 另存通过 | 更大源文件、长时性能及全平台体验后续验证 |
| W3.2 显式核对 | 终态来源/版本绑定、固定查询动作、CAS 审计与保守启动恢复已接入并有自动化；原生实验验证丢回包后同 operation 核对 | 真实故障下手动点击查询回执、真实重启后点击查询未手验 |

定向回归覆盖明文隔离、1 MiB 临界、invalid UTF-8/超限、完整导出/CSV 转义、稳定重准备、源/目标漂移、缓存异常后 scope 释放、拒绝/取消、同名冲突、回执替换拒绝及未知结果保留。审查发现的本地文件错误路径透传已转稳定错误，并以 create/finalize 失败测试核对；历史查询与即时提交采用一致的 MIME 主类型比较。

真实 Electron 实验使用生产 PluginRuntime、Agent Orchestrator、ArtifactStore、UploadManager 和 SQLite，后端/模型为合成服务。`full-access-json`、`deny`、`lost-response-csv`、`source-drift`、`name-conflict` 五类通过：完全访问仍批准，拒绝不 init，丢回包只一次变更并查询同 operation，源变化触发重新批准且不上传，重名不覆盖并清理。它证明实际隔离和上传编排，不替代真实用户界面点击。

真实应用验收：安装 `example.csv-export@0.1.0`，分别批准 read/output/tool。Win（libraryId=3）中真实 gpt-5.5 读取已指定合成源节点 `18517`，目标 parentId=`15971`、`omniflow-w3-export-20260922.json`、provider=`local-minio`。范围批准后，产物卡展示 application/json、5974 字节及 SHA-256，用户批准保存；目录出现新文件并可正常打开 JSON 预览，保存按钮禁用，没有编辑该文件。

本次实际交付的交叉证据：

- 新节点 `18521`，type=file、ext=json、parentId=15971、fileSize=5974、MIME=application/json、provider=local-minio。
- upload session `d5419164-7fc7-4338-9054-4ca1c6b1fd35`，operation `21b0419f-842e-852b-a80e-0faf8b466497`；回执 committed、completedNodeId=18521，完成于 `2026-09-22T07:46:48.885372Z`，现有回执保留至 `2026-09-29T07:46:48.885372Z`。
- 仅对此次新生成合成对象，以本机 MinIO SDK 只读获取正文核对：5974 字节，2 列表头、205 条数据行且各行列数一致，SHA-256=`9c8c28edeca9bcf01f848f9106fc346dc540e4b86439c2d71059aaaba80122aa`，与批准摘要完全相同。没有输出正文、签名 URL 或凭据。
- 源 `18517` 的完整元数据基线（含对象 key、bucket、大小、节点/存储更新时间）前后 SHA-256 都为 `4965fb5fc17736e60166cf46fbfc93fba0734004320cc14bc0453e876c39df98`，大小仍 5127，节点与存储更新时间仍为 `2026-09-14T05:15:23.083139Z`。这项核对证明上述元数据未变，未以读取源正文冒充前后正文 hash 比较。
- SQLite Session `f355bcc9-d6c7-4cb5-b7e1-3bb485ddf14d`，Run `213ec87c-26aa-4347-ad00-c74d0e482d2b`，ToolRun `6757e754-9a80-4b48-9563-dc2c843a7dcd`；Run/ToolRun 均 completed、approval approved，模型为 gpt-5.5，同一 operation、size、SHA 及 committed 事实保存。插件来源为 `example.csv-export@0.1.0`，包指纹 `cf43cabc7be0b0c48a053d80c0fdf2e2dee5518663e8606f69dc985c23101cb6`。

显式“查询回执”UI 的可见性、只读请求、来源/owner/revision 限制和审计更新有自动化；本轮未为此人为制造真机未知状态再点击，也未进行真实重启后的查询点击。不将原生自动核对或 UI 组件测试写成这些手工场景已通过。

真实测试仅使用非第一资料库，优先 Win、本机 local-minio 与专用新建输出。发行包、Windows/Linux、长时性能、多产物、自动网络恢复及撤销不在本批范围。

## 7. 维护规则

后续以代码和实际证据更新状态；扩大类型、字节数、多产物、覆盖或恢复能力前重新冻结事务、权限和资源生命周期。SDK/运行时、上传与显式核对必须采用相同的身份和回执校验规则，不能因组件名称相似就推断安全语义相同。
