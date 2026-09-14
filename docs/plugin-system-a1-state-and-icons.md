# A1 主题事务、快照与图标契约

更新时间：2026-09-14

状态：纯模型现已由 ThemeContext 和目录图标实际使用，存储/IPC/设置接入见 [外观系统](appearance-system.md)。本文记录内部模型约束；A1 最终结果见 [验收记录](plugin-system-a1-acceptance.md)。

## 1. 主题事务模型

[theme-state.ts](../src/features/appearance/theme-state.ts) 提供 `createThemeState`、`transitionTheme` 和 `createThemeSnapshot`。这些都是纯函数，无模块级单例，不访问网络或存储。由既有 ThemeContext 持有唯一 state；不得把本模型另外实例化为同步的第二个主题 owner。

选择包括 mode、colorThemeId、iconThemeId 和已校验的 overrides。颜色与图标 ID 独立；输入被归一化、复制并冻结，非法颜色或效果在改变 state 前拒绝。当前账号 scope 为 anonymous 或规范的安全整数 user ID；这是状态隔离标识，不是授权证明。

| 状态 | 含义 | 可见选择 |
| --- | --- | --- |
| committed | 已加载或保存成功的选择 | 没有预览和保存任务时使用 |
| preview | 尚未请求持久化的候选 | 优先显示 |
| pendingSave | 用户已确认、正在等待保存结算的候选 | 没有更晚预览时显示 |
| pendingLoad | 当前初始化请求及启动时的 interactionRevision | 不直接改变显示 |

不同状态记录不同阶段，不是多个同步事实源。当前显示由 preview → pendingSave → committed 推导，不另存 activeSelection。

### 1.1 预览、确认与保存

- preview 创建新的操作 token，递增 interactionRevision，不返回写入指令。重复预览视为更新候选并使旧预览 token 失效。
- cancel 只接受当前预览 token，清除 preview；恢复到当前保存候选或最新 committed。旧对话框的取消不能清除新预览。
- confirm 将当前 preview 转为 pendingSave，并返回一次 `write: {token, selection}` 描述。重复 confirm 不会产生重复写入；实际写入由宿主适配执行。
- 同时最多一个 pendingSave。保存时可继续预览，但确认新预览会返回 save-pending，等待旧保存结算后才允许再次确认；没有偷偷丢弃或并发提交候选。
- 匹配的 save-result 成功才更新 committed，明确失败则保留旧 committed；两种结果均清除 pendingSave，均不覆盖更晚 preview。旧 token 回包无效。
- `success: false` 只表示**已明确没有成功提交**。超时或网络错误不能直接映射为 false；结果不明确时宿主继续保留 pendingSave，核对后再结算，不自动重放。第一批设备存储接入和以后远端偏好接入分别落实这一契约。

### 1.2 初始化、账号与系统主题

- begin-load 仅在没有 preview/pendingSave 时开始，记录操作 token 和 interactionRevision；新 load 替代旧 load，旧回包不应用。
- load-result 必须匹配当前 token，且请求以来没有用户预览、没有当前预览或保存任务，才能更新 committed。即使用户预览后又取消，也不允许旧初始化覆盖用户交互后的选择。
- load-failed 只清理匹配请求，不修改 committed，不影响后来请求。
- scope 切换递增 scopeGeneration、装入新 scope 的初始选择并清空 preview/pendingLoad/pendingSave。即使随后回到同一账号，旧 generation 的回包仍无效。
- 已发出的写入不能靠纯模型撤回。宿主必须将写入绑定原账号、捕获操作上下文、停止旧会话准入，不能把旧 token 的写入改用新账号凭据执行。
- system 变化只更新 systemMode，保留用户选择的 mode。只有 mode=system 才从 systemMode 推导实际明暗；不在模型中注册 matchMedia。

## 2. 快照与迟到消息

每次实际转换递增 revision，操作编号与 scopeGeneration 单调递增；计数溢出明确抛错。ownerEpoch 由实际宿主提供，重建 owner 时必须使用新值，不在纯函数中读取时间或生成随机身份。

快照包含 schemaVersion、ownerEpoch、accountScope、scopeGeneration、revision、requested、resolved、phase 与 fallbackReason。requested 保留用户选择意图；已选颜色包缺失时 resolved 回退默认并报告 missing，非法包报告 invalid。主题目录返回与请求不符的包 ID 时抛错，不能静默使用另一个包。

图标包 ID 当前保留在 requested 中，图标资产有效选择由第 3 节独立解析，不从颜色结果推导。没有全局图标包可用性 registry 或安装记录。

