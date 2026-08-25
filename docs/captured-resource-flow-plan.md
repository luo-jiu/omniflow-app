# 嗅探资源流向规划

更新时间：2026-04-22

状态：保留的输出架构意图。本文的实现进度和“现状”表格是 2026-04-22 历史快照，不作为当前完成度依据。

> 范围说明：本文只保留处理结果输出流向的历史设计背景。当前捕捉、处理和输出状态以 `docs/embedded-browser-architecture.md`、`docs/cat-catch-migration-audit.md` 与实际代码为准；Cat Catch 全面重构、完成判断以及 `processingTask -> stagedOutputLease -> deliveryTask` 合同以 `docs/cat-catch-full-migration-execution-plan.md` 为准。本文后文若直接传递 `outputPath/tempPath`，只能理解为旧实现描述，不能覆盖 opaque lease 边界。

## 1. 背景

内置浏览器已经存在网络捕捉、MSE 捕捉和 manifest 处理实现，但这些实现尚未按全面重构契约证明与 Cat Catch 行为等价。本文只假设上游处理链能够产出 staged file，并定义它后续如何保存或进入资源库。

- **下载到本地**：实现存在，尚未按新契约验真
- **处理成品上传到资源库**：统一 handoff 缺失，这是本文原先规划的核心

典型场景：用户在内置浏览器中嗅探一个 2GB 的 m3u8 视频，希望直接存入资源库而不是先下载再手动上传。

> **职责边界**：本文只聚焦"处理结果 → 资源库"的流向问题。内存嗅探能力的完善（猫抓同步、MSE 增强等）由独立工作流负责，不在本文范围内。

## 2. 现状分析

### 2.1 已有能力

| 能力 | 状态 | 入口 |
|------|------|------|
| 网络资源捕捉 | 实现存在，未验真 | `session.webRequest` hooks |
| MSE 深度捕捉 | 实现存在，未验真 | probe 注入 + `appendBuffer` 拦截 |
| ffmpeg 合并（MSE 音+视频） | 实现存在，未验真 | `merge-mse` → temp file → save dialog |
| ffmpeg 转码 | 实现存在，未验真 | `transcode` → temp file → save dialog |
| HLS manifest 下载 | 实现存在，未验真 | `download-hls` → local downloader / ffmpeg |
| DASH manifest 下载 | 实现存在，未验真 | `download-mpd` → local downloader / ffmpeg |
| 普通下载导入资源库 | 实现存在，未验真 | `useEmbeddedBrowserDownloadImport` → `uploadManager.createBatch` |
| 分片上传（≥100MB） | 实现存在，未验真 | `http:chunked-upload` IPC handler |

### 2.2 缺失环节

| 缺失 | 影响 |
|------|------|
| 合并/转码/HLS 下载结果 → 资源库 | 用户必须先保存到本地再手动上传 |
| MSE 捕捉结果 → 资源库 | 同上 |
| 嗅探到的直链资源 → 资源库 | 只能通过浏览器下载中转 |
| m3u8 segment 列表 → 后端直接处理 | 当前只能客户端 ffmpeg |

### 2.3 现有导入路径

浏览器下载导入资源库的已有链路（`useEmbeddedBrowserDownloadImport`）：

```
浏览器下载完成 → tempPath
  → toUploadFile({ name, size, type, path: tempPath })
  → uploadManager.createBatch([{ file, libraryId, parentId }])
  → uploadAndCreateNode() → 走现有上传体系
  → 成功后 cleanupDownloadFile(tempPath)
```

这条链路在旧实现中存在，可作为 characterization 和 UploadManager 复用参考；它尚未按全面重构契约验证，不能直接据此升级完成状态。

## 3. 资源类型与处理特征

### 3.1 按资源类型分类

