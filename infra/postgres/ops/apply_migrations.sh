#!/bin/sh
set -eu

: "${DATABASE_MIGRATIONS_URL:?DATABASE_MIGRATIONS_URL is required}"
: "${MIGRATION_DIR:=$(CDPATH= cd -- "$(dirname -- "$0")/../migrations" && pwd)}"

temporary_script=$(mktemp)
trap 'rm -f "$temporary_script"' EXIT HUP INT TERM

{
  printf '%s\n' '\set ON_ERROR_STOP on'
  printf '%s\n' 'SELECT pg_advisory_lock(1836019303, 1);'
  printf '%s\n' 'CREATE SCHEMA IF NOT EXISTS app_ops;'
  printf '%s\n' 'CREATE TABLE IF NOT EXISTS app_ops.schema_migration (version text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());'

  found_migration=false
  for migration in "$MIGRATION_DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
    [ -f "$migration" ] || continue
    found_migration=true
    filename=$(basename "$migration")
    version=${filename%.sql}
    checksum=$(sha256sum "$migration" | cut -d ' ' -f 1)

    printf "SELECT NOT EXISTS (SELECT 1 FROM app_ops.schema_migration WHERE version = '%s') AS should_apply, COALESCE((SELECT checksum = '%s' FROM app_ops.schema_migration WHERE version = '%s'), false) AS checksum_matches \\gset\n" \
      "$version" "$checksum" "$version"
    printf '%s\n' '\if :should_apply'
    printf '\\i %s\n' "$migration"
    printf "INSERT INTO app_ops.schema_migration (version, checksum) VALUES ('%s', '%s');\n" "$version" "$checksum"
    printf '%s\n' '\elif :checksum_matches'
    printf '%s\n' "\\echo Skipping already applied migration $version"
    printf '%s\n' '\else'
    printf '%s\n' "\\echo Migration checksum mismatch for $version"
    printf '%s\n' '\quit 3'
    printf '%s\n' '\endif'
  done

  if [ "$found_migration" != true ]; then
    printf '%s\n' 'No migration files found.' >&2
    exit 1
  fi
  printf '%s\n' 'SELECT pg_advisory_unlock(1836019303, 1);'
} > "$temporary_script"

psql "$DATABASE_MIGRATIONS_URL" -v ON_ERROR_STOP=1 -f "$temporary_script"

