# 资源监测细分仪表盘规划草案

更新时间：2026-05-12
状态：进行中（Phase A 已落地，Phase B 首版已落地，主图维度切换已落地）

> 本文是 `docs/wip/` 下的临时开发计划。功能稳定后，应删除本文，并把最终契约回写到 `docs/resource-monitor-console.md`、`docs/frontend-validation-matrix.md`、后端 `docs/architecture/resource-monitor-console.md` 和对应 API 契约文档。

## 1. 背景

当前资源监测已经能回答：

- 当前资源总量是多少。
- 资源分布在哪些 provider / bucket。
- 可见资源、回收站关联资源、孤儿对象分别占多少。
- 物理资源和基础设施探针是否可用。

下一阶段要把它升级成更细致的资源仪表盘，让用户可以继续回答：

- 哪个资料库最占空间。
- 哪类归档占空间最多。
- 漫画、ASMR、视频、音频、普通目录的资源结构分别如何。
- 回收站和孤儿对象主要来自哪里。
- 同一个物理对象是否被多个文件引用，导致“引用占用”和“真实占用”看起来不一致。

这个能力不是存储设置，也不是文件管理器的替代品。它只负责观察、诊断和趋势展示，不直接做清理、迁移或批量编辑。

## 2. 目标体验

界面目标是“资源控制台”，不是“后台表格页”。可以比当前页面更花哨，但花哨服务于信息密度：

- 顶部是高识别度标题栏和时间戳，类似流量统计面板。
- 第一屏直接展示关键指标和主图，不要求用户先读表。
- 图表、指标块、状态胶囊、热力条一起出现，但每个元素都必须能解释一个资源事实。
- 暗色主题下可以有更强的霓虹线、局部光感和高对比色块；亮色主题下要收敛为清晰的浅色仪表盘，不能靠低对比灰色占位。
- 页面仍是桌面工具，不做营销式 hero，不做大面积装饰背景，不放无意义漂浮图形。

## 3. 信息架构

### 3.1 顶部总览带

放在页面最上方，约等于“总控台”：

| 指标 | 含义 | 视觉建议 |
| --- | --- | --- |
| 物理占用 | distinct `storage_objects` 的真实容量 | 主指标块，橙 / 金强调 |
| 对象数 | distinct 物理对象数量 | 冷色指标块 |
| 文件引用 | `node_files` 引用数量 | 蓝色指标块 |
| 资料库数 | 当前范围内有资源的资料库数量 | 青绿色指标块 |
| 归档目录 | `archiveMode = 1` 的目录数量 | 紫 / 品红指标块 |
| 回收站 + 孤儿 | 长期维护风险容量 | 红 / 琥珀警示块 |

视觉上可以参考用户提供的流量统计面板：

- 每个指标块左侧使用图标圆形底。
- 主数值使用更重字重。
- 次级单位和说明保持小字号。
- 色块不要整块强饱和，使用带透明度的面板底色和高对比图标色。

### 3.2 主图区域

主图是仪表盘的视觉中心，用来展示“当前资源组成”。

第一版先做当前快照，不依赖历史采样：

- 左侧大图：资源组成堆叠条 / 横向流图。
- 右侧小图：状态占比环 / donut，展示可见、回收站、孤儿。
- 图上方提供维度切换：
  - 按资料库
  - 按归档分类
  - 按物理存储
  - 按资源状态

后续有历史采样后，主图可升级为时间趋势：

- 物理占用趋势线。
- 回收站占用趋势线。
- 孤儿对象趋势线。
- 新增对象 / 删除对象的柱线混合图。

### 3.3 资料库分布

展示每个资料库的资源占用。

字段建议：

- 资料库名称
- 物理占用
- 对象数
- 文件引用数
- 归档目录数
- 可见 / 回收站 / 孤儿占比
- 最大 provider / bucket

排序规则：

1. `physicalBytes` 降序。
2. `objectCount` 降序。
3. `libraryName` 升序。

视觉建议：

- 不用传统完整表格作为第一呈现，可以做成紧凑排行列表。
- 每行左侧是资料库名称和资源 meta，右侧是容量和占比条。
- 前 3 名可以有更明显的 rank 样式，但不能挤占内容宽度。

### 3.4 归档分类分布

以 `builtInType + archiveMode` 为核心统计维度。

第一版分类：

| 分类 key | 展示名 | 口径 |
| --- | --- | --- |
| `DEF` | 普通资源 | `builtInType = DEF` 或空值 |
| `COMIC` | 漫画 | `builtInType = COMIC` |
| `ASMR` | ASMR | `builtInType = ASMR` |
| `VIDEO` | 视频 | `builtInType = VIDEO` |
| `AUDIO` | 音频 | `builtInType = AUDIO` |
| `UNKNOWN` | 未知类型 | 其它非空 `builtInType` |
| `UNCLASSIFIED` | 未归类对象 | 没有任何节点引用的孤儿对象 |

每个分类继续拆：

