# 资源监测控制台

更新时间：2026-05-12

适用范围：仓库页 / 资料库页 system workspace 中的资源监测入口、前端展示、后端快照 API 对接和后续探针扩展。

## 1. 概述

资源监测控制台用于观察 OmniFlow 当前用户可见资料库范围内的资源占用和物理存储分布；在资料库详情页打开时，会按当前 `libraryId` 收敛为单资料库快照。它不是存储配置页：存储配置负责增删改 provider，资源监测负责只读统计、诊断和后续探针展示。

当前已交付只读快照和只读探针：

- 总物理占用
- 对象数
- 文件引用数
- provider / bucket 分布
- 按资料库、归档分类和资源状态拆分的细分仪表盘
- 可见资源、回收站关联资源、孤儿对象占用细分
- 未匹配当前 provider 配置的历史位置提示
- 历史 provider 类型值提示，例如 `MINIO` 兼容映射到唯一 provider alias
- 对象存储、Postgres、Redis 的只读可用性探针
- 探针可用性图谱：前端打开面板后立即探测一次，之后每 5 分钟自动探测，内存中只保留最近 60 次，不持久化，重启后清空
- 到存储设置、迁移任务、回收站的快捷跳转
- 用户显式触发的历史样本记录

## 2. 入口

当前入口：

- 仓库页左下角设置按钮旁边的资源监测按钮。
- system workspace overview 中的“资源监测”卡片。

当前不新增 legacy 全屏路由。后续新增主入口仍应优先进入 system workspace，不应扩展独立全屏页面。

## 3. 前端边界

实现位置：

- 入口：`src/views/library/components/quick-access-sidebar/index.tsx`
- system view 注册：`src/features/system-workspace/registry.tsx`
- 页面组件：`src/features/resource-monitor/components/ResourceMonitorWorkspace.tsx`
- 请求封装：`src/features/resource-monitor/services/resource-monitor.api.ts`

职责规则：

- `views/library` 只负责打开 `resource-monitor` system view。
- `features/system-workspace` 只负责 system view 的宿主和注册。
- `features/resource-monitor` 负责资源监测自己的请求、格式化、加载态、错误态和展示。
- 资源监测只能跳转到已有管理入口：存储配置进入 system workspace 设置页的存储分区，资料库详情页内的回收站关联进入当前资料库 system workspace 回收站，迁移任务进入迁移中心 `migration` tab。
- 页面层不得直接拼 `/v1/resource-monitor/snapshot`。

## 4. API 契约

当前使用：

```text
GET /api/v1/resource-monitor/snapshot
GET /api/v1/resource-monitor/snapshot?libraryId=123
GET /api/v1/resource-monitor/distribution
GET /api/v1/resource-monitor/distribution?libraryId=123
GET /api/v1/resource-monitor/breakdown
GET /api/v1/resource-monitor/breakdown?libraryId=123
GET /api/v1/resource-monitor/probes
POST /api/v1/resource-monitor/samples
POST /api/v1/resource-monitor/samples?libraryId=123
POST /api/v1/resource-monitor/samples?libraryId=123&dryRun=true
```

前端展示默认并行请求 `/distribution`、`/breakdown` 和 `/probes`，让资源分布、细分仪表盘和资源探针独立加载、独立错误、谁先返回谁先展示。`/snapshot` 继续保留为兼容聚合接口，并作为采样写链路内部生成完整快照的语义参考。

响应 `data`：

