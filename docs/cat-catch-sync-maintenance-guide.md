# Cat Catch 同步维护指南

更新时间：2026-04-22
适用范围：`omniflow-app` 内置浏览器、资源嗅探、缓存捕捉、manifest 解析、下载执行、外部工具适配相关开发与维护。

目标：给后续维护 Cat Catch 同步工作的 Agent 一个稳定判断基线。最终目标不是“尽量像 Cat Catch”，而是“把 Cat Catch 的能力尽量完整迁入 OmniFlow，并按客户端最佳实践重组，不照搬浏览器扩展 workaround”。

## 1. 核心原则

- 同步 **能力和经验**，不逐行同步实现。
- 先判断 **场景是否同构**，再判断是否需要迁代码。
- 先同步 **已经有等价实现的链路**，再迁移 **还缺失的能力**。
- 不把浏览器扩展时代的生存性补丁，误当成 OmniFlow 的默认主链。
- 任何同步都必须维护当前的状态 owner 和 Electron 边界，不能为了“像 Cat Catch”把链路做脏。

## 2. 两边环境差异

这一节是判断“该不该迁”的前提。不同环境下，同一个改动的价值差别会很大。

### 2.1 Cat Catch 的处境

Cat Catch 主要运行在浏览器扩展环境中：

- 资源处理发生在页面脚本、扩展页面、background/service worker 之间
- 默认出口偏浏览器下载、Blob、StreamSaver、外部工具协议
- 没有 Electron main、preload、原生文件系统和本地 `ffmpeg` 这一层
- 页面内存、Blob 大小、浏览器下载能力、跨页面参数传播都会更敏感

因此 Cat Catch 中常见几类实现：

- 为了绕开浏览器限制的策略
- 为了兼容扩展页面跳转的参数拼接
- 为了在纯浏览器里边下边存的 StreamSaver 方案
- 为了方便用户手动接入外部工具的协议/模板

这些都不一定应原样进入 OmniFlow。

### 2.2 OmniFlow 的处境

OmniFlow 是 Electron 桌面客户端，主链分层更明确：

- renderer：页面编排、资源列表、设置面板、任务入口
- preload / IPC：桥接契约
- Electron main：浏览器视图、下载、文件系统、本地工具、`ffmpeg`
- 后端：接收成品文件、存进 MinIO、创建资源库节点

OmniFlow 当前主路线不是“浏览器里抓完立刻下载”，而是：

```text
资源识别
  -> 策略决策
    -> 客户端侧处理（Electron main / 本地工具 / temp file / ffmpeg）
      -> 上传或导入资源库
```

因此在 OmniFlow 里：

- 真正的重活应尽量放在 Electron main / 本地工具层
- renderer 不应该承担大文件处理、媒体内容搬运和复杂调度
- 很多 Cat Catch 的浏览器侧 workaround 在 OmniFlow 里应该降级为“可选保险开关”或“提示”，而不是默认行为

## 3. 同步判断矩阵

拿到 Cat Catch 新提交后，先把改动归到下面几类，再判断是否迁。

### 3.1 推荐优先同步

这些通常值得优先吸收：

- 资源识别经验
  - 新的 manifest / media / key 识别规则
  - 相对 URL、嵌套 JSON、特殊站点数据结构
- parser 经验
  - HLS / DASH 解析边角
  - `EXT-X-KEY`、`EXT-X-MAP`、`BaseURL`、`SegmentTimeline` 等真实站点坑位
- headers / referer / cookie 透传经验
- 文件名和资源去重的真实 bug 修复
- MSE 识别、buffer 分类、异常容错这类“捕捉质量”改动

判断标准：这类改动通常直接提升 **识别率、正确性、真实站点兼容性**。

### 3.2 需要先看是否同构

这类改动不能直接判断“该迁”或“不该迁”，必须先看 OmniFlow 是否有同构场景：

- 扩展页面参数传播
- parser 页面之间的 URL 拼接与 query 透传
- 浏览器下载器页面自身的状态恢复
- 扩展专有设置项在 popup / options 页之间的同步

如果 OmniFlow 没有对应页面模型，就不应强行照搬。

### 3.3 默认不直接迁

这些通常不是主线：

- 只为浏览器下载限制兜底的特殊实现
- 只为扩展 UI 交互便利服务的细碎行为
- 与 OmniFlow 产品目标无关的外围能力
  - recorder / WebRTC / 录屏
  - JSON viewer
  - 纯扩展风格的媒体控制
  - MQTT 等外部推送

它们不一定永远不做，但不应该混进“猫抓主链同步”里。

## 4. 同步前必须回答的 6 个问题

每次准备同步 Cat Catch 的某个改动前，都先回答：

1. 这个改动是在解决 **识别正确性**，还是在规避 **浏览器环境限制**？
2. OmniFlow 当前是否有 **同构链路**？
3. 这件事应该落在 **renderer**、**Electron main**、还是只是文档/策略层？
4. 这项改动是 **默认主链**，还是只适合作为 **可选开关 / 调试能力 / 提示**？
5. 如果不迁，是否会影响 Cat Catch 核心能力对齐？
6. 如果迁，是否会让当前状态 owner、文件流向、下载执行模型变脏？

