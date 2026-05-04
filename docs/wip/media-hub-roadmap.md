# 媒体控制中心 — 后续迭代清单

> **临时文档**。基线（工具栏乐符按钮 + Popover + MediaRegistry）已经在 main，正式说明在 `docs/library-detail-workspace.md` §4.6 / §11。这份只盯"还没做的"。做完一项划掉一项；全部做完整文件删。

## 现状速览

- `MediaRegistry`：库维度，`audio`/`video` kind，每条 `{ entryId, kind, tabId, title, isPlaying, currentTime, duration }`，控制回调包括 `play/pause/seek/dismiss`。
- 三类注册者：audio-viewer / asmr-viewer / video-viewer，均在 hasStarted 后注册，卸载清理。
- audio / asmr cleanup 会在自己是 globalAudioPlayer owner 时调 `clear()`，避免孤立后台音频。
- `globalAudioPlayer` 已接入 MediaSession：系统媒体控制器标题来自真实 trackName，支持 play/pause/seek，clear 时清理系统媒体状态。
- 已删除：`GlobalAudioMiniBar` 组件、video 跨 tab 自动 pause、audio↔video 互斥。

---

## Tier 1 — 立即可做（一上午能完）

### 1. Popover 行加进度条 + 时长（已完成）

**状态**：已完成。每行下方一条可点击 seek 的细进度条 + 右侧 `01:23 / 04:56`，`useRegisterMediaEntry` 按整秒归一化进度后广播。

**改动点**：
- `src/contexts/media-registry.context.ts`：`MediaEntry` 加 `currentTime?: number` / `duration?: number`。
- `src/hooks/useMediaRegistry.ts`：`RegisterMediaEntryOptions` 加同字段和 `seek(time)` 控制回调；`useRegisterMediaEntry` 的 update effect 把这两个字段也广播。
- `src/components/business/media-hub-popover/index.tsx`：每行渲染可点击进度条 + 时长文本；行本身不跳转，使用专门的"回到标签页"按钮。
- 三个 viewer：把 currentTime/duration 透传到注册项。
  - audio/asmr：`playerState.currentTime` / `playerState.duration`
  - video：现有 `currentTime` / `duration` state

**风险**：audio `timeupdate` 4Hz × 多 keep-alive viewer × registry 广播 → popover 行 setState 风暴。  
**对策**：在 `useRegisterMediaEntry` 内部用 `Math.floor(currentTime)` 或 500ms throttle，只在整秒变化时 emit；duration 几乎不变，只首次写。

**验证**：开 audio + 2 个 video，popover 进度条都跑；切 tab 不影响；popover 关闭时不应留任何 timer。

---

### 2. 播放/暂停按钮上 cyan active 色（已完成）

**状态**：已完成。行内 ▶/⏸ 按钮在 `isPlaying` 时使用 `#22d3ee`，方便扫一眼分辨"哪条在播"。

---

### 3. 每条加 ✕（移除）按钮（已完成）

**状态**：已完成。不用先跳回 tab 才能停，直接在 popover 里清掉一条。

**语义**：
- audio / asmr：✕ → `globalAudioPlayer.clear()`，entry 自然消失。
- video：✕ → pause + 退出本次媒体注册，不关闭 tab；用户在 tab 内再次播放时重新注册。

**改动点**：
- `MediaRegistryAPI` 加 `dismiss(entryId)` 方法。
- 各 viewer 提供 dismiss 回调：audio / asmr 清空单例播放器，video pause 并重置 `hasStartedPlaying`。
- popover 行加 ✕ 按钮。

**风险**：dismiss 后用户在 tab 里点播放，video 应该重新注册。靠 `hasStartedPlaying` 重置 + 下次 onPlay 自动加回，链路是通的。

---

### 4. 空态按钮处理：常驻禁用 vs 隐藏

**目前**：隐藏。  
**问题**：用户不知道这个能力存在。  
**选项**：
- A：改默认为"常驻禁用"，在用户偏好里加 toggle。
- B：保留隐藏，但在 onboarding / 首次进入加一次提示。

**先不做**，等用户反馈"找不到这功能"再决定。挂个 issue 标记一下。

---

## Tier 2 — 中期（半天到一天）

### 5. OS 级 MediaSession API（已完成）

**状态**：已完成。锁屏 / 蓝牙耳机暂停键 / macOS 状态栏 NowPlaying widget 可控制 `globalAudioPlayer` 当前播放。

