# OmniFlow Plugin SDK

版本 `0.7.0`，wire 协议与 `sdkVersion` 继续为 `1`，Manifest 支持 `formatVersion: 1 | 2`，分别管理。此包为独立 ESM JavaScript + TypeScript 声明，无运行时依赖，不导入宿主源码。当前提供 macOS 受限只读插件、重命名提案、单文件文本产物、手动命令与独立工具页面声明；本地安装见 D1，目录扩展见 E1，独立 Agent Tool 契约见下文。

## 构建与使用

在此目录执行 `npm pack --ignore-scripts`，将生成的 tgz 作为外部工程依赖安装。插件只导入 `@omniflow/plugin-sdk` 的 `createPluginClient`、`PluginError`、`LIMITS`；由插件自己的构建脚本输出本地静态资源。浏览器不支持裸模块名时需要打包或转换引用。

示例工程见 `samples/csv-viewer`。从宿主仓库运行 `node tools/plugin-isolation/build-independent.mjs` 可复现：临时目录位于仓库外，安装打包后的 SDK，离线构建样板，没有宿主 alias 或 React 依赖。

## 契约

- `context()`：插件 ID、执行贡献 ID、能力、主题、当前资源的不透明句柄/名称/长度/版本及读取授权标志。Viewer 继续返回原有 `viewerId`；Tool 返回 `kind: 'tool'`、`toolId`；Workspace 返回 `kind: 'workspace'`、`workspaceId`、`commandId`。不会返回账号、库/节点 ID、Run 身份、URL、Cookie 或令牌。能看见上下文不等于可以读正文。
- `ready()`：声明就绪；读取/设置/阅读状态操作要求先就绪。
- `read(handle, offset, length, {signal})`：读取当前打开资源，返回字节、下一偏移、是否结束、内容版本。上限 64 KiB/块，普通文件实例 32 MiB 累计读取；目录实例每文件 32 MiB、累计 512 MiB。重复读也消耗预算。
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

## 目录查看器（0.2.0）

目录贡献声明 `directoryTypes: ["COMIC"]` 与空 `extensions`，权限同时声明 `directory.read`、`resource.read`。旧宿主不识别这些字段时拒绝安装，不能移除权限伪装兼容。

- `context().resource.kind === 'directory'` 且 capabilities 包含 `directory.read` 时才可枚举。普通文件旧响应可以没有 kind。
- `listDirectory(handle, offset=0, {signal})`：固定快照，每次最多 64 条，返回 entries/nextOffset/eof/revision。条目含 id/name/size/mimeType；id 是不透明标识，不是后端节点 ID。
- `openDirectoryEntry(handle, entryId, {signal})`：仅打开当前目录快照中的直属图片，得到标准文件句柄，再调用 read。
- `releaseResource(childHandle)`：释放子句柄；关闭实例或撤权自动回收。最多 4 个并发子句柄（含正在打开）。

目录最多 512 个直属节点，超限拒绝，不递归；每目录实例最多 16384 个普通请求，频率/并发/超时与原协议一致。列表中新增内容需要重新加载；移出目录的条目即使仍在快照也不能读取。读取额度不是持久访问权，每次仍检查当前权限和版本。

独立样板：`samples/comic-viewer`。目录契约、配额、支持格式和验收边界见 `docs/plugin-system-e1-directory-viewer.md`。

## 独立 Agent Tool（0.3.0 / Manifest v2）

旧 `formatVersion: 1` Viewer 包继续保留原结构；只有新 v2 允许声明 `agentTools`。v2 可以只提供 Tool，此时无需顶层 `entry` 或 `viewers`，宿主将缺少的 `viewers` 规范化为 `[]`。混合包中只要存在 Viewer，顶层 HTML `entry` 仍必需。每个 Tool 有自己的 HTML `entry`，不伪造 Viewer ID、不要求打开文件标签。旧宿主会明确拒绝 v2。

每个 Tool 声明 `id`、`title`、`description`、`entry`、`inputSchema`、`outputSchema`、`resourceAccess`、`timeoutMs`、`maxResultBytes`。ID 必须处于插件命名空间且与包内其它贡献 ID 不重复；`activation` 精确列出所有 `viewer:<id>`、`tool:<id>` 及 0.7.0 新增的 `workspace:<id>`，不能用 Viewer 激活条件代替 Tool。最多 8 个 Viewer、8 个 Tool 和 8 个 Workspace。

