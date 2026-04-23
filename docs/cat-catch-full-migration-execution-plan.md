# Cat Catch 完整迁移执行计划

更新时间：2026-04-22
状态：终稿。本文档覆盖 Cat Catch 全部值得迁入的能力。将文档中所有工作包实现完毕，即视为 Cat Catch 能力迁移完成。

## 背景

Cat Catch 是一个成熟的浏览器扩展，核心能力是"识别资源 → 判断类型 → 选择处理器 → 输出文件"。OmniFlow 内置浏览器已在之前的多轮迁移中完成了约 60-65% 的能力对齐。

本文档将剩余工作拆为 **13 个可独立执行的工作包**，每个工作包有明确的改动范围、预期行为和验收标准。工作包之间标注了依赖关系，可并行的会标明。

### 当前已有能力

- 网络资源嗅探、深度搜索注入、Worker 注入、fetch/XHR/JSON 扫描 → **已完成**
- MSE 缓存捕获（appendBuffer 拦截、音视频识别、ffmpeg 合并）→ **已完成**
- HLS manifest 解析（variants/renditions/keys/maps/segments）→ **已完成**
- HLS 两条执行主线（网络 manifest → ffmpeg 直拉；blob/页内 → 本地 downloader → ffmpeg）→ **已完成**
- HLS 工具区基础 UI（阶段进度、日志、失败重试、线程数、分片范围、variant 选择）→ **已完成**
- HLS key 候选收集与验证 → **基本完成**
- MPD 基础解析 → **基本完成**
- 分片上传 ≥ 100MB → **已完成**
- 资源处理结果 → 本地保存 → **已完成**

### 前置文档

开始任何工作包前必须阅读：

- `AGENTS.md`（根目录 + `omniflow-app/AGENTS.md`）
- `docs/embedded-browser-architecture.md`
- `docs/cat-catch-overview-and-migration-map.md`
- `docs/cat-catch-sync-maintenance-guide.md`
- `docs/captured-resource-flow-plan.md`

---

## 工作包总览

| # | 工作包 | 优先级 | 依赖 | 预估文件数 |
|---|--------|--------|------|-----------|
| WP-01 | 现有代码 Bug 修复 | P0 | 无 | 4 |
| WP-02 | tool-workspace 组件拆分 | P0 | 无 | 6 |
| WP-03 | AES-128 解密管线 | P0 | WP-01 | 3 |
| WP-04 | Manifest 重写修复 | P1 | WP-01 | 1 |
| WP-05 | 流式写盘（大文件） | P1 | WP-01 | 2 |
| WP-06 | HLS 完整轨道选择 | P1 | WP-02 | 3 |
| WP-07 | Master Playlist + 手动 Key 解锁 | P1 | WP-03, WP-06 | 2 |
| WP-08 | 直播流录制 | P2 | WP-01, WP-04 | 4 |
| WP-09 | MPD 下载器主链 | P2 | WP-02 | 5 |
| WP-10 | 规则过滤体系 | P2 | 无 | 4 |
| WP-11 | 资源处理结果 → 资源库导入 | P2 | 无 | 5 |
| WP-12 | 外部工具适配层 | P3 | 无 | 4 |
| WP-13 | MSE 增量写盘优化 | P3 | 无 | 3 |

**并行执行建议**：

- WP-01、WP-02、WP-10、WP-11、WP-12 互不依赖，可完全并行
- WP-03 需 WP-01 先完成（bug 修复后再加解密管线）
- WP-06 需 WP-02 先完成（组件拆分后再加轨道选择 UI）
- WP-07 需 WP-03 + WP-06 先完成
- WP-08 需 WP-01 + WP-04 先完成
- WP-09 需 WP-02 先完成（共享工具区拆分成果）
- WP-13 独立，任何时候可做

---

## WP-01：现有代码 Bug 修复

**目标**：修复 rogue agent 代码中的关键 bug，确保现有 HLS 下载链路端到端可用。

> 2026-04-23 主线复核说明：
> - 原始草案中的 Bug 1（download plan 与 local fragment 类型不匹配）已经在当前主线里收口，不再作为独立修复项。
> - 原始草案中的 Bug 3（重试时字节追踪覆盖）已经被当前“每次下载任务重建字节 Map”实现覆盖，不再作为独立修复项。
> - 原始草案中的 Bug 5（资源卡手动 key 验证）不再成立；手动 key 的主入口已经迁到工具区 HLS 工作流，资源卡只保留只读验证。
> - 因此 WP-01 当前聚焦剩余 3 条真实 bug：重试进度、retry playlist 和 dead code。

### Bug 2：重试场景下进度计算错误

**位置**：`electron/service/embeddedBrowserHlsLocalDownloaderService.ts` 约 429 行

**问题**：`initialCompletedFragments = plan.fragments.length - fragmentsToDownload.length` 在重试场景下假设所有非请求分片都已完成，但实际可能有分片根本没下载过。

**修复方式**：改为根据磁盘上已存在的分片文件数量计算 `initialCompletedFragments`。在下载开始前，检查 `segments/` 目录中已存在的文件数。

**改动文件**：
- `electron/service/embeddedBrowserHlsLocalDownloaderService.ts`

### Bug 4：重试 playlist 包含未下载分片

**位置**：`electron/service/embeddedBrowserHlsLocalDownloaderService.ts` 约 570 行

**问题**：`buildLocalPlaylist()` 接收 `plan.fragments` 全量，但重试场景只下载了部分分片。生成的 playlist 引用了不存在的本地文件。

**修复方式**：`buildLocalPlaylist()` 应只包含磁盘上实际存在的分片文件。在构建 playlist 前，用 `fs.existsSync` 过滤 fragment list。

**改动文件**：
- `electron/service/embeddedBrowserHlsLocalDownloaderService.ts`

### Bug 6：mapTag 死代码

**位置**：`electron/service/embeddedBrowserFragmentDownloader.ts` 约 256-258 行

**问题**：`get mapTag()` 始终返回空字符串，无任何调用方。

**修复方式**：删除 `mapTag` getter。

**改动文件**：
- `electron/service/embeddedBrowserFragmentDownloader.ts`

### 验收标准

- HLS 本地下载（blob manifest + 无加密分片）端到端成功
- 重试失败分片后，进度显示正确、playlist 只包含已下载分片
- 手动输入 key 后点击"验证"可正确验证
- `npm run lint && npm run build` 通过

---

## WP-02：tool-workspace 组件拆分

**目标**：将 3494 行的 `tool-workspace/index.tsx` 拆为独立子模块。

