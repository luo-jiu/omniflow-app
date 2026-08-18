# macOS 个人签名与发布

更新时间：2026-08-15

适用范围：OmniFlow 个人长期使用的 macOS 自签名身份、bootstrap 安装、Tailscale 更新源、后续版本发布和证书恢复。

## 1. 当前事实

- 当前长期签名身份：`OmniFlow Local Update`。
- SHA-256 指纹：`13:1E:32:00:D3:2B:1F:83:98:EB:A6:57:0A:B7:46:45:52:24:67:43:DA:9C:C9:8D:DE:92:63:FB:C0:44:FB:AA`。
- 有效期：2026-08-15 至 2036-08-12。
- 私钥 keychain：`~/Library/Keychains/omniflow-local-signing.keychain-db`。
- 加密备份：`~/Library/Application Support/Omniflow/signing/omniflow-local-update.p12`。
- 公钥证书：`~/Library/Application Support/Omniflow/signing/omniflow-local-update.crt`。
- 备份密码保存在登录 keychain 的 generic password 条目 `com.loyce.omniflow.local-signing` 中。
- 一次性配置入口：`npm run signing:setup:mac`。当前 Mac 已完成配置，重复运行只做幂等检查。
- 已发布的首个 updater bootstrap：`0.2.0`。
- updater 服务器目录：`omniflow-cn:/srv/omniflow/desktop-updates/stable/mac-arm64`。
- Tailscale Serve 路由：`/desktop-updates/ -> /srv/omniflow/desktop-updates`。
- 实际 HTTPS 域名只保存在 `.env.local`，不写入仓库。

证书、私钥、`.p12` 密码和真实 tailnet 域名都不提交到 Git。

## 2. 关键恢复规则

现有安装只认可当前签名链。证书丢失后，重新生成一个同名 `OmniFlow Local Update` 证书并不能替代原证书；旧客户端会拒绝它签名的更新。

因此必须同时保住：

1. `omniflow-local-update.p12`。
2. 对应密码。当前可从登录 keychain 的 `com.loyce.omniflow.local-signing` 条目读取，另行离线备份时应把密码保存到独立的密码管理器，不能只复制 `.p12`。
3. 本文记录的 SHA-256 指纹。恢复后必须核对指纹完全一致。

迁移到新 Mac 时必须导入现有 `.p12` 并信任现有证书，禁止直接运行 setup 生成新身份后继续旧更新链。恢复流程尚未封装为自动脚本；执行前应先核对 `.p12` 指纹和备份密码。

## 3. 当前旧版本处理

本机 `/Applications/Omniflow.app` 当前仍是正在使用的旧 `0.1.0`，该版本是 ad-hoc 签名且不具备应用内更新能力。它不可能通过远端 feed 自动获得 updater，必须手工覆盖一次。

bootstrap 产物：

```text
release/0.2.0/Omniflow-Mac-0.2.0-Installer.dmg
```

操作顺序：

1. 在 OmniFlow 中完成当前操作，使用 `Cmd+Q` 完全退出；只关闭窗口会隐藏应用，不等于退出。
2. 打开 `0.2.0` DMG。
3. 将 `Omniflow.app` 拖入 `/Applications` 并确认覆盖旧应用。
4. 重新打开 OmniFlow，在设置中确认当前版本为 `0.2.0`，点击检查更新后应显示已经是最新版本。
5. 确认登录态、工作区和本地缓存仍在。

Electron 数据位于 `~/Library/Application Support/omniflow-app`。覆盖 `/Applications/Omniflow.app` 不会删除该目录；不要先卸载或手工删除数据目录。

本地生成的 DMG 和应用没有 quarantine 属性。如果从其他位置重新下载自签名 bootstrap，Gatekeeper 仍可能因为没有 Apple notarization 而提示阻止；个人本机 bootstrap 优先使用上述本地产物。

## 4. 后续发版

以后每个版本只执行一次，并且必须提升 semver：

```bash
cd /Users/loyce/personal/omniflow/omniflow-app
npm run release:mac -- 0.2.1 --publish
```

脚本会依次执行：

1. 读取 `.env.local` 中的 HTTPS 更新地址。
2. 检查远端 `latest-mac.yml`，拒绝相同或更低版本。
3. 从登录 keychain 读取独立签名 keychain 的密码。
4. 更新 `package.json` 和 `package-lock.json` 版本。
5. 构建并使用 `OmniFlow Local Update` 签名。
6. 校验 app 签名以及 DMG、ZIP、blockmap、manifest 是否齐全。
7. 先上传不可变产物，最后上传 `latest-mac.yml`。
8. 重新读取线上 manifest，确认发布版本一致。

已发布版本禁止重新签名覆盖。发现问题时发布更高版本向前修复。

## 5. 客户端监测

- 打包客户端启动 15 秒后自动检查。
- 持续运行时每 6 小时检查一次。
- 设置页可以手工点击检查更新。
- 客户端直接读取 Tailscale HTTPS feed 的 `latest-mac.yml`，不监测 GitHub Actions 或 GitHub Release。
- `0.2.0` 已用线上 feed 实测进入 `up-to-date`，说明 bootstrap 内的更新地址有效。

## 6. 验证与排障

`npm run build` 只执行 TypeScript、renderer、Electron main/preload 编译，不调用 `electron-builder`，因此不会访问 macOS 签名钥匙串。`npm run build:mac` 才是底层 macOS 打包入口，会进入代码签名；日常验证不应调用它。

正式发版继续使用 `npm run release:mac -- <version> --publish`，只构建不发布时去掉 `--publish`。脚本会从登录钥匙串读取 `com.loyce.omniflow.local-signing`，自动解锁独立签名钥匙串 `omniflow-local-signing.keychain-db`。不需要也不应该在系统弹框中猜测登录密码。

如果确实需要直接运行底层 `build:mac`，使用下面的无明文流程：

```bash
signing_keychain="$HOME/Library/Keychains/omniflow-local-signing.keychain-db"
signing_password="$(security find-generic-password -a "$(id -un)" -s com.loyce.omniflow.local-signing -w)"
security unlock-keychain -p "$signing_password" "$signing_keychain"
unset signing_password
CSC_KEYCHAIN="$signing_keychain" CSC_NAME="OmniFlow Local Update" npm run build:mac
```

如果直接运行 `build:mac` 后弹出密码框，或者误输登录密码后出现 `errSecInternalComponent`，取消密码框并按上述方式重新解锁；不要重建或替换现有签名证书。

检查身份：

```bash
security find-identity -v -p codesigning \
  ~/Library/Keychains/omniflow-local-signing.keychain-db
```

检查已安装版本：

```bash
defaults read /Applications/Omniflow.app/Contents/Info.plist \
  CFBundleShortVersionString
```

检查更新日志：

```text
~/Library/Application Support/omniflow-app/app-update.log
```

检查远端：

```bash
ssh omniflow-cn 'sudo tailscale serve status'
ssh omniflow-cn \
  'find /srv/omniflow/desktop-updates/stable/mac-arm64 -maxdepth 1 -type f -printf "%f %s\n" | sort'
```

正式公开分发仍需要 Apple Developer ID 和 notarization。当前自签名方案只面向已经信任该证书的个人设备。
