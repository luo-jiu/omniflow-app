# B1 命令、菜单与工具贡献入口

更新时间：2026-09-14

状态：**B1 已验证完成（可信内置贡献范围，桌面验收平台为 macOS）**。总体进度见 [实施计划](plugin-system-implementation-plan.md)。当前是可信宿主的内置贡献机制，**没有开放第三方脚本加载、安装或公开 SDK**。

## 1. 当前实现与边界

[ContributionRegistry](../src/features/extensions/contribution-registry.ts) 提供批量注册、稳定快照、订阅与移除。[HostCommandRegistry](../src/features/extensions/host-command-registry.ts) 在此基础上提供命令 ID、标题、有限参数 schema、可用条件和宿主执行入口。

输入预检全部完成后才发布一批贡献。重复 ID、跨 owner 命名空间或非法描述拒绝整批；失败不会留下已处理的前半批。单批最多 128、单 registry 最多 1024 个贡献。每次成功变化只发布一个新快照，读取不重复分配数组；取消订阅后不再通知。disposer 幂等且绑定该次 batch，旧清理不能删除后来注册的同 ID 项。

命令当前只允许 host-only，参数 schema 为 none 或 id；执行时再次验证参数和上下文可用性。没有外部插件调用入口或可用权限白名单。`executeHost` 和 owner 字符串用于可信模块组织，**不是身份认证或插件安全边界**；未来 SDK 必须在真实宿主消息层绑定来源/授权，不能把调用者自报 host 或 owner 当许可。

注册记录不拥有业务任务。B1 的移除只移除贡献，不能被宣称为已经实现插件实例停用、强制停止或任务取消；这些仍由既有业务 owner 及后续宿主阶段负责。

## 2. 工具注册与渲染

- [工具定义](../src/features/tool-workspace/tool-definitions.ts) 保留五个既有工具 ID、标题和默认顺序。旧 ID 不强制改名，避免本地草稿和同步布局失效。
- [工具注册表](../src/features/tool-workspace/tool-registry.tsx) 组合元信息、图标与 View。五个原工具通过内置适配注册，导航和工作区通过同一 registry 快照投影。
- `ToolWorkspace` 保持字幕草稿、翻译 hook、媒体资源/请求和布局交互 owner，只将当前上下文交给注册的 View；不再按每个工具 ID 编写渲染分支。
- [工具命令](../src/features/tool-workspace/tool-commands.ts) 的 omniflow.tools.open 接收受控 ID，确认目标仍已注册后，调用工作区原 open/setState 路径。
- 新增 namespaced 内置贡献只需在可信模块注册 id/title/icon/View，不为该 ID 修改导航或主壳分支。旧 ID 仅允许 omniflow owner 使用；新 ID 必须位于相应 owner 命名空间。
- 当前被移除工具的选中 ID 保留，界面显示不可用提示，用户可选择其他工具；再次注册同一 ID 后可恢复。没有通过清除 activeToolId 丢失用户选择。

`ToolContributionContext` 含宿主内部 React/字幕/媒体类型，仅用于已有内置功能适配，不是第三方 SDK。静态内置导入暂时保留，按需运行与第三方隔离仍按 C1/C2 推进。

## 3. 顺序与持久化兼容

[布局归一化](../src/features/tool-workspace/tool-workspace.layout.ts) 保留既有 ID，以及长度最多 128、格式合法的 namespaced ID。损坏 ID 和重复项丢弃；五个默认工具仍按既有顺序补到末尾。布局字段、namespace 和 schema v2 不变。

保存顺序与可见顺序分开：未注册 ID 留在持久化中但不渲染；新注册 ID 追加到可见列表。DndKit 仅接收当前可见 ID，拖拽后合并可见槽位，保留不可用贡献位置。例如保存 `[A, missing, B]`，重排可见项为 `[B, A]` 后保存 `[B, missing, A]`。