> 2026-04-23 当前进度：
> - `index.tsx` 已收成 workspace shell，并恢复原来的条件渲染语义；切换工具时不会再因为常驻挂载而保留旧弹窗、旧日志和旧本地状态。
> - 当前 `index.tsx` 已从 3494 行降到约 **165 行**。
> - 字幕翻译 owner 已下沉到 `hooks/useSubtitleTranslation.ts`，shell 不再承载 runner 订阅、导入、翻译、保存这些副作用。
> - HLS 已从 `ToolWorkspaceMedia.tsx` 中继续拆出 `ToolWorkspaceHls.tsx`，并抽出 `hooks/useHlsDownloadTask.ts` 承接任务状态、订阅和处理逻辑。
> - 当前主要子模块行数：
>   - `ToolWorkspaceMedia.tsx`：约 669 行
>   - `ToolWorkspaceSubtitle.tsx`：约 764 行
>   - `ToolWorkspaceHls.tsx`：约 645 行
>   - `useSubtitleTranslation.ts`：约 455 行
>   - `useHlsDownloadTask.ts`：约 737 行
> - 因此 **WP-02 的结构性目标已经基本完成**；剩余只是一点 shell 行数压缩和后续按需继续细拆，不再是阻塞后续工作包的前置问题。

### 当前结构分析

`index.tsx` 混合了三大块互不相关的逻辑：

1. **字幕翻译** — 字幕加载、翻译行管理、LLM 调用、导出
2. **HLS 下载** — manifest 分析、key 验证、variant 选择、线程控制、分片范围、下载进度、重试
3. **媒体资源处理** — 资源列表、合并、转码、保存

### 拆分方案

```
src/features/tool-workspace/
├── index.tsx                    ← 只保留 Tab 切换 + 子模块路由（< 100 行）
├── types.ts                     ← 保留，扩充子模块类型
├── ToolWorkspaceSubtitle.tsx    ← 字幕翻译模块
├── ToolWorkspaceHls.tsx         ← HLS 下载模块
├── ToolWorkspaceMedia.tsx       ← 媒体资源处理模块
└── hooks/
    ├── useHlsDownloadTask.ts    ← HLS 下载任务状态管理 hook
    └── useSubtitleTranslation.ts ← 字幕翻译状态管理 hook
```

### 拆分规则

1. **`index.tsx`** 只负责：
   - 接收 `activeToolId` 和 `mediaMode` props
   - 根据 mode 渲染对应子组件
   - 不包含任何业务 state 或 effect

2. **`ToolWorkspaceHls.tsx`** 承接所有 HLS 相关逻辑：
   - variant 选择 UI
   - key 验证与手动 key 输入
   - 线程数 / 分片范围控制
   - 下载进度、阶段显示、日志
   - 失败重试
   - `useHlsDownloadTask` hook 管理任务生命周期

3. **`ToolWorkspaceMedia.tsx`** 承接：
   - 资源列表展示
   - 合并 / 转码 / 保存操作
   - 后续 WP-11 的"导入资源库"按钮

4. **`ToolWorkspaceSubtitle.tsx`** 承接字幕翻译全部逻辑

### 改动文件

| 文件 | 操作 |
|------|------|
| `src/features/tool-workspace/index.tsx` | 重写为路由 shell |
| `src/features/tool-workspace/ToolWorkspaceHls.tsx` | 新建 |
| `src/features/tool-workspace/ToolWorkspaceMedia.tsx` | 新建 |
| `src/features/tool-workspace/ToolWorkspaceSubtitle.tsx` | 新建 |
| `src/features/tool-workspace/hooks/useHlsDownloadTask.ts` | 新建 |
| `src/features/tool-workspace/hooks/useSubtitleTranslation.ts` | 新建 |

### 验收标准

- 拆分后各子组件独立运行，功能不变
- `index.tsx` 不超过 150 行
- 各子模块不超过 800 行
- 所有现有功能（字幕翻译、HLS 下载、媒体处理）行为不变
- `npm run lint && npm run build` 通过

### 收口说明

- 这一步之后，WP-06 / WP-09 已经可以在独立 HLS 模块上继续推进，不必再穿过 `index.tsx` 或旧媒体壳理解状态 owner。
- 如果后续还要继续优化 WP-02，优先做的只剩：
  1. 继续压缩 `index.tsx` 到 150 行以内
  2. 视需要把 `ToolWorkspaceSaveTarget.tsx`、`ToolWorkspaceNav.tsx` 的共享壳继续抽到更稳定的位置
  3. 根据后续工作包再决定是否继续拆细 `ToolWorkspaceSubtitle.tsx`

---

## WP-03：AES-128 解密管线

**目标**：在 HLS 本地下载链路中实现真正的 AES-128 分片解密，让加密 HLS 流可以正确下载并播放。

> 2026-04-23 当前主线复核说明：
> - 当前 OmniFlow 主线已经是“本地 downloader 下载 key 到本地 + 重写本地 playlist + 交给 ffmpeg 解密/合成”，不是完全没有 AES-128 处理能力。
> - 手动 key 目前也已经会被写成本地 key 文件，并通过重写后的 `EXT-X-KEY` 交给 ffmpeg 消费。
> - 因此本工作包当前不默认直接落 `embeddedBrowserAesDecryptor.ts` 和“主进程预解密分片”这条增强分支，避免在还没有真实样本证明 ffmpeg 主线不够用时先引入额外复杂度。
> - 当前更稳的执行顺序是：先按本文的“方式一（ffmpeg 解密）”完成真实样本验真；只有确认存在 ffmpeg 无法正确消费本地 key / playlist 的具体场景，再继续补“方式二（主进程内 AES-128 解密）”。
> - 验收时应优先覆盖：普通 AES-128 URL key、带 Cookie / Referer 的 key URL、手动 key、包含 `EXT-X-MAP` 的加密 HLS。若这些都能通过，则 WP-03 以现有主线即可视为基本完成，不强制新增客户端预解密实现。

### 背景

Cat Catch 使用自实现的 `AESDecryptor`（来自 `lib/m3u8-decrypt.js`，299 行）在下载管线中透明解密每个分片：

```
下载分片 → AES-128-CBC 解密（key + IV）→ 去除 PKCS#7 padding → 写入 buffer
```

当前 OmniFlow 的 `embeddedBrowserHlsLocalDownloaderService.ts` 只下载 key 文件并写入本地路径，但 **不对分片数据执行解密**。分片以原始加密状态写入磁盘，然后交给 ffmpeg。ffmpeg 在读取本地 rewritten playlist 时，如果 playlist 中 `EXT-X-KEY` 指向正确的本地 key 文件，ffmpeg 会自行解密。

**问题**：当用户提供手动 key（非 URL 获取的 key）时，本地 downloader 已能将手动 key 写为本地文件并在 playlist 中引用。但如果 key URL 需要特殊 headers（Cookie/Referer）才能访问，ffmpeg 的 HTTP 客户端可能无法获取 key，此时需要客户端预解密。

