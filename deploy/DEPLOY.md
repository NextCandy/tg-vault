> 本地保存位置与 bind/卷备份：[完整说明](../docs/local-storage.md)。新安装询问保存目录；升级不迁移，`.env` 单独存在也不套用新目录默认值。

# TG Vault 服务器部署指南

TG Vault 使用 **Docker Compose + 宿主机反向代理**。Compose 包含 `postgres`、`backend`、`frontend`；Nginx 和证书由宿主机或面板管理。

## 1. 前置条件

- Linux 服务器，Bash 4+、Python 3.6+、Git、Docker Engine、Compose 插件及 Buildx，当前用户能够访问 Docker daemon 和 builder。
- 默认生成 SBOM（软件物料清单）和 provenance（构建来源证明），需要 Compose 2.39+ 及支持证明的 builder/镜像存储。
- 已把 Web 域名和 API 域名解析到服务器。
- 宿主机 Nginx、宝塔或其他反向代理负责 HTTPS 证书。
- 从项目目录执行下列命令；项目目录即包含 `docker-compose.yml` 的目录。

环境检查只读。缺少组件时，输入 `1` 才授权从 apt（Debian/Ubuntu）或 dnf/yum 的现有仓库安装；可能更新包索引并请求 sudo 密码。按 Enter 或 `q` 退出。脚本不添加仓库、关闭签名校验、放宽 Docker socket 权限或执行远程安装脚本；包管理器自身可能启动安装的软件服务。

较旧环境可主动使用 `./deploy/install.sh --compat`，验证基线为 Compose 2.18+。兼容模式去掉本次构建的 SBOM/provenance 字段，不改原 Compose 文件、应用配置或数据库配置；因此本次构建不生成这些证明。它不支持额外的 Compose 覆盖文件。标准模式和兼容模式都检查实际能力，不只比较版本号；均不支持 Python `docker-compose` v1。

## 2. 创建环境变量

首次部署直接运行安装器，无需先复制 `.env.example`：

```bash
./deploy/install.sh
```

首次运行只需要填写以下 2 项：

```dotenv
VITE_API_URL=https://api.example.com
CORS_ORIGIN=https://cloud.example.com
```

填写实际 HTTPS origin（协议、域名及可选端口），不带路径、查询参数或末尾 `/`。域名后缀不限，例如 `.cc`、`.cn` 或多级子域名均可；裸域名无效。HTTP 仅适用于本地调试，默认安全 Cookie 需要 HTTPS。

没有已有地址时，按 Enter 不会使用示例。如果已复制 `.env.example`，或在环境变量中设置了示例地址，必须主动替换，否则 Enter 会保留占位值。安装器不替换 Nginx 配置中的域名。确认页面按 Enter 保存并部署，输入 `e` 重填，输入 `q` 取消。

`.env` 支持单行引号、`export KEY=...`、赋值空格、行尾注释和 CRLF；不执行配置内容。不支持依赖环境的 `${VAR}` 插值或多行值，遇到时在写入前停止。数据库密码和应用密钥以文件中的值为准，不受同名进程环境变量覆盖。密码包含 URL 保留字符时，只对连接串编码，不改变数据库原密码。

**Telegram 不属于首次部署的 `.env` 配置。** 完成 HTTPS 和 Web 管理员初始化后，在「设置 → Telegram」配置 Bot、允许用户和账号登录。`TELEGRAM_*` 等环境变量仅用于旧版本兼容和高级部署；新安装无需填写或手动生成 session。

新安装时，脚本会自动生成并保留：

```dotenv
DB_PASSWORD=随机生成的64位十六进制密码
SESSION_SECRET=随机生成的64位十六进制密钥
STORAGE_CREDENTIALS_SECRET=随机生成的64位十六进制密钥
```

升级时，若 `.env` 未设置 `SESSION_SECRET` 或 `STORAGE_CREDENTIALS_SECRET`，继续使用 `/data/secrets` 中已有的持久密钥，不生成替代值，以免 2FA 和存储凭证失效。

