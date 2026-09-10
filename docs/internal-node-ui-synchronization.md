# 内部节点变更 UI 同步

更新时间：2026-09-10

## 事件契约

`features/file-explorer/services/node-mutation-events.ts` 提供 `notifyLibraryNodesMutated(event)` 和 `subscribeLibraryNodesMutated(listener)`。

- 必填：`accountScope`、`backendScope`、`libraryId`、`affectedParentIds`。
- 可选：`nodeId`、`name`、`ext`、`type`、`parentId`。名称与扩展名使用后端独立字段，不能把完整文件名重复拼入 name。
- 创建、复制、恢复传实际目标父目录；移动传新旧父目录；重命名传最终节点名称、扩展名和类型。`parentId` 可投影移动后的选中项位置。
- 只有确认业务提交成功后才通知。通知是 renderer 内同步广播，不是请求、授权或执行入口，不承担跨进程持久化。异步监听器的失败会记录日志，不能反转业务成功；调用方 await 通知不表示所有目录已刷新完成。
- 每个订阅方精确匹配账号、后端、资料库，不接受仅 nodeId 或 libraryId 匹配。未挂载的树保留同作用域 dirty 标记，下次挂载走原快照重建链路；不保存第二份树或选中状态。

## 状态所有权

`useRepositoryTree` 订阅事件，使用原 `refreshNodeSubtree` 刷新实际父目录；同一通知的父目录去重，刷新失败不阻断其他父目录。已加载的折叠分支继续使用原缓存失效规则。迟到刷新不能跨 owner 回填，同一父目录只有最新请求可写回。

`DirectoryTree` 仍是勾选 ID 与 anchor 的 owner，订阅既有 `file-deletion-events` 清除已删除项。节点数据变化也会重新投影 primaryNode，不仅在选中 ID 变化时通知。页面既有 selectedTreeNode 只是 appContext 的只读投影：删除清空、重命名或移动更新元数据，不新增 Agent 状态源。

`FileViewerProvider` 仅修改对应已打开 tab 的 fileName 及活动 fileState 标题。tab ID、文件 URL、正文、reloadToken、媒体 owner 与播放资源均保持原值；不会调用重新打开或关闭 tab。删除继续通过原 closeTab 和媒体 releaseForTab 链路。

## 回收站恢复

两个回收站页面共用 `useRestoreRecycleBinNode`。恢复回执为 false 时不移除列表项；成功后立即保留恢复事实，然后读取 fresh node，以其实际 parentId 刷新，支持后端将孤立节点恢复到根目录。详情读取失败时尝试根目录刷新，并提示“已恢复，但目录信息刷新不完整”，不能提示恢复失败或重试恢复写入。

异步操作捕获原账号、后端、资料库。切库、切账号或卸载后不修改当前列表、不显示旧操作 toast，不继续用新环境查询旧节点；已经提交的旧作用域仍可标记过期。

## 验证

自动化覆盖恢复实际父目录、false 回执、刷新失败保留成功、迟到恢复隔离、树的即时刷新与未挂载快照重建、重复父目录去重、旧刷新响应抑制、删除多选与 anchor 清理、tab 改名保留内容与媒体资源，以及通知监听器异常隔离。

手工验收使用非第一个资料库（优先 win 3）：同时打开文件预览并选中节点，执行重命名、移动、删除、恢复，检查目录、输入框上下文及预览标题；媒体播放中改名不应重启播放。本轮仅做自动化，不重启用户进程、不操作真实文件。
