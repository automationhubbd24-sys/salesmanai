ALTER TABLE whatsapp_contacts
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;

ALTER TABLE whatsapp_message_database
ADD COLUMN IF NOT EXISTS push_name TEXT;
