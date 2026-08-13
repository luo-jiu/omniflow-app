# 传输中心前端架构

## 三 tab 容器

`/transfer-center` 是上传中心的扩展，三个 tab：

- **上传**（`UploadTab`）：沿用旧 upload-center 的 store / engine / 任务行模板
- **存储迁移**（`MigrationTab`）：5 s 轮询 `GET /api/v1/migration/tasks`，渲染任务列表
- **处理任务**（`ProcessingTab`）：占位，等转码 / 归档真实 executor 落地

入口路径：`#/transfer-center?tab=upload|migration|processing`

旧路由 `/upload-center` 重定向到 `/transfer-center?tab=upload`，保留书签 / 嗅探链路兼容。

## 模块边界

```
src/modules/transfer-center/
  services/migration.api.ts    # 迁移 6 端点的客户端封装
src/modules/upload-center/      # 上传引擎不动；保持原导出
src/views/transfer-center/
  index.tsx                    # tabs 容器
  tabs/UploadTab.tsx           # = 旧 upload-center 主体
  tabs/MigrationTab.tsx        # 迁移列表 + 5 s 轮询 + 取消
  tabs/ProcessingTab.tsx       # 占位
src/features/file-explorer/components/migration-dialog/  # 入队对话框
```

## 状态来源

| Tab | 数据源 | 更新机制 |
|---|---|---|
| 上传 | `UploadManager` store | `subscribe()` 320 ms 节流，事件驱动 |
| 迁移 | 后端 `GET /migration/tasks` | `setInterval(refresh, 5000)`，无事件推送 |
| 处理 | 暂无 | — |

迁移 tab 故意没有走 UploadManager engine —— 后端是单一真相源，前端只是渲染。如果将来加 SSE / WebSocket，仍然可以保留同样的 React state 形状（`MigrationTask[]`），只是把 setInterval 换成订阅。

## 入队链路

1. 文件树右键 → "迁移到其他存储..." → action `迁移到其他存储` 由 `directory-tree/index.tsx` 派发
2. `fetchProviders()` 拉 provider 列表
3. 打开 MigrationDialog：
   - 加载 `getStorageDistribution(libraryId, nodeId)` 显示当前分布
   - 选目标 provider（100% 已经在该 provider 上的项禁用）
   - 点击"开始迁移" → `enqueueMigration({libraryId, rootNodeId, targetProvider})`
4. 入队成功后 → `Toast.success` + 跳转 `#/transfer-center?tab=migration`
5. 迁移 tab 5 s 轮询会立刻拉到新任务

## API 契约

`migration.api.ts` 6 个函数对应后端 6 端点：

```
enqueueMigration(req, {dryRun?}) → EnqueueMigrationResult
listMigrationTasks({libraryId?, status?, limit?}) → MigrationTask[]
getMigrationTask(taskId) → MigrationTask
listMigrationTaskItems(taskId) → MigrationTaskItem[]
cancelMigrationTask(taskId, {dryRun?}) → void
getStorageDistribution(libraryId, nodeId) → StorageDistributionEntry[]
```

请求统一走 `electronAPI.fetch`（主进程，避免 CORS）；响应通过 `unwrapData` 统一解包 envelope（含 dryRun 嵌套层）。

## 不变约束（嗅探链路 0 改动）

- `UploadTaskInput` / `UploadManagerEvent` 形状不变
- `upload-center` 模块路径仍可用，传输中心是其扩展不是替换
- 嗅探 → 下载 → 资源库导入仍走 upload，不被迁移影响
- 旧 `/upload-center` 路由保留并重定向

## 依赖图

```
DirectoryTree (action: 迁移到其他存储)
  ↓ 打开
MigrationDialog
  ↓ 拉
getStorageDistribution / fetchProviders
  ↓ 提交
enqueueMigration
  ↓ 跳转
TransferCenter (tab=migration)
  → MigrationTab
    ↓ 5 s 轮询
    listMigrationTasks
    ↓ 用户取消
    cancelMigrationTask
```

## 已知 v2 候补

- WebSocket / SSE 实时进度（去掉 5 s 轮询）
- 任务详情 drawer（点击行展开 task items）
- 跨任务批量取消
- 处理任务 tab 真实落地
