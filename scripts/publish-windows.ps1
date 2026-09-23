$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$previous = Get-Location

try {
  Set-Location $root
  if (!(Test-Path -LiteralPath "docker/.env")) { throw "Set up EnderChest locally with Setup-EnderChest.cmd before publishing." }
  if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop was not found. Install and start it: https://docs.docker.com/desktop/setup/install/windows-install/" }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is missing. Update Docker Desktop, then check 'docker compose version'." }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not ready. Open it, wait for the engine to start, then check 'docker info'." }
  foreach ($key in @("PUBLIC_APP_URL", "PUBLIC_LINK_SECRET", "PUBLIC_MODE", "DOMAIN", "S3_PUBLIC_DOMAIN")) {
    [Environment]::SetEnvironmentVariable($key, $null, "Process")
  }
  Write-Host "Publish with: 1) Tailscale Funnel  2) Own HTTPS provider  3) Own domain with Caddy"
  $choice = Read-Host "Choose 1, 2, or 3"
  switch ($choice) {
    "1" {
      $mode = "funnel"
      $overlay = "docker/compose.public-app.yml"
    }
    "2" {
      $mode = "provider"
      $values = @((Read-Host "Public HTTPS URL routing to this computer"))
      $overlay = "docker/compose.public-app.yml"
    }
    "3" {
      $mode = "domain"
      $values = @((Read-Host "App hostname"), (Read-Host "File hostname"))
      $overlay = "docker/compose.production.yml"
    }
    default { throw "Choose 1, 2, or 3." }
  }
  if (Test-Path -LiteralPath "docker/.env.public") {
    $publicSetting = Select-String -LiteralPath "docker/.env.public" -Pattern '^PUBLIC_MODE=(funnel|provider|domain)$'
    if (!$publicSetting) { throw "Saved public connection settings are incomplete. No settings were changed. See docs/public-access.md." }
    $previousMode = $publicSetting.Matches.Groups[1].Value
    if ($mode -ne $previousMode) { throw "This server already uses $previousMode. Switching connection methods needs a planned change; no settings were changed." }
  }
  if ($mode -eq "funnel") {
    $tailscaleCommand = Get-Command tailscale -ErrorAction SilentlyContinue
    $tailscale = if ($tailscaleCommand) { $tailscaleCommand.Source } else { "C:\Program Files\Tailscale\tailscale.exe" }
    if (!(Test-Path -LiteralPath $tailscale)) { throw "Tailscale was not found. Install it on this host and sign in: https://tailscale.com/download" }
    & $tailscale status *> $null
    if ($LASTEXITCODE -ne 0) { throw "Tailscale is not connected. Sign in on this host and check 'tailscale status' before retrying." }
    & $tailscale funnel --bg 3000
    if ($LASTEXITCODE -ne 0) { throw "Funnel could not start. It may need approval in your Tailscale account: https://tailscale.com/docs/features/tailscale-funnel/" }
    $values = @((Read-Host "Paste the HTTPS .ts.net URL shown by Tailscale"))
  }
  $projectRoot = $root.Replace("\", "/")
  & docker run --rm -v "${projectRoot}:/setup" -w /setup node:22-bookworm node scripts/publish-config.mjs $mode @values
  if ($LASTEXITCODE -ne 0) { throw "Could not save public configuration." }
  $compose = @("compose", "--env-file", "docker/.env", "--env-file", "docker/.env.public", "-f", "docker/docker-compose.yml")
  if (Test-Path -LiteralPath "docker/.setup-storage-path") { $compose += @("-f", "docker/compose.install.yml") }
  $compose += @("-f", $overlay)
  & docker @compose config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Public Docker configuration is invalid." }
  & docker @compose up -d --build --wait
  if ($LASTEXITCODE -ne 0) { throw "EnderChest did not become healthy. Check Docker logs." }
  $publicAddress = if ($mode -eq "domain") { "https://$($values[0])" } else { $values[0] }
  Write-Host "Public address configured: $publicAddress"
  Write-Host "Test it from a phone on mobile data before sending invitations."
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  Set-Location $previous
}
