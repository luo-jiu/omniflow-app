# 资料库批量操作

`library.batch` 接收最多 50 项 `file.rename`、`file.move`、`file.copy` 或 `tag.update`，由一次 Tool Call 在 renderer 内逐项执行，不让模型串行编排。每项开始前校验当前账号、服务端、资料库及目标节点快照；失败不会回滚此前已提交项。

结果中的 `status` 可能为 `committed`、`uncommitted`、`commit_unknown`、`conflict`、`skipped` 或 `cancelled`。`commit_unknown` 必须先查询核对，禁止盲目重试；取消只影响尚未开始的项目。结果包含 `operationId`、每项 `affectedParentIds` 和计数，并限制在有界 JSON 内。
