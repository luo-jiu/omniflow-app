# Viewer Session 状态架构

更新时间：2026-08-04
适用范围：`src/components/business/app-main/`、`src/contexts/FileViewerContext.tsx`、`src/features/file-viewer/`、`src/features/archive-viewer/`、`src/features/workspace-resource-release/` 中与 viewer tab 保活、阅读现场、编辑草稿、缓存恢复和资源释放相关的代码。

状态：阶段 0 到阶段 3 已完成。全部 Warm-capable viewer 已迁移到公共 registry，旧逐 viewer cache 和迁移期 release switch 已删除，并已完成自动化门禁与 `win` 测试库的定向 Electron 真实样本验收。下一阶段是有限 Hot 保活和资源预算治理。

## 1. 目标

Viewer Session 治理需要同时解决以下问题：

- 同一资料库内切换 tab 后，阅读位置和局部操作状态不意外重置。
- 切换工作区、资料库或发生组件卸载后，允许恢复的现场能够可靠恢复。
- 打开大量 tab 时，React DOM、canvas、图片解码和媒体资源不会无上限保活。
- 刷新内容、关闭 tab、释放资料库和退出登录具有明确且一致的失效语义。
- 未保存文本草稿不依赖组件实例存活，也不随普通 LRU 快照被淘汰。
- 新 viewer 接入时必须显式声明 session 能力，并通过统一验证，而不是自行新增一套 `Map`。

这套架构不追求让所有 viewer 拥有完全相同的 payload。统一的是身份、生命周期、缓存层级、失效、资源预算和接入门槛；具体阅读状态仍由 viewer 自己拥有。

## 2. 当前事实

### 2.1 Tab 当前是全部实例保活

`AppMain` 会记录所有访问过且尚未关闭的文件 tab，并持续渲染对应 `FileDispatcher`。非活动 tab 只使用 `visibility: hidden` 和 `pointer-events: none` 隐藏。

因此当前行为是：

- 同一资料库内，访问过的 tab 一般不会因普通切换而卸载。
- 保活集合没有数量、内存或资源成本上限。
- 从缓存恢复资料库时，先只挂载 active tab；其他 tab 第一次重新激活时才创建 viewer。
- `reloadToken` 变化会改变 `FileDispatcher` key，明确触发 active viewer remount。
- 保活只能保存组件实例；组件内部不稳定 effect 仍可能在 rerender 时重置现场。

保活容器必须维持已经挂载 tab 的稳定 DOM 顺序。active tab 切换不能为了记录最近使用而重排 `keepAliveTabIds`，否则 CodeMirror 等依赖 DOM 测量的 viewer 即使没有卸载，也可能在节点移动后丢失滚动现场；未来 Hot LRU 的访问时间必须与渲染顺序分离维护。

### 2.2 工作区缓存只保存 tab 事实

`FileViewerContext` 按 `library:${libraryId}` 保存 tabs、activeTabId 和当前 active tab 投影。每个新 tab 同时携带 provider 给出的 `libraryId` 和显式可空的 `contentRevision`，但不使用节点 `updatedAt` 冒充内容版本；旧缓存 tab 恢复时会补齐当前 provider 的 `libraryId`。

`file-viewer-cache.ts` 是最多 12 个资料库的内存 LRU。它不保存统一的 viewer payload，也没有在 LRU 淘汰资料库 tab 元数据时同步释放该资料库的 viewer snapshot 或媒体资源。

### 2.3 Viewer snapshot 已统一到公共 registry

当前所有声明 `warm: 'memory'` 的 viewer 都通过 `useViewerSession` 接入公共 registry。具体 codec 仍留在各 viewer 目录；registry 统一承担身份、版本、revision、预算、LRU 和释放，不 import 具体 viewer。

旧的漫画、ASMR、视频进度及四类归档模块级 `Map` 已删除。`workspace-resource-release` 不再枚举文件 tab 或静态 import 具体 viewer，单库释放直接调用 `viewerSessionRuntime.disposeLibrary`，session 释放调用 `viewerSessionRuntime.dispose`。

### 2.4 当前能力矩阵

