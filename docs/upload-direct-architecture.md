# 直传 MinIO 上传链路（前端视角）

更新时间：2026-08-28
状态：已落地（与 `omniflow-go/docs/architecture/upload-direct-design.md` 配套）

本文的 `runDirectUpload` 主链路只描述普通本地路径上传。Agent 生成的 sealed artifact 不进入上传中心，也不复用 Renderer 协调的 control plane；该例外由 Electron main 以单一事务持有，见下文。

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
   ├─ completeUploadSession(POST /api/v1/upload/complete)     → node / 不确定结果
   ├─ reconcileUploadCompletion(GET /api/v1/upload/complete/status)
   │                                                    → unknown / uncommitted / committed(node)
   └─ on error / cancel:
        ├─ electronAPI.uploadAbort(uploadId)                  ← 杀 in-flight part 请求
        └─ abortUploadSession(uploadId)                       (DELETE /api/v1/upload/:id)

complete 一旦发出且结果不确定，不进入上述 abort 分支，保留 session 等待核对。
```

Agent `media.extractAudio` 产物使用独立链路：

```text
Renderer
  └─ agent:media:artifact:upload
       只提交 artifactId、认证凭据、execution / owner 身份
          │
          ▼
Electron main
  ├─ 从冻结 executionInput 读取 library / parent / provider / fileName / format / conflictPolicy
  ├─ 复验当前账号与冻结 owner
  ├─ init → sign → 每批最多 4 路 PUT
  ├─ complete → 必要时用独立 signal reconcile 同一 operation
  └─ 返回 committed / uncommitted / commit_unknown
