#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
root="$PWD"
[[ -f docker/.env ]] || { printf 'Set up EnderChest locally with bash setup.sh before publishing.\n' >&2; exit 1; }
command -v docker >/dev/null || { printf 'Docker was not found. Install Docker Engine first: https://docs.docker.com/engine/install/\n' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { printf 'Docker Compose v2 is missing: https://docs.docker.com/compose/install/linux/\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Docker is not running or your user cannot access it. Run docker info, then retry.\n' >&2; exit 1; }
for key in PUBLIC_APP_URL PUBLIC_LINK_SECRET PUBLIC_MODE DOMAIN S3_PUBLIC_DOMAIN; do unset "$key" || true; done

mode="${1:-}"
if [[ -z "$mode" ]]; then
  printf 'Publish with: 1) Tailscale Funnel  2) Own HTTPS provider  3) Own domain with Caddy\n'
  read -r -p 'Choose 1, 2, or 3: ' choice
  case "$choice" in 1) mode=funnel ;; 2) mode=provider ;; 3) mode=domain ;; *) printf 'Invalid choice.\n' >&2; exit 1 ;; esac
fi

if [[ -f docker/.env.public ]]; then
  previous_mode="$(sed -n 's/^PUBLIC_MODE=//p' docker/.env.public)"
  [[ "$mode" == "$previous_mode" ]] || { printf 'This server is already published with %s. Switching connection methods needs a planned change; no settings were changed.\n' "$previous_mode" >&2; exit 1; }
fi

case "$mode" in
  funnel)
    command -v tailscale >/dev/null || { printf 'Tailscale was not found. Install it on this host, open it, and sign in: https://tailscale.com/download\n' >&2; exit 1; }
    tailscale status >/dev/null 2>&1 || { printf 'Tailscale is not connected. Sign in on this host and check tailscale status before retrying.\n' >&2; exit 1; }
    tailscale funnel --bg 3000 || { printf 'Funnel could not start. It may need approval in your Tailscale account. See https://tailscale.com/docs/features/tailscale-funnel/\n' >&2; exit 1; }
    read -r -p 'Paste the HTTPS .ts.net URL shown by Tailscale: ' public_url
    values=("$public_url")
    overlay=docker/compose.public-app.yml
    ;;
  provider)
    read -r -p 'Public HTTPS URL routing to this computer (for example https://drive.example.com): ' public_url
    values=("$public_url")
    overlay=docker/compose.public-app.yml
    ;;
  domain)
    read -r -p 'App hostname (for example drive.example.com): ' app_domain
    read -r -p 'File hostname (for example files.example.com): ' files_domain
    values=("$app_domain" "$files_domain")
    overlay=docker/compose.production.yml
    ;;
  *) printf 'Choose funnel, provider, or domain.\n' >&2; exit 1 ;;
esac

docker run --rm --user "$(id -u):$(id -g)" -v "$root:/setup" -w /setup node:22-bookworm node scripts/publish-config.mjs "$mode" "${values[@]}"
compose=(docker compose --env-file docker/.env --env-file docker/.env.public -f docker/docker-compose.yml)
if [[ -f docker/.setup-storage-path ]]; then compose+=(-f docker/compose.install.yml); fi
compose+=(-f "$overlay")
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --wait
printf 'Public address configured: %s\nTest it from a phone on mobile data before sending invitations.\n' "${public_url:-https://$app_domain}"
