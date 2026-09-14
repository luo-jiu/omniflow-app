# C1：最小 SDK 与隔离实验

更新时间：2026-09-14

适用范围：独立 SDK、CSV 开发样板、专用 Electron 开发宿主。上位计划见 [插件化实施计划](plugin-system-implementation-plan.md)。

本文保留 C1 实验基线。D1 已将 session 改为固定四槽清理复用，并扩展本地安装、版本隔离与恢复，当前契约见 [D1](plugin-system-d1-management.md)。

## 1. 当前结论

C1 已实现最小 SDK、Manifest 校验、隔离开发加载、资源 broker、设置/阅读快照、生命周期和自动化实验。**自动验证和 macOS 原生视图/浮层/焦点人工验收已通过，C1 按开发实验范围完成。** C1 验收时尚未接入主窗口；后续 C2 已接入第一方固定包，当前事实见 [CSV 完整链路](plugin-system-c2-csv-viewer.md)，第三方安装/执行仍未开放。

当前候选选择 **sandboxed WebContentsView + 每实例独立非持久 session + 独立自定义 origin + 专用 preload**。加载后检查 renderer PID，拒绝与宿主或其他实例共用进程的实例。不能仅凭 `sandbox` 或 `partition` 配置宣称已经获得进程隔离。

实际 Electron 30.5.1 / Chromium 124、macOS 实验中，宿主、CSV、攻击实例获得不同 PID，攻击实例死循环由 main 看门狗独立终止，宿主计时与 CSV 查询继续响应。对照 `sandbox="allow-scripts"` 的 opaque-origin srcdoc iframe 能阻止父 DOM 访问，但与父页面共用 renderer；死循环后父页面在 1.2 秒观察窗口内没有响应。该 iframe 配置因此不作为执行第三方代码的候选。此结果不泛化为所有跨站 iframe 的进程分配结果。

## 2. 实现入口

| 入口 | 职责 |
| --- | --- |
| `packages/plugin-sdk` | 独立 ESM 包、类型、Manifest schema、错误与预算；[SDK 使用说明](../packages/plugin-sdk/README.md) |
| `samples/csv-viewer` | 仅依赖公开 SDK 的静态 CSV 样板；[构建和限制](../samples/csv-viewer/README.md) |
| `electron/service/extensions/manifest.ts` | 包格式/平台/版本/贡献校验、开发目录有界字节快照 |
| `electron/service/extensions/resource-broker.ts` | 真实来源绑定后的能力分派、授权/版本复核、CAS、配额、取消与超时 |
| `electron/service/extensions/isolated-view.ts` | session、协议资源、专用 view、来源门禁、网络/权限阻断、看门狗与回收 |
| `electron/service/extensions/plugin-preload.ts` | 字符串 RPC/事件 transport，没有通用 Electron 能力 |
| `tools/plugin-isolation` | 独立构建、真实 Electron 对照实验、人工开发窗口 |

B1 注册表仍是可信宿主内部 API。B2 的文件识别、打开方式、tab 与阅读 Session owner 没有改为第三方可访问对象。C1 实验默认选 Manifest 第一个 viewer，并要求资源扩展名匹配；C2 再从 B2 显式传入选中的贡献。

## 3. 边界与数据 owner

### 包与兼容

Manifest 使用固定 JSON schema，拒绝未知字段。格式版本、SDK 主版本均只接受 `1`；包版本与最低宿主版本使用三段数字版本，不支持 prerelease/range 表达式。平台必须声明当前平台，入口必须为包内 HTML；viewer ID 必须属于插件 ID 前缀，不能重复；激活条件必须精确对应 viewer。权限目前只有 `resource.read`。

开发加载先校验 Manifest，再逐项验证并快照静态资产。拒绝路径穿越、符号链接、Windows 保留名、未知资产类型和主动 SVG。文件读取有上限，检查读取前后大小/修改时间并使用 `O_NOFOLLOW`；后续协议只服务内存快照，不按 renderer URL 读本机路径。同一宿主将插件 ID 绑定规范化来源目录，其他目录冒用同 ID 被拒绝；同 ID 不允许同时加载不同字节指纹版本，重载须先停旧实例。

