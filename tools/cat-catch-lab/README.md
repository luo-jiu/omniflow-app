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

## 生成物

本地候选产物只能写入 `tools/cat-catch-lab/artifacts/`。该目录被 Git 忽略，不能作为正式 evidence 的唯一存储。
