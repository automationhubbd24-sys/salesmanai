-- Add usage tracking for user vs system
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS usage_user_today INTEGER DEFAULT 0;
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS usage_system_today INTEGER DEFAULT 0;