### 实现方案

在 Electron 主进程 HLS 下载链路中，对加密分片执行 AES-128-CBC 解密。

**方式一（推荐）：依赖 ffmpeg 解密，确保 key 文件可用**

当前链路已能正确重写 playlist 并下载 key 文件到本地路径。只要 ffmpeg 读取的 local playlist 中 `EXT-X-KEY` URI 指向有效的本地 key 文件，ffmpeg 就能自行解密。

需要做的是：确保所有场景下 key 文件都正确写入本地路径：
- URL key：已能通过 `prepareKeyRefs()` 下载 → 正确
- 手动 key：已能写为本地文件 → 正确
- 需要特殊 headers 的 URL key：当前 `prepareKeyRefs()` 已使用 plan 中的 headers → 确认 headers 包含 Cookie/Referer

**方式二（增强）：主进程内 AES-128 解密**

适用于 ffmpeg 无法处理的边角情况（如 key 格式非标准）。

#### 步骤

1. **新建解密工具模块**

   **新文件**：`electron/service/embeddedBrowserAesDecryptor.ts`

   ```typescript
   import { createDecipheriv } from 'node:crypto';

   export function decryptAes128Cbc(
     encryptedData: Buffer,
     key: Buffer,     // 16 bytes
     iv: Buffer,      // 16 bytes
   ): Buffer {
     const decipher = createDecipheriv('aes-128-cbc', key, iv);
     return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
   }

   export function buildFragmentIv(
     explicitIv: string | undefined,
     sequenceNumber: number,
   ): Buffer {
     if (explicitIv) {
       // EXT-X-KEY IV 是 16 字节 hex（0x 前缀）
       const hex = explicitIv.startsWith('0x') ? explicitIv.slice(2) : explicitIv;
       return Buffer.from(hex.padStart(32, '0'), 'hex');
     }
     // 默认 IV = 大端 128-bit 序号
     const buf = Buffer.alloc(16);
     buf.writeUInt32BE(sequenceNumber, 12);
     return buf;
   }
   ```

   Node.js 原生 `crypto` 模块直接支持 AES-128-CBC，性能远超浏览器端 JS 实现。

2. **集成到下载管线**

   **改文件**：`electron/service/embeddedBrowserHlsLocalDownloaderService.ts`

   在 `sequentialPush` 事件回调中（分片写盘前），判断分片是否有关联的 key：
   - 有 key 且用户选择了"客户端解密"模式 → `decryptAes128Cbc(buffer, keyData, iv)` → 写入解密后数据
   - 无 key 或 key 已下载到本地让 ffmpeg 处理 → 写原始数据（当前行为不变）

   需要从 plan 的 fragment 元数据中读取 `key.method`、`key.uri`、`key.iv`，以及从 `keyRefs` Map 中获取实际 key 内容。

3. **在 plan 类型中标记解密模式**

   **改文件**：`src/features/embedded-browser/resources/model/embedded-browser-hls-manifest.ts`

   `EmbeddedBrowserHlsDownloadPlan` 新增可选字段：
   ```typescript
   decryptionMode?: 'client' | 'ffmpeg';  // 默认 'ffmpeg'
   ```

   工具区 UI 根据场景自动决定：
   - 有手动 key → `'client'`（ffmpeg 可能不认非标准 key 路径）
   - URL key + 需特殊 headers → `'client'`
   - 其他 → `'ffmpeg'`（当前默认行为，不变）

### 改动文件

| 文件 | 操作 |
|------|------|
| `electron/service/embeddedBrowserAesDecryptor.ts` | 新建 |
| `electron/service/embeddedBrowserHlsLocalDownloaderService.ts` | 加解密分支 |
| `src/features/embedded-browser/resources/model/embedded-browser-hls-manifest.ts` | 加 `decryptionMode` 字段 |

### 验收标准

- 下载 AES-128 加密的 HLS 流，ffmpeg 模式：输出文件可正常播放
- 下载 AES-128 加密的 HLS 流，手动 key + client 模式：输出文件可正常播放
- 无加密 HLS 流：行为不变
- `npm run lint && npm run build` 通过

---

## WP-04：Manifest 重写修复

**目标**：修复本地 playlist 重写中的缺陷，确保 ffmpeg 能正确读取重写后的 m3u8。

> 2026-04-23 当前主线复核说明：
> - 当前主线已经覆盖了这包里的大部分核心点：本地 playlist 只引用磁盘上真实存在的分片；`EXT-X-KEY` 和 `EXT-X-MAP` 只在变化时写入；本地 key / map 都会写成相对路径；`BYTERANGE` 语义也已在前序修复中去掉，避免对已裁好的本地文件再次切片。
> - 本工作包当前剩余的重点，不是“从零重写整个 playlist”，而是把 playlist 生成进一步收口到更稳定的规范形态，例如显式写出 `TARGETDURATION`、统一从 `MEDIA-SEQUENCE:0` 开始，以及继续确认包含 `EXT-X-MAP` / `EXT-X-KEY` / 范围下载的样本都能被 ffmpeg 正确消费。
> - 当前主线也应保持“宁可显式失败，不产出坏 playlist”的原则：如果本地 key / map / segment 文件缺失，重写阶段应直接报错，而不是静默写出 ffmpeg 无法正确消费的本地 m3u8。
> - 因此 WP-04 现在应按“已有主线补规范、补验真”理解，而不是按“Manifest 重写完全不可用”理解。

### 当前问题

`buildLocalPlaylist()` 在 `embeddedBrowserHlsLocalDownloaderService.ts` 中生成本地 m3u8 文件，但存在以下缺陷：

1. **相对 URL 未正确重写**：如果原始 manifest 使用相对 URL，重写后的本地 playlist 可能仍引用原始相对路径
2. **EXT-X-MAP init segment 引用缺失**：当分片需要 init segment 时，本地 playlist 需正确引用已下载的本地 init segment 文件
3. **Discontinuity sequence 重置不正确**：当选择分片范围下载时，discontinuity 编号可能不连续
4. **Key URI 本地路径**：已下载的 key 文件需要在 playlist 中用相对路径引用

### 修复方案