OAuth 默认使用 `VITE_API_URL` 作为回调来源，并使用 `CORS_ORIGIN` 的第一个地址作为前端通知来源。只有多入口或特殊反代部署才需显式设置 `OAUTH_CALLBACK_BASE_URL`、`OAUTH_FRONTEND_ORIGIN`。

直接运行 Compose 时，需自行生成新部署的 `DB_PASSWORD`，已有数据库必须使用原密码；镜像名称会使用 `source`，源码修订号和版本元数据回退为 `unknown` / `worktree`。

## 3. 构建并启动

安装器从 `backend/package.json` 和当前 Git 提交读取版本信息，只传给本次 Compose 调用，不写入 `.env`。以下是手动构建时的版本标记示例（需要宿主机 Node.js）：

```bash
revision=$(git rev-parse HEAD)
version="v$(node -p "require('./backend/package.json').version")"
IMAGE_VERSION="$version" SOURCE_REVISION="$revision" SOURCE_VERSION="$version" docker compose up -d --build
```

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

安装器按以下顺序执行，避免小内存服务器同时构建前后端：

1. 分别构建 `backend` 和 `frontend`。
2. 启动并等待 `postgres` 健康。已有容器使用 `--no-recreate` 保留，停止的数据库会恢复启动。
3. 替换前后端并等待健康检查通过。后端启动时自动检查/迁移数据库 schema。

首次安装不能只启动 `--no-deps backend frontend`，否则缺少数据库服务。安装器保留持久化卷，仅在所有健康检查通过后报告完成；公网访问还需检查 HTTPS 反向代理。

默认健康等待时间为 180 秒；慢速服务器可使用 `INSTALL_HEALTH_TIMEOUT=600 ./deploy/install.sh`（允许 30–1800 秒）。失败时会显示具体阶段和排障命令，保留容器与数据，不自动清库重试。若已有数据库容器/数据卷但 `.env` 中缺失数据库密码，脚本会停止并要求恢复原密码，避免随机生成的新密码破坏数据库连接。

## 4. 配置宿主机反向代理

按实际域名配置宿主机 Nginx 或其他反向代理：

- Web 域名代理至 `http://127.0.0.1:47832`
- API 域名代理至 `http://127.0.0.1:51947`
- API 上传链路的 `client_max_body_size` 必须与应用的请求/分片限制匹配；它限制单次 HTTP 请求，不是文件总大小
- TLS 证书由宿主机 Nginx/面板/Certbot 管理，不要运行 `docker compose run certbot`

`deploy/nginx-site.conf` 和 `deploy/nginx-site-init.conf` 是旧的单域名示例，不是 Web/API 双域名的完整配置。使用前替换域名和证书路径，补齐 API 域名站点，并核对 `/uploads`、`/thumbnails` 等旧路由及缓存策略；不要对受保护文件启用公共缓存。初始 HTTP 配置仅用于申请证书，不要通过它登录或传输凭证。加载前执行 `nginx -t`；证书生效后再开放登录。

## 5. 更新部署

升级前备份 `.env`、数据库和文件卷；替换前后端会短暂中断服务。从实际项目目录执行：

```bash
cd /path/to/tg-vault
./deploy/install.sh
```

安装器拉取当前分支的最新代码，再显示已有 Web/API 地址。按 Enter 保留，或输入新地址；确认后才构建。数据库容器和持久卷的保留方式见上一节。

有本地修改、处于 detached HEAD 或更新无法快进时，脚本停止，不丢弃修改或强制合并。已手动更新或需要离线部署时，可主动添加 `--skip-source-update`。也可从其他目录通过绝对路径运行安装器，它会定位到仓库根目录。

检查服务状态、源码标签和前端资源是否对应本次部署（读取版本的命令需要 Node.js）：

