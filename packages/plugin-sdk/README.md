# OmniFlow Plugin SDK（C1 实验版）

版本 `0.1.0`，协议/Manifest/SDK 主版本均为 `1`，分别管理。此包为独立 ESM JavaScript + TypeScript 声明，无运行时依赖，不导入宿主源码。当前仅供 macOS 开发实验，不代表已开放第三方安装。

## 构建与使用

在此目录执行 `npm pack --ignore-scripts`，将生成的 tgz 作为外部工程依赖安装。插件只导入 `@omniflow/plugin-sdk` 的 `createPluginClient`、`PluginError`、`LIMITS`；由插件自己的构建脚本输出本地静态资源。浏览器不支持裸模块名时需要打包或转换引用。

示例工程见 `samples/csv-viewer`。从宿主仓库运行 `node tools/plugin-isolation/build-independent.mjs` 可复现：临时目录位于仓库外，安装打包后的 SDK，离线构建样板，没有宿主 alias 或 React 依赖。

## 契约

- `context()`：插件 ID、当前 viewer ID、能力、主题、当前资源的不透明句柄/名称/长度/版本及读取授权标志。不会返回账号、库/节点 ID、URL、Cookie 或令牌。能看见上下文不等于可以读正文。
- `ready()`：声明就绪；读取/设置/阅读状态操作要求先就绪。
- `read(handle, offset, length, {signal})`：读取当前打开资源，返回字节、下一偏移、是否结束、内容版本。上限 64 KiB/块、32 MiB/实例累计读取。重复读也消耗预算。
- `getSetting(key)` / `setSetting(key, value, expectedRevision, schemaVersion=1)`：仅当前插件 + 账号 + 库的设置；不存在时返回 null、初始 revision 为 0。写成功返回新 revision。
- `getState()` / `setState(value, expectedRevision, schemaVersion=1)`：轻量阅读快照，额外按节点、viewer ID、内容版本隔离。插件主动上报快照，重载后读取最近成功写入值；强制终止不保证捕获最后一帧。
- `subscribe(listener)`：主题和活动事件，返回取消订阅函数。主题只消费递增 revision；挂起时应取消读取，恢复时重新检查上下文。心跳由 SDK 自动处理。
- `dispose()`：幂等取消等待、释放事件订阅。迟到回包不再完成已取消请求。

C1 独立实验的设置与阅读状态只保留在开发宿主内存，退出清空。C2 中阅读状态接入既有 Viewer Session 的 Warm/设备 Cold；D1 设置按插件、包指纹、账号与库持久化，各版本隔离，不跨设备同步。它们不修改节点正文、`viewMeta` 或 B2 Session owner。

JSON 数据必须可序列化。设置 key 匹配 `[a-z][a-z0-9.-]{0,63}`。CAS 冲突后重新读取，不自动覆盖；超时或取消后，设置/快照写入可能已完成，应读取确认再决定下一步，不能把取消理解为事务回滚。

## 错误

| code | 含义与处理 |
| --- | --- |
| FORBIDDEN | 未授权、撤权、外来句柄、宿主账号/库权限不通过；等待宿主处理 |
| UNAVAILABLE | 实例已停止、未就绪或 transport 不存在 |
| CONTENT_CHANGED | 内容版本改变，要求宿主重新打开，旧句柄不重定向到新内容 |
| BAD_REQUEST | 参数/协议/重复请求错误 |
| BAD_RESPONSE | SDK 收到错误身份、结构、编码或范围的响应 |
| UNSUPPORTED | 宿主没有该能力 |
| LIMIT | 大小、次数、并发或配额超限 |
| CANCELLED / TIMEOUT | 主动中断 / 超时；丢弃迟到结果 |
| CONFLICT | 设置或快照 revision 冲突 |
| INTERNAL | 宿主失败；不会透传内部异常正文 |

包不兼容在激活前由宿主加载器报错，尚未发布生产安装错误 API。协议中的请求 ID 由 SDK 随机生成，插件身份由宿主绑定真实 sender/main frame，不能在参数中指定其他账号、库、插件或 URL。

D1 本地安装、预检/权限、版本回滚与恢复流程见宿主文档 `docs/plugin-system-d1-management.md`。HTML 本机文件选择器、拖出文件、媒体出声与 WebGL 不在首期支持范围；文件读取统一使用 SDK 句柄。

## 当前预算

权威数值见导出的 `LIMITS`。请求 16 KiB、响应 128 KiB、8 个并发、每秒 64 个普通请求、每实例 4096 个请求。宿主超时 4 秒，SDK 超时 5 秒；就绪期限 5 秒；心跳每秒一次，4 秒未响应终止。心跳有独立预留额度。

设置每项 64 KiB、每 namespace 256 KiB、最多 32 项；快照每项 32 KiB、宿主总计 256 KiB、最多 64 项。单次写入还受 16 KiB 请求信封限制，以更严格的上限为准，不支持分段拼接绕过预算。

专用 preload 仅提供 `exchange`/`subscribe`，最多 8 个订阅；没有通用 IPC、网络代理、Shell、Node、文件系统或主窗口 DOM。SDK 不提供逃离隔离环境的功能。