```

main 从 `AgentMediaArtifactStore.withOwnedFile` 提供的同一个已验证 `FileHandle` 按显式 offset 读取；complete 前复验源身份。Renderer 不取得 artifact 物理路径、签名 URL、upload session、part 或 ETag，也不能为单次请求指定上传目标。控制面 API 基址由构建期 `__OMNIFLOW_API_BASE_URL__` 固定注入。

## 2. 关键文件

| 文件 | 角色 |
|---|---|
| `src/modules/upload-center/services/upload-session.api.ts` | 7 个端点的 fetch 包装，统一 401/404/410 与 reconciliation 语义 |
| `src/modules/upload-center/services/upload-direct.ts` | `runDirectUpload` 共享流程：init → sign+PUT → complete + 心跳 + abort |
| `src/utils/uploadManager.ts` | 薄 executor 适配器：把 `UploadTaskInput` 翻译成 `runDirectUpload` 入参 |
| `src/features/file-explorer/services/file.api.ts::uploadLocalPathAndCreateNode` | 文本编辑器另存为 / 字幕保存等独立路径，**不进 UploadManager 队列**，直接调 `runDirectUpload` |
| `electron/ipc/http.ts::http:upload:presigned-put` | 主进程流式 PUT handler，`fs.createReadStream({start, end})` + `https.request` |
| `electron/preload.ts::electronAPI.uploadPresignedPut / uploadAbort / onUploadProgress` | 渲染进程→主进程契约 |
| `electron/service/agent/agent-media-artifact-upload.ts` | Agent sealed artifact 的 main-owned 事务：账号复验、init/sign/PUT/complete/reconcile/abort 与三态结算 |
| `electron/service/agent/agent-media-upload-control-plane.ts` | Agent main 侧受限 HTTP control plane；统一请求上限、认证与响应校验 |
| `electron/ipc/agent.ts::agent:media:artifact:upload` | Agent 产物唯一上传 IPC；不接收目标、签名 URL 或分片布局 |

## 3. 进度合并

主进程每个 part 都通过 `http:upload:progress` 事件 throttled（80 ms）发送 `{uploadId, partNumber, uploadedBytes, totalBytes, percentage, speedBps}`。

渲染进程在 `runDirectUpload` 维护 `partBytes: Map<partNumber, uploadedBytes>`，每次事件取 max（防止 chunk 回退），然后 `sum(partBytes.values())` 作为整体已上传字节回传给 `payload.onProgress`。

## 4. 心跳与续约

`HEARTBEAT_INTERVAL_MS = 8 * 60 * 60 * 1000`（lease 24h 的 1/3，足够容忍单次失败）。

任何 `signUploadParts` / `listUploadParts` 请求都会被后端隐式刷新 lease，所以心跳是兜底；只在长期 idle（比如等用户解决冲突）时才会真的派上用场。

## 5. abort 双层语义

- 渲染进程触发 `payload.setAbort()` 注入的 aborter；
- aborter 先调 `electronAPI.uploadAbort(uploadId)`：主进程把所有 in-flight part 请求 destroy（含 `fs.ReadStream` 和 `ClientRequest`）；
- 然后调 `abortUploadSession(uploadId)`：后端 multipart 调 `AbortMultipartUpload`，single 模式 best-effort 删除已 PUT 对象，最后删 session 行。
- 顺序：先杀网络请求再删后端 session，避免后端在 Abort 时还有 part 在写。
- complete operation 已被后端认领时，abort 返回冲突且不会删除对象；committed 回执上的 abort 是安全 no-op。

## 6. complete 幂等与结果核对

- 每次 `runDirectUpload` 在 init 后生成稳定 `clientOperationId`，同一次 complete 与 status 查询复用该值。
- complete 网络错误、`408 / 429 / 5xx` 时调用 `reconcileUploadCompletion`；状态为 `committed` 时直接恢复后端保存的 node。
- status 为 `unknown / uncommitted` 或 status 查询本身失败时，抛出带 `uploadId / clientOperationId` 的 `UploadCommitUnknownError`，并禁止自动 abort。
- `404 / 410` 与其他明确 `4xx` 是确定失败，仍走普通清理路径。
- 后端 committed 回执保留 7 天；重复 complete 不会创建第二个 node。旧客户端未传 operation ID 时由后端按 upload ID 生成兼容身份。
- 普通 `runDirectUpload` 仍以成功 node 或 `UploadCommitUnknownError` 表达结果；它不承担 Agent 的三态与本机兜底决策。
- Agent main-owned 链路显式返回 `uncommitted / commit_unknown / committed`。complete 或 reconcile 只有返回有效正整数 `node.id` 与非空 `node.name` 才能判定 `committed`；complete 已发出但仍无法核对时保留 session 并返回 `commit_unknown`。`committed` 与 `commit_unknown` 一旦形成，随后本地 FileHandle 退出复验或 lease 清理异常只能触发本地产物隔离，不能把禁止盲目重试的结算降级成普通 IPC 失败。
- Agent 只有收到 main 显式返回的 `uncommitted` 才登记一次性本机兜底 grant；`committed`、`commit_unknown`、Renderer 未取得结构化结果的普通 IPC 错误、错误 sender 和重放都不能触发 Save As。grant 绑定具体 artifact、execution、窗口、Session 和 Run。critical settlement 只在即将调用 complete 时开启，不覆盖上传数据阶段。

## 7. 嗅探 / 下载链路 0 改动不变量

`UploadTaskInput` 形状（`file`、`libraryId`、`parentId`、`relativePath`、可选 `storageProvider`）不变。任何调用 `uploadManager.createBatch([...])` 的入口都不感知底层链路切换。

存储配置页和 `fetchProviders()` 需要透传 provider 的 `publicEndpoint` 字段。该字段用于后端生成前端 / Electron 可直接访问的 MinIO 预签名 URL，不进入 `UploadTaskInput`，上传任务仍只传 `storageProvider` alias。

已验证：
- `src/features/file-explorer/hooks/useResourceImportToLibrary.ts:62`
- `src/features/embedded-browser/hooks/useEmbeddedBrowserDownloadImport.ts:87`
- `src/features/auto-import/runner.ts:61`
- `src/features/file-explorer/hooks/useDirectoryUpload.ts:144`

## 8. 文本另存为 / 字幕保存的特例

文本编辑器“另存为”和字幕保存通过 `uploadLocalPathAndCreateNode` 走直传，但**不进 UploadManager 队列**，避免在上传中心 UI 出现“1 个文件正在上传”的体验干扰。它们直接调 `runDirectUpload`，不发 `UploadManagerEvent`。

`conflictPolicy='auto_rename'` 在 `runDirectUpload({ conflictPolicy })` 中透传到 `complete` 阶段。

## 9. 已删除的旧前端链路

| 删除 | 替代 |
|---|---|
| `src/modules/upload-center/services/upload-progress.api.ts` | `upload-session.api.ts` |
| `src/features/file-explorer/services/file.api.ts::uploadAndCreateNode` | `runDirectUpload` |
| `src/service/request/ipcRequest.ts::createIpcUploadTask` | 渲染进程不再持有上传字节流 |
| `src/utils/uploadManager.ts::pollUploadProgress` 等轮询路径 | 直传字节进度由主进程 push |
| `src/shared/upload-limits.ts` | 直传无 SDK 4 路 buffer 误差，限额由后端 init 校验 |
| `electron/ipc/http.ts::http:upload`（chunked proxy） | `http:upload:presigned-put` |

`http:upload:formdata` 保留：仅服务于头像这类小文件、走后端 `POST /api/v1/files/upload` 代理保存。
