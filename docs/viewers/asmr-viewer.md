# ASMR Viewer 说明

更新时间：2026-08-13
适用范围：`src/features/file-viewer/components/asmr-viewer/` 下的 ASMR 集合预览、目录浏览、音频播放、封面解析和元信息编辑能力。

## 1. 概述

`asmr-viewer` 不是普通文件播放器，而是一个带有项目业务语义的集合型 viewer。

它当前把下面几类事情收在一起：

- 解析 `asmr://library/:libraryId/node/:nodeId` 路由
- 加载并浏览 ASMR 目录树
- 在 viewer 内播放音频队列
- 解析并展示集合封面、标签、SN 等元信息
- 允许编辑集合元信息和封面节点
- 在目录内继续打开图片、视频、PDF、普通音频等文件

如果只把它当成“音频播放器”来改，后续很容易把目录浏览、缓存恢复和工作区协作改坏。

## 2. 当前结构

- `index.tsx`
  - 主体实现，当前大部分状态和交互都在这里
- `style.ts`
  - 布局和视觉样式
- `docs/viewers/asmr-viewer.md`
  - 当前说明

## 3. 关键概念

### 3.1 路由语义

`asmr-viewer` 当前不是靠普通文件 URL 直接打开，而是优先依赖：

- `asmr://library/:libraryId/node/:nodeId`

解析逻辑在：

- `src/features/file-viewer/utils/asmr-owner-key.ts`

其中：

- `libraryId`
  - 用来请求目录和文件资源
- `nodeId`
  - 代表当前 ASMR 集合根目录

### 3.2 Viewer Warm Session

这个 viewer 通过公共 Viewer Session Registry 保存最小可恢复现场：

- 根节点开始的稳定路径栈
- 当前选中节点
- 列表卡片锚点、锚点内偏移、滚动比例和绝对位置兜底
- 当前播放音频节点和播放队列父目录节点

目录列表、集合元信息、封面、音频队列内容和已解析的临时音频 URL 不进入 snapshot。恢复时重新读取节点详情和目录 children；路径按父子关系逐级验证，某层已删除或移动时回退到最后一个仍有效的目录。若播放队列不属于当前可见目录，只按稳定父目录节点额外重建队列，实际播放事实仍由全局音频服务拥有。

资源身份由公共 registry 使用 `accountScope + libraryId + rootNodeId + viewerKind` 构造；`reloadToken` 只负责 generation 失效，不拼入 cache key。

### 3.3 全局音频条协作

`asmr-viewer` 不是自己单独 new 一个播放器，而是接入：

- `src/features/file-viewer/services/global-audio-player.ts`

当前设计要点：

- ASMR 内点击音频，会把音频源交给全局播放器
- 播放器会记录 `ownerType = asmr`
- 通过 `ownerKey` 识别当前播放属于哪个 ASMR 集合
- 音频和视频允许并行；音频单例只负责同一时刻的一个音频源
- 底部音量控件复用 `MediaVolumeControl`，音量和静音来自全局本机偏好，不由 ASMR viewer 独立保存

所以后续如果改 ASMR 播放行为，要同时检查：

- viewer 内底部播放器栏
- 全局音频条
- video viewer 是否被意外影响

### 3.4 集合元信息

当前 ASMR 集合元信息主要来自节点详情里的 `viewMeta`：

- `tag`
- `tagIds`
- `sn`
- `coverNodeId`

这些字段不是纯展示字段，还会影响：

- 头部标签展示
- 封面选择
- 编辑弹窗回填

## 4. 当前职责边界

`asmr-viewer` 当前负责：

- 加载集合根目录和子目录
- 生成目录 breadcrumb
- 解析封面回退策略
- 构建音频队列并切歌
- 打开集合内文件
- 编辑并保存集合元信息

它当前不负责：

- 工作区 tab 的创建与保活
- 顶层 fileType 分发
- 全局播放器实现本身
- 归档语义 ASMR 展示

这几块分别应优先看：

- `src/components/business/app-main/index.tsx`
- `src/features/file-viewer/components/file-dispatcher/index.tsx`
- `src/features/file-viewer/services/global-audio-player.ts`
- `src/features/archive-viewer/components/asmr-archive-viewer/`

