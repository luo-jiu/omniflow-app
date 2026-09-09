# Agent 发布与目录树同步

更新时间：2026-09-09

## 发布成功后的同步

`file.publish` / `file.upload` 由main完成上传，不能依赖只服务renderer工具的刷新回调。当前会话投影收到或恢复成功的ToolActivity后，只有 `ok=true`、`uploadCommitState=committed`、资料库目的地及有效nodeId/parentId同时满足时，才按parentId刷新目录。按会话和工具记录去重，同一批相同父目录合并刷新；切换会话/账号/库后迟到回调不进入新scope。

同时把所属资料库树快照标脏，侧栏恢复时重新读取。刷新失败只提示“文件已保存，但目录树刷新失败”，不改变committed事实、不触发重新上传。pending、失败、commit_unknown及本机Save As不会被当作资料库写入成功。

## 手动刷新

目录树空白处右键菜单没有普通node对象，刷新动作现在显式映射到实际根节点ID，不再直接返回。根节点或刷新回调未就绪时明确失败，不显示假的刷新成功。

刷新父目录仍只主动读取可见展开分支；已经折叠的已加载子分支会清除loaded/children缓存，下一次展开重新取数，避免父目录刷新之后继续复用旧子列表。普通快照恢复仍保留原缓存策略。异步刷新不回填到已经卸载或切换资料库的实例。

## 路径约定

Shell路径相对它的cwd，发布sourcePath相对Run根目录，不能静默猜测同名文件。生成待发布文件推荐 `shell.run(cwd=output)` 中写 `a.cpp`，随后使用 `file.publish(sourcePath=output/a.cpp)`；若Shell保留默认cwd=work，应写 `../output/a.cpp`。

工具schema直接说明这一对应关系。准备发布时如果源文件不可读，错误仅显示规范sourcePath和修正办法，不暴露物理workspace绝对路径；误写到work/output时提示移动现有文件，不要求重新生成。不更改既有cwd默认值，也不放宽发布仅接受顶层output的边界。

## 验证

真实gpt-5.5 / win资料库（ID 3）的Run `0e25791a-9664-4e56-8dd3-c62018ba5ca6`，先展开并加载“文档”目录，再请求生成发布合成文本。模型第一次即使用cwd=output及sourcePath=output/publication_refresh_qa_20260909.txt；shell.run和file.publish均一次成功。文件在没有退出工作区、没有手动刷新的情况下直接出现在已展开目录中。测试文件保留在 `/文档/publication_refresh_qa_20260909.txt`。

自动化覆盖commit状态筛选、恢复快照触发、重复回执去重、刷新失败不反转成功、根菜单目标映射、折叠分支失效，以及发布源错误路径脱敏。完整测试2,066项通过、7项跳过，lint、TypeScript和完整构建通过。根菜单触发与缓存分支由自动化验证；本轮未成功捕获原生右键菜单操作的完整手工链路，不将其冒充实测。
