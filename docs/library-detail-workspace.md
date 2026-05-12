# Library Detail 工作区状态说明

更新时间：2026-05-11

适用范围：`src/views/library/detail/` 页面中的工作区显示模式、浏览器 tab、搜索模式、地址栏、缓存恢复，以及和文件预览/内置浏览器之间的切换逻辑。

## 1. 概述

`library detail` 不是一个单一页面，而是一个“页面级工作区容器”。  
它同时承载：

- 文件树侧栏
- 文件预览
- 搜索主页
- 内置浏览器
- 浏览器资源面板和下载导入
- 系统工作区视图（设置、个人主页、上传中心、回收站等）

因此这页最重要的不是某个局部组件，而是“工作区状态 owner”。  
当前这份 owner 仍然应该留在页面层，不要拆散到多个 feature 里各自保存一份。

## 2. 当前状态模型

工作区持久化模型定义在：

- `src/views/library/detail/workspace-state.ts`

当前核心字段：

- `activeBrowserTabId`
- `browserInput`
- `browserModeOpen`
- `browserTabs`
- `searchDraft`
- `searchMode`
- `workspaceDisplayMode`

当前 `workspaceDisplayMode` 有 5 种：

- `search-home`
- `file-viewer`
- `browser`
- `tools`
- `system`

这个模型是页面级 source of truth，不是通用组件状态。

## 3. 状态 owner 规则

### 3.1 页面层 owner

下面这些状态的 owner 都在 `src/views/library/detail/index.tsx`：

- 浏览器 tab 列表
- 当前激活的浏览器 tab
- 浏览器地址栏输入
- 搜索模式与搜索草稿
- 当前工作区显示模式
- 浏览器资源面板展开与宽度
- 书签栏展开与管理 UI
- 浏览器设置入口与 settings 标签页显示
- pending browser file open
- 送入工具区的媒体处理请求（普通资源 / HLS 计划）
- 系统工作区当前视图与关闭后返回模式

规则：

- 这些状态可以分给子组件消费，但不要把写入权分散出去。
- 子组件若需要改变模式、tab、地址栏，应通过页面层回调完成。

### 3.2 子组件职责

当前主要子组件职责：

- `DirectorySidebar`
  - 文件树与选择入口
- `SearchWorkspace`
  - 搜索主页和搜索模式切换
- `EmbeddedBrowserPanel`
  - 浏览器显示载体，不拥有 tab 列表
- `EmbeddedBrowserResourcePanel`
  - 当前 active tab 的资源捕捉面板

其中最容易误判的是 `EmbeddedBrowserPanel`。  
它看起来像“浏览器组件”，但它不是 tab state owner，它只是“当前激活浏览器 tab 的承载面板”。

## 4. 显示模式规则

### 4.1 `search-home`

表示当前显示搜索主页，不显示文件预览，也不显示浏览器页面。

典型进入路径：

- 页面初始无 active file / 无 browser
- 文件模式返回搜索主页
- 搜索模式明确切回主页

### 4.2 `file-viewer`

表示当前以文件预览为主工作区。

典型进入路径：

- 用户在目录树中打开文件
- 浏览器模式关闭后，若仍有活动文件，则 fallback 到 `file-viewer`

### 4.3 `browser`

表示当前工作区显示内置浏览器。

进入条件通常同时满足：

- `browserModeOpen = true`
- 有有效浏览器 tab，或正在创建浏览器 tab

页面里有一条保护规则：

- 如果 `browserModeOpen = false`，但 `workspaceDisplayMode` 仍是 `browser`，会自动 fallback 到：
  - 有 active file 时：`file-viewer`
  - 否则：`search-home`

这条规则保证“显示模式”不会比“浏览器真实开关”更激进。

### 4.4 `tools`

表示当前工作区显示工具区。

当前特点：

- 目录树继续保留在页面左侧
- 右侧主工作区切换为工具容器
- 工具自身的草稿和业务状态不回写页面层

当前工具包括：

- `AI 字幕翻译`
- `媒体处理`

当前浏览器资源面板与工具区的分工：

- 资源面板负责：
  - 发现资源
  - 筛选资源
  - 解析 manifest
  - 复制下载计划
  - 把普通媒体资源或 HLS 计划送到工具区
- 工具区负责：
  - 长时间下载
  - 合并
  - 转格式
  - 保存到本地 / 内部

更详细的工具区规则见：

- `docs/tools-workspace.md`

### 4.5 `system`

