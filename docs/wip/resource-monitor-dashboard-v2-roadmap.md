# 资源监测仪表盘 V2 改进规划草案

更新时间：2026-05-12
状态：进行中（Phase 1 已落地，Phase 2 已落地）

> 本文是 `docs/wip/` 下的临时开发计划。V2 稳定后，应删除本文，并把最终结论回写到 `docs/resource-monitor-console.md`、`docs/frontend-validation-matrix.md`、后端 `docs/architecture/resource-monitor-console.md` 以及 API 契约相关文档。

## 1. 背景

当前资源监测控制台已经能展示资源分布、细分统计、探针状态和采样能力，但第一版存在几个明显问题：

- 统计口径把“基础文件类型”和“业务集合类型”混在一起，导致 ASMR、漫画等集合型资源容易被内部图片 / 视频文件掩盖。
- 细分统计依赖较重的递归聚合，页面打开时容易慢。
- 图表视觉偏重手写 CSS，饼图表达能力弱，分类稍多就难读。
- 探针可用性历史跟着页面组件生命周期走，离开资源监测页面再回来后历史丢失；这不符合“应用还在运行就持续监测”的直觉。

V2 的目标不是继续给当前页面堆功能，而是重新定义统计口径、采样生命周期和图表展示方式。

## 2. 总体目标

V2 要回答三类问题：

1. **磁盘上真实存了什么**
   - 视频、图片、音频、文本、压缩包、未知等基础文件类型。
   - 这一层按物理对象去重，回答真实占用。

2. **这些资源属于什么业务集合**
   - ASMR、漫画、视频合集、音频合集、普通文件、未分类等。
   - 内置类型是内容集合。只要文件被非 `DEF` 内置类型包裹，就归属该业务集合，而不是被内部基础文件类型顶掉。

3. **业务集合内部由哪些基础文件组成**
   - 例如 ASMR 内部视频占多少、图片占多少、音频占多少。
   - 这一层用交叉矩阵或堆叠图解释“ASMR 为什么看起来主要由视频 / 图片构成”。

## 3. 统计口径重构

### 3.1 维度拆分

V2 不再把所有分类塞进一个 `categories` 概念里，而是拆成：

| 维度 | 含义 | 示例 | 主要用途 |
| --- | --- | --- | --- |
| `fileTypes` | 基础文件类型 | video、image、audio、text、archive、unknown | 解释真实对象形态 |
| `collections` | 业务集合类型 | ASMR、COMIC、VIDEO、AUDIO、DEF、UNCLASSIFIED | 解释用户认知中的资源类别 |
| `collectionFileTypeMatrix` | 业务集合 x 基础文件类型 | ASMR + video、ASMR + image | 解释集合内部构成 |
| `libraries` | 资料库维度 | 当前用户资料库或指定资料库 | 解释资源分布位置 |
| `statuses` | 资源状态 | visible、recycle、orphan | 解释维护风险 |

### 3.2 业务集合归属

业务集合归属规则：

- 从 `node_files.node_id` 对应节点向上寻找非 `DEF` 内置类型祖先。
- 如果存在多个非 `DEF` 祖先，按最外层非 `DEF` 内置类型归属。
- 如果没有非 `DEF` 祖先，归属 `DEF`。
- 如果对象没有任何节点引用，归属 `UNCLASSIFIED`。
- 归档模式允许嵌套，但 V2 不使用 `archiveMode` 递归推导业务集合，避免重复统计和高成本树扫描。

### 3.3 基础文件类型归属

基础文件类型应优先来自稳定的文件身份体系，而不是只靠扩展名：

- 优先使用后端识别出的 MIME / probe / metadata 类型。
- 其次使用文件名扩展名。
- 无法识别时归入 `unknown`。
- `.ts` 这类冲突后缀必须能表达真实身份，例如 TypeScript 文件与 MPEG-TS 视频不能只靠后缀合并。

### 3.4 物理容量与引用容量

每个维度都需要明确两种容量：

- `physicalBytes`：按 distinct `storage_objects` 去重，表示真实磁盘占用。
- `referencedBytes`：按 `node_files` 引用展开，允许重复，表示业务结构中的使用量。

默认图表优先展示 `physicalBytes`，详情和 tooltip 展示 `referencedBytes`。

