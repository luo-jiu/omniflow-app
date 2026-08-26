# Embedded Browser 架构说明

更新时间：2026-08-23

适用范围：`omniflow-app` 内置浏览器的 renderer UI、preload bridge、Electron main controller、资源捕捉、下载导入与缓存捕捉工具链。

## 1. 概述

OmniFlow 的 embedded browser 不是单纯的 React 组件，而是“renderer 控制台 + main process 原生浏览器视图”的组合体。

当前架构的核心原则：

- 浏览器 tab、工具栏、资源面板和交互反馈在 renderer。
- 真正的页面承载体是 Electron main 中的 `WebContentsView`。
- renderer 只能通过 preload 暴露的桥接能力驱动浏览器，不直接依赖 main 内部结构。
- 资源捕捉分为网络捕捉和深度捕捉两条链路，最终都汇总回 renderer 里的资源面板。
- 资源面板负责“发现和发起”，长时间下载、合并、转格式等重处理优先下沉到工具区。

## 2. 模块地图

当前关键模块：

- Renderer 页面编排
  - `src/views/library/detail/index.tsx`
- Renderer 浏览器载体
  - `src/features/embedded-browser/components/EmbeddedBrowserPanel.tsx`
- Renderer 资源捕捉 hook / service
  - `src/features/embedded-browser/resources/hooks/useEmbeddedBrowserResources.ts`
  - `src/features/embedded-browser/resources/hooks/useEmbeddedBrowserCatchToolkit.ts`
  - `src/features/embedded-browser/resources/services/embedded-browser-resource.api.ts`
  - `src/features/embedded-browser/resources/services/embedded-browser-capture-rule.api.ts`
  - `src/features/embedded-browser/resources/components/EmbeddedBrowserCaptureRuleSettings.tsx`
- Renderer 下载导入 hook
  - `src/features/embedded-browser/downloads/hooks/useEmbeddedBrowserDownloadImport.ts`
- Renderer Cookie 管理
  - `src/features/embedded-browser/cookies/services/embedded-browser-cookie.api.ts`
  - `src/features/embedded-browser/cookies/components/EmbeddedBrowserCookieSettings.tsx`
- Renderer 外部工具设置
  - `src/features/embedded-browser/external-tools/services/embedded-browser-external-tool.api.ts`
  - `src/features/embedded-browser/external-tools/components/EmbeddedBrowserExternalToolSettings.tsx`
- Renderer 密码管理
  - `src/features/embedded-browser/passwords/services/embedded-browser-password.api.ts`
  - `src/features/embedded-browser/passwords/components/EmbeddedBrowserPasswordSaveBar.tsx`
  - `src/features/embedded-browser/passwords/components/EmbeddedBrowserPasswordSettings.tsx`
- Main Cookie 服务
  - `electron/service/embeddedBrowserCookieService.ts`
- Main 外部工具执行器
  - `electron/service/embeddedBrowserExternalTools.ts`
- Main 密码服务
  - `electron/service/embeddedBrowserPasswordTypes.ts`
  - `electron/service/embeddedBrowserPasswordService.ts`
  - `electron/service/embeddedBrowserCredentialDetectionScript.ts`
- Preload bridge
  - `electron/preload.ts`
- IPC 注册
  - `electron/service/embeddedBrowserMainIpc.ts`
- Main controller
  - `electron/service/embeddedBrowserMainController.ts`
- Main 规则过滤
  - `electron/service/embeddedBrowserResourceCaptureRules.ts`
- View 生命周期
  - `electron/service/embeddedBrowserViewLifecycle.ts`

建议按下面的方向理解：

```text
library detail page
  -> EmbeddedBrowserPanel / resources / downloads hooks
    -> preload: window.electronEmbeddedBrowser
      -> ipcMain handlers
        -> embeddedBrowserMainController
          -> WebContentsView / capture / download / ffmpeg / file system
```

## 3. 分层职责

### 3.1 Renderer 页面层

`src/views/library/detail/index.tsx` 是浏览器工作区的页面 owner，负责：

