#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENARIO="${1:-all}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq "$expected" "$file" || fail "$file 缺少：$expected"
}

make_fixture() {
  FIXTURE="$(mktemp -d)"
  trap 'rm -rf "${FIXTURE:-}"' EXIT
  mkdir -p "$FIXTURE/deploy" "$FIXTURE/backend" "$FIXTURE/fake-bin"
  cp "$ROOT/deploy/install.sh" "$FIXTURE/deploy/install.sh"
  cp "$ROOT/deploy/install-runtime.sh" "$FIXTURE/deploy/install-runtime.sh"
  for helper in install-environment.sh install-config.py install-storage.py; do
    [[ ! -f "$ROOT/deploy/$helper" ]] || cp "$ROOT/deploy/$helper" "$FIXTURE/deploy/$helper"
  done
  printf 'services: {}\n' > "$FIXTURE/docker-compose.yml"
  printf '{"version":"2.2.0"}\n' > "$FIXTURE/backend/package.json"

  cat > "$FIXTURE/fake-bin/docker" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == "compose" && "${2:-}" == "version" ]]; then
  echo '2.39.0'
  exit 0
fi
if [[ "$*" == 'compose up --help' ]]; then printf '%s\n' '--wait --wait-timeout --no-recreate'; exit 0; fi
if [[ "$*" == 'buildx build --help' ]]; then printf '%s\n' '--sbom --provenance'; exit 0; fi
if [[ "$*" == 'buildx inspect' ]]; then printf 'Driver: docker\nStatus: running\nBuildKit version: v0.20.0\n'; exit 0; fi
if [[ "${1:-}" == info ]]; then printf '%s\n' 'io.containerd.snapshotter.v1'; exit 0; fi
if [[ "${1:-}" == compose && "${2:-}" == --env-file ]]; then exit 0; fi
if [[ "${1:-}" == volume && "${2:-}" == inspect ]]; then [[ "${3:-}" == *_file-storage ]]; exit $?; fi
if [[ "${1:-}" == volume && "${2:-}" == ls ]]; then exit 0; fi
if [[ "$*" == 'compose config --format json' ]]; then python3 -c 'import json,os; print(json.dumps({"name":"tg-vault","services":{"backend":{"volumes":[{"type":os.environ.get("LOCAL_STORAGE_MOUNT_TYPE") or "volume","source":os.environ.get("LOCAL_STORAGE_SOURCE") or "file-storage","target":"/data"}]}},"volumes":{"file-storage":{"name":"tg-vault_file-storage"}}}))'; exit 0; fi
if [[ "${1:-}" == ps || "${1:-}" == info || "${1:-}" == buildx ]]; then exit 0; fi
printf '%s\n' "$*" >> "$INSTALL_TEST_DOCKER_LOG"
SH
  chmod +x "$FIXTURE/fake-bin/docker" "$FIXTURE/deploy/install.sh"
}

run_in_tty() {
  local input="$1"
  local output="$2"
  local status
  set +e
  printf '%b' "$input" | script -qec \
    "cd '$FIXTURE' && env -u CORS_ORIGIN -u VITE_API_URL PATH='$FIXTURE/fake-bin:$PATH' INSTALL_TEST_DOCKER_LOG='$FIXTURE/docker.log' bash deploy/install.sh" \
    /dev/null > "$output" 2>&1
  status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    sed -n '1,160p' "$output" >&2
    fail "交互式安装退出码为 $status"
  fi
}

test_interactive_new_install_collects_urls_and_starts_compose() {
  make_fixture
  run_in_tty 'https://cloud.example.net\nhttps://api.example.net\n\n\n' "$FIXTURE/output.log"

  assert_contains "$FIXTURE/.env" 'CORS_ORIGIN=https://cloud.example.net'
  assert_contains "$FIXTURE/.env" 'VITE_API_URL=https://api.example.net'
  assert_contains "$FIXTURE/.env" 'DB_PASSWORD='
  assert_contains "$FIXTURE/output.log" '请输入 Web 前端 URL'
  assert_contains "$FIXTURE/output.log" '请输入后端 API URL'
  assert_contains "$FIXTURE/output.log" '按 Enter 保存配置并开始安装'
  assert_contains "$FIXTURE/docker.log" 'compose config --quiet'
  assert_contains "$FIXTURE/docker.log" 'compose build backend'
  assert_contains "$FIXTURE/docker.log" 'compose build frontend'
  assert_contains "$FIXTURE/docker.log" 'compose up -d --no-build --no-deps --wait --wait-timeout 180 backend frontend'
  assert_contains "$FIXTURE/docker.log" 'compose up -d --no-build --no-deps --no-recreate --wait --wait-timeout 180 postgres'
  assert_contains "$FIXTURE/docker.log" 'compose ps'
}

# Compare complete values: substring checks would miss an appended .com suffix.
assert_origin_values() {
  python3 - "$FIXTURE/.env" "$1" "$2" <<'PY'
from pathlib import Path
import sys
values = dict(line.split('=', 1) for line in Path(sys.argv[1]).read_text().splitlines() if '=' in line)
assert values['CORS_ORIGIN'] == sys.argv[2], values['CORS_ORIGIN']
assert values['VITE_API_URL'] == sys.argv[3], values['VITE_API_URL']
PY
}

