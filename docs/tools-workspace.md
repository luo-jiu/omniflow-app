# Tools Workspace 说明

更新时间：2026-04-16

适用范围：`src/views/library/detail/` 中的 `tools` 工作区模式，以及 `src/features/tool-workspace/` 下的工具域能力。

## 1. 概述

`tools workspace` 不是单独的路由应用，而是 `library detail` 页面里的一个工作区模式。

当前目标：

- 保留目录树上下文。
- 让复杂工具流程从设置页和内容页中抽离出来。
- 支持后续从视频、音频、文件详情等位置带上下文进入工具区。

当前首个工具是：

- `AI 字幕翻译`

## 2. 工作区层级

当前 `library detail` 的 `workspaceDisplayMode` 有 4 种：

- `search-home`
- `file-viewer`
- `browser`
- `tools`

其中：

- 页面层继续拥有“当前显示哪种工作区模式”的 owner。
- 工具自身的业务状态不回写到页面层，而是收敛在 `src/features/tool-workspace/`。

当前结论：

- 页面层只负责进入 / 离开 `tools`。
- 工具区内部具体是哪个工具、字幕当前草稿是什么，属于工具域自己的状态。

## 3. 当前工具区结构

当前 `tools workspace` 的结构分为两层：

1. 页面层容器
   - 位于 `src/views/library/detail/index.tsx`
   - 负责：
     - 工具区入口按钮
     - 切换 `workspaceDisplayMode='tools'`
     - 保留目录树显示
     - 将目录树当前选中节点透传给工具区

2. 工具域实现
   - 位于 `src/features/tool-workspace/`
   - 负责：
     - 工具导航壳
     - 字幕翻译配置
     - 字幕解析、翻译、另存为
     - 工具草稿缓存

## 4. 目录树联动

当前工具区没有新造一套“库内文件选择器”，而是复用目录树当前选中节点。

目录树当前透传字段包括：

- `primaryNode`
- `selectedNodeIds`
- `rootNodeId`

用途：

- 导入库内字幕时，读取当前选中的字幕文件。
- 另存为到库内时，优先使用当前选中目录作为目标目录。

当前保存目标回退规则：

1. 当前选中目录
2. 当前选中文件的父目录
3. 源字幕文件的父目录
4. 当前库根目录

## 5. AI 字幕翻译工具

### 5.1 当前能力

- 读取本地字幕文件
- 读取库内字幕文件
- 自动解析 `srt / vtt`
- 列表展示：
  - 时间戳
  - 原文
  - 译文
- 单句翻译
- 一键翻译全部
- 译文手动编辑
- 另存到本地
- 另存到库内文件系统

### 5.2 模型协议

当前按 OpenAI-compatible 接口风格请求：

- `GET /models`
- `POST /chat/completions`

默认本地配置：

- `baseUrl = http://localhost:11434/v1`
- `apiKey = ollama`
- `presetPrompt = ''`

这些配置只保存在本机 `localStorage`，不回写后端。

当前支持“预设提示词”：

- 作为每次翻译请求固定附带的 system prompt 补充
- 用于长期术语、语气、专有名词等稳定规则

### 5.3 上下文拼接

当前单句翻译会把：

- 当前句
- 前 `contextWindow` 句
- 后 `contextWindow` 句

一起发给模型，但明确要求模型只返回“当前句”的译文。

默认 `contextWindow = 5`。

## 6. 保存链路

### 6.1 本地另存为

当前链路：

```text
renderer tool workspace
  -> preload save dialog
  -> preload writeTextFile
  -> Electron main 写入目标路径
```

### 6.2 库内另存为

当前链路：

```text
renderer tool workspace
  -> preload createStagedTextFile
  -> Electron main 在 userData staging 下生成真实文本文件
  -> renderer 复用 /v1/directory/upload
  -> 上传成功后清理 staging 文件
```

规则：

- Electron main 只负责“通用文本文件 staging / 写入”。
- 上传业务仍由 renderer 侧现有上传链路负责。

## 7. 状态 owner

当前 owner 规则如下：

- `workspaceDisplayMode`
  - owner：`library detail` 页面
- 目录树当前选中节点
  - owner：目录树组件内部
  - 向页面层只做只读透传
- 字幕翻译草稿
  - owner：`features/tool-workspace`
  - 当前按 `libraryId` 做内存缓存
- 翻译配置
  - owner：`features/tool-workspace`
  - 当前持久化到本地 `localStorage`

## 8. 验证方式

本次工具区改动至少应验证：

- `file-viewer -> tools`
- `search-home -> tools`
- `browser -> tools`
- 工具区读取本地字幕
- 工具区读取库内字幕
- 单句翻译
- 批量翻译
- 本地另存为
- 库内另存为

## 9. 维护规则

出现以下变化时，必须回写本文：

- 新增第二个工具
- 工具区支持多工具会话或多工具 tab
- 工具区开始支持从视频/音频/文件详情自动跳转
- 字幕工具支持更多格式或导出模式
- 文本 staging / preload 保存链路变化