| Viewer | Hot 实例 | Warm 快照 | 远端进度 | 主要缺口 |
| --- | --- | --- | --- | --- |
| Image | 有 | 公共 registry：缩放、比例/绝对平移、旋转 | 无 | adapter/codec 已接入，并通过 Electron 真实图片样本验收 |
| Audio | 有；播放由全局音频服务持有 | 无独立 UI 快照 | 无 | 播放资源和 viewer UI 生命周期未统一分类 |
| Video | 有；视频元素由全局服务保活 | 公共 registry：播放进度投影、倍速、字幕开关/来源/样式、操作台 | `viewMeta` 播放进度 | 媒体 DOM 和 URL 始终由服务层拥有，不进入 snapshot |
| PDF | 有 | 公共 registry：页码、缩放、滚动、比例、页锚点 | 无 | adapter/codec 已接入并通过 80 页 Electron 样本验收；跨重启 Cold 恢复未启用 |
| Text | 有 | 公共 registry：选区、顶部行、滚动、字号、换行 | IndexedDB dirty draft | adapter/codec 与 DraftStore 已接入并通过 Electron 草稿恢复、冲突和保存并发验收；后端稳定 revision 尚未提供 |
| Comic | 有 | 公共 registry：页锚点、滚动降级、阅读/单双页模式、缩放、页间距、翻页变换 | `viewMeta` 阅读进度 | 页列表和临时图片链接重新加载 |
| Gallery | 有 | 公共 registry：详情节点、网格锚点 / 比例、图片变换 | 无 | adapter/codec 已接入；临时链接和 HEIC 预览不进入 snapshot |
| ASMR | 有 | 公共 registry：稳定路径、选择、列表锚点/比例、播放节点和队列父目录 | `viewMeta` 仅承担集合元信息 | 目录列表、封面和临时音频链接重新加载；播放 owner 仍是全局音频服务 |
| Video Archive | 有 | 公共 registry：卡片锚点、比例和绝对滚动 | 无 | 卡片、分页和临时封面/预览链接重新加载 |
| Audio Archive | 有 | 公共 registry：卡片锚点、比例、绝对滚动和稳定选择 | 无 | 播放事实从 `globalAudioPlayer` 反向投影，不缓存音频 URL |
| ASMR Archive | 有 | 公共 registry：卡片锚点、比例和绝对滚动 | `viewMeta` 阅读进度 | Warm 优先，未命中时才采用远端位置；卡片重新加载 |
| Comic Archive | 有 | 公共 registry：卡片锚点、比例和绝对滚动 | `viewMeta` 阅读进度 | Warm 优先，未命中时才采用远端位置；卡片重新加载 |
| Gallery Archive | 有 | 公共 registry：卡片锚点、比例和绝对滚动 | 无 | adapter/codec 已接入并通过 Electron 长卡片墙样本验收；卡片与临时封面重新加载 |

### 2.5 已确认的系统性缺口

#### 不稳定配置可以绕过实例保活

Text Viewer 曾在 render 中创建新的 CodeMirror `basicSetup` 对象。active tab 变化引发 rerender 后，`@uiw/react-codemirror` 会把配置变化当作 extension reconfigure，实测会让滚动位置回到顶部。阶段 0 已把该配置稳定为模块级对象。

这类问题说明“组件没有卸载”不等于“现场一定稳定”。高成本编辑器、播放器和渲染器的配置引用必须稳定，只有真实配置变化才能触发 reconfigure。

#### 刷新使用统一 generation 失效

`reloadToken` 不再拼进 snapshot key。公共 runtime 在同一资源 generation 变化时精确失效旧 snapshot，`FileDispatcher` 的 remount key 负责重建 active viewer；不会产生旧 token 对应的孤儿 cache 项。

#### 关闭、卸载和显式释放语义混杂

- 普通卸载统一先 capture，再按 policy 保留 Warm snapshot。
- 关闭 tab 由 `disposeViewerSessionOnClose` 查询穷举 policy；`discard` 会先移除 snapshot 和 live registration，避免随后 React cleanup 写回，`retain-reading-position` 保留续读位置。
- 单库和 session 释放直接清 registry，不依赖仍可枚举到的 tab 元数据。
- 后端 `viewMeta` 不随前端工作区释放删除；它属于单独的 Cold 语义。

#### 快照混入了临时资源地址

所有已迁移 snapshot 都只保存稳定节点身份、锚点、比例和 UI 参数。签名 URL、卡片/页数组、字幕正文、封面、音频队列数据和媒体元素不进入 registry；恢复时通过节点接口重新获取。

目标快照只能保存稳定节点身份和可重建数据。临时 URL 只能进入带明确 `expiresAt` 的短期资源 cache，恢复时过期就重新解析。

#### 远端写入不代表已经具备冷恢复

Comic Archive 和 ASMR Archive 已补齐无 Warm snapshot 时的 `viewMeta` 冷恢复。命中 Warm 时，本次资源加载周期始终以 Warm 为准，较慢返回的远端请求不能在 Warm 定位完成后反向覆盖；跨重启行为仍需真实样本验收。

#### 新 viewer 没有接入门禁

新增 `fileType` 后，目前需要开发者自行记得更新：

- `FileDispatcher`
- viewer snapshot cache
- session policy / close helper
- workspace release
- viewer 文档地图
- 验证矩阵

阶段 1 已增加 `viewerSessionPolicies` 并用 `satisfies Record<FileViewerFileType, ...>` 建立编译期穷举；新增 `fileType` 若未声明 policy 会编译失败。具体 adapter、codec 和恢复验证仍必须在 viewer 迁移时完成，不能只以 policy 存在视为已接入。

### 2.6 公共内核当前状态

`src/features/file-viewer/session/` 已提供第一版公共内核：