## 5. 关键流程

### 5.1 初次进入

建议顺着这条链路阅读：

1. 从 props 或 `fileUrl` 解析 `libraryId` 和 `rootNodeId`。
2. 公共 registry 发起 Warm/Cold 恢复；节点详情和根目录 children 与异步 Cold 读取并行请求，Cold 不阻塞内容网络请求。
3. 初始恢复得出结论后，按 snapshot 逐级验证、加载稳定路径、选择、列表锚点和播放节点投影；如果用户已在 Viewer 内容区操作，则保留当前现场，不再套用迟到恢复。
4. 根据 `coverNodeId` 或根目录首张图片重新解析封面。
5. 如果全局音频服务仍由该 ASMR 集合拥有，则按稳定父目录重建音频队列；否则不伪造播放状态。

### 5.2 打开目录内节点

- 双击目录
  - 进入子目录并刷新 path stack
- 双击音频
  - 生成当前目录下的音频队列，交给全局播放器
- 双击其他文件
  - 获取文件链接，再交给 file viewer 主链路继续打开

### 5.3 编辑集合信息

编辑弹窗当前会同时处理三类事情：

- 重新加载集合元信息
- 重新加载 ASMR 标签选项
- 打开一个局部“封面选择目录浏览器”

保存时当前会：

1. 必要时重命名根节点
2. 重写 `viewMeta`
3. 重新拉取根目录并刷新封面
4. 后续语义变化由公共 session adapter 捕获

## 6. 当前最值得小心的点

- `index.tsx` 体量已经偏大，后续继续加能力时优先考虑拆 hooks 或局部组件
- Warm 恢复和异步加载并存，修改时要防止旧请求覆盖新资源；adapter 必须在同一资源生命周期内保持稳定
- `audioQueue`、`currentAudioId`、`currentAudioSrc` 和全局播放器状态之间有联动，不能只改一边
- `coverNodeId` 既可能来自配置，也可能走首张图片回退，不能简单假设“封面一定存在”
- `tag` 和 `tagIds` 当前兼容了旧字段和新字段，清理时要先确认数据迁移策略

## 7. 阅读顺序

建议按这个顺序读：

1. `src/features/file-viewer/utils/asmr-owner-key.ts`
2. `src/features/file-viewer/services/global-audio-player.ts`
3. `src/features/file-viewer/components/asmr-viewer/index.tsx`
4. `src/features/file-viewer/components/asmr-viewer/style.ts`
5. `src/components/business/app-main/index.tsx`

## 8. 何时继续细分文档

当下面任一项继续膨胀时，应该继续在 `docs/viewers/` 里拆子文档，而不是把所有说明继续堆在这一页：

- 播放器状态机
- 封面与元信息编辑模型
- 目录浏览和缓存恢复
- 标签体系和兼容策略

建议未来的拆分方向：

- `docs/viewers/asmr-playback-model.md`
- `docs/viewers/asmr-meta-editing.md`
- `docs/viewers/asmr-cache-and-restore.md`

## 9. 验证方式

涉及 `asmr-viewer` 改动时，至少手工验证：

1. ASMR 集合能正常打开，标题、标签、SN、封面展示正确。
2. 目录双击进入和 breadcrumb 返回正常。
3. 音频双击后能正常进入播放，并支持上一首、下一首、拖动进度、调节音量。
4. 进入嵌套目录并滚动后，切换 tab 或工作区再回来仍恢复路径、列表锚点和选择。
5. 播放后浏览到另一目录，再真卸载重建时，当前播放节点和原队列仍能从全局音频 owner 与稳定父目录投影出来。
6. 恢复路径中的目录被删除时，回退到最后一个有效层级，不白屏或保留伪路径。
7. 编辑集合名称、标签、SN、封面后能正确保存并刷新展示。
8. 集合内图片、视频、PDF 仍能继续打开到对应 viewer。

## 10. 维护规则

出现以下任一变化时，必须回写本文：

- `asmr://` 路由格式变化
- session schema、身份或恢复策略变化
- 全局音频条协作方式变化
- `viewMeta` 字段语义变化
- 编辑弹窗字段或保存链路变化
- 目录内文件打开分发方式变化
