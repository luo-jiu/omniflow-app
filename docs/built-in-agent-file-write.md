# Agent 统一文本写入与补丁

更新时间：2026-10-22。

无数字上下文补丁第一批工程验收通过。长空白行阻塞、无账本误推提交、no-op 取消竞争，以及 renderer 入口取消额外等待 30 秒均已修复并复验；最终 7,091 项全量测试、lint、build 与 diff 检查通过，先前限定 macOS smoke 保留原证据范围。选择依据、精确 EOF 样例及真实模型验收门槛见[可靠性方案](agent-file-editing-reliability-plan.md)。真实模型对照尚未验收，不能据自动化或合成 smoke 通过宣称成功率已经提高。

`file.write` 新建或完整替换文本，`file.patch` 局部修改；两者使用 `scope=library|host`，由模型根据用户目标和上下文选择，不设自然语言路由或强制澄清。省略scope为library仅保持旧调用兼容，单次调用失败不会暗换来源。当前均为saved-only，Agent读的是已保存内容，成功写入即保存；编辑器草稿继续由Viewer管理。

## 工具契约

- `path` 支持当前scope的绝对或相对路径，父目录必须存在。library相对路径使用显式绝对`basePath`，省略时按本轮当前目录ID读取权威路径，无当前目录则以`/`为基准；`..`不能越过资料库根。host相对路径必须显式提供当前平台绝对目录或`~/`形式的`basePath`，缺失时返回可操作错误，不使用应用进程cwd。绝对path不依赖basePath，但提供的base仍须合法；`~/`、Windows盘符等本机形状不会被当作资料库相对路径或自动改变scope。
- main在资源授权、审批和执行前只解析一次并冻结规范绝对目标，移除basePath；审批审计、prepare、renderer请求和私有写入快照复用同一执行输入。执行侧克隆规范输入，与已预算的模型原始toolCall分开；不得原地修改Provider历史参数而使上下文预算失准。原始和规范输入均检查敏感信息及审计限额，不能用归一化消失的字段绕过审计；拒绝时仍同步安全投影清除原始历史中的敏感输入。该解析器负责逻辑/原生路径归一，现有executor仍负责文件身份和版本复验；未新增跨Run稳定ref。带相对header的patch先验证header对应原结构化path，再绑定规范目标，冲突header继续由严格解析器拒绝。
- write接受完整UTF-8正文，最多32000个UTF-16 code units；省略revision为create、不覆盖同名。可显式mode=create/replace；替换必须提供file.read返回的revision或expectedRevision，两个字段不可同时提供。
- patch仅修改现有单文件。新调用首选显式 `format=context-v1` 与 `revision`：每个 hunk 以独占行 `@@` 开始，正文用空格 / `-` / `+` 表示上下文 / 删除 / 新增，不要求行号和计数，不接受函数锚点或文件 header。纯新增 hunk 追加 EOF，可用 `*** End of File` 约束旧侧位置。全部 hunk 在同一已验证版本上唯一定位并验证后才生成 after；删除行精确匹配，只有上下文行允许忽略 ASCII 尾空格 / Tab，重复仍拒绝并给有界候选。
- context-v1 正文最多32000个UTF-16 code units；实际 JSON 参数（含转义与路径）最多64000。两端与 main 快照校验共用可取消增量引擎，源 / 结果均最多8 MiB，有独立扫描 / 时间预算。源解码、控制字符校验、尾空白裁剪与等值比较均分块线性执行、计入预算并让出事件循环，单个长行也能取消；不创建、删除或改名。
- 新格式默认 `finalNewline=preserve`，保留补丁重建出的边界字节；结构性删除可能自然改变 EOF 状态。显式 `ensure/remove` 在重建后执行，即使 hunk 未触及 EOF 也生效。remove 会丢失真实空末行时整次返回 `PATCH_FINAL_NEWLINE_CONFLICT`；空正文和 BOM-only 保持零正文行。BOM、未改行和内部混合换行保持原字节。拼接处裸 CR 与空行 LF 可能合并时，只调整新增行 ending；必须改动保留字节才能避免吞行则以 `PATCH_LINE_ENDING_CONFLICT` 整次拒绝。
- 历史省略 format 或显式 unified-v1 的调用继续使用严格行号、计数、上下文与无尾换行标记；revision / expectedRevision 恰好提供一个。旧 header 规则保持，不在失败时猜测格式、换 scope 或绕过版本检查。
- 两端共用codec及补丁引擎。新建/替换/补丁均保留已有权限策略，full-access不绕过身份/版本/系统用户权限。版本冲突重新读取；unknown先核对，不盲目重试或换通道重写。

## 执行与提交

新 Run 的可信main注册身份为`builtin:file.write@2`、`builtin:file.patch@2`；冻结的旧 Run 仍按原 @1 patch 闭包执行。main 与 Broker 共用身份、执行器、来源与风险判定，插件同名/伪造注册不授予提交能力。main给每次调用绑定独立operationId与owner/库/Session/Run/ToolRun；host直接执行，library通过原有renderer broker调用条件保存/上传。

library替换先核对原始字节，再以私有storageKey条件调用保存端点；旧后端404不回退无条件更新。新建保留健康Provider路由、staging、上传init/PUT/complete链及finally清理；不把不可达默认Provider当作唯一可选目标。已有文件保持原存储身份，不通过换Provider绕过旧内容/版本检查。

