# 系统工作区视图化 — 规划草案

> **临时文档**。本文件只记录“设置 / 个人主页 / 上传 / 回收站等系统页面改成工作区视图”的实施计划，不是长期架构文档。功能稳定后，应删除本文件，并把最终契约回写到 `docs/library-detail-workspace.md`、`docs/media-hub-contract.md`、`docs/frontend-validation-matrix.md` 或对应模块文档。

更新时间：2026-05-09

## 1. 背景

当前设置、个人主页、上传中心、回收站等入口更像“全屏覆盖页面”。这和资料库详情页的核心工作方式不一致：

- 进入这些页面时会遮掉目录树和主工作区，视觉上像离开了资料库。
- 文件预览、内置浏览器、MediaHub、上传任务等后台状态更容易被页面切换影响。
- 页面尺寸、缩放、标题栏安全区、弹框层级经常需要单独修补。
- 用户心智上其实只是想“在当前资料库里打开一个系统工具视图”，不是离开当前工作区。

因此后续建议把这类入口逐步改成 `library detail` 右侧主内容区里的“系统工作区视图”，和文件预览、浏览器、工具区属于同一层级。

## 2. 当前结论

第一阶段只做新工作区视图，不删除旧页面：

- 保留旧路由和旧页面作为兼容入口：
  - `/settings`
  - `/profile`
  - `/transfer-center`
  - `/upload-center`
  - `/libraries/:id/recycle-bin`
  - `/settings/tags`
  - `/settings/storage`
  - `/settings/browser-file-mappings`
- 这些旧入口统一标记为 legacy。它们只用于兼容、临时调试和迁移过渡，不再作为新增能力的设计落点。
- 新增 `system` 工作区模式，显示在资料库详情页右侧主内容区域。
- 设置、个人主页、上传、回收站先做成新视图；标签、存储、浏览器打开映射后续再迁移。
- 设置里的标签、存储、浏览器打开映射不单独开 system tab，而是作为 `settings` tab 内部页，使用内部返回箭头回到设置首页。
- 新视图优先复用已有 service、store、hook 和业务模块，不直接嵌入旧页面 shell。
- 旧页面暂不主动改造，避免在迁移期把两套布局都搅乱。

旧全屏页面的状态定义为“兼容入口 / 待移除”，不是未来扩展方向。保留它们只是为了迁移期间不一次性打断旧路由、收藏链接和调试路径。历史问题包括：全屏覆盖会让用户感觉离开资料库，目录树和当前文件上下文消失；路由切换更容易影响视频 / 音频和上传任务；弹框层级、缩放比例、标题栏安全区经常需要单独修；同一类设置入口在仓库页和资源页的视觉位置也不统一。新工作应沉到对应宿主的右侧视图中，待新宿主稳定后再删除旧路由和旧 shell。

### 2.1 Legacy 页面清单

| 页面 | 历史问题 | 新宿主 |
| --- | --- | --- |
| `/settings` | 全屏离开资料库；设置项和系统入口混在独立页面里，导致仓库页 / 资源页入口视觉不一致。 | 资源页 `settings` system tab；仓库页右侧设置视图。 |
| `/profile` | 个人页被当成全局路由，无法自然跟随目录树右下头像入口。 | 资源页 / 仓库页头像打开的个人主页视图。 |
| `/upload-center`、`/transfer-center?tab=upload` | 上传任务需要后台持续存在，但全屏路由容易造成“像离开工作区”的心智和关闭弹框问题。 | 资源页 `uploads` system tab。 |
| `/libraries/:id/recycle-bin` | 回收站强依赖当前资料库，独立页面容易丢失库上下文。 | 资源页 `recycle-bin` system tab。 |
| `/settings/tags` | 标签未来会被 ASMR、视频、音频、漫画、文件等入口带上下文打开，独立全屏页不适合承接。 | `settings` 内部标签管理页，后续支持上下文入口。 |
| `/settings/storage` | 存储管理后续会和物理位置迁移、节点迁移任务联动，独立设置页难以承载工作流。 | `settings` 内部存储管理页，后续可拆成 workspace view。 |
| `/settings/browser-file-mappings` | 浏览器打开映射属于设置子项，不应该和资源工作区割裂。 | `settings` 内部浏览器打开映射页。 |

迁移期规则：

