# ASMR Viewer 说明

更新时间：2026-04-16
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

### 3.2 Viewer 快照缓存

这个 viewer 当前有一层局部快照缓存，不是每次切回来都重新从根目录加载。

缓存内容包括：

- 当前路径栈
- 当前目录列表
- 当前选中项
- 集合名称、标签、SN
- 封面 URL 和封面节点
- 当前播放音频
- 音频队列
- 已解析过的音频 URL

缓存 key 由：

- `ownerKey`
- `reloadToken`

共同组成。

当前实现位置：

- `src/features/file-viewer/components/asmr-viewer/index.tsx`
- `src/features/file-viewer/utils/asmr-owner-key.ts`

### 3.3 全局音频条协作

`asmr-viewer` 不是自己单独 new 一个播放器，而是接入：

- `src/features/file-viewer/services/global-audio-player.ts`

当前设计要点：

- ASMR 内点击音频，会把音频源交给全局播放器
- 播放器会记录 `ownerType = asmr`
- 通过 `ownerKey` 识别当前播放属于哪个 ASMR 集合
- 全局播放器会主动暂停已注册的视频元素，避免音视频同时播放

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

1. 从 `fileUrl` 解析 `libraryId` 和 `rootNodeId`
2. 计算 viewer cache key
3. 如果命中快照，直接恢复列表、封面、播放状态等局部状态
4. 如果未命中快照：
   - 读取节点详情中的 `viewMeta`
   - 加载根目录 children
   - 根据 `coverNodeId` 或首张图片解析封面

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
4. 更新本地快照

## 6. 当前最值得小心的点

- `index.tsx` 体量已经偏大，后续继续加能力时优先考虑拆 hooks 或局部组件
- 快照恢复和异步加载是并存的，修改时要防止旧请求覆盖新状态
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
4. 切换到其他 tab 再回来时，列表和播放上下文不会意外丢失。
5. 编辑集合名称、标签、SN、封面后能正确保存并刷新展示。
6. 集合内图片、视频、PDF 仍能继续打开到对应 viewer。

## 10. 维护规则

出现以下任一变化时，必须回写本文：

- `asmr://` 路由格式变化
- 快照缓存 key 或恢复策略变化
- 全局音频条协作方式变化
- `viewMeta` 字段语义变化
- 编辑弹窗字段或保存链路变化
- 目录内文件打开分发方式变化
