# 标签管理前端说明

更新时间：2026-10-02

适用范围：`src/features/tag-management`、`src/views/tag-management`、资源标签选择器与节点直接标签 API。

## 1. 当前结构

内容标签属于资料库。标签管理页面管理当前所选资料库的词表，节点标签以 `node_tag_rel` 为权威关系；标签与内置类型、归档模式分别表达内容分类和资源组织形式。

标签定义核心字段：

- `id / libraryId`：稳定标识和所属资料库。
- `name`：标签名称。
- `dimension`：可选分类；`custom` 在界面显示为“未分类”。内置选项提供作者、语言、题材、系列等建议，也支持输入自定义分类（包括中文）。
- `color / textColor`：标签自身的主色与可选文字色。
- `description / sortOrder / enabled`：说明、排序和是否允许新选取。
- `deleted`：已删除定义的回显标识。已绑定资源仍可显示名称并移除该关联，不再出现在新选取列表中。
- `legacy`：尚未迁入库词表的旧定义。服务端授权后以请求资料库的 `libraryId` 投影返回；管理页只读，不允许编辑、启停或删除，选择器只支持已选关系回显与移除。

历史 `type / scope / resourceKind / targetKinds / targetKey / ownerUserId` 类型字段仅为兼容保留，不参与新标签管理的表单或选择逻辑。漫画、音频、ASMR 不再有互不相通的标签词表。资源类型仍由节点配置表达。

历史 `FILE_TAB` 映射不再出现在标签管理页。当前文件预览 tab 已复用目录树图标，没有恢复该映射消费者。

## 2. 服务端分页 API

统一入口：`src/features/tag-management/services/tag.api.ts`。

| 方法 | 契约 |
| --- | --- |
| `queryLibraryTags(input)` | `GET /v1/tags`，必传 `libraryId`，可传 `keyword / dimension / limit / cursor / ids / nodeId / enabled`；返回 `{ entries, hasMore, nextCursor? }` |
| `createLibraryTag(libraryId, payload)` | `POST /v1/tags`，资料库和核心定义字段写入 body |
| `updateLibraryTag(libraryId, id, patch)` | `PUT /v1/tags/:id`，真实补丁语义；启停仅发送 `libraryId + enabled`，避免覆盖其他窗口刚修改的字段 |
| `deleteLibraryTag(libraryId, id)` | `DELETE /v1/tags/:id?libraryId=...` |
| `readNodeTags(nodeId, libraryId)` | `GET /v1/nodes/:id/tags?libraryId=...`，返回权威直接标签 ID 与节点范围 |
| `updateNodeTags(nodeId, input)` | `PATCH /v1/nodes/:id/tags`，body 为 `libraryId / addTagIds / removeTagIds`；可选 `dryRun` 转为 query `?dryRun=true` 并解包预演回执，返回最终标签关系状态 |

分页默认 50、最大 100。前端传递服务端游标，不推算总数，不自动循环读完词表。关键词由服务端筛选；前端输入仅做 250 ms 防抖。每页返回的标签必须属于请求资料库，继续分页必须有有效游标，错误响应不能降级为“空列表”。旧定义由服务端授权投影为当前库的 `libraryId + legacy:true`；前端拒绝空或其他资料库的归属，不将遗留定义放入新增候选词表。

`ids` 每次最多 100 个，专用于补齐已知标签的名称和颜色，不带 `enabled` 筛选，以便回显停用或已删除定义。空 `ids` 直接返回空结果，不意外变成全库查询。

节点接口校验 `nodeId / libraryId / parentId / tagIds / affectedParentIds / dryRun`。真实写入不能接受预演回执。手动编辑只提交用户相对于打开时快照的增删差集，不用完整 `viewMeta` 标签数组覆盖关系。

旧 `fetchTags / createTag / updateTag / deleteTag` 包装保留为历史兼容代码，新资源消费者不得使用无资料库范围的旧调用。

## 3. 页面与状态边界

标签管理入口仍是设置页“标签管理”：

- 在资料库工作区中打开，初始选择当前路由的资料库。
- 独立设置页没有资料库上下文时，必须由用户选择，不擅自选列表第一项。
- 资料库列表每次读取 50 条，后续由“更多资料库”显式加载；测试环境选择规则不写入产品逻辑。
- 切库会重建该库的列表与编辑器，清除查询、翻页游标和未提交草稿；旧库异步响应不能写回新库，也不能关闭新库的编辑器。
- `useLibraryTagPage` 只拥有当前页和游标历史。资料库、关键词、分类改变时回到首屏；列表渲染不携带虚假总量或全量分类计数。
- 变更成功从首屏刷新，避免旧游标因改名、排序或删除造成遗漏。
- 表单只需要名称；分类、说明、文字色和排序可选，保留启停、主色色盘 1～5 明暗档和完整取色器。
- 编辑提交期间锁定表单，避免提交中新增草稿被成功回调清空。
- 编辑已有标签保留打开时基线，只提交用户修改的字段，避免修改颜色时覆盖其他窗口刚改的名称或启停状态。清空说明和文字色统一发送空字符串；后端也接受显式 `null` 清空，省略字段才表示保留。
- 标签说明上限为 255 个 Unicode 码点，前端计数与截断不拆分代理对。

标签颜色是用户内容，保持固定色；容器、表格、按钮、焦点和说明文字消费共享主题。编辑框使用 `CompactModal`，复杂双色表单显式采用 560 px 宽度，保留共享紧凑标题与 footer。

## 4. 通用选择器

`LibraryTagPicker` 的受控属性为 `libraryId / valueIds / onChange`，可选 `disabled / placeholder`。

- 关闭时只读取已选 ID；打开后按需读取一页可用标签。
- 弹出层内输入搜索、上一页和下一页只改变候选列表，不能丢掉其他页的已选值。
- 已选项按明确 ID 分组读取，每组最多 100 条；这不是遍历整个词表。
- 停用、删除或无法补齐名称的关系仍保留 ID 回显；只有显式移除才产生删除动作，不能因为词表过滤而自动丢弃。
- 切换资料库重建选择器，过期的候选和名称响应被忽略。
- 选择器只管理选择草稿，持久化与节点刷新由调用方负责。

## 5. 验证与后续边界

本次局部自动测试覆盖：服务端过滤与游标透传、跨库响应拒绝、增量定义更新、真实节点回执验证、未选库不请求、切库与搜索过期响应、编辑草稿清理、选择器按 ID 回显及跨页保留选择。

2026-10-02 整批 `npm run lint`、`npm test`（3505 项通过、7 项跳过）及 `npm run build` 通过。新增局部测试另覆盖 20 项管理页、分页与选择器行为。真实界面验收时 macOS 锁屏，亮暗主题、实际弹层布局和 ASMR 交互尚未验证，不能用组件测试替代此结论。后续手验仅使用非第一个资料库，优先本机可用的 Win 库；记录见[前端验证矩阵](frontend-validation-matrix.md)。

前端本批不引入标签继承、跨库同义标签自动合并、复杂分类树或 AI 专用审批平台。普通文件/目录的入口、Agent 与 ASMR 接线以各自专题及当前实现为准；新增消费者必须复用上述库范围分页与节点增量接口。