test_non_com_origins_are_preserved() {
  local web api mode
  for mode in interactive non-interactive; do
    while read -r web api; do
      (
        make_fixture
        if [[ "$mode" == interactive ]]; then
          run_in_tty "$web/\n$api/\n\n\n" "$FIXTURE/output.log"
        else
          cd "$FIXTURE"
          env PATH="$FIXTURE/fake-bin:$PATH" \
            INSTALL_TEST_DOCKER_LOG="$FIXTURE/docker.log" \
            CORS_ORIGIN="$web/" VITE_API_URL="$api/" \
            bash deploy/install.sh --non-interactive > "$FIXTURE/output.log" 2>&1
        fi
        assert_origin_values "$web" "$api"
        assert_contains "$FIXTURE/docker.log" 'compose build backend'
  assert_contains "$FIXTURE/docker.log" 'compose build frontend'
        printf 'PASS: %s origins %s %s\n' "$mode" "$web" "$api"
      )
    done <<'EOF'
https://cloud.example.cc https://api.example.cn
https://cloud.example.cn https://api.example.cc
https://cloud.example.xyz https://api.example.xyz
https://web.files.example.xyz https://api.files.example.xyz
https://cloud.example.xyz:8443 https://api.example.xyz:9443
https://web.files.example.com.cn https://api.files.example.org
https://cloud.example.cc:8443 https://api.example.cn:9443
EOF
  done
}

test_bare_domains_require_scheme_not_com() {
  make_fixture
  run_in_tty 'cloud.example.cc\nhttps://cloud.example.cc\napi.example.cn\nhttps://api.example.cn\n\n\n' "$FIXTURE/output.log"
  assert_origin_values 'https://cloud.example.cc' 'https://api.example.cn'
  assert_contains "$FIXTURE/output.log" '地址无效。请输入完整的 http(s) origin'
}

test_existing_com_defaults_can_be_replaced() {
  make_fixture
  printf 'CORS_ORIGIN=https://cloud.example.com\nVITE_API_URL=https://api.example.com\n' > "$FIXTURE/.env"
  run_in_tty 'https://cloud.example.cc\nhttps://api.example.cn\ne\n\n\n\n' "$FIXTURE/output.log"
  assert_origin_values 'https://cloud.example.cc' 'https://api.example.cn'
  assert_contains "$FIXTURE/output.log" '当前值：https://cloud.example.cc'
  assert_contains "$FIXTURE/output.log" '当前值：https://api.example.cn'
}

test_empty_first_install_does_not_select_com_examples() {
  make_fixture
  run_in_tty '\nhttps://cloud.example.cc\n\nhttps://api.example.cn\n\n\n' "$FIXTURE/output.log"
  assert_origin_values 'https://cloud.example.cc' 'https://api.example.cn'
  assert_contains "$FIXTURE/output.log" '地址无效。请输入完整的 http(s) origin'
}

test_quit_does_not_create_or_start() {
  make_fixture
  run_in_tty 'https://cloud.example.net\nhttps://api.example.net\n\nq\n' "$FIXTURE/output.log"

  [[ ! -e "$FIXTURE/.env" ]] || fail "取消安装后不应创建 .env"
  [[ ! -e "$FIXTURE/docker.log" ]] || fail "取消安装后不应调用 Docker"
  assert_contains "$FIXTURE/output.log" '已取消，未保存配置或启动服务。'
}

test_non_interactive_uses_environment_without_waiting() {
  make_fixture
  (
    cd "$FIXTURE"
    env PATH="$FIXTURE/fake-bin:$PATH" \
      INSTALL_TEST_DOCKER_LOG="$FIXTURE/docker.log" \
      CORS_ORIGIN='https://cloud.example.net/' \
      VITE_API_URL='https://api.example.net/' \
      bash deploy/install.sh --non-interactive > "$FIXTURE/output.log" 2>&1
  )

  assert_contains "$FIXTURE/.env" 'CORS_ORIGIN=https://cloud.example.net'
  assert_contains "$FIXTURE/.env" 'VITE_API_URL=https://api.example.net'
  assert_contains "$FIXTURE/docker.log" 'compose build backend'
  assert_contains "$FIXTURE/docker.log" 'compose build frontend'
  assert_contains "$FIXTURE/docker.log" 'compose up -d --no-build --no-deps --wait --wait-timeout 180 backend frontend'
  assert_contains "$FIXTURE/docker.log" 'compose up -d --no-build --no-deps --no-recreate --wait --wait-timeout 180 postgres'
}