```ts
type ResourceMonitorSnapshot = {
  generatedAt: string;
  summary: {
    providerCount: number;
    bucketCount: number;
    objectCount: number;
    fileRefCount: number;
    physicalBytes: number;
    visibleObjectCount: number;
    visibleFileRefCount: number;
    visibleBytes: number;
    recycleObjectCount: number;
    recycleFileRefCount: number;
    recycleBytes: number;
    orphanObjectCount: number;
    orphanBytes: number;
    unmatchedCount: number;
    legacyProviderCount: number;
  };
  storage: Array<{
    provider: string;
    sourceProvider?: string;
    providerType?: string;
    providerLabel?: string;
    endpoint?: string;
    bucket: string;
    isDefault: boolean;
    isLegacyProvider: boolean;
    objectCount: number;
    fileRefCount: number;
    physicalBytes: number;
    visibleObjectCount: number;
    visibleFileRefCount: number;
    visibleBytes: number;
    recycleObjectCount: number;
    recycleFileRefCount: number;
    recycleBytes: number;
    orphanObjectCount: number;
    orphanBytes: number;
    percent: number;
    matchedConfig: boolean;
  }>;
  distributionError?: string;
  probeSummary: {
    total: number;
    ok: number;
    error: number;
    unknown: number;
  };
  probes: Array<{
    key: string;
    kind: 'object_storage' | 'postgres' | 'redis' | string;
    label: string;
    provider?: string;
    providerType?: string;
    endpoint?: string;
    bucket?: string;
    isDefault?: boolean;
    status: 'ok' | 'error' | 'unknown';
    latencyMs: number;
    error?: string;
    checkedAt: string;
  }>;
};
```

`GET /breakdown` 返回 `ResourceMonitorBreakdown`：

```ts
type ResourceMonitorBreakdown = {
  generatedAt: string;
  summary: {
    libraryCount: number;
    archiveDirectoryCount: number;
    physicalBytes: number;
    referencedBytes: number;
    objectCount: number;
    fileRefCount: number;
    visibleObjectCount: number;
    visibleFileRefCount: number;
    visibleBytes: number;
    recycleObjectCount: number;
    recycleFileRefCount: number;
    recycleBytes: number;
    orphanObjectCount: number;
    orphanBytes: number;
    multiRefObjectCount: number;
    multiRefPhysicalBytes: number;
  };
  libraries: Array<{
    libraryId: number;
    libraryName: string;
    physicalBytes: number;
    referencedBytes: number;
    objectCount: number;
    fileRefCount: number;
    archiveDirectoryCount: number;
    visibleBytes: number;
    recycleBytes: number;
    orphanBytes: number;
    topProvider?: string;
    topBucket?: string;
    percent: number;
  }>;
  categories: Array<{
    key: 'DEF' | 'COMIC' | 'ASMR' | 'VIDEO' | 'AUDIO' | 'UNKNOWN' | 'UNCLASSIFIED' | string;
    label: string;
    builtInType?: string;
    physicalBytes: number;
    referencedBytes: number;
    objectCount: number;
    fileRefCount: number;
    archiveDirectoryCount: number;
    visibleBytes: number;
    recycleBytes: number;
    orphanBytes: number;
    percent: number;
  }>;
  statuses: Array<{
    key: 'visible' | 'recycle' | 'orphan' | string;
    label: string;
    physicalBytes: number;
    objectCount: number;
    fileRefCount: number;
    percent: number;
  }>;
  anomalies: Array<{
    key: string;
    severity: 'info' | 'warning' | 'danger' | string;
    title: string;
    message: string;
    libraryId?: number;
    provider?: string;
    bucket?: string;
    physicalBytes?: number;
    objectCount?: number;
  }>;
  breakdownError?: string;
};
```

`POST /samples` 返回 `ResourceMonitorSample`，用于确认样本已写入：

```ts
type ResourceMonitorSample = {
  id: number;
  dryRun: boolean;
  actorId: string;
  scope: 'global' | 'library' | string;
  libraryId: number;
  generatedAt: string;
  physicalBytes: number;
  objectCount: number;
  fileRefCount: number;
  recycleBytes: number;
  orphanBytes: number;
  probeTotal: number;
  probeOk: number;
  probeError: number;
  createdAt: string;
};
```

统计口径：

