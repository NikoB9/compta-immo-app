#!/bin/sh
set -eu
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
cd "$repo_root"

compose_env=${COMPOSE_ENV_FILE:-infra/deploy/.env}
case "$compose_env" in
  /*) ;;
  *) compose_env="$repo_root/$compose_env" ;;
esac
if [ ! -r "$compose_env" ]; then
  printf 'Compose env file is not readable: %s\n' "$compose_env" >&2
  exit 1
fi

backup_root=${BACKUP_DIR:-$repo_root/backups}
case "$backup_root" in
  /*) ;;
  *) backup_root="$repo_root/$backup_root" ;;
esac
mkdir -p "$backup_root"
chmod 700 "$backup_root"

compose() {
  docker compose --env-file "$compose_env" "$@"
}

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker CLI is required.\n' >&2
  exit 1
fi
if ! command -v tar >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1; then
  printf 'tar and sha256sum are required.\n' >&2
  exit 1
fi

# Require a running app so this script never unexpectedly starts a stopped service.
if ! compose exec -T app node -e 'process.exit(0)' >/dev/null 2>&1; then
  printf 'The app service must be running before a consistent backup can start.\n' >&2
  exit 1
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
final_dir="$backup_root/compta-immo-$timestamp-$$"
temporary_dir=$(mktemp -d "$backup_root/.compta-immo-backup.XXXXXX")
app_may_need_restart=true
backup_complete=false

cleanup() {
  exit_code=$?
  trap - EXIT
  if [ "$app_may_need_restart" = true ]; then
    if ! compose start app >/dev/null; then
      printf 'The app service could not be restarted after the backup operation.\n' >&2
      exit_code=1
    fi
  fi
  if [ "$backup_complete" != true ]; then
    rm -rf "$temporary_dir"
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

compose stop app >/dev/null

# The application is paused while both the relational state and private files are copied.
database_name=$(compose exec -T database sh -ec 'printf "%s" "$POSTGRES_DB"')
compose exec -T database sh -ec \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
  > "$temporary_dir/database.dump"
app_container=$(compose ps -q --all app)
if [ -z "$app_container" ]; then
  printf 'Could not locate the app container for the document snapshot.\n' >&2
  exit 1
fi
mkdir "$temporary_dir/documents"
docker cp "$app_container:/var/lib/compta-immo/documents/." "$temporary_dir/documents/"
tar -C "$temporary_dir/documents" -cpf "$temporary_dir/documents.tar" .
rm -rf "$temporary_dir/documents"

# Confirm both archive formats can be read before publishing the backup directory.
compose exec -T database pg_restore --list - < "$temporary_dir/database.dump" >/dev/null
tar -tf "$temporary_dir/documents.tar" >/dev/null
{
  printf 'format=1\n'
  printf 'created_at_utc=%s\n' "$timestamp"
  printf 'database_name=%s\n' "$database_name"
  printf 'source_revision=%s\n' "$(git rev-parse HEAD 2>/dev/null || printf unknown)"
} > "$temporary_dir/README.txt"
(cd "$temporary_dir" && sha256sum database.dump documents.tar > SHA256SUMS)
chmod 600 "$temporary_dir/database.dump" "$temporary_dir/documents.tar" \
  "$temporary_dir/README.txt" "$temporary_dir/SHA256SUMS"

if [ -e "$final_dir" ]; then
  printf 'Backup destination already exists: %s\n' "$final_dir" >&2
  exit 1
fi
mv "$temporary_dir" "$final_dir"
backup_complete=true
temporary_dir=''
compose start app >/dev/null
app_may_need_restart=false
printf 'Backup created: %s\n' "$final_dir"