- 新功能优先写到新宿主，不在 legacy 页新增主路径交互。
- legacy 页如果出现 bug，只修影响兼容访问的必要问题，不继续扩大样式和状态改造。
- 文档、验证和 review 默认以新宿主为主路径，legacy 页只作为删除前的兼容检查。
- 删除旧页面前，先确认所有按钮、右键入口、快捷入口和直接跳转都已改到新宿主。

最终用户体验目标：

- 点击设置 / 个人主页 / 上传 / 回收站后，目录树仍保留。
- 文件 tab、浏览器 tab、MediaHub、后台上传和播放状态都不因为打开系统视图而被销毁。
- 如果同一个系统视图已经打开，再次点击只是跳转到这个视图，不重复创建；不同系统视图可以并存在 system tab 栏。
- 关闭系统视图后回到打开前的工作区模式。

## 3. 核心概念

### 3.1 System Workspace

`system workspace` 是 `library detail` 的一种显示模式，和现有模式平级：

```ts
type WorkspaceDisplayMode =
  | 'search-home'
  | 'file-viewer'
  | 'browser'
  | 'tools'
  | 'system';
```

它只负责“当前右侧主内容区正在展示哪个系统视图”，不拥有上传任务、设置数据、回收站数据本身。

### 3.2 System View

第一版建议支持这些视图：

```ts
type SystemWorkspaceView =
  | 'overview'
  | 'settings'
  | 'uploads'
  | 'recycle-bin';
```

后续可扩展：

```ts
type SystemWorkspaceView =
  | 'overview'
  | 'settings'
  | 'uploads'
  | 'recycle-bin'
  | 'tags'
  | 'storage'
  | 'browser-mappings'
  | 'resource-create-wizard';
```

### 3.3 System Tab

系统视图使用“同类唯一、多类并存”的 tab 语义：

- 打开同一个系统视图时，直接聚焦现有视图。
- 打开另一个系统视图时，新增或激活对应 system tab。
- 系统 tab 不是文件 tab，也不是浏览器 tab，不写入文件预览上下文。
- 系统 tab 有 `x`，内部视图也保留“退出 / 关闭”动作，两者都关闭当前系统视图。

这样既避免同一个系统页重复打开多份，又允许设置、个人主页、上传、回收站像文件 tab 一样互相切换。

### 3.4 Return Mode

打开系统视图时记录来源模式：

```ts
type SystemWorkspaceReturnMode =
  | 'search-home'
  | 'file-viewer'
  | 'browser'
  | 'tools';
```

关闭系统视图时：

1. 优先回到打开前的 `returnMode`。
2. 如果来源已不可用，例如浏览器已关闭，则按现有 fallback：
   - 有 active file：回到 `file-viewer`
   - 有浏览器 tab 且 browserModeOpen：回到 `browser`
   - 否则回到 `search-home`

系统视图被用户切换到文件 / 浏览器 / 搜索 / 工具区时，应自动关闭，不在后台保留第二个活动系统视图。

## 4. 推荐目录结构

新增 feature 目录，不把系统视图继续堆在 `views/library/detail/index.tsx` 里：

```text
src/features/system-workspace/
  index.tsx
  types.ts
  registry.tsx
  style.ts
  views/
    overview/
      index.tsx
      style.ts
    settings/
      index.tsx
      style.ts
    uploads/
      index.tsx
      style.ts
    recycle-bin/
      index.tsx
      style.ts
```

职责边界：

- `views/library/detail/index.tsx`
  - 只拥有工作区模式、打开 / 关闭 / 切换系统视图的状态机。
  - 负责把 `libraryId`、刷新目录树回调、关闭回调传给系统工作区。
- `features/system-workspace`
  - 负责系统视图 shell、registry、统一标题区、空态、错误态、刷新动作。
  - 不反向持有 `workspaceDisplayMode`。
- `features/system-workspace/views/**`
  - 每个系统视图单独目录，按业务复用已有模块。
  - 不直接调用路由跳转来伪装视图切换。

## 5. 工作区状态设计

在 `src/features/library-workspace/workspace-state.ts` 里扩展持久化状态时要谨慎。

建议新增页面内状态：

```ts
const [systemWorkspaceTabs, setSystemWorkspaceTabs] =
  useState<SystemWorkspaceView[]>([]);

const [activeSystemWorkspaceView, setActiveSystemWorkspaceView] =
  useState<SystemWorkspaceView | null>(null);

const [systemWorkspaceReturnMode, setSystemWorkspaceReturnMode] =
  useState<SystemWorkspaceReturnMode>('search-home');
```

