# 第三方开源软件声明

OmniFlow 包含或改编了第三方开源项目的部分代码和实现经验。各第三方项目仍受其各自许可证约束；本文件不改变这些许可证，也不替代完整许可证文本。

当前这里只登记已经明确存在源码改编关系的项目。普通包管理器依赖的完整清单和许可证归档将在正式对外分发前通过自动化工具生成并核验。

## Cat Catch

- 项目：Cat Catch
- 上游仓库：https://github.com/xifangczy/cat-catch
- 许可证：`GPL-3.0-only`
- 版权所有者：Cat Catch contributors
- 使用方式：OmniFlow 的内置浏览器资源识别、页面 probe、HLS / DASH 解析和 key 验证等实现包含从 Cat Catch 改编的逻辑或经验规则。
- OmniFlow 改动：相关能力已按 Electron 主进程、页面注入、TypeScript 模型、本地下载器、ffmpeg 和资料库导入链路重新组织；未直接采用 Cat Catch 的扩展 UI 和浏览器下载工作流。
- 当前本地对照基线：截至 2026-08-18，`project/cat-catch` 位于提交 `2cb981d`（`2.7.2` 之后）。这用于维护审计，不表示所有上游代码均已纳入 OmniFlow。
- 许可证原文：https://github.com/xifangczy/cat-catch/blob/2cb981d7c2f4614732edccc167c4b5793d1cb138/LICENSE

修改或分发相关衍生代码时，应保留上游来源和本声明，并按 GPL-3.0-only 的要求提供相应源码和许可证信息。

## 维护规则

直接复制、修改或改编新的第三方源码时，应同步补充：

- 项目名称和官方来源
- 精确版本、tag 或 commit
- SPDX 许可证标识
- 原始版权声明
- 使用方式和修改范围
- 完整许可证文本或其仓库内归档位置

OmniFlow 自身代码采用何种许可证应由项目维护者单独决定，不在本文件中替代声明。
