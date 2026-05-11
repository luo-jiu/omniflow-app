# 资源监测控制台

更新时间：2026-05-11

适用范围：仓库页 / 资料库页 system workspace 中的资源监测入口、前端展示、后端快照 API 对接和后续探针扩展。

## 1. 概述

资源监测控制台用于观察 OmniFlow 当前用户可见资料库范围内的资源占用和物理存储分布；在资料库详情页打开时，会按当前 `libraryId` 收敛为单资料库快照。它不是存储配置页：存储配置负责增删改 provider，资源监测负责只读统计、诊断和后续探针展示。

当前已交付只读快照和只读探针：

- 总物理占用
- 对象数
- 文件引用数
- provider / bucket 分布
- 可见资源、回收站关联资源、孤儿对象占用细分
- 未匹配当前 provider 配置的历史位置提示
- 历史 provider 类型值提示，例如 `MINIO` 兼容映射到唯一 provider alias
- 对象存储、Postgres、Redis 的只读可用性探针
- 到存储设置、迁移任务、回收站的快捷跳转

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
```

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

统计口径：

- 不带 `libraryId` 时统计当前用户可见的全部资料库；带 `libraryId` 时只统计该用户拥有的指定资料库。
- `physicalBytes`：按 distinct `storage_objects` 聚合的真实对象容量。
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

## 5. 当前限制

- 不做自动刷新。
- 不做历史曲线。
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
- 快照加载成功时展示总览和分布表。
- 探针加载成功时展示对象存储、Postgres、Redis 状态、耗时和错误摘要。
- 诊断摘要展示可见资源、回收站关联资源、孤儿对象占用。
- 历史 provider 类型值行展示“历史”标记和兼容映射关系。
- 顶部“存储设置”可进入设置页存储分区，“迁移任务”可进入迁移中心存储迁移 tab。
- 资料库详情页中，资源监测请求携带当前 `libraryId`，回收站关联卡片的“回收站”可进入当前资料库 system workspace 回收站；仓库页入口下该按钮只提示先进入具体资料库，不直接打开回收站。
- 分布统计失败时分布表展示错误摘要，同时保留探针结果。
- 无资源对象时展示空态。
- API 失败时展示错误态和 Toast。