原单文件读取 Tool 省略 `kind`，需要 `resource.read`；向内部 Agent 提供工具时还需要 `agent.tools`（仅手动调用见 0.6.0 节）；含此 Tool 的包不能声明 `directory.read`。`resourceAccess` 固定为 `[{ "parameter": "resource", "mode": "read", "kind": "file" }]`，只接受当前调用的单个资料库文件。Tool 的安装授权不等于 Agent 会话授权；读取、取消及结果交付由宿主绑定调用与当前访问权。

Schema 使用严格有限子集：根必须为 object；所有 object 都显式声明 `properties`、`required`（允许空数组）与 `additionalProperties: false`；string 必须有 `maxLength`（最多 4096）；array 必须有 `items` 和 `maxItems`（最多 256），可声明 `uniqueItems`；number/integer 必须有有限的 `minimum`/`maximum`，integer 边界必须是安全整数。另允许 `boolean`、`null`、有界的 `description`、`minLength`、`minItems` 和最多 32 项的同类型标量 `enum`。不支持 `$ref`、`pattern`、`format`、`const`、组合条件或默认值，也不做类型转换。

单文件读取 Tool 的 `inputSchema` 顶层必须将 `resource` 列为必填；该对象只能声明必填 `nodeId`，类型 integer，`minimum: 1`、`maximum: 9007199254740991`，禁止额外属性。账号、库与运行身份由宿主绑定，不是模型参数。每份 schema 最多 8 KiB、深度 6、128 个 schema 节点、64 个属性；输入总量最多 16 KiB。发布的 Manifest JSON Schema 提供结构校验，安装器另行执行上述语义和预算校验。多文件改名提案使用下文独立 `resources` 契约。

- `toolInvocation()`：就绪后获取 `{ invocationId, toolId, input }`；`input` 仅含业务参数，资源定位由宿主解析，正文通过 `context().resource` 的本次调用句柄读取。
- `completeTool(invocationId, output)`：提交符合 `outputSchema` 的一次终态结果，成功返回 null。
- `failTool(invocationId, code)`：报告一次终态失败，code 仅为 `INVALID_INPUT`、`UNSUPPORTED_FORMAT` 或 `FAILED`，不传内部异常正文。

`timeoutMs` 最大 30000；`maxResultBytes` 最大 32768，按 UTF-8 JSON 字节计算。只有 `tool.complete` 请求允许 34816 字节信封，结果仍受声明的更小预算限制；其它请求继续保持 16 KiB。共享文件读取预算与每请求超时不因 Tool 总执行期限而提高。停止或取消后丢弃迟到结果，旧调用句柄失效；Tool 的 state/settings 能力由宿主独立限制，不能沿用 Viewer 阅读状态命名空间。

SDK 仅暴露协议；单文件读取 Tool 已在宿主 AT1/AT2 接入 Agent 发现、会话授权与 ToolRun 来源审计，并完成既定 macOS 范围验收。新类型的安装、授权和执行仍取决于兼容宿主与实际开放的能力，不能仅因 Manifest 验证通过就假定可调用。

## 元数据重命名提案（0.4.0 / Manifest v2）

Tool 显式声明 `kind: "rename-proposal"`，需要 `resource.rename.propose`；向内部 Agent 提供工具时还需要 `agent.tools`（仅手动调用见 0.6.0 节）。首版提案包不能同时声明 `resource.read`、`directory.read` 或 Viewer；旧读权限不会获得多文件提案能力。`resourceAccess` 固定为 `[{ "parameter": "resources", "mode": "metadata", "kind": "file", "maxItems": 50 }]`。

模型侧 `inputSchema` 必填 `resources`：数组的 `minItems: 1`、`maxItems: 50`、`uniqueItems: true`，条目为 `minimum: 1`、`maximum: 9007199254740991` 的 integer。其他业务参数继续使用有界 schema；禁止声明旧 `resource` 字段。输入必须是同一资料库内获准的普通文件，宿主承担验证，沙箱不会看到这些真实 nodeId。