重写 `buildLocalPlaylist()`，按 HLS 规范严格生成本地 playlist：

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:{maxDuration}
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="keys/key-0.key"{,IV=0x...}
#EXT-X-MAP:URI="maps/map-0.m4s"
#EXTINF:{duration},
segments/segment-000000.ts
#EXTINF:{duration},
segments/segment-000001.ts
...
#EXT-X-ENDLIST
```

规则：
- 所有 URI 使用相对于 playlist 文件的路径（`segments/`、`keys/`、`maps/`）
- 只包含磁盘上实际存在的分片文件
- `EXT-X-KEY` 只在 key 变化时重复写入
- `EXT-X-MAP` 只在 init segment 变化时重复写入
- `EXT-X-DISCONTINUITY` 在原始 manifest 中标记了 discontinuity 的位置保留
- `EXT-X-MEDIA-SEQUENCE` 始终从 0 开始

### 改动文件

| 文件 | 操作 |
|------|------|
| `electron/service/embeddedBrowserHlsLocalDownloaderService.ts` | 重写 `buildLocalPlaylist()` |

### 验收标准

- 重写后的本地 playlist 可被 ffmpeg 正确读取并处理
- 包含 `EXT-X-MAP` 的 fMP4 HLS 流正确处理
- 包含 `EXT-X-KEY` 的加密流正确引用本地 key 文件
- 部分范围下载后的 playlist 只包含已下载分片
- `npm run lint && npm run build` 通过

---

## WP-05：流式写盘（大文件策略）

**目标**：HLS 分片下载时，已完成的分片立即写入磁盘而非全部积累在内存。

> 2026-04-23 当前主线复核说明：
> - 当前主线已经是逐片写盘：`embeddedBrowserFragmentDownloader.ts` 会按顺序 `sequentialPush`，`embeddedBrowserHlsLocalDownloaderService.ts` 收到后立刻 `writeFile` 到本地 `segments/`。
> - `buffer` 释放也已经在 downloader 的 `sequentialPush()` 中完成，因此这包当前不需要再额外补“emit 后置 null”的修复。
> - 本工作包真正需要收口的是“写盘失败后的处理语义”：避免 `Promise.all` 在第一处失败时提前中断收尾，并明确把失败分片回传给上层，而不是让任务看起来像普通下载失败。
> - 因此 WP-05 当前应按“已有流式写盘主线补稳健性”理解，而不是按“从零实现流式写盘”理解。

### 背景

Cat Catch 在浏览器环境下用 StreamSaver.js 绕过内存限制。OmniFlow 运行在 Electron（Node.js）中，可以直接用 `fs.createWriteStream` 或逐片 `fs.writeFile`。

当前 `embeddedBrowserFragmentDownloader.ts` 的 `sequentialPush` 事件已经支持"按顺序推送已完成分片"，`embeddedBrowserHlsLocalDownloaderService.ts` 在收到 `sequentialPush` 后会逐片写入文件。**当前链路已经是逐片写盘的**。

### 需要确认和修复的点

1. **内存释放**：确认 fragment buffer 在写盘后释放。检查 `embeddedBrowserFragmentDownloader.ts` 的 `buffer` 数组在 `sequentialPush` emit 后是否将对应 entry 置 null。

   **改动**：在 `sequentialPush()` 方法中，emit 后将 `this.buffer[index] = null` 释放内存。

2. **并发写盘保护**：确认 `pendingWrites` 的 `Promise.all` 在失败时正确处理（不会丢失已成功写入的文件）。

   **改动**：改为 `Promise.allSettled`，失败的写操作记入 error list 但不终止整体下载。

### 改动文件

| 文件 | 操作 |
|------|------|
| `electron/service/embeddedBrowserFragmentDownloader.ts` | buffer 释放 |
| `electron/service/embeddedBrowserHlsLocalDownloaderService.ts` | Promise.allSettled |

### 验收标准

- 下载 500+ 分片的 HLS 流，内存占用不随分片数线性增长
- 单个分片写盘失败不会导致整个下载终止
- `npm run lint && npm run build` 通过

---

## WP-06：HLS 完整轨道选择

**目标**：对 master playlist，支持完整的视频轨 + 音频轨 + 字幕轨选择。

### Cat Catch 的做法

Cat Catch 在 `m3u8.js` 中使用 HLS.js 解析 master playlist 后：

- 展示所有 `data.levels[]`（视频 variants：分辨率 + 码率）
- 展示所有 `data.audioTracks[]`（音频轨：语言 + 组）
- 展示所有 `data.subtitleTracks[]`（字幕轨：语言）
- 用户通过 radio button 选择具体的视频质量和音频轨
- 选择后加载对应的 media playlist，展示该轨道的分片列表

### OmniFlow 当前状态

- 已能解析 variant 和 rendition 元数据
- 工具区已有第一版 variant 选择（默认"自动"，可锁定具体 variant URL）
- 已展示关联的音轨组 / 字幕组摘要
- 已支持按当前 variant 关联的 group 选择独立音轨，并走 `ffmpeg` 下载+合并主链
- 已支持选择字幕轨并单独下载到本地
- **剩余**：更完整的轨道联动验真与边角修正

> 2026-04-23 当前进度（Codex）：
> - 已落地：工具区可选择独立音轨，并通过 `video manifest + audio manifest -> ffmpeg` 完成合并；字幕轨按 Cat Catch 的思路单独下载到本地，不强行并入视频成品。
> - 已落地：variant 切换会按 `audioGroupId / subtitlesGroupId` 收窄可选轨道；如果旧选择不再匹配当前 group，会自动清掉，避免脏状态沿用。
> - 当前保持的边界：没有额外发明新的下载器模式，也没有把字幕强行塞进视频输出；这里只做 Cat Catch 对应能力的客户端最小适配。
> - 待验真：真实站点下的轨道联动、带 Cookie/Referer 的独立音轨 manifest、字幕轨下载样本。

### 实现方案

在 `ToolWorkspaceHls.tsx`（WP-02 拆分后）中实现：

1. **视频轨选择**
   - 展示所有 variants：`{resolution} · {bitrate} · {codec}`
   - 默认选中最高码率（或"自动"由 ffmpeg 决定）
   - 选择后更新 plan 中的目标 media playlist URL

2. **音频轨选择**
   - 展示所有 audio renditions：`{language} · {name} · {groupId}`
   - 默认沿用当前 variant 对应的默认音轨
   - 如果用户明确选中独立音轨 URI，则下载视频 manifest + 音频 manifest，并用 ffmpeg 合并

3. **字幕轨选择**（可选下载）
   - 展示所有 subtitle renditions：`{language} · {name}`
   - 勾选后单独下载字幕文件（通常是 WebVTT）

4. **联动逻辑**
   - 选择 variant 后自动更新关联的 audio group
   - 切换 variant 后重新解析 media playlist（获取分片列表）
   - 视频+独立音频 → 分别下载 → ffmpeg -i video -i audio -c copy merge

### 数据流

```
Master Manifest
  → parseEmbeddedBrowserHlsManifest()
  → 展示 variants + audioRenditions + subtitleRenditions
  → 用户选择
  → 根据选择生成 1-2 个 download plan（视频 + 独立音频各一个）
  → 分别执行本地 downloader
  → ffmpeg 合并（如有两路）