是否持久化需要分阶段判断：

- 第一阶段不持久化 `systemWorkspaceTabs` / `activeSystemWorkspaceView`，刷新页面后回到现有默认工作区，降低恢复复杂度。
- 后续如果用户明确希望“重启后仍回到上传中心 / 设置页”，再加入持久化。

打开动作建议收敛为页面层函数：

```ts
openSystemWorkspace(view: SystemWorkspaceView): void
closeSystemWorkspace(): void
```

规则：

- `openSystemWorkspace` 记录当前非 system 模式为 `returnMode`。
- 如果当前已经是同一个 system view，只保持 `workspaceDisplayMode = 'system'`。
- 如果当前是另一个 system view，加入 `systemWorkspaceTabs` 并激活它；`returnMode` 仍保留第一次从非 system 进入时的来源。
- `closeSystemWorkspace` 关闭当前 system tab；关闭最后一个 system tab 后再执行 return fallback。

## 6. 入口设计

### 6.1 资料库页左下设置按钮

当前左下设置按钮保留原位置，但点击后不再优先跳转全屏设置页，而是：

```text
打开 system workspace: settings
```

### 6.1.1 资料库页右下头像入口

目录树右下头像跟随侧栏宽度停留在侧栏右下角，点击后打开：

```text
打开 system workspace: profile
```

个人主页复用现有 `/profile` 页面能力，但在 system workspace 中不使用全屏 shell。

如果用户通过旧路由进入 `/settings`，旧页面仍可用。

### 6.2 上传入口

后续上传中心入口统一打开：

```text
打开 system workspace: uploads
```

上传任务状态仍归上传中心模块管理，新视图只是新的展示容器。

### 6.3 回收站入口

资料库维度的回收站打开：

```text
打开 system workspace: recycle-bin
```

回收站视图必须携带 `libraryId`。如果没有有效 `libraryId`，显示不可用空态，不发起错误请求。

### 6.4 总览入口

`overview` 是系统工作区目录页，后续可以放：

- 设置
- 个人主页
- 上传
- 回收站
- 标签管理
- 存储管理
- 浏览器打开映射
- 新建资源向导

第一阶段可以先不暴露总览入口，但 shell 和 registry 预留它，方便后续把多个按钮整理成统一入口。

## 7. 视图内容规划

### 7.1 Settings Workspace

第一版目标不是完整复制旧设置页，而是先承接高频设置：

- 主题
- 默认语言
- 文件树 / 预览相关常用开关
- 跳转到标签、存储、浏览器映射的入口

设计原则：

- 复用已有设置 API、store 和组件片段。
- 避免把旧设置页整体塞进系统视图，旧页面的全页布局、返回按钮、页面宽度不适合右侧工作区。
- 后续每个设置分组可以逐步拆成独立 workspace view。

### 7.2 Uploads Workspace

第一版目标是稳定展示上传任务，不改变上传状态机：

- 复用 `src/modules/upload-center` 的任务 store、事件、取消、重试能力。
- 展示当前队列、进度、速度、状态、失败原因。
- 避免数字和进度条变化导致布局抖动，宽度使用固定列或等宽数字。
- 取消 / 中断后弹框必须可关闭，任务残留和临时文件清理按上传模块契约处理。

不建议：

- 新建第二套上传任务缓存。
- 通过旧 `/upload-center` 页面 iframe 或路由嵌套来显示。

### 7.3 Recycle Bin Workspace

第一版目标是资料库内回收站：

- 按 `libraryId` 查询回收站条目。
- 支持恢复、永久删除、清空。
- 操作成功后刷新当前列表。
- 恢复或删除影响目录树时，通知目录树刷新或标记 snapshot dirty。

需要注意：

- 回收站是资料库相关视图，不能做成全局无上下文页面。
- 删除确认弹框使用工作区紧凑弹框基线，避免回到全屏页面尺寸。

### 7.4 Tags / Storage / Browser Mappings

状态：已接入 `settings` tab 的内部页，旧路由仍保留。

- 标签管理：当前可从设置首页进入，未来可从 ASMR、视频、音频、漫画、文件入口带上下文进入。
- 存储管理：当前可从设置首页进入，未来和物理位置迁移、存储桶、节点迁移任务联动。
- 浏览器打开映射：当前作为设置子视图进入。

## 8. UI 契约

系统工作区必须遵守当前主工作区视觉节奏：

