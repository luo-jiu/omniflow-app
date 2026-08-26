# Cat Catch Lab

该目录只承载 Cat Catch 行为 fixture、固定上游参考和必要的本地测试服务，不承载全仓源码分析或发布证明系统。

当前状态：fixture 目录刚建立，`capability-map.json` 中的 `plannedTestIds` 只是 pure behavior、integration、output 或 stability test 的需求种子，不能视为已经有测试，也不都需要 fixture 目录。

## 目录

```text
tools/cat-catch-lab/
  fixtures/       # 行为输入、expected 和 metadata
  server/         # 后续按 fixture 需要增加 loopback endpoints
  oracle/         # 后续按能力固定最小上游源码，不运行上游 install
  tests/          # lab integration tests
```

不要一次性创建空 fixture 目录。一个 fixture 真正落地时使用：

```text
fixtures/<fixture-id>/
  fixture.json
  input...
  expected...
```

`fixture.json` 至少记录：

- `fixtureId`
- `capabilityIds`
- `upstreamCommit`
- `status: planned | active`
- 输入文件或 endpoint
- expected 文件或结构
- `testRefs`

只有 `status=active`、输入/expected 存在且 test refs 实际通过，才可用于把 capability 标为 verified。

## 规则

- 默认只使用 loopback，不连接真实网站、账号、资料库或 MinIO。
- 上游源码视为不可信；不执行 install/build/postinstall。
- 正向 sentinel 应证明 harness 真正运行，零事件不能自动通过。
- normalizer 只能处理时间、随机端口和临时路径，不能忽略资源数量、顺序、headers、错误和输出。
- page oracle 必须无 Node bridge、隔离 session、限制网络/时间/内存/输出。
- 无法安全执行的行为使用 recorded/spec-derived expectation，并写清限制。

轻量账本检查使用：

```bash
npm run cat-catch:validate
npm run cat-catch:check-upstream -- --source-dir ../project/cat-catch
```

它只检查版本、映射、路径、anchor，以及初始迁移期间存在的删除清单，不分析整个 OmniFlow 调用图。