- 浏览器 tab 列表和激活 tab id
- 浏览器模式开关与工作区显示模式
- 地址栏输入草稿
- 书签栏和资源面板是否显示
- 浏览器设置入口和内部 settings tab
- 下载导入 modal 的展示与目标目录选择

它可以编排浏览器行为，但不应该直接理解 main 里的 view 生命周期细节。

### 3.2 Renderer 浏览器载体

`EmbeddedBrowserPanel.tsx` 的职责很专一：

- 提供一个 DOM host 作为原生 view 的 bounds 参考。
- 根据 `activeTabId/currentUrl/pendingFileOpen/suspendNativeView` 决定当前面板处于：
  - `idle`
  - `blank`
  - `attached`
- 监听 `embedded-browser:state`，把导航状态、错误、标题、URL 变化回传给页面。
- 通过 `ResizeObserver + requestAnimationFrame` 持续同步 host 区域给 main 的 `setBounds`。
- 在空白、停用或卸载时调用 `deactivate()`，确保原生 view 从窗口中移除。

它不负责维护 tab 列表，也不负责资源列表。

### 3.3 Renderer 业务域

资源和下载各自有独立 hook：

- `useEmbeddedBrowserResources`
  - 订阅资源事件
  - 按 `tabId` 维护资源快照
  - 启动 / 停止 / 清空 / 深度捕捉
- `useEmbeddedBrowserCatchToolkit`
  - 管理当前页缓存捕捉状态
  - 拉取捕捉诊断信息
  - 执行清缓存、重捕、保存、合并、自动导出
- `useEmbeddedBrowserDownloadImport`
  - 订阅下载完成事件
  - 维护导入队列
  - 把下载结果导入资源库，或保存到桌面

当前资源面板与工具区的协作补充：

- 资源面板可以把“已选资源”送到工具区的资源捕获处理模式；内部资源库文件处理走单独的“媒体文件处理”工具，不复用 embedded browser 资源快照。
- 浏览器设置页里的“捕获规则”也归资源域负责；renderer 只管理规则草稿和保存动作，真正的过滤判定仍在 main。
- 浏览器设置页里的“外部工具”也归资源域负责；renderer 只管理 aria2 / 命令模板 / URL 协议的配置草稿，真正的执行仍在 main。
- 外部工具当前有两处入口：资源卡可直接转发原始资源；工具区执行面板也可把当前 HLS / MPD / 直接资源上下文发送给已启用工具，但暂不扩展成新的“结果出口”模式。
- HLS manifest 解析后，可以把“下载计划”送到工具区。
- MPD manifest 解析后，也可以把“下载计划”送到工具区；工具区当前提供第一版 representation 选择，并在 main 侧执行 `init segment + media segments` 本地下载，再交给 `ffmpeg` 合并。
- 工具区当前承接两条 HLS 主线：
  - 网络 manifest：继续走 `ffmpeg` 直拉。
  - blob / 页内内存 manifest：走 Electron main 本地 downloader，先生成 local workdir 和 rewritten local playlist，再交给 `ffmpeg`。
- 网络 master playlist 已补第一版 variant 选择；默认保持“自动”，也可锁到具体 variant URL 后再走 `ffmpeg`。
- 如果用户在工具区填写了手动 AES-128 key，也会切到本地 downloader 主链，由 Electron main 写本地 key 文件后重写 playlist。
- live HLS 第一版走显式“开始录制 / 停止录制”主线；停止后才交给 `ffmpeg` 导出。切换到别的 HLS 请求或离开工具区时，会把未导出的 live session 当作放弃处理，不做隐式自动导出。
- 工具区也可直接发起 HLS key 验证；候选会合并 manifest key URL、当前 tab 已捕获 key 资源和工具区手动输入 key。
- 当前 `master playlist + 手动 key` 已要求先明确选择具体 variant，再回到现有本地主链。
- main 侧会把 HLS 执行阶段事件回推给 renderer；工具区据此展示当前阶段、最近日志、分片完成数和错误状态。
- MSE 深度捕捉当前已补第一版增量写盘：page runtime 在 `appendBuffer` 累积超过阈值后，会通过 probe console payload 把 chunk flush 给 main，main 落到 temp spool file；后续 `save / merge / transcode` 优先读取 file-backed 资源，而不是再次整段 base64 提取。

