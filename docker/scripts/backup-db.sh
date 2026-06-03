#!/bin/sh
set -eu

backup_dir="${1:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/enderchest-${timestamp}.dump"

mkdir -p "${backup_dir}"

docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yml \
  exec -T postgres \
  sh -c 'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
  > "${backup_file}"

echo "Database backup written to ${backup_file}"
