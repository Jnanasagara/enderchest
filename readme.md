# EnderChest

EnderChest is a self-hosted private cloud storage application. PostgreSQL stores
metadata and Garage stores uploaded file objects through its S3 API. Users get a browser for uploads,
folders, search, previews, downloads, recent files, trash, account settings, and
storage usage. Administrators manage users, invitations, quotas, and activity.

Each host installs an independent EnderChest server and uses their own public
domain or tunnel address for remote users. Invitation links lead to that host's
server; the EnderChest product domain is not involved in routing or storing
their files. See [Publishing an instance](docs/public-access.md) for DNS,
HTTPS, and a remote-access check.

The product website at `enderchest.space` is in `site/` and deploys separately
from every personal instance. It explains EnderChest and offers complete ZIP
and tar.gz release bundles with the app, Docker files, and setup launchers.
Run `npm run build:release` before deploying the site. The launchers cannot be
downloaded and run alone. See `site/README.md` for Vercel or Railway setup;
the local setup scripts do not deploy the product website.

For updates, monitoring, backups, and troubleshooting on an installed host, see
[Operating EnderChest](docs/operations.md).

## Local Docker Setup

### Guided first-run setup

For a fresh Windows installation, install and start Docker Desktop, then
double-click `Setup-EnderChest.cmd`. For Ubuntu, Mint, or another Linux host,
install Docker Engine with the Compose plugin, then run `bash setup.sh` from the
repository directory. A desktop session opens a local setup page; a headless
server uses hidden terminal password prompts. Use `bash setup.sh --cli` to force
terminal setup or `bash setup.sh --web` with an SSH tunnel to port 4400 for a
remote browser. The setup page binds only to `127.0.0.1` on the host.

The wizard asks for the first admin email/password and a new or empty storage
folder, generates the remaining secrets, validates the Docker configuration,
then builds and starts EnderChest at `http://localhost:3000`. Uploaded file
bytes live in `<chosen folder>/objects`; PostgreSQL and Garage metadata remain
in persistent Docker volumes. The setup refuses to overwrite an existing
manual installation or data volume. Running the launcher again resumes a
wizard-created installation without recreating its data.

This first-run setup is **local-only**. It does not open firewall ports or make
HTTP logins available over the internet. To serve family members remotely,
run `bash publish.sh` on Linux or `Publish-EnderChest.cmd` on Windows. Choose
Tailscale Funnel, your own HTTPS provider, or your own domain with Caddy. The
admin UI copies invitation codes locally, and full remote links only after a
public HTTPS app address is configured. Back up both the database and object
storage regularly.

### Manual setup

Create the local environment file and replace every `replace_me` value:

```powershell
Copy-Item docker/env.example docker/.env
```

Start the stack from the repository root:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml up --build
```

The stack starts in dependency order:

1. PostgreSQL starts and passes its health check.
2. `migrate` applies each unapplied SQL file from `migrations/`.
3. Garage starts, creates its configured S3 key and bucket, and passes its health check.
4. `s3-init` configures narrow browser CORS for signed downloads.
5. The Next.js app starts at `http://localhost:3000`.

Sign in with the bootstrap administrator from `docker/.env`, open Administration,
create an invitation, and copy its link to a new user. The app and Garage S3 ports
bind to localhost in the local Compose stack; PostgreSQL is reachable only by
containers on the Compose network.

