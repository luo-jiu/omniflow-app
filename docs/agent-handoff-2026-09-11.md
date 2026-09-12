# OmniFlow Agent 交接文档

更新时间：2026-09-11

## 当前结论

OmniFlow Agent 已覆盖三个执行平面：`library` 资料库、`run` 工作区和 `host` 本机。资料库操作使用结构化 Tool，本机开发使用受控 Shell，转换和生成优先经过 run 工作区。宿主真实路径、MinIO 凭据和存储 key 不暴露给模型。

当前工作的重点是可靠性：批量结果核对、网络中断后的 `commit_unknown`、内部文档阅读、模型切换后的上下文预算、自动压缩和真实 UI 验收。

## 已完成能力

### 资料库文件与目录

已接入：

- `file.list`、`file.search`、`file.stat`、`file.resolve`、`file.read`、`file.grep`
- `file.write`、`file.rename`、`file.move`、`file.copy`、`file.delete`
- `directory.create`
- `recycle.list`、`recycle.restore`
- `tag.list`、`tag.update`
- `library.batch`、`operation.verify`

写操作结果区分 `committed`、`uncommitted`、`commit_unknown`、`conflict`、`skipped` 和 `cancelled`。网络错误或超时后，必须先用 `operation.verify` 核对，不能直接重复写入。

`library.batch` 支持批量重命名、移动、复制和标签更新，每批最多 50 项，每项独立记录结果；一项失败不能覆盖其他已完成项。

### 内部文档

`library.document.inspect`、`read`、`query`、`view` 已支持资料库中的 PDF、DOCX、XLSX 和 PPTX，复用附件解析 worker 和授权链路，不需要先下载再上传。PDF 支持按页读取和渲染，XLSX 支持工作表和范围读取，PPTX 按幻灯片顺序读取文本；视觉结果只通过受控 `imageId` 传递。

### 附件与模型

前端支持多图片和文档附件，图片可通过剪贴板粘贴，并保持加入顺序。文本文件可直接阅读，PDF、DOCX、XLSX、PPTX 通过文档 Tool 处理。

模型预算优先使用本地 Codex 风格目录，服务端 `/models` 不能用错误的 16K 信息覆盖已知模型。当前约定为：`gpt-5.5` 272K，`gpt-6` / `gpt-6-astra` 约 1.05M，未知模型默认 128K。模型切换后必须重新计算预算；恢复发送前先压缩历史，再重新投影当前模型的工具 schema 和附件。

## 后端状态

`omniflow-go` 最近相关提交为 `d94674d feat(files): add independent node copy and atomic tag updates`，已包含：

- `POST /api/v1/nodes/:nodeId/copy`
- `GET/PATCH /api/v1/nodes/:nodeId/tags`
- 文件、目录、回收站、标签和文档处理链路

后端通常监听 `8850`，前端 Vite 通常监听 `8849`。当前环境只能使用 macOS 本机 MinIO；测试禁止使用第一个资料库，优先使用 `Win` 或其他非第一个资料库。

## 故障注入

开发环境支持一次性、精确匹配的 HTTP 故障注入：

```text
drop-response:POST:/api/v1/nodes/<nodeId>/copy
timeout:PATCH:/api/v1/nodes/<nodeId>/tags
```

仅匹配 localhost、开发环境和成功的 2xx 响应，每条规则只生效一次。专项测试位于 `electron/service/http-fault.test.ts` 和 `electron/service/agent/tools/operation-verify-tool.test.ts`。

## 工作树协作边界

`omniflow-app` 有大量未提交改动，其中包含另一位 agent 的会话历史卡片、附件展示和工具状态 UI。不要执行 `git reset --hard`、`git checkout --` 或 blanket `git add`，不要覆盖或回滚这些改动。提交时按功能分组查看 diff。`omniflow-go` 当前已有独立提交，前端未提交不代表功能不存在。

## 下一步优先级

1. 在同一个 OmniFlow Agent 会话中完成复制和标签的真实故障注入，验证无重复副作用。
2. 为 `library.batch` 补部分成功、冲突、取消和 `commit_unknown` 的 mock 测试。
3. 为文档 Tool 补授权失败、不可达、版本变化、路径推导和 `imageId` 测试。
4. 将当前会话级操作账本扩展为后端跨进程幂等账本，再结合资源状态核对。
5. 做真实 UI 验收：复制、标签、文件链接、工具状态、压缩提示和断线重连后的展示。
6. 统一长连接重试、候选回答去重、发送恢复、取消和提交不明协议。
7. 评估 main-owned 的 `apply_patch`，绑定文件 revision，支持 dry-run、差异预览和冲突拒绝。
8. 收紧后端 `AllowAll`，完成 actor、owner、library 成员和动作级权限校验。

## 验证命令

```bash
npm run lint
npm test
npm run build
GOCACHE=/tmp/go-build go test ./...
```

涉及 Agent UI、文件树、上传或文档时，还要按 `docs/frontend-validation-matrix.md` 做真实桌面验收，并记录 Run ID、模型、资料库和关键 ToolRun。

## 维护规则

新增或修改 Tool、scope、ResourceRef、HTTP / IPC、模型预算、压缩、附件、批量状态、重试、核对或权限规则时，必须同步更新本文档及对应专题文档。开发前遵守 `omniflow-app/AGENTS.md` 和 `omniflow-go/AGENTS.md`。
