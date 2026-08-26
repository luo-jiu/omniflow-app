# 捕捉资源输出边界

更新时间：2026-08-26

状态：生效的输出架构意图。本文定义捕捉或处理结果如何保存到本地、交给外部工具或进入资源库，不记录 Cat Catch 迁移完成度。

适用范围：内置浏览器的 MSE、HLS、DASH、直链资源、ffmpeg 处理结果、普通浏览器下载和资料库导入。

当前能力状态以 `docs/cat-catch-migration-audit.md` 与 `docs/cat-catch/capability-map.json` 为准；完整迁移、cutover 和旧代码删除合同以 `docs/cat-catch-full-migration-execution-plan.md` 为准。

## 1. 核心结论

- 与页面 session、MSE 或本地 ffmpeg 绑定的处理继续由 Electron main 承担；协议纯逻辑进入 `cat-catch-port`。
- 处理完成不等于用户交付完成。processing task 与 delivery task 必须是两段可追踪终态。
- 处理成品先进入 main-owned staged output lease。renderer 只看到 opaque lease ID、安全元数据和状态，不持有裸 `outputPath/tempPath`。
- 导入资源库继续复用现有 UploadManager；资源捕捉域不创建第二套上传队列、重试状态机或目录树写入逻辑。
- 本地保存、资料库导入和外部工具是不同 delivery adapter，共享 staged output 的所有权、配额、取消和清理合同。
- 普通浏览器下载有独立来源生命周期，但最终导入资源库仍复用 UploadManager，并遵守相同的 terminal/cleanup 语义。

## 2. 目标流向

```text
captured resource / manifest / page stream
  -> pure parser or planner
    -> main processing task
      -> staged output lease
        -> local-save delivery
        -> library delivery -> UploadManager
        -> approved external-tool delivery
          -> release or retain lease by terminal result
```

这里有三个不同事实 owner：

| 事实 | Owner |
| --- | --- |
| 下载、解密、merge、transcode 的执行与取消 | main processing task registry |
| 临时成品、路径、配额、TTL 和回收 | main staged output lease store |
| 资料库上传、重试、取消和节点创建 | UploadManager |

renderer 只编排用户选择并展示这三类 owner 的安全投影，不保存一份可独立推进的任务真相。

## 3. Processing Task

processing task 覆盖 HLS/DASH 下载、MSE 导出/合并、转码和其他会产生成品的长任务。至少具备：

- 稳定 task ID、输入摘要、阶段、进度和 terminal result。
- 一个统一 cancel handle，能停止 downloader、ffmpeg、文件写入和后续步骤。
- 导航、关闭 tab、窗口销毁、应用退出和崩溃恢复策略。
- 单任务与全局并发、内存、磁盘和输出大小预算。
- 失败时明确区分“未产生可交付成品”“产生可重试成品”和“终态不确定”。

processing 成功只表示生成了一个受管成品，不得提前向用户报告“已保存到资源库”。

## 4. Staged Output Lease

staged output lease 是 main 对临时成品的唯一持有方式。它至少记录：

- opaque lease ID 和 owner task ID。
- 安全文件元数据，例如建议文件名、大小、MIME 和可选校验摘要。
- main 私有的真实路径或 spool 位置。
- 创建时间、最后活动时间、TTL、占用预算和 terminal state。
- 当前 delivery claim；同一 lease 不得被并发重复交付。

必须满足：

- renderer、日志、普通 IPC result 和持久化偏好中不暴露真实路径。
- 未 claim、已取消、失败或过期 lease 由 main 回收。
- 正在上传或保存时活动会续期，不能被 TTL 中途删除。
- 应用正常退出清理可回收产物；近期崩溃残留在下次启动计入预算并按规则回收。
- commit 结果不确定时不自动重试成第二份文件，避免本地或资料库重复产物。

## 5. Delivery Adapter

### 5.1 保存到本地

main 根据用户明确选择的目标兑现 lease，将成品复制或移动到目标路径。只有复制/移动收口后才能释放 staging；用户取消保存不等于 processing 失败。

### 5.2 导入资源库

library delivery 通过受控 claim 把成品交给 UploadManager：

```text
lease claim
  -> UploadManager batch/task
    -> upload and node creation
      -> authoritative terminal result
        -> release or retain lease
```

边界规则：

- 目标 `libraryId`、parent node 和 storage provider 在 delivery 启动时冻结。
- 上传成功以 UploadManager/后端的权威节点结果为准，不以 processing 完成或 renderer toast 为准。
- 上传失败但明确未 commit 时，可保留 lease 供显式重试或本地保存。
- commit unknown、节点已创建或最终回执丢失时，不自动重新上传。
- 上传完成后的目录树刷新失败不改变已提交文件事实。

### 5.3 普通浏览器下载

`will-download` 产生的普通下载继续拥有独立的 download lifecycle。完成文件可通过受控 handoff 进入 UploadManager；失败、取消、来源 tab 关闭和过期临时文件必须有明确清理。它不能与捕捉处理成品共用一份 renderer-owned path 状态。

### 5.4 外部工具

外部工具只接收用户批准的 URL、headers 或 staged output claim。敏感 request context 留在 main，renderer 不负责拼接 Authorization/Cookie。外部进程也必须进入 task/cancel/exit owner，不能以 fire-and-forget 方式逃逸生命周期。

## 6. 大资源策略

- MSE：page runtime 使用有界 chunk 和背压增量交给 main spool，不把整段媒体长期保存在页面或一次性 base64 过 IPC。
- HLS/DASH：下载器和 ffmpeg 优先流式读取与写盘，保留 Range、retry、abort 和有序输出语义。
- 直链：避免把完整响应 materialize 到 renderer 或 main 的单个 Buffer；大响应必须受预算和取消控制。
- 资料库：UploadManager 根据既有合同选择普通或分片上传；资源捕捉层不依赖具体阈值复制上传策略。
- Pipeline：边处理边上传只能在 processing、lease 与 UploadManager 都有明确背压和 commit 合同后引入，不能绕过 staged output owner。

## 7. Cat Catch 迁移关系

本边界主要对应：

- `processing.main-task-registry`
- `output.processing-staged-terminal`
- `output.staged-output-lease`
- `output.application-workflow-coordinator`
- `output.library-delivery-handoff`
- `output.local-save-delivery`
- `output.normal-download-handoff`
- `output.ffmpeg-process-owner`
- `output.external-tools-dispatch`

旧 controller、hook 和工具页中的 output path 流程只能用于 characterization。迁移时先建立 task/lease/delivery 测试，再接入 adapter；`output-integration` unit 切换后，同一切片删除 renderer-owned path、旧 fallback、重复 listener 和无主临时目录 helper。

## 8. 验证

自动测试至少覆盖：

- processing 成功、失败、取消、超时和 app exit。
- lease 单次 claim、TTL 续期、预算、reaper 和崩溃残留。
- 本地保存成功/取消/复制失败，且 staging 释放时机正确。
- UploadManager 成功、明确未 commit、commit unknown、重试和目录刷新失败。
- renderer 卸载或工作区切换不丢 main task truth，也不重复交付。
- 输出 hash、容器结构或 ffprobe 结果与 expectation 一致。
- 路径、Cookie、Authorization、媒体 key 和内部 lease 信息不进入 renderer DTO 或日志。

真实资料库 smoke 只使用非第一个资料库；公司环境使用 macOS 本机 MinIO。手工 smoke 是自动行为、输出和清理测试的补充，不能替代它们。
