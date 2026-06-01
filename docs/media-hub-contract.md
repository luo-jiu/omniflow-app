# MediaHub 契约

更新时间：2026-06-01（含 GalleryViewer 视频接入）
适用范围：`MediaRegistry`、`globalAudioPlayer`、`floatingVideoService`、`MediaHubPopover`、`FloatingMiniVideoPlayer`，以及 audio / video / asmr / audio-archive viewer 与 `FileViewerContext` 的 tab close 路径。

> 本文是 MediaHub 行为的**单一真源**。修改任何与"出声"或 MediaHub 入口相关的代码前必须先读这里。变更行为时必须同步更新本文，并在 PR 描述中点名。

## 1. 角色与不变量

### 1.1 出声实体（v1）

只有以下两类被纳入 MediaHub：

- **音频**：普通音频 viewer、ASMR viewer、音频归档 viewer，统一通过 `globalAudioPlayer`（模块级单例 `<audio>`）出声。
- **视频**：普通视频 viewer、视频归档点开后的 video viewer、图集 viewer 内的视频详情，DOM 元素由 `global-video-elements` 单例池持有，由 `floatingVideoService`（模块级单例）跨路由跟踪状态。

**内置浏览器内的视频暂不纳入 MediaHub**（v2 候补，参见 §6）。

### 1.2 单例约束

- 同一时刻 MediaHub 至多 1 条 audio 记录（`entryId = 'audio:active'`）。
- 同一时刻 MediaHub 至多 1 条 video 记录（`entryId = 'video:active'`）。
- 新源接管旧源：在 audio / video 服务内通过 `ensureSource` / `bindInline` 直接覆盖。

### 1.3 注册由"服务层"完成，不绑定 React 生命周期

> ⚠️ 这是 MediaHub 最重要的契约。打破它会立刻引发"音频/视频还在出声但 MediaHub 看不到"或者"切走页面就被自动暂停"。

- `globalAudioPlayer` 在 `ensureSource()` 后由内部 `syncMediaRegistry()` 调用 `mediaRegistry.register()`；`clear()`（含 `releaseForTab`）时取消注册。
- `floatingVideoService` 在视频被 play 过（`hasStarted=true`）且有 `tabId` 时注册；`dismiss()`（含 `releaseForTab`）时取消注册。
- `GalleryViewer` 不复用普通 `VideoViewer` UI，但图集视频详情必须继续通过 `mountGlobalVideoElement` + `floatingVideoService.bindInline()` 接入服务层；不得在图集组件内直接调用 `mediaRegistry.register()`。
- **viewer 组件不得调用 `useRegisterMediaEntry`**。`MediaRegistryProvider` 仍存在但只做 Context 注入，不再决定 registry 生命周期。
- `mediaRegistry` 是模块级单例（`src/contexts/media-registry.singleton.ts` 的 `export const mediaRegistry`），全应用生存期内只有一份；`MediaRegistryContext.tsx` 只暴露 `MediaRegistryProvider`。

### 1.4 释放 vs 软关闭 / 收起

| 路径 | 视频 | 音频 | 是否释放元素 | hub entry |
|---|---|---|---|---|
| 浮窗 ×（软关闭） | pause + 收起浮窗 | —— | 否 | 保留（已暂停） |
| 浮窗 收起 | 不动播放，仅收起浮窗 | —— | 否 | 保留（仍在播） |
| MediaHub × | dismiss → release | clear → release | 是 | 消失 |
| `closeTab` / `closeTabByNodeId` | dismiss → release | clear → release | 是 | 消失 |
| `disposeLibraryWorkspace(libraryId)` | 命中同 library 时 dismiss → release | 命中同 library 时 clear → release | 是 | 消失 |
| `disposeSessionWorkspaces()` | dismiss → release | clear → release | 是 | 消失 |
| 新源接管 | bindInline 切 key → 旧元素 release | ensureSource 换 url → audio 自然换源 | 视频是、音频否 | 旧消失/被替换 |

`FileViewerContext.closeTab(tabId)` 与 `closeTabByNodeId(nodeId)` 必须在删除 tab 前调用：

