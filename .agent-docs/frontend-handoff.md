# OmniFlow App 前端交接索引

更新时间：2026-09-23

适用对象：继续维护 `omniflow-app` 前端、Electron 主进程、IPC、桌面交互和前端文档的开发者或 Coding Agent。

## 1. 当前结论

`omniflow-app` 是桌面工作区，不是普通网页。后续维护优先守住这 4 件事：

- 用户黑盒行为稳定
- API / IPC 契约稳定
- 状态 owner 单一
- Electron 宿主边界清楚

具体规则以 `AGENTS.md`、review 标准和专题文档为准。本文件只做索引，不重复正文。

## 2. 阅读顺序

开始动前端代码前，按下面顺序读：

1. `AGENTS.md`
2. `.agent-docs/frontend-review-standard.md`
3. `.agent-docs/frontend-documentation-standard.md`
4. `docs/frontend-architecture-baseline.md`
5. 按需补读专题：
   - `docs/current-deployment-topology.md`（云端、Tailscale、MinIO、打包或发布相关任务）
   - `docs/local-macos-signing-and-release.md`（个人签名、bootstrap、证书恢复与 macOS 发布）
   - `docs/embedded-browser-architecture.md`
   - `docs/library-detail-workspace.md`
   - `docs/built-in-agent-architecture.md`（Agent 执行、持久化、IPC 和安全事实）
   - `docs/built-in-agent-shell-architecture.md`（Agent raw Shell 的权限、平台、工作区、日志和文件桥契约；macOS Zsh 三权限模式、终态日志分页、本机及资料库文件桥已进入开发预览，Linux / Windows 与持久规则仍 fail-closed）
   - `docs/built-in-agent-ui-contract.md`（Agent 工作区、状态投影和受控交互）
   - `docs/file-explorer-file-viewer-boundary.md`
   - `docs/built-in-type-and-archive-mode.md`
   - `docs/file-viewer-and-archive-viewer-map.md`
   - `docs/viewers/README.md`
   - `docs/frontend-validation-matrix.md`
   - `docs/cat-catch-full-migration-execution-plan.md`
   - `docs/cat-catch-migration-audit.md`

## 3. 入口地图

- 应用入口：`src/main.tsx`
- 根组件：`src/App.tsx`
- 路由：`src/router/`
- 页面：`src/views/`
- 业务域：`src/features/`
- 通用组件：`src/components/`
- 全局上下文：`src/contexts/`
- 请求封装：`src/service/request/`
- 上传中心：`src/modules/upload-center/`
- Electron preload：`electron/preload.ts`
- Electron 主进程能力：`electron/service/`
- Electron 平台策略：`electron/platform/`
- Renderer 平台入口：`src/platform/`

## 4. 当前重点专题

- 总体分层、状态 owner、IPC / Electron 边界：
  - `docs/frontend-architecture-baseline.md`
- 插件系统与主题扩展的长期方针、阶段路线和合格标准：
  - [插件系统与主题扩展方针](../docs/plugin-system-and-theming-policy.md)（目标设计，非当前已实现能力）
  - [插件化实施计划](../docs/plugin-system-implementation-plan.md)（代码调研、批次依赖、兼容与验收；A0 macOS 基础基线已收口，见 [基线记录](../docs/plugin-system-a0-baseline.md)）
  - [A1 外观契约与纯解析](../docs/plugin-system-a1-color-contract.md)（历史 macOS A1 已验收；紫罗兰和新增主题接线的本轮状态见 [外观系统](../docs/appearance-system.md)，不复用历史结论）
- 内置命令、目录菜单和工具贡献注册及排序兼容：
  - [B1 贡献入口](../docs/plugin-system-b1-contributions.md)（内置贡献范围已验收）
- 查看器贡献、打开方式和恢复 key 兼容：
  - [B2 查看器状态恢复标识](../docs/plugin-system-b2-viewers.md)（已验收）
- 独立 SDK、资源授权 broker、开发加载与隔离证据：
  - [C1 SDK 与隔离实验](../docs/plugin-system-c1-sdk-isolation.md)（自动与 macOS 原生交互验收通过；后续本地安装状态见 D1）
- 第一方独立 CSV、真实资源授权和 B2 阅读恢复：
  - [C2 CSV 完整链路](../docs/plugin-system-c2-csv-viewer.md)（macOS 已验收；宿主 preload 改为 CJS，开发启动不再带 `--no-sandbox`）
- 本地 ZIP 安装、插件管理、启停/权限、版本回滚与安全恢复：
  - [D1 管理与恢复](../docs/plugin-system-d1-management.md)（macOS 已验证；设置按包指纹持久化、session 清理复用；后续独立开发见 D2）
- 第二功能与可移交开发模板：
  - [D2 独立开发交付](../docs/plugin-system-d2-external-development.md)（JSON 树、仓库外离线构建与开发包已验证；A0～D2 macOS 只读技术链路收口）
- 插件 Tool 的独立协议、共享沙箱及 main-only 调用能力：
  - [AT0 Tool 运行时](../docs/plugin-system-at0-tool-runtime.md)（macOS 隔离实验及旧 Viewer 回归通过；[AT1](../docs/plugin-system-at1-agent-tools.md)已完成 macOS 核心范围验收：真实 gpt-5.5 在 win 资料库读取并查询 CSV，无需打开 Viewer，授权、结果与插件来源审计可见；故障闭环见 AT2）
