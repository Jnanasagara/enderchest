# Operating EnderChest

Run these commands from the installed EnderChest directory. Keep `docker/.env`,
`docker/.env.public` (when present), and the selected storage folder with that
installation. The public product website does not operate individual hosts.

## Check health

On Linux:

```bash
bash scripts/health-check.sh
```

On Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/health-check.ps1
```

Both commands exit with a failure when the app, PostgreSQL, or Garage is
unhealthy. Schedule the check and alert on a nonzero exit status. For a published
instance, also check its public HTTPS address from another network; a local
health check cannot detect a broken tunnel, DNS record, or certificate.

Admins can also open **Administration > Host** to see service status, free space
on the file-object disk, the latest completed local backup, and whether the
configured public address responds from their browser. The dashboard refreshes
once a minute. Browser reachability is not a substitute for testing from
mobile data or another network.

## Make a complete backup

The coordinated backup briefly stops the app so database metadata and object
bytes describe the same point in time. Existing data is left in place.

On Linux, pass a destination and optionally a separate mounted disk or share:

```bash
bash scripts/backup-all.sh backups /mnt/enderchest-backups
```

On Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-all.ps1 -CopyTo E:\EnderChestBackups
```

Without the second location, the backup stays under `backups/` on the host.
A custom local backup destination can be shown in the Host dashboard by setting
`ENDER_BACKUP_ROOT` in `docker/.env` to that absolute directory and restarting
the app. The app receives that directory read-only. The dashboard reads only
`backup-complete.json` markers, not backup contents. It does not report off-host
copies or verify that a backup can be restored.
A successful backup has `database.dump`, `storage/manifest.json`, object files,
and `backup-complete.json` with checksums. A failed backup has no completion
marker. Keep several generations off the host, and test restores separately.
The chosen storage folder and Docker volumes are live data, not backups.

## Update an existing host

1. Record the current version and run a complete backup. Confirm its
   `backup-complete.json` exists and copy it off the host.
2. Download the newer complete bundle and check its SHA-256 against the
   `SHA256SUMS.txt` offered with that release.
3. Extract the bundle to a **temporary** folder. Review any customized Docker
   or Caddy configuration before copying the new bundle files over the installed
   directory. The bundle contains no `.env` files, uploaded objects, or volumes.
4. Copy the contents of the extracted `EnderChest-<version>` directory into the
   existing installation directory. Do not replace the installation directory
   itself; that directory holds the private configuration.
5. For a guided installation, run `bash setup.sh` on Linux or
   `Setup-EnderChest.cmd` on Windows. It reuses saved settings, rebuilds the app,
   and applies database migrations. For a manual installation, run the same
   `docker compose ... up -d --build --wait` command used for that host, including
   its install or publishing overlay when applicable.
6. Run the health check and test login, upload, and download. Published hosts
   should also test an invite link and a download from outside the home network.

If the new stack fails, inspect logs before changing stored data. Restoring a
database alone while keeping newer object storage can create mismatches. Use a
matching database and object backup together during a planned restore.

## Troubleshoot

| Symptom | Check |
| --- | --- |
| Setup cannot reach Docker | Start Docker Desktop or Docker Engine, then run `docker info` and `docker compose version`. On Linux, check your Docker group access. |
| App unavailable on localhost | Run the health check; inspect `docker compose ... ps` and logs. Check whether port 3000 is in use. |
| Login works locally but public link fails | Verify the tunnel or Caddy is running, DNS points to this host, HTTPS has no certificate warning, and `docker/.env.public` matches the published address. |
| Upload or download fails | Check free disk space on the object storage drive and Docker volume drive. Inspect app and Garage logs. |
| Backup failed | Check free space at the destination and Docker health. Keep the incomplete directory for diagnosis; rerun with a new timestamp. |

For the base stack, these commands show recent service logs without printing
environment secrets:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml ps
docker compose --env-file docker/.env -f docker/docker-compose.yml logs --tail=100 app postgres garage
```

If a guided installation uses a storage folder, include
`-f docker/compose.install.yml` before `ps` or `logs`. Include the publishing
overlay when diagnosing Caddy or the hourly cleanup service. Never use
`down --volumes` on a host with user data.