沙箱仍使用 `ready()`、`toolInvocation()`、`completeTool()` 与 `failTool()`。`context()` 返回 `kind: "tool"`、`resource: null`、`readGranted: false`，能力仅为 `resource.rename.propose`、`tool.invoke`、`lifecycle`。调用的 `input` 为 `{ parameters, files }`：`parameters` 是剥除 `resources` 的业务参数，`files` 只含每个获准文件的 `{ id, name }`，id 为本次调用的不透明引用，name 为完整名称。无正文、目录枚举、真实路径、URL、账号/库 ID；resource/state/settings API 均拒绝。

`outputSchema` 使用固定封闭结构 `{ changes: [{ id, name }] }`：changes 数组 0～50 项，条目只允许必填 id/name；id 长度 1～64，name 长度 1～240。所有 object 仍要求 `additionalProperties: false`。允许空 changes 表示无需修改；不得重复或引用输入之外的 id。name 为完整名称；有扩展名时保留原扩展名及大小写，无扩展名时不借改名新增扩展名。宿主另以最多 240 UTF-8 字节及合法名称规则校验，不能只按 schema 的字符长度判断可用。SDK 不提供写入方法；`completeTool()` 成功只表示提案交付，并不表示任何文件已重命名。

调用继续适用 Tool 的超时、结果字节、取消、停用、包指纹和单终态约束。变更后的文件范围或版本须重新准备，不能将旧引用或旧批准用于新的文件。

## 单源文件产物（0.5.0 / Manifest v2）

`kind: "file-output"` 要求 `resource.read` 与 `resource.output.propose`，向内部 Agent 提供工具时另需 `agent.tools`；文件产物必须独立批准；升级或回滚会清除批准。贡献使用 `output:{mediaTypes,maxBytes}`，mediaTypes为`text/csv`、`application/json`的非空无重复子集，maxBytes为1至1048576；不声明outputSchema/maxResultBytes，不提高旧Tool的任意JSON结果预算。

inputSchema必填原有`resource:{nodeId}`以及`destination:{parentId,fileName}`；目标对象封闭，parentId为正安全整数，fileName为长度1～240的字符串，宿主另验240 UTF-8字节上限。资源ID、目标目录和文件名由宿主冻结并剥除，插件仅收到处理参数；源正文继续通过当前单文件句柄读取。`context()`额外投影贡献的output声明和`resource.output.propose`能力，目标身份不进入沙箱。

`completeFileOutput(invocationId,{mediaType,text})`交付一个1字节至1MiB的UTF-8产物。SDK先检查context的能力、MIME和声明预算，再通过专用`tool.output.complete`以canonical base64发送；完整信封最多1400152字节。宿主拒绝非法UTF-8、非规范base64、空产物、未声明MIME、超限结果和重复终态。普通Tool/Viewer不能调用此方法；file-output不能用旧completeTool绕过产物边界。state/settings、目录及网络能力不因此开放。

正文只交给main私有准备路径，不作为普通AgentToolResult返回模型或写入SQLite聊天记录；宿主持有受管暂存、摘要、目标预览与批准，成功另存后才交付新节点回执。SDK完成只代表产物交付，并不代表已创建文件。首期`.csv`、`.json`目标与MIME对应，固定不覆盖、不自动改名。完整导出超限必须失败，不得截断后宣称完整。

独立样板为`samples/csv-export`。端到端保存、取消、回执核对与实际验收状态以宿主`docs/plugin-system-w3-file-output.md`为准。

OmniFlow 宿主通过标准 Agent 审批卡展示完整旧名→新名，即使会话完全访问也明确询问。批准前重新准备并校验目标，批准后由宿主调用通用条件批量 API，插件不接触提交凭据或回执查询。旧后端不支持接口时拒绝执行，不降级为无条件改名。取消后已发生的提交不会由 SDK 撤销；不应将工具终止理解为用户文件未改动。

独立样板 `samples/batch-rename` 与开发包示例提供 prefix/suffix 规则。W0～W2 已通过本批限定 macOS 功能验收：真实 Agent、标准审批、Win/local-minio 专用合成文件、条件原子提交、服务端/本机审计和目录/预览同步；故障证据另有真实 Electron＋合成 HTTP/模型与真实 PostgreSQL 临时表。详细范围以宿主 `docs/plugin-system-w0-w2-rename.md` 为准；跨重启自动回执核对与撤销尚未实现。


## 手动命令（0.6.0 / Manifest v2）