- resource key 由 canonical 账号 scope、显式 `libraryId`、正整数 `node:<id>` 或带允许 namespace 的 opaque stable id、有效 `viewerKind` 组成；factory 与运行时 validator 共用同一套规则，签名 URL、`blob:` URL 和本地路径不能成为 resource identity。
- live key 使用 auth runtime session、`libraryId`、tab id 和 mount generation；旧 generation 的 cleanup 不会移除新 adapter。
- Warm registry 只接受 plain JSON payload，写入和读取都会脱离调用方对象引用；同时按条目数和估算字节预算执行 LRU。
- schema 或 content revision 不匹配时跳过并删除旧 snapshot；显式 replace 事务会先 capture 旧实例，再注册新资源。
- registry runtime 在 application/auth session 级注册；认证 bootstrap 会先启动 runtime 再提交用户状态，受保护路由在 bootstrap 完成前不挂载 viewer 子树；资料库释放按 `libraryId` 清理，退出登录或 401 清理整个 session。
- workspace release 只清公共 registry；旧逐 viewer cache 与迁移期 release bridge 已删除。
- `useViewerSession` 统一处理 adapter 注册、mount generation、schema/revision restore、active flush、cleanup capture 和 reload generation 失效；具体 payload/codec 继续留在 viewer 目录。
- `ViewerDraftStore` 使用 IndexedDB 独立持久化 Text dirty content；按 resource slot 保留最新 draft，并用 draft key 中的 revision 做冲突判断。默认限制为单草稿 5 MiB、单账号 50 MiB、保留 30 天，存储失败不会把 dirty 状态降级成已安全落盘。

账号已有稳定 `user.id`，可以构造 `user:<id>` scope。节点详情目前只有 `updatedAt`，没有经确认可靠的 ETag、对象版本或 storage fingerprint，因此通用 viewer 的 `contentRevision` 仍可为空；Text 已在首次加载与保存后使用原始正文 SHA-256 作为 DraftStore 临时基线，并在签名 URL 更新时把保存后的 hash 回写 tab。后端稳定 revision 仍是长期目标。

## 3. 状态所有权

### 3.1 FileViewerContext

继续作为文件 tab 事实的唯一 owner，只持有：

- tab 顺序和 active tab
- 文件稳定身份与展示信息
- 打开来源和返回目标
- viewer 输入上下文，例如字幕候选和播放列表摘要
- session identity 输入，例如 `libraryId` 和可空 content revision
- reload generation

它不持有各 viewer 的滚动位置、光标、缩放、播放器内部状态或草稿正文。

### 3.2 Viewer

具体 viewer 继续拥有运行时交互状态，并负责把允许恢复的最小状态转换为可序列化 snapshot。Viewer 必须区分：

- 可恢复状态：阅读锚点、选择、缩放、模式、折叠状态。
- 可重建数据：卡片列表、稳定节点摘要。
- 瞬态状态：hover、dragging、打开的菜单、loading、error、DOM ref。
- 外部资源状态：全局 audio/video 元素、Document PiP、MediaHub entry。
- 用户数据：未保存文本草稿。

瞬态状态不能进入 snapshot；媒体资源继续由现有服务 owner 持有；草稿使用独立的耐久存储。

### 3.3 ViewerSessionRegistry

公共 registry 只负责恢复介质和生命周期协调：

- 用统一身份读取、写入、失效和删除 snapshot。
- 管理 Warm cache 预算和 LRU。
- 按 library、tab、viewer kind 或 session 做精确清理。
- 登记已挂载 viewer 的 capture/suspend 能力。
- 输出不含 payload 的诊断事件。

Registry 不是 viewer 业务状态 owner，也不通过全局 Context 广播高频滚动状态。Viewer 本地 state 仍然是运行时事实，snapshot 只是恢复副本。

Registry 的运行时必须位于 application/auth session 级，而不是挂在单个 `library detail` 或 `FileViewerProvider` 组件内部。普通路由卸载和资料库切换不能销毁 Warm cache；退出登录、401 或显式 session dispose 才结束对应 runtime scope。

### 3.4 DraftStore

未保存文本内容属于用户数据，不属于可随时丢弃的 viewer snapshot。需要独立 `ViewerDraftStore`：

- 使用稳定文件身份和内容 revision。
- 写入 IndexedDB，不使用同步 `localStorage`。
- 输入时 debounce，失活和卸载时立即 flush。
- 保存成功后清除对应 draft。
- 远端内容发生变化时不能静默覆盖草稿，必须进入冲突恢复流程。
- dirty tab 在 DraftStore 落地前不得被 Hot LRU 淘汰。
- 关闭 tab 或显式释放资料库时不能静默删除 dirty draft；应保留可恢复草稿，或在用户明确确认后丢弃。
- draft 必须按用户和资料库隔离。退出登录或 401 时从当前运行时卸载，但同一用户重新登录后仍可恢复；不能让另一个账号读取。
- 默认采用编辑器 hot-exit 语义：关闭 tab、释放资料库和异常退出只卸载运行实例，不删除已经落盘的 dirty draft；用户执行“放弃草稿”或确认删除节点时才删除。
- 重新打开存在 draft 的文件时必须进入明确的恢复/放弃流程；不能在后台静默覆盖远端正文。
- DraftStore 必须有单草稿和账号级容量上限、保留期限及配额失败处理。dirty draft 写入失败时必须提示并禁止 Hot 淘汰，不能降级成静默丢失。

## 4. 统一身份与版本

### 4.1 三类身份

不能用一个 key 同时表达已挂载实例、可恢复阅读现场和耐久草稿。目标模型拆成三层：

