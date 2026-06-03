#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup-file>"
  exit 1
fi

backup_file="$1"

if [ ! -f "${backup_file}" ]; then
  echo "Backup file not found: ${backup_file}"
  exit 1
fi

docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yml \
  exec -T postgres \
  sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --exit-on-error' \
  < "${backup_file}"

echo "Database restored from ${backup_file}"