```

### 改动文件

| 文件 | 操作 |
|------|------|
| `src/features/tool-workspace/ToolWorkspaceHls.tsx` | 轨道选择 UI（WP-02 拆分后） |
| `src/features/embedded-browser/resources/model/embedded-browser-hls-manifest.ts` | 加 `resolveVariantMediaPlaylist()` 方法 |
| `electron/service/embeddedBrowserMainController.ts` | 支持双轨道下载 + ffmpeg 合并 |

### 验收标准

- Master playlist 展示所有视频/音频/字幕 variant
- 选择不同分辨率后，variant / audio group / subtitle group 关系正确联动
- 选择独立音频轨后，视频 + 音频 manifest 下载并 ffmpeg 合并成功
- 字幕轨可单独下载
- `npm run lint && npm run build` 通过

---

## WP-07：Master Playlist + 手动 Key 解锁

**目标**：解除"master playlist + 手动 key"组合的 UI 拦截，使其正确工作。

### 背景

当前工具区对 master playlist + 手动 key 的组合会显式拦住（"仍不是完整支持场景"），避免误走错误主链。在 WP-03（AES-128 解密管线）和 WP-06（完整轨道选择）完成后，这个组合可以正确工作：

1. 用户选择具体 variant → 解析出 media playlist
2. Media playlist 中有 `EXT-X-KEY` → 用户输入手动 key
3. 走本地 downloader → client 模式解密 → ffmpeg 合并

> 2026-04-23 当前进度（Codex）：
> - 已落地：`master playlist + 手动 key` 不再一刀切拦死；当前要求先明确选择一个具体 variant，再继续执行。
> - 已落地：选定 variant 后，工具区会先请求该 variant 对应的 media playlist，并基于它重新生成 media-level HLS plan，然后接回现有 `local-plan -> 本地 key 文件 -> ffmpeg` 主链。
> - 当前保持的边界：没有额外引入新的 `decryptionMode` 或主进程预解密实现；这里只是把 `master + manual key` 收敛到现有本地主链，避免为 WP-07 单独再起一套解密体系。
> - 待验真：真实样本下的 `master + selected variant + manual key` 下载成功与产物可播放。

### 实现方案

1. 移除 UI 拦截逻辑
2. 当 manifest 是 master playlist + 用户选择了 variant + 输入了手动 key → 自动设 `decryptionMode: 'client'` → 走本地 downloader 主链

### 改动文件

| 文件 | 操作 |
|------|------|
| `src/features/tool-workspace/ToolWorkspaceHls.tsx` | 移除拦截 |
| `src/features/embedded-browser/resources/services/embedded-browser-resource-manifest-actions.ts` | 调整 plan 生成逻辑 |

### 验收标准

- Master playlist + 选择 variant + 输入手动 key → 下载成功、输出可播放
- `npm run lint && npm run build` 通过

---

## WP-08：直播流录制

**目标**：支持 HLS 直播流的持续录制，追踪新分片并增量下载。

### Cat Catch 的做法

Cat Catch 在 `m3u8.js` 中实现了 `recorder` 模式：

- 设置 `recorder = true` 标志
- 使用 `recorderLast` 追踪最后下载的 segment 序号
- 定时轮询 manifest（HLS 直播 manifest 会持续更新）
- 每次轮询后，只下载 `sn > recorderLast` 的新分片
- 使用 `Downloader` 的 `sequentialPush` 模式，按序推送新分片到输出流
- 用户手动点击"停止录制"结束
- 录制结束后可选合并所有分片

### OmniFlow 实现方案

> **2026-04-23 当前进度（Codex）**
>
> - 已新增 `embeddedBrowserHlsLiveRecorder.ts`，采用“轮询 media playlist -> 只补新增分片 -> 复用现有 local-plan downloader”的最小主线。
> - 已接上 `start-hls-recording` / `stop-hls-recording` IPC、main 侧 session 生命周期、工具区“开始录制 / 停止录制”入口。
> - 当前实现刻意复用现有 `local-plan -> 本地 playlist -> ffmpeg` 主链，没有为直播录制另起新的下载器或解密模式。
> - 已修正两条边界：同一 tab 重复开始时不再静默清掉旧录制；停止后若 ffmpeg 导出失败，会保留当前 workdir，工具区允许直接“重试导出”。
> - 当前离开工具区或切换到别的 HLS 请求时，会把未导出的直播录制视为放弃任务并清理 session，而不是偷偷自动导出结果。
> - 本轮主要目标是先把“开始录制 -> 持续追加新分片 -> 停止后交给 ffmpeg 导出”闭环接通；5 分钟以上稳定性和真实样本验真仍待后续统一测试。

1. **检测直播流**

   HLS manifest 中 **没有 `#EXT-X-ENDLIST`** 标签表示直播流。在 `parseEmbeddedBrowserHlsManifest()` 返回结果中标记 `isLive: boolean`。

2. **Manifest 轮询器**

   **新文件**：`electron/service/embeddedBrowserHlsLiveRecorder.ts`

   ```typescript
   class EmbeddedBrowserHlsLiveRecorder {
     private lastSequenceNumber: number;
     private pollIntervalMs: number;  // 从 manifest 的 TARGETDURATION 推算
     private isRecording: boolean;
     private downloader: EmbeddedBrowserFragmentDownloader;

     async start(manifestUrl: string, headers: Record<string, string>): void;
     async stop(): { workDirectoryPath: string; totalFragments: number };
   }
   ```

   轮询逻辑：
   - `setInterval` 按 `TARGETDURATION` 间隔重新 fetch manifest
   - 解析新 manifest，找出 `sn > lastSequenceNumber` 的分片
   - 将新分片加入 downloader 队列
   - `sequentialPush` → 写入 `segments/` 目录

3. **工具区 UI**

   在 `ToolWorkspaceHls.tsx` 中，当检测到直播流时：
   - 显示"直播流"标签
   - "下载"按钮变为"开始录制"
   - 录制中显示：已录制时长、已录制分片数、文件大小
   - "停止录制"按钮 → 停止轮询 → ffmpeg 合并所有分片

4. **IPC 注册**

   新增 IPC handler：
   - `embedded-browser:resource:start-hls-recording`
   - `embedded-browser:resource:stop-hls-recording`

### 改动文件

| 文件 | 操作 |
|------|------|
| `electron/service/embeddedBrowserHlsLiveRecorder.ts` | 新建 |
| `electron/service/embeddedBrowserMainController.ts` | 加录制 handler |
| `src/features/tool-workspace/ToolWorkspaceHls.tsx` | 加录制 UI |
| `src/features/embedded-browser/resources/model/embedded-browser-hls-manifest.ts` | 加 `isLive` 字段 |