只有在这 6 个问题里都站得住，才适合进代码。

## 5. 迁移落点规则

### 5.1 识别与解析

优先落在：

- `probe runtime`
- `resource parser service`
- `resource plan builder`

不要把 parser 经验直接散落在组件里。

### 5.2 下载执行

OmniFlow 的默认主线应是：

```text
manifest / 计划已完整
  -> 客户端执行器（Electron main / ffmpeg / 本地下载器）

MSE / blob / 纯页内流
  -> 本地捕捉 / staged file / 后续导出
```

不要把 Cat Catch 的浏览器下载器页面模型直接搬到 renderer 主界面里。

### 5.3 外部工具

如果 Cat Catch 的改动本质是：

- aria2
- 命令模板
- 本地程序调用

在 OmniFlow 里应作为 **外部工具适配层** 设计，而不是塞进资源捕捉主链。

### 5.4 大文件与内存策略

Cat Catch 中很多“大文件阈值”改动，本质是在应对浏览器扩展环境的内存与 Blob 限制。

在 OmniFlow 里要这样处理：

- 如果它解决的是 **我们也有的真实内存问题**，可以迁，但优先作为：
  - 可选开关
  - UI 提示
  - 临时保险策略
- 如果它只是扩展下载环境的 workaround，就不要自动升格为默认主线

## 6. 常见案例判断

### 6.1 `m3u8.js` 参数透传修补

典型特征：

- 与 `m3u8.html` 或扩展 parser 页面跳转绑定
- 修的是 query 参数继承、层级 manifest 页面跳转

判断：

- 如果 OmniFlow 当前没有同构的 parser 页面模型，不直接迁
- 应先记录这类改动解决了什么问题，再看我们的 parser plan builder 是否存在同类 bug

### 6.2 `catch.js` 的“每 1GB 自动保存一次”

判断：

- 这是浏览器扩展环境下很典型的 **生存性策略**
- 在 OmniFlow 里不是默认主链
- 如果要吸收，更适合当成：
  - 可选开关
  - 调试/保险能力
  - 或 UI 提示

它不应自动被视为“必须迁入的核心 downloader 能力”。

### 6.3 `function.js` 的文件名修补

判断：

- 先看我们当前文件名 sanitization 是否有对应 bug
- 如果我们根本不用同一种文件名生成路径，就不必为了“对齐 Cat Catch”硬迁实现

### 6.4 `recorder.js` 的定时保存

判断：

- 这属于 recorder / 录制链路的维护，不属于当前资源嗅探与下载主链
- 默认记录为“暂缓/另议”，不要混进当前主线同步节奏

## 7. 建议维护流程

建议每 `1-3` 个月做一次 Cat Catch 同步检查。

每次流程：

1. 拉取 Cat Catch 最近提交
2. 只看和当前主线相关的目录与文件
   - `catch-script/search.js`
   - `catch-script/catch.js`
   - `js/m3u8.js`
   - `js/m3u8.downloader.js`
   - `js/mpd.js`
   - `js/function.js`
3. 把改动分类成：
   - 应立即同步
   - 需要同构判断
   - 只记经验，不迁代码
4. 先同步“已经有等价实现”的变化
5. 再评估“还未实现的大能力”是否进入开发计划
6. 更新：
   - `docs/cat-catch-migration-audit.md`
   - 本文档（如果判断规则发生变化）

## 8. 与迁移审计文档的关系

- `docs/cat-catch-migration-audit.md`
  - 回答：**现在已经迁了什么、还缺什么**
- 本文档
  - 回答：**为什么迁、是否值得迁、迁到哪一层**

不要让审计表承担判断手册的职责，也不要让本指南变成功能完成清单。

## 9. 重要维护规则

- 不按 Cat Catch 源码目录逐文件对齐，要按 OmniFlow 的执行分层对齐。
- 不把 renderer 当成“浏览器下载器实现层”。
- 任何会改变文件流向、自动导出、缓存清理、大文件处理节奏的改动，都先对照 `docs/captured-resource-flow-plan.md`。
- 任何会改变内置浏览器 renderer/main 边界的改动，都先对照 `docs/embedded-browser-architecture.md`。
- 如果 Cat Catch 的改动只是在解决“浏览器扩展环境的限制”，默认先怀疑它 **不该成为 OmniFlow 默认主链**。

## 10. 当前建议

当前阶段的优先级应保持：

1. 对齐识别与 parser 经验
2. 对齐 `m3u8 downloader` / `mpd parser` 真正缺失的主链能力
3. 把大文件、导入资源库、客户端执行器路线收清楚
4. 再考虑扩展时代的特殊优化策略是否要保留为可选项

一句话总结：

**Cat Catch 是经验来源，不是实现模板；OmniFlow 要对齐的是能力边界，而不是插件时代的每一层手法。**
