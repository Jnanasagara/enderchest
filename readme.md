# EnderChest

EnderChest is a self-hosted private cloud storage application. PostgreSQL stores
metadata and MinIO stores uploaded file objects.

## Local Docker Setup

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
3. MinIO starts and passes its health check.
4. `minio-init` creates the `enderchest` bucket if it does not exist.
5. The Next.js app starts at `http://localhost:3000`.

Applied migration filenames are recorded in the `schema_migrations` table.
Existing local databases created before migration tracking are baselined only
when the complete expected schema is present.
MinIO's local console is available at `http://localhost:9001`.

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

Uploads reject payloads larger than `MAX_UPLOAD_BYTES` (default 50 MiB).

## Useful Commands

Check service state:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml ps
```

Stop the stack without deleting stored data:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml down
```

Delete local data and test a clean installation:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml down --volumes
docker compose --env-file docker/.env -f docker/docker-compose.yml up --build
```

The final Ubuntu deployment will use a separate production Compose file with
PostgreSQL data on SSD storage and MinIO object data on HDD storage.

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

Create a PostgreSQL backup from the repository root on Ubuntu or in Git Bash:

```bash
sh docker/scripts/backup-db.sh
```

Restore a PostgreSQL backup only during a maintenance window after stopping the
application container:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml stop app
sh docker/scripts/restore-db.sh backups/enderchest-<timestamp>.dump
docker compose --env-file docker/.env -f docker/docker-compose.yml start app
```

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

### Admin API tests

Start the stack, then run:

```bash
TEST_BASE_URL=http://localhost:3000 \
TEST_ADMIN_EMAIL=admin@example.com \
TEST_ADMIN_PASSWORD=replace_me_with_a_long_password \
npm run test:admin
```
