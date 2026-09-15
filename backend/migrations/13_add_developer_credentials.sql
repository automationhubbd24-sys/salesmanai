-- Migration to add developer credentials to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS developer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS developer_password TEXT;

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_users_dev_id ON users(developer_id);
