# C2：第一方 CSV 查看器完整链路

更新时间：2026-09-14

适用范围：macOS 第一方固定 CSV 包、B2 打开方式、真实资料库读取与阅读恢复。前置隔离契约见 [C1](plugin-system-c1-sdk-isolation.md)，总体进度见 [实施计划](plugin-system-implementation-plan.md)。

本文保留 C2 验收基线；当前安装、设置持久化、session 复用与版本隔离规则以 [D1](plugin-system-d1-management.md) 为准。

## 1. 当前能力

CSV 包独立构建，通过现有“查看器”选择框在同一标签页启用；默认仍为内置文本查看器，不修改文件事实识别。用户点击“允许读取此文件”后，main 验证账号、节点、库和存储对象，再在独立 WebContentsView 中打开包。授权不跨账号、库、节点、viewer 或内容版本转移；撤权直接销毁当前实例。

**C2 已通过 macOS 第一方完整链路验收。** C2 为第一方开发预览，固定身份 `example.csv` / `example.csv.table`，仅 macOS 注册候选。没有任意包路径输入、第三方安装、网络代理、写文件或媒体权限。D1 的安装/升级/权限管理尚未实现。

## 2. 入口与分层

| 入口 | 职责 |
| --- | --- |
| `samples/csv-viewer` | 插件自己的 UTF-8 解码、流式 CSV 解析、分页表格、主题、紧凑设置和阅读位置 |
| `packages/plugin-sdk` | 公开协议与客户端，样板唯一业务依赖 |
| `tools/plugin-isolation/prepare-first-party.mjs` | 仓库外打包 SDK、离线安装并独立构建样板；将产物复制到 `dist-plugins` |
| `src/features/file-viewer/components/plugin-viewer` | 可信宿主适配，授权按钮、实例生命周期、bounds、B2 快照适配 |
| `src/service/plugins/plugin-viewer.api.ts` | 可信主窗口 bridge 包装与 auth runtime 释放 |
| `src/shared/plugin-viewer.ts` | 仅宿主使用的 IPC 类型，不属于公开 SDK |
| `electron/service/extensions/first-party-viewer.ts` | 固定包路径、真实来源门禁、异步加载取消、原生视图与状态事件 |
| `electron/service/extensions/library-resource.ts` | 后端授权事实、签名目标校验、有界 Range 与 ETag 固定 |

React View、文件 URL、auth 工具与通用 IPC 都留在宿主。插件不会 import 这些文件。插件预览仍由现有 FileViewerContext 管理标签和选择；查看器失败时复用 B2 的内置回退，授权/资源加载失败保留重试与切回内置入口。

## 3. 真实资源权限

无需修改 Go 接口或数据库。已核对并复用：

1. `GET /v1/user/me`：取得服务端验证后的账号 ID，和固定 API base 一起生成插件 namespace 的账号标识。
2. `GET /v1/nodes/:nodeId`：后端 `GetNodeDetail` 按节点真实 LibraryID 执行 AuthorizeRead；main 再核对返回节点 ID、LibraryID、普通文件类型及大小。
3. `GET /v1/directory/link?libraryId=…&nodeId=…&expiry=1`：后端再次验证库读取权限、节点归属并签发短期地址。

后端节点的 `name` 和 `ext` 可能分开返回，适配器按契约组合显示名；不能仅用裸 name 匹配 `.csv`。句柄身份固定账号、库、节点、对象 key/provider、大小、名称、更新时间及首次强 ETag。正文读取前后继续校验授权及元数据，存储 Range 请求携带 If-Match，拒绝跨版本拼接。

签名地址只允许构建配置 `VITE_STORAGE_ORIGINS` 中的 origin，解码后的路径必须精确等于 `/bucket/storageKey`，不接受 URL 用户信息或 hash；所有 API 和存储请求都拒绝重定向。此期只支持路径式对象地址；其他布局需要明确适配，不能放宽成任意 URL。

账号 token/username 只从可信主窗口送往固定后端 API。存储请求不携带这些 header，使用 `credentials: omit`；插件仅取得随机句柄与安全元数据。API JSON 最多 256 KiB，Range 必须为准确的 206/Content-Range/长度和强 ETag，不接受“忽略 Range 返回整个文件”的降级。打开有 10 秒网络截止，常规 RPC 继续受 C1 的 4 秒预算约束。

## 4. 生命周期与状态 owner

- 原生 view 放入宿主适配容器测得的 bounds；main 将坐标限制在主窗口内。插件不能传入主窗口坐标或操作其他 view。
- 仅活动且获准的文件启动实例。切换工具区、设置、标签或卸载时关闭实例；再次激活按新实例/句柄加载，并恢复最近成功快照。活动变化触发一次刷新，普通 resize 不反复读取正文。
- main 先登记 pending open，再异步查询/加载。撤权、卸载、auth release、主窗口导航/崩溃会取消 pending 和在途读取；晚到的成功实例立即停止，不重新挂回已关闭标签。macOS 主窗口关闭时释放并重置宿主引用，新窗口首次打开时重新绑定，避免复用已销毁的窗口。
- settings 仍由 main 的插件/服务端账号/库 namespace 内存 owner 持有，当前会话内可恢复；应用退出清空。D1 再确定正式设置持久化，不在 C2 偷写全局偏好。
- 插件通过 SDK state.set 上报当前页和 scrollTop；main 做 schema/revision/配额校验后将已提交快照投影给适配器。适配器的 `useViewerSession` capture/restore 复用 B2 Warm/设备 Cold，不另建磁盘状态库。
- 设备快照附带服务端资源版本；重新打开时只有版本匹配才种入新实例。main 中的当前状态与 B2 的离线恢复快照属于不同生命周期，不能把 renderer 投影当成第二份可任意修改的运行状态。
- 阅读位置采用最近成功检查点：翻页立即提交、滚动 200ms 合并。关闭/崩溃不保证最后尚未提交的滚动毫秒级位置；恢复/重新读取期间抑制滚动回写，避免空表把旧位置覆盖成 0。
- renderer 运行终止触发 B2 错误边界回退；读取失败/撤权/内容变化会清空表格并明确报错，不留下上一次正文冒充成功结果。