| 类型 | 代表场景 | 数据来源 | 典型大小 | 处理需求 |
|------|----------|----------|----------|----------|
| MSE 音视频 | B站、抖音 | 页面内存 ArrayBuffer | 100MB - 5GB | ffmpeg 合并音视频 |
| HLS/m3u8 | 各视频站 | manifest URL + 900+ segment URL | 500MB - 10GB | ffmpeg 流式下载合并 |
| DASH/mpd | YouTube 等 | manifest URL + segment URL | 500MB - 10GB | 同 HLS |
| 直链媒体 | CDN mp4/webm | 单个 URL | 10MB - 5GB | 直接下载 |
| 小资源 | 图片/字幕/文档 | URL 或页面内容 | < 10MB | 直接提取 |

### 3.2 处理链路差异

**MSE 捕捉**：page runtime 当前会在 pending buffer 超过阈值后分批编码并交给 main 追加到 spool file，最终残余 buffer 再 flush，由 main 使用 staged file 做合并或导出。

- 当前方向避免把整段媒体长期留在页面并一次性通过 IPC 搬运，但 chunk 编码、spool 配额、异常清理和超长媒体内存曲线仍需按全面重构契约验真。
- MSE 原始数据来自页面运行时，page 到 main 的传输边界无法完全省略；需要通过有界 chunk、背压和清理合同控制风险。

**HLS/DASH**：ffmpeg 直接从 URL 流式拉取全部 segment → 合并输出

- 优势：不经过页面内存和 base64，ffmpeg 直接 HTTP 拉取。
- 约束：需要正确的 request headers（Referer, Cookie 等），ffmpeg 需要在本地存在。

**直链媒体**：Electron 浏览器 `will-download` → 下载到 staging 目录 → 已有导入流程

- 已有完整链路，只需确保大文件走分片上传。

## 4. 方案分析

### 4.1 核心问题：处理在哪里发生？

**方案 A：客户端处理 → 上传结果文件**

```
嗅探资源 → Electron ffmpeg 处理 → temp file → chunked upload → 后端存入 MinIO
```

优势：
- ffmpeg 已在 Electron 集成，零后端改动
- 处理逻辑已有（merge、transcode、HLS download 全部实现）
- 只需在现有处理流程末尾接入上传

劣势：
- 大文件需要本地磁盘暂存（ffmpeg 输出 → 上传完成前占用空间）
- 处理和上传串行，总时间 = ffmpeg 处理时间 + 上传时间

**方案 B：发送元信息 → 后端处理**

```
嗅探资源 → 发送 manifest URL + headers → 后端 ffmpeg 拉取合并 → 直接存入 MinIO
```

优势：
- 无需客户端中转，处理结果直接进存储
- 客户端不需要磁盘空间暂存大文件

劣势：
- 后端需要安装 ffmpeg，增加部署复杂度
- 后端需要携带浏览器 session 的 Cookie/Referer 发起 HTTP 请求（header 透传）
- MSE 捕捉数据在页面内存中，无法由后端处理（MSE 场景退回方案 A）
- 需要新的后端 API + 任务系统（长时间运行的处理任务）
- 后端现在是 Go 服务，调 ffmpeg 需要 `os/exec`，错误处理和进度反馈更复杂

**方案 C：混合方案**

| 资源类型 | 处理位置 | 原因 |
|----------|----------|------|
| MSE 音视频 | 客户端 | 数据只在页面内存中 |
| HLS/DASH manifest | 可选 | 后端可直接拉取；客户端也已有 ffmpeg |
| 直链媒体 | 客户端 | 已有下载流程 |
| 小资源 | 客户端 | 提取后直接上传 |

### 4.2 结论：方案 A（客户端处理 → 上传）为终态架构

理由：

1. **统一性**：所有资源类型走同一条路径（处理 → temp file → upload），不需要按类型分叉
2. **已有基础**：Electron 侧 ffmpeg 处理链路已完整，分片上传刚实现
3. **最小改动**：只需在现有 merge/transcode/download 流程加一个"上传到资源库"出口
4. **部署简单**：不需要在 Go 后端安装和管理 ffmpeg
5. **防盗链天然解决**：客户端与浏览器共享同一个网络出口和 Cookie，源站不会拒绝

### 4.3 为什么不做"后端直处理"（已排除）

即使未来后端迁到远端服务器，也不推荐让后端直接拉取 m3u8 segment：

