# 音频归档与字幕文件计划

更新时间：2026-05-04

## 背景

媒体控制中心收尾后，下一阶段要支持更通用的音频归档语义。当前 `ASMR` 已经覆盖一类音频集合，但它偏内容类型；新增 `AUDIO` 内置类型用于表达普通音频归档目录。

字幕文件不应作为独立音频条目展示，而应视为同名音频的附属文件。

## 目标语义

- 新增内置类型 `AUDIO`。
- `AUDIO` 只能设置到文件夹，不能设置到文件。
- `AUDIO + archiveMode=1` 表示音频归档目录。
- 音频归档默认折叠隐藏字幕文件。
- 右键音频归档目录可切换“显示隐藏文件 / 隐藏文件”。
- 右键音频归档内的某个音频文件也可切换“显示隐藏文件 / 隐藏文件”，但只展开该音频自己的字幕。
- 音频归档也支持“按名称排序”，让同名音频和字幕自然相邻。

## 字幕匹配规则

同一级目录下，文件 `name` 相同且扩展名不同：

- 音频文件：`歌名.mp3`
- 字幕文件：`歌名.lrc` / `歌名.srt` / `歌名.vtt` / `歌名.ass`

则字幕文件归属于该音频。

优先使用节点的结构化字段判断：

- `name`：不含扩展名的可见名
- `ext`：文件扩展名

不要从拼接后的展示文本里反向拆。

## 目录树显示规则

默认状态：

- 展示音频文件。
- 隐藏同名字幕文件。
- 非音频、非字幕文件继续显示，但使用警告图标，提示其不匹配音频归档语义。
- 有字幕的音频和无字幕的音频使用不同图标。

显示隐藏文件时：

- 对归档目录触发：显示该目录下所有字幕文件。
- 对单个音频触发：只显示这个音频匹配到的字幕文件。
- 单个音频展开的字幕必须紧贴在音频文件正下方，不受当前排序状态影响。
- 再次选择“隐藏文件”后，字幕文件从目录树中消失。

## 右键菜单

音频归档目录右键增加：

- 按名称排序
- 显示隐藏文件 / 隐藏文件

音频归档内的音频文件右键增加：

- 显示隐藏文件 / 隐藏文件

交互定位：

- “按名称排序”类似漫画内置类型的特殊动作。
- “显示隐藏文件”是目录树局部临时状态，不改变后端节点数据。

## 图标计划

需要从 `icons` 中挑选并复制到现有前端图标资源目录：

- 音频归档目录图标
- 普通音频文件图标
- 带字幕音频文件图标
- 字幕文件图标

图标命名不要刻意叫 VSCode，只保留业务语义。

## 实现落点

前端：

- `src/features/file-explorer/components/directory-tree/context-menu/DirectoryContextMenu.tsx`
- `src/features/file-explorer/components/directory-tree/index.tsx`
- `src/features/file-explorer/hooks/use-repository-tree/tree-utils.ts`
- `src/features/file-explorer/hooks/useRepositoryTree.ts`
- `src/features/file-explorer/utils/file-node-icon.tsx`
- `src/features/file-explorer/services/file.api.ts`
- `src/features/file-viewer/components/file-dispatcher/index.tsx`
- `src/components/business/app-main/FileTabsBar.tsx`
- `src/components/business/app-main/tab-type-tone.ts`

后端：

- `internal/usecase/node.go`
- `internal/usecase/node_archive.go`
- `internal/repository/postgres/impl/node/node_archive.go`
- `internal/transport/http/handler/node_mutation.go`
- `internal/transport/http/router/routes_node.go`

文档：

- `docs/built-in-type-and-archive-mode.md`
- `docs/file-viewer-and-archive-viewer-map.md`
- 必要时新增 `docs/viewers/audio-archive-viewer.md`

## 建议实施顺序

1. 新增 `AUDIO` 内置类型的前端菜单、标签、图标和目录双击入口。
2. 后端把按名称排序从 `COMIC` 扩展为 `COMIC / AUDIO`，或提供通用排序接口。
3. 前端目录树增加音频归档字幕隐藏的派生展示逻辑。
4. 增加目录级和单音频级“显示隐藏文件”临时状态。
5. 补齐音频归档 viewer / dispatcher / tab 标签映射。
6. 更新长期文档与验证矩阵。

## 验证清单

- 普通目录不受字幕隐藏逻辑影响。
- `AUDIO` 只能设置到文件夹。
- `AUDIO + archiveMode=1` 双击进入音频归档。
- 默认隐藏字幕文件。
- 目录级“显示隐藏文件”显示全部字幕。
- 单音频“显示隐藏文件”只显示自己的字幕。
- 字幕紧贴对应音频下方。
- 按名称排序后，同名音频和字幕仍相邻。
- 非音频、非字幕文件显示警告图标。
- 关闭或刷新树后，临时显示隐藏状态不会污染后端数据。