表示当前工作区显示系统视图。第一版用于把设置、个人主页、上传中心、回收站、资源监测等入口放回资料库详情页右侧主内容区，避免全屏覆盖打断目录树、文件 tab、浏览器 tab 和后台媒体播放。

当前规则：

- 系统视图只在 `library detail` 右侧主内容区显示，左侧目录树继续保留。
- 系统视图按类型唯一；再次打开同一视图时聚焦已有 tab，打开不同系统视图时可以和普通文件 tab 并存在同一条工作区 tab 栏里，且支持和普通文件 tab 混排拖拽。
- 系统 tab 只和文件 tab 共用视觉容器，不进入 `FileViewerContext`，也不进入浏览器 tab 列表；系统视图状态仍由 `library detail` 页面层持有。
- 工作区 tab 的视觉顺序由 `library detail` 页面层统一维护；新打开的文件 tab 和系统 tab 都追加到最右侧，不能让文件 tab 与系统 tab 各自按不同默认分组插入。
- 关闭 system tab 或点击系统视图内部关闭按钮后，优先回到打开前的工作区模式；来源不可用时按现有 fallback 回到文件模式或搜索主页。
- 第一版不持久化 `systemWorkspaceTabs` / `activeSystemWorkspaceView`；刷新 / 重启后不会自动恢复到设置或上传视图。
- 切到文件、搜索主页或工具区时，已打开的系统 tab 不会被自动清空；用户需要通过 tab 的 `x` 或视图内部关闭按钮显式关闭。
- 浏览器模式仍使用浏览器自己的 tab 栏；切回文件 / 系统工作区后，普通文件 tab 和系统 tab 会重新显示在同一条工作区 tab 栏里。

入口规则：

- 资料库详情页左下设置按钮打开 `settings` system view。
- 资料库详情页右下头像打开 `profile` system view，并跟随目录树宽度停留在侧栏右下角。
- 上传中心和回收站按钮打开对应 system view；上传复用上传中心任务模块，回收站按当前资料库加载和操作。
- 资源监测打开 `resource-monitor` system view；资料库详情页会按当前 `libraryId` 展示单资料库物理存储分布快照、只读资源探针状态和可见 / 回收站 / 孤儿对象占用细分；可显式记录一条历史样本，可跳转到存储设置、迁移任务，且可跳转到当前资料库回收站。
- 设置页里的标签管理、存储管理、浏览器打开映射是 `settings` tab 内部页面；进入后 tab 仍显示设置，内部返回箭头回到设置首页。
- 旧 `/settings`、`/profile`、`/upload-center`、`/libraries/:id/recycle-bin` 等路由继续存在，直到新视图稳定后再评估移除。

### 4.5.1 Legacy 全屏页面

旧全屏页面处于兼容状态，不再作为新功能的首选入口。它们保留的目的只是迁移期兼容旧路由、调试路径和少量直接访问场景；后续不要继续在这些页面上扩展新的主要交互。

当前标记为 legacy 的页面：

| 旧路由 / 旧入口 | 当前推荐入口 | 备注 |
| --- | --- | --- |
| `/settings` | 资料库详情页 `settings` system tab；仓库页右侧设置视图 | 旧设置页只作兼容。 |
| `/profile` | 目录树 / 仓库侧栏右下头像打开个人主页视图 | 个人主页内容应保持 workspace-native，不再依赖全屏 shell。 |
| `/upload-center`、`/transfer-center?tab=upload` | 资料库详情页 `uploads` system tab | 上传任务状态仍归上传中心模块，视图只是新的展示宿主。 |
| `/libraries/:id/recycle-bin` | 资料库详情页 `recycle-bin` system tab | 回收站必须携带当前 `libraryId`。 |
| `/settings/tags` | `settings` tab 内部标签管理页 | 从设置、ASMR、视频、音频、漫画等入口进入时都应带上下文落到同一套内容。 |
| `/settings/storage` | `settings` tab 内部存储管理页 | 后续和物理位置迁移、存储任务联动。 |
| `/settings/browser-file-mappings` | `settings` tab 内部浏览器打开映射页 | 不再作为独立全屏管理页扩展。 |
| 资源监测 | 仓库页 / 资料库页 `resource-monitor` system tab | 只读观察入口，不作为存储配置入口。 |

历史问题：