```ts
interface ViewerLiveInstanceKey {
  runtimeSessionId: string;
  libraryId: number;
  tabId: string;
  mountGeneration: number;
}

interface ViewerResourceKey {
  accountScope: string;
  libraryId: number;
  resourceIdentity: string;
  viewerKind: FileViewerFileType;
}

interface ViewerDraftKey extends ViewerResourceKey {
  contentRevision: string;
}
```

- `ViewerLiveInstanceKey` 只用于 Hot 实例、adapter 注册和挂载代际，退出当前运行 session 后失效。
- `ViewerResourceKey` 用于 Warm/Cold 阅读现场，同一账号重新进入资源时仍可定位。
- `ViewerDraftKey` 用于文本草稿冲突检测；revision 不同的草稿不能直接覆盖当前正文。
- `accountScope` 使用稳定账号身份；匿名模式使用仅限本机的稳定设备 scope。它不能使用每次登录都会变化的 runtime session id。
- `libraryId` 必须显式存在，不能靠 URL 反解析作为唯一来源。
- `resourceIdentity` 优先 `node:<nodeId>`；无节点资源只能使用经过规范化且不暴露敏感信息的稳定身份。无法得到稳定身份时，只允许 Hot/Warm 运行期恢复，不进入 Cold 或 DraftStore。
- `viewerKind` 避免同一节点以不同 viewer 打开时 payload 冲突。

当前 opaque stable id 必须使用 `sha256:`、`uuid:`、`object:`、`storage:` 或 `external:` namespace；新增 namespace 需要先确认来源稳定、可重建且不携带敏感信息，再更新公共 validator。`user:<id>` 和 `node:<id>` 都只接受 canonical 的正安全整数，不接受前导零、零值或超出 JavaScript 安全整数范围的值。所有来自 Cold、DraftStore 或其他反序列化边界的 key 都必须重新通过同一 validator，不能只依赖 TypeScript 类型。

签名 URL、`blob:` URL、本地临时路径和对象 URL 都不能作为主要身份。

### 4.2 Snapshot envelope

可持久化 snapshot 按资源而不是按当前 tab 定位：

```ts
interface ViewerSessionSnapshot<TPayload> {
  schemaVersion: number;
  identity: ViewerResourceKey;
  contentRevision: string | null;
  savedAt: number;
  payload: TPayload;
}
```

`tabId` 和 `mountGeneration` 只存在于 live registry，不进入资源 snapshot 的主键。这样关闭再打开、tab 重排或跨路由重建时仍能按资源恢复，同时不会把旧 adapter 误认为当前实例。

### 4.3 Content revision 前置条件

`contentRevision` 长期应来自后端提供的稳定内容版本，例如对象版本、内容 ETag、storage fingerprint 或由服务端生成的单调 revision。节点显示名称、签名 URL 和客户端时间都不能作为内容版本。

在实现 Cold snapshot 和 DraftStore 前必须先完成：

1. 审计节点详情接口是否已有可靠内容版本字段。
2. 将 `libraryId` 和内容 revision 沿文件打开链路传入 `FileViewerTab`/viewer session identity。
3. 保存成功后获取新 revision，并与正文提交、draft 清除作为同一业务结果处理。
4. reload 时重新读取 revision，失效旧内容相关状态。

如果后端暂时没有内容版本：

- 只读 viewer 可以先用 `reloadToken` 作为当前运行期 generation，但不能把它写入 Cold 当成持久 revision。
- Text Viewer 可以对首次加载的原始正文计算稳定内容 hash，作为 DraftStore 的临时基线；保存或重新加载后必须重新计算。
- 无法确认 revision 的 draft 恢复必须提示用户比较，不得自动覆盖。

### 4.4 资源替换事务

当前 Audio/Video 播放列表会通过 `replaceTabId` 在原位置切换到另一个资源。目标 session 层必须把它视为显式事务：

1. 同步 capture 旧 live instance，并按旧资源 policy 保存或丢弃 snapshot。
2. 注销旧 `ViewerLiveInstanceKey`，释放旧 tab 对应媒体 owner。
3. 更新 `FileViewerContext` 中的 tab/resource 事实。
4. 为新 tab id/resource identity 创建新的 `mountGeneration`。
5. 只读取新 `ViewerResourceKey` 对应 snapshot，再注册新 adapter。

上述步骤不能只靠新组件 mount 和旧组件 cleanup 的偶然顺序完成。事务中任何异步结果都必须携带 generation，旧资源回调不得写入新资源实例。

### 4.5 失效规则

- 普通 tab 失活：保存，不失效。
- 普通工作区隐藏或路由卸载：保存，不失效。
- 内容刷新：删除同资源旧 revision，创建新 generation，不留下多个旧 token 项。
- 文件保存成功：保留与内容无关的 UI 偏好；更新内容 revision；清除已提交 draft。
- 关闭 tab：释放 Hot 实例；阅读 snapshot 是否保留由 policy 明确声明，不能依赖 cleanup 偶然决定。
- 删除节点：清除该资源全部本地 snapshot、draft 和媒体资源。
- 显式释放资料库：按 `libraryId` 清除可丢弃的本地 session 和运行资源；不能依赖当前 tab cache 还能枚举到目标，也不能静默删除 dirty draft。
- 退出登录或 401：清除当前运行 session 的工作区状态和运行资源；持久 draft 与其他账号隔离，同一账号重新登录后仍可恢复。
- 后端 `viewMeta`：只有明确的“清除远端进度”操作才能删除，不能被前端 workspace release 连带删除。

