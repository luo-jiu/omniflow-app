# 文件类型身份识别 — 终局规划草案

> **临时文档**。本文件只记录“文件类型身份识别”未来终局方案和迁移计划，不是长期架构文档。方案稳定并实施后，应删除本文件，并把最终契约回写到 `docs/file-explorer-file-viewer-boundary.md`、`docs/file-viewer-and-archive-viewer-map.md`、`docs/frontend-validation-matrix.md` 和后端对应文档。

更新时间：2026-05-11

## 1. 背景

当前文件识别过度依赖后缀。后缀在真实文件系统里不是唯一语义，例如：

- `.ts`：可能是 TypeScript，也可能是 MPEG Transport Stream 视频。
- `.m4a`：通常是音频，也可能被视频容器工作流误用。
- `.ass`：常见是字幕，但在代码 / 文本场景里也只是普通文本。
- `.h`：C / C++ / Objective-C header 共享后缀。
- `.bin` / `.dat`：几乎只能靠内容或用户纠错。

如果目录树、tab 图标、双击预览、viewer 分发、上传导入各自按后缀判断，同一个节点会出现多套结论：树上像 TypeScript，打开却进视频 viewer；或者上传时识别成视频，tab 又显示普通文件图标。终局目标是把“文件类型身份”收敛成一个跨前后端共享的事实。

## 2. 目标

终局方案要满足：

- 同一个节点在目录树、tab、预览 viewer、资源归档、搜索和导入结果中使用同一份类型身份。
- 后缀只是最后 fallback，不是主判断依据。
- 识别结果可解释、可迁移、可重新检测、可人工纠错。
- 历史数据没有 `mimeType` 或检测结果时，仍能用业务上下文和后缀安全降级。
- 冲突后缀不需要每次单独 patch UI；新增冲突只改 resolver 规则和检测器。
- 前端不为了识别类型频繁请求数据库或下载大文件。

## 3. 核心概念

### 3.1 File Identity

`FileIdentity` 是节点文件身份的统一结果，不等同于后缀，也不等同于 MIME。

建议结构：

```ts
type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'archive' | 'other';

type FileIdentity = {
  previewKind: PreviewKind;
  iconKind: string;
  mimeType: string | null;
  detectedMimeType: string | null;
  detectedKind: PreviewKind | null;
  manualKind: PreviewKind | null;
  confidence: 'manual' | 'detected' | 'mime' | 'context' | 'extension' | 'unknown';
  ambiguous: boolean;
  reason: string;
  detectionVersion: number;
};
```

使用原则：

- `previewKind` 决定 viewer 分发。
- `iconKind` 决定目录树和 tab 图标。
- `confidence` 和 `reason` 用于调试、属性弹框和后续批量修复。
- `manualKind` 是用户纠错最高优先级。
- `detectedKind` 是系统内容探测结果。

### 3.2 识别优先级

统一 resolver 按以下优先级返回 `FileIdentity`：

1. **人工覆盖**
   - 用户明确选择“按视频打开 / 按文本打开”等。
   - 写入节点级 `manualKind` 或 `contentKindOverride`。
2. **系统内容探测**
   - 上传、导入、后台重扫时通过 magic number、MIME detector、ffprobe 等识别。
   - 写入 `detectedMimeType`、`detectedKind`、`detectionVersion`。
3. **可信 MIME**
   - 后端已有 `mimeType` 且属于可信来源时直接使用。
   - 例如 `video/mp2t` 判为 `video`，`text/typescript` 判为 `text`。
4. **业务上下文**
   - 父目录 `builtInType`、`archiveMode`、资源模板、归档 viewer 入口。
   - 例如 VIDEO 归档中的 `.ts` 在无 MIME 时更倾向 MPEG-TS。
5. **后缀 fallback**
   - 最后一层才查后缀表。
   - 冲突后缀必须标记 `ambiguous=true`。
6. **unknown**
   - 不确定时返回 `other`，并允许用户手动指定类型。

### 3.3 冲突后缀表

维护一份显式 `AMBIGUOUS_EXTENSIONS`，用于提示 resolver 不要过度自信。

第一批：

| 后缀 | 可能语义 | 默认 fallback |
| --- | --- | --- |
| `.ts` | MPEG-TS 视频 / TypeScript | 普通目录默认 text；VIDEO 上下文默认 video |
| `.m4a` | 音频容器 / 误标视频容器 | audio |
| `.ass` | 字幕 / 普通文本 | text/subtitle |
| `.h` | C header / C++ header / Obj-C header | text |
| `.s` | assembly / 普通文本 | text |
| `.bin` | 任意二进制 | other |
| `.dat` | 任意数据文件 | other |

