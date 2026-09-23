#!/bin/sh
set -eu

backup_dir="${1:-./backups/storage-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "${backup_dir}"
backup_dir="$(cd "${backup_dir}" && pwd)"

set -- --env-file docker/.env -f docker/docker-compose.yml
if grep -qx 'ENDER_SETUP_VERSION=1' docker/.env; then
  set -- "$@" -f docker/compose.install.yml
fi

docker compose "$@" \
  run --rm --no-deps --volume "${backup_dir}:/backup" --entrypoint node app \
  /app/scripts/storage-archive.mjs backup /backup

echo "Object backup written to ${backup_dir}"
