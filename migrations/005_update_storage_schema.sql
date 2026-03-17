-- Add updated_at to folders
ALTER TABLE folders
ADD COLUMN updated_at TIMESTAMP;

-- Prevent duplicate folder names inside same parent
ALTER TABLE folders
ADD CONSTRAINT unique_folder_name_per_parent
UNIQUE (owner_id, parent_id, name);

-- Add name column to files
ALTER TABLE files
ADD COLUMN name TEXT NOT NULL DEFAULT '';

-- Add updated_at column to files
ALTER TABLE files 
ADD COLUMN updated_at TIMESTAMP;

-- Prevent duplicate filenames inside same folder
ALTER TABLE files 
ADD CONSTRAINT unique_file_name_per_folder
UNIQUE (owner_id, folder_id, name);