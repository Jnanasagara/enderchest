param([string]$BaseUrl = "http://localhost:3000")

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$previous = Get-Location
try {
  Set-Location $root
  $compose = @("compose", "--env-file", "docker/.env", "-f", "docker/docker-compose.yml")
  if (Select-String -LiteralPath (Join-Path $root "docker/.env") -Pattern '^ENDER_SETUP_VERSION=1$' -Quiet) {
    $compose += @("-f", "docker/compose.install.yml")
  }
  $rows = & docker @compose ps --format json
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect Docker services" }
  $services = @($rows | ForEach-Object { $_ | ConvertFrom-Json })
  foreach ($service in @("postgres", "garage", "app")) {
    $state = $services | Where-Object { $_.Service -eq $service } | Select-Object -First 1
    if (!$state -or $state.State -ne "running" -or $state.Health -ne "healthy") { throw "$service is not healthy" }
  }
  $health = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/db/health" -TimeoutSec 10
  if (!$health.ok) { throw "Application or database is unhealthy" }
  Write-Output "EnderChest healthy: app, PostgreSQL, Garage"
} finally {
  Set-Location $previous
}