## 5. Hot、Warm、Cold 三层模型

### 5.1 Hot：已挂载实例

Hot 层保留完整 React/DOM/canvas 现场，目标规则：

- active tab 始终保留。
- dirty 且尚未安全写入 DraftStore 的编辑器必须保留。
- 正在播放或处于 PiP 的媒体由媒体服务 pin，不按普通 viewer 淘汰。
- 其他 tab 按最近访问和成本预算保留。
- 被淘汰前先同步 capture 最新 snapshot，再从 keep-alive 集合移除。

初始实现先支持 `light / medium / heavy` 三档成本，不把最终数字写死。完成真实内存基线后再确定桌面默认预算；至少需要覆盖长 PDF、漫画、图集和多个视频同时打开的场景。

在所有 viewer 具备可靠 Warm 恢复前，不启用 Hot 淘汰。

### 5.2 Warm：进程内 snapshot

Warm 层由统一 registry 管理：

- 采用按估算字节或权重的预算，不只按条目数。
- 快照只保存恢复所需的小型可序列化数据。
- 不保存 DOM、canvas、MediaElement、函数、Blob、大图数据和未标注过期时间的临时 URL。
- 高频滚动更新在 viewer 内先用 `requestAnimationFrame` 或 debounce 合并，再写 registry。
- 淘汰只丢弃可再构建 snapshot，不得淘汰未保存草稿。

### 5.3 Cold：设备或远端恢复

Cold 层按能力分成两类：

- IndexedDB：本机跨路由、刷新和重启恢复；适合 UI 现场和草稿。
- 后端 `viewMeta`：跨设备的语义阅读/播放进度；只保存页锚点、媒体时间等稳定小数据。

不是所有 Warm payload 都应写入 Cold：

- 卡片列表和临时链接应重新请求。
- hover、弹框、拖拽不能持久化。
- viewer 布局偏好可以按产品语义选择文件级、viewer 级或用户级持久化。
- 远端同步优先使用服务端 revision、ETag 或服务端生成的更新时间解决冲突。客户端 `updatedAt` 只作为历史兼容降级，不能作为跨设备覆盖的长期唯一依据。

## 6. Viewer 接入契约

### 6.1 Policy 必须穷举

新增一个编译期完整的 session policy 表：

```ts
type ViewerSessionPolicy = {
  defaultHotCost: 'light' | 'medium' | 'heavy';
  warm: 'none' | 'memory';
  cold: 'none' | 'device' | 'remote' | 'device-and-remote';
  closeBehavior: 'discard' | 'retain-reading-position';
  hasDraft: boolean;
};

const viewerSessionPolicies = {
  // 每一种 FileViewerFileType 都必须显式声明
} satisfies Record<FileViewerFileType, ViewerSessionPolicy>;
```

即使某个 viewer 不需要恢复，也必须声明 `warm: 'none'`，不能保持未定义。`defaultHotCost` 只是没有运行时数据时的基线，不能把同类型所有实例视为固定成本。当前所有 `warm: 'memory'` 类型都已接入公共 registry；新增类型仍必须同时完成 adapter、codec 和恢复验证，不能只补 policy。

### 6.2 Live adapter

已挂载 viewer 通过 hook 向 registry 登记最窄的命令接口：

```ts
interface ViewerSessionAdapter<TPayload> {
  capture(): TPayload | null;
  restore(snapshot: TPayload): void;
  suspend(): void;
  resume(): void;
  estimateCost(): number;
  getPinReasons(): Array<'active' | 'dirty' | 'playing' | 'pip'>;
}
```

约束：

- `capture` 必须同步、轻量，不发网络请求。
- `restore` 只恢复 viewer 自有状态，不修改 tab 或页面工作区 owner。
- `suspend/resume` 用于暂停非必要观察器、动画或后台工作，不等于媒体释放。
- `estimateCost` 根据当前页数、已解码媒体、canvas、列表规模等返回动态成本；registry 可以结合 policy 默认档位做预算。
- 动态成本只在文档装载、列表规模或已解码资源集合变化时重新估算，不能在每次 scroll/timeupdate 热路径中序列化整个 payload。
- `getPinReasons` 只投影当前不能淘汰的原因，不复制 dirty、播放或 PiP 状态的 owner。
- 真正资源释放仍由 React cleanup 和媒体服务完成。
- adapter 不进入可序列化 snapshot，也不跨组件卸载存活。

### 6.3 保存与恢复时机

不能只依赖 unmount cleanup，因为当前大量 tab 只隐藏不卸载，异常退出也不保证 cleanup。

最低要求：

- 语义状态变化时更新 Warm snapshot。
- 滚动时按帧或 debounce 更新阅读锚点。
- active 变为 false 时 flush。
- Hot 淘汰前 capture。
- 页面进入后台和应用退出前尽力 flush Cold；不能把这一时机当作唯一保存入口。
- 恢复分为同步 state hydration 和异步布局定位两阶段。

