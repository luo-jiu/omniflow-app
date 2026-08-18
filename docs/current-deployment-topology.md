# OmniFlow 当前部署拓扑与运维交接

更新时间：2026-08-15

适用范围：OmniFlow 当前个人部署环境、桌面客户端的网络入口、Go 后端发布、PostgreSQL / Redis / MinIO 运行边界，以及后续 Agent 接手时需要保留的运维事实。

> 本文描述的是当前实际环境，不是通用生产部署模板。真实 IP、tailnet 域名、账号、密码、token 和密钥不进入仓库；需要时从本机 SSH 配置、前端 `.env.local` 或服务器 `/srv/omniflow/.env` 获取。

## 1. 当前结论

- 国内云服务器运行唯一一套 Go API、PostgreSQL 和 Redis，承载共享业务逻辑与元数据。
- 云服务器不保存媒体对象，也不承担媒体流量中转。
- Mac 和 Windows 各自运行 MinIO；媒体对象可以分散在多个存储节点，数据库通过 storage provider 区分对象归属。
- Electron 客户端通过 Tailscale 访问云端 API，再根据后端签发的 URL 直接访问对应 MinIO。
- 某个 MinIO 节点关机时，只影响属于该节点的媒体访问；云端元数据和其他在线节点仍可使用。
- 当前不使用 Jenkins、Kubernetes 或复杂 CI/CD。后端采用脚本重建 API 容器；macOS 桌面端使用本机长期签名身份构建，并把更新产物发布到国内服务器的 Tailscale HTTPS 静态目录。

```text
Mac Electron ------\
                    +--> Tailscale --> 国内云 Go API --> PostgreSQL
Windows Electron --/                         |
                                              +-----------> Redis

Mac Electron ---------------------> Mac MinIO（对象直读 / 直传）
Mac / Windows Electron -----------> Windows MinIO（对象直读 / 直传）
Windows Electron -----------------> Mac MinIO（当前待排查）
```

关键边界：API 请求经过云端，媒体字节默认不经过云端。不要因为媒体分散而把 MinIO 数据复制进云服务器磁盘。

## 2. 节点与职责

### 2.1 国内云服务器

- 本机 SSH 别名：`omniflow-cn`
- 系统：Ubuntu 24.04 LTS，x86_64
- 部署根目录：`/srv/omniflow`
- Compose 文件：`/srv/omniflow/compose.yaml`
- 机密配置：`/srv/omniflow/.env`，权限应保持为仅部署用户可读
- Go 源码目录：`/srv/omniflow/app`
- 发布脚本：`/srv/omniflow/scripts/deploy.sh`

当前 Compose 服务：

| 服务 | 镜像 / 构建方式 | 对外边界 | 持久化 |
| --- | --- | --- | --- |
| `api` | 从 `/srv/omniflow/app` 构建 `omniflow-go:<tag>` | 仅绑定 `127.0.0.1:8850` | 配置文件只读挂载 |
| `postgres` | `postgres:17-alpine` | 仅 Compose 内部网络 | `/srv/omniflow/data/postgres` |
| `redis` | `redis:7-alpine` | 仅 Compose 内部网络 | `/srv/omniflow/data/redis`，AOF 开启 |

Tailscale Serve 为 `tailnet only`。根路径代理到 `127.0.0.1:8850`；`/desktop-updates/` 直接映射 `/srv/omniflow/desktop-updates`，用于桌面更新静态文件。

安全约束：

- 不要把 API 改为监听公网地址。
- 不要给 PostgreSQL、Redis 映射宿主端口或开放安全组端口。
- 云控制台安全组是外部事实，变更前必须单独核对；不能仅凭 Compose 配置推断公网入口。
- 当前服务器磁盘只适合程序、数据库和 Redis，不用于汇总本地媒体。

### 2.2 Mac 节点

- Mac 同时是主要开发机、桌面客户端和一个 MinIO 节点。
- Docker 容器 `minio` 暴露宿主 `9000`（S3 API）和 `9001`（Console）。
- Docker 容器 `omniflow-tailscale` 将 Mac MinIO 作为独立 tailnet 节点提供给其他机器。
- macOS 官方 Tailscale 客户端也已安装并配置为开机启动，负责宿主自身访问 tailnet。
- MinIO 与 sidecar 的可用性仍依赖 Docker Desktop 已启动。

不要删除或重建 MinIO 数据卷。需要确认当前容器和网络时使用：

```bash
docker ps
tailscale status
docker exec omniflow-tailscale tailscale status
```

### 2.3 Windows 节点

