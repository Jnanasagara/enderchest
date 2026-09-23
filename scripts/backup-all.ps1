param(
  [string]$Destination = "backups",
  [string]$CopyTo = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$previous = Get-Location
$destinationRoot = if ([IO.Path]::IsPathRooted($Destination)) { $Destination } else { Join-Path $root $Destination }
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupPath = Join-Path $destinationRoot "enderchest-$stamp"
$compose = @("compose", "--env-file", "docker/.env", "-f", "docker/docker-compose.yml")
if (Select-String -LiteralPath (Join-Path $root "docker/.env") -Pattern '^ENDER_SETUP_VERSION=1$' -Quiet) {
  $compose += @("-f", "docker/compose.install.yml")
}
$appWasRunning = $false

function Invoke-CheckedDocker([string[]]$DockerArgs) {
  & docker @DockerArgs
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed with exit code $LASTEXITCODE" }
}

try {
  Set-Location $root
  if (Test-Path -LiteralPath $backupPath) { throw "Backup path already exists: $backupPath" }
  New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
  $running = & docker @compose ps --status running --services
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the stack" }
  $appWasRunning = $running -contains "app"
  if ($appWasRunning) { Invoke-CheckedDocker ($compose + @("stop", "app")) }
  try {
    $dumpPath = "/tmp/enderchest-$stamp.dump"
    Invoke-CheckedDocker ($compose + @("exec", "-T", "postgres", "sh", "-c", "pg_dump --username=`"`$POSTGRES_USER`" --dbname=`"`$POSTGRES_DB`" --format=custom --file=$dumpPath"))
    Invoke-CheckedDocker @("cp", "enderchest_postgres`:$dumpPath", (Join-Path $backupPath "database.dump"))
    $storagePath = Join-Path $backupPath "storage"
    Invoke-CheckedDocker ($compose + @("run", "--rm", "--no-deps", "--volume", "${storagePath}:/backup", "--entrypoint", "node", "app", "/app/scripts/storage-archive.mjs", "backup", "/backup"))
    $record = @{
      createdUtc = $stamp
      databaseSha256 = (Get-FileHash -LiteralPath (Join-Path $backupPath "database.dump") -Algorithm SHA256).Hash.ToLowerInvariant()
      manifestSha256 = (Get-FileHash -LiteralPath (Join-Path $storagePath "manifest.json") -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupPath "backup-complete.json") -Encoding UTF8
  } finally {
    if ($appWasRunning) { Invoke-CheckedDocker ($compose + @("start", "app")) }
  }
  if ($CopyTo) {
    $copyRoot = if ([IO.Path]::IsPathRooted($CopyTo)) { $CopyTo } else { Join-Path $root $CopyTo }
    New-Item -ItemType Directory -Path $copyRoot -Force | Out-Null
    $copyPath = Join-Path $copyRoot (Split-Path $backupPath -Leaf)
    if (Test-Path -LiteralPath $copyPath) { throw "Off-host backup path already exists: $copyPath" }
    Copy-Item -LiteralPath $backupPath -Destination $copyPath -Recurse
    Write-Output "Copied backup to $copyPath"
  }
  Write-Output "Complete backup: $backupPath"
} finally {
  Set-Location $previous
}
