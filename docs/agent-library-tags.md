# Agent 资料库标签工具

更新时间：2026-10-02

## 当前结论

新增工具模块与 renderer 执行器，未修改共享注册、权限 gate、broker 或聊天 UI。
`getAgentTagTools()` 返回 `tag.list` 和 `tag.update`；`executeAgentTagTool(request, deps?)` 返回既有 `AgentRendererToolOutcome`。

## 读取契约

- `tag.list({ nodeId?, keyword?, dimension?, cursor?, limit? })` 是 renderer/read 工具，assess 直接 allow。
- 查询定义属于当前资料库，遵循资料库权限；不再按标签创建者 owner 或 ASMR/音频等资源类型拆词表。`dimension` 是可扩展的语义分类，不限定绑定对象。
- 服务端 `GET /tags?libraryId=...` 完成名称搜索、分类过滤与游标分页；renderer 不下载全部词表、不排序/哈希整份目录，也不提供精确 total。
- limit 默认和最大均为 10。返回 entries、hasMore、nextCursor；续页原样传 cursor，并保持 nodeId/keyword/dimension 不变。旧 offset/revision 参数已移除。
- 整个成功结果 JSON 的 UTF-8 字节数不超过 8000。保留服务端整页与其游标，不截短返回数组后继续使用原游标；异常大页明确失败，提示减小 limit 并使用相同 cursor 重试。
- 无 nodeId 时查询当前资料库已启用资源标签，来源为 `library_resource_catalog`；不投影历史 type/resourceKind/targetKinds。
- nodeId 必须来自当前库已感知节点。main 冻结 target，renderer 使用 metadata query 重验，然后通过标签目录 nodeId 过滤正式直接绑定关系。来源为 `node_tag_rel`，返回 `authoritativeRelations=true`，不读取 viewMeta 标签投影。
- 节点模式不添加 enabled 过滤；停用及服务端保留的已删除绑定仍显示其 ID、名称、enabled/deleted，能够明确移除。旧定义仅在请求库已有关系时可见，服务端标记 `legacy=true`；该定义只读且不可新增绑定，允许移除现有绑定。普通目录搜索不会暴露其他库标签。
- 每个请求前后校验 signal 与 owner，页内各标签也重验 libraryId；节点 metadata、存储地址和整个 viewMeta 不投影给模型。

## 原子增量写入

`tag.update({nodeId, addTagIds?, removeTagIds?})` 是 renderer/write 工具，assess ask，由统一 full-access gate 决策。
每组最多 100 个正整数 ID，两组至少一个 ID，无重复或交集；只操作已有标签关系，不创建或删除标签定义。

PATCH `/nodes/:nodeId/tags` 仅传 libraryId/addTagIds/removeTagIds，不传全量标签或 viewMeta。
后端 usecase 事务内锁定节点，校验指定标签与节点属于同一资料库，新增要求标签可用；未指定关系不改动。文件、目录与作品共用库内标签，不再按历史资源域作硬性绑定限制。
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

`node_tag_rel` 是唯一关系事实源。节点配置 PUT 不再接受 viewMeta.tagIds 作为关系替换请求；旧 viewer 的陈旧配置不能覆盖增量标签。ASMR 也已使用同一增量接口，标签选择过程见 [ASMR Viewer](viewers/asmr-viewer.md)。

## 验证

标签工具专项覆盖服务端查询参数/游标透传、禁用绑定保留、非法/跨库回执、完整页的 8KB 边界、owner 漂移/取消、提交三态、事件顺序与最新节点感知。服务端游标失效与索引性能在后端验证；不再以 renderer 的全量快照散列提供稳定性。

ASMR 保存专项覆盖编辑差集保留并发新增、仅标签变更不写配置、未改字段保留、版本条件更新、部分成功不重放及结果未知中止。完整集成与非第一个资料库的 UI 验证状态以本轮交付记录为准，不能复用历史测试结论。