- 全屏路由会让用户离开当前资料库，目录树、当前文件、当前浏览器 tab 的上下文都被遮掉。
- 路由切换更容易影响视频 / 音频生命周期，过去多次出现打开设置、上传、回收站后媒体被暂停或回退小窗的问题。
- 上传、回收站、设置、标签等页面各自维护头部、安全区、宽度、缩放和弹框层级，导致同类问题需要反复补丁式修复。
- Electron BrowserView、弹框、toast、右键菜单和全屏 overlay 的层级关系更难稳定。
- 仓库页和资源页的系统入口位置不一致，设置、头像、上传、回收站在视觉上来回跳，增加了使用负担。

当前规则：

- 资源页系统任务进入 `library detail` 的 `system` 工作区，使用和普通文件 tab 共用视觉容器的 system tab。
- 仓库页系统任务进入仓库页右侧系统宿主，标题从“我的库”切到对应视图。
- 点击目录树 / 仓库侧栏的业务区域时，可以退出当前系统视图回到资源或仓库内容。
- legacy 路由删除前只保证不破坏旧访问，不再承接新的主路径能力。
- 等新宿主稳定一个周期后，再统一删除旧 route、旧 shell 和只为全屏页存在的样式补丁。

### 4.6 主内容头部模式按钮

主内容头部按钮只表达页面级工作区模式，不单独创造第二份状态：

- 搜索主页按钮在 `workspaceDisplayMode = search-home` 时高亮。
- 文件按钮只在 `workspaceDisplayMode = file-viewer` 时高亮；如果没有活动文件 tab，它会禁用，避免和搜索主页产生同页但双入口的歧义。
- 归档返回按钮会替代文件按钮位置，但只保留绿色返回箭头，不复用模式按钮的 active 背景。
- 工具按钮在 `workspaceDisplayMode = tools` 时高亮。
- 浏览器入口进入浏览器后会被浏览器 tab 栏替代，不做常驻高亮。
- 系统视图进入后不再单独创建第二条 system tab 栏；同类 tab 唯一，不同系统视图和普通文件 tab 共用工作区 tab 栏，可混排拖拽，也可通过 `x` 关闭当前 tab。

### 4.7 主内容头部右侧：媒体控制中心

工具栏右侧（刷新按钮左侧）的乐符按钮是页面级"媒体控制中心"入口：

- 仅当 `MediaRegistry` 中存在已注册（即至少播放过一次的）audio / video entry 时才出现，空态隐藏。
- 进入浏览器模式后仍保留媒体控制入口；已播放的文件媒体不会因为切换到浏览器而暂停，后续浏览器内媒体接入时也走同一个控制中心入口。
- `file-viewer` 工作区在切到浏览器 / 搜索 / 工具区时只隐藏、不卸载；隐藏时会向 viewer 传递 `active=false`，让非前台快捷键和局部 portal 浮层收起，同时保留正在播放的 video DOM、audio viewer 注册关系和 `MediaRegistry` entry。
- `library detail` 通过 `LibraryWorkspaceControlsContext` 向 viewer 暴露极窄的页面级控制能力；当前只允许视频宽屏模式临时折叠 / 恢复目录树，viewer 不直接持有或持久化目录树状态。
- 点击弹出 `MediaHubPopover`，列出当前所有注册项；每条支持 play/pause、点击进度条 seek、播放进度与时长展示、通过专门按钮跳到对应 tab，以及通过 `x` 按钮结束并移出媒体控制中心。
- "跳到 tab" 路径：点击行内跳转按钮后调用 `useFileViewer().activateTab(tabId)`，再调 `openFileWorkspace()` 切回 file-viewer 模式。
- "移除" 路径：不关闭文件 tab；audio / asmr 会清空 `globalAudioPlayer`，video 会 pause 并退出本次媒体注册，下次在原 tab 里播放会重新注册。
- 不再保留旧的"顶部 GlobalAudioMiniBar"——audio 跨 tab 不再叠加额外 UI。
- 不再保留"video tab 失活自动 pause"和"audio play 自动暂停 video"的互斥；多个视频可并行，音频可与视频并行。音频底座仍是单例 `<audio>`，所以同时播多首音频仍受单例限制（属预期范围）。

## 5. 浏览器 tab 规则

### 5.1 tab 模型

当前浏览器 tab 是页面内的轻量模型，字段包括：

- `id`
- `title`
- `url`
- `canGoBack`
- `canGoForward`
- `iconUrl`
- `iconSourceUrl`

它是 renderer 侧投影，不是 main 里的真实 view。

### 5.2 创建 tab

当前创建新 tab 的标准动作会同时做：

