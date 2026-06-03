CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    window_start TIMESTAMP NOT NULL,
    attempts INTEGER NOT NULL,
    blocked_until TIMESTAMP
);

ALTER TABLE rate_limits
ADD CONSTRAINT rate_limits_attempts_check
CHECK (attempts >= 0);

CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked_until
ON rate_limits (blocked_until);
