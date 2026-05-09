# Video Viewer

更新时间：2026-05-09
适用范围：`src/features/file-viewer/components/video-viewer/` 下的普通视频播放页、右侧工具台、宽屏模式、桌面小窗和字幕覆盖层。

## 1. 概述

`VideoViewer` 是普通视频文件的独立 viewer。

它和 `video_archive` 的关系是：

- `video_archive`
  - 负责视频归档墙和卡片入口
- `video`
  - 负责单个视频的实际播放

从视频归档页点开卡片后，真正进入的仍然是普通 `video` viewer。

它当前会保存普通视频的观看进度，并让正在播放的视频跨路由级页面继续存活：

- 切换 tab、切换工作区页面或卸载 viewer 前，会先把当前播放时间写入本地 snapshot。
- 有 `nodeId` 的视频会把进度写回节点 `viewMeta`，下次重新打开同一视频时从上次观看位置继续。
- 接近片尾或已经播完的视频不会恢复到最后几秒，而是按普通新打开处理。
- 视频 DOM 元素不再完全绑定 `VideoViewer` 组件生命周期，而是由 `src/features/file-viewer/services/global-video-elements.ts` 按 tab id 管理。进入设置、传输中心、回收站等页面导致 viewer 卸载时，元素会移动到隐藏 parking host 中继续播放；回到原 tab 后再挂回 `.video-element-host`。
- 用户点击底部小窗按钮时，`VideoViewer` 只调用 `floatingVideoService.requestSystemFloating()`；服务层优先打开 Document PiP 桌面小窗，不可用时降级应用内浮窗。视频区域本身显示海报占位 + “收回 inline”按钮。
- 在库详情工作区内关闭对应 tab 时，才释放该 tab 的 video 元素并停止播放，避免“页面导航”和“操作对应媒体”混在一起。

## 2. 当前结构

当前 `VideoViewer` 分成三块：

1. 主视频区域
   - `<video>` 元素
   - buffering 遮罩
   - 字幕覆盖层
2. 底部控制条
   - 播放 / 暂停
   - 快退 / 快进
   - 时间轴
   - 音量按钮与竖向音量面板
   - 倍速按钮与竖向倍率面板
   - 合集播放列表按钮与气泡列表
   - 工具台显隐
   - 桌面小窗 / 收回播放器
   - 宽屏模式
   - 全屏
3. 右侧工具台
   - 只在 `video` viewer 中存在
   - 通过底部控制条里的按钮打开 / 关闭
   - 关闭时完全收起成抽屉
   - 当前先放字幕和预留能力入口

## 3. 观看进度模型

视频进度由 `VideoViewer` 自己持有，不上提到页面层或 `FileViewerContext`。

当前使用两层恢复：

1. 本地 snapshot
   - key 优先使用 `node:${nodeId}`
   - 无 `nodeId` 时 fallback 到 `url:${url}`
   - 主要用于切 tab、切页面或同一运行会话内快速恢复
2. 远端 `viewMeta`
   - 只在有 `nodeId` 时启用
   - 写入 `__omniflowViewerStateV1.videoPlayer`
   - 保存 `currentTime`、`duration` 和 `updatedAt`
   - 用于重新打开同一个视频时恢复上次位置

为了避免把“已经看完”的视频恢复到片尾，当前恢复时会跳过：

- 小于 2 秒的进度
- 距离结尾小于 5 秒的进度
- 进度比例达到 98% 及以上的进度

远端同步是延迟写入模型：

- 播放过程中先更新本地 snapshot。
- 后台按间隔把最新进度写到 `viewMeta`。
- inactive、手动 seek、播放结束或 viewer 卸载时会尝试强制刷新一次。

## 4. 字幕模型

当前字幕不是依赖浏览器默认 `<track>` UI，而是前端自己解析并渲染覆盖层。

这样做的原因是：

- 更容易把字幕固定在主内容区域
- 后续更容易继续加双语、偏移、样式或片段标注
- 不会和浏览器原生字幕面板耦合

当前支持：

- 手动加载本地 `.srt` / `.vtt` / `.ass` / `.ssa` / `.lrc`
- 从视频归档页打开时接收库内字幕候选，并默认加载排序最靠前的字幕
- 从视频归档合集打开时接收 `videoPlaylist`，底部控制条可展开播放列表气泡切换同合集视频；切换到尚未加载字幕候选的合集视频时，会按播放列表项携带的字幕卡片节点按需读取
- 工具台中切换可用的库内字幕
- 按视频当前播放时间匹配字幕片段
- 把字幕固定显示在视频画面底部区域
- 调整字幕字号
- 调整字幕离底部的偏移
- 清除字幕文件

当前不支持：

- 自动发现同名字幕
- 双语字幕编排
- 字幕编辑与保存