```ts
globalAudioPlayer.releaseForTab(tabId);
floatingVideoService.releaseForTab(tabId);
```

音频只在 `state.tabId === tabId` 时真正释放，因此对其他 tab 是 no-op。
视频额外有一层兜底：如果当前 `floatingVideoService.state.tabId` 已不指向目标 tab，`releaseForTab(tabId)` 仍必须释放 `global-video-elements` 中以该 tab 为 owner 的 DOM 元素，防止播放列表切集、切换多视频 tab 等路径留下无 owner 的后台 `<video>`。

`setFileUrl(..., { replaceTabId })` 在把旧 tab 替换成新 tab 前，也必须先按 `replaceTabId` 调用同一释放链。替换 tab 在用户心智上等价于关闭旧 tab 后打开新内容，不能只依赖 React viewer 卸载。

> ⚠️ `closeTabByNodeId` 内的 `releaseMediaForTab` 必须在 `setViewerState` updater **之外**调用——updater 是纯函数，StrictMode 会双调用，把副作用塞进去会重复 release。

`workspace-resource-release` 只能通过服务层接口释放 MediaHub 资源：

- 单库释放调用 `globalAudioPlayer.releaseForLibrary(libraryId)` 和 `floatingVideoService.releaseForLibrary(libraryId)`，只清命中目标资料库的出声实体。
- session 释放调用 `globalAudioPlayer.clear()` 和 `floatingVideoService.dismiss()`，清空当前会话全部出声实体。
- 释放路径不依赖 React viewer 卸载，也不直接操作 `mediaRegistry`。registry 仍由 `globalAudioPlayer` / `floatingVideoService` 自注册和注销。

### 1.5 跨路由保活

离开 `/libraries/:id` 时：

- 视频：`VideoViewer` cleanup 调 `floatingVideoService.handoffToFloating()`，`<video>` 元素永远停留在 connected document，从 inline host appendChild 到 floating host。**禁止**改成 `setTimeout(0)` + `parkGlobalVideoElement` —— 中间脱离 document 的那一拍会触发 Chromium 自动暂停。
- 音频：`globalAudioPlayer` 不依赖 DOM，单纯继续播放，无需任何额外搬运。

回到 `/libraries/:id` 且对应 tab 重建 viewer 时：

- 视频：`mountGlobalVideoElement(key, host)` 把元素从 floating host 搬回 inline host；`floatingVideoService.bindInline()` 收起浮窗。
- 音频：`ensureSource` 看到同一 url 时只更新 metadata，不重建 audio。

## 2. 接口面

### 2.1 `mediaRegistry`（模块单例）

```ts
import { mediaRegistry } from '@/contexts/media-registry.singleton';

mediaRegistry.register(input): MediaRegistryRegistration
mediaRegistry.subscribe(listener): () => void
mediaRegistry.getEntries(): MediaEntry[]
mediaRegistry.play(entryId)   // 仅供 MediaHubPopover 转发
mediaRegistry.pause(entryId)
mediaRegistry.seek(entryId, t)
mediaRegistry.dismiss(entryId)
```

`update(patch)` 不接受 `tabId`。tabId 变化必须 `unregister` + `register` 重建（已在两个服务中实现）。

### 2.2 `globalAudioPlayer`（音频服务）

字段：`tabId`、`libraryId`、`thumbnailUrl`、`registration`、`registeredTabId`。

接口：

```ts
ensureSource(url, trackName?, options?: {
  ownerType, ownerKey, tabId, libraryId, thumbnailUrl
})
releaseForTab(tabId: string): void   // 仅当 state.tabId === tabId 时 clear()
releaseForLibrary(libraryId: number): void // 仅当 state.libraryId === libraryId 时 clear()
clear()                              // 同时取消 registry 注册
```

`syncMediaRegistry` 守门：必须 `src && tabId && hasStarted` 才进 hub，与 video 服务对齐。`useGlobalAudioPlayback` 接受 `tabId` / `libraryId` 选项，并在 `ensureSource(url, trackName?, thumbnailUrl?)` 中把 thumbnailUrl 透传到服务（每首曲目可换封面）。

