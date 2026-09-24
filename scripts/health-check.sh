#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."
[[ -f docker/.env ]] || { printf 'Missing docker/.env. Run setup first.\n' >&2; exit 1; }
compose=(docker compose --env-file docker/.env -f docker/docker-compose.yml)
if grep -qx 'ENDER_SETUP_VERSION=1' docker/.env; then
  compose+=(-f docker/compose.install.yml)
fi

for service in postgres garage app; do
  container="$("${compose[@]}" ps -q "$service")"
  [[ -n "$container" ]] || { printf '%s is not running. Check Docker logs.\n' "$service" >&2; exit 1; }
  health="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  [[ "$health" == healthy ]] || { printf '%s is %s. Check Docker logs.\n' "$service" "$health" >&2; exit 1; }
done

"${compose[@]}" exec -T app node -e "fetch('http://localhost:3000/api/db/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
printf 'EnderChest healthy: app, PostgreSQL, Garage\n'