### 6.4 滚动锚点

列表、分页文档和虚拟化 viewer 的恢复顺序统一为：

1. 稳定实体锚点，例如 line、pageId、cardId、mediaId。
2. 锚点元素内部偏移比例。
3. 整体滚动比例。
4. 原始 `scrollTop` 兜底。

恢复必须由 viewer 报告 ready，并在所需数据和布局可用后执行。对于异步图片、PDF canvas、虚拟列表或分页加载，需要允许：

- 根据锚点继续加载直到目标实体出现。
- 使用 `ResizeObserver` 或受控重试等待布局稳定。
- 用户主动滚动后立即取消 pending restore，避免把用户拉回旧位置。

PDF、Comic、Comic Archive 和 ASMR Archive 的现有 anchor 模型可作为公共 primitive 的来源；不能直接把某一个 viewer 的 DOM 结构抽成全局组件。

### 6.5 异步 generation

统一 session handle 应提供 generation 或 `isCurrent()` 判断。reload、资源切换和卸载后，旧请求不能把结果写回新 session。

支持 `AbortSignal` 的请求应主动取消；不支持取消的请求至少在提交 state 前校验 generation。Gallery 当前已有 generation 防护，可作为迁移参考。

远端 `viewMeta` 进度同步必须采用 latest-wins：完成中的请求只能确认并清除自己发送的 pending 值；如果请求期间产生了新位置，必须保留并继续调度最新版。资源 generation 已变化时，旧请求即使完成也不能修改新资源的 base meta、in-flight 标记或重试计时器。

### 6.6 配置稳定性

CodeMirror、pdf.js、播放器、观察器和昂贵 extension 的配置必须：

- 模块常量化，或使用稳定 `useMemo/useCallback`。
- 把真实配置变化与 active tab 变化分开。
- 不因为无关 parent rerender 执行 reconfigure、重新加载资源或重建 observer。

Text Viewer 的 `basicSetup` 是第一项需要修正的已知案例。

## 7. 代码边界

公共 session 基础能力建议收敛在：

```text
src/features/file-viewer/session/
  viewer-draft-store.ts
  viewer-session.types.ts
  viewer-session-identity.ts
  viewer-session-registry.ts
  viewer-session-policies.ts
  viewer-session-close.ts
  viewer-session-runtime.ts
  useViewerSession.ts
  index.ts
  *.test.ts

后续按需新增：
  viewer-session-storage.ts
  scroll-anchor.ts
```

规则：

- `viewer-session-registry.ts` 不 import React viewer 组件。
- registry runtime 由 application/auth session 级 service 持有；React Provider 如需提供访问入口，只投影同一个 service，不能在 `library detail` mount 时重新创建 store。
- viewer payload 类型和 codec 留在各 viewer 目录，避免公共层知道所有业务字段。
- `workspace-resource-release` 按 library/session 直接清 registry，不枚举 tab，也不静态 import 具体 viewer。
- `FileDispatcher` 继续只负责渲染分发；session policy 用 `Record<FileViewerFileType, ...>` 独立做穷举门禁。
- 媒体 DOM 和播放 owner 继续留在 `globalAudioPlayer`、`global-video-elements` 和 `floatingVideoService`。
- viewer 不得重新引入独立模块级 snapshot `Map`；新需求先扩展 codec 或公共 registry 契约。

## 8. 分阶段落地

### 阶段 0：修复已知正确性问题

当前状态：代码已完成。阶段 0 的遗留 cache 已在阶段 3 收口时全部删除。

- 稳定 Text Viewer 的 CodeMirror `basicSetup` 和 keep-alive DOM 顺序，消除普通 tab 切换滚动归零。
- 明确 Gallery 卸载与关闭的不同语义，停止在普通路由卸载时删除可恢复 snapshot。
- 修正 Video/Audio/ASMR Archive 的刷新失效，不再 remount 后命中旧 cache。
- 暂时保持当前全部 Hot 保活，避免在恢复覆盖不完整时扩大丢状态范围。

### 阶段 1：建立公共内核

当前状态：代码已完成。`npm test` 覆盖 identity、policy、schema/revision 失效、条目/字节预算 LRU、replace、generation cleanup、单库隔离和 session 释放。

- 已确认节点详情仅有 `updatedAt`，不能作为可靠 content revision；`FileViewerTab` 已携带 `libraryId` 和显式可空 revision，Text 内容 hash 降级留到阶段 2。
- 实现 session identity、envelope、registry、policy 穷举和 library/session 清理。
- 先只支持 Warm memory，不立即加入 IndexedDB 和 Hot 淘汰。
- 给 registry 增加单元测试：三类 key、版本、LRU、预算、replace 事务、失效、单库释放、session 释放。
- workspace release 已只依赖 registry；关闭策略、单库隔离和 session 释放均有公共内核测试覆盖。

### 阶段 2：双样本纵向验证

当前状态：PDF/Text 代码迁移、自动化测试和 Electron 真实样本人工验收均已完成。

