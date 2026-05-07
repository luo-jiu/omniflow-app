# 直传 MinIO 上传链路（前端视角）

更新时间：2026-05-07
状态：已落地（与 `omniflow-go/docs/architecture/upload-direct-design.md` 配套）

## 1. 全链路一览

```
UploadManager.defaultExecutor / uploadLocalPathAndCreateNode
   │
   ▼
runDirectUpload (src/modules/upload-center/services/upload-direct.ts)
   │
   ├─ initUploadSession    (POST /api/v1/upload/init)         → uploadId / mode / partSize / totalParts
   ├─ heartbeat (8h)       (POST /api/v1/upload/:id/renew)    ← lease 续约
   ├─ for each batch (4 并发):
   │    ├─ signUploadParts (POST /api/v1/upload/parts/sign)   → presigned PUT URLs
   │    └─ electronAPI.uploadPresignedPut(...)                → MinIO 直传，main 进程出口
   ├─ completeUploadSession(POST /api/v1/upload/complete)     → node
   └─ on error / cancel:
        ├─ electronAPI.uploadAbort(uploadId)                  ← 杀 in-flight part 请求
        └─ abortUploadSession(uploadId)                       (DELETE /api/v1/upload/:id)
```

## 2. 关键文件

| 文件 | 角色 |
|---|---|
| `src/modules/upload-center/services/upload-session.api.ts` | 6 个端点的 fetch 包装，统一 401/404/410 错误语义 |
| `src/modules/upload-center/services/upload-direct.ts` | `runDirectUpload` 共享流程：init → sign+PUT → complete + 心跳 + abort |
| `src/utils/uploadManager.ts` | 薄 executor 适配器：把 `UploadTaskInput` 翻译成 `runDirectUpload` 入参 |
| `src/features/file-explorer/services/file.api.ts::uploadLocalPathAndCreateNode` | 文本编辑器另存为 / 字幕保存等独立路径，**不进 UploadManager 队列**，直接调 `runDirectUpload` |
| `electron/ipc/http.ts::http:upload:presigned-put` | 主进程流式 PUT handler，`fs.createReadStream({start, end})` + `https.request` |
| `electron/preload.ts::electronAPI.uploadPresignedPut / uploadAbort / onUploadProgress` | 渲染进程→主进程契约 |

## 3. 进度合并

主进程每个 part 都通过 `http:upload:progress` 事件 throttled（80 ms）发送 `{uploadId, partNumber, uploadedBytes, totalBytes, percentage, speedBps}`。

渲染进程在 `runDirectUpload` 维护 `partBytes: Map<partNumber, uploadedBytes>`，每次事件取 max（防止 chunk 回退），然后 `sum(partBytes.values())` 作为整体已上传字节回传给 `payload.onProgress`。

## 4. 心跳与续约

`HEARTBEAT_INTERVAL_MS = 8 * 60 * 60 * 1000`（lease 24h 的 1/3，足够容忍单次失败）。

任何 `signUploadParts` / `listUploadParts` 请求都会被后端隐式刷新 lease，所以心跳是兜底；只在长期 idle（比如等用户解决冲突）时才会真的派上用场。

## 5. abort 双层语义

- 渲染进程触发 `payload.setAbort()` 注入的 aborter；
- aborter 先调 `electronAPI.uploadAbort(uploadId)`：主进程把所有 in-flight part 请求 destroy（含 `fs.ReadStream` 和 `ClientRequest`）；
- 然后调 `abortUploadSession(uploadId)`：后端 MinIO `AbortMultipartUpload` + 删 session 行。
- 顺序：先杀网络请求再删后端 session，避免后端在 Abort 时还有 part 在写。

## 6. 嗅探 / 下载链路 0 改动不变量

`UploadTaskInput` 形状（`file`、`libraryId`、`parentId`、`relativePath`、可选 `storageProvider`）不变。任何调用 `uploadManager.createBatch([...])` 的入口都不感知底层链路切换。

已验证：
- `src/features/file-explorer/hooks/useResourceImportToLibrary.ts:62`
- `src/features/embedded-browser/hooks/useEmbeddedBrowserDownloadImport.ts:87`
- `src/features/auto-import/runner.ts:61`
- `src/features/file-explorer/hooks/useDirectoryUpload.ts:144`

## 7. 文本另存为 / 字幕保存的特例

文本编辑器“另存为”和字幕保存通过 `uploadLocalPathAndCreateNode` 走直传，但**不进 UploadManager 队列**，避免在上传中心 UI 出现“1 个文件正在上传”的体验干扰。它们直接调 `runDirectUpload`，不发 `UploadManagerEvent`。

`conflictPolicy='auto_rename'` 在 `runDirectUpload({ conflictPolicy })` 中透传到 `complete` 阶段。

## 8. 已删除的旧前端链路

| 删除 | 替代 |
|---|---|
| `src/modules/upload-center/services/upload-progress.api.ts` | `upload-session.api.ts` |
| `src/features/file-explorer/services/file.api.ts::uploadAndCreateNode` | `runDirectUpload` |
| `src/service/request/ipcRequest.ts::createIpcUploadTask` | 渲染进程不再持有上传字节流 |
| `src/utils/uploadManager.ts::pollUploadProgress` 等轮询路径 | 直传字节进度由主进程 push |
| `src/shared/upload-limits.ts` | 直传无 SDK 4 路 buffer 误差，限额由后端 init 校验 |
| `electron/ipc/http.ts::http:upload`（chunked proxy） | `http:upload:presigned-put` |

`http:upload:formdata` 保留：仅服务于头像这类小文件、走后端 `POST /api/v1/files/upload` 代理保存。