```bash
docker compose ps
curl -fsS http://127.0.0.1:51947/livez
curl -fsS http://127.0.0.1:51947/readyz
docker compose logs --tail=100 backend frontend postgres

expected_revision=$(git rev-parse HEAD)
expected_version="v$(node -p "require('./backend/package.json').version")"
docker inspect --format='{{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}}' tg-vault-backend tg-vault-frontend
# 比较两个容器输出与 "$expected_revision $expected_version"。

# 比较镜像内 index.html 与 HTTP 返回的 assets/ 入口。
docker exec tg-vault-frontend sh -c 'grep -oE "assets/[^\"]+\.(js|css)" /usr/share/nginx/html/index.html | sort'
curl -fsS http://127.0.0.1:47832/ | grep -oE 'assets/[^\"]+\.(js|css)' | sort
```

两个容器的 revision/version 应与预期一致，镜像内外的 `assets/` 入口也应相同。另用实际 Web/API HTTPS 地址检查公网访问。

### 安装器回归测试

```bash
bash deploy/install.test.sh all
python3 deploy/install-configuration.test.py --compose
python3 deploy/install-lifecycle.test.py
python3 deploy/install-source.test.py
python3 deploy/install-compose.test.py
```

以上测试使用临时配置、模拟命令或只读 Compose 检查，不启动应用容器。下面的真实容器测试需主动运行，并传入本机已有的应用镜像。它创建独立内部网络和数据卷，不发布端口、不启用 Telegram、不挂载当前部署数据，结束后清理测试资源：

```bash
python3 deploy/install-runtime.test.py --backend-image <已有后端镜像> --frontend-image <已有前端镜像>
# 可选：--compat、--compose-bin /path/to/docker-compose、--bash-bin /path/to/bash
# --build-from-source 会顺序构建当前源码，产生隔离镜像并在结束时移除。
```

不要使用 `down -v` 排查安装故障。出现 `ENOTFOUND postgres` 或 `EAI_AGAIN` 时，先用 `docker compose ps --all` 检查数据库服务是否存在并已启动，不要先改 DNS 或删数据。

## 6. 常用运维命令

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
docker compose restart
docker compose down
```

`docker compose down` 不会删除 named volumes；不要添加 `-v`，除非明确要永久删除数据库和文件数据。

## 7. 备份与恢复

备份必须包含同一维护窗口内的：

1. PostgreSQL custom-format dump
2. `file-storage` 卷中的完整 `/data`（包括 secrets、缩略图和未完成上传状态）
3. 版本、时间和 SHA-256 manifest

仓库脚本：

```bash
chmod +x deploy/backup.sh deploy/restore-verify.sh
BACKUP_DIR=./backups ./deploy/backup.sh
```

脚本先检查目标空间，要求至少满足“文件卷未压缩大小 + PostgreSQL 数据库大小 + 512 MiB”。空间不足时，不停止 backend。

备份期间停止 backend，使数据库 dump 与 `/data` 归档之间没有应用写入；完成或失败退出时恢复原先运行的 backend。API 在此期间不可用，请安排维护时段。manifest 记录 `consistency=backend-stopped`，校验和使用归档文件名。

**另行备份 `.env` 和自定义反向代理配置；脚本不包含它们。** `.env` 中可能保存数据库密码和加密密钥，仅恢复数据卷不够。

备份目录可能包含敏感凭证材料，应加密后异地保存并限制访问。恢复前在隔离环境执行：

```bash
./deploy/restore-verify.sh ./backups/<backup-directory>
```

验证脚本只检查清单、校验和与归档格式，不还原数据。还需定期在隔离 Compose 项目和数据卷中恢复，验证 schema、行数、密钥可读性及 `/readyz`，再安排生产恢复。

## 8. 故障排查

### backend 不健康

```bash
docker compose ps
docker compose logs --tail=200 backend
curl -i http://127.0.0.1:51947/livez
curl -i http://127.0.0.1:51947/readyz
```

`/livez=200` 但 `/readyz=503` 表示进程存活，但数据库、存储或安全密钥尚不可用。

### 数据库连接失败

```bash
docker compose exec postgres pg_isready -U tgvault -d tgvault
docker compose logs --tail=200 postgres
```

### HTTPS/502

检查宿主机 Nginx 配置、证书、Web/API upstream 端口和请求体限制。Compose 内不存在 `nginx` 或 `certbot` 服务。