- PDF：已迁移现有成熟 anchor snapshot；独立 `pdf-viewer-cache.ts` 和 legacy release 分支已删除，reload generation 由公共 runtime 精确失效。80 页样本已验证页码跳转、缩放锚点、Text/PDF 热 tab 往返、工具区往返、关闭重开续读和工作区宽度变化；实际视口、受控页码和 snapshot 保持一致。
- Text：已接入最小 IndexedDB DraftStore 与公共 registry；草稿输入 debounce，失活/卸载/pagehide 尽力 flush，恢复必须显式选择，revision 不同会显示冲突提示；UI snapshot 不含正文，只保存选区、顶部行、滚动、字号和换行。
- Text 真实样本已验证跨应用重启恢复、revision 冲突的“使用最新文件/恢复草稿”两条分支、保存后清理、保存期间继续编辑、保存期间切换 tab，以及关闭原 tab 后旧保存回调不重建 tab。
- Text 保存成功会清除已提交 draft；保存请求期间产生的新编辑不会被旧正文覆盖，而是基于已保存正文的新 hash 继续落为 dirty draft。后续 draft 写入失败时保持 dirty 并显示警告，不能用成功提示掩盖；签名 URL 只静默更新发起保存的现存 tab，不激活或重建已关闭 tab。
- 节点软删除、彻底删除和清空回收站统一通过 node deletion service 收口；后端确认成功后按当前账号批量清对应节点 Text draft，并提升 draft writer generation，阻止旧组件延迟 cleanup 写回。后端删除失败的节点不会被误判为已删除或提前清草稿。
- 迁移完成后删除 PDF/Text 旧 cache 或无快照实现，不能长期双写。

这两个样本分别覆盖异步文档布局和可编辑草稿，足以验证公共契约是否成立。

### 阶段 3：补齐所有 viewer

当前状态：已完成。旧 cache 和 release bridge 已删除；全量 lint、单元测试和生产构建已通过，全部 Warm-capable viewer 已完成与风险相匹配的 Electron 真实样本验收。

- 普通 ASMR：保存稳定浏览路径、列表锚点/比例、选择、播放节点和队列父目录；路径逐级验证，失效层级回退，播放 URL 与目录列表重新请求。
- Video：保存播放时间投影、倍速、字幕开关/来源/样式和操作台状态；媒体元素继续由 `floatingVideoService` 持有，Warm 与远端进度按更新时间选择。
- Video/Audio Archive：分页加载直到锚点出现；Audio 只保存稳定选择，实际播放从 `globalAudioPlayer` 反向投影。
- Comic：保存滚动/翻页、单双页、缩放、页间距、页锚点和翻页变换；页数组及临时图片链接重新加载。
- Comic/ASMR Archive：Warm 优先，未命中时读取远端 `viewMeta`；分页直到稳定卡片锚点出现，锚点失效后按比例和绝对位置降级。
- 所有 adapter 在同一资源生命周期内保持稳定，卡片/分页状态通过 ref 读取，避免数据加载导致重复注册和重复 restore。
- 异步锚点尚未落位时，adapter capture 保留 pending snapshot，不用首批分页的临时顶部位置覆盖旧现场；远端进度写入采用 latest-wins，并用资源 generation 隔离旧请求回调。

本阶段在第三个 `win` 测试库完成以下定向验收；前两个日常库未被改动：

- 普通 ASMR 的嵌套路径、跨目录播放队列和真卸载恢复通过；播放事实始终由 `globalAudioPlayer` 投影。
- Video 的观看位置、`1.25x` 倍速和操作台在真卸载后恢复；媒体元素继续由全局视频服务持有，样本没有库内字幕时由 codec 单测覆盖字幕偏好 envelope。
- Video Archive 从第 31 张附近真卸载后恢复，并自动补齐 66 张卡片；Audio Archive 跨过第 60 项分页，恢复末页选择且全局音频队列在重建期间继续推进。
- Comic 从滚动模式第 11 页切到翻页双页模式并真卸载后，页码、模式和双页设置恢复；缩放、平移和旋转字段由 codec 单测覆盖非法值与 envelope 边界。
- Comic/ASMR Archive 先用 CLI 固定远端末页位置，确认 Cold 恢复；再把 Warm 移到顶部并保留远端末页，真卸载后均由 Warm 胜出。
- 显式释放 `win` 工作区后，文件 tab、目录树现场、媒体实体和 Warm snapshot 均被清除；重新进入归档只采用远端进度，不恢复释放前的本地现场。

### 阶段 4：启用有限 Hot 保活

- 完成 viewer 成本基线测量。
- 引入按成本的 Hot LRU 和 pin 规则。
- 验证淘汰前 capture、恢复后 ready、媒体 handoff 和 dirty draft 保护。
- 确认打开大量 tab 后内存进入稳定区间，再替换当前无限 keep-alive。

### 阶段 5：Cold 持久化

- 在阶段 2 最小 DraftStore 的基础上，把允许跨重启恢复的普通 viewer envelope 接入 IndexedDB。
- 为 schema migration、过期、配额失败和损坏数据提供降级。
- 保留现有 Comic、Video 和归档远端 `viewMeta` 兼容，并逐步接入统一 codec。

## 9. 新 Viewer 接入清单

