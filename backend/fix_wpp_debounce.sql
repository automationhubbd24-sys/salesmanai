CREATE TABLE IF NOT EXISTS wpp_debounce (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    debounce_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Optional: Cleanup function to remove old debounce keys
-- CREATE OR REPLACE FUNCTION cleanup_wpp_debounce() RETURNS void AS $$
-- BEGIN
--   DELETE FROM wpp_debounce WHERE created_at < NOW() - INTERVAL '1 hour';
-- END;
-- $$ LANGUAGE plpgsql;
