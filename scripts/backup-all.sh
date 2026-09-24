#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."
[[ -f docker/.env ]] || { printf 'Missing docker/.env. Run setup first.\n' >&2; exit 1; }

destination="${1:-backups}"
copy_to="${2:-}"
mkdir -p -- "$destination"
destination="$(cd "$destination" && pwd)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$destination/enderchest-$stamp"
[[ ! -e "$backup" ]] || { printf 'Backup already exists: %s\n' "$backup" >&2; exit 1; }

compose=(docker compose --env-file docker/.env -f docker/docker-compose.yml)
if grep -qx 'ENDER_SETUP_VERSION=1' docker/.env; then
  compose+=(-f docker/compose.install.yml)
fi

app_was_running=false
restore_app() {
  if [[ "$app_was_running" == true ]]; then
    "${compose[@]}" start app || printf 'Could not restart app. Run docker compose start app manually.\n' >&2
  fi
}
trap restore_app EXIT

running="$("${compose[@]}" ps --status running --services)"
if printf '%s\n' "$running" | grep -qx app; then
  app_was_running=true
  "${compose[@]}" stop app
fi

mkdir -- "$backup"
"${compose[@]}" exec -T postgres sh -c 'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' > "$backup/database.dump"
mkdir -- "$backup/storage"
"${compose[@]}" run --rm --no-deps --volume "$backup/storage:/backup" --entrypoint node app /app/scripts/storage-archive.mjs backup /backup

database_hash="$(sha256sum "$backup/database.dump" | cut -d ' ' -f 1)"
manifest_hash="$(sha256sum "$backup/storage/manifest.json" | cut -d ' ' -f 1)"
printf '{"createdUtc":"%s","databaseSha256":"%s","manifestSha256":"%s"}\n' "$stamp" "$database_hash" "$manifest_hash" > "$backup/backup-complete.json"

restore_app
app_was_running=false

if [[ -n "$copy_to" ]]; then
  mkdir -p -- "$copy_to"
  copy_to="$(cd "$copy_to" && pwd)"
  [[ "$copy_to" != "$backup" && "$copy_to" != "$backup/"* ]] || { printf 'Copy destination cannot be inside the backup.\n' >&2; exit 1; }
  [[ ! -e "$copy_to/$(basename "$backup")" ]] || { printf 'Copy already exists at destination.\n' >&2; exit 1; }
  cp -a -- "$backup" "$copy_to/"
  printf 'Copied backup to %s/%s\n' "$copy_to" "$(basename "$backup")"
fi
printf 'Complete backup: %s\n' "$backup"