已选包安装、更新、停用或移除时，宿主须派发 catalog-changed 递增 revision，再从新的目录投影快照；仅替换 lookup 而不更新 revision 会使消费者按旧版本丢弃变化。该动作不改用户选择、预览和保存事务。

`isNewerThemeSnapshot` 仅负责顺序检查：

1. 消费方提供其从可信宿主获知的 expected ownerEpoch/accountScope/scopeGeneration。
2. incoming 必须匹配 expected，revision 为非负安全整数。
3. 同一来源只接受更大的 revision；来源变化后可接收 revision 从零开始的快照。
4. 不比较 epoch 字符串大小，不凭收到一个新 epoch 就切换信任来源。

该函数不是 IPC 权限校验器，也不验证完整消息 schema。真正接入时仍需校验来源、完整快照、包体积、scope 切换与订阅生命周期。不能把传输 payload 自报的 epoch 当可信 expected。

## 3. 图标语义、包声明与资产选择

[icon-theme.ts](../src/features/appearance/icon-theme.ts) 提供三个独立步骤，不导入 React、不写节点状态。

### 3.1 目录语义

`resolveDirectoryIconSemantic` 读取 builtInType、archiveMode、expanded，返回 folder.* 语义键、expanded 和宿主 warnings。已知类型为 DEF/COMIC/ASMR/VIDEO/AUDIO/GALLERY；非 DEF 的归档使用 `.archive` 后缀，开合不改变语义键。

未知类型使用 folder.unknown 并报告 unknown-type；DEF + archive=1 报告 invalid-default-archive，不改写事实。**现有 getDirectoryBuiltInIcon 在 DEF+archive=1 返回 undefined 的行为仍保留**；已接入的语义适配继续保留该分支，不能把新 fallback 当成既有黑盒行为。

文件图标语义仍由现有 file-identity/文件名映射链负责；当前只允许包声明 file.* 键，没有新增第二套文件类型解析器。

### 3.2 声明校验

图标包候选格式：schemaVersion=1、稳定 id、icons。icons 最多 512 个条目，键限 folder.* / file.* 语义，长度最多 128；每个条目必须有 closed，可选 open。整包非法时拒绝，不部分加载；校验结果复制并冻结，声明不是运行脚本。

资产路径长度最多 240，仅限 ASCII 字母/数字、下划线、短横线、点和正斜杠，扩展名为 svg/png/webp。拒绝绝对路径、空段、点/双点段、反斜杠、协议、百分号编码、query、fragment、尾点段和 Windows 保留设备名。

**这只是词法校验，不表示资产可以安全加载。** 安装阶段仍须检查真实包内路径、符号链接、文件存在性、大小、MIME、SVG 执行内容和外部引用。当前已有声明式 SVG 子集的拒绝式内容校验与内置资产测试；仍没有第三方解包器或安装服务，不把词法检查当成安全验收。

### 3.3 选择和宿主提示

`selectIconAsset` 的输入是宿主已经匹配的候选，顺序固定为 node → association → theme → provider → core，与数组顺序无关。每层只能有一个匹配候选；选中层发生同级冲突时抛错，不按安装顺序覆盖。

选中包缺少 open 时回退自己的 closed；该优先级没有候选才继续下一级。声明了路径但文件缺失的情况需要安装/资产层剔除或拒绝该候选，本纯函数不读取磁盘。没有候选时返回 null path，由宿主提供最小 fallback。

错误、离线、未知类型等 requiredDecorations 来自宿主事实，与资产分开返回并去重。图标包没有隐藏它们的字段；最终渲染器仍须实际叠加这些提示。自绘第三方界面不在此保证范围。

## 4. 验证与接入边界

[状态模型测试](../src/features/appearance/theme-state.test.ts) 覆盖取消、确认一次性写入、保存期间新预览、明确失败、账号往返、过期初始化、失败初始化、系统主题、包缺失、catalog ID、epoch 与输入隔离。

[图标测试](../src/features/appearance/icon-theme.test.ts) 覆盖目录类型/归档、开合不改事实、危险路径、整包拒绝、优先级、closed 回退、同级冲突和宿主提示保留。它们不替代真实存储/IPC、SVG 内容、目录树交互或跨平台视觉测试。

当前模型已由真实 owner 使用，新增 owner/IPC 回归与运行验收结果统一见 [A1 验收记录](plugin-system-a1-acceptance.md)。

本机持久化、ThemeContext 单一 owner、可信快照订阅、目录语义/资产和内置 SVG 内容校验已接入，见外观系统专题；远端保存核对和第三方包加载仍待对应阶段。MediaHub、树状态、主题和 overlay 契约继续生效。
