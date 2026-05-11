# 标签管理前端说明

更新时间：2026-05-11

适用范围：`src/features/tag-management`、`src/views/tag-management`、ASMR 标签选项读取和历史顶部文件标签映射。

## 1. 概述

前端标签能力分为两类：

- 顶部标签：`type=FILE_TAB`，历史上用于文件预览 tab 的短标签与颜色映射；当前文件 tab 已改为复用目录树图标，不再读取该映射。
- 资源标签：用于 ASMR、漫画、音频、视频、普通文件和文件夹等资源，支持 `scope / dimension / resourceKind` 多维字段。

现阶段前端只提供轻量管理入口，不在本轮实现文件 / 文件夹通用打标签页面。
标签类型、资源域和维度的下拉选项由前端固定维护；数据库保存的是具体标签记录及其 `type / scope / dimension / resourceKind` 字段值。

## 2. 核心概念

`TagItem` 保留旧字段：

- `type`
- `targetKey`
- `color / textColor`
- `sortOrder`
- `enabled`
- `description`

新增字段：

| 字段 | 说明 |
|---|---|
| `scope` | `resource` 或 `ui` |
| `dimension` | `genre / creator / character / series / source / language / region / technical / status / custom` |
| `resourceKind` | `asmr / comic / audio / video / file / folder / general` 等资源类型 |
| `targetKinds` | 标签允许贴到的具体对象，例如 `file / folder / archive_root / asmr_work / comic_work / audio_track / audio_album / video_file / video_collection` |

## 3. 契约

`fetchTags` 兼容旧调用：

```ts
await fetchTags('ASMR');
await fetchTags('FILE_TAB');
```

也支持新过滤对象：

```ts
await fetchTags({
  scope: 'resource',
  dimension: 'creator',
  resourceKind: 'comic',
});
```

创建和更新标签时，前端会把：

- `type` 转为大写
- `scope / dimension / resourceKind` 转为小写
- `targetKinds` 作为数组提交；资源标签至少选择一个可贴对象
- `FILE_TAB` 的 `scope` 固定为 `ui`，`resourceKind` 置空
- `FILE_TAB` 不提交资源绑定策略，`targetKinds` 固定为空数组
- 后端更新接口采用补丁语义：未携带 `targetKinds` 时保留原可贴对象；标签管理页会在编辑和启停时显式提交当前值，避免用户配置丢失。

## 4. 实现边界

- ASMR viewer 仍按 `fetchTags('ASMR')` 读取标签，避免一次性改动 viewer 行为。
- 文件预览 tab 当前复用目录树图标解析，不再按 `fetchTags('FILE_TAB')` 读取颜色映射，也不再生成 `IMG / MP4 / PDF` 等文字胶囊。
- 通用文件 / 文件夹打标签入口后续再做，届时应复用 `TagItem` 与后端 `node_tag_rel`，不要在前端另建一套标签状态。
- 标签颜色是标签自身的固定色，不随明暗主题自动变化；主题只影响弹框背景、边框和说明文字等 UI 容器。
- 标签编辑弹框的主色色盘按 `1 ~ 5` 明暗档位展示，当前档位仅是编辑器 UI 偏好，持久化在 `localStorage` 的 `tag-management:primary-color-tone:v1`，不写入标签数据本身。用户仍可通过 Semi `ColorPicker` 选择任意颜色。
- 标签启用 / 停用在标签列表中直接切换，编辑弹框只负责名称、归属、颜色、排序和说明等内容字段。
- 标签编辑弹框里的“可贴对象”只控制标签绑定策略，不代表资源归档类型本身；真正能否保存到节点，仍由后端根据 `tag_bind_policies` 与 `node_resource_targets` 做最终校验。

## 5. 验证方式

最低验证：

- `npm run lint`
- `npm run build`
- 标签管理页能创建 / 编辑资源标签与顶部标签。
- ASMR 标签选择仍能读取 `ASMR` 标签。
- 文件预览 tab 应与目录树同名文件使用同一图标；`FILE_TAB` 历史映射不再影响文件 tab 展示。

## 6. 维护规则

出现以下变化时必须更新本文档：

- 新增标签维度或资源类型。
- 新增文件 / 文件夹通用打标签页面。
- `fetchTags` 或标签写入 payload 发生契约变化。
- ASMR、漫画、音频、视频 viewer 的标签读取方式改变。
