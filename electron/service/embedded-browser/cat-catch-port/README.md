# Cat Catch Port

本目录用于忠实承载 Cat Catch 中与 OmniFlow 目标相关的行为和经验分支，不承载浏览器扩展 UI 或 Electron/OmniFlow 平台代码。

## 允许依赖

- 标准 JavaScript/Web API。
- 本目录内的纯逻辑模块。
- `../contracts/` 中与平台无关的纯数据类型。
- 经过明确选择并固定版本的 parser/crypto 库。

## 禁止依赖

- Electron、IPC、preload。
- React、renderer store 或组件状态。
- Node 文件系统、child process、ffmpeg。
- UploadManager、资料库 API 和产品页面模型。

这些能力由 `capture/`、`processing/` 和 `integrations/` adapter 提供。

## 计划模块

```text
shared/
network/
deep-search/
mse/
hls/
dash/
downloader/
```

模块只在第一个真实 capability 落地时创建，不预建空文件。

## 来源注释

从 Cat Catch 迁入的非显然逻辑，在文件或复杂分支附近记录：

```text
Upstream: xifangczy/cat-catch@<full-commit>
Source: <path>#<stable anchor>
Reason: <该经验分支解决的问题>
Adaptation: <none 或平台等价差异>
Fixture: <fixture id>
```

不要逐行粘贴无意义注释，但不得删除解释真实站点兼容、竞态、错误恢复或格式边角的来源信息。

## 实施规则

1. 先把 `plannedTestIds` 变成实际失败测试。
2. 再实现纯 port。
3. 通过薄 adapter 接入生产等价 harness。
4. unit 就绪后在唯一 dispatch boundary 切换。
5. 同一切片删除旧实现，不保留双 hook/双 parser/双 downloader。
6. 更新 capability map、legacy cleanup 和 sync log。

完成与同步合同见：

- `docs/cat-catch-full-migration-execution-plan.md`
- `docs/cat-catch-sync-maintenance-guide.md`
