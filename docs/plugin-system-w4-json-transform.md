# W4 JSON 处理插件

更新时间：2026-09-22
状态：本批限定 macOS 功能范围已验收。第二样板已完成独立构建，并通过真实 Win 资料库 UI 端到端验证。

## 当前结论

W3 的 `file-output` 宿主链路已经能够承载第二个处理插件，无需新增插件专属 API、数据库表或上传事务。`example.json-transform` 读取一个 UTF-8 JSON 文件，支持对象/数组根、顶层字段选择和 pretty 输出，仍生成 `application/json` 新文件。

样板独立于 CSV 解析器、列筛选和 CSV 转义逻辑，复用 SDK 0.5.0、资源分块读取、产物确认、受管 artifact、上传回执和目录刷新链路。

## 已完成

- 独立 Manifest、SDK 调用、JSON 读取和完整产物生成。
- 源文件上限 4 MiB，产物上限 1 MiB；超限或无效 JSON 明确失败，不生成截断结果。
- 独立构建、打包和开发包样板清单已接入。
- 插件管理页按 `output.mediaTypes` 与 `maxBytes` 展示声明能力，避免 CSV 专用文案。
- JSON 处理单元测试和离线构建通过。
- 真实 gpt-5.5 使用 `example.json-transform@0.1.1` 读取 W3 生成的 JSON，经过同样的范围和产物确认后创建新文件 `omniflow-w4-json-20260922.json`，证明宿主链路可复用。

## 当前边界

首期仍只允许 `text/csv` 与 `application/json`，不借第二样板顺手开放 Markdown、图片或任意 MIME。Artifact、上传、审批和回执服务继续保持公共实现；只有实际出现新格式需求时，才抽取共享格式策略。

后端新增了 Agent 产物上传的 strict parent 语义：插件产物上传在 init、complete 和最终创建节点时都要求目标目录存在且属于当前资料库，避免目录删除竞态时静默回退资料库根目录。普通上传保持旧兼容行为。

## 验证

自动化、独立离线构建和真实 UI 已通过。真实 UI 使用 Win（libraryId=3）、本机 local-minio、W3 生成节点作为输入，并创建新的 JSON 节点；首次 0.1.0 样板因仍要求宿主已剥离的 `resource/destination` 字段而失败，随后在样板层修复并升至 0.1.1，未产生写入副作用。Windows/Linux、发行包、长期性能和真实故障查询点击仍后置。