- 新增一个空 tab
- `setActiveBrowserTabId`
- `setBrowserModeOpen(true)`
- `setWorkspaceDisplayMode('browser')`
- `setBrowserInput('')`
- `setSearchMode('web')`
- 调 `window.electronEmbeddedBrowser.openTab(next.id)`

这说明“开 tab”本身就是一个页面级复合动作，不要把它拆成多个分散更新。

空 tab 没有真实网页 URL，刷新时应视为重新加载浏览器主页：保留浏览器工作区，清空地址栏草稿，显示书签栏和空页主题，不触发原生 `webContents.reload()`。

### 5.3 激活 tab

激活 tab 时，页面会同步更新：

- `activeBrowserTabId`
- `browserModeOpen`
- `workspaceDisplayMode`
- `bookmarkBarVisible`
- `browserInput`

并调用：

- `window.electronEmbeddedBrowser.activateTab(tabId)`

因此“切换激活 tab”不是只改一个 id，而是一次页面工作区上下文切换。

### 5.4 关闭 tab

关闭 tab 时当前逻辑会同步处理：

- 从 `browserTabs` 中移除
- 如果关的是 active tab，则选择 fallback tab
- 更新 `activeBrowserTabId`
- 更新 `browserInput`
- 更新 `browserModeOpen`
- 更新 `bookmarkBarVisible`
- 清理 `pendingBrowserFileOpenByTabId`
- 调 main 关闭真实 tab

规则：

- 不能只删数组项。
- 关闭行为必须同时处理 renderer 投影和 main 真实资源。

### 5.5 书签栏菜单与图标

书签栏文件夹和“更多书签”使用通用 `ContextMenu`，但会额外挂 `bookmark-folder-context-menu` class。
这类菜单的宽度应保持为受控展开：比基础菜单略宽，长标题用省略号截断；二级目录继承同一限制，避免 hover 后被长书签完整撑开。

浏览器 tab 和书签栏 favicon 在 renderer 里只直接渲染当前 CSP 允许的地址，例如 `data:`、`blob:`、同源或本地地址。
远程 favicon 需要先通过 embedded browser 主进程解析成 `data:image/...` 后再显示；解析完成前使用 fallback 图标，避免 renderer 直接触发 `img-src` CSP 拒绝。

## 6. 搜索与浏览器的关系

### 6.1 `searchMode`

当前搜索模式至少有：

- `files`
- `web`

它决定搜索框提交后，结果是进入文件搜索还是进入浏览器导航。

### 6.2 web 搜索提交

当 `searchMode = web` 时，搜索提交会：

- 确保存在一个 browser tab
- 打开浏览器模式
- 把工作区切到 `browser`
- 把输入内容交给浏览器地址栏处理

也就是说，`searchMode = web` 不是单纯的 UI 筛选项，它会改变整个工作区行为。

### 6.3 文件工作区返回

`openFileWorkspace()` 的行为是：

- `setBrowserModeOpen(false)`
- `deactivate()` 原生浏览器 view
- 若当前有 active file，则切到 `file-viewer`
- 否则回 `search-home(files)`

这说明“回到文件区”本质上是工作区级切换，而不是只把浏览器组件隐藏掉。

## 7. 持久化与恢复

### 7.1 页面工作区缓存

当前工作区状态按资源库维度缓存：

- cache key: `library:${libraryId}`

行为规则：

- 进入页面时读取缓存，作为初始状态
- 关键状态变化后持续写回缓存
- 页面卸载时再次保存最新状态

被缓存的字段是：

- `activeBrowserTabId`
- `browserInput`
- `browserModeOpen`
- `browserTabs`
- `searchDraft`
- `searchMode`
- `workspaceDisplayMode`

### 7.2 非工作区字段的本地持久化

另有一些 UI 偏好单独存在 `localStorage`：

- 左侧栏宽度（默认 / 最小宽度 360px；折叠按钮常驻红绿灯右侧标题栏区域，当前显示宽度动画到 0 后，主内容头部按钮向左合流；合流动画由同一个 CSS 位移变量驱动，第一行碰到折叠按钮后停住，URL 行和书签栏继续同速收拢；嵌入式浏览器原生 view 在同一动画窗口内逐帧同步 bounds，避免网页层抢跑；折叠不覆盖已保存的展开宽度）
- 浏览器资源面板宽度

这些状态不是工作区业务事实，更接近用户布局偏好，因此与 `workspace-state.ts` 分开是合理的。

## 8. 和浏览器资源面板的关系

浏览器资源面板当前是“浏览器工作区的附属面板”，但它自己的显示宽度和展开状态是页面层管理的。

当前规则：