新增 viewer 必须完成：

1. 在 `FileViewerFileType` 声明类型。
2. 在 `FileDispatcher` 声明渲染映射。
3. 在 session policy 表声明默认 Hot 成本、Warm/Cold 能力、关闭语义和 draft 能力。
4. 定义 live instance、resource 和 draft 所需身份，禁止以签名 URL 为主键。
5. 确认 `libraryId`、内容 revision 及保存后 revision 更新链路。
6. 定义 payload schema 和 `schemaVersion`；明确哪些字段禁止持久化。
7. 接入 `useViewerSession`，实现同步 capture、动态成本/pin 投影与 ready 后 restore。
8. 对滚动容器实现 anchor、ratio、`scrollTop` 降级。
9. 对异步请求接入 generation/abort 防护。
10. 声明 reload、replace、保存、关闭、删除和 workspace release 的失效行为。
11. 添加 registry/codec 单测和对应手工验证。
12. 在 `docs/viewers/` 补充局部状态和恢复语义。

缺少第 3 项时应产生 TypeScript 编译错误；没有通过恢复矩阵时不能视为 viewer 完整接入。

## 10. 验证门槛

每一种接入 Warm snapshot 的 viewer 至少验证：

- 在目标位置切换到另一文件 tab，再切回来。
- `file-viewer -> browser/tools/system -> file-viewer`。
- 资料库 A -> 资料库 B -> 资料库 A。
- Hot 淘汰后重新挂载。
- 窗口尺寸变化后按锚点恢复，而不是只验证相同尺寸。
- reload 后不恢复旧内容 snapshot。
- Audio/Video 播放列表 `replaceTabId` 后只恢复新资源现场，旧 adapter 和异步回调不残留。
- 关闭再打开符合该 viewer 的 `closeBehavior`。
- 显式释放资料库后不恢复可丢弃的 viewer session；dirty draft 按 DraftStore 规则保留或确认丢弃。
- 退出登录后不恢复上一运行 session 的普通 viewer 现场；持久 draft 只允许同一账号恢复。
- 缓存中的临时 URL 过期后能重新解析，不白屏。

Text 额外验证：

- 光标、选区、顶部行、字号和换行恢复。
- dirty draft 在切 tab、Hot 淘汰、路由卸载和应用重启后可恢复。
- 远端内容 revision 变化时提示冲突，不静默覆盖草稿。
- 保存成功后 draft 清除，但当前阅读位置不重置。
- 保存过程中切换或关闭 tab 后，旧异步回调不改变当前 active tab，也不重新创建已关闭 tab。
- 保存期间继续编辑且 DraftStore 写入失败时，dirty 保持且反馈不能声称草稿已持久化。

媒体额外验证：

- Hot 淘汰不能复制 `<audio>/<video>` 元素或产生双 owner。
- 播放、PiP、MediaHub 和 tab 关闭释放继续遵守 `docs/media-hub-contract.md`。
- session snapshot 只保存媒体进度投影，不保存 DOM 或控制回调。

性能验证至少记录：

- 空闲基线内存。
- 依次打开 10、30 个混合 viewer 后的内存。
- Hot 淘汰并等待资源释放后的内存。
- 长 PDF、漫画、图集滚动时 snapshot 写入频率和主线程开销。

## 11. 自动化与诊断

项目已提供 `npm test`，当前使用 Vitest 覆盖 Viewer Session 纯 TypeScript identity、policy 和 registry。后续每个 viewer 迁移时必须继续补 codec/adapter 单元测试与对应手工恢复验证，不能只依赖现有公共内核测试。

Registry 应提供开发环境诊断事件：

- `registered`
- `captured`
- `restored`
- `invalidated`
- `evicted`
- `disposed`
- `restore-skipped`，附带版本不匹配、内容 revision 变化或 payload 损坏等原因

日志只能记录 key、kind、版本、估算成本和原因，不能输出文本草稿、签名 URL、字幕内容或其他 payload。live registry 的内部索引可以包含 tab id，但诊断 key 只能由 runtime、resource identity 和 mount generation 组成，不能序列化原始 tab id；无节点 tab 的 id 可能直接包含完整 URL。

## 12. 非目标

- 不把所有 viewer UI 抽成统一组件。
- 不把具体 payload 上提到页面工作区或 `FileViewerContext`。
- 不用 React Context 广播每次滚动和播放时间。
- 不把全量卡片、图片、PDF canvas 或媒体 DOM 写入 IndexedDB。
- 不在第一阶段同时改造全部 viewer、引入 Hot LRU 和 Cold 持久化。
- 不用“永远挂载所有组件”替代状态恢复设计。

## 13. 维护规则

出现以下变化时必须更新本文：

- session identity、snapshot envelope 或 schema migration 变化。
- Hot/Warm/Cold 层级或预算变化。
- viewer close、reload、delete、workspace release 语义变化。
- DraftStore 或远端 `viewMeta` 所有权变化。
- 新 viewer 接入流程变化。
- 当前审计矩阵中的 viewer 能力完成迁移。

每完成一个迁移阶段，应把本文对应部分从“目标”更新为“当前事实”，并删除已经不再存在的过渡方案。
