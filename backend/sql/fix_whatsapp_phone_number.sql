-- Add missing phone_number column to whatsapp_chats
ALTER TABLE whatsapp_chats
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Add is_locked column for better tracking (optional)
ALTER TABLE whatsapp_chats
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;
