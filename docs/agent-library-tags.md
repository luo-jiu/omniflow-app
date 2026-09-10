# Agent 资料库标签工具

更新时间：2026-09-10

## 当前结论

新增工具模块与 renderer 执行器，未修改共享注册、权限 gate、broker 或聊天 UI。
`getAgentTagTools()` 返回 `tag.list` 和 `tag.update`；`executeAgentTagTool(request, deps?)` 返回既有 `AgentRendererToolOutcome`。

## 读取契约

- `tag.list({ nodeId?, keyword?, offset?, limit?, revision? })` 是 renderer/read 工具，assess 直接 allow。
- limit 默认 100、最大 100；offset 默认 0、最大 100000。返回 entries、total、hasMore、nextOffset、revision。
- 整个成功结果 JSON 的 UTF-8 字节数不超过 8000，实际数量可少于 limit。普通条目与 unresolvedTagIds 按 ID 合为同一序列，共享预算和游标，total 包含两类。
- nextOffset 严格按本页实际条目数推进；offset>0 必须原样传上一页 revision。SHA-256 绑定规范 owner、library、node、keyword 与完整投影快照；数据或查询变化则拒绝续页，要求从头查询，不静默跳项。
- 未知标签没有可搜索名称，keyword 仅筛选已解析条目，未知 ID 仍保留在共同分页序列中；单个条目本身超过预算时明确失败，不偷偷丢字段。
- 无 nodeId 时列当前账号可见的已启用 resource 标签，不声称标签定义属于当前库或都能贴到当前节点。targetKinds 描述配置的可贴对象。
- nodeId 必须来自当前库已感知节点。main 冻结 target，renderer 使用 metadata query 重验，再读取正式关系。
- 节点模式使用新 GET `/nodes/:nodeId/tags?libraryId=...`，来源是 `node_tag_rel`，返回 `authoritativeRelations=true`，未知、禁用或不可见标签保留为 unresolvedTagIds，不返回其他 owner 的标签信息。
- 每个请求前后校验 signal 与 owner。节点 metadata、存储地址和整个 viewMeta 不投影给模型。
- 标签目录 API 本身不支持后端分页；本轮只对模型输出分页，revision 防止跨次快照变化导致 offset 结果跳项。

## 原子增量写入

`tag.update({nodeId, addTagIds?, removeTagIds?})` 是 renderer/write 工具，assess ask，由统一 full-access gate 决策。
每组最多 100 个正整数 ID，两组至少一个 ID，无重复或交集；只操作已有标签关系，不创建或删除标签定义。

PATCH `/nodes/:nodeId/tags` 仅传 libraryId/addTagIds/removeTagIds，不传全量标签或 viewMeta。
后端 usecase 事务内锁定节点，校验指定标签 owner，新增复用既有 target policy 校验；未指定关系不改动。
`node_tag_rel` 为正式关系，读取最终关系后仅同步 `view_meta.tagIds`，保留其他字段及大整数精度。
后端 HTTP、dry-run 与 CLI 详见 `omniflow-go/docs/architecture/node-tag-delta.md`。

提交前 broker committing，生产调用 reportAgentToolExecutionProgress，测试可注入 beforeCommit。
后端成功先 onCommitted 记录事实，再检查 owner 刷新目录。
返回 mutationCommitState 三态及可用的 affectedParentIds，刷新或取消不能反转 committed。
提交通知复用 `node-mutation-events.ts` 的 `notifyLibraryNodesMutated`，带 owner/backend/library 与 affectedParentIds；
await 通知并捕获异常维持已提交成功，不修改事件模块。
随后重新读取节点并返回 perception.knownNodes 和 collectedAt，使下一次查询使用最新 updatedAt。
重新读取失败、取消或 owner 漂移仍保留 committed，并提示下一次先 file.stat；不将其他 owner 的感知写回旧 Run。
请求前失败或明确 HTTP 拒绝返回 uncommitted；发出后连接异常、无法识别的回执返回 commit_unknown。
结果未知须先 tag.list 核对，不盲目重试。取消并不等于后端回滚。

旧 `PUT /nodes/:id` 全量 viewMeta 替换契约仍存在，旧 viewer 晚到陈旧数据可能覆盖标签，这是旧接口残余风险；本增量接口不使用旧快照覆盖。

## 验证

15 项专项测试覆盖严格 schema、已感知节点、跨库/owner 拒绝、未知标签保留、8KB 分页、revision 漂移、提交前后取消、失败三态、事件顺序与最新节点感知。
本轮只跑新文件专项 Vitest/lint 与后端标签 usecase/handler/CLI 专项、CLI 构建，不跑全量、不重启服务、不提交。
没有修改表结构，无需迁移或重生成模型。集成方需要用户重新加载新后端后，在非第一个资料库完成真实模型/UI 验收。