这仍是稳定目录下的开发加载器，不是面对并发恶意宿主文件系统修改的安装器。父目录被其他本机进程换成 symlink 等 TOCTOU 场景不作完整安全保证；D1 必须使用受控 staging、不可变安装目录及完整来源/升级策略，不能直接复用开发目录作为可信安装身份。单文件 1 MiB、包总计 4 MiB、64 个文件、128 个目录项、目录深度 8；当前没有 ZIP 解包，解包量在 D1 才能验收。

### RPC 与正文读取

专用 IPC 只接受已登记 WebContents 的真实 main frame 和该实例 origin。身份不来自请求参数。请求 envelope 固定 `version/id/method/params`，具体方法拒绝额外身份字段。所有错误正文归一化，日志不记录资源正文、URL、权限凭据或参数值。

每实例只有一个随机资源句柄。宿主必须提供 `OpenedResourceAuthority`，包含已冻结的账号/库/节点/内容版本和 `authorize/currentRevision/readRange`。读前读后复核授权和版本；撤权、中断、停止、版本改变均不放行迟到数据。授权回调必须证明当前用户可访问且节点确属目标库，不能只验证 renderer 提交了某个 nodeId。

**目前只用合成 Buffer 实现该适配器。** 尚未验证真实后端节点归属、签名 URL/重定向范围和账号切换；适配器未接入时不开放真实资源。插件获得读取授权不扩大原用户权限。

### 设置与恢复

设置按 `pluginId/accountScope/libraryId` 隔离；阅读快照额外按 `nodeId/viewerId/contentRevision` 隔离。各自是开发宿主内存 owner，支持 JSON 数据、schemaVersion、revision/CAS 和配额。内容版本或身份改变后旧快照不可见。实例重载可读取最后成功快照；宿主退出清空，不保证强停瞬间捕获，也不写入生产 B2 Session 或用户偏好。

C1 冻结为开发会话内存存储，不跨设备；生产持久化适配与 B2 状态交接需要在 C2/D1 明确后实施。取消/超时不承诺撤回已完成的设置写入，调用者须读回确认，不能自动重试覆盖。

### 生命周期与隔离

专用 preload 只有字符串 `exchange` 和 `subscribe`。禁用 Node、worker Node、子 frame Node、webview、DevTools，启用 sandbox、contextIsolation、webSecurity。每实例非持久 session，不继承默认 session 的认证 Cookie。资源 origin 仅服务本包资产；CSP 默认全拒绝，脚本/样式/字体只允许本包，图片允许本包和 data，网络/worker/frame/object/form 禁止。session 进一步限制请求为本实例 origin 的 GET，拒绝权限、下载、新窗口和导航；创建子 frame 将终止实例。

ready 超时和 renderer 心跳超时都由 main 处理。stop 幂等撤销 broker、取消请求、移除 native view、终止独立 renderer、移除 IPC 来源映射、卸载协议，销毁后解绑 session 监听器并清理临时存储。开发宿主最多 4 个同时实例、64 次累计激活；非持久 session 的底层对象可能由 Electron 保留到 app 退出，不宣称 `session` 对象已被显式销毁。

活动事件是合作式暂停，不能代替撤权或强制停止。插件不合作时由宿主停用实例。单次资源读取、线程 CPU、JS 堆不是同一预算：当前有数据量与请求限制以及无响应终止，但没有 OS 级硬内存/CPU 配额；D1 不能把本实验解释成抵御任意资源耗尽的完整方案。

## 4. 可复现实验与预算

从 `omniflow-app` 执行：

```bash
node tools/plugin-isolation/build-independent.mjs
node tools/plugin-isolation/run.mjs
node tools/plugin-isolation/run.mjs --inspect
npx vitest run electron/service/extensions
npm run lint
npm test
npm run build
```

自动实验使用全新临时 userData、非持久 plugin session、合成账号/库/节点/内容、一次性本机 HTTP 服务与合成 Cookie；不读取第一个资料库或任何真实资料库，不复制用户 profile。执行器有 90 秒总截止时间，故障实验只终止实验 Electron。结果写入临时目录 `results.json` 和 `run.log`；稳定摘要保存在本文及 [实验结果](plugin-system-c1-results.json)。