Manifest v2 可新增 `commands` 数组，每包最多 8 项。每项只含 `id`、`title`、`toolId`、`locations`：ID 必须位于包命名空间，不能与任何已安装贡献 ID 重复；标题 1～80 字符；`toolId` 必须引用同包 `agentTools` 中已有的工具；`locations` 为 `file-menu`、`tool-workspace` 的非空、无重复子集。

命令是已有工具的手动入口，复用其 inputSchema、资源限制和隔离 HTML 入口。不增加 `command:` 激活事件，`activation` 精确列出 `viewer:` / `tool:` 及可选 `workspace:`；命令自身不声明执行脚本、任意菜单位置、HTML 或 React 组件。宿主在文件菜单或工具区展示入口，生成参数表单并管理选择的文件、另存目录和目标文件名；插件仍只收到原有去除宿主身份字段的调用输入。

`agentTools` 名称为兼容已有清单保留，但 `agent.tools` 现在只控制内部 Agent 发现与调用。若所有工具均有手动命令，可省略 `agent.tools`，此包不能批准 Agent Tool 或进入模型工具目录。若包同时声明 `agent.tools`，用户也可仅批准读文件 / 改名提案 / 文件产物能力来手动调用，无须先批准 Agent Tool。工具没有命令入口且包也未声明 `agent.tools` 时，安装失败。

手动调用仍要求插件已启用、无恢复/故障阻止、包指纹有效及对应资源能力已批准；撤销这些能力、停用或升级会使旧调用失效。Agent 与手动调用使用分开的注册身份。手动选择与宿主操作上下文只授权本次资源；改名与新文件仍必须展示提案并批准，不能把命令点击当作最终写入批准。

三个现有样板提供双入口：`example.batch-rename.run`、`example.csv-export.run`、`example.json-transform.run`。升级包需更高版本，宿主会按现有安装策略清除旧批准。不含 `commands` 的格式 1/2 包保持原行为；不认识 `commands` 的旧宿主会拒绝新包，不得通过删去能力声明伪装兼容。

## 独立工具页面（0.7.0 / Manifest v2）

可选 `workspaces` 每包 1～8 项，每项仅含 `id`、`title`、`entry`、`commandId`。ID 位于包命名空间，并与 Viewer、Tool、命令及其它工具页面 ID 分开；标题为 1～80 字符，entry 为包内 HTML 路径。commandId 必须指向同包已有命令，所对应 Tool 只能为普通单文件只读或 `file-output`；不支持 `rename-proposal`、目录或无资源页面。每项必须有精确的 `workspace:<id>` 激活声明，全部 activation 最多 24 项。独立页面使用自己的入口和上下文，不需要 Viewer，也不是 Tool 的隐藏执行实例。

`context()` 的 kind 为 `workspace`，含 workspaceId、commandId、标准单文件 resource、readGranted、theme；能力仅为 `resource.read`、`theme`、`lifecycle`、`workspace.prepare`。页面先 `ready()`，再用 `read()` 读取宿主选定文件，接收主题/活动事件。读取授权、每次访问权/版本验证、来源绑定、字节/请求预算、沙箱网络和生命周期限制与已有隔离环境相同。不开放 state/settings、目录、Tool invocation/completion、输出提交、任意 IPC 或文件选择器。

`prepareWorkspaceCommand(parameters)` 将业务参数交给可信宿主，快速返回 `{requestId}`，表示受理准备请求，不代表处理完成或文件已保存。参数必须为有界 JSON 对象；完整请求仍限 16 KiB，深度最多 22、值节点最多 4096，拒绝原型保留键。顶层不能含 `resource`、`resources` 或 `destination`；不能在请求信封里附加批准、目录、文件名或执行身份。真实源文件、目标目录/名称、完整 schema 校验和后续执行由宿主持有。

处理与准备结果在可信宿主区域展示。写入仍复用手动命令的完整预览、显式批准和回执路径；工具页面不能批准自己的请求，返回 requestId 不获得后续提交权。页面本地预览可以用于交互，但不会替代宿主批准时的重新准备。可用性继承声明命令的独立读取/产物批准；不要求 `agent.tools` 或 Agent Tool 批准。停用、撤权、升级或资源范围变化后旧页面实例失效。

独立样板复用 `samples/json-transform`。完整宿主行为与实际 macOS 验收范围见 `docs/plugin-system-m2-tool-workspaces.md`（以宿主仓库发布的专题为准）。