- 不创建新的全局产品头部。
- 右侧主内容区继续使用现有内容头部高度和按钮密度。
- 左侧目录树 / 资料库侧栏不被遮挡。
- 系统 tab 使用和文件 tab 接近的关闭心智，但视觉上可区分为系统视图。
- 视图内部可以有“退出 / 关闭”按钮，但不能再做一个全屏页面式返回头。
- MediaHub 仍位于工作区头部右侧，有媒体时才显示。
- 刷新按钮是否显示由当前视图决定；没有刷新语义的系统视图不强行显示刷新。
- 暗色 / 亮色主题都必须可读，颜色从现有主题变量取，不硬编码单主题色。

推荐头部结构：

```text
[系统 tab: 设置 x]                         [MediaHub?] [Refresh?]
```

视图正文使用紧凑工作区尺寸：

- 列表行高优先 `34px ~ 40px`
- 普通按钮高度优先 `28px ~ 32px`
- 输入框高度优先 `28px ~ 34px`
- 高频正文不低于当前工作区可读基线

## 9. 生命周期和状态风险

实现时重点防这些坑：

### 9.1 文件预览不能被卸载

打开系统视图时，文件预览区域应该像切到浏览器 / 工具区一样隐藏或失活，而不是销毁文件 tab。

需要继续保证：

- 视频 DOM 不因进入设置 / 上传 / 回收站而暂停。
- 音频播放器和 MediaHub entry 不因系统视图切换丢失。
- viewer 只收到 `active=false`，用于收起快捷键和局部浮层，不释放媒体。

### 9.2 浏览器原生 view 要正确隐藏

当从浏览器切到系统视图：

- browser workspace 不显示。
- 原生 WebContentsView 必须按现有非浏览器模式隐藏 / 降权。
- 关闭系统视图后如果 return mode 是 browser，再恢复对应 browser tab。

### 9.3 上传任务不能双源

Uploads Workspace 只展示上传中心模块状态，不再复制一份任务数组并自行 patch。

允许本地 UI 状态：

- 当前筛选
- 排序
- 展开行
- 搜索草稿

不允许本地再持有任务真实状态：

- 进度
- 状态
- 错误
- 任务生命周期

### 9.4 回收站操作要刷新目录树

恢复 / 永久删除 / 清空回收站后，至少需要处理：

- 当前回收站列表刷新。
- 目录树 snapshot 标记脏或主动刷新。
- 当前打开的文件 tab 如果对应节点被永久删除，需要后续设计关闭或失效提示。第一阶段可以先记录风险，不扩大范围。

### 9.5 快捷键和弹框不要串场

系统视图打开时：

- 文件 viewer 的局部快捷键不应响应。
- 浏览器快捷键不应误操作隐藏的原生 view。
- 系统视图弹框不能被原生浏览器 view 遮挡。

## 10. 实施步骤

### Step 0：计划落文档

产物：

- `docs/wip/system-workspace-roadmap.md`

目标：

- 先固定系统视图的用户心智、状态 owner、入口和边界。

### Step 1：搭建空 shell

改动范围：

- `src/features/system-workspace/**`
- `src/features/library-workspace/workspace-state.ts`
- `src/views/library/detail/index.tsx`
- 必要时更新 `docs/library-detail-workspace.md`

目标：

- 新增 `workspaceDisplayMode = 'system'`。
- 新增 `SystemWorkspaceShell`，先支持空态 / overview placeholder。
- 添加打开 / 关闭系统视图的页面层函数。
- 保证切到 system 时文件 viewer 不卸载、browser 正确隐藏。

验证：

- 打开文件后切 system，再关闭，回到文件。
- 打开浏览器后切 system，再关闭，回到浏览器。
- 没有 active file 时打开 system，再关闭，回到搜索主页。

### Step 2：接入系统 tab 和入口

改动范围：

- `src/views/library/detail/**`
- 资料库页左下设置入口
- 上传 / 回收站入口调用点

目标：

- 点击设置打开 `settings` system view。
- 点击头像打开 `profile` system view。
- 点击上传打开 `uploads` system view。
- 点击回收站打开 `recycle-bin` system view。
- 同一入口重复点击时聚焦已有 system view。
- 切到文件 / 浏览器 / 搜索 / 工具时关闭 system view。

验证：

- 重复点击设置不会新增多个 tab。
- 设置切上传会保留两个 system tab，并激活上传。
- 系统 tab `x` 和内部关闭按钮都能关闭。

### Step 3：实现 Settings Workspace 第一版

目标：