1. **防盗链**：视频站 segment URL 绑定客户端 IP + Cookie + Referer，服务器 IP 不同会被拦截，这是根本性障碍
2. **MSE 数据只在浏览器内存**：后端无法触及，MSE 场景必须走客户端，方案 B 无法统一
3. **分片上传已解决远程传输**：大文件断点续传能力已有，远程上传不是瓶颈
4. **投入产出不匹配**：后端 ffmpeg 任务系统需要几周开发（任务队列、进度回调、header 透传、错误处理），在 localhost 部署下只省 2-3 秒 loopback 传输

> **未来优化方向**：如果处理 + 上传的串行等待不可接受，应在客户端做 pipeline — ffmpeg 边输出边分片上传，总时间约等于 ffmpeg 处理时间。这完全在客户端实现，不需要后端配合。

## 5. 目标架构

### 5.1 总体流向

```
┌─────────────────────────────────────────────────────────────┐
│                    嗅探资源面板                                │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────┐   │
│  │ 直链媒体 │  │ MSE 流  │  │ m3u8/mpd│  │ 小资源(图片等)│   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └──────┬───────┘   │
│       │            │            │               │           │
│       ▼            ▼            ▼               ▼           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              处理层 (Electron main)                   │    │
│  │                                                     │    │
│  │  直链 → 浏览器下载       MSE → ffmpeg 合并            │    │
│  │  m3u8 → ffmpeg 流式下载  小资源 → 直接提取             │    │
│  │                                                     │    │
│  │  全部 → temp file (outputPath)                      │    │
│  └───────────────────────┬─────────────────────────────┘    │
│                          │                                  │
│            ┌─────────────┴──────────────┐                   │
│            ▼                            ▼                   │
│     ┌──────────────┐           ┌──────────────────┐         │
│     │  保存到本地    │           │  导入到资源库      │         │
│     │  (已有)       │           │  (新增)           │         │
│     │              │           │                  │         │
│     │  save dialog │           │  tempPath        │         │
│     │  → 用户选路径 │           │  → uploadManager  │         │
│     │              │           │  → chunked upload │         │
│     └──────────────┘           │  → 清理 temp     │         │
│                                └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 关键设计：复用现有导入模式

浏览器下载导入已有一条可复用评估的旧路径：

```typescript
// useEmbeddedBrowserDownloadImport.ts 中的模式
const file = toUploadFile(download); // { name, size, type, path: tempPath }
uploadManager.createBatch([{ file, libraryId, parentId, relativePath }]);
```

**所有嗅探资源的“导入到资源库”仍应统一收敛到 `uploadManager`，但处理成品必须先进入 main-owned staged output lease，不能把裸 `outputPath` 变成 renderer 的长期 owner。** 后续步骤是 2026-04-22 的旧方案草图，实施时以全面重构契约 6.5 为准：

1. 处理层产出 temp file（merge/transcode/HLS download 已经都会产出 outputPath）
2. 将 `outputPath` 包装为 `FileWithPath` 对象
3. 交给 `uploadManager.createBatch` → 底层自动判断走普通上传还是分片上传（≥100MB 走分片）
4. 上传完成后清理 temp file

这避免了在资源捕捉层造第二套上传/进度/重试状态机。

### 5.3 需要修改的现有 API

现有的 merge/transcode/download 操作已支持两个参数控制输出：

- `useSystemSaveDialog: boolean` — 是否弹系统保存对话框
- `outputDirectoryPath: string` — 不弹对话框时的输出目录

"导入到资源库"场景下，设置 `useSystemSaveDialog: false` + `outputDirectoryPath: tempDir`，处理完成后拿到 `outputPath`，直接交给上传体系。

**无需修改 merge/transcode/download 的 Electron 主进程逻辑**。只需在 renderer 调用时选择正确的参数组合。

## 6. 分片上传的关系

### 6.1 直接关系

分片上传（刚实现的 `http:chunked-upload`）是这套流向方案的关键基础设施：

- 嗅探到的视频文件普遍在 500MB - 5GB 范围
- 没有分片上传，大文件上传会超时或断网重传
- 有了分片上传，`uploadManager` 底层自动为 ≥100MB 的文件走分片路径

### 6.2 不需要的

- 不需要修改分片上传的后端 API
- 不需要修改 Electron 的 `http:chunked-upload` handler
- 不需要修改 `uploadAndCreateNode` 或 `createIpcChunkedUploadTask`

已有的分片上传完全透明地服务于 `uploadManager` → `uploadAndCreateNode` 链路。嗅探资源只需要能产出 temp file + 交给 `uploadManager` 即可。

## 7. MSE 大文件内存问题

### 7.1 现状

MSE 捕捉的数据链路：

```
页面 SourceBuffer.appendBuffer(ArrayBuffer)
  → probe 收集到 mseStreams Map（页面内存）
  → extractResource → base64 编码 → IPC 到主进程
  → Buffer.from(base64, 'base64') → 写 temp file
  → ffmpeg 合并