提交前executor必须把真实before/after交给main私有journal。library的`agent:file-change:prepare`一次性能力绑定当前execution；main检查path、版本、编码、授权写入正文或补丁结果，并通过权威元数据与正文重验现有文件。准备失败不写文件，快照不进入Tool结果或模型续轮历史。原始模型content/patch仍按现有审计规则处理。

host只处理普通单硬链接文件；复验lstat/realpath/open身份与原始字节hash，在应用串行队列中通过同目录临时文件、fsync及exclusive-create/rename提交，再读回验证。保留mode/owner，ACL/xattrs等扩展元数据尚未保证，结果明确warnings。compare+rename不是对任意外部写者的CAS，不承诺跨进程绝无覆盖竞争；Windows/Linux真机尚未验收。

`writeCommitState/mutationCommitState`区分committed/uncommitted/commit_unknown，operationId为main绑定。进入提交边界后renderer取消保留最多30秒结算，外层main等待35秒。规范回执先由Broker同步接受，再异步结算journal；已经封存的unknown不被迟到成功覆写。写后目录刷新失败不逆转committed。

实际字节不变时成功返回 `changed=false / outcome=unchanged`，前后 revision 相同、两提交字段均为 uncommitted，ToolRun 保持 completed；跳过提交 begin、条件保存、内容刷新及文件变更 journal / Diff，UI 显示“未修改”。账本、提交结算、变更记录和展示共用四个自有提交态字段的归一规则：合法一致显式态独立于 ok / completed；无态为 unknown，非法或冲突为 commit_unknown。`operation.verify` 对 no-op 直接返回未提交，文件正文操作的 unknown 不能凭节点存在、名称或父目录升级为已提交；当前正文 hash 也不能证明某个 operationId 曾提交。

操作账本缺失、reader 未接入 / 失败或工具类型未知时，`operation.verify` 保持 `commit_unknown / retryAllowed=false / node=null`，不读取节点；跨 Session 查询旧 operationId / ToolRun ID 同样处理。只有已知账本中的既有节点元数据操作继续兼容元数据核对，不据此改写原封存回执。

host 清理句柄或 library 回传 IPC 期间发生停止 / 超时，已形成的规范 no-op 可在原有有界结算窗口内返回并正常持久化。回执须匹配可信内置工具、绑定的 operationId / executionId 与冻结输入 revision，且三处 revision 一致、两提交态均为 uncommitted。library 由 main 仅为带版本的可信替换显式启用该等待，不增加 begin / journal；普通成功、无效回执和 create 不走此分支。结算到期后的迟到 no-op 不改已封存结果。

library 文件工具在 renderer 入口取消检查或首次权限复验失败时，尚未进入文件 adapter，返回 `ok=false`、绑定 executionId、两提交态均为 uncommitted 的结束回执。renderer 即使已取消也回传该结果，让 Broker 立即结束等待；同会话下一次启动仅等待真实 Run 清理，不耗尽 30 秒 no-op 窗口。这不是 unchanged 成功；adapter 内的失败与提交态仍由原执行器判定，不能把执行后的任意异常降级为未提交。

解析、定位、EOF 冲突分别返回有界 `phase/code/hunkIndex/patchLine/candidateRanges/suggestedRead/nextAction`。版本冲突建议重读，unknown 保留原 operationId 先核对；诊断不复制整份 before / after。恢复步骤由模型判断，不新增固定工具顺序或确认弹框。

成功library写入继续经既有内容变更事件更新匹配tab和目录，不创建第二套树/tab状态。Viewer返回时处理真实草稿冲突；不在Agent页面弹全局草稿框。普通编辑器保存仍校验原始版本并条件提交。

## 独立Diff与保留

Agent用时行“改动N”打开独立列表/统一Diff，不进入文件tab。SQLite存元数据，私有磁盘存不可变before/after；不依赖Git，也不从当前文件反推历史。仅覆盖file.write/patch，Shell写入可能未收录。

每文件8 MiB、Run64 MiB、owner512 MiB，记录数Run1000/owner20000；已结算7天、unknown14天，活跃操作不清理。过期保留摘要，Session删除通过同事务outbox安排物理清理，失败保持占用并重试。快照落库失败不会声称有Diff，也不在已提交后自动重写。不是备份、同步版本库或自动撤销。

同Run、nodeId、path及revision连续的library已提交链可看净Diff与单次；host仅单次。查询最多16个实际Run、200条并标明截断；Diff有计算/输出预算，大差异显示限制。

## 验证

自动化覆盖共享codec/BOM/混合换行/EOF/大文件、版本冲突、host真实临时文件提交、取消与sealed迟到回执、私有IPC/preload/正文绑定、SQLite身份隔离/配额/TTL/重启/删除outbox、真实main-to-renderer broker接线及独立UI。@2 新增 19 组双端共享字节 fixtures，Registry / 双 Provider / Broker / ToolRun SQLite 关闭重开 / operation.verify 全消费者链，以及在途 prepare 跨取消和失败 / 取消终态下的保存摘要。全量结果与非首 win / 本机 MinIO、隔离 host 的实际读改读、no-op 与草稿隔离范围见[验证矩阵](frontend-validation-matrix.md)。

2026-09-10历史验收已确认win资料库file.write会避开不可达win-minio，选择健康local-minio。2026-10-21新增能力的真实验收另记，不把旧write验收等同于patch/Diff验收。
