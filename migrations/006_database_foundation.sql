-- Strengthen the storage schema without replacing existing tables.

-- Existing users predate automatic quota creation.
INSERT INTO quotas (user_id, allocated_bytes)
SELECT id, 10737418240
FROM users
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE users
ADD CONSTRAINT users_status_check
CHECK (status IN ('active', 'disabled'));

ALTER TABLE quotas
ADD CONSTRAINT quotas_allocated_bytes_check
CHECK (allocated_bytes >= 0),
ADD CONSTRAINT quotas_used_bytes_check
CHECK (used_bytes >= 0 AND used_bytes <= allocated_bytes);

ALTER TABLE files
ADD CONSTRAINT files_size_bytes_check
CHECK (size_bytes >= 0),
ADD COLUMN checksum_sha256 TEXT,
ADD COLUMN extension TEXT;

ALTER TABLE files
ADD CONSTRAINT files_checksum_sha256_check
CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$');

UPDATE folders
SET updated_at = created_at
WHERE updated_at IS NULL;

UPDATE files
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE folders
ALTER COLUMN updated_at SET DEFAULT NOW(),
ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE files
ALTER COLUMN updated_at SET DEFAULT NOW(),
ALTER COLUMN updated_at SET NOT NULL;

-- Deleted names may be reused. Active names remain unique within a folder.
ALTER TABLE folders
DROP CONSTRAINT unique_folder_name_per_parent;

ALTER TABLE files
DROP CONSTRAINT unique_file_name_per_folder;

CREATE UNIQUE INDEX idx_folders_unique_active_root
ON folders (owner_id)
WHERE parent_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX idx_folders_unique_active_name
ON folders (owner_id, parent_id, name)
WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX idx_files_unique_active_name
ON files (owner_id, folder_id, name)
WHERE folder_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_folders_owner_parent_active
ON folders (owner_id, parent_id, name)
WHERE deleted_at IS NULL;

CREATE INDEX idx_files_owner_folder_active
ON files (owner_id, folder_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_folders_deleted_at
ON folders (deleted_at)
WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_files_deleted_at
ON files (deleted_at)
WHERE deleted_at IS NOT NULL;

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_created_at
ON audit_logs (actor_user_id, created_at DESC);

CREATE INDEX idx_audit_logs_entity
ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER folders_set_updated_at
BEFORE UPDATE ON folders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER files_set_updated_at
BEFORE UPDATE ON files
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER quotas_set_updated_at
BEFORE UPDATE ON quotas
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Trashing a folder recursively trashes its descendants and contained files.
CREATE OR REPLACE FUNCTION trash_folder_contents()
RETURNS TRIGGER AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    WITH RECURSIVE descendant_folders AS (
        SELECT id
        FROM folders
        WHERE parent_id = NEW.id
          AND deleted_at IS NULL

        UNION ALL

        SELECT folders.id
        FROM folders
        INNER JOIN descendant_folders
            ON folders.parent_id = descendant_folders.id
        WHERE folders.deleted_at IS NULL
    )
    UPDATE folders
    SET deleted_at = NEW.deleted_at
    WHERE id IN (SELECT id FROM descendant_folders);

    WITH RECURSIVE trashed_folders AS (
        SELECT NEW.id AS id

        UNION ALL

        SELECT folders.id
        FROM folders
        INNER JOIN trashed_folders
            ON folders.parent_id = trashed_folders.id
        WHERE folders.deleted_at = NEW.deleted_at
    )
    UPDATE files
    SET deleted_at = NEW.deleted_at
    WHERE folder_id IN (SELECT id FROM trashed_folders)
      AND deleted_at IS NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER folders_trash_contents
AFTER UPDATE OF deleted_at ON folders
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION trash_folder_contents();