## 5. CSV 与隔离边界

支持 UTF-8（含 BOM）、CRLF/LF、引号、转义引号、引号内换行、空字段。分块之间保留解析状态，拒绝未闭合引号、引号后多余字符及非法 UTF-8。公式/HTML 只作为文本，使用 textContent 插入。

样板上限为 4 MiB、10000 行、128 列、100000 单元格、单元格 16384 字符；每页仅绘制 100 行，受全部上限共同约束。插件仍受 SDK 64 KiB/块、32 MiB 累计读取等预算约束。上限或编码错误明确提示，不静默截断。

C1 的进程/session/origin/preload/网络门禁保留。额外修复开发工具默认 `--no-sandbox`：Vite startup 显式传入 `['.']`，插件宿主检测该 switch 时拒绝加载，专用 preload 还要求 `process.sandboxed` 为真。宿主 preload 明确输出 CommonJS `preload.cjs`，主窗口、overlay 和系统视频窗口统一引用它，不依赖全局关闭 sandbox 才能工作。

固定包使用现有 APP_ROOT 定位，不能假定所有开发启动的 app.getAppPath 都与源码根一致。`npm run dev/build` 的前置脚本生成独立包及专用 preload，打包文件列表包含 `dist-plugins`。这不等于打包发行已验收；Windows/Linux 不声明可用。

## 6. 验证

自动验证：

```bash
npm run lint
npm test
npm run build
node tools/plugin-isolation/run.mjs
node tools/plugin-isolation/run.mjs --c2
```

C2 Electron 实验使用合成 HTTP/存储服务、合成账号及 250 行 CSV，运行真实主进程 bridge、资源适配器、专用 preload 和独立包。覆盖分页、最后检查点恢复、跨库拒绝、服务端撤权、ETag 变化、关闭及账号释放、存储请求无账号 header。不能把该 fixture 当作已访问真实资料库的证据。

实际桌面验收使用第三个 **win** 资料库的 macOS 本机 MinIO，仅新建和修改 `/文档/omniflow-c2-qa-20260914.csv` 合成文件（206 行），未使用第一个资料库：

| 场景 | 结果 |
| --- | --- |
| 默认打开 → 显式选择 CSV | 原默认文本不变；同一标签切换，正文先等待授权 |
| 真实授权与读取 | 206 行正确显示，分页 1/3；账号/库/对象均经后端重新核验 |
| 分页 → 关闭标签 → 重开并重新授权 | 恢复第 2/3 页（行100 起）及紧凑显示 |
| 撤权 | 原生插件视图移除，显示授权提示；可重新授权 |
| 工具区往返 | 工具区无残留 plugin view；返回新实例并恢复第 2 页 |
| 亮暗主题 | 插件随宿主颜色快照显示，第二页状态保持 |
| 原业务属性浮层 | 文件属性弹框位于插件上方，背景遮罩正确；Escape 关闭后主工作区可继续操作 |

验收只通过已有 UI 创建/保存合成文件，不向插件暴露写入能力。该文件保留供复测，不删除其他用户内容，不保存格式默认关联。验收结束已关闭 CSV/设置标签，恢复“跟随系统”主题；合成 CSV 保留复测。

最终验证：lint、build 通过；全量 369 个测试文件/2565 项测试通过，3 文件/7 项跳过；本批定向 55 项通过；C1 的 23 项隔离回归与 C2 的 12 项真实 Electron/HTTP 链路断言通过。结果摘要见 [C2 验证记录](plugin-system-c2-results.json)。

回归还覆盖了隐藏窗口下的检查点提交：恢复收尾不依赖 requestAnimationFrame，避免隐藏 renderer 暂停绘制后阻断状态写入。实验执行器同时检查 `results.json.completed`，不能仅凭 Electron 进程退出 0 宣称通过。

## 7. 后续门槛

C2 范围不包含第三方包来源信任、ZIP 安装、升级回滚、停用恢复、设置正式持久化和 OS 级硬内存/CPU 配额。开发宿主仍限制 4 个同时实例和 64 次累计激活；超过后明确失败，需要重启宿主，D1 必须处理长时间会话和安装生命周期，不能把该开发预算直接包装成生产无限使用能力。

真实账号切换/删除节点通过现有 auth/workspace 释放链路及自动化边界验证，不通过退出用户账号或删除真实内容做破坏性测试。跨进程身份、版本变化、迟到回包与恶意代码继续保留 C1/C2 实验回归。发行包及 Windows/Linux 未验收。
