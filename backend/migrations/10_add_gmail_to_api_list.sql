-- Migration to add gmail column to api_list and update earner registrations
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS gmail TEXT;

-- We already have owner_id and mode from previous migrations.
-- Ensure they are correctly set up if not already.
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='owner_id') THEN
        ALTER TABLE api_list ADD COLUMN owner_id UUID REFERENCES users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='mode') THEN
        ALTER TABLE api_list ADD COLUMN mode TEXT DEFAULT 'admin';
    END IF;
END $$;
