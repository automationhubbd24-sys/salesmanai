-- Run these commands in your database console (Supabase, psql, or similar)
ALTER TABLE fb_message_database ADD COLUMN IF NOT EXISTS engine_override VARCHAR(255);
ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS engine_override VARCHAR(255);