这些 hook 应继续通过 `services/*.api.ts` 调 preload bridge，不要直接在 hook 或组件里散落原始 bridge 调用。

### 3.4 Preload / IPC / Main

`electron/preload.ts` 当前提供五类嵌入浏览器相关桥接：

- 页面和 tab 控制
- 下载事件和资源事件订阅
- 资源捕捉、缓存捕捉、预览、导出、合并、manifest 下载
- 资源捕捉规则管理（读取、更新、恢复默认）
- 外部工具管理（读取设置、更新设置、恢复默认、列出已启用工具、执行分发）
- Cookie 管理（查询、删除单条、按域名删除、全部清除）
- 密码管理（列表、解密查看、保存凭据、删除、黑名��、凭据捕获事件）

`embeddedBrowserMainIpc.ts` 只负责 channel 到 handler 的转发，不承担业务规则。

`embeddedBrowserMainController.ts` 负责：

- `tabId -> WebContentsView` 的真实映射
- 当前激活 view 的 attach / detach
- state / download / resource 事件向 renderer 投影
- 资源捕捉规则的持久化读取，以及网络捕捉 / probe 捕捉前的过滤判定
- 深度捕捉启动、probe 安装和 reload
- MSE 读取、导出、保存、合并、manifest 下载
- HLS 本地计划下载：`plan -> local workdir -> local playlist -> ffmpeg`
- HLS live 录制：`轮询 media playlist -> 增量补分片 -> 手动停止 -> ffmpeg 导出`

## 4. 核心概念

### 4.1 Tab 与 View

这里有两层状态：

- renderer tab
  - 页面里维护的 tab 元数据：`id/title/url/canGoBack/canGoForward/...`
- main view
  - `tabId` 对应的 `WebContentsView`

它们不是同一层对象。renderer 只能维护“投影”，真正的页面内容、session 和浏览器生命周期在 main。

### 4.2 激活中的 view

当前窗口同一时间只有一个 active embedded browser view 会被挂进窗口内容树。  
切换 tab 时，main 会先 detach 旧 view，再 attach 新 view。

这意味着：

- renderer 的 tab 列表可以有多个
- 但窗口里同一时刻只显示一个原生页面

### 4.3 资源捕捉快照

资源面板的数据也有分层：

- 网络和 probe 捕捉事件由 main 发回 renderer
- 在发回 renderer 前，main 会先经过统一的规则过滤：域名黑白名单、regex 规则、扩展名与 MIME 白名单
- 默认捕捉规则会识别常见媒体、manifest、key、图片和字幕 / 歌词资源；字幕 / 歌词包含 `vtt/srt/ass/ssa/ttml/lrc/qrc/krc/yrc/trc/ksc/sbv/dfxp/smi/sami/scc/stl/sub/idx/sup/lyric/lyrics/webvtt` 等扩展名，并覆盖常见 VTT、SRT、ASS、SSA、SubRip、TTML MIME
- renderer 里的 `useEmbeddedBrowserResources` 再按 `tabId` 聚合成 snapshot
- 当前页面资源面板只读“活动 tab 的快照”
- 资源面板有“全部 / 筛选”两个显示模式：“全部”直接显示活动 tab 快照里的全部资源；“筛选”才应用 renderer 本地正则、同名同大小去重和扩展名 chip
- 资源面板的筛选正则和“筛除同名同大小”开关是 renderer 本地偏好，分别持久化在 `embedded-browser:resource-filter-regex` 和 `embedded-browser:resource-dedupe-same-name`，不改变 main 侧捕捉快照

#### 页面运行时歌词提取经验

