# AT2 插件 Tool 故障与恢复

更新时间：2026-09-22
状态：AT2 在 macOS 开发环境的既定范围已验证完成。覆盖代码修复、自动故障矩阵、原生隔离实验及实际界面的离库取消；不扩展到Windows/Linux或发行包。

## 验收范围

在 AT1 真实调用完成的基础上，验证只读插件 Tool 的故障、管理操作与 Agent 审计能收口：撤销读取/Tool批准、停用、安全模式、升级/回滚/卸载、超时、渲染进程崩溃、死循环、非法或超额输出、资源版本变化、重复/迟到结果、槽位争用，以及离开库工作区时的取消。

故障包与慢资源全部放在隔离临时 profile，不安装到用户已有配置；不对真实文件做删除、版本改写或故障注入。成功查询证据沿用AT1；本轮另使用真实模型触发一次文件授权等待，验证实际离库取消。

## 完成条件

- 故障来源可解释，不能把崩溃记成用户取消，也不能把取消后的迟到成功写回。
- 每次调用只允许一个合法终态；重复RPC仅得到错误，不得抢占第一条合法结果。
- 包更新后旧Run/调用不能换成新实现，新增版本重新启用并分别批准能力；回滚也不恢复可重放的旧授权。
- 结束后调用、运行计数、WebContents、父窗口view/监听和session槽位回基线；固定槽位占满时明确拒绝，释放后可继续使用。
- 主窗口及其它Viewer仍可操作；坏插件被隔离且重启安装记录仍反映故障。
- SQLite中的插件来源、失败/取消/中断记录可以恢复，不残留running/preparing ToolRun。
- 同库Agent/Viewer/工具/设置模式切换不取消纯main任务；离开LibraryDetail、切库或账号变化时取消旧owner运行。该桥只消费既有路由/Auth事实，不新增会话状态源。

## 本轮发现与修复

1. `PluginManager.stopped` 的故障隔离广播原先会同步触发通用取消，覆盖真正的renderer-gone原因。广播现区分普通管理操作与fault，runtime/service传递非用户故障原因，Agent按失败展示。
2. 第二条tool.complete/tool.fail原先能在首条等待授权时触发execution.reject。Broker现按exchange独立所有权与open/pending/settled状态控制终态，只有占用者失败可以拒绝主调用；重复ID和重复终态不得改写第一次结果。
3. 原UI切换scope只显式收口renderer执行，普通离库路由没有释放pure-main插件Run。新增 `AgentLibraryRunLifecycle`，位于AuthProvider内、路由Suspense外，从现有Auth和精确 `/libraries/:id` 路由派生scope，只在已提交旧非空scope改变时调用既有releaseOwner。Ref仅记录上次提交，不另存Session/Run事实。初次挂载、StrictMode重放、同scope重挂及同库模式/query/hash变化不取消；离库、切库、回收站、账号/后端变化或登出取消。释放失败只记录错误，不在新scope迟到重试。

## 验证方法

- `node tools/plugin-isolation/run.mjs --at2`：真实Electron/沙箱/PluginManager/ToolRuntime，合成资源和临时故障包；旧CSV Viewer作为隔离对照。
- `agent-plugin-faults.test.ts`：真实Manager/Service/Orchestrator/Guard/SQLite，模拟模型和可控执行器，覆盖管理变更与审计终态。
- `plugin-tool-cleanup.test.ts`：精确复现本轮两个竞态，修复前必须失败、修复后通过。
- 库工作区生命周期由路由/Auth驱动的组件测试验证；同时保留同库模式切换路径。

本阶段的循环测试是有界资源回基线检查，不以短时循环宣称小时级RSS稳定。发行包、长期压力与其它平台依旧单列后续事项。

## 已验证结果（2026-09-22）

- 全量2834项通过、7项跳过；lint、TypeScript、生产构建及diff检查通过。
- macOS Electron 30.5.1 原生AT2实验63项断言通过，约13.2秒。验证真实崩溃、死循环、管理操作、版本/输出错误、四槽争用、12次启停以及旧Viewer共存。
- renderer crash保留`UNAVAILABLE`，manager诊断为renderer-gone；死循环由heartbeat-timeout停止并隔离。两者不会再伪装成用户主动取消。超时fixture约1.5秒结束。
- 40KiB原始请求先被preload拒绝；允许通过信封大小但输出超过32KiB的请求由broker拒绝。未正确提交终态的fixture在声明的1.5秒总预算内结束，不将无输出当成功。
- 原生检查结束后WebContents回到2（主窗口+旧CSV Viewer）、session partition最多4、运行Tool计数归零；父窗口view与resize listener均回基线。
- Agent故障集成16项使用真实Manager/Service/Orchestrator/Guard/SQLite、合成模型和可控沙箱，确认移除/升级的旧目录不能运行新代码，失败/取消不被迟到成功覆盖，关闭重开临时SQLite后来源与终态仍保留。
- 库工作区生命周期9项定向测试覆盖离库、切库、账号/后端变化、同库模式、初次挂载和effect重放。竞态回归覆盖不同requestId和复用requestId的重复终态；服务层另验证fault广播不会变成用户取消。

## 实际界面与剩余项

最后一项实际界面验证已通过：在第三个win资料库（ID 3）新建“询问访问”会话，gpt-5.5直接提出 `example.csv-tools.query` 调用（既有CSV节点18517、limit=3）。出现只针对该文件的“确认读取范围”卡时，没有点击允许，而是点击“返回库列表”，路由从 `/libraries/3` 离开到 `/libraries`。

- 离开后Run立即收口为cancelled，插件ToolRun及agent.access.request也均cancelled，approval_status为cancelled；没有残留running/preparing/awaiting_approval记录。
- 返回win后，同一会话恢复“已停止”“插件已取消”及完整插件来源（ID、0.1.0版本、Tool ID和包指纹），旧批准按钮不再可操作。
- 通过只读SQLite复核，Run终态在返回后没有被迟到结果反转；插件结果为ok:false、“Agent Run 已取消”，未返回CSV数据。文件未修改，也没有打开Viewer或安装故障包。
- 实际Session：`f355bcc9-d6c7-4cb5-b7e1-3bb485ddf14d`；Run：`34027aa9-230a-4d6e-8e56-d7ecf91d8e95`；插件ToolRun：`009664d2-9f07-43a9-94a3-75f8a6f89dad`。审计与该测试会话保留供复测。

这次实际UI验证发生在权限检查等待阶段；执行中的崩溃、超时、迟到成功和管理变更由63项原生断言与16项Agent故障集成覆盖，不把批准前取消冒充真实文件传输中的故障注入。此次补验只修改验收文档和证据，不重复运行此前已通过且代码未变化的全量测试/构建。

原生fixture仅约13秒，不能据此宣称小时级RSS无增长。发行包、长期压力、Windows/Linux仍未验收。本轮没有修改SDK wire/清单版本、用户文件或真实插件安装记录。运行时stop原因是main内部广播扩展，不增加插件可调用接口。