冲突后缀默认不代表错误，只代表“需要更高优先级信号才能确定”。

## 4. 后端终局设计

### 4.1 节点字段

建议在节点表或节点元数据中沉淀：

| 字段 | 说明 |
| --- | --- |
| `mime_type` | 当前对外 MIME，兼容现有字段。 |
| `detected_mime_type` | 系统内容探测得到的 MIME。 |
| `detected_kind` | 系统探测得到的预览大类。 |
| `detected_icon_kind` | 可选，系统建议图标类型。 |
| `detected_source` | `magic` / `ffprobe` / `browser` / `extension` / `manual` / `migration`。 |
| `detection_version` | 检测规则版本，便于规则升级后重扫。 |
| `detected_at` | 最近探测时间。 |
| `content_kind_override` | 用户手动覆盖的预览大类。 |
| `content_kind_override_source` | `user` / `system_admin` / `migration`。 |

`content_kind_override` 不应覆盖原始 MIME 字段；它只是 resolver 的最高优先级输入。

### 4.2 检测流水线

文件进入系统时执行检测：

1. 上传前端提供浏览器 `file.type`，作为弱信号。
2. 后端保存文件后读取文件头 magic number。
3. 视频 / 音频候选文件调用 ffprobe 获取 container / stream 信息。
4. 文本候选文件读取前几 KB 判断是否 UTF-8 / UTF-16 文本，并可识别 TypeScript / JSON / XML 等轻量语法特征。
5. 写入检测字段和版本。

检测器不要为了准确读取整个大文件。对 6GB MPEG-TS 这类文件，应只读文件头或让 ffprobe 做有限探测。

### 4.3 后台重扫

需要一个可重复、可暂停、可观测的重扫能力：

- 按 library / directory / node 范围重扫。
- 只重扫 `detection_version` 过期或检测字段为空的节点。
- 支持 dry-run，先输出将要变更的数量和样例。
- 不覆盖用户手动 `content_kind_override`。
- 记录检测失败原因，避免同一坏文件反复消耗资源。

### 4.4 API 契约

节点相关接口应返回 resolver 所需字段：

```ts
type NodeFileIdentityDTO = {
  mimeType?: string | null;
  detectedMimeType?: string | null;
  detectedKind?: PreviewKind | null;
  detectedIconKind?: string | null;
  detectedSource?: string | null;
  detectionVersion?: number | null;
  contentKindOverride?: PreviewKind | null;
};
```

目录树列表、节点详情、搜索结果、上传结果都应带这组字段，避免前端为了显示图标再单独请求详情。

## 5. 前端终局设计

### 5.1 单一 resolver

前端新增统一模块，例如：

```text
src/features/file-identity/
  resolver.ts
  types.ts
  ambiguous-extensions.ts
  icon-map.ts
```

统一入口：

```ts
resolveNodeFileIdentity({
  name,
  ext,
  mimeType,
  detectedMimeType,
  detectedKind,
  detectedIconKind,
  contentKindOverride,
  parentBuiltInType,
  parentArchiveMode,
});
```

禁止目录树、tab、viewer 分发继续各自按后缀猜。

### 5.2 使用范围

必须接入同一个 resolver 的地方：

- `useRepositoryTree` 双击打开：`previewKind` 决定 `fileType`。
- `file-node-icon`：`iconKind` 决定图标。
- `FileTabsBar`：tab 图标使用打开时的 identity 或 tab 上保存的 `fileType + iconKind`。
- `file-dispatcher`：只吃 `fileType`，不再二次猜类型。
- 文件属性弹框：展示 `MIME / 检测结果 / 置信来源 / 是否手动覆盖`。
- 搜索结果和资源列表：和目录树图标一致。

### 5.3 手动纠错 UI

文件属性或右键菜单增加：

```text
按类型打开 / 设置文件类型
  自动识别
  文本
  视频
  音频
  图片
  PDF
  其他
```

规则：

- 选择“自动识别”清空 `contentKindOverride`。
- 选择具体类型写入 override，立即刷新目录树、tab 和后续打开结果。
- 如果当前 tab 正在打开同一节点，提示是否按新类型重新打开。

### 5.4 调试和可解释性

属性弹框建议展示：

```text
文件类型：视频
来源：系统探测
MIME：video/mp2t
后缀：ts
冲突后缀：是
规则版本：3
```

这会让 `.ts` 这类问题可解释，而不是“系统又猜错了”。

