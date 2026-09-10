# Agent 文件处理调研与实现

更新时间：2026-09-10。范围是聊天附件的接收、保存、检查、工具读取及模型输入；不调整 Composer 视觉设计，不修改资料库上传事务。

## 调研结论

- 本地 Codex 源码快照 `4b0d9669cc` 的 `core/src/tools/handlers/view_image.rs` 通过工具读取图片字节，返回 InputImage；日志只记录大小，不记录 data URL。PDF 解析没有被塞进这个图像工具。已安装 PDF skill 使用现成提取库和页面渲染工具组合读取。
- 本地 OpenCode 快照（目录没有 Git 元数据）的 `packages/opencode/src/tool/read.ts` 对图片和 PDF 返回 attachment，文本读取另走分页与输出预算。这证明文件 Tool 可以返回多模态结果，不代表所有 Provider 都支持同一种 PDF 文件字段。
- OmniFlow 原有消息图片通道只能处理用户附加图像，工具结果还是文本 JSON；附件 import 又要求非图片必须能按 UTF-8 解码，二进制文档无法进入后续处理。
- 当前工程已有 PDF.js 4.10.38 与其 Canvas 依赖。采用 PDF.js + @napi-rs/canvas，DOCX 使用 Mammoth，ZIP 预检查使用 yauzl。解析算法复用库，应用只负责身份、范围、资源上限和结果交付。

## 分层

1. import 保留原始文件副本并识别 image/text/document/file。上传成功只代表副本已保存，不代表解析成功。未知二进制可被检查，但不能被执行或假装读取。
2. AgentAttachmentStore 负责 owner/backend/library/session 授权与 immutable bytes，不把私有路径交给模型。
3. attachment.inspect 返回真实支持操作、PDF/PPTX 页数及 XLSX 工作表；attachment.read 返回正文分页；attachment.query 筛选和统计 XLSX；attachment.view 返回图片或渲染的 PDF/PPTX 页面。
4. PDF/DOCX/XLSX/PPTX 解析运行在单独 Node worker，30 秒超时、可取消、JS heap 上限；不在 Electron 主线程解析大文档。worker 是故障隔离，不声称为操作系统沙箱。PPTX 视觉转换另外使用受控 LibreOffice 子进程。
5. 视觉结果以受控 imageId 返回，派发方重新解析 session-bound 图片描述，进入 Tool message 的 attachments。持久化结果只保留引用，发送前才读取图片字节。

## 当前能力

| 输入 | 操作 | 保留限制 |
| --- | --- | --- |
| UTF-8 文本、代码、CSV | inspect/read | CSV 按文本读取，不承诺表格计算 |
| PNG/JPEG/WebP | inspect/view | 直接视觉输入和工具再次查看共用授权副本 |
| PDF | inspect/read/view | 每次明确处理一页；没有文字时提示查看页面，不把扫描页当空白结论 |
| DOCX | inspect/read | 正文按段落顺序提取，不承诺分页、表格排版、公式或图像保真 |
| XLSX | inspect/read/query | ExcelJS 读取工作表、A1 范围及公式缓存；筛选和统计明确报告缺失缓存 |
| PPTX | inspect/read/view（有条件） | 按实际幻灯片引用顺序提取文字与备注；真实页面渲染需要本机 LibreOffice |
| 其他二进制 | inspect | operations=[]，明确暂不支持解析；未接旧 DOC/XLS/PPT/OCR 引擎 |

PDF 页码从 1 开始，正文分页仍使用 offset/column/limit。正文 revision 包含源字节身份和页码，不允许把第一页的续读条件用于第二页。工具结果区分 hasMore（本页正文未完）和 hasMorePages（还有其他页）。DOCX 没有可靠页码，不接受 page。

## 表格与幻灯片契约

- XLSX inspect 列出工作表名称、行列数和隐藏状态。read 接受 sheet（默认首张工作表）与 range（如 A1:C100），逐行返回带单元格地址的 JSON。offset/column/limit 仍是返回文本的续读位置，不是 Excel 坐标。一次范围最多 100000 个单元格，输出正文最多 4M 字符。
- query 必须指定 range；filters 同时成立时保留行，支持 eq/contains/gt/gte/lt/lte。aggregate 的 sum/average/min/max/count 只统计数字，count 不是匹配行数；matchedRows 单独返回。没有数字时 count=0，其余统计值为 null。数值字符串不自动转数字，日期返回 ISO 文本。
- 不执行或重算公式，也不访问外部引用。公式同时返回表达式、缓存值与 hasCachedValue，零缓存保留为零。统计或筛选所需公式缺少缓存时返回 warnings、missingCachedValues/unknownFilterRows，统计 complete=false，不能把部分值当作完整总和。
- revision 同时绑定附件内容、工作表、范围、筛选与统计参数；改变查询条件后旧续读凭据失效。旧正文压缩保留查询参数，允许工具重新读取。
- PPTX 使用 OOXML presentation 关系顺序，不按 slide 文件名排序；备注沿 notesSlide 关系读取，保留段内换行。文本提取不声称已识别图片或所有图表。
- view 先确认没有宏或外部资源引用，再通过 LibreOffice 生成 PDF，最后复用 PDF 渲染。检查转换前后页数一致，并导出隐藏幻灯片以保持索引。外部普通超链接不点击、不抓取；外部图片等资源会禁止自动渲染。
- LibreOffice 是可选本机依赖：检查 OMNIFLOW_LIBREOFFICE_PATH、标准安装目录和 PATH，不绑定开发机私有路径、不自动安装。缺失时 inspect 只提供 read，view 明确报错。每次转换使用独立临时目录与用户配置、禁用宏、固定 argv 且 shell=false；45 秒转换超时，取消终止进程树并清理临时文件。view 总工具超时为 120 秒。

