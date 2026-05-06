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
- `services/upload-progress.api.ts`
  - 后端真进度轮询封装。Proxy 上传模式下解决 UI 提前 100% 的问题。
  - 执行器层调用，UI 不感知；详见 `omniflow-app/docs/upload-progress-architecture.md`。
  - 切到客户端直传 MinIO 后该文件可整段删除（`omniflow-go/docs/architecture/upload-direct-upload-migration.md`）。

## 代码规矩

1. 状态机必须保持纯函数，不得直接发请求。
2. 所有状态变化统一通过 `UploadTaskEvent` 驱动。
3. 非法状态流转必须抛错，避免静默失败。
4. UI 层只能调用 store/state-machine，不直接改任务对象。
5. Step 1 阶段不做后端依赖，不做断点续传协议。

## Step 2 扩展位

- 上传引擎仅消费状态机，不允许直接改任务对象字段。
- `UploadTaskInput.storageProvider` 是用户在上传确认 overlay 中选择的目标 provider 别名，只由上传执行器透传给后端，不进入状态机派生逻辑。
- 若未来支持断点续传，可新增 `sessionId/chunkIndex` 字段，但不破坏当前事件模型。
- `UploadTaskEvent.PROGRESS` 的数据来源对 UI 透明：当前由执行器混合 IPC 字节（首帧前兜底）和服务端轮询字节（首帧后接管），未来直传时切换为 XHR / S3 SDK 进度事件，事件契约不变。
