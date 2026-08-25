# Cat Catch Lab

当前目录先落地 `G0` 合同校验器。fixture server、pinned oracle 和 Electron smoke 会在 `G2` 继续加入，不能因为目录存在就认为 Lab 已完成。

## 声明预检

```bash
npm run cat-catch:validate
```

该命令完成以下检查：

- 编译全部本地 JSON Schema，禁止远程 Schema 加载。
- 校验声明性输入和跨文件引用。
- 将 Cat Catch 的 `observedHead` 绑定到 `refs/remotes/origin/master`，并校验所有游标都处于 `baselineCursor..observedHead` 的祖先链上；运行前应先执行 `git fetch origin`。
- 从声明的精确 Git commit blob 读取上游与本地 source ref，核对 path、SHA-256、anchor、`introducedBy` 祖先关系及引入提交是否实际修改该 path，不使用同名 worktree 文件兜底。
- 从精确 commit 的 Git tree 条目生成稳定 input hash，覆盖 mode、symlink 与 gitlink；候选 worktree hash 还会纳入未跟踪输入，`report-index` 作为派生输出不进入 input hash。
- 从精确 source/API 信号派生 cross-process、credentials、temp-file、external-process、MSE/HLS/DASH 等风险，再应用不可削弱的 canonical risk rules；ledger 只能追加风险与证据要求。
- 双向核对 `release-targets.json` 与 `electron-builder.json5` 的平台、包格式和显式 architecture，并校验 release source ref selector。
- 阻止 ledger 保存 pass、freshness、deployment、artifact binding 等派生状态。
- 输出当前 `G0` blocker。

## 信任与晋级边界

从 worktree 运行的结果始终是 `candidate/non-promotable`，无论 worktree 是否 clean。dirty tracked path 和未跟踪输入会产生额外 blocker，但 clean worktree 也不会自动成为正式 evidence。

当前 validator 还没有实现外部 approval / trusted runner attestation 验证，也没有实现读取 canonical artifact 原始 bytes 的正式 resolver、正式 report 生成与 `report-index` 更新；前两项会无条件保留 blocker。durable evidence store 当前也尚未配置，因此 retention policy 会产生 blocker；这个检查目前只核对声明配置，不验证 store 的真实可达性或生命周期，不能把“填了 store”解释为正式 availability evidence。

正式 evidence/Gate 必须由后续 formal runner 从精确 Git commit 对象读取全部输入，验证可信 validator bundle、外部 approval、runner attestation 和 canonical artifact hash，并把必要产物写入满足 retention policy 的 durable store。

只要 `G0` 仍有 blocker，该命令就以非零状态退出；`structuralStatus=passed` 只表示当前声明结构自洽，不表示 Gate 通过。

## 精确提交的 Local Closure 候选

```bash
npm run cat-catch:generate-local-closure -- --commit <完整 40 位 commit SHA>
npm run cat-catch:generate-local-closure -- --commit <完整 40 位 commit SHA> --json
npm run cat-catch:generate-local-closure -- --commit <完整 40 位 commit SHA> --output tools/cat-catch-lab/artifacts/manual/local-closure.json
```

生成器只从指定 commit 的 Git 对象读取 contracts、inventory、schemas 和 tracked source，不会在 blob 缺失时回退到同名 worktree 文件。`sourceManifest` 覆盖该 commit 的完整 tracked blob tree，并按原始 bytes 记录 mode、长度和 SHA-256；`docs/cat-catch/report-index/**` 是防止证据哈希递归的唯一固定排除项。exact-commit profile 仍加载全部 report-index schemas 供引用编译，但完全不读取 `report-index/index.json` 数据；删除或损坏派生索引不能改变 closure 是否可生成。生成器和 CLI 也不会写入或更新该目录。

所有 inventory current-node 的 path、source hash、capability/cutover 映射和带 symbol 的 AST locator 都会在该 commit 的 blob 上重新验证。JSON、Git path 和源码必须能无损解码为 UTF-8；非法 bytes 不会先替换成 U+FFFD 再继续。只有解析为唯一真实 locator 的 bootstrap root 才会进入 `discoveredNodes` 并标记为 `reachable`；missing、ambiguous、parse-error、unsupported-language 和非法编码都 fail closed。null、未知或归属不一致的 capability/cutover pair 进入 `unmappedInScopeNodes`。当前还没有实现 AST static/import/call discovery、反向依赖遍历、semantic scan 和 least-fixed-point closure，因此其他已登记且映射有效的节点逐项标记为 `closure.current-node-reachability-undetermined` blocker，不冒充 `unmappedInScopeNodes`，也不声明为 `unreachable`。

Declared dynamic edge 只有在 typed source/target locator 和声明 source hash 都匹配 exact commit 时才进入 `declaredDynamicEdges`；hash 过期会转入 `unresolvedDynamicEdges`。approved exclusion 必须反向唯一绑定真实 semantic/historical candidate，不能把 exclusion id 冒充 candidate id。当前 report schema 仍无法完整编码 `locatorKind`、historical `lastKnownCommit`、tombstone attribution 和 external-process 虚拟端点，因此候选报告保留 `closure.schema-projection-incomplete` blocker。

`validator.sourceManifestHash` 绑定实际执行这次命令的 worktree validator bundle。被分析 commit 中的 validator bundle 则由 exact-commit manifest 单独派生；两者不一致时报告包含 `closure.validator-bundle-not-at-input-commit` blocker。这里读取 executing worktree 只用于如实记录执行 provenance，不会成为 contracts 或 source 的输入 fallback。

生成完成前会同时运行 exact-commit JSON Schema 校验和候选语义校验。成功产出的报告仍固定为 `status=blocked`、`candidate-untrusted`、`approvalRef=null` 和 non-promotable；schema-valid 只表示报告结构与绑定自洽，不表示 closure complete。`--json` 向 stdout 输出完整 canonical JSON。默认输出为 `tools/cat-catch-lab/artifacts/local-closure/<canonical bytes SHA-256>.json`；`--output` 的相对路径以 `--root` 指定的 app root 为基准，并且仍只能位于该 app root 的 `tools/cat-catch-lab/artifacts/` 子树。目录会自动创建；完整 bytes 先在同目录临时文件写完并同步，再原子发布最终路径。同路径已有相同 bytes 时直接复用，内容不同时拒绝覆盖，symlink 越界也会 fail closed。`generatedAt` 是报告内容的一部分，因此同一 commit 的独立重跑通常会生成新的 content-addressed candidate；固定 `--output` 只适合发布同一份 bytes，不会静默覆盖较早报告。成功生成 blocked candidate 返回状态码 `1`，参数、输入或写盘失败返回 `2`。

这里的路径和 symlink 校验用于阻止静态越界与普通误配置，不把同一 UID 的恶意进程在检查和发布之间并发替换父目录视为安全边界。正式 runner 必须使用其他同 UID 进程不可写的隔离 workspace/artifact root，或改用提供 directory-fd、`openat`/`linkat` 与 no-follow 语义的受信任 publisher；本地候选 CLI 不能凭这些检查晋级为正式 evidence。

## 生成物

本地候选产物只能写入目标 app root 的 `tools/cat-catch-lab/artifacts/`。该目录被 Git 忽略，不能作为正式 evidence 的唯一存储，也不能手工复制进 `report-index` 冒充晋级产物。
