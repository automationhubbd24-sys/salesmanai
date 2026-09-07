-- Migration: Add labels and ai_action columns to whatsapp_contacts table

DO $$ 
BEGIN 
    BEGIN
        ALTER TABLE whatsapp_contacts ADD COLUMN labels JSONB DEFAULT '[]'::jsonb;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column labels already exists in whatsapp_contacts.';
    END;

    BEGIN
        ALTER TABLE whatsapp_contacts ADD COLUMN ai_action TEXT DEFAULT 'continue';
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column ai_action already exists in whatsapp_contacts.';
    END;
END $$;