### 验收标准

- 打开直播流 HLS manifest → 显示"直播流"标识
- 点击"开始录制" → 持续下载新分片 → 进度显示更新
- 点击"停止录制" → ffmpeg 合并 → 输出可播放文件
- 录制 5 分钟以上不内存泄漏
- `npm run lint && npm run build` 通过

---

## WP-09：MPD 下载器主链

**目标**：将 DASH/MPD 从"只能解析"提升到"可以下载"，对齐 Cat Catch 的 mpd 下载能力。

> 2026-04-23 当前进度（Codex）：
> - 资源面板里的 MPD 已补“送到工具页”入口，工具区新增 `mpd-download` 模式。
> - 工具区第一版已经能展示 video/audio representation，并按“分辨率 / 码率 / codec / 语言”选择轨道，不直接暴露内部 id。
> - Electron main 已补 `downloadMpdPlan` IPC 和 `embeddedBrowserMpdLocalDownloaderService.ts`，当前主线是：
>   `representation 选择 -> 本地下载 init+segments -> 轨道文件落盘 -> ffmpeg 合并输出`。
> - 当前版本先明确拒绝 DRM MPD；目标是先把非 DRM MPD 的主链闭环做稳，不在这一步扩成额外状态机。

### Cat Catch 的做法

Cat Catch 使用 `mpd-parser.min.js` 解析 MPD manifest，然后：

- 展开所有 Representation（视频轨+音频轨）
- 用户选择具体分辨率/码率
- 下载所有 segment（SegmentTemplate 展开为 URL 列表）
- 下载 init segment
- ffmpeg 合并视频+音频

### OmniFlow 当前状态

- MPD parser 已能解析 BaseURL、SegmentTemplate/SegmentTimeline/SegmentList
- 已能输出下载计划 JSON
- **缺失**：视频/音频轨选择 UI、真正的下载执行、ffmpeg 合并

### 实现方案

1. **MPD 下载计划生成**

   **改文件**：已有的 MPD parser（在 `embedded-browser/resources/model/` 下）

   生成结构化 plan：
   ```typescript
   interface MpdDownloadPlan {
     videoTrack: { representationId: string; segments: MpdSegment[]; initSegment?: MpdSegment };
     audioTrack?: { representationId: string; segments: MpdSegment[]; initSegment?: MpdSegment };
     subtitleTrack?: { representationId: string; url: string };
   }
   ```

2. **MPD 工具区 UI**

   在 `ToolWorkspaceMedia.tsx`（WP-02 拆分后）或新建 `ToolWorkspaceMpd.tsx` 中：
   - 展示所有 video Representations（分辨率 + 码率 + codec）
   - 展示所有 audio Representations（语言 + codec）
   - 用户选择后生成 download plan
   - 复用 `EmbeddedBrowserFragmentDownloader` 下载 segments
   - 视频 + 音频分别下载到本地 → ffmpeg 合并

3. **IPC handler**

   新增或扩展 `downloadEmbeddedBrowserMpdPlanResource()` — 类似 HLS 本地下载链路。

### 改动文件

| 文件 | 操作 |
|------|------|
| `src/features/embedded-browser/resources/model/` 下 MPD 相关 | 加 plan 生成 |
| `src/features/tool-workspace/ToolWorkspaceMpd.tsx` 或 `ToolWorkspaceMedia.tsx` | MPD 下载 UI |
| `electron/service/embeddedBrowserMainController.ts` | 加 MPD plan download handler |
| `electron/service/embeddedBrowserMpdLocalDownloaderService.ts` | 新建，复用 fragment downloader |
| `src/features/embedded-browser/resources/services/embedded-browser-resource.api.ts` | 加 MPD plan API |

### 验收标准

- MPD manifest → 展示可选轨道 → 选择 → 下载 → ffmpeg 合并 → 可播放
- 含独立音频轨的 MPD 正确合并
- `npm run lint && npm run build` 通过

---

## WP-10：规则过滤体系

**目标**：实现资源捕获规则过滤系统，对齐 Cat Catch 的 regex / 黑白名单 / 扩展名过滤能力。

### Cat Catch 的做法

Cat Catch 在 `js/init.js` 中定义默认规则，在 `js/background.js` 中执行过滤：