`.qrc/.lrc` 捕获只覆盖真实网络资源或脚本 URL。QQ 音乐这类页面有时不会暴露独立歌词文件，而是把歌词渲染到 DOM：`#qrc_ctn p` 只包含显示文本和当前行 `class`，时间轴不在 DOM 属性里。

已验证的 QQ 音乐播放器结构：

- 从 `#qrc_ctn` 反查 React 父组件，可拿到运行时组件实例。
- `comp.lyricData.lyricList` 是原歌词，`comp.lyricData.transList` 是翻译 / 音译歌词。
- 单行结构为 `{ interval, context }`，`interval` 是秒，`context` 可能是 React element。

调试时可在页面 Console 执行：

```js
function findReactComponentFromDom(dom, predicate) {
  const key = Object.keys(dom).find((value) => (
    value.startsWith('__reactFiber$')
    || value.startsWith('__reactInternalInstance$')
  ))
  let fiber = key ? dom[key] : null
  for (let index = 0; fiber && index < 100; index += 1) {
    const node = fiber.stateNode
    if (node && typeof node === 'object' && predicate(node)) {
      return node
    }
    fiber = fiber.return
  }
  return null
}

function lyricText(context) {
  if (typeof context === 'string') return context
  const html = context?.props?.dangerouslySetInnerHTML?.__html
  if (typeof html === 'string') {
    const div = document.createElement('div')
    div.innerHTML = html
    return div.innerText
  }
  const children = context?.props?.children
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.join('')
  return ''
}

function toLrc(rows = []) {
  const pad = (value, width = 2) => String(Math.floor(value)).padStart(width, '0')
  return rows.map((row) => {
    const time = Number(row.interval || 0)
    const min = Math.floor(time / 60)
    const sec = Math.floor(time % 60)
    const cs = Math.floor((time - Math.floor(time)) * 100)
    return `[${pad(min)}:${pad(sec)}.${pad(cs)}]${lyricText(row.context)}`
  }).join('\n')
}

const comp = findReactComponentFromDom(
  document.querySelector('#qrc_ctn'),
  (node) => node.lyricData || node.state?.lyric,
)

copy(toLrc(comp?.lyricData?.lyricList || comp?.state?.lyric || []))
```

这属于页面运行时提取经验，不是全站通用规则；后续如果产品化，应作为“提取页面歌词 / 字幕”能力处理，不混入网络资源捕获规则。

### 4.4 缓存捕捉工具态

缓存捕捉工具态不是 React 本地拼出来的，它来自页面中注入的 probe runtime。  
renderer 只是拉取和更新这份 page-side 状态，包括：

- `autoSeekToBufferedEnd`
- `autoDownloadOnComplete`
- `clearCacheOnComplete`
- `restartAlwaysFromBeginning`
- `trimExtraMediaHeaders`
- 文件名规则与诊断信息

## 5. 关键链路

### 5.1 导航链路

链路如下：

```text
library detail submit / click
  -> EmbeddedBrowserPanel.navigate()
    -> preload navigate(tabId, url)
      -> main controller loadURL()
        -> WebContentsView lifecycle events
          -> embedded-browser:state
            -> renderer 更新 tab 投影和地址栏
```

关键点：

- 地址栏和 tab URL 的 source of truth 在页面层，不在 `EmbeddedBrowserPanel`。
- `EmbeddedBrowserPanel` 只负责把“当前应该显示哪个 tab、应该打开什么 URL”转给 main。
- 真正导航结果以后续 `state` 事件为准。
- 页面触发 `window.open` / `_blank` 时，main 侧会把普通目标 URL 收敛到当前 tab；如果新窗口先是 `about:blank` 占位窗口，会短暂创建隐藏窗口承接后续脚本导航，拿到真实 URL 后再回灌当前 tab 并关闭隐藏窗口，避免地址栏停在 `about:blank`。

### 5.2 Bounds 同步链路

原生 view 不在 React 树里，所以 bounds 必须单独同步：