## 6. `.ts` 终局行为

### 6.1 MPEG-TS 视频

文件：

```text
19868c9f90e711a9abfd252e7c7faf86f0db2de9cda_hls_2plax_00001.ts
```

理想 identity：

```ts
{
  previewKind: 'video',
  iconKind: 'video',
  mimeType: 'video/mp2t',
  detectedMimeType: 'video/mp2t',
  detectedKind: 'video',
  confidence: 'detected',
  ambiguous: true,
  reason: 'detected MIME video/mp2t for ambiguous extension ts',
}
```

行为：

- 目录树显示视频图标。
- tab 显示视频图标。
- 双击进入 video viewer。
- 属性弹框说明 `.ts` 是冲突后缀，但系统探测为 MPEG-TS。

### 6.2 TypeScript 文件

文件：

```text
vite.ts
```

理想 identity：

```ts
{
  previewKind: 'text',
  iconKind: 'typescript',
  mimeType: 'text/typescript',
  detectedMimeType: 'text/typescript',
  detectedKind: 'text',
  confidence: 'detected',
  ambiguous: true,
  reason: 'detected text/typescript for ambiguous extension ts',
}
```

行为：

- 目录树显示 TypeScript 图标。
- tab 显示 TypeScript 图标。
- 双击进入 text viewer。

## 7. 迁移计划

### Phase 1：前端 resolver 收口

状态：已开始落地。当前前端新增 `src/features/file-identity/`，并把目录树图标、双击打开、tab 图标、视频归档 sidecar 和 ASMR 列表的类型判断收敛到统一 resolver；后端检测字段尚未接入。

- 新增 `file-identity` resolver。
- 目录树图标、tab 图标、双击打开统一调用 resolver。
- 使用现有 `mimeType + ext + name + parentBuiltInType + archiveMode`。
- 对 `.ts` 做冲突后缀规则：
  - `mimeType` 为 `video/*` 或 `video/mp2t` 时判视频。
  - `mimeType` 为 `text/*` 或 TypeScript 相关时判文本。
  - VIDEO 上下文缺 MIME 时判视频。
  - 否则 fallback TypeScript。

### Phase 2：后端检测字段

- 增加检测字段和迁移。
- 上传 / 导入时写入检测结果。
- API 返回 identity 字段。
- 前端 resolver 优先使用检测字段。

### Phase 3：历史数据重扫

- 增加后台重扫任务。
- 先 dry-run 输出冲突后缀统计。
- 分 library 执行迁移。
- 对 `.ts` 历史文件重点验证：
  - 大 HLS / MPEG-TS 视频。
  - 真实 TypeScript 源码。
  - MIME 为空或错误的老文件。

### Phase 4：用户纠错

- 属性弹框和右键菜单支持手动设置文件类型。
- 后端保存 override。
- 目录树、tab、viewer 即时刷新。

### Phase 5：长期治理

- 每次新增 viewer 或资源类型，必须更新 resolver 和检测器。
- 每次发现新的冲突后缀，先补 `AMBIGUOUS_EXTENSIONS` 和测试，再改 UI。
- 文档从 WIP 回写到正式专题，删除本文件。

## 8. 验证矩阵

最低验证：

- `.ts` MPEG-TS：目录树视频图标、tab 视频图标、双击进 video viewer、拖动播放正常。
- `.ts` TypeScript：目录树 TypeScript 图标、tab TypeScript 图标、双击进 text viewer。
- MIME 为空的 `.ts`：
  - VIDEO 目录下默认视频。
  - 普通目录下默认 TypeScript。
- 用户手动覆盖：
  - TypeScript 改为视频后，树 / tab / viewer 一致。
  - 清空覆盖后回到自动识别。
- 历史数据：
  - 无检测字段节点仍可打开。
  - 检测字段存在时不因后缀 fallback 改变结果。
- 性能：
  - 目录树加载不额外逐节点请求详情。
  - 大文件不在前端读取内容判断类型。

## 9. 维护规则

本规划落地前：

- 不要继续在目录树、tab、viewer 内新增局部后缀判断。
- 遇到新的后缀冲突，先补到本文件的冲突后缀表和终局 resolver 设计。
- 如果短期必须修 UI，修法也要朝统一 resolver 迁移，不要扩大散落判断。

本规划落地后：

- 删除本文件。
- 把 resolver 契约写入正式文档。
- 把后端检测字段和重扫机制写入后端专题文档。
- 把验证项回写到 `docs/frontend-validation-matrix.md`。
