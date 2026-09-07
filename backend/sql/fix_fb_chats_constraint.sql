-- Fix fb_chats constraint for ON CONFLICT clause
-- This script ensures message_id is unique so upserts work correctly

DO $$
BEGIN
    -- 1. Remove duplicates (keep the one with the smallest ID)
    DELETE FROM fb_chats a USING fb_chats b
    WHERE a.id < b.id AND a.message_id = b.message_id;

    -- 2. Drop existing index if it exists (to avoid conflicts)
    DROP INDEX IF EXISTS idx_fb_chats_message_id;

    -- 3. Add UNIQUE constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fb_chats_message_id_key'
    ) THEN
        ALTER TABLE fb_chats ADD CONSTRAINT fb_chats_message_id_key UNIQUE (message_id);
    END IF;
END $$;
