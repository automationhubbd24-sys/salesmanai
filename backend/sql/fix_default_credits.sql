-- Set default message_credit to 100 for new pages
ALTER TABLE page_access_token_message
ALTER COLUMN message_credit SET DEFAULT 100;

-- Update existing pages with 0 credits to 100 (optional, but good for consistency)
UPDATE page_access_token_message
SET message_credit = 100
WHERE message_credit <= 0 OR message_credit IS NULL;
