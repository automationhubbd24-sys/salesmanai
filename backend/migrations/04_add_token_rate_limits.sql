-- Add Token-based Rate Limit columns to api_list
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS tpm_limit INTEGER DEFAULT 0; -- Tokens Per Minute
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS tpd_limit INTEGER DEFAULT 0; -- Tokens Per Day
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS tpmo_limit INTEGER DEFAULT 0; -- Tokens Per Month
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS usage_tokens_month BIGINT DEFAULT 0; -- Monthly usage tracker
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS last_month_checked TEXT DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM'); -- Month tracker

-- Add Token-based Rate Limit columns to api_engine_configs (Global Settings)
ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS text_tpm INTEGER DEFAULT 0;
ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS text_tpd INTEGER DEFAULT 0;
ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS text_tpmo INTEGER DEFAULT 0;

ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS vision_tpm INTEGER DEFAULT 0;
ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS vision_tpd INTEGER DEFAULT 0;
ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS vision_tpmo INTEGER DEFAULT 0;

ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS voice_tpm INTEGER DEFAULT 0;
ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS voice_tpd INTEGER DEFAULT 0;
ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS voice_tpmo INTEGER DEFAULT 0;