- 不带 `libraryId` 时统计当前用户可见的全部资料库；带 `libraryId` 时只统计该用户拥有的指定资料库。
- `physicalBytes`：按 distinct `storage_objects` 聚合的真实对象容量。
- `referencedBytes`：按 `node_files` 引用展开后的容量，可能重复，用于解释一个对象被多处业务结构使用。
- `objectCount`：distinct `storage_objects` 数量。
- `fileRefCount`：`node_files` 引用数量。
- `visible*`：存在未删除节点引用的对象及其文件引用数 / 容量；对象有可见引用时优先归入此类。
- `recycle*`：没有可见引用、但存在已删除节点引用的对象及其文件引用数 / 容量。
- `orphan*`：没有任何 `node_files` 引用的对象及其容量。
- `unmatchedCount`：没有匹配到当前 provider 配置的 provider / bucket 行数。
- `legacyProviderCount`：仍使用历史 provider 类型值、但已兼容映射到唯一 alias 的存储位置数。
- `sourceProvider` / `isLegacyProvider`：展示历史 provider 类型值与当前 alias 的兼容关系。
- `distributionError`：资源分布统计失败时的脱敏错误摘要；此时探针仍可正常返回。
- `probeSummary`：当前快照内探针数量和状态汇总。
- `probes`：只读探针结果；对象存储探针只检查 bucket 可访问性，不创建 bucket 或写入对象。
- `dryRun`：采样写链路支持的标准 dry-run 参数；返回样本预览但不持久化。
- `/distribution` 只返回分布相关字段；`/probes` 只返回探针相关字段；两者都沿用同一 `ResourceMonitorSnapshot` 外形，未加载的分区保持空 summary / 空数组。
- `/breakdown` 只返回细分仪表盘字段；`libraries / categories / statuses / anomalies` 分别对应资料库排行、归档分类、资源状态和只读诊断摘要。

## 5. 当前限制

- 不做资源分布自动刷新；资源探针会在前端打开面板后每 5 分钟自动探测一次。
- 探针历史只保留在当前 renderer 内存中，每个探针最多 60 次；不写 localStorage，不写后端，应用重启后清空。
- 不做历史曲线；当前只支持用户点击“记录样本”写入单次历史样本。
- 不提供清理、迁移或修复动作。
- 只提供到存储设置、迁移任务、当前资料库回收站的跳转，不在资源监测内直接执行变更；仓库页没有具体 `libraryId` 时点击回收站会提示先进入具体资料库。
- 暂不做 MySQL / 外部资源探针。

## 6. 验证方式

常规验证：

- `npm run lint`
- `npm run build`

手工验证：

- 仓库页左下角点击资源监测入口，右侧进入资源监测 system view。
- system overview 中点击资源监测卡片可进入同一视图。
- 分布加载成功时展示总览和分布表；细分仪表盘和探针加载成功后分别展示资源拆分、对象存储、Postgres、Redis 状态、耗时和错误摘要，三者不互相等待。
- 细分仪表盘加载成功时展示关键指标块、可按资料库 / 归档分类 / 物理存储 / 资源状态切换的资源组成主图、资料库排行、归档分类和诊断摘要；失败时只在仪表盘区展示错误，不阻塞分布和探针。
- 探针可用性图谱每 5 分钟自动追加一次历史；绿色竖胶囊表示可用，红色竖胶囊表示异常，并展示最近一次错误或服务信息。
- 诊断摘要展示可见资源、回收站关联资源、孤儿对象占用。
- 历史 provider 类型值行展示“历史”标记和兼容映射关系。
- 顶部“存储设置”可进入设置页存储分区，“迁移任务”可进入迁移中心存储迁移 tab。
- 点击“记录样本”可写入一条历史采样并显示样本 ID；资料库详情页样本携带当前 `libraryId`，仓库页样本为全局范围；采样 API 支持 `dryRun=true`。
- 资料库详情页中，分布统计和采样请求携带当前 `libraryId`；`/probes` 是 provider / 基础设施级只读探针，不按资料库过滤。回收站关联卡片的“回收站”可进入当前资料库 system workspace 回收站；仓库页入口下该按钮只提示先进入具体资料库，不直接打开回收站。
- 分布统计失败时分布表展示错误摘要，同时保留探针结果。
- 无资源对象时展示空态。
- API 失败时展示错误态和 Toast。