- 插件故障隔离、单终态和库工作区退出清理：
  - [AT2 故障恢复](../docs/plugin-system-at2-fault-recovery.md)（macOS 开发环境既定范围已验收完成；2834 项测试、63 项原生断言及实际 win 资料库等待授权时离库取消与返回恢复通过；小时级性能、发行包和 Windows/Linux 未验收）
- 元数据提案、标准批准、条件批量改名和提交核对：
  - [W0～W2 受控插件改名](../docs/plugin-system-w0-w2-rename.md)（本批限定 macOS 功能验收完成：SDK 0.4.0、独立样板、真实 gpt-5.5 与 Win/local-minio 专用文件、范围/提案批准、条件原子提交、PG/SQLite 审计和目录/预览名称同步；50 项仅自动验证列表完整性，实测暗色两项卡片，亮/暗 50 项视觉/滚动未手验；小时性能、跨重启自动核对与撤销未纳入）
- 文件处理产物、同库新文件与显式回执查询：
  - [W3 文件产物](../docs/plugin-system-w3-file-output.md)（SDK 0.5.0，独立 output 批准、封存私有正文、标准产物卡及复用上传事务；真实 gpt-5.5 的 205 行 CSV→JSON 另存/打开及摘要/回执通过。固定查询动作有终态 CAS/原结果保留，未知查询 UI 仅自动化，真机故障与重启后点击未手验）
- 插件手动命令、文件菜单与宿主表单：
  - [M1 手动执行](../docs/plugin-system-m1-manual-commands.md)（独立 main 执行记录、能力批准与 Agent 授权分离；最新验证状态见专题）
- 插件独立工具页面、资源选择和宿主审批接线：
  - [M2 工具工作区](../docs/plugin-system-m2-tool-workspaces.md)（动态贡献、共享隔离宿主及 JSON 交互样板；最新验证状态见专题）
- 当前主题优化：
  - [主题视觉设计与推广计划](../docs/theme-design-and-rollout-plan.md)、[通用主题基础](../docs/theme-foundation.md)（T1长期样板＋T2/T3共享接入：表面/文字/选择/焦点/按钮/输入及归档名称独立组合；设置、菜单、插件宿主、工具、归档卡片和视频普通侧栏指定入口已接。逐类范围、固定色例外与下一批见[覆盖地图](../docs/theme-adoption-map.md)，静态变量检查用`npm run theme:audit`。长期对照页「设置 → 外观 → 主题预览」，保留开发快捷入口`/#/dev/theme-foundation`，不新增主题owner；锁屏期间本轮只完成代码及自动验证，新增消费者待解锁视觉核验，全页面迁移与视觉定稿未完成）
  - [外观系统](../docs/appearance-system.md)、[颜色契约](../docs/plugin-system-a1-color-contract.md)及[显示基线](../docs/ui-display-readability-baseline.md)（新增紫罗兰亮暗主题与 67 色角色；森林/海蓝原 62 色、默认选择及已存偏好保留。导航/选中控件接入独立角色，Viewer/工具工作区共享完整颜色快照；JSON 转换样板源码已适配，旧安装包须重建更新。强调色仍只覆盖主色、链接和焦点边框；全量检查和 macOS 亮暗预览/取消、暗色菜单通过，范围及未验项见验证矩阵。继续复用唯一 owner 与跨窗口快照，内部图标库重绘由用户另行安排）
- 当前云端、Tailscale、多 MinIO 和发布方式：
  - `docs/current-deployment-topology.md`
- macOS / Windows 窗口策略、平台 bridge 和构建验证：
  - `docs/desktop-platform-architecture.md`
- macOS 个人签名、bootstrap 和后续发布：
  - `docs/local-macos-signing-and-release.md`
- Embedded Browser 生命周期、资源捕捉、下载导入：
  - `docs/embedded-browser-architecture.md`
- Cat Catch 全面重构、行为验证与完成定义：
  - `docs/cat-catch-full-migration-execution-plan.md`
- `library detail` 工作区模式、browser / file-viewer / search-home 切换：
  - `docs/library-detail-workspace.md`
- 内置 Agent 的执行、持久化、IPC、安全和 renderer UI 边界：
  - `docs/built-in-agent-architecture.md`
  - `docs/built-in-agent-shell-architecture.md`
  - `docs/built-in-agent-ui-contract.md`
- 文件树、文件打开、预览 tab、viewer 分发边界：
  - `docs/file-explorer-file-viewer-boundary.md`
- 内置类型、归档模式、目录树特殊语义：
  - `docs/built-in-type-and-archive-mode.md`
- viewer 与归档 viewer 映射：
  - `docs/file-viewer-and-archive-viewer-map.md`
- viewer 体系总入口与细分 viewer 文档：
  - `docs/viewers/README.md`
- 手工验证基线：
  - `docs/frontend-validation-matrix.md`

## 5. 高风险区域

后续改动时优先多看一遍、多测一遍的地方：

1. Embedded Browser：tab / view 生命周期、资源捕捉、下载与合并
2. `library detail`：工作区模式切换、缓存恢复、browser 与 file-viewer 的关系
3. 文件树与文件预览：树快照、文件打开、tab 复用、viewer 分发
4. 上传中心：任务状态机、取消、重试、并发
5. IPC / preload：payload 漂移、错误映射、bridge 发散
6. 主题与布局：标题栏安全区、浮层、分栏拖拽、原生 view 遮挡

## 6. 交付提醒

- 改代码前先补齐相关专题文档上下文。
- 改代码后先判断文档是否失真，再决定补哪一份。
- 交互改动按 `docs/frontend-validation-matrix.md` 记录已验证和未验证项。