## 4. 探针生命周期重构

### 4.1 当前问题

当前探针可用性图谱由资源监测页面组件驱动：

- 打开页面后立即探测。
- 页面内每 5 分钟探测一次。
- 离开页面后组件卸载，探测停止。
- 再回来时内存态历史消失。

这会让“资源可用性监控”看起来像页面局部动画，而不是应用级监测能力。

### 4.2 V2 目标生命周期

探针采样应提升到应用进程生命周期：

- 应用登录后启动探针调度。
- 用户离开资源监测页面后仍继续按周期探测。
- 资源监测页面只负责订阅和展示当前内存态结果。
- 用户退出登录、切换账号或应用进程退出时清空当前账号的内存态探针历史。
- 不持久化到数据库，不写 localStorage；重启应用后为空。

### 4.3 推荐实现边界

前端：

- 新增资源监测运行时 store / service，例如 `resourceMonitorRuntime`。
- runtime 归属应用级状态，不归属 `ResourceMonitorWorkspace` 组件。
- runtime 维护：
  - 当前账号 / 会话绑定。
  - 每个 probe key 最近 60 次结果。
  - 最近一次刷新状态。
  - 5 分钟 interval。
  - 手动刷新入口。
- 页面组件只订阅 runtime 状态，不直接拥有 interval。
- 退出登录、释放仓库、切换账号时必须调用 runtime dispose。

后端：

- 保持 `/resource-monitor/probes` 为只读即时接口。
- 暂不新增探针持久化表。
- 探针错误继续脱敏，只返回状态、耗时、时间和错误摘要。

### 4.4 调度规则

默认规则：

- 登录后或 runtime 初始化后立即探测一次。
- 之后每 5 分钟探测一次。
- 每个 probe key 只保留最近 60 次。
- 页面打开时如果 runtime 已有数据，立即展示，不等待新请求。
- 页面打开时如果距离上次探测超过 5 分钟，可以触发一次即时刷新。
- 手动刷新复用同一 runtime，不新建页面局部状态。

## 5. 图表方案

### 5.1 图表库

优先采用 Semi 生态兼容的 VChart：

- 依赖：`@visactor/react-vchart`
- 原因：
  - Semi 官方数据可视化方案基于 VChart。
  - 支持现代图表、主题、tooltip、交互和动画。
  - 避免继续手写 CSS 饼图。

暂不建议继续把饼图作为主图。饼图只适合少量分类和粗略占比，资源监测的分类维度更适合条形、堆叠条形、矩阵和趋势图。

### 5.2 推荐展示结构

V2 页面建议从上到下：

1. **总览指标带**
   - 总物理占用、对象数、引用数、回收站占用、孤儿对象占用、不可用探针数。

2. **业务集合分布**
   - 横向条形图或 treemap。
   - 展示 ASMR、漫画、视频合集、音频合集、普通文件、未分类。
   - 默认按 `physicalBytes` 降序。

3. **集合内部构成**
   - 堆叠横向条形图。
   - 行：业务集合。
   - 段：基础文件类型。
   - 重点解释 ASMR 内部由图片、视频、音频等组成。

4. **基础文件类型分布**
   - 简洁 donut 或横向条形图。
   - 作为辅助视角，不压过业务集合。

5. **资料库排行**
   - 列表 + 小型堆叠条。
   - 展示每个资料库的业务集合构成或基础文件构成。

6. **探针可用性**
   - 保留竖向胶囊历史图。
   - 数据来源改成应用级 runtime。
   - 进入页面时应能看到离开期间累计的探测结果。

7. **诊断列表**
   - 未分类、孤儿对象、回收站长期占用、历史 provider、不可达存储等。

## 6. API 形态草案

V2 可以新增版本化或并行接口，避免破坏当前页面：

```text
GET /api/v1/resource-monitor/dashboard
GET /api/v1/resource-monitor/dashboard?libraryId=123
GET /api/v1/resource-monitor/probes
```

`dashboard` 返回建议结构：

