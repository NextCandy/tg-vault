#!/usr/bin/env bash
# Runtime checks are intentionally independent of .env creation.
installer_compose() {
  env IMAGE_VERSION="$RELEASE_VERSION" SOURCE_REVISION="$RELEASE_REVISION" SOURCE_VERSION="$RELEASE_VERSION" docker compose ${INSTALL_COMPOSE_ARGS[@]+"${INSTALL_COMPOSE_ARGS[@]}"} "$@"
}

prepare_install_compose() {
  INSTALL_COMPOSE_ARGS=()
  [[ "${INSTALL_REQUIRE_ATTESTATIONS:-true}" == false ]] || return 0
  if [[ -n "${COMPOSE_FILE:-}" || -f compose.override.yaml || -f compose.override.yml || -f docker-compose.override.yml || -f docker-compose.override.yaml ]]; then
    echo "兼容模式不支持额外 Compose 文件；请升级工具链并使用标准模式保留自定义配置。" >&2
    return 1
  fi
  INSTALL_COMPAT_FILE="$(mktemp "${TMPDIR:-/tmp}/tg-vault-compose-compat.XXXXXX.yml")"
  trap 'rm -f "${INSTALL_COMPAT_FILE:-}"' EXIT
  python3 - "$PWD/docker-compose.yml" "$INSTALL_COMPAT_FILE" <<'PY'
from pathlib import Path
import re, sys
source, target = map(Path, sys.argv[1:])
# Strip only known attestation fields; retain every runtime/env/security line.
lines = source.read_text().splitlines(keepends=True)
output = []
in_build = False
for line in lines:
    if line.strip() and not line.lstrip().startswith('#'):
        indent = len(line) - len(line.lstrip())
        if indent <= 4:
            in_build = bool(re.fullmatch(r'    build:\s*', line))
        if in_build and re.match(r'^      (sbom|provenance):', line):
            continue
    output.append(line)
target.write_text(''.join(output))
PY
  INSTALL_COMPOSE_ARGS=(--project-directory "$PWD" --env-file "$PWD/.env" -f "$INSTALL_COMPAT_FILE")
  echo "已应用兼容配置：本次不生成 SBOM/provenance；原 Compose 文件、应用和数据库安全配置不变。"
}

assert_database_credentials_safe() {
  # Inspect only. Existing data must never receive a newly generated password.
  local password="$1" project volume containers
  [[ -n "$password" ]] && return 0
  project="${COMPOSE_PROJECT_NAME:-tg-vault}"
  volume="${project}_postgres-data"
  containers="$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=postgres')"
  if [[ -n "$containers" ]] || docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "检测到已有 PostgreSQL 容器或数据卷，但 .env 缺少 DB_PASSWORD。" >&2
    echo "已停止，避免新密码导致数据库无法登录。请恢复原 .env/数据库密码后重试，不要删除数据卷。" >&2
    return 1
  fi
}

installer_failure() {
  local status="$1"
  trap - ERR
  echo "TG Vault 部署失败（阶段：${INSTALL_STAGE:-unknown}，退出码：$status）。" >&2
  echo "未自动删除数据卷或重置密码。排障请运行：" >&2
  echo "  docker compose ps --all" >&2
  echo "  docker compose logs --tail=80 postgres backend frontend" >&2
  installer_compose ps --all >&2 || true
  exit "$status"
}

validate_install_timeout() {
  local timeout="${INSTALL_HEALTH_TIMEOUT:-180}"
  if [[ ! "$timeout" =~ ^[1-9][0-9]{1,3}$ ]] || (( timeout < 30 || timeout > 1800 )); then
    echo "INSTALL_HEALTH_TIMEOUT 必须为 30–1800 秒的整数。" >&2
    return 1
  fi
}

start_installation() {
  local timeout="${INSTALL_HEALTH_TIMEOUT:-180}"
  validate_install_timeout
  trap 'installer_failure $?' ERR
  INSTALL_STAGE=config
  installer_compose config --quiet
  installer_compose config --format json | python3 "$SCRIPT_DIR/install-storage.py" verify
  # Separate builds bound peak RAM on small servers.
  INSTALL_STAGE=build-backend
  installer_compose build backend
  INSTALL_STAGE=build-frontend
  installer_compose build frontend
  INSTALL_STAGE=postgres
  # The first install MUST start its dependency. Existing database containers are
  # never recreated for an application upgrade; stopped ones may be started.
  installer_compose up -d --no-build --no-deps --no-recreate --wait --wait-timeout "$timeout" postgres
  INSTALL_STAGE=application
  installer_compose up -d --no-build --no-deps --wait --wait-timeout "$timeout" backend frontend
  INSTALL_STAGE=verify
  installer_compose ps
  trap - ERR
}