Applied migration filenames are recorded in the `schema_migrations` table.
Existing local databases created before migration tracking are baselined only
when the complete expected schema is present.
Garage's S3 API is available locally at `http://localhost:3900`. Its metadata
and object bytes live in separate persistent Docker volumes.
`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, and the S3 key
pair configure the app without tying its storage code to Garage. The public
endpoint is used only for short-lived signed download URLs. The
`GET /api/files/:id/presign` route checks the logged-in file owner and returns
a URL that expires after five minutes.

The local Compose file sets `SESSION_COOKIE_SECURE=false` so Postman can send
the session cookie over HTTP. Production deployment must set it to `true` and
serve EnderChest through HTTPS.

## Auth And Security

Password policy defaults to a minimum of 12 characters and requires at least
three of: lowercase, uppercase, number, symbol. Use `PASSWORD_MIN_LENGTH` and
`PASSWORD_MAX_LENGTH` to override the length bounds.

Rate limits are enforced on login, registration, and invite creation. Tune the
limits with:

- `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS`, `LOGIN_RATE_LIMIT_BLOCK_MS`
- `REGISTER_RATE_LIMIT_MAX`, `REGISTER_RATE_LIMIT_WINDOW_MS`, `REGISTER_RATE_LIMIT_BLOCK_MS`
- `INVITE_RATE_LIMIT_MAX`, `INVITE_RATE_LIMIT_WINDOW_MS`, `INVITE_RATE_LIMIT_BLOCK_MS`

State-changing requests require a CSRF header when a session cookie is present.
After login, use the `csrf` cookie value for the `x-csrf-token` header.
`POST /api/auth/logout-all` clears sessions on every device.

Uploads reject payloads larger than `MAX_UPLOAD_BYTES` (default 50 MiB) and
enforce each user's quota. Files in Trash still count toward storage until
permanently deleted. A background cleanup task in the production stack removes
trash older than `TRASH_RETENTION_DAYS` (default 30).

## Useful Commands

Check service state:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml ps
```

Stop the stack without deleting stored data:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml down
```

Do not use `down --volumes` on an installation containing user data.

## Production Deployment

Use the guided publishing flow in [Publishing an instance](docs/public-access.md)
for new installations. Its public settings live in `docker/.env.public` so
generated database and storage credentials are not rewritten. Rerunning the
guided setup launcher retains its published mode and selected storage folder.

Point `DOMAIN` and `S3_PUBLIC_DOMAIN` at the server, and set a random
`MAINTENANCE_TOKEN` (at least 32 characters) in `docker/.env`. The S3 domain
must be a distinct origin from the app domain for signed downloads. Then
start the HTTPS overlay. If you used the guided installer, include
`-f docker/compose.install.yml` before the production overlay so uploaded
objects remain on the storage folder you selected:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.production.yml up -d --build
```

Caddy serves HTTPS for both domains and renews certificates. Allow inbound TCP
80 and 443. The S3 API key is scoped to the EnderChest bucket; only signed GET
URLs are handed to browsers. `S3_CORS_ORIGINS` is set to the app origin in the
production overlay, without granting general cross-origin access.
The application sets secure cookies in this stack. Back up both PostgreSQL and
Garage together while uploads are paused. Keep copies off the host. Monitor the
container health checks and logs. Set filesystem locations for Docker's named
volumes on suitable disks for your server before storing important data.
The bundled Garage is a single node, so the persistent volumes and off-host
backups are essential; use a multi-node Garage layout where redundancy is needed.

## Moving Existing Objects To Garage

Do not delete or reset the old S3 service or its Docker volume. Back up both the
database and object bucket, stop writes to the old app, then start Garage with
`docker compose --env-file docker/.env -f docker/docker-compose.yml up -d garage`.
The app should remain stopped until migration verification succeeds.

Set `SOURCE_S3_ENDPOINT`, `SOURCE_S3_REGION`, `SOURCE_S3_BUCKET`,
`SOURCE_S3_ACCESS_KEY_ID`, and `SOURCE_S3_SECRET_ACCESS_KEY` for the old S3
server. If migrating from the previous local MinIO stack, its endpoint is
`http://localhost:9000` and its region is `us-east-1`. On the host, override
`S3_ENDPOINT` to `http://localhost:3900`, then run:

```bash
node --env-file=docker/.env scripts/migrate-s3.mjs
node --env-file=docker/.env scripts/migrate-s3.mjs --verify
```

The script copies every object and its S3 metadata, preserves every key,
compares SHA-256 hashes, and refuses to overwrite different destination bytes.
It never deletes a source object. After verification, start the new app with
`docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build`.
Keep the old volume until a separate retention decision. Database metadata
requires no conversion.

For a local signed-download and CORS smoke test, set `S3_ENDPOINT` to
`http://localhost:3900` in the shell and run `npm run test:s3`.

## Database Foundation