## 图像结果与上下文

Claude 在 tool_result 内放入 image 块。OpenAI-compatible Chat Completions 保留连续的 tool response，收齐本次调用批次后追加带“工具视觉结果”标记的图像消息；不在尚未配齐的工具结果之间插入 user 消息。上下文预算计算图片占用，Base64 不进入正文截断或 SQLite ToolRun。

历史摘要不能凭 imageId 推断图像内容；保留引用后可以再次 attachment.view。明确不支持图片的模型不暴露 view 工具。当前执行依赖聊天附件 source；资料库文档以后可复用同一 bytes-based processor，但尚未把 file.read 扩展为文档解析。

## 资源与打包

沿用附件总配额与单文件上限。DOCX/XLSX/PPTX 共用 ZIP 检查：最多 4096 个 entry，声明及实际流式解压总大小均不超过 32 MiB，不落地解压路径，拒绝加密与重复条目。PPTX XML 拒绝 DTD、实体声明和解析器修复的损坏结构。提取正文最大 4M 字符，超限明确失败。PDF 渲染最长边 2048px，内嵌图片像素受限；生成图像复用附件存储配额与 session 生命周期。

PDF.js 4.x 即使启用 stopAtErrors，也可能在移除超限 XObject 图像后完成 render。隔离线程因此收集解析警告：图片被移除、缺少尺寸或解码失败时拒绝提供完整预览，不能返回成功白页；其他警告随读取/查看结果返回。警告捕获只存在于单任务 worker，结束时恢复日志方法。

Vite 构建独立 agent-document-worker.js；Mammoth、yauzl 及其纯 JS 依赖进入 worker bundle，PDF.js 和 Canvas 显式打包，Canvas native 包通过 asarUnpack 处理。开发及打包目录都必须验证 worker 寻址，不能以浏览器 PDF Viewer 可显示就推定主进程读取可用。测试 host 不进入安装包。

同一会话重复查看同一 PDF 页面复用受控 imageId，每次命中仍校验 source 和 image 的 session 授权；缓存仅保存最多 128 条引用，图片字节由附件存储管理。读取正文与 file.read 共用完整结果预算打包逻辑，不能让 JSON 转义或页码信息挤掉正文后仍返回已前进的游标。旧附件正文可被清理，attachmentId/page/revision 保留用于重新读取。

## 验证与后续

自动化验证有效 PDF 的页数/正文、无文字图形页渲染、错误页码、DOCX 中文、无效 ZIP、会话隔离、图像引用及 OpenAI/Claude 工具结果顺序。真实验收使用非第一个资料库，让模型先 inspect/read，再 view 指定页并描述图形。

本轮 Node 与 Electron 20.16.0 运行时均通过构建产物 worker 的 PDF 读取/渲染和 DOCX 中文提取；页面像素检查确认渲染不是空白。取消与超时测试确认线程被终止。macOS arm64 未签名目录包内的同一 worker 也通过验证，修复了开发模式正常但安装包遗漏解析依赖的问题。Windows 运行未实测。

真实 OpenAI-compatible/gpt-5.5 联调完成：模型调用 inspect/read/view，正确返回 PDF 编号、DOCX 数量和无文字页面的绿色正方形描述。联调脚本使用合成文件、隔离的 owner/library/session 和临时附件目录；仅 --live 时读取现有 AI 配置并调用模型，不依赖资料库界面登录，不输出密钥。

可重复运行：先 npm run build，再 npm run agent:smoke-documents；真实连接使用 npm run agent:smoke-documents -- --live，默认模型 gpt-5.5，可用 OMNIFLOW_DOCUMENT_SMOKE_MODEL 覆盖。脚本与正式应用使用相同的安全存储应用身份，完成后清理临时附件及测试入口文件。

2026-09-10 Office 扩展验证：全量 2178 项测试通过；补充取消/超时测试后文档专项 18 项通过，lint/build 通过。Electron 本地 smoke 验证四种文档的导入、会话绑定、读取、XLSX 统计（结果 50）、PPTX 实际顺序与备注、LibreOffice 真实渲染及绿色图形像素。macOS arm64 目录包的 app.asar worker 已验证 XLSX/PPTX 动态模块可加载。真实模型联调本轮因保存的 API Key 解密失败未完成；锁屏期间不改写配置。Windows/亮色桌面及本轮 UI 手动交互未验证。

后续按实际使用补充 OCR、资料库文档 source，以及基于 immutable revision 的提取缓存。UI 由另一条任务维护，本轮不调整聊天附件布局。
