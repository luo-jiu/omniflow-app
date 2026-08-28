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

当前首批已落地：

- `network/rules.ts`：固定上游默认规则与大小判断语义。
- `network/classifier.ts`：纯 request/response 分类和去重决策。
- `network/request-url-helpers.ts`：页面 URL pattern、黑白名单反转与 special-page 规则。
- `hls/parser.ts`：固定 hls.js/Cat Catch 的 manifest 下载相关解析语义。
- `hls/plan.ts`：把 parser 输出投影为平台 adapter 消费的唯一 HLS 下载计划。
- `hls/segment-query.ts`：固定 `tsAddArg` 的默认值提取和 fragment-only query 改写。

HLS 的 main/preload/renderer 共享 DTO 由 `../contracts/hls.ts` 唯一定义；生产调用方直接依赖 contract/port。renderer 旧 model 文件在初始 cutover 完成前只做同名 re-export，且仅由 parity test 保持 cleanup sentinel 存活，不再拥有类型、plan 算法或生产调用方。Electron main 运行时不得反向依赖 renderer model。

逐项状态以 capability map 为准。network target 已进入 production composition，但整个 `network-capture` unit 完成前仍未原子切换旧 listener；HLS parser/plan 已是生产路径的唯一算法 owner，renderer compatibility model 只做 re-export，但整个 `hls-engine` unit 仍因旧 local/live/controller owner 未删除而没有 cutover。

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