- 资源面板只在浏览器工作区中有意义
- 面板的显示宽度按 library 维度持久化
- 面板进入浏览器工作区时默认折叠，是否展开只保留当前页面运行时状态

这说明它属于“页面布局状态”，不是 `embedded-browser` feature 自己的全局状态。

## 9. 高风险改动点

后续改动以下地方时，必须额外小心：

1. `workspaceDisplayMode` 和 `browserModeOpen` 的关系
原因：这两个字段相关但不等价，最容易改出互相打架。

2. `browserTabs / activeBrowserTabId / browserInput` 的组合更新
原因：这三者在 tab 创建、激活、关闭时必须同步，不适合拆成分散副作用。

3. 缓存恢复逻辑
原因：一旦恢复逻辑和运行时规则不一致，很容易出现“页面一进来状态就飘”。

4. `pendingBrowserFileOpenByTabId`
原因：这是页面层和浏览器打开文件流程的衔接状态，清理不完整会把旧请求带到新 tab。

5. 资源面板布局状态
原因：这是工作区布局偏好，不要混进业务状态 owner。

## 10. 维护规则

出现以下变化时，必须回写本文：

- 新增或删除工作区显示模式
- `searchMode` 语义变化
- 浏览器 tab 创建/激活/关闭规则变化
- 工作区缓存字段变化
- 浏览器资源面板归属变化
- `library detail` 被进一步拆分出新的页面级状态 owner
- `MediaRegistry` 注册者变化（新增 viewer 类型、变更 entry 标识或行为语义）

## 11. MediaRegistry 状态 owner

媒体控制中心使用一个独立的 renderer-only 注册表 `MediaRegistry`：

- Provider：`src/contexts/MediaRegistryContext.tsx`，挂在 `FileViewerProvider` 内层，作用域与一次 library detail 进入对齐。
- Context value 与类型：`src/contexts/media-registry.context.ts`。
- 消费 hook：`src/hooks/useMediaRegistry.ts` 暴露 `useMediaRegistry()`、`useMediaEntries()`、`useRegisterMediaEntry()`。
- 当前注册者：
  - `audio-viewer`（`kind: 'audio'`，仅在 owns globalAudioPlayer 且 `hasStarted` 时注册）
  - `asmr-viewer`（`kind: 'audio'`，同上但 ownerType 为 `'asmr'`）
  - `audio-archive-viewer`（`kind: 'audio'`，归档页底部播放器 owns globalAudioPlayer 且 `hasStarted` 时注册，entry 绑定当前归档 tab）
  - `video-viewer`（`kind: 'video'`，本 tab `<video>` 至少播放过一次后注册）
- entry 关键字段：`entryId`（`<kind>:<tabId>` 格式）、`tabId`（用于跳转）、`title`、`isPlaying`、`currentTime`、`duration`。
- 注册表还保存每个 entry 的 `play` / `pause` / `seek(time)` / `dismiss()` 回调；这些控制回调只存在于 registry 内部，不进入可订阅快照。
- `useRegisterMediaEntry` 会把 `currentTime` / `duration` 归一到整秒再更新注册表，避免 audio/video 高频 `timeupdate` 造成页面级广播抖动。
- 注册表只持有索引和回调，不持有 `<audio>` / `<video>` 元素本身。
- 每个 viewer 必须在挂载且"曾播放"后才注册，关闭 viewer / unmount / 用户点击媒体行 `x` 时清理。
- 浏览器内嵌页面（main 进程的 `WebContentsView`）的媒体不在本 registry 范围内。

`globalAudioPlayer` 同时接入浏览器 `navigator.mediaSession`：

- 作用范围只覆盖 audio / asmr 这条全局音频播放器，不覆盖多实例 video，也不覆盖 embedded browser 内网页媒体。
- 系统媒体信息里的标题来自 `globalAudioPlayer.trackName`，普通音频由文件名推导，ASMR 由当前播放节点显示名推导。
- 系统媒体键 / macOS Now Playing 支持 play、pause、seekforward、seekbackward、seekto；进度通过 `setPositionState` 按秒同步。
- `globalAudioPlayer.clear()` 会清空 MediaSession metadata 和 playbackState，避免系统媒体控制器保留过期条目。

后续如果继续治理这页，优先方向应该是：

- 固定“哪些状态是页面 owner，哪些只是子组件消费”
- 把浏览器、文件预览、搜索主页之间的切换规则继续显式化
- 避免把页面级复合动作拆成多个互相不知道对方的局部 `setState`
