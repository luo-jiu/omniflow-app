# Embedded Browser Service Target Layout

该目录是资源捕捉重构的目标边界。当前生产文件仍位于 `electron/service/embeddedBrowser*.ts`；在对应 cutover unit 通过前，不做纯目录搬迁，也不提前删除生产实现。

```text
embedded-browser/
  contracts/        # main/preload/renderer 共享的纯数据合同
  orchestration/    # tab/session/task facade 与生命周期
  capture/          # Electron network/page adapters 和 main-owned state
  cat-catch-port/   # Cat Catch 行为与经验分支的纯逻辑 port
  processing/       # task、temp、filesystem、ffmpeg
  integrations/     # OmniFlow resource model、外部工具等适配
```

迁移规则：

- 一个能力先在目标目录实现并通过对应真实测试（需要时使用 fixture），不从旧文件直接搬出一份未经验证的副本。
- 生产入口只在 unit 就绪后切换。
- 切换后删除相应旧算法、listener、handler、flag、fallback 和测试 helper。
- 仍承担 Electron、IPC、文件、UploadManager 等产品职责的代码保留或改造成 adapter。
- 不维持长期双栈；Git 历史负责回滚。

当前 `orchestration/embedded-browser-capture-runtime.ts` 是未注册的 network-capture composition root。构造它会占用 embedded browser session 的 `webRequest` listener，因此只能在旧 bridge 同片删除的原子 cutover 中接入 production；测试或后续 Agent 不得为了“先接一点”让它与旧 bridge 同时运行。

逐项映射见 `docs/cat-catch/capability-map.json`；初始迁移期间的旧位置处置见 `docs/cat-catch/legacy-cleanup.json`。