工具状态归一化同样保留合法 namespaced activeToolId；字幕正文、译文、暂停/恢复语义不变。旧客户端仍可能过滤其未知 ID；此处保证升级后的客户端行为，不承诺旧二进制具备新归一化规则。

## 4. 目录命令与菜单

[directory-commands.ts](../src/features/file-explorer/directory-commands.ts) 集中定义 12 个基础命令、稳定 ID 和原动作映射，覆盖新建、上传、重命名、属性、下载、浏览器打开、媒体工具、刷新、迁移与删除。

菜单通过稳定插入位置声明顺序：root.create/upload、folder.create/info/upload/download/refresh、file.basic、common.migrate/delete。位置内顺序来自只读声明，可用条件限定 root/folder/file 和媒体文件事实，不解析任意表达式。分隔线和复杂类型/归档子菜单继续由原宿主编排。

菜单条目向 overlay 结果传递 omniflow.node.* 命令 ID。DirectoryTree 收到结果后使用原先捕获的节点上下文，通过 registry 转回原 `handleAction`；不信任菜单回传另一个节点参数，不新增 IPC channel，不绕过原确认、后端事务或错误处理。

旧中文动作和动态类型/排序动作保留兼容；未知 namespaced 命令明确提示不可用。删除等命令仍 host-only，注册并不让插件取得执行权限。基础媒体菜单条件沿用原 MIME/扩展名策略，不替代 file-identity 事实解析器。

当前目录菜单位置是内置静态声明，不是已发布的动态菜单 SDK；新增开放位置时需在本专题冻结语义，再由后续宿主做贡献生命周期和权限适配。

## 5. 验证与维护

自动覆盖：批次原子性、重复 ID、owner 命名空间、快照稳定性、旧 disposer、取消订阅、参数/可用性执行检查、原动作一次性映射、隐藏 ID 排序保留和旧草稿 fixture。

[工具集成测试](../src/features/tool-workspace/tool-contribution.integration.test.tsx) 使用实际注册表、导航、命令和 ToolWorkspace，注册 example.inspector，点击打开、移除并重注册，验证主壳不需专用分支且选中状态保留。测试替换了业务重组件与 UI 库 Tooltip，不代表真实工具操作已完成端到端验证。

最终检查：`npm run lint`、`npm test`、`npm run build` 均退出 0。测试 361 文件/2500 项通过，3 文件/7 项跳过。新增持久恢复用例直接从合成本地记录读取不可用工具 ID，并确认字幕草稿名称保留；没有通过修改旧 fixture 来规避兼容失败。

实际桌面验收使用资料库列表第三项 win，没有进入第一个资料库：

| 场景 | 结果 |
| --- | --- |
| 五个原工具打开 | AI 服务配置、字幕、资源捕获、媒体文件、QQ 歌词视图均出现；未启动翻译、下载或处理任务 |
| 既有状态与空态 | 字幕导入/开始入口、资源空态、媒体文件未选择提示、歌词搜索入口保持 |
| 键盘重排 | 展开到 208px，以 Space/Down/Space 移动 AI 服务配置，导航顺序更新 |
| 刷新恢复 | 刷新 renderer、重新进入工具区，已调整的顺序恢复 |
| 恢复原设置 | 重排回 AI 服务配置/字幕/资源捕获/媒体文件/QQ 歌词，恢复选中 AI 服务配置，并将导航恢复为 57px |
| 原生文件菜单 | 顺序、标签、类型子菜单与删除危险项仍存在 |
| 稳定命令执行 | 点击属性，经新命令 ID 路径打开原文件属性窗口，名称确认为所选合成文本；Escape 取消 |
| 无破坏性动作 | 未改名、删除、上传或处理真实资料库内容；其他基础命令映射由隔离 spy 测试验证 |

Windows/Linux 未作本轮桌面验收。动态工具样板证明内置注册复用，不代表第三方独立打包、运行隔离或插件停用契约已完成。

后续新增贡献必须说明：ID/位置、状态 owner、参数、移除后的用户路径与验证证据。不能把本批注册表计为完整插件化完成。
