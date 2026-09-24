$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$previous = Get-Location
$envFile = Join-Path $root "docker/.env"
$pendingEnv = Join-Path $root "docker/.env.pending"
$storageFile = Join-Path $root "docker/.setup-storage-path"
$pendingStorage = Join-Path $root "docker/.setup-storage-path.pending"
$compose = @("compose", "--env-file", "docker/.env", "-f", "docker/docker-compose.yml", "-f", "docker/compose.install.yml")

function Invoke-Docker([string[]]$Arguments) {
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed with exit code $LASTEXITCODE" }
}

function Assert-PortAvailable([int]$Port) {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
  try { $listener.Start() }
  catch { throw "Port $Port is already in use. Close the other program using it, then rerun setup. No EnderChest data was changed." }
  finally { $listener.Stop() }
}

function Assert-FreshInstall {
  $containers = & docker ps -a --format '{{.Names}}'
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect Docker containers" }
  foreach ($name in @("enderchest_app", "enderchest_postgres", "enderchest_garage")) {
    if ($containers -contains $name) { throw "An EnderChest container already exists. Setup will not replace it." }
  }
  $volumes = & docker volume ls --format '{{.Name}}'
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect Docker volumes" }
  foreach ($name in @("docker_enderchest_postgres_data", "docker_enderchest_garage_meta", "docker_enderchest_garage_data")) {
    if ($volumes -contains $name) { throw "Existing EnderChest data volume $name found. Setup will not replace it." }
  }
}

function Start-Wizard {
  Assert-PortAvailable 4400
  $hostRoot = $root.Replace("\", "/")
  $job = Start-Job -ScriptBlock {
    param($projectRoot, $storageRoot)
    Set-Location $projectRoot
    & docker run --rm -p "127.0.0.1:4400:4400" -v "${projectRoot}:/setup" -e "ENDER_HOST_ROOT=$storageRoot" -e "ENDER_HOST_OS=windows" -w /setup node:22-bookworm node scripts/setup-wizard.mjs web
    if ($LASTEXITCODE -ne 0) { throw "The setup wizard container failed" }
  } -ArgumentList $root, $hostRoot
  try {
    $ready = $false
    for ($i = 0; $i -lt 180; $i++) {
      if ($job.State -ne "Running") { break }
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4400/health" -TimeoutSec 1
        if ($response.StatusCode -eq 200) { $ready = $true; break }
      } catch { Start-Sleep -Seconds 1 }
    }
    if (!$ready) { throw "The setup page did not start. Check Docker Desktop and port 4400." }
    Write-Host "Setup page: http://127.0.0.1:4400"
    Start-Process "http://127.0.0.1:4400/"
    Wait-Job $job | Out-Null
    Receive-Job $job
    if ($job.State -ne "Completed") { throw "Setup was not completed." }
  } finally {
    if ($job.State -eq "Running") { Stop-Job $job }
    Remove-Job $job -Force
  }
}

function Assert-StorageFolder([string]$StorageRoot, [bool]$Resume) {
  if (![IO.Path]::IsPathRooted($StorageRoot) -or $StorageRoot -notmatch '^[A-Za-z]:[/\\]') { throw "Storage path must be an absolute Windows drive path" }
  if (Test-Path -LiteralPath $StorageRoot) {
    $item = Get-Item -LiteralPath $StorageRoot -Force
    if (!$item.PSIsContainer -or $item.LinkType) { throw "Storage path must be a real folder, not a file or link" }
    if (!$Resume) {
      $entries = @(Get-ChildItem -LiteralPath $StorageRoot -Force)
      if ($entries.Count -gt 0 -and !($entries.Count -eq 1 -and $entries[0].Name -eq "objects" -and !$entries[0].LinkType -and @(Get-ChildItem -LiteralPath $entries[0].FullName -Force).Count -eq 0)) {
        throw "Storage folder is not empty. Choose a new or empty folder; no files were changed."
      }
    }
  }
  $objects = Join-Path $StorageRoot "objects"
  if (Test-Path -LiteralPath $objects) {
    $item = Get-Item -LiteralPath $objects -Force
    if (!$item.PSIsContainer -or $item.LinkType) { throw "Objects path must be a real folder" }
  } else { New-Item -ItemType Directory -Path $objects -Force | Out-Null }
}