- 承接最常用设置。
- 保留到旧完整设置页的兼容入口，避免第一版遗漏深层设置。
- 视觉遵守工作区密度，不使用旧全屏设置页 shell。

验证：

- 主题切换不影响布局。
- 语言下拉框不出现内部白色滚动条。
- 打开设置不暂停视频 / 音频。

### Step 4：实现 Uploads Workspace 第一版

状态：已落地第一版。

目标：

- 展示上传队列和任务状态。
- 取消、重试、失败提示沿用上传中心模块。
- 数字变化不抖动。
- 关闭视图不停止后台上传。

验证：

- 上传中切到文件 / 设置 / 回收站，任务继续。
- 取消任务后提示可关闭。
- 进度到 100% 后等待服务端完成时 UI 有明确状态，不像卡死。

### Step 5：实现 Recycle Bin Workspace 第一版

状态：已落地第一版。

目标：

- 在资料库右侧主内容区展示当前库回收站。
- 支持恢复、永久删除、清空。
- 操作后刷新回收站和目录树。

验证：

- 删除文件后进入回收站可看到。
- 恢复后目录树可见。
- 永久删除后回收站列表更新。

### Step 6：回写正式文档

当前三个视图稳定后：

- 更新 `docs/library-detail-workspace.md`，记录 `system` 模式正式契约。
- 更新 `docs/frontend-validation-matrix.md`，加入系统工作区验证路径。
- 如 MediaHub 展示规则有变化，更新 `docs/media-hub-contract.md`。
- 删除本 WIP 文档，或改成极短归档摘要后迁移结论。

## 11. 不做事项

第一阶段明确不做：

- 不删除旧页面和旧路由。
- 不把所有设置项一次性迁移完。
- 不允许同一个系统视图重复打开多份。
- 不把系统视图状态持久化到刷新恢复。
- 不重写上传状态机。
- 不把回收站做成跨资料库全局视图。
- 不引入新的全局产品头部。

## 12. 验证清单

每一阶段至少验证：

- `npm run lint`
- `npm run build`

涉及交互后还要手工验证：

- 文件播放中打开设置，播放不中断。
- 视频播放中打开上传 / 回收站，播放不中断。
- 浏览器打开网页后进入系统视图，再关闭能回到浏览器。
- 上传中打开 / 关闭上传视图，任务不中断。
- 回收站恢复后目录树刷新。
- 暗色 / 亮色主题下系统视图可读。
- 系统 tab 关闭、内部退出、重复点击入口都符合“同类唯一、多类并存”语义。

## 13. 后续扩展方向

系统工作区稳定后，可以继续扩展：

- 标签管理 workspace：支持从 ASMR / 视频 / 音频 / 漫画入口带上下文进入。
- 存储管理 workspace：承接物理位置迁移、存储桶、节点迁移任务。
- 浏览器打开映射 workspace：从设置或 overview 进入。
- 资源创建向导 workspace：和 `docs/wip/resource-create-wizard-roadmap.md` 合流。
- 系统工作区 overview：把常用系统工具做成统一目录，而不是散落在各处。

## 14. Legacy 移除计划

旧全屏页面不要长期和新系统视图并存。并存时间越长，入口判断、样式修补和状态验证都会变成双倍成本。

建议删除顺序：

1. 先删除不再有独立语义的子页 route：`/settings/tags`、`/settings/storage`、`/settings/browser-file-mappings`。
2. 再删除可完全由 system view 承接的全屏页：`/upload-center`、`/transfer-center?tab=upload`、`/libraries/:id/recycle-bin`。
3. 最后删除全局外壳页：`/settings`、`/profile`，保留登录前后真正需要的认证跳转逻辑。

删除前置条件：

- 资源页和仓库页所有入口都已切到新宿主。
- 直接打开新宿主的主路径都通过验证矩阵。
- 上传、回收站、设置、个人主页在打开 / 关闭时不会影响媒体播放。
- 标签、存储、浏览器映射能从设置内部稳定返回。
- 文档中不再把 legacy route 写成推荐入口。
- 如果仍有外部链接或快捷键依赖旧 route，需要先改为打开对应 system view。

删除时必须同时清理：

- `router` 中的旧 route 配置。
- 只为旧全屏页存在的 page shell、退出按钮、标题栏安全区样式。
- 只为旧全屏页存在的缩放 / 宽度 / 居中补丁。
- 旧入口的验证项，迁移到 system workspace 验证项下。
