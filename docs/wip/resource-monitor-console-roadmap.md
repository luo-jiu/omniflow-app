# 资源监测控制台规划草案

更新时间：2026-05-11
状态：进行中（Phase 1-2 已落地，Phase 3 部分落地，Phase 4 待开发）

> 本文是 `docs/wip/` 下的临时开发计划。功能稳定后，应删除本文，并把最终契约回写到 `docs/library-detail-workspace.md`、`docs/frontend-validation-matrix.md`、后端 API 契约文档或对应长期专题文档。

## 1. 背景

多存储能力上线后，用户需要一个独立的观察入口来回答这些问题：

- 当前资源真实分布在哪些物理存储上。
- 哪个 provider / bucket 占用了多少对象和容量。
- 默认 provider、远程 MinIO、S3、本地 MinIO 等物理资源是否暂时可用。
- Postgres、Redis、未来 MySQL 等基础资源是否健康。
- 回收站、孤儿对象、历史 provider 类型值等长期维护风险在哪里。

这个能力不应塞进“存储设置”。存储设置负责配置，资源监测负责统计、诊断和观察。

## 2. 当前结论

- 前端入口放在仓库页左下角设置按钮旁边，使用监测类图标。
- 前端内容进入仓库页 / 资料库页现有 `system workspace` 宿主，不新增全屏路由。
- 后端新增独立资源监测能力，不混入 `StorageConfigHandler`。
- 第一阶段只做只读快照，不做自动告警、不做清理、不做迁移动作。
- 探针必须默认只读、无副作用；不能为了测试连通性创建 bucket 或写临时对象。

## 3. 核心概念

| 概念 | 含义 |
| --- | --- |
| `physicalBytes` | 按 distinct `storage_objects` 聚合的真实对象容量 |
| `objectCount` | distinct `storage_objects` 数量 |
| `fileRefCount` | `node_files` 引用数量，用于发现一对象多引用 |
| `provider` | `storage_objects.provider` 中记录的 provider alias；历史类型值只做兼容展示 |
| `bucket` | `storage_objects.bucket` 中记录的物理桶 |
| `visible` | 存在未删除节点引用的对象；对象有可见引用时优先归入此类 |
| `recycle` | 没有可见引用、但已删除节点仍引用的对象 |
| `orphan` | 没有任何 `node_files` 引用的对象 |

当前已交付 `objectCount / fileRefCount / physicalBytes`，并补充 `visible / recycle / orphan` 只读占用细分。

## 4. 目标形态

资源监测控制台最终包含四块：

1. **资源分布**
   - provider / bucket 表格
   - 总对象数、文件引用数、真实容量
   - 占比条和排序

2. **资源探针**
   - 对象存储 provider 连通性
   - Postgres 状态
   - Redis 状态
   - 未来 MySQL / 外部资源状态

3. **异常诊断**
   - 不可达 provider
   - 孤儿对象
   - 回收站长期占用
   - 历史 provider 类型值
   - bucket / endpoint 配置漂移

4. **长期监控**
   - 周期采样
   - 趋势曲线
   - 阈值提醒
   - 可选通知

## 5. 分期计划

### Phase 1：只读资源分布快照（已落地）

目标：先让用户看见“资源到底在哪”。

后端：

- 新增 `GET /api/v1/resource-monitor/snapshot`。
- 返回全部资料库范围的 provider / bucket 分布。
- 暂不做真实连通性 probe。
- 暂不做写操作和 `dry-run`。

前端：

- 仓库页左下角设置旁新增资源监测入口。
- 新增 `resource-monitor` system workspace。
- 展示总览卡片、provider 分布表和空态 / 加载 / 错误态。

验收：

- 入口可打开控制台。
- 无对象时显示空态。
- 有对象时按 provider / bucket 展示对象数、文件引用数和容量。

已回写正式文档：

- `docs/resource-monitor-console.md`
- `docs/library-detail-workspace.md`
- `docs/frontend-validation-matrix.md`
- 后端 `docs/architecture/resource-monitor-console.md`
- 后端 `docs/progress/go-api-contract-status.md`

### Phase 2：只读资源探针（已落地）

目标：判断物理资源是否可用。

- 对象存储 provider 增加无副作用 probe。
- Postgres 通过 repository 层 ping。
- Redis 通过独立 redis monitor repository ping。
- 前端展示状态、耗时、错误摘要和最后探测时间。
- 资源分布统计失败时仍返回 partial snapshot 和探针结果，错误摘要需要脱敏。

已回写正式文档：

- `docs/resource-monitor-console.md`
- `docs/frontend-validation-matrix.md`
- 后端 `docs/architecture/resource-monitor-console.md`
- 后端 `docs/progress/go-api-contract-status.md`

### Phase 3：占用细分和异常诊断（部分落地）

目标：让控制台能指出长期维护风险。

- 统计 visible / recycle / orphan。（已落地）
- 展示回收站占用。（已落地）
- 展示孤儿对象。（已落地）
- 标记历史 provider 类型值。（已落地）
- 和迁移任务、回收站、存储设置形成跳转关系。（已落地）
- 资料库详情页资源监测请求支持 `libraryId` 范围，保证回收站占用与当前资料库回收站跳转一致。（已落地）

已回写正式文档：

- `docs/resource-monitor-console.md`
- `docs/frontend-validation-matrix.md`
- 后端 `docs/architecture/resource-monitor-console.md`
- 后端 `docs/progress/go-api-contract-status.md`

### Phase 4：历史采样和告警

目标：从“当前快照”升级为“长期监控”。

- 增加采样存储。
- 支持趋势图。
- 支持阈值配置。
- 支持未来 MySQL / 外部资源探针配置。

## 6. 分层约束

后端：

- `transport/http` 只绑定请求和响应。
- `usecase` 负责编排快照、权限和 provider 配置补全。
- `domain/resourcemonitor` 放返回模型和端口。
- `repository/postgres/impl/resourcemonitor` 收敛统计查询。
- 任何 PG / Redis / 对象存储 SDK 操作都不能出现在 handler。

前端：

- `views/library` 只负责入口和 system view 激活。
- `features/system-workspace` 负责承载系统视图。
- `features/resource-monitor` 负责资源监测 UI、请求和格式化。
- 请求封装放在 feature service 内，不在页面里散落 URL。

## 7. 当前未做

- 不做自动刷新和历史曲线。
- 不做孤儿对象清理。
- 不做历史 provider 类型值自动修复。
- 不做 MySQL / 外部资源探针。
- 不做 CLI 命令，待控制台快照契约稳定后再决定是否补 `of resource-monitor snapshot --json`。

## 8. 验证方式

Phase 1 最低验证：

- 后端 `GOCACHE=/tmp/go-build go test ./...`。
- 前端 `npm run lint`。
- 前端 `npm run build`。
- 手工验证仓库页点击资源监测入口后打开右侧控制台。
- 手工验证刷新按钮、加载态、错误态和空态。
- 手工验证对象存储、Postgres、Redis 探针状态和错误摘要展示。
- 手工验证分布统计失败时探针面板仍展示。
- 手工验证可见资源、回收站关联、孤儿对象占用展示。
- 手工验证历史 provider 类型值标记展示。
- 手工验证资源监测到存储设置、迁移任务、当前资料库回收站的跳转关系；资料库详情页请求带 `libraryId`，仓库页入口不能在缺少 `libraryId` 时直接打开回收站。