```text
EmbeddedBrowserPanel host DOM
  -> ResizeObserver / window resize
    -> preload setBounds(bounds)
      -> main controller set active view bounds
```

规则：

- 所有宿主尺寸同步都应通过 host rect 推导。
- 不要在页面层硬编码原生 view 的像素位置。

### 5.3 下载导入链路

下载链路的关键事实：

- download 事件由 main 发给 renderer。
- `useEmbeddedBrowserDownloadImport` 只把 `completed` 事件放进队列。
- 失败、取消会优先清理临时文件。
- 成功后有两条出口：
  - 导入资源库
  - 保存到本地桌面

当前导入链路并不是浏览器自己写库，而是：

```text
tempPath
  -> uploadManager.createBatch(...)
    -> 走现有上传体系进入资源库
```

这意味着 embedded browser download import 依赖当前上传中心，不应单独造第二套导入状态机。

### 5.4 资源捕捉链路

资源捕捉分两类：

#### 网络捕捉

- 由 main 侧的浏览器网络能力记录
- 以 `embedded-browser:resource` 事件推回 renderer

全面迁移中的目标 network chain 已在未注册路径组合 `ElectronNetworkCaptureAdapter`、`PageProbeCaptureAdapter`、Cat Catch/OmniFlow 分层 policy、main-only context vault、revisioned `ResourceStateStore`、安全跨进程合同、`EmbeddedBrowserLifecycle` 和 main-only resource access consumer。probe adapter 固定到安装它的 document binding，只在 deep mode 通过 stable resource key 写 Store；产品 policy 显式补充 image/key/document/expanded-subtitle，不能覆盖 Cat Catch regex blacklist。access consumer 的 transport 必须由 production adapter 注入并绑定到捕捉 tab 的 Electron session，不能回退到主进程全局 `fetch`。该链尚未接 production probe console listener、四类旧 consumer、IPC/preload/renderer；当前旧 bridge 仍是唯一生产 owner，同一种 `webRequest` event 不得同时注册新旧 listener。逐项状态以 Cat Catch capability map 为准。

#### 深度捕捉

- 页面开启 deep capture
- main 安装 probe 并在需要时 reload
- probe 通过 console payload / page action 输出资源和缓存工具状态
- main 解析并汇总回 renderer

当前事实：上述生命周期入口存在，但 `embeddedBrowserResourceProbeRuntimeHooks.ts` 把 `enableDeepRuntimeHooks` 写死为 `false`，Worker、fetch、XHR、JSON、key 等 hooks 没有实际启用，只有外围 MSE hooks 仍运行。因此本节只描述当前理论链路，不代表深度捕捉行为已经完成；重构状态和验收以 `docs/cat-catch-full-migration-execution-plan.md` 为准。

renderer 的资源列表不应该关心“这个资源是来自网络还是来自 probe 的哪一种 hook”，只关心统一的捕捉模型。

### 5.5 页面资源拖入目录树

内置浏览器页面资源拖到目录树不依赖落点 renderer 单独猜测 URL，而是使用两路信息合并：

```text
页面 dragstart capture
  -> page drag source script 记录 tab / page / element / URL
    -> console payload 写入 main 的 30 秒来源会话
    -> DataTransfer 同时携带 session id 作为精确关联

目录树 drop
  -> renderer 解析 session id 与标准 DataTransfer 兜底
    -> preload page-drag:stage
      -> main 兑现来源会话
        -> embedded browser session.fetch / 页内 blob 读取 / data 解码
          -> 受控临时目录
            -> 现有上传确认与 UploadManager
```

边界规则：

- 页面脚本只记录当前被拖元素的资源元数据，不记录输入内容或大块 HTML。
- 普通链接只有声明 `download` 或 URL 具有已知文件后缀时才进入文件语义。
- HTTP(S) 暂存继承 embedded browser partition Cookie；`blob:` 必须回到原 tab frame，页面关闭或资源失效时明确失败。
- main 拥有来源会话、下载、限额和陈旧临时目录清理；目录树不直接下载资源，也不新增上传状态机。
- 关闭 tab 和 `closeAll()` 会清理对应来源会话，防止旧 tab 的拖拽来源被下一次操作复用。
- 当前代码已接入；macOS 已使用非第一个资料库验证真实图片可从内置浏览器拖入目录树，且上传后的文件内容完整。普通网页或搜索结果拖出 `text/html` 时会按非文件内容拒绝；Windows 与其他边界场景仍待验证。

