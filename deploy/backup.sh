#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f docker-compose.yml ]]; then
  echo "请从包含 docker-compose.yml 的项目目录运行。" >&2
  exit 1
fi

PROJECT_ROOT=$(pwd -P)

BACKUP_ROOT=${BACKUP_DIR:-./backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

DB_FILE="$DEST/postgres.dump"
DATA_FILE="$DEST/file-storage.tar.gz"
BACKEND_WAS_RUNNING=false
BACKEND_CONTAINER=$(docker compose ps -q backend 2>/dev/null || true)
VOLUME_NAME=''
# --all includes a stopped backend. Never guess a named volume: that can
# silently create an empty archive when the installation uses a bind mount.
BACKEND_CONTAINER=$(docker compose ps --all -q backend)
[[ -n "$BACKEND_CONTAINER" ]] || { echo '无法确认文件挂载：请先恢复原 backend 容器配置。' >&2; exit 1; }
VOLUME_NAME=$(docker inspect --format='{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$BACKEND_CONTAINER")
[[ -n "$VOLUME_NAME" ]] || { echo 'backend 缺少 /data 挂载。' >&2; exit 1; }
BACKEND_WAS_RUNNING=$(docker inspect --format='{{.State.Running}}' "$BACKEND_CONTAINER")

# Fail before the maintenance window if the destination cannot hold an uncompressed
# upper bound of the data volume plus the database dump and safety reserve.
VOLUME_BYTES=$(docker run --rm --volumes-from "$BACKEND_CONTAINER:ro" alpine:3.20 sh -c 'du -sb /data | cut -f1' | tail -1 | cut -f1 | tr -d ' ')
DATABASE_BYTES=$(docker compose exec -T postgres psql -U tgvault -d tgvault -Atqc 'SELECT pg_database_size(current_database())' | tail -1 | tr -d ' ')
AVAILABLE_BYTES=${BACKUP_AVAILABLE_BYTES_OVERRIDE:-$(df --output=avail -B1 "$DEST" | tail -1 | tr -d ' ')}
MIN_FREE_BYTES=${BACKUP_MIN_FREE_BYTES:-536870912}
for value in "$VOLUME_BYTES" "$DATABASE_BYTES" "$AVAILABLE_BYTES" "$MIN_FREE_BYTES"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { rm -rf "$DEST"; echo "无法计算备份容量需求。" >&2; exit 1; }
done
REQUIRED_BYTES=$((VOLUME_BYTES + DATABASE_BYTES + MIN_FREE_BYTES))
if (( AVAILABLE_BYTES < REQUIRED_BYTES )); then
  rm -rf "$DEST"
  echo "备份目标空间不足：需要至少 ${REQUIRED_BYTES} bytes，可用 ${AVAILABLE_BYTES} bytes；尚未停止 backend。" >&2
  exit 1
fi

restart_backend() {
  if [[ "$BACKEND_WAS_RUNNING" == true ]]; then
    BACKEND_WAS_RUNNING=false
    docker compose start backend
  fi
}
abort_backup() {
  local signal=$1
  restart_backend
  trap - "$signal"
  kill -s "$signal" "$$"
}
trap restart_backend EXIT
trap 'abort_backup INT' INT
trap 'abort_backup TERM' TERM

if [[ "$BACKEND_WAS_RUNNING" == true ]]; then
  echo "停止 backend 以保持数据库和文件备份一致；备份期间 API、上传和后台任务暂停。"
  docker compose stop -t "${BACKUP_BACKEND_STOP_TIMEOUT:-35}" backend
fi

docker compose exec -T postgres pg_dump -U tgvault -d tgvault -Fc > "$DB_FILE"
docker run --rm \
  --volumes-from "$BACKEND_CONTAINER:ro" \
  -v "$(realpath "$DEST"):/backup" \
  alpine:3.20 sh -c 'tar -C /data -czf /backup/file-storage.tar.gz .'

(
  cd "$DEST"
  {
    echo "created_at=$STAMP"
    echo "git_revision=$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "consistency=backend-stopped"
    echo "file_storage_volume=$VOLUME_NAME"
    echo "compose_services=$(cd "$PROJECT_ROOT" && docker compose config --services | tr '\n' ',')"
    sha256sum postgres.dump file-storage.tar.gz
  } > manifest.txt
)

chmod -R go-rwx "$DEST"
restart_backend
trap - EXIT INT TERM

echo "备份已创建：$DEST"
echo "一致性：backend-stopped（数据库和 /data 归档期间无应用写入）。"
echo "备份含数据库与密钥，请加密并异地保存；.env 不在归档内，需另行备份。"
