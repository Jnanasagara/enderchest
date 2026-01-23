-- 001_initial_schema.sql
-- Initial database schema for EnderChest
-- Creates core tables: users, quotas, folders, files

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE quotas (
    user_id UUID PRIMARY KEY,
    allocated_bytes BIGINT NOT NULL,
    used_bytes BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT fk_quota_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE folders (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL,
    parent_id UUID,
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP,
    CONSTRAINT fk_folder_owner
        FOREIGN KEY (owner_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_folder_parent
        FOREIGN KEY (parent_id)
        REFERENCES folders(id)
        ON DELETE CASCADE
);

CREATE TABLE files (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL,
    folder_id UUID,
    object_key TEXT NOT NULL UNIQUE,
    size_bytes BIGINT NOT NULL,
    mime_type TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP,
    CONSTRAINT fk_file_owner
        FOREIGN KEY (owner_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_file_folder
        FOREIGN KEY (folder_id)
        REFERENCES folders(id)
        ON DELETE SET NULL
);