```ts
type ResourceMonitorDashboard = {
  generatedAt: string;
  summary: ResourceMonitorDashboardSummary;
  fileTypes: ResourceMonitorDimensionRow[];
  collections: ResourceMonitorDimensionRow[];
  collectionFileTypeMatrix: ResourceMonitorMatrixRow[];
  libraries: ResourceMonitorLibraryRow[];
  statuses: ResourceMonitorStatusRow[];
  anomalies: ResourceMonitorAnomaly[];
  dashboardError?: string;
};
```

约束：

- `/dashboard` 只负责统计快照，不执行探针。
- `/probes` 继续独立加载，由应用级 runtime 调度。
- 旧 `/breakdown` 暂时保留，V2 验证稳定后再决定废弃或兼容映射。

## 7. 性能策略

短期：

- 页面打开优先展示已有 snapshot 或 loading skeleton。
- `/dashboard` 一次返回完整统计视图，避免前端拼多次重查询。
- SQL 仍可使用复杂聚合，但必须收敛在 repository 层。
- 对递归祖先查询加范围约束和深度限制。

中期：

- 后端增加内存缓存，按 actor + libraryId + 数据版本缓存 dashboard snapshot。
- 写入 / 删除 / 移动 / 回收站变化后主动失效缓存。
- 页面刷新拿缓存快照，后台异步重算。

长期：

- 维护节点有效业务集合归属，例如 effective built-in root 或 ancestor closure。
- 维护资源统计物化表或增量聚合表。
- 大型资料库不在页面请求链路上做全量递归扫描。

## 8. 分期计划

### Phase 1：V2 口径与 API 草案

- 固化 `fileTypes / collections / matrix` 三层统计口径。（已落地）
- 后端新增 dashboard DTO 和 repository 查询草案。（已落地：新增 `/resource-monitor/dashboard`）
- 前端新增类型定义，不替换现有页面。（已落地）
- 文档明确旧 `/breakdown` 与新 `/dashboard` 的关系。（已落地）
- 真实数据下的耗时和统计准确性仍需进入 V2 页面后继续验证。

### Phase 2：应用级探针 runtime

- 将探针历史从页面组件迁移到应用级 runtime。（已落地）
- 进入资源监测页时订阅 runtime。（已落地）
- 离开页面后继续 5 分钟一次探测。（已落地）
- 退出登录 / 切换账号 / 应用释放时清空 runtime。（已落地）
- 手动刷新复用 runtime。（已落地）
- 仍需手工验证：离开资源监测页面超过 5 分钟后返回，历史胶囊应继续累积。

### Phase 3：VChart 接入

- 引入 `@visactor/react-vchart`。
- 建立统一图表主题，适配 Semi 明暗主题。
- 先用 VChart 替换当前最弱的饼图 / 手写图。
- 保留当前数据卡和诊断列表，降低一次性改动风险。

### Phase 4：V2 仪表盘并行落地

- 新增 V2 dashboard 组件，与当前页面并行存在。
- 默认可通过内部开关切换或局部模块替换。
- 完成业务集合分布、集合内部构成、基础文件类型分布、资料库排行。
- 旧统计视图确认无回归后移除。

### Phase 5：性能收敛

- 评估真实数据下 `/dashboard` 耗时。
- 如果仍慢，优先做后端 snapshot cache。
- 再考虑 effective built-in root / closure / 物化统计表。
- 性能指标写入正式文档。

## 9. 验证方式

自动化：

- 后端 `GOCACHE=/tmp/go-build go test ./...`。
- 前端 `npm run lint`。
- 前端 `npm run build`。

手工验证：

- ASMR 内部包含视频 / 图片时，业务集合统计显示为 ASMR，不被视频顶掉。
- 基础文件类型统计仍能显示视频占用很高。
- 交叉矩阵能看出 ASMR 内部视频、图片、音频构成。
- 离开资源监测页面超过 5 分钟后返回，探针历史仍保留并新增采样点。
- 退出登录后重新登录，上一账号探针历史不会残留。
- 明暗主题下图表文字、legend、tooltip、颜色对比均可读。
- 大量分类时图表不使用难读饼图，长文本不溢出。

## 10. 明确不做

- V2 第一轮不做探针历史数据库持久化。
- V2 第一轮不做告警通知。
- V2 第一轮不做资源清理动作。
- V2 第一轮不删除旧 `/breakdown`，等新页面验证通过后再移除。
- 不为图表效果引入与 Semi 风格冲突的大型设计系统。
