#!/bin/sh
set -eu
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
cd "$repo_root"

if [ "$#" -ne 1 ]; then
  printf 'Usage: sh infra/deploy/restore-staging.sh /path/to/compta-immo-backup\n' >&2
  exit 2
fi

backup_dir=$1
case "$backup_dir" in
  /*) ;;
  *) backup_dir="$repo_root/$backup_dir" ;;
esac
backup_dir=$(CDPATH= cd -- "$backup_dir" && pwd)

compose_env=${COMPOSE_ENV_FILE:-infra/deploy/.env}
case "$compose_env" in
  /*) ;;
  *) compose_env="$repo_root/$compose_env" ;;
esac
if [ ! -r "$compose_env" ]; then
  printf 'Compose env file is not readable: %s\n' "$compose_env" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1 || ! command -v awk >/dev/null 2>&1; then
  printf 'Docker CLI, tar, sha256sum, and awk are required.\n' >&2
  exit 1
fi

for archive in database.dump documents.tar; do
  if [ ! -s "$backup_dir/$archive" ]; then
    printf 'Missing or empty backup archive: %s\n' "$archive" >&2
    exit 1
  fi
done
if [ ! -r "$backup_dir/SHA256SUMS" ]; then
  printf 'Missing SHA256SUMS in backup directory.\n' >&2
  exit 1
fi
awk '
  NF != 2 || length($1) != 64 || $1 ~ /[^[:xdigit:]]/ { invalid = 1 }
  $2 != "database.dump" && $2 != "documents.tar" { invalid = 1 }
  { seen[$2]++; count++ }
  END {
    if (invalid || count != 2 || seen["database.dump"] != 1 || seen["documents.tar"] != 1) exit 1
  }
' "$backup_dir/SHA256SUMS" || {
  printf 'SHA256SUMS must contain exactly the two expected archive checksums.\n' >&2
  exit 1
}
(cd "$backup_dir" && sha256sum --check --status SHA256SUMS) || {
  printf 'Backup checksum validation failed.\n' >&2
  exit 1
}

compose() {
  docker compose --env-file "$compose_env" "$@"
}

temporary_list=$(mktemp)
temporary_types=$(mktemp)
trap 'rm -f "$temporary_list" "$temporary_types"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tar -tf "$backup_dir/documents.tar" > "$temporary_list"
tar -tvf "$backup_dir/documents.tar" > "$temporary_types"
awk 'substr($0, 1, 1) !~ /^[d-]$/ { exit 1 }' "$temporary_types" || {
  printf 'Document archive may contain only regular files and directories.\n' >&2
  exit 1
}
awk '
  BEGIN {
    uuid = "[[:xdigit:]]{8}-[[:xdigit:]]{4}-[1-8][[:xdigit:]]{3}-[89aAbB][[:xdigit:]]{3}-[[:xdigit:]]{12}"
    object_path = "^" uuid "(/" uuid ")?$"
  }
  {
    path = $0
    sub(/^\.\//, "", path)
    sub(/\/$/, "", path)
    if (path == "" || path == ".") next
    if (path !~ object_path) exit 1
  }
' "$temporary_list" || {
  printf 'Document archive contains an unexpected path.\n' >&2
  exit 1
}
rm -f "$temporary_list"
rm -f "$temporary_types"

if ! compose exec -T database pg_isready >/dev/null 2>&1; then
  printf 'The database service must be running before a staging restore.\n' >&2
  exit 1
fi
compose exec -T database pg_restore --list - < "$backup_dir/database.dump" >/dev/null

timestamp=$(date -u +%Y%m%d%H%M%S)
target_database="restore_${timestamp}_$$"
target_volume="compta_restore_documents_${timestamp}_$$"
database_created=false
volume_created=false
restore_complete=false

cleanup() {
  exit_code=$?
  trap - EXIT
  if [ "$restore_complete" != true ]; then
    if [ "$database_created" = true ]; then
      compose exec -T database sh -ec 'dropdb --if-exists --username="$POSTGRES_USER" "$1"' sh "$target_database" >/dev/null || exit_code=1
    fi
    if [ "$volume_created" = true ]; then
      docker volume rm "$target_volume" >/dev/null || exit_code=1
    fi
  fi
  rm -f "$temporary_list" "$temporary_types"
  exit "$exit_code"
}
trap cleanup EXIT

# Names are generated here. Never clean or reuse an operator's database or volume.
compose exec -T database sh -ec 'createdb --username="$POSTGRES_USER" "$1"' sh "$target_database"
database_created=true
docker volume create "$target_volume" >/dev/null
volume_created=true
compose exec -T database sh -ec \
  'pg_restore --exit-on-error --username="$POSTGRES_USER" --dbname="$1" --no-owner --no-privileges' \
  sh "$target_database" < "$backup_dir/database.dump"
compose exec -T database sh -ec \
  'psql --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$1" --file=/infra/postgres/ops/grant_runtime_session_access.sql --file=/infra/postgres/ops/grant_runtime_ledger_access.sql' \
  sh "$target_database"
docker run --rm \
  --user 0:0 \
  --entrypoint tar \
  --volume "$target_volume:/restore" \
  --volume "$backup_dir/documents.tar:/backup/documents.tar:ro" \
  postgres:18 -xpf /backup/documents.tar -C /restore

restore_complete=true
printf 'Staging restore created. Database: %s\nDocument volume: %s\n' "$target_database" "$target_volume"
printf 'This contains private production data. Keep it isolated and delete it after verification.\n'