### 2.3 `floatingVideoService`（视频服务）

字段：`registration`、`registeredTabId`、`hasStarted`、`hostMode`。

接口：

```ts
seek(time: number): void
requestSystemFloating(): Promise<boolean> // 用户主动触发桌面小窗；优先 Document PiP，其次 Electron 系统小窗，最后应用内浮窗
softClose(): void          // 暂停 + 收起浮窗 UI；元素/hub entry 保留
hide(): void               // 仅收起浮窗 UI；不暂停
releaseForTab(tabId: string): void
releaseForLibrary(libraryId: number): void
dismiss(): void            // 完全释放：pause + remove src + delete element + 取消注册
```

`hasStarted` 在 `<video>` 触发 `play` 事件时置 true；`bindInline` 切到新 key 或 `dismiss` 时回到 false。MediaHub 只显示已 `play` 过的视频，匹配旧 `useRegisterMediaEntry({ enabled: hasStartedPlaying })` 语义。

`hostMode` 表达当前视频播放权归属：

- `inline`：视频在 `VideoViewer` 的 `.video-element-host`。
- `app-floating`：视频在应用内 `FloatingMiniVideoPlayer` host。
- `document-pip`：视频在 Chromium Document Picture-in-Picture window。
- `system-window`：视频由 Electron 独立 `BrowserWindow` 播放。该模式不是搬同一个 DOM 元素，而是用同一视频 URL + 当前进度接力播放，并通过 IPC 同步 play/pause/seek/currentTime。它可以拖到应用窗口外，是 Document PiP 不可用时的桌面级小窗 fallback。

`softClose` / `hide` 都不动 `hasStarted` 也不取消注册。处于 `app-floating` 时，元素继续留在 floating host（`transform: translate(20000px, 20000px)` 移到屏外但保持 connected document）；处于 `document-pip` 时，会先把元素移回应用内 floating host 再关闭 PiP 窗口。用户回 library 时 `mountGlobalVideoElement` + `bindInline({ forceInline: true })` 把元素搬回 inline。

Document PiP 只作为**用户主动点击**的优先路径，因为 Chromium 通常要求用户手势。离开资料库等被动 cleanup 仍走 `handoffToFloating()`，已有 PiP 时保持 PiP，否则走应用内浮窗。

部分 Electron / Chromium 环境会暴露 `documentPictureInPicture.requestWindow`，但返回尺寸为 `0x0` 的不可见窗口并立即 `pagehide`。这类情况视为 Document PiP 不可用，`requestSystemFloating()` 必须继续降级到 Electron 系统小窗；若系统小窗也不可用，最后才降级到可见的应用内浮窗，避免出现“视频继续播放但用户看不到任何小窗”的隐藏播放态。

### 2.4 跨路由"待激活 tab"协调器

文件：`src/contexts/file-viewer-pending-activation.ts`

```ts
setPendingActivation(libraryId, tabId)    // 预留给未来外部入口的 MediaHub jump
takePendingActivation(libraryId)          // 由 FileViewerProvider 消费
subscribePendingActivation(listener)      // 同 libraryId 内多次 set 也能被 emit 触发
```

`FileViewerProvider` 接受 `libraryId` prop，在 mount 和订阅触发时取走 pending 并 setActiveTabId。同一库内 navigate 不会让 Provider 重 mount，但 emit 会驱动 effect 重新消费。

## 3. UI 入口

- **库 / 资源页原有头部工具区**：仓库页新增与资源页同规格的主内容头部，MediaHub Popover 入口放在右侧工具按钮组，设置仍保留在左下角侧栏；`library detail` 继续使用 `ContentToolbar .toolbar-right`。这里沿用原本的工作区工具按钮，不新增全局产品顶栏。
- **`MediaHubPopover`**：弹窗组件本身保留为 dumb component，`onActivate` / `onToggle` / `onSeek` / `onDismiss` 由调用方提供。entry 行的"跳转 tab"按钮根据 `kind` 显示不同 title（`回到视频 tab` / `回到音频 tab`）。
  - Registry 内的 `currentTime` 仍允许按秒级低频更新，避免全局广播抖动；Popover 打开时可在组件内部用 `requestAnimationFrame` 做播放中进度插值，只影响本地显示，不改变 `MediaRegistry` 的状态 owner。
