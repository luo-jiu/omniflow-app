# 上传进度架构（轮询 + UI 解耦）

更新时间：2026-05-06
关联代码：
- `src/utils/uploadManager.ts`（执行器，缝合点）
- `src/modules/upload-center/services/upload-progress.api.ts`（轮询封装）
- `src/modules/upload-center/engine/upload-manager.ts`（队列引擎）
- `src/modules/upload-center/model/upload-task.types.ts`（事件契约）
- `src/features/file-explorer/services/file.api.ts`（IPC 上传与 form 字段）
关联后端文档：
- `omniflow-go/docs/architecture/upload-progress-design.md`
- `omniflow-go/docs/architecture/upload-direct-upload-migration.md`

## 1. 问题与架构选择

OmniFlow 当前是 proxy 上传：客户端 → Go 后端 → MinIO。客户端只能感知 client→backend 一段；IPC 写完后 UI 立刻 100%，但 backend→MinIO 还在继续。结果用户看到"完成"和真实落库之间存在不可见的等待。

后端方案是单实例内存 tracker + `GET /api/v1/upload/:uploadId/progress` 轮询。前端在执行器层面接管 `UploadManager.onProgress` 数据来源：

```
                       executor 内部
   ┌──── createIpcUploadTask ────► IPC bytes ─┐
   │                                          │  仅作首帧前兜底，
   │                                          │  服务端样本到达后丢弃。
Task ─────────► reportProgress(bytes, speed?) ┤
   │                                          │
   │   pollUploadProgress(uploadId, ...) ──── ┘
   │                                          (server bytes，
   │                                           500ms 间隔)
   ▼
UploadManager ── onProgress event ──► UI
```

**UI 不感知数据来源。** `UploadManagerEvent.PROGRESS` 不绑定 server / client / IPC 中任何一种通道，由执行器内部自由切换。

## 2. 数据流和职责

### 2.1 `defaultExecutor`（`src/utils/uploadManager.ts`）

- 启动时 `crypto.randomUUID()` 生成 uploadId（独立于 IPC 内部 taskId，避免把客户端内部 ID 暴露到 wire 协议）。
- 立即启动 `pollUploadProgress(uploadId)`；不等首帧。
- 调 `uploadAndCreateNode(...)`，把 `uploadId` 透传到 form `upload_id` 字段。
- 任务结束（成功 / 失败 / 取消）`finally` 调 `stopPoll()`，确保不留僵尸 interval。

### 2.2 `pollUploadProgress`（`src/modules/upload-center/services/upload-progress.api.ts`）

- 通过 `window.electronAPI.fetch` 直接走 IPC，避开 `ipcRequest` 的 throw-on-404，便于在"会话尚未注册"或"已被清理"时静默重试。
- 默认 500ms 间隔。立即触发一次以减少首帧延迟。
- 进入 `state==='done'` 自动停止；调用方也可通过 `signal` 主动取消。
- 错误（5xx、网络异常）通过 `onError` 透传，**不停止轮询**——避免一次抖动让进度永久卡住。

### 2.3 monotonic + 双源切换

执行器内部：

- `lastReportedBytes`：服务端短暂 5xx 时不允许进度回退。
- `serverSampleSeen` 标志：第一帧服务端样本到达后忽略 IPC `onProgress`。
  - **为什么不直接覆盖**：IPC 字节天然比服务端快（client→backend 段）；如果不丢弃，进度会被推到比真实写入更靠前的位置。
  - **首帧前为什么要喂 IPC**：tracker 注册到第一次轮询返回之间存在窗口，期间 UI 完全不动会被误判为"卡住"。

## 3. 类型扩展

`UploadTaskEvent.PROGRESS` 类型保持不变，UI 消费层无需任何改动。当前没有新增 `source` 字段——是否需要 source 标记由"未来出现 UI 想区分来源"驱动，预付反而徒增复杂度。

如果未来需要区分（例如 debug 工具），可以加：

```ts
| { type: 'PROGRESS'; uploadedBytes: number; speedBps?: number; source?: 'client' | 'server'; at?: number };
```

且仅由执行器填写，UI 仍可选择忽略。

## 4. UI 不变量

- UI 只读 `task.progress.uploadedBytes / percentage / speedBps`，不查询 tracker。
- `UploadManager.onEvent` 只接收 `PROGRESS` 事件，不订阅 `state`。
- 进度回退在执行器内部已被 monotonic 防御，UI 层无需重复保护。

## 5. 错误与异常路径

| 场景 | 行为 |
|---|---|
| 服务端 404（首次注册前 / 清理后） | 静默，IPC 兜底 |
| 服务端 5xx | `onError` 上报，monotonic 保护防回退，下次轮询恢复 |
| 网络断开 | `onError` 上报，IPC 兜底；恢复后继续 |
| 任务被用户取消 | executor `finally` 触发 `stopPoll`，IPC abort 由 `payload.setAbort` 接管 |
| 任务失败（HTTP 4xx/5xx） | 同取消路径；轮询停止；UI 显示失败 |

## 6. 验证清单

参考 `docs/frontend-validation-matrix.md` 上传段，重点：

- [x] ≥100MB 整传：进度越过 IPC 100% 时点继续平滑推进，无停滞。
- [x] 多 part 分片（如启用）：跨 part 平滑推进，无回退。
- [x] 网络中断：轮询取消，无僵尸定时器；重试恢复。
- [x] 后端 5xx 轮询失败：monotonic 保护生效；恢复后继续。
- [x] 取消 / 终止：一个 interval 内停止轮询。

## 7. 未来直传迁移

切到客户端直传 MinIO 时（详见 `omniflow-go/docs/architecture/upload-direct-upload-migration.md`）：

1. **保留**：客户端持有 `uploadId`、`complete` 契约 `parts:[{partNumber, etag}]`、`UploadManagerEvent` 形状、UI 消费层。
2. **替换**：执行器内部 `pollUploadProgress(...)` 切到 XHR 的 `progress` 事件 / S3 SDK 回调；不再透传 `upload_id` form 字段；后端轮询端点同步删除。
3. **删除**：`src/modules/upload-center/services/upload-progress.api.ts` 整个文件。

UI 不动是核心收益。

## 8. 不变约束

- `UploadTaskExecutor` 的契约 `onProgress(uploadedBytes, speedBps?)` 是唯一缝合点，不得扩散到 UI 层。
- 执行器不持有任何全局状态：每个任务独立 uploadId、独立轮询 interval。
- 执行器结束 `finally` 必须取消轮询，避免泄漏。
