# Upload Center (Step 1)

## 目录约定

- `model/upload-task.types.ts`
  - 只放类型、枚举、事件定义。
- `model/upload-task.state-machine.ts`
  - 单任务状态机（纯函数、不可变更新）。
- `model/upload-task.store.ts`
  - 任务集合管理（入队、分发事件、汇总统计）。
- `model/upload-task.scenario.ts`
  - 本地验收场景（纯内存，不依赖后端）。
- `engine/upload-manager.ts`
  - 上传引擎（队列、并发、取消、重试、事件回调）。
- `engine/upload-manager.scenario.ts`
  - Step 2 验收场景（并发与事件推送）。
- `services/upload-session.api.ts`
  - 直传 MinIO 7 端点的 fetch 包装（`init / parts/sign / parts(GET) / renew / complete / complete/status / abort`）。
  - 401/404/410 错误语义统一映射；执行器层调用，UI 不感知。
- `services/upload-direct.ts`
  - `runDirectUpload` 共享流程：init → 4 并发 sign+PUT → complete/reconciliation + 心跳 + abort。
  - 由 `UploadManager.defaultExecutor` 和 `uploadLocalPathAndCreateNode` 共用同一条链路。
  - complete 结果不确定时抛出 `UploadCommitUnknownError` 并保留 session；禁止自动 abort 或重复上传。
  - 详见 `omniflow-app/docs/upload-direct-architecture.md` 与 `omniflow-go/docs/architecture/upload-direct-design.md`。

## 与 Agent 产物上传的边界

- 上传中心只管理普通本地文件路径上传，包括 `UploadManager.defaultExecutor` 和直接调用 `uploadLocalPathAndCreateNode` 的保存入口。
- `media.extractAudio` 生成的 sealed artifact 不进入 UploadManager 队列，也不调用 `runDirectUpload`。它通过唯一的 `agent:media:artifact:upload` IPC 交给 Electron main，由 `electron/service/agent/agent-media-artifact-upload.ts` 全程持有账号复验、init、sign、最多 4 路 PUT、complete、reconcile 和 abort。
- Renderer 只能提交 artifact ID、认证凭据和 execution / owner 身份；上传目标来自 main 冻结的 `executionInput`。artifact 物理路径、签名 URL、upload session、part 和 ETag 不得进入上传中心状态或通用 `UploadTaskInput.filePath`。
- Agent 上传使用 `committed / uncommitted / commit_unknown` 三态以及 main-only 一次性 fallback grant；这些结算语义不并入 UploadTask 状态机，避免上传中心和 Agent Broker 出现双 owner。

## 代码规矩

1. 状态机必须保持纯函数，不得直接发请求。
2. 所有状态变化统一通过 `UploadTaskEvent` 驱动。
3. 非法状态流转必须抛错，避免静默失败。
4. UI 层只能调用 `UploadManager` / store 暴露的方法，不直接改任务对象。
5. Step 1 阶段不做后端依赖，不做断点续传协议。
6. 上传记录清理只移除内存任务记录，不删除远端文件；排队、上传中、暂停任务不能被清理。
7. complete 一旦发出，只有明确 `4xx` 才按确定失败清理；网络错误、`408 / 429 / 5xx` 必须先 reconciliation，仍不明确时保留 session。

## Step 2 扩展位

- 上传引擎仅消费状态机，不允许直接改任务对象字段。
- `UploadTaskInput.storageProvider` 是用户在上传确认 overlay 中选择的目标 provider 别名，只由上传执行器透传给后端，不进入状态机派生逻辑。
- 若未来支持断点续传，可新增 `sessionId/chunkIndex` 字段，但不破坏当前事件模型。
- `UploadTaskEvent.PROGRESS` 的数据来源对 UI 透明：当前由 Electron 主进程 PUT 出口字节（按 partNumber 由 `runDirectUpload` 合并）push 上来，事件契约不变。
