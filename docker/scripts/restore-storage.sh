#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "Usage: $0 <storage-backup-directory>"
  exit 1
fi
backup_dir="$(cd "$1" && pwd)"

set -- --env-file docker/.env -f docker/docker-compose.yml
if grep -qx 'ENDER_SETUP_VERSION=1' docker/.env; then
  set -- "$@" -f docker/compose.install.yml
fi

docker compose "$@" \
  run --rm --no-deps --volume "${backup_dir}:/backup:ro" --entrypoint node app \
  /app/scripts/storage-archive.mjs restore /backup

echo "Objects restored from ${backup_dir}"