### 5.6 目录树文件拖入网页

目录树单个普通文件可以在原有 Semi Tree 拖拽手势中交给已打开的网页：

```text
目录树 dragstart
  -> 保留 DownloadURL，继续支持树内移动与 Finder / Explorer 导出
  -> 附加一次性 claim id、文件名和 MIME
    -> 网页 drop capture 记录真实落点
      -> main 等待 renderer 解析资料库签名链接
        -> 受控临时目录保留原始 basename
          -> CDP Input.dispatchDragEvent 交付真实 File
```

边界规则：

- 只为单选普通文件附加网页拖拽声明；文件夹、多选、归档目录和特殊节点不支持。
- renderer 与网页只接触一次性 claim 元数据，不接触签名 URL或本地临时路径。
- 目录树在 `dragstart` 同步向 main 注册 claim；网页投递只能消费一次已注册 claim，不接受随机 ID 或重放。
- 网页 drop 脚本运行在独立 isolated world，要求浏览器生成的可信事件和每个 view 独有的随机 nonce；第三方网页的普通脚本与 console 输出不能直接触发 main 暂存。
- 网页 drop 脚本只拦截 OmniFlow 自定义类型；CDP 重放的真实文件事件继续交给网页原有 drop handler。
- 合成 `dragOver` 后会读取页面是否按 Chromium 标准调用 `preventDefault()`；未接受时发送 `dragCancel` 并报告失败，不派发 `drop`。
- 只接受当前活动 tab 的请求；同一 tab 的新请求会取消上一个未完成请求。
- 拖拽单文件与当前进程已交付文件总量上限均为 1GB；该限制不改变原有“映射网站打开文件”链路。
- 已交付文件保留到该 tab 下次主文档导航、关闭或最长 30 分钟，避免网页异步读取 `File` 时路径过早失效。
- 正常退出同步清理当前进程暂存；崩溃残留由下次启动的 24 小时陈旧扫描回收。
- renderer 的成功提示只表示“已将文件交给网页”，不代表网页或远端服务已经上传成功。
- 已加载的 HTTP(S) 页面只承担网页上传语义；浏览器外壳、标签栏和空白主页不接收文件打开 drop，网页拒绝 drop 时也不自动降级成打开文件。
- 当前 iframe 上传区不支持，避免在无法建立隔离世界与可靠顶层坐标时猜测投递；CDP debugger 被 DevTools 占用时也无法保证投递。Windows 仍需实机验证。

### 5.7 缓存捕捉与合并链路

缓存捕捉工具链路：

```text
renderer catch toolkit action
  -> preload catch-toolkit api
    -> main controller 在 frame 中执行 page action script
      -> page-side probe runtime 处理 MSE / catch state
        -> 需要时 read/export/save/merge
```

主线能力：

- 清理当前页缓存
- 从头重捕
- 直接导出捕捉流
- 读取捕捉流内容
- 调 `ffmpeg` 合并音视频
- 合并 / 转格式支持 renderer 传 `useSystemSaveDialog=false` 与 `outputDirectoryPath`，由 main 直接生成输出路径（不弹系统保存框）
- 清理 embedded browser 会话缓存并 `reloadIgnoringCache`，用于排查页面从 HTTP cache / Cache Storage / Service Worker 复用旧媒体导致网络层不再触发的问题
- 重置当前网页：清理 Cache Storage / Service Worker / IndexedDB 等站点缓存，销毁并重建当前 tab 的 `WebContentsView`，再加载同一个 URL；该操作保留 cookie，但可能清掉站点播放器内部缓存状态

规则：