- 普通目录 / 文件引用：`archiveMode = 0`
- 归档目录引用：`archiveMode = 1`
- 回收站引用
- 孤儿对象

视觉建议：

- 用彩色分类卡 + 小型堆叠条。
- 每类卡片显示容量、对象数、引用数、归档目录数。
- 类别图标可以复用目录树内置类型图标语义，避免资源监测和目录树给出两套视觉语言。

### 3.5 物理存储分布

保留当前 provider / bucket 视角，但升级成更像控制台：

- provider / bucket 列表仍保留。
- 顶部增加 provider 占比雷达 / 条带。
- 每个位置展示：
  - 物理占用
  - 对象数
  - 可见 / 回收站 / 孤儿
  - 是否默认
  - 是否历史 provider
  - 探针最近状态

资源探针图谱继续保留，但和存储分布可以建立视觉连接：同一个 provider 的状态点颜色和探针胶囊颜色一致。

### 3.6 异常诊断

异常诊断不做成弹窗，而是常驻右侧或下方模块。

第一版规则：

- 回收站占用最大的资料库 Top 5。
- 孤儿对象最多的资料库 Top 5。
- 历史 provider / 未匹配 provider 列表。
- 不可达对象存储 provider。
- 多引用比例异常高的资料库或分类。

诊断项只读展示，不在这里做修复按钮。可以提供跳转：

- 存储设置
- 迁移任务
- 当前资料库回收站

## 4. 统计口径

### 4.1 两套容量必须分清

| 字段 | 含义 | 是否可能重复 |
| --- | --- | --- |
| `physicalBytes` | 按 distinct `storage_objects` 聚合的真实对象容量 | 不重复 |
| `referencedBytes` | 按 `node_files` 引用展开后的容量 | 可能重复 |

仪表盘默认大数字使用 `physicalBytes`。当展示资料库 / 分类明细时，可以同时展示 `referencedBytes`，但必须标注“引用展开”。

原因：

- 一个物理对象可能被多个 `node_files` 引用。
- 如果按引用展开统计，容量可能大于真实物理占用。
- 这不是错误，而是不同问题的答案：真实占用回答“磁盘 / 对象存储吃了多少”，引用占用回答“内容被哪些业务结构使用”。

### 4.2 可见、回收站、孤儿

沿用当前资源监测口径：

- `visible`：对象存在至少一个未删除节点引用；对象有可见引用时优先归入可见。
- `recycle`：对象没有可见引用，但存在已删除节点引用。
- `orphan`：对象没有任何 `node_files` 引用。

对象级状态只能有一个主归属：

1. 有可见引用则归 `visible`。
2. 无可见引用但有删除引用则归 `recycle`。
3. 无任何引用则归 `orphan`。

引用级统计可以额外展示 visible / recycle 引用数，但不能反向覆盖对象级主归属。

### 4.3 资料库口径

资料库维度以 `storage_objects.library_id` 为准，关联 `libraries` 读取名称和用户权限。

- 不带 `libraryId`：统计当前用户拥有的全部未删除资料库。
- 带 `libraryId`：只统计该资料库，且必须校验属于当前用户。
- 已删除资料库不进入统计。

### 4.4 归档分类口径

归档分类来自 `nodes.built_in_type` 和 `nodes.archive_mode`。

对象可能有多个节点引用，分类归属需要明确：

- `categoryReferencedBytes`：按引用展开，直接按每个引用节点的 `builtInType / archiveMode` 分组。
- `categoryPhysicalBytes`：按对象去重后选择主分类，避免重复算真实容量。

主分类选择规则建议：

1. 优先可见节点引用。
2. 优先 `archiveMode = 1` 的归档目录引用。
3. 优先非 `DEF` 内置类型。
4. 多个候选仍并列时，按 `node.id` 最小值稳定选择。

这条规则只用于 `categoryPhysicalBytes`，并且前端应在说明或 tooltip 里标明“物理容量按主分类归属去重”。

### 4.5 归档目录数量

归档目录数量以 `nodes.node_type = folder` 且 `archive_mode = true` 为准。

只统计当前范围内未删除节点。带 `libraryId` 时只统计当前资料库。

## 5. API 草案

新增独立接口，不继续把 `/distribution` 塞胖：

```text
GET /api/v1/resource-monitor/breakdown
GET /api/v1/resource-monitor/breakdown?libraryId=123
```