try {
  Set-Location $root
  if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop was not found. Install it, start it, then rerun setup: https://docs.docker.com/desktop/setup/install/windows-install/" }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is missing. Update or reinstall Docker Desktop, then check 'docker compose version'." }
  & docker info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is installed but its engine is not ready. Open Docker Desktop, wait for it to start, then run 'docker info' and rerun setup." }
  foreach ($key in @("POSTGRES_PASSWORD", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "GARAGE_RPC_SECRET", "BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PASSWORD", "ENDER_STORAGE_ROOT", "PUBLIC_APP_URL", "PUBLIC_LINK_SECRET", "PUBLIC_MODE", "DOMAIN", "S3_PUBLIC_DOMAIN")) {
    [Environment]::SetEnvironmentVariable($key, $null, "Process")
  }
  if (Test-Path -LiteralPath $envFile) {
    if (!(Select-String -LiteralPath $envFile -Pattern '^ENDER_SETUP_VERSION=1$' -Quiet)) {
      Write-Host "An existing manually configured EnderChest installation was found. Setup made no changes."
      exit 0
    }
    if (!(Test-Path -LiteralPath $storageFile)) { throw "Setup storage record is missing. No data was changed." }
    $storageRoot = (Get-Content -LiteralPath $storageFile -Raw).Trim()
    Assert-StorageFolder $storageRoot $true
  } else {
    Assert-FreshInstall
    Assert-PortAvailable 3000
    if (!(Test-Path -LiteralPath $pendingEnv) -and !(Test-Path -LiteralPath $pendingStorage)) { Start-Wizard }
    if (!(Test-Path -LiteralPath $pendingEnv) -or !(Test-Path -LiteralPath $pendingStorage)) { throw "Setup is incomplete. No existing data was changed." }
    $storageRoot = (Get-Content -LiteralPath $pendingStorage -Raw).Trim()
    Assert-StorageFolder $storageRoot $false
    Invoke-Docker @("compose", "--env-file", "docker/.env.pending", "-f", "docker/docker-compose.yml", "-f", "docker/compose.install.yml", "config", "--quiet")
    Move-Item -LiteralPath $pendingStorage -Destination $storageFile
    Move-Item -LiteralPath $pendingEnv -Destination $envFile
  }
  Write-Host "Starting EnderChest. The first build can take several minutes..."
  if (Test-Path -LiteralPath "docker/.env.public") {
    $publicSetting = Select-String -LiteralPath "docker/.env.public" -Pattern '^PUBLIC_MODE=(funnel|provider|domain)$'
    if (!$publicSetting) { throw "Public connection settings are incomplete. No data was changed. See docs/public-access.md." }
    $publicMode = $publicSetting.Matches.Groups[1].Value
    $compose = @("compose", "--env-file", "docker/.env", "--env-file", "docker/.env.public", "-f", "docker/docker-compose.yml", "-f", "docker/compose.install.yml")
    switch ($publicMode) {
      { $_ -in "funnel", "provider" } { $compose += @("-f", "docker/compose.public-app.yml") }
      "domain" { $compose += @("-f", "docker/compose.production.yml") }
      default { throw "Unknown public connection mode. No data was changed." }
    }
  }
  New-Item -ItemType Directory -Path (Join-Path $root "backups") -Force | Out-Null
  & docker @compose up -d --build --wait
  if ($LASTEXITCODE -ne 0) { throw "Docker could not start EnderChest. Read the error above, check free disk space and port 3000, then rerun setup. Existing volumes and files were not removed." }
  Write-Host "EnderChest is ready at http://localhost:3000"
  Write-Host "Uploaded file bytes: $storageRoot\objects"
  Write-Host "For access outside this computer, follow docs/public-access.md before sharing invitation links."
  Start-Process "http://localhost:3000"
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  Set-Location $previous
}