| 预算 | 当前值 / 超限行为 |
| --- | --- |
| RPC 请求 / 响应 | 16 KiB / 128 KiB，超限报 LIMIT |
| 普通 RPC | 8 并发、64 次/秒、4096 次/实例；心跳使用独立预留额度 |
| 资源读取 | 64 KiB/块、32 MiB/实例累计；一个句柄，不支持任意 URL |
| 宿主 / SDK 请求期限 | 4 秒 / 5 秒；中断等待并发送取消，迟到回包不再消费 |
| 启动 / 心跳 | 5 秒未 ready 停止；1 秒间隔、4 秒未 pong 停止 |
| 设置 | 64 KiB/项、256 KiB/namespace、32 keys；受更小 RPC 信封共同约束 |
| 阅读快照 | 32 KiB/项、256 KiB/宿主、64 项；受更小 RPC 信封共同约束 |
| 插件 / 资产请求 | 4 活跃实例、64 次累计加载；每实例 128 个资产请求/秒 |
| 日志 / preload 订阅 | 256 条环形诊断 / 8 个订阅，幂等取消订阅 |
| CSV 实验样板 | 256 KiB、1000 行、128 列、单元格 16384 字符，超限报错 |

本次 23 项 Electron 断言通过；CSV 就绪 127 ms，死循环停止 3347 ms，未就绪停止 5009 ms，主动 stop 调用返回 0 ms（调用返回不代表 OS 回收全部内存）。全量 lint/build 通过，366 个测试文件、2543 项测试通过，3 个文件/7 项测试跳过。

数值是 C1 起始实验预算，不代表生产性能 SLA。超限回归覆盖字节、并发、设置/CAS、快照及包目录项。生命周期测量见结果文件；机器负载会影响毫秒数。

## 5. 验收状态与剩余项

自动实验覆盖独立样板渲染、安全文本、主题隔离和旧版本拒绝、活动恢复、独立 PID、合成 session 隔离、Node/主 DOM/通用 preload 不可见、网络出口、权限、导航、来源/句柄/namespace 越权、阅读快照重载、死循环和反复加载释放。单元测试覆盖权限撤销/取消/超时、版本变化、非法路径/包、CAS、配额及 SDK 响应身份。

2026-09-14 已通过 CUA 在独立实验应用中完成以下人工验收（全部为合成数据）：

- 初次显示“等待宿主授权当前资源”；授权后显示 4 行中文 CSV，HTML 与公式保持纯文本；撤权后正文表格清空，再授权恢复。
- 亮暗主题文字/表格可读，宿主表面不受插件主题影响；紧凑显示在实例重载后恢复；暂停显示“已暂停”，恢复后重新读取。
- 原生缩放窗口及还原后，native view 跟随内容尺寸，宿主标题与说明区保持可见。
- 宿主 modal 子窗口覆盖 native view；嵌套内容可展开，Tab 进入输入框并输入合成文字；Esc 关闭后焦点回到插件，Tab 定位重新读取按钮，再 Tab/空格切换紧凑显示。
- 停止实例后插件视图从窗口移除，宿主菜单仍可操作；重载使用新的实例 origin、显示原 CSV 并恢复紧凑设置；诊断只含实例、方法、状态与耗时。

人工验收修复了 `tools/plugin-isolation/inspect.mjs` 的浮层 Esc 无响应：由宿主监听 Escape 关闭临时浮层，关闭后显式归还 parent 和存活插件的焦点。该改动仅作用于开发实验，不替代生产 overlay 的生命周期。为避免 CUA 混淆同时运行的 Electron 应用，验证使用临时复制、独立 bundle ID、ad-hoc 签名的 Electron 实验副本；运行相同构建产物与全新合成数据，不修改正在运行的 OmniFlow。重载后的 CUA 观察曾保留旧视图树，Raise 并聚焦后复核了新 origin 和实际表格，不以过期树作为结果。

Windows/Linux、实际业务 overlay 控制器、生产 B2 打开方式、账号切换、真实资源授权适配、持久存储、CSV 完整生产能力及安装/更新/回滚均未验收。C1 的候选方案与实验契约已具备进入 C2 的条件；真实资源授权、完整 CSV 生命周期和业务 overlay 仍须按 C2 范围重新验收。
