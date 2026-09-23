-- Count all retained objects, including files in trash.
UPDATE quotas q
SET used_bytes = COALESCE((SELECT SUM(size_bytes) FROM files WHERE owner_id = q.user_id), 0);

-- Existing installations may already contain more data than their allocation.
UPDATE quotas SET allocated_bytes = used_bytes WHERE allocated_bytes < used_bytes;