响应外形草案：

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
    visibleBytes: number;
    recycleBytes: number;
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
    key: 'visible' | 'recycle' | 'orphan';
    label: string;
    physicalBytes: number;
    objectCount: number;
    fileRefCount: number;
    percent: number;
  }>;
  anomalies: Array<{
    key: string;
    severity: 'info' | 'warning' | 'danger';
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

接口边界：

- `/breakdown` 只返回细分统计，不返回探针历史。
- `/distribution` 继续负责 provider / bucket 明细。
- `/probes` 继续负责连通性探针。
- 前端仍并行加载，让总览、探针、细分统计谁先回来谁先显示。

## 6. 后端实现计划

### Phase A：领域模型和端口

- 在 `internal/domain/resourcemonitor` 增加 breakdown DTO。
- 在资源监测 repository port 增加 breakdown 读取方法。
- usecase 增加 `Breakdown(ctx, principal, options...)`。
- handler / router 增加 `GET /resource-monitor/breakdown`。
- 当前已落地。

### Phase B：仓储统计

仓储实现保持在 `internal/repository/postgres/impl/resourcemonitor`。

规则：

- 能用 GORM / gen 表达的简单查询优先使用生成代码。
- 复杂聚合可以使用 raw SQL，但必须集中在 `*_sql.go`，并用参数占位符。
- 不在 handler / usecase 写 SQL。
- 不新增表结构；第一版只读统计，不需要迁移。

建议拆分：

- library breakdown 查询。
- category breakdown 查询。
- archive directory count 查询。
- anomaly 查询可以先在 usecase 根据 breakdown 结果生成，避免第一版 SQL 过重。
- 当前已落地第一版：资料库、分类、归档目录、多引用对象和 visible / recycle / orphan 统计；诊断摘要由 usecase 基于统计结果生成。

### Phase C：测试

至少覆盖：

- 不带 `libraryId` 时只统计当前用户资料库。
- 带 `libraryId` 时做用户归属校验。
- 物理容量不因多引用重复。
- 引用展开容量可以反映多引用。
- `DEF / COMIC / ASMR / VIDEO / AUDIO / UNKNOWN / UNCLASSIFIED` 分类稳定。
- `visible / recycle / orphan` 主归属符合当前资源监测口径。

## 7. 前端实现计划

### Phase A：请求和状态拆分

- 在 `resource-monitor.api.ts` 增加 `fetchResourceMonitorBreakdown`。
- `ResourceMonitorWorkspace` 新增 breakdown loading / error / snapshot。
- 和 distribution / probes 并行加载，互不阻塞。
- 仍保留刷新按钮一次刷新全部分区。
- 当前已落地。

### Phase B：仪表盘组件拆分

建议新增组件：

- `ResourceDashboardHeroPanel`
- `ResourceMetricTile`
- `ResourceCompositionChart`
- `ResourceLibraryRankPanel`
- `ResourceCategoryBreakdownPanel`
- `ResourceAnomalyPanel`

不要继续把所有 JSX 堆进 `ResourceMonitorWorkspace`。页面组件只负责数据加载和区块编排。

当前已落地 `ResourceBreakdownDashboard` 首版组件：先集中承接指标块、组成图、资料库排行、分类条和诊断摘要；组成图已支持资料库、归档分类、物理存储和资源状态四个维度切换，并使用真实容量条带和状态 donut 展示当前快照。后续视觉继续复杂化时再按区块继续拆分。

### Phase C：视觉语言

仪表盘可以更花哨：

- 暗色主题使用深色面板、亮色线图、局部高亮边框。
- 指标块用多色 accent：橙、蓝、青绿、紫、红，避免整个页面单一蓝紫。
- 主图可以使用 SVG / CSS 实现轻量图表，第一版不引入大型图表库；如果后续趋势图复杂，再评估 chart 库。
- 图表 hover tooltip 必须说明口径，例如“物理去重”或“引用展开”。
- 视觉装饰必须附着在信息元素上，例如图线、刻度、状态点、容量条，不做纯装饰背景。

亮暗主题要求：

- 暗色下灰色占位、网格线、卡片边界要有足够对比。
- 亮色下彩色块降低透明度，保证文字优先。
- 不用负 letter-spacing，不随 viewport 缩放字体。
- 关键数字和单位不能拥挤或溢出。

### Phase D：空态和错误态

- breakdown 未返回时，不阻塞已有分布和探针展示。
- breakdown 失败时，只在细分仪表盘区展示错误摘要和重试入口。
- 没有资源时展示空仪表盘，不展示“0 值表格海”。
- 数据特别少时，主图仍保留结构，用空占位条提示当前无足够分布。

## 8. 验证方式

后端：

```bash
GOCACHE=/tmp/go-build go test ./...
```

前端：

```bash
npm run lint
npm run build
```

手工验证：

- 仓库页打开资源监测，细分仪表盘先/后加载都不影响现有分布和探针。
- 资料库详情页打开资源监测，breakdown 请求携带当前 `libraryId`。
- 多个资料库时，资料库排行顺序稳定。
- `COMIC / ASMR / VIDEO / AUDIO / DEF` 分类展示稳定。
- 物理占用与引用占用不会被混成一个数字。
- 回收站 / 孤儿异常诊断能指出来源。
- 暗色和亮色主题下，指标块、图表、灰色占位、错误态均可读。

## 9. 当前不做

- 不做后台自动采样。
- 不做持久化趋势图。
- 不做资源清理按钮。
- 不做跨用户全局统计。
- 不做真实数据库外的外部 BI 面板。
- 不在第一版接入大型图表库，除非手写图表明显拖慢开发或可维护性。