```

问题：2GB 视频 → 页面内存 2GB → base64 ~2.67GB → IPC 传输 2.67GB → 写盘 2GB。峰值内存占用约 5GB+。

### 7.2 猫抓的做法

猫抓在浏览器扩展环境下：
- 使用 StreamSaver.js 流式写盘（绕过内存限制）
- 1.8GB 以上自动启用流式模式
- MSE buffer 只保留首个 buffer（header），后续 buffer 立即写盘

### 7.3 改进方向（非本文范围，记录以备后续）

1. **增量写盘**：probe 每收到一批 buffer 就 IPC 发送并追加写入 temp file，而不是全部积累后一次性提取
2. **SharedArrayBuffer**：减少 IPC 序列化开销（需要特殊 Electron 配置）
3. **实际限制**：Electron 的 `executeJavaScript` 返回值大小有限制（~256MB），超大 MSE 捕捉需要分段提取

这是一个独立的优化议题，不阻塞第一版流向方案。第一版对 MSE 大文件的建议：在 UI 上提示用户当 MSE 捕捉超过 1GB 时优先使用"保存到本地 → 手动导入"路径。

## 8. 实施阶段

### Phase 1：资源处理结果 → 资源库（核心链路）

**改动范围**：仅 renderer 层

**目标**：让所有已有的处理操作（merge、transcode、HLS download、DASH download、save）支持"导入到资源库"出口。

**具体改动**：

1. **新增共享 hook**：`useResourceImportToLibrary(libraryId)`
   - 封装 `toUploadFile(outputPath, fileName, fileSize)` → `uploadManager.createBatch`
   - 提供 `importToLibrary(outputPath, fileName, options)` 方法
   - 处理进度/成功/失败提示
   - 成功后自动清理 temp file

2. **修改资源面板操作菜单**：
   - 现有操作（保存、合并、转码、下载 manifest）保持不变
   - 新增"导入到资源库"操作选项
   - 弹出目标目录选择（复用现有的 LibraryFolderEntry 选择 UI）

3. **实现各资源类型的导入**：

   | 操作 | 实现方式 |
   |------|----------|
   | 直链媒体 → 资源库 | 走现有浏览器下载 → 导入流程（已有） |
   | MSE 合并 → 资源库 | merge({ useSystemSaveDialog: false, outputDirectoryPath: tempDir }) → importToLibrary(outputPath) |
   | 转码 → 资源库 | transcode({ useSystemSaveDialog: false, outputDirectoryPath: tempDir }) → importToLibrary(outputPath) |
   | HLS 下载 → 资源库 | downloadHls({ outputDirectoryPath: tempDir }) → importToLibrary(outputPath) |
   | DASH 下载 → 资源库 | downloadMpd({ outputDirectoryPath: tempDir }) → importToLibrary(outputPath) |
   | 小资源(图片等) → 资源库 | save({ outputDirectoryPath: tempDir }) → importToLibrary(outputPath) |

4. **tempDir 管理**：
   - 使用 `app.getPath('temp') + '/omniflow-resource-import-{random}/'`
   - 需要新增一个 IPC 获取 temp dir 路径（或在 preload 暴露）
   - 上传完成后清理

**预估工作量**：前端 4-6 个文件改动，无后端改动。

> 2026-04-23 当前进度（Codex）：
> 工具区的第一版导入链已经按这里的 Phase 1 落下来了：`ToolWorkspaceMedia` 在“导入到资源库”模式下，会先申请专用 temp import 目录，再把 `merge / transcode / HLS / MPD` 的输出交给 `useResourceImportToLibrary`，最后统一走 `uploadManager.createBatch`。这一步的目的不是加新能力壳，而是把原来工具区那条“直接调用 uploadLocalPathAndCreateNode”的分叉，收口回上传中心。
> - 2026-04-23 调整：temp import staging 目录现在按任务独立创建并在单任务成功、取消或前置失败后单独清理，不再在整个工具页共享一个长生命周期目录。
> - 2026-04-23 调整：导入目标在任务启动时冻结，后续切换本地/资源库或改目录不会影响已启动任务；导入失败也会反映回原任务状态，而不是吞掉后继续上报成功。

### Phase 2：Catch Toolkit 一键导入

**目标**：缓存捕捉工具链（MSE 实时捕捉）完成后可一键导入资源库。

**具体改动**：

1. Catch Toolkit 面板新增"导入到资源库"按钮
2. 点击后：执行 ffmpeg merge → 使用 Phase 1 的 `importToLibrary` → 清理
3. `autoDownloadOnComplete` 设置扩展：增加"自动导入到资源库"选项

### Phase 3：进度与体验优化

**目标**：处理 + 上传的全程进度可见。

1. ffmpeg 处理进度（当前缺失 — ffmpeg 输出 progress 需要 stderr 解析）
2. 上传进度（已有 — uploadManager 自带）
3. 合并展示：处理中(xx%) → 上传中(xx%) → 完成

### Phase 4（远期）：Pipeline 优化

**前提**：Phase 1-3 完成后，如果用户反馈"处理完还要等上传"的体验不好。

**做法**：客户端 ffmpeg 边输出边分片上传 — ffmpeg 写满一个 chunk 就立即开始上传该 chunk。总时间从 `处理时间 + 上传时间` 降低到 `max(处理时间, 上传时间)`。纯客户端改动，无后端变化。

## 9. 需要确认的问题

1. **目标目录选择 UI**：导入资源库时是否复用现有的浏览器下载导入的 `LibraryFolderEntry` 选择器？还是需要新 UI？
2. **默认导入位置**：是否可以设置默认导入目录，避免每次选择？
3. **MSE 大文件阈值**：超过多大时在 UI 提示"建议先保存到本地"？1GB？2GB？
4. **Catch Toolkit 自动导入**：`autoDownloadOnComplete` 改为三选一（不自动 / 自动保存到本地 / 自动导入资源库）还是保持开关 + 单独的导入设置？
5. **HLS 下载的请求头透传**：当前 `downloadHlsManifest` 已支持 headers 参数。嗅探时抓到的 request headers 是否已完整保存？需要确认 Cookie 和 Referer 是否正确透传。

## 10. 文件清单（Phase 1 预估）

### 新建

| 文件 | 用途 |
|------|------|
| `src/features/embedded-browser/resources/hooks/useResourceImportToLibrary.ts` | 资源导入到资源库的共享 hook |

### 修改

| 文件 | 改动 |
|------|------|
| `src/features/embedded-browser/resources/hooks/useEmbeddedBrowserResources.ts` 或资源面板组件 | 操作菜单新增"导入到资源库" |
| `src/features/embedded-browser/resources/services/embedded-browser-resource.api.ts` | 可能需要 wrapper 函数 |
| `electron/preload.ts` | 可能新增获取 temp dir 的方法 |
| `electron/electron-env.d.ts` | 对应类型 |

### 不需要改

| 文件 | 原因 |
|------|------|
| `electron/service/embeddedBrowserMainController.ts` | 已有 `useSystemSaveDialog: false` + `outputDirectoryPath` 支持 |
| `electron/service/embeddedBrowserResourceMergeService.ts` | 已有 |
| `electron/service/embeddedBrowserResourceManifestDownloadService.ts` | 已有 |
| 后端所有文件 | 无需改动，复用现有上传体系 |
| `src/modules/upload-center/` | 无需改动，`uploadManager` 已支持 |