## 5. 实现边界

### 5.1 状态 owner

字幕状态当前由 `VideoViewer` 自己持有，包括：

- 是否展开工具台
- 当前字幕文件名
- 当前库内字幕来源 id（如果字幕来自资料库节点）
- 字幕 cue 列表
- 字幕开关
- 字号
- 底部偏移

这些状态目前没有上提到全局工作区，也没有写入后端。

视频观看进度同样由 `VideoViewer` 自己持有：

- `FileViewerContext` 只负责 tab 和当前文件事实，不拥有视频播放时间。
- `FileViewerContext` 可以随 tab 携带 `videoSubtitleSources`，只表达“这个视频有哪些可用库内字幕候选”，不拥有字幕解析结果或当前播放 cue。
- 本地 snapshot 和远端 `viewMeta` 都只是恢复介质，不是页面层的新 source of truth。

库内字幕读取通过 `window.electronAPI.fetch` 走主进程 IPC HTTP 通道，不直接在 renderer 里 `fetch` 临时对象存储链接。视频元素播放可以直接使用临时链接，但字幕读取需要拿到文本内容，走 IPC 可以避开对象存储 CORS / 签名链接细节对 renderer fetch 的影响。

### 5.2 字幕解析

字幕 / 歌词这类按时间轴显示的文本解析逻辑收口在：

- `src/features/file-viewer/timed-text/subtitle.ts`
- `src/features/file-viewer/timed-text/useTimedText.ts`

它负责：

- 规范化换行和 BOM
- 解析 `SRT / VTT / ASS / SSA / LRC` 时间轴
- 提取 cue 文本
- 根据当前时间找到活跃 cue

`VideoViewer`、普通 `AudioViewer` 和 `AudioArchiveViewer` 都应复用这层 timed text 能力。后续字幕 / 歌词功能继续膨胀时，优先继续把时间轴解析、库内文本读取和当前 cue 匹配放在这里，而不是塞回各 viewer 的 `index.tsx`。

### 5.3 工具台与宽屏模式

右侧工具台是视频专属 UI，当前不要抽成通用 viewer 侧栏。

原因是：

- 只有视频明确提出了“工具台”需求
- 后续要放的多半也是视频语义能力
  - 字幕
  - 双语
  - 标注
  - 片段
  - AI 能力

如果未来别的 viewer 也出现非常类似的右侧面板，再评估是否抽公共壳。

宽屏模式由 `VideoViewer` 发起，但目录树折叠必须由 `library detail` 页面 owner 执行：

- `VideoViewer` 只持有本地 `isWideMode` 和右侧工具台显隐恢复状态。
- `src/views/library/detail/index.tsx` 通过 `LibraryWorkspaceControlsContext` 暴露 `setVideoWideMode`，只负责临时折叠 / 恢复目录树。
- 进入宽屏时会记录进入前的目录树状态；如果原本就是折叠，退出宽屏后仍保持折叠。
- 进入宽屏时右侧工具台临时折叠；退出宽屏、切走 active viewer 或卸载 viewer 时恢复进入前状态。
- 不允许 video viewer 直接修改目录树、工作区模式或页面宽度持久化值。

### 5.4 控制器交互

当前播放器底部控制条里有两类“点击展开”的轻量面板：

- 音量
  - 点击图标后弹出竖向音量面板
- 倍速
  - 点击当前倍率后弹出竖向倍率列表

这样做是为了避免底部控制器长期摊开太多表单控件，保持播放器更接近媒体播放器而不是设置页。

底部控制条中的“工具台”“桌面小窗”“宽屏”“全屏”必须使用图标按钮，并通过 `title` / `aria-label` 表达语义；不要回退成文字按钮挤占控制条空间。

### 5.5 桌面小窗与 inline 占位

普通视频的小窗能力分两层：

1. 主动小窗
   - 用户点击底部小窗按钮触发。
   - 优先使用 Chromium `documentPictureInPicture.requestWindow()` 打开桌面级 PiP 窗口。
   - Document PiP 不可用、被拒绝或失败时，自动降级到应用内浮窗。
2. 被动保活
   - 离开资料库等非用户手势场景仍走 `handoffToFloating()`。
   - 如果视频已经在 Document PiP 中，离开资料库时继续保持 PiP；如果还在 inline，则进入应用内浮窗。

不变量：

- `VideoViewer` 不直接创建或持有 PiP window，PiP / 应用内浮窗 / inline 的宿主切换由 `floatingVideoService` 统一管理。
- inline 视频区域在小窗状态下显示海报占位 + “收回 inline”按钮；占位不是第二个播放器。
- “收回 inline”路径通过 `mountGlobalVideoElement` 把同一个 `<video>` 元素挂回 `.video-element-host`，再调用 `bindInline({ forceInline: true })` 同步服务状态。
- Document PiP 关闭后会暂停视频，并把元素移回应用内 floating host 隐藏保活；MediaHub entry 保留为已暂停状态。