The first startup creates an administrator only when no admin account exists.
Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in `docker/.env`
before starting a fresh installation. Later startups skip the bootstrap once an
admin exists.

Every user receives a quota row. `DEFAULT_QUOTA_BYTES` controls the allocation
for newly registered users and defaults to 10 GiB.

Files and folders use soft deletion. Trashing a folder recursively trashes its
descendant folders and contained files. Active names must be unique within the
same parent folder, while names belonging only to trashed items may be reused.

On Linux, make one coordinated, checksummed database-and-object backup:

```bash
bash scripts/backup-all.sh backups /mnt/enderchest-backups
```

The second argument is optional. It copies the complete backup to a separate
mounted disk or share. The older `backup-db.sh` and `backup-storage.sh` scripts
remain available for individual manual exports, but they do not stop writes or
create a matching pair.

Restore both backups only during a maintenance window with the app stopped.
Restore objects into a fresh Garage bucket when rebuilding a server:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml stop app
sh docker/scripts/restore-db.sh backups/enderchest-<timestamp>.dump
sh docker/scripts/restore-storage.sh backups/storage-<timestamp>
docker compose --env-file docker/.env -f docker/docker-compose.yml start app
```

On Windows, create one coordinated, checksummed database-and-object backup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-all.ps1 -CopyTo E:\EnderChestBackups
```

`-CopyTo` should point to a separate disk or off-host mounted share. Confirm that
copies actually arrive there and keep more than one generation. Schedule the
command in Task Scheduler during a quiet period; it pauses app writes while the
database and Garage are captured. A backup is complete only when
`backup-complete.json` exists. Do not put backups in a public web directory.

Test a backup without touching live volumes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/recovery-drill.ps1 -BackupPath backups\enderchest-<timestamp>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/health-check.ps1
```

On Linux, use `bash scripts/health-check.sh` for the same service checks.

The drill checks backup hashes, restores into fresh `enderchest-recovery` Docker
volumes, verifies every database file against Garage, restarts Garage, and
verifies again. It refuses to reuse recovery volumes; choose a new `-Project`
name for a later drill. The recovered app is available only on
`http://localhost:3002`. The drill leaves its volumes intact for inspection.
`health-check.ps1` exits nonzero when the live app, PostgreSQL, or Garage is
unhealthy, so a scheduler or monitoring agent can alert on failure. Run it
periodically and review Docker logs when it fails.

## Admin Management

Admin APIs require a session cookie and the CSRF header (`x-csrf-token`).

- `GET /api/admin/users` lists users.
- `PATCH /api/admin/users` updates status (`active` or `disabled`) and/or admin role.
- `DELETE /api/admin/users` deletes a user and all dependent data.
- `GET /api/admin/quotas` lists allocated and used bytes per user.
- `PATCH /api/admin/quotas` updates a user quota.
- `GET /api/admin/audit` lists recent audit entries.
- `POST /api/admin/invite` creates an invite; use `INVITE_DEFAULT_EXPIRES_HOURS` for defaults.
- `PATCH /api/admin/invite` revokes an unused invite.
- `DELETE /api/admin/invite` deletes an unused invite.

Admin actions are recorded in `audit_logs`. The last admin cannot be suspended,
demoted, or deleted.

`POST /api/maintenance/cleanup` requires `Authorization: Bearer <MAINTENANCE_TOKEN>`;
the production Compose stack calls it hourly. Each call removes at most 100 old
file objects and then empty deleted folders. The token is never exposed to users.

### Admin API tests

Start the stack, then run:

```bash
TEST_BASE_URL=http://localhost:3000 \
TEST_ADMIN_EMAIL=admin@example.com \
TEST_ADMIN_PASSWORD=replace_me_with_a_long_password \
npm run test:admin
```

With `docker/.env` containing the bootstrap admin credentials, Node 22 can run
both integration suites without retyping secrets:

```bash
node --env-file=docker/.env --test tests/admin-api.test.mjs
node --env-file=docker/.env --test tests/storage-api.test.mjs
```

For an existing installation whose admin password differs from `docker/.env`,
run the tests inside the app container with a temporary administrator. The
runner removes that account afterward:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml exec -T app node tests/run-integration.mjs
```