- renderer 不直接假设页面里只有一个 frame。
- main controller 会优先在 frame 列表里执行 page action，再汇总结果。

### 5.8 密码管理链路

密码管理分为凭据检测和密码存储两部分：

#### 凭据检测

- `dom-ready` 时注入轻量检测脚本（`embeddedBrowserCredentialDetectionScript.ts`）
- 脚本在 capture 阶段监听 `submit` 和 submit 按钮 `click`
- 通过 `console.info(__OMNIFLOW_CREDENTIAL__:JSON)` 发送凭据到 main
- main 校验后缓存凭据（60 秒 TTL），只发 `credentialRequestId` 给 renderer
- renderer 显示保存通知条

#### 密码存储

- renderer 用 `credentialRequestId` 请求保存
- main 从缓存取出明文 → `safeStorage.encryptString()` → 写入 `embedded-browser-passwords.json`
- 查看密码需 `systemPreferences.promptTouchID()` 后 `safeStorage.decryptString()`

密码明文不会到达 renderer 进程。

#### 自动填充

- 检测脚本发现密码输入框后通过 `console.info(__OMNIFLOW_AUTOFILL_READY__:JSON)` 通知 main
- main 按域名查找已保存凭据，`decryptEmbeddedBrowserPasswordForAutoFill()` 解密（不触发 Touch ID）
- 通过 `executeJavaScript` 直接在 WebContentsView 页面调用 `window.__OMNIFLOW_FILL_CREDENTIAL__()` 填充表单
- 使用 `nativeSetter`（HTMLInputElement.prototype.value 的原始 setter）兼容 React 等框架
- 多账号时通知 renderer 显示切换通知条；renderer 可通过 `autoFillPassword` IPC 切换
- 已保存的 domain+username 提交时不再弹出保存提示（`hasEmbeddedBrowserMatchingPassword` 检查）
- MutationObserver 确保 SPA 动态渲染的登录表单也能触发自动填充

### 5.9 DevTools 与网页缩放

embedded browser 的 DevTools 和页面缩放由真实 `WebContentsView.webContents` 执行，不缩放 OmniFlow renderer 外壳。

快捷键规则：

- macOS：`Cmd+Option+I` 打开 / 关闭活动网页 DevTools，`Cmd++/-/0` 缩放 / 重置网页。
- Windows / Linux：`F12` 或 `Ctrl+Shift+I` 打开 / 关闭 DevTools，`Ctrl++/-/0` 缩放 / 重置网页。
- 网页获得焦点时，快捷键由该 view 直接处理；地址栏或工具栏获得焦点且活动 view 仍挂载时，主窗口把同一指令转发给活动 view。
- 右键菜单保留剪切 / 复制 / 粘贴等可用编辑动作，并提供稳定的“检查”元素入口。

DevTools 使用 Electron 内置 Chromium DevTools frontend，默认停靠在当前网页右侧；用户可继续通过 DevTools 的停靠菜单切换到左侧、底部或独立窗口。焦点位于 DevTools 内时，同一组 DevTools 快捷键仍可关闭面板。受 Electron 的 inspected page 与 DevTools frontend 分属不同 `WebContents` 影响，DevTools 左上角原生元素选择器在当前 docked `WebContentsView` 组合中不能作为可靠能力保证；需要定位页面元素时，以网页右键“检查”为当前受支持入口。若后续需要稳定的跨 view 点选流程，应单独实现 OmniFlow 元素选择器，不向 Chromium DevTools 私有 DOM 注入补丁。

DevTools 会替换 `webContents.debugger` 当前的 CDP 连接；因此 DevTools 打开期间，deep capture 的 document-start probe 和依赖 CDP 的文件输入设置可能暂时不可用。DevTools 关闭后，view lifecycle 会自动恢复已开启的 deep-capture probe；调试期间需要完整 document-start 捕捉时，应先关闭 DevTools 再刷新页面。

## 6. 生命周期规则

### 6.1 面板停用规则

以下情况必须 `deactivate()`：