**实现**：
- 在 `globalAudioPlayer` 内部接入 `navigator.mediaSession`。
- `metadata = new MediaMetadata({ title, artist, album })`，title 使用当前 `trackName`。
- `setActionHandler('play' | 'pause' | 'seekbackward' | 'seekforward' | 'seekto')`。
- `setPositionState({ duration, position, playbackRate })` 在 `emitState()` 时按秒同步。
- `clear()` 会清空 metadata / playbackState / positionState。

**边界**：
- video 暂不接（多实例，MediaSession 只一份；除非后续有"焦点 video"概念）。
- previous/next 暂不接，需要统一 audio 队列概念后再做。

---

### 6. 视频缩略图（已完成）

**状态**：已完成。popover 视频条左侧优先显示低分辨率首帧缩略图，生成失败时回退抽象视频图标。

**实现**：
- video-viewer 在 `loadedmetadata` / `canplay` 后用 canvas 抓低分辨率帧 → jpeg dataURL → 进 entry。
- 抓帧会过滤近似全黑的空帧；未抓到有效帧时，popover 会用视频链接自身做 metadata 预览兜底。
- 不做动态当前帧更新，避免额外解码与 canvas 热路径。
- audio 没有原生封面，继续 fallback 圆形音符 icon。

**改动点**：`MediaEntry` 加 `thumbnailUrl?: string` 和 `previewUrl?: string`；popover 优先渲染 `<img>`，再 fallback 到只读 `<video preload="metadata">`。

**注意**：dataUrl 大小，用低分辨率（80x60 足够）+ jpeg quality 0.7。

---

### 7. Popover 按 kind 分组（已完成）

**状态**：已完成。只在 entries.length > 4 时按音频 / 视频分组，否则平铺更直观。

**改动点**：`MediaHubPopover` 加 group header。

---

## Tier 3 — 长期 / 跨进程

### 8. 把 embedded browser 的媒体也接入

**目标**：浏览器内打开 youtube/bilibili 等，那条 `<video>` 也出现在媒体控制中心。

**架构**：
- main 进程：`webContents.audioMutedAt` / `isCurrentlyAudible()` 周期性轮询。
- 进一步控制：`webContents.executeJavaScript('document.querySelectorAll("video").forEach(v=>v.pause())')`（或 MediaSession 事件桥）。
- preload 暴露：`window.electronEmbeddedBrowser.media.list/play/pause(tabId)`。
- renderer：写一个 `useRegisterEmbeddedBrowserMedia` hook 把 main 的状态翻译成 MediaRegistry 条目。
- entry 的 `tabId` 改成 browser tab id；`onActivate` 路径要分支：file tab → activateTab；browser tab → activate browser tab。

**触及面**：electron/service/embeddedBrowserMainController.ts、preload、新 IPC、library detail toolbar 跳转分发。是独立战线，建议拆成单独的 wip 文档。

**前置**：`MediaEntry` 应该先抽象 `tabKind: 'file' | 'browser'`，不然 popover onActivate 没法分支。

---

### 9. 拆 globalAudioPlayer 单例 → 多 audio 实例

**触发条件**：用户明确要"两首歌同时播"。目前没要求，**不要主动做**。媒体控制中心当前收尾不包含这项。

如果做，影响面：
- audio-viewer / asmr-viewer 各自持 `<audio>` ref。
- 删掉 ownerKey/ownerType 概念，每个 viewer 自治。
- MediaSession 只能绑一个"主"实例（用户上次操作的那个）。
- registry 不变。

---

### 10. 悬浮 mini player（picture-in-picture 风格）

popover 里加个 📌，把当前播放项 detach 成右下角小窗，全应用范围内可见。  
Electron 起一个 child window or DOM portal 到根。

**优先级低**。功能很酷但跟"集中控制"目标重叠度高，先把 #1-#5 做扎实再说。

---

## 推荐做的下一步

如果只想做一轮：**#1 + #5 + #3**。三个加起来从"够用"直接跳到"chrome 级"，且互相独立可分别 PR。

#8（embedded browser 接入）单独开一份 wip 文档，跨进程动比较深，值得专题处理。

---

## 完成后清理

- 全部做完 → 删整个 `docs/wip/media-hub-roadmap.md`，把"现状速览"里能沉淀的（比如新加的字段、MediaSession bridge）回写到 `docs/library-detail-workspace.md` §11。
- 部分做完 → 划掉做完的 Tier，留剩余的。