- 本机 SSH 别名：`omniflow-win`；Tailscale SSH 别名：`omniflow-win-tail`。
- Windows 是主要媒体数据节点，MinIO 数据规模约为 TB 级。
- Docker 容器 `minio` 暴露宿主 `9000` 和 `9001`。
- Windows OpenSSH `sshd` 和官方 Tailscale 服务均为自动启动。
- MinIO 可被 Mac 客户端访问，Windows 客户端也可以访问自己的 MinIO。

Windows 上的远程只读检查示例：

```bash
ssh omniflow-win 'powershell -NoProfile -Command "Get-Service sshd,Tailscale"'
ssh omniflow-win '"C:\Program Files\Docker\Docker\resources\bin\docker.exe" ps'
```

不要停止、删除或重建 Windows MinIO，除非用户明确授权并已确认数据目录和挂载关系。

## 3. 请求与存储链路

### 3.1 API 链路

Electron renderer 与主进程共享 `VITE_API_BASE_URL`。当前构建指向云端 Tailscale Serve 的 HTTPS `/api` 入口：

```text
Electron -> Tailscale Serve -> 127.0.0.1:8850 -> Go API
                                             -> PostgreSQL / Redis
```

客户端宿主必须登录同一个 tailnet。只有 Docker Tailscale sidecar、宿主没有加入 tailnet 时，Electron 不能因此自动访问云端 API。

### 3.2 MinIO 链路

后端 storage provider 保存对象归属和客户端可访问的 `publicEndpoint`。上传或读取时，后端返回对应节点的预签名 URL，Electron 直接向该 MinIO 发起请求：

```text
Electron -> Go API：请求上传会话或读取信息
Go API   -> Electron：返回对应 provider 的预签名 URL
Electron -> MinIO：直接 PUT / GET 对象
```

因此新增存储节点时至少需要同时满足：

1. 后端存在正确的 storage provider 配置。
2. `publicEndpoint` 对目标客户端可解析、可连接。
3. 目标 MinIO 在线，bucket 和凭据正确。
4. 客户端构建时的 CSP 包含该 storage origin。

直传实现细节见 `docs/upload-direct-architecture.md`。

## 4. 前端环境与打包

### 4.1 环境变量

生产构建的本机真实配置放在 `omniflow-app/.env.local`，该文件被 Git 忽略，不得提交；开发模式使用仓库内的 `.env.development`，默认连接本机 Go 和本机 MinIO。模板位于 `.env.example`。

```dotenv
VITE_API_BASE_URL=https://***/api
VITE_STORAGE_ORIGINS="http://***:9000 http://***:9000"
VITE_UPDATE_BASE_URL=https://***/desktop-updates/stable/mac-arm64
```

- `VITE_API_BASE_URL` 决定 API 地址。
- `VITE_STORAGE_ORIGINS` 决定 renderer 可直连的 MinIO CSP allowlist。
- `VITE_UPDATE_BASE_URL` 决定打包后 main process 使用的静态更新 feed；正式环境必须为 HTTPS。
- 三者都在 Vite 构建阶段写入产物，不是安装后的运行时配置。
- API、MinIO origin 或更新地址发生变化后，需要重新构建客户端；不能只修改服务器 `.env` 期待已安装客户端自动生效。
- Vite 的环境优先级使 `.env.development` 覆盖通用 `.env.local`，因此 `npm run dev` 不会因为生产发布配置而误连云端；`npm run build` 使用 production mode，继续读取 `.env.local` 的正式地址。

### 4.2 当前发布方式

当前已发布的 macOS updater bootstrap 为 `0.2.0`；本机 `/Applications` 中的旧 `0.1.0` 仍需手工覆盖一次。日常编译验证使用 `npm run build`，该命令不打包、不签名。平台产物入口：

```bash
cd omniflow-app
npm run release:mac -- <version> [--publish]
npm run build:win
```

产物位于 `release/<version>/`：

- macOS：`Omniflow-Mac-<version>-Installer.dmg` 与 updater 使用的 ZIP / blockmap / `latest-mac.yml`
- Windows x64：`Omniflow-Windows-<version>-Setup.exe`

当前事实：

- macOS 可以交叉生成 Windows NSIS 安装包，但最终行为仍需在真实 Windows 验证。
- 两个平台均可覆盖安装，卸载配置为不主动删除 Electron `userData`。
- Windows 安装包没有代码签名；macOS 个人发布使用本机长期自签名身份，公开分发所需的 Developer ID 与 notarization 尚未配置。
- macOS 客户端已接入 `electron-updater` 的检查、手动下载和重启安装链路；更新目录位于 `/srv/omniflow/desktop-updates/stable/mac-arm64`，由 Tailscale Serve 暴露。
- Windows 自动更新暂未接入。

