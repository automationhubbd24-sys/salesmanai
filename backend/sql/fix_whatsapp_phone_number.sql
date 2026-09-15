CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id SERIAL PRIMARY KEY,
  session_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  lid TEXT,
  name TEXT,
  is_locked BOOLEAN DEFAULT false,
  last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(session_name, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_session_phone ON whatsapp_contacts(session_name, phone_number);

-- Add missing phone_number column to whatsapp_chats
ALTER TABLE whatsapp_chats
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Add is_locked column for better tracking (optional)
ALTER TABLE whatsapp_chats
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;

ALTER TABLE whatsapp_chats
ADD COLUMN IF NOT EXISTS token_usage INTEGER DEFAULT 0;

ALTER TABLE whatsapp_chats
ADD COLUMN IF NOT EXISTS model_used TEXT;

ALTER TABLE whatsapp_contacts
ADD COLUMN IF NOT EXISTS phone_number TEXT;

ALTER TABLE whatsapp_contacts
ADD COLUMN IF NOT EXISTS lid TEXT;

ALTER TABLE whatsapp_contacts
ADD COLUMN IF NOT EXISTS last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE whatsapp_contacts
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;

-- Ensure page_prompts has voice_prompt column
ALTER TABLE page_prompts
ADD COLUMN IF NOT EXISTS voice_prompt TEXT DEFAULT 'Transcribe this audio. Priority languages: Bangla, then English, then Hindi. Output ONLY the transcription text.';
