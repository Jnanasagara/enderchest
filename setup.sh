#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
root="$PWD"
env_file=docker/.env
pending_env=docker/.env.pending
storage_file=docker/.setup-storage-path
pending_storage=docker/.setup-storage-path.pending
compose=(docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.install.yml)

fail() { printf 'Setup stopped: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker was not found. Install Docker Engine for Linux: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing. Install the Compose plugin: https://docs.docker.com/compose/install/linux/"
docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || fail "Docker is installed but cannot be reached. Start the Docker service, then run 'docker info'. If permission is denied, add your user to the Docker group and sign out and back in: https://docs.docker.com/engine/install/linux-postinstall/"

port_available() {
  ! (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
}

for key in POSTGRES_PASSWORD S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY GARAGE_RPC_SECRET BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD ENDER_STORAGE_ROOT PUBLIC_APP_URL PUBLIC_LINK_SECRET PUBLIC_MODE DOMAIN S3_PUBLIC_DOMAIN; do
  unset "$key" || true
done

fresh_install() {
  local name
  while IFS= read -r name; do
    case "$name" in
      enderchest_app|enderchest_postgres|enderchest_garage) fail "An EnderChest container already exists; setup will not replace it." ;;
    esac
  done < <(docker ps -a --format '{{.Names}}')
  while IFS= read -r name; do
    case "$name" in
      docker_enderchest_postgres_data|docker_enderchest_garage_meta|docker_enderchest_garage_data) fail "Existing EnderChest volume $name found; setup will not replace it." ;;
    esac
  done < <(docker volume ls --format '{{.Name}}')
}

storage_folder() {
  local target="$1" resume="$2" entry
  [[ "$target" == /* && "$target" != / ]] || fail "Storage path must be an absolute Linux folder path."
  [[ ! -L "$target" ]] || fail "Storage folder cannot be a symbolic link."
  if [[ -e "$target" ]]; then
    [[ -d "$target" ]] || fail "Storage path is not a folder."
    if [[ "$resume" == false ]]; then
      shopt -s nullglob dotglob
      local entries=("$target"/*)
      shopt -u nullglob dotglob
      if ((${#entries[@]} > 0)); then
        if ((${#entries[@]} != 1)) || [[ "${entries[0]}" != "$target/objects" ]] || [[ -L "$target/objects" ]] || [[ -n "$(ls -A -- "$target/objects" 2>/dev/null)" ]]; then
          fail "Storage folder is not empty. Choose a new or empty folder; no files were changed."
        fi
      fi
    fi
  fi
  [[ ! -L "$target/objects" ]] || fail "Objects folder cannot be a symbolic link."
  [[ ! -e "$target/objects" || -d "$target/objects" ]] || fail "Objects path is not a folder."
  mkdir -p -- "$target/objects"
}

wizard_web() {
  port_available 4400 || fail "Port 4400 is already in use. Close the other program using it, then rerun setup. This port is only for the local setup page."
  docker run --rm --user "$(id -u):$(id -g)" -p 127.0.0.1:4400:4400 -v "$root:/setup" -e "ENDER_HOST_ROOT=$root" -e ENDER_HOST_OS=linux -w /setup node:22-bookworm node scripts/setup-wizard.mjs web &
  local wizard_pid=$!
  trap 'kill "$wizard_pid" 2>/dev/null || true' EXIT
  local ready=false
  for ((i=0; i<180; i++)); do
    if ! kill -0 "$wizard_pid" 2>/dev/null; then break; fi
    if (echo >/dev/tcp/127.0.0.1/4400) >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  [[ "$ready" == true ]] || fail "Setup page did not start. Check Docker and port 4400."
  printf 'Setup page: http://127.0.0.1:4400\n'
  if command -v xdg-open >/dev/null; then xdg-open http://127.0.0.1:4400/ >/dev/null 2>&1 || true; fi
  wait "$wizard_pid" || fail "Setup wizard did not finish."
  trap - EXIT
}

if [[ -f "$env_file" ]]; then
  if ! grep -qx 'ENDER_SETUP_VERSION=1' "$env_file"; then
    printf 'Existing manually configured EnderChest installation found. Setup made no changes.\n'
    exit 0
  fi
  [[ -f "$storage_file" ]] || fail "Setup storage record is missing. No data was changed."
  storage_root="$(<"$storage_file")"
  storage_folder "$storage_root" true
else
  fresh_install
  port_available 3000 || fail "Port 3000 is already in use. Close the other app using it, then rerun setup. No EnderChest data was changed."
  if [[ ! -e "$pending_env" && ! -e "$pending_storage" ]]; then
    if [[ "${1:-}" == --cli || ( "${1:-}" != --web && -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ) ]]; then
      [[ -t 0 ]] || fail "Run setup in an interactive terminal, or use --web with an SSH port forward."
      docker run --rm -it --user "$(id -u):$(id -g)" -v "$root:/setup" -e "ENDER_HOST_ROOT=$root" -e ENDER_HOST_OS=linux -w /setup node:22-bookworm node scripts/setup-wizard.mjs cli
    else
      wizard_web
    fi
  fi
  [[ -f "$pending_env" && -f "$pending_storage" ]] || fail "Setup is incomplete. No existing data was changed."
  storage_root="$(<"$pending_storage")"
  storage_folder "$storage_root" false
  docker compose --env-file docker/.env.pending -f docker/docker-compose.yml -f docker/compose.install.yml config --quiet
  mv -- "$pending_storage" "$storage_file"
  mv -- "$pending_env" "$env_file"
fi

if [[ -f docker/.env.public ]]; then
  public_mode="$(sed -n 's/^PUBLIC_MODE=//p' docker/.env.public)"
  compose=(docker compose --env-file docker/.env --env-file docker/.env.public -f docker/docker-compose.yml -f docker/compose.install.yml)
  case "$public_mode" in
    funnel|provider) compose+=(-f docker/compose.public-app.yml) ;;
    domain) compose+=(-f docker/compose.production.yml) ;;
    *) fail "Unknown public connection mode. No data was changed." ;;
  esac
fi

printf 'Starting EnderChest. The first build can take several minutes...\n'
mkdir -p -- "$root/backups"
"${compose[@]}" up -d --build --wait || fail "Docker could not start EnderChest. Read the error above, check free disk space and whether port 3000 is in use, then rerun setup. Existing volumes and files were not removed."
printf 'EnderChest is ready at http://localhost:3000\nUploaded file bytes: %s/objects\n' "$storage_root"
printf 'For access outside this computer, follow docs/public-access.md before sharing invitation links.\n'
