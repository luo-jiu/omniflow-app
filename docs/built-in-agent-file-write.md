# Agent 统一文本写入与补丁

更新时间：2026-10-21。

`file.write` 新建或完整替换文本，`file.patch` 局部修改；两者使用 `scope=library|host`，由模型根据用户目标和上下文选择，不设自然语言路由或强制澄清。省略scope为library仅保持旧调用兼容，单次调用失败不会暗换来源。当前均为saved-only，Agent读的是已保存内容，成功写入即保存；编辑器草稿继续由Viewer管理。

## 工具契约

- `path` 支持当前scope的绝对或相对路径，父目录必须存在。library相对路径使用显式绝对`basePath`，省略时按本轮当前目录ID读取权威路径，无当前目录则以`/`为基准；`..`不能越过资料库根。host相对路径必须显式提供当前平台绝对目录或`~/`形式的`basePath`，缺失时返回可操作错误，不使用应用进程cwd。绝对path不依赖basePath，但提供的base仍须合法；`~/`、Windows盘符等本机形状不会被当作资料库相对路径或自动改变scope。
- main在资源授权、审批和执行前只解析一次并冻结规范绝对目标，移除basePath；审批审计、prepare、renderer请求和私有写入快照复用同一执行输入。执行侧克隆规范输入，与已预算的模型原始toolCall分开；不得原地修改Provider历史参数而使上下文预算失准。原始和规范输入均检查敏感信息及审计限额，不能用归一化消失的字段绕过审计；拒绝时仍同步安全投影清除原始历史中的敏感输入。该解析器负责逻辑/原生路径归一，现有executor仍负责文件身份和版本复验；未新增跨Run稳定ref。带相对header的patch先验证header对应原结构化path，再绑定规范目标，冲突header继续由严格解析器拒绝。
- write接受完整UTF-8正文，最多32000个UTF-16 code units；省略revision为create、不覆盖同名。可显式mode=create/replace；替换必须提供file.read返回的revision或expectedRevision，两个字段不可同时提供。
- patch仅修改现有单文件，使用同一版本条件与unified-v1精确行号/上下文。标准header可省略，提供时必须对应结构化path；支持无尾换行标记，不模糊匹配、跨文件、创建或删除。源/结果均最多8 MiB，保留BOM、未修改行的原始换行，新增行沿附近换行。
- 两端共用codec及补丁引擎。新建/替换/补丁均保留已有权限策略，full-access不绕过身份/版本/系统用户权限。版本冲突重新读取；unknown先核对，不盲目重试或换通道重写。

## 执行与提交

可信main注册身份为`builtin:file.write@2`、`builtin:file.patch@1`，插件同名/伪造注册不授予提交能力。main给每次调用绑定独立operationId与owner/库/Session/Run/ToolRun；host直接执行，library通过原有renderer broker调用条件保存/上传。

library替换先核对原始字节，再以私有storageKey条件调用保存端点；旧后端404不回退无条件更新。新建保留健康Provider路由、staging、上传init/PUT/complete链及finally清理；不把不可达默认Provider当作唯一可选目标。已有文件保持原存储身份，不通过换Provider绕过旧内容/版本检查。

提交前executor必须把真实before/after交给main私有journal。library的`agent:file-change:prepare`一次性能力绑定当前execution；main检查path、版本、编码、授权写入正文或补丁结果，并通过权威元数据与正文重验现有文件。准备失败不写文件，快照不进入Tool结果或模型续轮历史。原始模型content/patch仍按现有审计规则处理。

host只处理普通单硬链接文件；复验lstat/realpath/open身份与原始字节hash，在应用串行队列中通过同目录临时文件、fsync及exclusive-create/rename提交，再读回验证。保留mode/owner，ACL/xattrs等扩展元数据尚未保证，结果明确warnings。compare+rename不是对任意外部写者的CAS，不承诺跨进程绝无覆盖竞争；Windows/Linux真机尚未验收。

`writeCommitState/mutationCommitState`区分committed/uncommitted/commit_unknown，operationId为main绑定。进入提交边界后renderer取消保留最多30秒结算，外层main等待35秒。规范回执先由Broker同步接受，再异步结算journal；已经封存的unknown不被迟到成功覆写。写后目录刷新失败不逆转committed。

成功library写入继续经既有内容变更事件更新匹配tab和目录，不创建第二套树/tab状态。Viewer返回时处理真实草稿冲突；不在Agent页面弹全局草稿框。普通编辑器保存仍校验原始版本并条件提交。

## 独立Diff与保留

Agent用时行“改动N”打开独立列表/统一Diff，不进入文件tab。SQLite存元数据，私有磁盘存不可变before/after；不依赖Git，也不从当前文件反推历史。仅覆盖file.write/patch，Shell写入可能未收录。

每文件8 MiB、Run64 MiB、owner512 MiB，记录数Run1000/owner20000；已结算7天、unknown14天，活跃操作不清理。过期保留摘要，Session删除通过同事务outbox安排物理清理，失败保持占用并重试。快照落库失败不会声称有Diff，也不在已提交后自动重写。不是备份、同步版本库或自动撤销。

同Run、nodeId、path及revision连续的library已提交链可看净Diff与单次；host仅单次。查询最多16个实际Run、200条并标明截断；Diff有计算/输出预算，大差异显示限制。

## 验证

自动化覆盖共享codec/BOM/混合换行/EOF/大文件、版本冲突、host真实临时文件提交、取消与sealed迟到回执、私有IPC/preload/正文绑定、SQLite身份隔离/配额/TTL/重启/删除outbox、真实main-to-renderer broker接线及独立UI。全量结果与本机非首资料库验收见[验证矩阵](frontend-validation-matrix.md)。

2026-09-10历史验收已确认win资料库file.write会避开不可达win-minio，选择健康local-minio。2026-10-21新增能力的真实验收另记，不把旧write验收等同于patch/Diff验收。