- **`FloatingMiniVideoPlayer`**：在 `App.tsx` 顶层始终挂载（host ref 不被卸载），通过 `data-visible` 控制显隐：`transform: translate(20000px, 20000px)` 移到屏外但保持 connected DOM。
  - header 包含两个按钮：「收起」（IconChevronDown）→ `hide()`；「×」→ `softClose()`
  - 点击 header 主体：写入 pending activation 并 navigate 回 `/libraries/:libraryId`，触发对应 viewer 重新 mount → `bindInline` 把元素搬回 inline host → 浮窗自动收起
  - 拖拽 header 可在应用窗口内移动小窗；应用内浮窗不能越出 Electron 主窗口，真正桌面级浮窗由 Document PiP 或 Electron 系统小窗提供。
- **`VideoViewer` 桌面小窗按钮**：底部控制条的小窗按钮调用 `floatingVideoService.requestSystemFloating()`。
  - 支持 `documentPictureInPicture.requestWindow` 时，打开桌面级 Document PiP 窗口，视频元素直接搬入 PiP document。
  - Document PiP 不支持、请求失败或返回 `0x0` 不可见窗口时，降级为 Electron 独立系统小窗。该小窗是独立 `BrowserWindow`，可以拖到应用主窗口外；由于跨 renderer 不能搬 DOM，系统小窗使用当前视频 URL 和时间点接力播放。
  - Electron 系统小窗也不可用时，最后降级为应用内浮窗。
  - inline 区域显示海报占位 + “收回 inline”按钮；这只是 UI 占位，不是新的播放器实例。
- **库左下角设置入口**：保留原设置按钮，用户头像可放在同一侧栏容器右下角，不因 MediaHub 改造移动设置入口。
- **旧全屏系统页**：`/settings`、`/profile`、旧上传 / 回收站页面只作为迁移期兼容入口。新入口应优先使用仓库页或资源页右侧系统视图，避免路由切换影响媒体 DOM、MediaHub entry 和后台任务状态。

## 4. 行为表

| 场景 | audio | video |
|---|---|---|
| 首次播放 | service 注册 entry | service 注册 entry（hasStarted=true 起） |
| viewer 卸载（同库内切 tab） | 不动 audio，继续在 hub | `parkGlobalVideoElement`，浮窗不弹 |
| 离开 `/libraries/:id` | 不动 audio，继续在 hub | `handoffToFloating()`，浮窗弹出 |
| 视频底部小窗按钮 | —— | 优先进入 Document PiP；不可用时进入 Electron 系统小窗；再不可用时进入应用内浮窗；inline 显示海报 + 收回 |
| inline 收回按钮 | —— | `mountGlobalVideoElement` + `bindInline({ forceInline: true })`，视频回到 inline |
| Document PiP 原生关闭 | —— | 暂停视频，移回应用内 floating host 并收起，hub entry 保留（已暂停） |
| Electron 系统小窗关闭 | —— | 暂停系统窗口播放，把最后进度同步回 inline/global video，hub entry 保留（已暂停） |
| 浮窗 ×（softClose） | —— | 暂停视频 + 收起浮窗；元素留 floating host，hub entry 保留（已暂停） |
| 浮窗 收起（hide） | —— | 不动播放 + 收起浮窗；元素留 floating host，hub entry 保留 |
| `closeTab(tabId)` | `releaseForTab` 触发 `clear()`，从 hub 消失 | `releaseForTab` 触发 `dismiss()`，浮窗消失 |
| MediaHub × 按钮 | `mediaRegistry.dismiss` → `globalAudioPlayer.clear` | `mediaRegistry.dismiss` → `floatingVideoService.dismiss` |
| 库内 MediaHub jump | `activateTab(tabId)` + 切回 file-viewer | 同上；视频元素由 `bindInline` 接回 inline，浮窗自动收起 |
| 新源接管 | `ensureSource(newUrl, …)` 复用同一 audio | `bindInline` 检测到 `key` 变化时 `releaseGlobalVideoElement` 旧元素 |

