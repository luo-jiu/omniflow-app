# 资料库文档工具

更新时间：2026-09-11

资料库中的 PDF、DOCX、XLSX、PPTX 通过 `library.document.inspect/read/view/query` 读取。工具只接收已确认的 `nodeId` 和格式，下载地址由主进程授权 broker 临时取得，模型不会看到物理 URL。

## 运行边界

- 读取前由 broker 校验账号、资料库、运行会话和节点身份；下载完成后由现有 reader 校验文件大小、节点快照和版本变化。
- 源存储不可达、权限失败、文件版本变化、取消和超时都会作为失败返回，不把元数据存在误报为正文可读。
- `inspect` 返回文档引擎实际支持的操作；`read` 读取文字，PDF/PPTX 支持 `page`，XLSX 支持 `sheet/range`；`query` 仅用于 XLSX；`view` 负责 PDF/PPTX 页面渲染。
- 页面图片沿用现有 Agent 图片协议的后续接入边界，工具结果不返回本机路径。

## 维护规则

文档解析规则、大小限制和分页语义以 `documents/document.types.ts` 与 `documents/document-engine.ts` 为准。新增格式必须先扩展统一引擎，再增加工具 schema，不在工具内实现独立解析。