自动更新实现与本地验证方式见 `docs/desktop-auto-update.md`。

## 5. Go 后端发布

当前远端 `/srv/omniflow/app` 不是 Git worktree，因此发布分两步：先把确认过的后端源码同步到远端，再执行部署脚本。源码同步目前没有封装为仓库内的一键命令，执行时必须避免覆盖远端 `.env`、`configs/` 和 `data/`。

远端部署命令：

```bash
ssh omniflow-cn 'cd /srv/omniflow && ./scripts/deploy.sh'
```

脚本行为：

1. 从 `/srv/omniflow/app` 构建新的 `api` 镜像。
2. 只替换 API 容器，不重启 PostgreSQL 和 Redis。
3. 等待 `/healthz` 通过。
4. 请求一个会查询 PostgreSQL 的只读接口，避免只验证到 HTTP 进程。

数据库表结构变化不属于普通热更新。涉及迁移时，必须先遵守 `omniflow-go/AGENTS.md` 的迁移与生成代码规则，并在发布前单独确认迁移顺序；当前 `deploy.sh` 不自动执行数据库迁移。

## 6. 日常检查与故障定位

云端整体状态：

```bash
ssh omniflow-cn 'cd /srv/omniflow && docker compose ps'
ssh omniflow-cn 'cd /srv/omniflow && docker compose logs --tail=100 api'
ssh omniflow-cn 'curl -fsS http://127.0.0.1:8850/healthz'
ssh omniflow-cn 'tailscale serve status'
```

排查顺序：

1. 客户端是否登录 tailnet，能否访问云端 API。
2. 云端 `api`、`postgres`、`redis` 是否 healthy。
3. 数据库中的 storage provider 是否指向正确节点。
4. 客户端能否解析并连接预签名 URL 的 host 和端口。
5. 客户端构建产物的 CSP 是否包含该 origin。
6. 对应 MinIO 宿主、Docker 和 Tailscale sidecar 是否在线。

不要一开始就修改代码。先区分 API、Tailscale、DNS / 路由、CSP、MinIO 监听和预签名 URL 中的具体哪一层失败。

## 7. 已知限制与当前风险

- Windows 客户端当前能访问 Windows MinIO，但不能访问 Mac MinIO；Mac 客户端可以访问两边。该问题尚未完成分层定位。
- 本地 MinIO 节点必须开机且 Docker / Tailscale 可用，对应媒体才能读取或上传。
- `VITE_STORAGE_ORIGINS` 是构建时 allowlist，增加或更换存储地址后需要重新发客户端。
- macOS 已有个人使用的签名与 Tailscale 更新源，但尚无 Developer ID、notarization 或 CI/CD；公开分发仍不具备完整发布条件。
- 当前没有自动数据库备份计划。`/srv/omniflow/backups` 目录存在不代表有定时备份或可恢复点。
- 云端代码目录不是 Git worktree，镜像 tag 当前可能使用 UTC 时间戳，不能总是直接追溯到提交 SHA。

## 8. 责任边界与禁止事项

当前协作约定：

- 本部署任务负责国内云服务器、OmniFlow 云端运行环境、Tailscale 和多 MinIO 连通性。
- Electron 功能、Windows UI 样式和客户端业务兼容性由专门的前端开发 Agent 处理。
- 美国服务器和 sub2api 不在本文及当前运维任务范围内。

禁止事项：

- 不向公网开放 PostgreSQL、Redis、MinIO 或内部代理端口。
- 不把 `.env.local`、服务器 `.env`、MinIO 凭据或 Tailscale auth key 提交到仓库。
- 不删除 Mac / Windows MinIO 容器、卷或数据目录。
- 不在未经确认时重置 PostgreSQL、清空 Redis 或重建云端数据目录。
- 不因为某一节点暂时不可达，就擅自改写 storage provider 或批量迁移对象。

## 9. 维护规则

出现以下变化时更新本文：

- 云端服务、Compose 目录、端口或 Tailscale 入口变化。
- 新增、移除或迁移 MinIO 节点。
- 前端 API / storage origin 配置方式变化。
- Go 发布脚本、数据库迁移顺序或健康检查变化。
- 引入自动更新、签名、CI/CD、域名或公网入口。
- 已知跨节点连通性问题得到定位或修复。

每次更新只记录当前事实，不保留临时排障流水账，也不把真实秘密值补进文档。