- **默认扩展名**：mp4, webm, ogg, mp3, wav, flac, aac, m4a, m3u8, mpd, ...
- **默认 MIME**：video/*, audio/*, application/x-mpegURL, ...
- **默认 Regex**：爱奇艺 JSON 提取、B 站直播 m4s 黑名单、Instagram/Facebook bytestart 等
- **damnUrl**：全局屏蔽列表（广告 URL 等）
- **用户自定义**：扩展名 / MIME / Regex 增删、黑白名单域名

### OmniFlow 实现方案

1. **规则模型**

   **新文件**：`electron/service/embeddedBrowserResourceCaptureRules.ts`

   ```typescript
   interface ResourceCaptureRuleSet {
     extensions: string[];           // 匹配的文件扩展名
     mimeTypes: string[];            // 匹配的 MIME（支持 wildcard：video/*）
     regexPatterns: RegexRule[];     // URL 正则匹配
     blockPatterns: RegexRule[];     // URL 正则屏蔽
     domainBlacklist: string[];     // 域名黑名单
     domainWhitelist: string[];     // 域名白名单（空 = 不限）
   }

   interface RegexRule {
     pattern: string;
     label: string;          // 显示名称
     enabled: boolean;
     builtIn: boolean;       // 内置规则不可删除
   }
   ```

2. **默认规则**

   从 Cat Catch `js/init.js` 迁移关键默认值：

   ```typescript
   const DEFAULT_RULES: ResourceCaptureRuleSet = {
     extensions: ['mp4','webm','ogg','mp3','wav','flac','aac','opus',
                  'm4a','m3u8','mpd','m4s','ts','flv'],
     mimeTypes: ['video/*','audio/*','application/x-mpegURL',
                 'application/dash+xml','application/vnd.apple.mpegURL'],
     regexPatterns: [
       { pattern: 'iqiyi\\.com.*\\.json.*vid=', label: '爱奇艺JSON', enabled: true, builtIn: true },
       // ... 其他站点经验规则
     ],
     blockPatterns: [
       { pattern: 'bilivideo\\.c(n|om).*live.*m4s', label: 'B站直播m4s', enabled: true, builtIn: true },
     ],
     domainBlacklist: [],
     domainWhitelist: [],
   };
   ```

3. **规则引擎**

   在资源捕获链路（`embeddedBrowserMainController.ts` 的 `onResourceCaptured`）中应用规则过滤：

   ```
   网络请求 → URL/MIME/extension 匹配 → 通过 → 加入资源列表
                                      → 被屏蔽 → 丢弃
   ```

4. **设置 UI**

   在 embedded browser 设置面板中新增"捕获规则"tab：
   - 内置规则列表（可启用/禁用）
   - 用户自定义规则增删
   - 域名黑白名单
   - 规则持久化到 electron-store

### 改动文件

| 文件 | 操作 |
|------|------|
| `electron/service/embeddedBrowserResourceCaptureRules.ts` | 新建 — 规则模型 + 引擎 |
| `electron/service/embeddedBrowserMainController.ts` | 接入规则过滤 |
| `src/features/embedded-browser/settings/` 下 | 新建规则设置 UI |
| `electron/preload.ts` + `electron/electron-env.d.ts` | 新增规则管理 IPC |

### 验收标准

- 默认规则下，常见视频/音频格式被正确捕获
- B 站直播 m4s 被默认屏蔽
- 用户可新增/禁用 regex 规则
- 域名黑名单生效
- `npm run lint && npm run build` 通过

> 2026-04-23 当前进度（Codex）：
> 已补第一版规则过滤闭环：main 侧新增可持久化的捕获规则集合，网络捕获与 probe 捕获都会先经过扩展名 / MIME / regex / 域名黑白名单判定，再决定是否进入资源列表；renderer 侧把“捕获规则”接进了浏览器设置页，可编辑默认扩展名、MIME、域名黑白名单，并对内置规则做启用/停用、自定义规则做增删。这里先按客户端最小闭环实现，没有额外扩展成复杂规则系统；持久化也沿用当前 userData 下 JSON 文件方案，而不是单独再引 electron-store。

---

## WP-11：资源处理结果 → 资源库导入

**目标**：让所有处理操作（merge、transcode、HLS download、DASH download）支持"导入到资源库"出口。

### 背景

详见 `docs/captured-resource-flow-plan.md` Phase 1。这是"客户端处理 → 上传"终态架构的核心环节。

### 实现方案

1. **共享 hook**

   **新文件**：`src/features/embedded-browser/resources/hooks/useResourceImportToLibrary.ts`

   ```typescript
   function useResourceImportToLibrary() {
     return {
       importToLibrary: async (
         outputPath: string,
         fileName: string,
         fileSize: number,
         target: { libraryId: number; parentId: number },
       ) => {
         const file = toUploadFile({ name: fileName, size: fileSize, path: outputPath });
         await uploadManager.createBatch([{
           file,
           libraryId: target.libraryId,
           parentId: target.parentId,
         }]);
         await window.electronAPI.cleanupStagedTextFile(outputPath);
       },
       pickTarget: () => {
         // 打开 LibraryNodePicker 选择目标目录
       },
     };
   }
   ```

2. **操作菜单扩展**

   在资源面板和工具区的操作菜单中，现有的"保存"操作旁新增"导入到资源库"选项：
   - 用户选择目标目录（复用 `LibraryNodePickerModal`）
   - 执行处理操作时设 `useSystemSaveDialog: false` + `outputDirectoryPath: tempDir`
   - 处理完成后 `importToLibrary(outputPath, ...)`
   - 进度：处理中(xx%) → 上传中(xx%) → 完成

3. **tempDir 管理**

   新增 IPC：`app:getTempImportDir` → 返回 `app.getPath('temp') + '/omniflow-import-{random}/'`

### 改动文件

| 文件 | 操作 |
|------|------|
| `src/features/embedded-browser/resources/hooks/useResourceImportToLibrary.ts` | 新建 |
| `src/features/tool-workspace/ToolWorkspaceMedia.tsx` | 加"导入到资源库"按钮 |
| `src/features/tool-workspace/ToolWorkspaceHls.tsx` | 加"导入到资源库"按钮 |
| `electron/preload.ts` + `electron/electron-env.d.ts` | tempDir IPC |

### 验收标准

- HLS 下载 → 选择"导入到资源库" → 选择目标目录 → 处理 → 上传 → 文件出现在资源库
- MSE 合并 → 导入到资源库 → 成功
- 大文件（≥100MB）自动走分片上传
- temp 文件在上传完成后清理
- `npm run lint && npm run build` 通过

> 2026-04-23 当前进度（Codex）：
> 工具区第一版“导入到资源库”主链已接上：`merge / transcode / HLS / MPD` 在选择资源库目录后，不再先落到 Downloads，而是先申请专用 temp import 目录，处理完成后统一走 `uploadManager.createBatch` 导入资源库，成功后清理 temp 输出。现阶段先收在工具区，复用已有 `LibraryNodePickerModal` 和上传中心，不额外发明第二套导入状态机；资源面板上的其它入口等后续再顺着这条链补齐。
> - 2026-04-23 调整：temp import 目录已改成“每次任务独立创建”，不再在工具区共享同一个 staging 目录，避免并发导入时互删临时文件；任务取消或前置失败时也会单独回收这次的 temp 目录，不再依赖切换模式时的额外清理钩子。
> - 2026-04-23 调整：任务启动时会冻结这次的保存目标（本地/资源库目录），处理中切换工具区选项不会把结果导到新的位置；同时导入资源库失败会向上抛回任务状态，不再把失败任务误报成 success。

---

## WP-12：外部工具适配层

**目标**：支持将嗅探到的资源导出到外部下载工具。

### Cat Catch 支持的外部工具

1. **N_m3u8DL-RE**：命令行 HLS/DASH 下载器，通过 URL protocol 调用
2. **aria2 RPC**：通过 JSON-RPC 发送下载任务
3. **invoke 本地程序**：用命令模板调用任意本地程序
4. **send2local**：HTTP POST 发送到本地服务

### OmniFlow 实现方案

1. **外部工具模型**

   **新文件**：`electron/service/embeddedBrowserExternalTools.ts`

   ```typescript
   interface ExternalToolConfig {
     id: string;
     name: string;
     type: 'aria2' | 'command' | 'protocol' | 'http-post';
     enabled: boolean;
     config: Aria2Config | CommandConfig | ProtocolConfig | HttpPostConfig;
   }

   interface Aria2Config {
     rpcUrl: string;       // 如 http://localhost:6800/jsonrpc
     secret?: string;      // RPC 密钥
   }

   interface CommandConfig {
     template: string;     // 如 "N_m3u8DL-RE {url} --save-dir {dir}"
     workingDir?: string;
   }
   ```

2. **外部工具执行器**

   - **aria2**：通过 `http.request` 发送 JSON-RPC `aria2.addUri`
   - **命令模板**：`child_process.spawn` 执行用户定义的命令，变量替换 `{url}`、`{headers}`、`{filename}`、`{dir}`
   - **URL Protocol**：`shell.openExternal('n_m3u8dl-re://...')`

3. **UI 集成**

   在资源卡和工具区操作菜单中新增"发送到外部工具"子菜单：
   - 列出所有已启用的外部工具
   - 点击后将 URL + headers + 文件名发送给对应工具
   - 在 embedded browser 设置中管理工具配置

### 改动文件

| 文件 | 操作 |
|------|------|
| `electron/service/embeddedBrowserExternalTools.ts` | 新建 — 工具执行器 |
| `electron/preload.ts` + `electron/electron-env.d.ts` | 外部工具 IPC |
| `src/features/embedded-browser/settings/` 下 | 外部工具配置 UI |
| `src/features/embedded-browser/resources/components/` 下 | 操作菜单新增入口 |

### 验收标准

- 配置 aria2 RPC → 发送 HLS URL → aria2 开始下载
- 配置命令模板 → 发送资源 → 本地程序启动
- 未配置时，"发送到外部工具"菜单不显示
- `npm run lint && npm run build` 通过

> 2026-04-23 当前进度（Codex）：
> 已补第一版外部工具适配层闭环：main 侧新增 `embeddedBrowserExternalTools.ts`，先只实现 `aria2 RPC / 本地命令 / URL 协议` 三种出口，不扩成更重的通用工具平台；renderer 侧已把“外部工具”接入浏览器设置页，并在资源卡与工具区执行面板里增加“发送到外部工具”入口，只展示已启用工具。当前刻意保持最小闭环，`send2local` 暂不提前扩展，等第一版黑盒样本验证后再决定是否继续补。

---

## WP-13：MSE 增量写盘优化

**目标**：将 MSE 捕获从"全量积累后一次性提取"改为"增量写盘"，支持大视频捕获。

> 2026-04-23 当前进度（Codex）：
> - 已把 page-side MSE 捕获改成“超阈值 flush -> probe console payload -> main 追加写入 temp spool file”的第一版主线，当前阈值采用 50MB。
> - `save / merge / transcode` 现在会优先读取 main 侧 file-backed MSE 资源，不再要求整段 MSE 都以 base64 从 page 回捞。
> - 当前实现刻意复用现有资源保存、MSE 合并和转码链路，没有为 MSE 单独再起一套下载器或工具页模式。
> - `clear cache / restart capture / 关闭 tab` 已补对应 spool 清理，避免 page cache 清空后 main 临时文件继续残留。
> - 仍待统一人工验真的点：超长视频内存曲线，以及资源卡“直接导出 / 打开”在大 MSE 场景下的黑盒体验。

### 当前问题

MSE 捕获数据链路：
```
SourceBuffer.appendBuffer(data)
  → probe 收集到 mseStreams（页面内存，持续增长）
  → 用户触发导出 → base64 编码 → IPC → 写盘 → ffmpeg
```

2GB 视频的峰值内存 ≈ 5GB+（页面内存 + base64 膨胀 + IPC 缓冲）。

### Cat Catch 的做法

- >1.8GB 启用 StreamSaver 流式写盘
- 每 1GB 自动保存一次（可选）

### OmniFlow 方案

**增量提取 + 追加写盘**：probe 每积累 N MB 的 buffer 后自动 IPC 发送一批，主进程追加写入 temp file。

1. **Probe 端改造**

   在 probe 的 `appendBuffer` 拦截中：
   - 维护 `pendingSize` 计数器
   - 当 `pendingSize > FLUSH_THRESHOLD`（如 50MB）时，触发 flush
   - Flush：将 pending buffers base64 编码 → `postMessage` 到 content script → IPC 到主进程
   - 主进程收到后追加写入 `{tabId}-{streamIndex}.raw` temp file
   - Flush 后清空 pending buffers，释放页面内存

2. **主进程端**

   **改文件**：`electron/service/embeddedBrowserMainController.ts`

   新增 `handleMseFlush(tabId, streamIndex, base64Chunk)` → `fs.appendFile` 追加写入。

3. **导出改造**

   导出时不再从页面提取全量数据，而是：
   - 触发最后一次 flush（将残余 pending buffers 写盘）
   - 直接使用已写盘的 temp file 作为 ffmpeg 输入

### 改动文件

| 文件 | 操作 |
|------|------|
| probe 注入脚本（MSE 捕获部分）| 加 flush 逻辑 |
| `electron/service/embeddedBrowserMainController.ts` | 加 flush handler + 导出改造 |
| `electron/preload.ts` + `electron/electron-env.d.ts` | flush IPC |

### 验收标准

- 捕获 2GB+ MSE 视频，页面内存不超过 200MB
- 导出后 ffmpeg 合并成功，输出可播放
- 增量写盘期间不影响页面播放
- `npm run lint && npm run build` 通过

---

## 明确不迁移的 Cat Catch 能力

以下能力经评估不适合迁入 OmniFlow，或需独立立项：

| 能力 | 不迁原因 |
|------|----------|
| StreamSaver.js | Electron 有原生文件系统，用 `fs.createWriteStream` 替代 |
| 浏览器下载限制 workaround | Electron 无此限制 |
| 扩展页面参数传播 | OmniFlow 无对应页面模型 |
| 录屏 / WebRTC / recorder | 独立产品方向，不属于资源嗅探主链 |
| 媒体控制 / 截图 / 画中画 | 独立产品方向 |
| JSON viewer | 可用现有开发者工具替代 |
| MQTT 推送 | 暂无产品需求 |
| 移动 UA / 移动标签 | 暂无产品需求 |
| mux.js TS→MP4 转封装 | Electron 端用 ffmpeg 替代，性能更好且格式支持更全 |
| 在线 FFmpeg iframe | Electron 有本地 ffmpeg |

---

## 完成标志

全部 13 个工作包完成后：

1. **HLS 下载**：支持加密/非加密、master/media playlist、多轨道选择、手动 key、分片范围、线程控制、失败重试、直播录制
2. **MPD 下载**：支持轨道选择、分片下载、ffmpeg 合并
3. **MSE 捕获**：支持大文件增量写盘、音视频合并、导出
4. **资源过滤**：支持 regex/extension/MIME/域名黑白名单
5. **导出**：保存到本地 / 导入到资源库 / 发送到外部工具
6. **大文件**：分片下载不 OOM、MSE 增量写盘、分片上传到后端

此时 Cat Catch 的核心能力（识别 → 解析 → 下载 → 处理 → 输出）在 OmniFlow 中全部可用，且按桌面客户端最佳实践重组，不依赖浏览器扩展 workaround。

---

## 文档维护

- 每完成一个工作包后，更新 `docs/cat-catch-migration-audit.md` 中对应项的状态
- 如果某个工作包发现新的 bug 或需求，在本文档中记录到对应工作包的"补充说明"节
- 全部工作包完成后，本文档归档，不再维护