### 5.6 键盘控制

当前视频 viewer 在 `active=true` 且焦点不在输入框 / 文本域 / 可编辑元素内时响应键盘：

- `Space` / `K`：播放或暂停
- `ArrowLeft` / `ArrowRight`：快退 / 快进 10 秒
- `Shift + ArrowLeft` / `Shift + ArrowRight`：快退 / 快进 30 秒
- `J` / `L`：快退 / 快进 10 秒
- `ArrowUp` / `ArrowDown`：音量增减
- `M`：静音切换
- `F`：全屏切换

这些快捷键必须继续受 `active` guard 保护，切到浏览器 / 搜索 / 工具区或切到其他 file tab 后不能拦截前台输入。

### 5.7 合集播放列表

`VideoViewer` 可以接收 `FileViewerContext` 透传的 `videoPlaylist`：

- 列表来源当前是视频归档合集的一代可播放视频单元。
- 列表按钮放在底部控制条右侧，点击后向上弹出气泡卡片。
- 切换集数时由 `VideoViewer` 重新获取目标视频临时链接，并通过 `replaceTabId` 替换当前普通 `video` tab 内容，不额外新开标签页。
- 切换后继续透传同一份 `videoPlaylist`、当前集字幕候选和原始 `returnTarget`，保证继续切集和返回视频归档都不断链；如果播放列表项只有 `subtitleCardNodeId`，切换时才读取该视频单元目录下的字幕并回填到播放列表，避免合集打开时全量预取字幕；播放列表气泡层级必须高于字幕覆盖层。
- 合集入口可设置 `videoAutoPlay=true`，用于用户双击合集后直接播放第一集；普通视频入口不强制自动播放。

### 5.8 字号处理

当前 `VideoViewer` 已经把底部控制器和右侧工具台里实际使用的字号抽成局部层级，作为后续统一字号的起点。

参考文档：

- `docs/ui-font-size-reference.md`

当前重点不是“一次性统一全项目”，而是先把视频页这次真实落地的字号处理记录下来，后续再扩展到其他页面。

## 6. 验证方式

涉及 `VideoViewer` 改动时，至少验证：

1. 普通视频仍能正常播放。
2. 切换 tab、切换工作区页面或进入设置 / 传输中心 / 回收站后再回来，视频播放状态和进度不会异常丢失，也不会被路由切换自动暂停。
3. 切到浏览器 / 搜索 / 工具区时，视频快捷键不会继续拦截前台输入。
4. 关闭后重新打开同一个视频时，会从上次观看位置恢复。
5. 播放到接近片尾或结束后重新打开，不会卡在最后几秒。
6. 底部控制条的拖动、音量、倍速、工具台、宽屏、全屏仍可用。
7. 右侧工具台可以展开和折叠；宽屏模式会临时折叠目录树和右侧工具台，退出后恢复进入前状态。
8. 加载 `.srt` / `.vtt` / `.ass` / `.ssa` / `.lrc` 后，字幕会固定显示在主视频区域底部。
9. 清除字幕后，字幕覆盖层消失。
10. 没有字幕时不会影响普通视频播放。
11. 从视频归档页打开带字幕的视频时，默认库内字幕自动加载；多个字幕时可以在工具台手动切换。
12. 从视频归档合集打开视频时，底部播放列表按钮可展开气泡并切换集数，气泡不被字幕遮挡，切换后仍停留在当前 tab 并保留归档返回链路。
13. 点击底部小窗按钮时，支持 Document PiP 的环境进入桌面小窗；不支持时降级应用内浮窗。
14. 小窗状态下 inline 区域显示海报占位，点击“收回 inline”后同一个视频回到播放器区域，进度不丢。
15. Document PiP 原生关闭后视频暂停，MediaHub entry 保留，回到原 tab 后可收回 inline。

## 7. 维护规则

出现以下任一变化时，必须更新本文：

- 视频进度 snapshot key、恢复阈值或 `viewMeta` key 变化
- 视频 DOM 生命周期、parking host 或 tab 关闭释放策略变化
- 视频小窗宿主、Document PiP fallback 或 inline 占位行为变化
- 字幕来源变化
- 字幕状态不再由 `VideoViewer` 本地持有
- 视频进度状态不再由 `VideoViewer` 本地持有
- 右侧工具台开始承载新的真实功能
- 宽屏模式和页面目录树折叠协作规则变化
- 视频键盘快捷键集合或 active guard 规则变化
- `VideoViewer` 不再是普通视频的唯一播放页
- `videoPlaylist` 结构、入口或切集行为变化