- `suspendNativeView = true`
- `panelMode = idle`
- `panelMode = blank`
- 组件卸载

这条规则非常重要，因为它保证：

- 原生 view 不会在看不见时继续挂在窗口里
- 文件模式和搜索模式不会被浏览器 view 覆盖

### 6.2 深度捕捉启动规则

当前 deep capture 的行为是：

1. main 先把 tab 的 deep capture 标记打开
2. 对已存在 view 安装 probe
3. 如果页面已加载 URL，则 `reloadIgnoringCache()`

因此“深度捕捉”不是纯前端状态切换，而是会影响页面生命周期。  
未来改这个交互时，必须写清楚是否仍然要求刷新。

### 6.3 关闭 tab 规则

页面关闭 tab 时，需要同步处理：

- renderer tab 列表移除
- 当前激活 tab fallback
- 地址栏内容 fallback
- pending file open 清理
- main 中真实 view 关闭

不要只删 renderer tab，而忘了 main 的 view。

右键释放仓库工作区时，renderer 通过 `workspace-resource-release` 读取目标资料库的 workspace state，并逐个调用 `window.electronEmbeddedBrowser.closeTab(tabId)` 关闭该资料库登记过的真实 view。session release / 后续退出登录路径使用 `window.electronEmbeddedBrowser.closeAll()` 兜底关闭所有 embedded browser view。

### 6.4 工作区释放规则

embedded browser 的真实资源在 Electron main，不能依赖 React 组件卸载自然消失。

当前释放约定：

- 普通切离资料库详情页时，renderer workspace state 继续保存 browser tab 投影，回到资料库后可以恢复现场。
- 单库释放时，`workspace-resource-release` 从目标资料库的 workspace state 读取 browser tab id，逐个关闭对应 `WebContentsView`，随后清掉该资料库的 workspace state。
- session 释放时，`workspace-resource-release` 调用 `closeAll()` 全量关闭所有 `WebContentsView`，用于主动退出登录和 401 登录失效。
- 释放过程中如果关闭某个 view 失败，前端 cache 仍应继续清理，并用 warning 记录未确认关闭的 view；登录或仓库释放流程不能因为单个 view close 失败而卡住。

后续如果出现 browser tab 不在 `library detail` workspace state 中登记的场景，应补一个 renderer 侧 tab ownership registry，而不是让页面、hook 和 release service 各自猜归属。

## 7. 高风险变更点

后续改动以下地方时，必须额外小心：

1. `EmbeddedBrowserPanel.tsx`
原因：这里同时管理 bounds、attach/deactivate、状态订阅和空白页行为。

2. `embeddedBrowserMainController.ts`
原因：这里是浏览器真实 owner，tab/view/capture/download 生命周期都在这里收口。

3. `electron/preload.ts`
原因：bridge 一旦发散，renderer 很快会绕过 service 层直接依赖原始 API。

4. `useEmbeddedBrowserResources` / `useEmbeddedBrowserCatchToolkit`
原因：这两层如果重复缓存或重建 source of truth，会把资源列表和页面真实状态搞成双源。

5. 下载导入与上传中心的衔接
原因：当前下载导入是复用上传体系，如果擅自拆开，很容易产生重复状态机和清理遗漏。

## 8. 维护规则

出现以下变化时，必须回写本文：

- tab / view attach 规则变化
- preload 暴露面变化
- resource / download / state 事件 payload 变化
- deep capture 是否仍需要刷新页面的语义变化
- MSE 合并、manifest 下载、下载导入链路变化
- 页面拖拽来源会话、资源暂存与目录树导入链路变化
- 目录树文件到网页的 claim、暂存、CDP 交付与清理规则变化

如果未来 embedded browser 继续扩展，优先方向应该是：

- 把 renderer 侧桥接调用继续收敛到 service
- 把复杂能力文档化，而不是让页面组件直接知道更多 main 细节
- 把 tab 生命周期、资源捕捉和下载导入继续保持为 3 条边界清晰的链路
