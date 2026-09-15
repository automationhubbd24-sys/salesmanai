-- 1. Remove duplicate messages first (keep latest)
DELETE FROM whatsapp_chats a USING whatsapp_chats b
WHERE a.id < b.id AND a.message_id = b.message_id;

-- 2. Add unique constraint to whatsapp_chats(message_id)
ALTER TABLE whatsapp_chats
ADD CONSTRAINT whatsapp_chats_message_id_key UNIQUE (message_id);

-- 3. Add page_id to ai_usage_logs
ALTER TABLE ai_usage_logs
ADD COLUMN IF NOT EXISTS page_id TEXT;
