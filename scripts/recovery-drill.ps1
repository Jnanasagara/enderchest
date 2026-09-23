param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [string]$Project = "enderchest-recovery"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backup = (Resolve-Path -LiteralPath $BackupPath).Path
$previous = Get-Location
$compose = @("compose", "-p", $Project, "--env-file", "docker/.env", "-f", "docker/compose.recovery.yml")

function Invoke-CheckedDocker([string[]]$DockerArgs) {
  & docker @DockerArgs
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed with exit code $LASTEXITCODE" }
}

try {
  Set-Location $root
  $record = Get-Content -LiteralPath (Join-Path $backup "backup-complete.json") -Raw | ConvertFrom-Json
  $dump = Join-Path $backup "database.dump"
  $storage = Join-Path $backup "storage"
  $manifest = Join-Path $storage "manifest.json"
  if ((Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.databaseSha256 -or
      (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.manifestSha256) {
    throw "Backup checksums do not match; refusing to restore"
  }
  $volumes = & docker volume ls --format '{{.Name}}'
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect Docker volumes" }
  foreach ($suffix in @("recovery_postgres", "recovery_garage_meta", "recovery_garage_data")) {
    if ($volumes -contains "${Project}_${suffix}") { throw "Recovery volume ${Project}_${suffix} already exists; use a new -Project to avoid changing it" }
  }
  Invoke-CheckedDocker ($compose + @("up", "-d", "--wait", "postgres", "garage"))
  $postgres = (& docker @compose ps -q postgres).Trim()
  if ($LASTEXITCODE -ne 0 -or !$postgres) { throw "Recovery PostgreSQL is unavailable" }
  Invoke-CheckedDocker @("cp", $dump, "${postgres}:/tmp/recovery.dump")
  Invoke-CheckedDocker ($compose + @("exec", "-T", "postgres", "sh", "-c", 'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --exit-on-error /tmp/recovery.dump'))
  Invoke-CheckedDocker ($compose + @("run", "--rm", "--no-deps", "--volume", "${storage}:/backup:ro", "--entrypoint", "node", "app", "/app/scripts/storage-archive.mjs", "restore", "/backup"))
  Invoke-CheckedDocker ($compose + @("up", "-d", "--wait", "app"))
  Invoke-CheckedDocker ($compose + @("exec", "-T", "app", "node", "/app/scripts/verify-storage.mjs"))
  Invoke-CheckedDocker ($compose + @("restart", "garage"))
  Invoke-CheckedDocker ($compose + @("exec", "-T", "app", "node", "/app/scripts/verify-storage.mjs"))
  Write-Output "Recovery drill passed. Isolated application: http://localhost:3002"
  Write-Output "Recovery project: $Project (volumes retained)"
} finally {
  Set-Location $previous
}
