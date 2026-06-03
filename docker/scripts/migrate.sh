#!/bin/sh
set -eu

export PGPASSWORD="${POSTGRES_PASSWORD}"

psql \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations)
    AND to_regclass('public.users') IS NOT NULL
  THEN
    IF to_regclass('public.quotas') IS NULL
      OR to_regclass('public.folders') IS NULL
      OR to_regclass('public.files') IS NULL
      OR to_regclass('public.sessions') IS NULL
      OR to_regclass('public.invites') IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'folders'
          AND column_name = 'updated_at'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'files'
          AND column_name = 'name'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'files'
          AND column_name = 'updated_at'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'unique_folder_name_per_parent'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'unique_file_name_per_folder'
      )
    THEN
      RAISE EXCEPTION 'Legacy EnderChest schema is incomplete; baseline refused';
    END IF;

    INSERT INTO schema_migrations (filename)
    VALUES
      ('001_initial_schema.sql'),
      ('002_create_sessions_table.sql'),
      ('003_create_invites_table.sql'),
      ('004_fix_users_uuid_default.sql'),
      ('005_update_storage_schema.sql');
  END IF;
END
$$;
SQL

for migration in /migrations/*.sql; do
  filename="$(basename "${migration}")"
  applied="$(
    psql \
      --host="${POSTGRES_HOST}" \
      --port="${POSTGRES_PORT}" \
      --username="${POSTGRES_USER}" \
      --dbname="${POSTGRES_DB}" \
      --tuples-only \
      --no-align \
      --command="SELECT 1 FROM schema_migrations WHERE filename = '${filename}'"
  )"

  if [ "${applied}" = "1" ]; then
    echo "Skipping ${filename}; already applied."
    continue
  fi

  echo "Applying ${filename}."
  psql \
    --host="${POSTGRES_HOST}" \
    --port="${POSTGRES_PORT}" \
    --username="${POSTGRES_USER}" \
    --dbname="${POSTGRES_DB}" \
    --set=ON_ERROR_STOP=1 \
    --single-transaction \
    --file="${migration}" \
    --command="INSERT INTO schema_migrations (filename) VALUES ('${filename}')"
done