test_existing_non_interactive_install_rejects_ambient_origin_override() {
  make_fixture
  cat > "$FIXTURE/.env" <<'EOF'
CORS_ORIGIN=https://production-cloud.example.net
VITE_API_URL=https://production-api.example.net
DB_PASSWORD=keep-this-password
EOF
  (
    cd "$FIXTURE"
    env PATH="$FIXTURE/fake-bin:$PATH" \
      INSTALL_TEST_DOCKER_LOG="$FIXTURE/docker.log" \
      CORS_ORIGIN='http://127.0.0.1:47842' \
      VITE_API_URL='http://127.0.0.1:51957' \
      bash deploy/install.sh --non-interactive > "$FIXTURE/output.log" 2>&1
  )

  assert_contains "$FIXTURE/.env" 'CORS_ORIGIN=https://production-cloud.example.net'
  assert_contains "$FIXTURE/.env" 'VITE_API_URL=https://production-api.example.net'
  if grep -Fq '127.0.0.1:47842' "$FIXTURE/.env" || grep -Fq '127.0.0.1:51957' "$FIXTURE/.env"; then
    fail "已有生产 .env 不应被环境中的 staging 地址静默覆盖"
  fi
  assert_contains "$FIXTURE/output.log" '已忽略环境变量中的 URL 覆盖'
}

test_existing_install_keeps_urls_on_enter() {
  make_fixture
  cat > "$FIXTURE/.env" <<'EOF'
CORS_ORIGIN=https://existing-cloud.example.net
VITE_API_URL=https://existing-api.example.net
DB_PASSWORD=keep-this-password
SESSION_SECRET=keep-this-session
STORAGE_CREDENTIALS_SECRET=keep-this-storage-secret
IMAGE_VERSION=v1.0.0
SOURCE_REVISION=stale-revision
SOURCE_VERSION=v1.0.0
EOF
  run_in_tty '\n\n\n' "$FIXTURE/output.log"

  assert_contains "$FIXTURE/.env" 'CORS_ORIGIN=https://existing-cloud.example.net'
  assert_contains "$FIXTURE/.env" 'VITE_API_URL=https://existing-api.example.net'
  assert_contains "$FIXTURE/.env" 'DB_PASSWORD=keep-this-password'
  assert_contains "$FIXTURE/.env" 'SESSION_SECRET=keep-this-session'
  assert_contains "$FIXTURE/.env" 'STORAGE_CREDENTIALS_SECRET=keep-this-storage-secret'
  if grep -Eq '^(IMAGE_VERSION|SOURCE_REVISION|SOURCE_VERSION)=' "$FIXTURE/.env"; then
    fail "升级后应清理旧版持久化版本元数据"
  fi
  assert_contains "$FIXTURE/output.log" '直接按 Enter 保留当前值'
}

test_environment_check_offers_to_install_missing_tools() {
  # The dedicated hermetic suite covers apt/dnf/yum/rootless consent and probes.
  python3 "$ROOT/deploy/install-environment.test.py"
}

test_secret_generation_does_not_require_openssl() {
  make_fixture
  openssl_stub="$FIXTURE/fake-bin/openssl"
  cat > "$openssl_stub" <<'SH'
#!/usr/bin/env bash
echo "openssl 不应被调用" >&2
exit 99
SH
  chmod +x "$openssl_stub"
  (
    cd "$FIXTURE"
    env PATH="$FIXTURE/fake-bin:$PATH" \
      INSTALL_TEST_DOCKER_LOG="$FIXTURE/docker.log" \
      CORS_ORIGIN='https://cloud.example.net' \
      VITE_API_URL='https://api.example.net' \
      bash deploy/install.sh --non-interactive > "$FIXTURE/output.log" 2>&1
  )
  assert_contains "$FIXTURE/.env" 'DB_PASSWORD='
  if grep -Fq 'openssl 不应被调用' "$FIXTURE/output.log"; then
    fail "安装脚本不应调用 openssl"
  fi
}

case "$SCENARIO" in
  interactive-new) test_interactive_new_install_collects_urls_and_starts_compose ;;
  quit) test_quit_does_not_create_or_start ;;
  non-interactive) test_non_interactive_uses_environment_without_waiting ;;
  existing-env-guard) test_existing_non_interactive_install_rejects_ambient_origin_override ;;
  existing) test_existing_install_keeps_urls_on_enter ;;
  environment) test_environment_check_offers_to_install_missing_tools ;;
  no-openssl) test_secret_generation_does_not_require_openssl ;;
  domains)
    test_non_com_origins_are_preserved
    test_bare_domains_require_scheme_not_com
    test_existing_com_defaults_can_be_replaced
    test_empty_first_install_does_not_select_com_examples
    ;;
  all)
    test_non_com_origins_are_preserved
    test_bare_domains_require_scheme_not_com
    test_existing_com_defaults_can_be_replaced
    test_empty_first_install_does_not_select_com_examples
    test_interactive_new_install_collects_urls_and_starts_compose
    test_quit_does_not_create_or_start
    test_non_interactive_uses_environment_without_waiting
    test_existing_non_interactive_install_rejects_ambient_origin_override
    test_existing_install_keeps_urls_on_enter
    test_environment_check_offers_to_install_missing_tools
    test_secret_generation_does_not_require_openssl
    ;;
  *) fail "未知测试场景：$SCENARIO" ;;
esac

echo "PASS: $SCENARIO"