## 5. 修改禁忌

- ❌ **禁止**给 audio / video viewer 重新加 `useRegisterMediaEntry` 或类似 React 副作用注册。
- ❌ **禁止**让 `mediaRegistry` 重新变成"每次 Provider mount 都新建"。它必须是模块单例。
- ❌ **禁止**用 `setTimeout(0) + parkGlobalVideoElement` 处理离库 cleanup。已知会触发 Chromium 自动暂停。
- ❌ **禁止**在不通过 `closeTab` / `closeTabByNodeId` 的路径上单独删除 tab 状态——会导致音频/视频继续播但已无 owner。
- ❌ **禁止**让 `useRegisterMediaEntry` hook 接受新调用方。它只为后续移除而保留；新的"出声"接入必须走服务层自注册。
- ❌ **禁止**在 `setViewerState(updater)` 的 updater 内调用 `releaseMediaForTab` / `globalAudioPlayer.*` / `floatingVideoService.*` 等带副作用的方法——updater 是纯函数，副作用必须在 setter 之外。
- ❌ **禁止**把浮窗 × 的语义改回"完全释放"。当前是 softClose（暂停+收起），释放走的是 hub × 和 closeTab。
- ❌ **禁止**用 `display: none` 控制 `FloatingMiniVideoPlayerWrapper` 的显隐——某些浏览器会因 `<video>` 不在 layout 树中触发 pause。继续用 `transform: translate(20000px, 20000px)`。
- ❌ **禁止**在 `isLibraryWorkspaceRoute` 调用方传 `window.location.pathname`。HashRouter 下 pathname 永远是 `/`，必须传 `window.location.hash`。
- ❌ **禁止**让 `VideoViewer` 自己直接调用 `documentPictureInPicture` 或维护 PiP window。PiP / 应用内浮窗 / inline 的宿主切换必须继续收敛在 `floatingVideoService`。

## 6. 已知缺口与 v2 候补

- 内置浏览器中的视频未接入 MediaHub。需要在 `embedded-browser` 侧暴露 `play/pause/seek/dismiss + tabId/libraryId/title` 才能纳入；目前出于对 webview 生命周期的不确定性放后处理。
- 浮窗仅 video。音频离库时没有"小窗"，回到库详情后可通过原有工具区 MediaHub 完整控制（play/pause/seek/dismiss/jump）。
- 应用内浮窗收起后用户在外部点 hub play → 视频在 off-screen floating host 内继续播放（仅声）；要看见画面需 navigate 回 library 或从 inline 占位收回。这是预期行为。
- Document PiP 依赖 Chromium 支持和用户手势；不可用、权限拒绝或请求失败时自动降级到 Electron 系统小窗，再失败才降级到应用内浮窗。
- 若 Document PiP API 名义存在但窗口尺寸为 `0x0` 或立即关闭，也按不可用处理并自动降级。
- Electron 系统小窗使用新 `<video>` 元素接力播放，依赖当前视频 URL 仍可访问。若未来预签名 URL 过短导致接力失败，应在 `floatingVideoService` 里按 `nodeId/libraryId` 重新申请 fresh link，而不是让系统窗口直接复用过期 URL。
- 暂无全局产品顶栏；不要为了 MediaHub 单独新增一个顶栏。若未来要在非库路由控制音频 / 视频，应优先复用现有窗口级工具区域或重新设计跨路由工具入口。

## 7. 维护规则

出现以下任一变化时，必须同步更新本文：

- `MediaRegistryAPI` 接口或 `MediaEntry` 字段变化（含 `libraryId`）
- 新的"出声"实体（含浏览器视频接入）
- 注册 / 注销时机调整
- tab 关闭路径或 `releaseForTab` 行为变化
- 浮窗 / popover 的入口位置变化
- 浮窗按钮语义变化（softClose / hide / dismiss）
- 跨路由跳转协调器 `file-viewer-pending-activation` 的接口变化
- 单例约束变化（例如允许多视频）
